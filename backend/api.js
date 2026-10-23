import { validateMode, modeFor } from '../modes.js';
import { publicNetwork } from './network.js';
import { DEFAULT_RULES, validateRules, validateDifficulty, difficultyFor } from '../rules.js';
import { newRun } from '../engine.js';
import { applyAction, clientState } from './game.js';
import { token, digest, cookie, sessionCookie, HttpError, jsonBody, validNewPassword, hashPassword, verifyPassword, validSetupKey, verifySetupKey } from './security.js';
import { rankingFor } from '../rankings.js';
import { pruneScoresStatement } from './leaderboard.js';
import { siteSettings, rankingEpochs, updateSiteSettings, resetLeaderboard, requireRanking } from './settings.js';
import { usageReport } from './usage.js';

const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
export function json(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } }); }
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const now = () => Date.now();
async function currentConfig(db) {
  const current = await one(db, "SELECT value FROM paixu_meta WHERE key='current_config'");
  if (current) { const c = await one(db, 'SELECT * FROM paixu_configs WHERE id=?', current.value); if (c) return { id: c.id, rules: JSON.parse(c.body) }; }
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO paixu_configs(id,body,created_at) VALUES(?,?,?)').bind('default-v1', JSON.stringify(DEFAULT_RULES), now()),
    db.prepare("INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('current_config',?)").bind('default-v1'),
  ]);
  return currentConfig(db);
}
async function publicRun(db, row, state = JSON.parse(row.state)) {
  const settings = await siteSettings(db), epochs = await rankingEpochs(db, modeFor(state).id);
  const finished=row.status!=='active', eligible=settings.rankingEnabled && row.ranking_epoch===epochs[difficultyFor(state).id];
  const scoreRecorded=finished ? !!await one(db,'SELECT run_id FROM paixu_scores WHERE run_id=?',row.id) : null;
  return { id: row.id, revision: row.revision, configVersion: row.config_version, state: clientState(state), finished, eligible, rankingLimit:settings.rankingLimit, scoreRecorded, rankingStatus: !finished ? null : scoreRecorded ? 'retained' : !eligible ? 'ineligible' : state.bestHand<=0 ? 'empty' : 'outside_top' };
}
async function limit(db, key, max, ms) {
  const bucket = Math.floor(now() / ms); const id = await digest(key + ':' + bucket);
  const value = await one(db, 'INSERT INTO paixu_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', id, (bucket + 1) * ms);
  if (value.count > max) throw new HttpError(429, 'Too many requests. Please try again later.', 'rate_limited');
}
async function player(request, db, required = true) {
  const key = cookie(request, 'paixu_guest'); const row = key && await one(db, 'SELECT * FROM paixu_players WHERE token_hash=?', await digest(key));
  if (!row && required) throw new HttpError(401, 'Initialize your player profile first', 'profile_required');
  return row || null;
}
function publicProfile(v) { return v ? { id: v.id, displayName: v.display_name } : null; }
async function admin(request, db) {
  const key = cookie(request, 'paixu_admin');
  if (!key || !await one(db, 'SELECT token_hash FROM paixu_admin_sessions WHERE token_hash=? AND expires_at>?', await digest(key), now())) throw new HttpError(401, 'Administrator login required', 'admin_required');
}
function generateDisplayName() { return '牌友-' + token().slice(0, 8).toUpperCase(); }
function normalizeDisplayName(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if ([...name].length < 1 || [...name].length > 24 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw new HttpError(400, 'Display name must contain 1–24 visible characters', 'invalid_display_name');
  return name;
}
export async function cleanup(db) {
  await db.batch([
    db.prepare('DELETE FROM paixu_rate_limits WHERE expires_at<?').bind(now()),
    db.prepare('DELETE FROM paixu_admin_sessions WHERE expires_at<?').bind(now()),
    db.prepare("DELETE FROM paixu_runs WHERE updated_at<? AND id IN (SELECT id FROM paixu_runs WHERE updated_at<? LIMIT 100)").bind(now() - 7 * 86400000, now() - 7 * 86400000),
    // Keep scores, but automatically remove private network metadata after 30 days.
    db.prepare("UPDATE paixu_scores SET ip='',browser='',country='',region='' WHERE created_at<? AND (ip!='' OR browser!='' OR country!='' OR region!='')").bind(now() - 30 * 86400000),
    // Redact expired metadata even when old runs exceed the bounded deletion batch.
    db.prepare("UPDATE paixu_runs SET ip='',browser='',country='',region='' WHERE created_at<? AND (ip!='' OR browser!='' OR country!='' OR region!='')").bind(now() - 30 * 86400000),
    pruneScoresStatement(db),
  ]);
}
export async function handleApi(request, env) {
  const url = new URL(request.url), path = url.pathname, db = env.DB;
  if (!path.startsWith('/api/')) return null;
  try {
    if (!db) throw new HttpError(503, 'Database is not configured', 'backend_unavailable');
    const ip = String(env.clientIp || 'unknown').slice(0, 100);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-origin writes are not allowed');
      await limit(db, 'write:' + ip, 180, 60000);
    }
    if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
    if (path === '/api/config' && request.method === 'GET') return json({ ...await currentConfig(db), rankingEnabled: (await siteSettings(db)).rankingEnabled });
    if (path === '/api/me' && request.method === 'GET') return json({ profile: publicProfile(await player(request, db, false)) });
    if (path === '/api/profile' && request.method === 'POST') {
      await requireRanking(db);
      await limit(db, 'profile:' + ip, 20, 3600000);
      const body = await jsonBody(request); let v = await player(request, db, false); const headers = {};
      const displayName = body.displayName === undefined ? (v?.display_name || generateDisplayName()) : normalizeDisplayName(body.displayName);
      if (v && displayName !== v.display_name) {
        await run(db, 'UPDATE paixu_players SET display_name=?,updated_at=? WHERE id=?', displayName, now(), v.id);
        v = { ...v, display_name: displayName };
      } else if (!v) {
        const key = token();
        v = { id: crypto.randomUUID(), token_hash: await digest(key), display_name: displayName, created_at: now(), updated_at: now() };
        await run(db, 'INSERT INTO paixu_players(id,token_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?)', v.id, v.token_hash, displayName, v.created_at, v.updated_at);
        headers['Set-Cookie'] = sessionCookie(request, 'paixu_guest', key, 31536000);
        await cleanup(db);
      }
      return json({ profile: publicProfile(v) }, 200, headers);
    }
    if (path === '/api/leaderboard' && request.method === 'GET') {
      await requireRanking(db);
      await limit(db, 'board:' + ip, 120, 60000);
      const config = await currentConfig(db); const version = url.searchParams.get('version') || config.id;
      let difficulty; try { difficulty = validateDifficulty(url.searchParams.get('difficulty') ?? undefined); } catch { throw new HttpError(400, 'Invalid difficulty', 'invalid_difficulty'); }
      let mode; try { mode = validateMode(url.searchParams.get('mode') ?? undefined); } catch { throw new HttpError(400, 'Invalid game mode', 'invalid_mode'); }
      let metric; try { metric=rankingFor(url.searchParams.get('metric') ?? undefined); } catch { throw new HttpError(400,'Invalid ranking metric','invalid_ranking_metric'); }
      const settings=await siteSettings(db);
      const since = url.searchParams.get('period') === 'daily' ? Math.floor(now() / 86400000) * 86400000 : 0;
      const versions = await all(db, 'SELECT id,created_at FROM paixu_configs ORDER BY created_at DESC LIMIT 50');
      const rows = await all(db, `SELECT s.run_id,s.display_name,s.best_hand,s.total_score,s.rounds,s.ante,s.outcome,s.created_at,s.duration_ms,s.config_version,s.difficulty,s.mode,s.ip,s.browser,s.country,s.region FROM paixu_scores s WHERE s.hidden=0 AND s.config_version=? AND s.difficulty=? AND s.mode=? AND s.ranking_epoch=(SELECT epoch FROM paixu_mode_epochs WHERE mode=s.mode AND difficulty=s.difficulty) AND s.created_at>=? ${metric.id==='rounds' ? 'AND s.rounds IS NOT NULL' : ''} ORDER BY s.${metric.column} DESC,s.created_at ASC,s.run_id ASC LIMIT ?`, version, difficulty, mode, since, settings.rankingLimit);
      return json({ version, versions, difficulty, mode, metric:metric.id, limit:settings.rankingLimit, entries: rows.map((s, i) => ({ rank: i + 1, runId: s.run_id, difficulty: s.difficulty, mode: s.mode, network: publicNetwork(s), displayName: s.display_name, bestHand: s.best_hand, totalScore: s.total_score, rounds:s.rounds, ante: s.ante, outcome: s.outcome, createdAt: s.created_at, durationMs: s.duration_ms })) });
    }
    if (path === '/api/runs/current' && request.method === 'GET') {
      const v = await player(request, db); const row = await one(db, "SELECT * FROM paixu_runs WHERE player_id=? AND status='active' ORDER BY created_at DESC LIMIT 1", v.id);
      return json({ run: row ? await publicRun(db, row) : null });
    }
    const runMatch = path.match(/^\/api\/runs\/([a-f0-9-]{36})$/);
    if (runMatch && request.method === 'GET') {
      const v = await player(request, db); const row = await one(db, 'SELECT * FROM paixu_runs WHERE id=? AND player_id=?', runMatch[1], v.id);
      if (!row) throw new HttpError(404, 'Run not found');
      return json({ run: await publicRun(db, row) });
    }
    if (path === '/api/runs' && request.method === 'POST') {
      await requireRanking(db);
      const v = await player(request, db); const body = await jsonBody(request); await limit(db, 'newrun:' + ip, 30, 3600000);
      let difficulty; try { difficulty = validateDifficulty(body.difficulty); } catch { throw new HttpError(400, 'Invalid difficulty', 'invalid_difficulty'); }
      let mode; try { mode = validateMode(body.mode); } catch { throw new HttpError(400, 'Invalid game mode', 'invalid_mode'); }
      const config = await currentConfig(db); const state = newRun(token().slice(0, 24), config.rules, difficulty, mode); const id = crypto.randomUUID(); const at = now();
      const created = await db.batch([
        db.prepare("UPDATE paixu_runs SET status='abandoned' WHERE player_id=? AND status='active' AND EXISTS(SELECT 1 FROM paixu_site_settings WHERE id=1 AND ranking_enabled=1)").bind(v.id),
        db.prepare("INSERT INTO paixu_runs(id,player_id,state,revision,config_version,status,created_at,updated_at,ip,browser,mode,country,region,ranking_epoch) SELECT ?,?,?,0,?,?,?,?,?,?,?,?,?,epoch FROM paixu_mode_epochs WHERE mode=? AND difficulty=? AND EXISTS(SELECT 1 FROM paixu_site_settings WHERE id=1 AND ranking_enabled=1)").bind(id, v.id, JSON.stringify(state), config.id, 'active', at, at, ip, (request.headers.get('user-agent') || '').slice(0, 512), mode, env.clientRegion?.country || '', env.clientRegion?.region || '', mode, difficulty),
      ]);
      if (created[1].meta.changes !== 1) throw new HttpError(403, 'Rankings are disabled', 'ranking_disabled');
      return json({ run: await publicRun(db, await one(db, 'SELECT * FROM paixu_runs WHERE id=?', id), state) }, 201);
    }
    const actionMatch = path.match(/^\/api\/runs\/([a-f0-9-]{36})\/actions$/);
    if (actionMatch && request.method === 'POST') {
      const v = await player(request, db); const input = await jsonBody(request); const row = await one(db, 'SELECT * FROM paixu_runs WHERE id=? AND player_id=?', actionMatch[1], v.id);
      if (!row) throw new HttpError(404, 'Run not found');
      if (row.status !== 'active') throw new HttpError(409, 'This run has ended', 'run_ended');
      if (input.revision !== row.revision) throw new HttpError(409, 'Run changed. Reload to resume.', 'revision_conflict');
      const state = JSON.parse(row.state); let finished = false;
      if (input.action === 'finish') finished = true;
      else { applyAction(state, input); finished = state.phase === 'lost' || state.phase === 'victory'; }
      const nextRevision = row.revision + 1, at = now();
      const networkFresh=at-row.created_at<30*86400000;
      const statements = [db.prepare('UPDATE paixu_runs SET state=?,revision=?,status=?,updated_at=? WHERE id=? AND revision=? AND status=?').bind(JSON.stringify(state), nextRevision, finished ? 'finished' : 'active', at, row.id, row.revision, 'active')];
      if (finished && state.bestHand > 0) {
        statements.push(db.prepare(`INSERT OR IGNORE INTO paixu_scores(run_id,player_id,display_name,best_hand,total_score,rounds,ante,outcome,config_version,created_at,duration_ms,ip,browser,difficulty,mode,country,region,ranking_epoch) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,ranking_epoch FROM paixu_runs WHERE id=? AND revision=? AND status='finished' AND ranking_epoch=(SELECT epoch FROM paixu_mode_epochs WHERE mode=? AND difficulty=?) AND EXISTS(SELECT 1 FROM paixu_site_settings WHERE id=1 AND ranking_enabled=1)`).bind(row.id, v.id, v.display_name, state.bestHand, state.totalScore, state.round, state.ante, state.phase === 'victory' ? 'victory' : state.phase === 'lost' ? 'lost' : 'submitted', row.config_version, at, at - row.created_at, networkFresh ? row.ip : '', networkFresh ? row.browser : '', difficultyFor(state).id, modeFor(state).id, networkFresh ? row.country : '', networkFresh ? row.region : '', row.id, nextRevision, modeFor(state).id, difficultyFor(state).id));
        statements.push(pruneScoresStatement(db,{mode:modeFor(state).id,difficulty:difficultyFor(state).id,config_version:row.config_version,ranking_epoch:row.ranking_epoch}));
      }
      const results = await db.batch(statements); if (results[0].meta.changes !== 1) throw new HttpError(409, 'Run changed. Reload to resume.', 'revision_conflict');
      const latest = await one(db, 'SELECT * FROM paixu_runs WHERE id=?', row.id);
      const visibleRun=await publicRun(db,latest,state);
      return json({ run: visibleRun, rankingEnabled: (await siteSettings(db)).rankingEnabled, submitted: results[1]?.meta.changes === 1 && visibleRun.scoreRecorded });
    }
    if (path === '/api/admin/setup' && request.method === 'GET') {
      await limit(db, 'adminstatus:' + ip, 60, 60000);
      const initialized = !!await one(db, "SELECT value FROM paixu_meta WHERE key='admin_key_hash'");
      return json({ initialized, setupAvailable: !initialized && validSetupKey(env.ADMIN_SETUP_KEY) });
    }
    if (path === '/api/admin/setup' && request.method === 'POST') {
      await limit(db, 'adminsetup:' + ip, 5, 900000);
      if (await one(db, "SELECT value FROM paixu_meta WHERE key='admin_key_hash'")) throw new HttpError(409, 'Administrator is already initialized. Sign in instead.', 'admin_already_initialized');
      if (!validSetupKey(env.ADMIN_SETUP_KEY)) throw new HttpError(503, 'Configure ADMIN_SETUP_KEY as a Secret of 32–256 non-whitespace characters, then deploy.', 'admin_setup_unavailable');
      const body = await jsonBody(request);
      if (!await verifySetupKey(body.setupKey, env.ADMIN_SETUP_KEY)) throw new HttpError(403, 'Invalid installation key', 'invalid_setup_key');
      if (!validNewPassword(body.newPassword)) throw new HttpError(400, 'Use a password of 12–128 characters', 'invalid_password');
      if (body.newPassword !== body.confirmPassword) throw new HttpError(400, 'New passwords do not match', 'password_mismatch');
      const hash = await hashPassword(body.newPassword);
      // The primary key makes initialization atomic, including against CLI initialization.
      const inserted = await run(db, "INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('admin_key_hash',?)", hash);
      if (inserted.meta.changes !== 1) throw new HttpError(409, 'Administrator is already initialized. Sign in instead.', 'admin_already_initialized');
      return json({ ok: true }, 201);
    }
    if (path === '/api/admin/login' && request.method === 'POST') {
      await limit(db, 'adminlogin:' + ip, 5, 900000); const body = await jsonBody(request);
      const stored = await one(db, "SELECT value FROM paixu_meta WHERE key='admin_key_hash'");
      if (!stored) throw new HttpError(503, 'Administrator is not initialized. Open /admin to set up.', 'admin_not_initialized');
      if (!await verifyPassword(body.key,stored.value)) throw new HttpError(401, 'Invalid administrator key', 'invalid_key');
      const key = token();
      const inserted=await run(db, "INSERT INTO paixu_admin_sessions(token_hash,expires_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM paixu_meta WHERE key='admin_key_hash' AND value=?)", await digest(key), now() + 86400000,stored.value);
      if(inserted.meta.changes!==1)throw new HttpError(401,'Invalid administrator key','invalid_key');
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, 'paixu_admin', key, 86400) });
    }
    if (path.startsWith('/api/admin/')) {
      await admin(request, db);
      if(path==='/api/admin/password' && request.method==='PUT') {
        await limit(db,'adminpassword:'+ip,5,900000);
        const body=await jsonBody(request);
        if(!validNewPassword(body.newPassword))throw new HttpError(400,'Use a password of 12–128 characters','invalid_password');
        if(body.newPassword!==body.confirmPassword)throw new HttpError(400,'New passwords do not match','password_mismatch');
        if(body.newPassword===body.currentPassword)throw new HttpError(400,'New password must differ from the current password','password_unchanged');
        const stored=await one(db,"SELECT value FROM paixu_meta WHERE key='admin_key_hash'");
        if(!stored || !await verifyPassword(body.currentPassword,stored.value))throw new HttpError(403,'Current administrator password is incorrect','invalid_current_password');
        const nextHash=await hashPassword(body.newPassword);
        const results=await db.batch([
          db.prepare("UPDATE paixu_meta SET value=? WHERE key='admin_key_hash' AND value=?").bind(nextHash,stored.value),
          db.prepare("DELETE FROM paixu_admin_sessions WHERE EXISTS(SELECT 1 FROM paixu_meta WHERE key='admin_key_hash' AND value=?)").bind(nextHash),
        ]);
        if(results[0].meta.changes!==1)throw new HttpError(409,'Administrator password changed. Log in again.','password_conflict');
        return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'paixu_admin','',0)});
      }
      if (path === '/api/admin/logout' && request.method === 'POST') { await jsonBody(request); await run(db, 'DELETE FROM paixu_admin_sessions WHERE token_hash=?', await digest(cookie(request, 'paixu_admin'))); return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, 'paixu_admin', '', 0) }); }
      if (path === '/api/admin/config' && request.method === 'GET') return json(await currentConfig(db));
      if (path === '/api/admin/config' && request.method === 'PUT') {
        const body = await jsonBody(request); let rules; try { rules = validateRules(body.rules); } catch (error) { throw new HttpError(400, error.message); }
        const current = await currentConfig(db); if (body.expectedVersion !== current.id) throw new HttpError(409, 'Configuration changed. Reload before saving.');
        const id = 'rules-' + crypto.randomUUID();
        const results = await db.batch([
          db.prepare("INSERT INTO paixu_configs(id,body,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM paixu_meta WHERE key='current_config' AND value=?)").bind(id, JSON.stringify(rules), now(), current.id),
          db.prepare("UPDATE paixu_meta SET value=? WHERE key='current_config' AND value=?").bind(id, current.id),
        ]);
        if (results[1].meta.changes !== 1) throw new HttpError(409, 'Configuration changed. Reload before saving.');
        return json({ id, rules });
      }
      if (path === '/api/admin/settings' && request.method === 'GET') return json({ ...await siteSettings(db), epochs: await rankingEpochs(db) });
      if (path === '/api/admin/settings' && request.method === 'PUT') return json({ ...await updateSiteSettings(db, await jsonBody(request)), epochs: await rankingEpochs(db) });
      if (path === '/api/admin/leaderboard/reset' && request.method === 'POST') return json(await resetLeaderboard(db, await jsonBody(request)));
      if (path === '/api/admin/usage' && request.method === 'GET') return json(await usageReport(env));
      if (path === '/api/admin/scores' && request.method === 'GET') {
        const difficulty = url.searchParams.get('difficulty') || 'all', view = url.searchParams.get('view') || 'all';
        if (difficulty !== 'all') { try { validateDifficulty(difficulty); } catch { throw new HttpError(400, 'Invalid difficulty'); } }
        if (!['current', 'archived', 'all'].includes(view)) throw new HttpError(400, 'Invalid score filter');
        const mode = url.searchParams.get('mode') || 'classic';
        let metric; try { metric=rankingFor(url.searchParams.get('metric') ?? undefined); } catch { throw new HttpError(400,'Invalid ranking metric','invalid_ranking_metric'); }
        if (mode !== 'all') { try { validateMode(mode); } catch { throw new HttpError(400, 'Invalid game mode'); } }
        const where = [mode === 'all' ? '1=1' : 's.mode=?', difficulty === 'all' ? '1=1' : 's.difficulty=?', view === 'current' ? 's.ranking_epoch=e.epoch' : view === 'archived' ? 's.ranking_epoch!=e.epoch' : '1=1'].join(' AND ');
        return json({ entries: await all(db, `SELECT s.*,s.ranking_epoch!=e.epoch AS archived FROM paixu_scores s JOIN paixu_mode_epochs e ON e.mode=s.mode AND e.difficulty=s.difficulty WHERE ${where} ORDER BY s.${metric.column} DESC,s.created_at ASC,s.run_id ASC LIMIT 100`, ...(mode === 'all' ? [] : [mode]), ...(difficulty === 'all' ? [] : [difficulty])), epochs: await rankingEpochs(db, mode) });
      }
      const scoreMatch = path.match(/^\/api\/admin\/scores\/([a-f0-9-]{36})$/);
      if (scoreMatch && request.method === 'PATCH') { const body = await jsonBody(request); if (typeof body.hidden !== 'boolean') throw new HttpError(400, 'Invalid visibility'); await db.batch([db.prepare('UPDATE paixu_scores SET hidden=? WHERE run_id=?').bind(body.hidden ? 1 : 0, scoreMatch[1]),pruneScoresStatement(db)]); return json({ ok: true }); }
    }
    throw new HttpError(404, 'API route not found');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('API internal error:', error.name, error.message);
    return json({ error: error instanceof HttpError ? error.message : 'Internal server error', code: error.code || 'internal_error' }, error.status || 500);
  }
}
