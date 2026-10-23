import { DIFFICULTIES, validateDifficulty } from '../rules.js';
import { MODES, validateMode } from '../modes.js';
import { HttpError } from './security.js';
import { MAX_RANKING_LIMIT } from '../rankings.js';
import { pruneScoresStatement } from './leaderboard.js';

export async function siteSettings(db) {
  const row = await db.prepare('SELECT * FROM paixu_site_settings WHERE id=1').first();
  return { rankingEnabled: !!row.ranking_enabled, rankingLimit: row.ranking_limit, revision: row.revision, updatedAt: row.updated_at };
}
export async function rankingEpochs(db, mode = 'classic') {
  const rows = (await db.prepare('SELECT mode,difficulty,epoch FROM paixu_mode_epochs').all()).results;
  return Object.fromEntries(rows.filter(row => mode === 'all' || row.mode === mode).map(row => [mode === 'all' ? `${row.mode}:${row.difficulty}` : row.difficulty, row.epoch]));
}
export async function updateSiteSettings(db, input) {
  if (typeof input.rankingEnabled !== 'boolean' || !Number.isInteger(input.expectedRevision)) throw new HttpError(400, 'Invalid site settings');
  const current=await siteSettings(db),rankingLimit=input.rankingLimit??current.rankingLimit;
  if(!Number.isInteger(rankingLimit)||rankingLimit<1||rankingLimit>MAX_RANKING_LIMIT)throw new HttpError(400,'Invalid leaderboard limit','invalid_ranking_limit');
  const at = Date.now(), enabled = Number(input.rankingEnabled);
  const statements = [db.prepare('UPDATE paixu_site_settings SET ranking_enabled=?,ranking_limit=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').bind(enabled, rankingLimit, at, input.expectedRevision)];
  // A run that was active while rankings were switched off can continue, but never ranks again.
  if (!enabled) statements.push(db.prepare("UPDATE paixu_runs SET ranking_epoch=0 WHERE status='active' AND EXISTS(SELECT 1 FROM paixu_site_settings WHERE id=1 AND ranking_enabled=0 AND revision=?)").bind(input.expectedRevision + 1));
  if(rankingLimit!==current.rankingLimit)statements.push(pruneScoresStatement(db,undefined,input.expectedRevision+1));
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'Settings changed. Reload before saving.');
  return siteSettings(db);
}
export async function resetLeaderboard(db, input) {
  let difficulties, modes;
  const mode = input.mode ?? 'classic';
  try {
    difficulties = input.difficulty === 'all' ? DIFFICULTIES.map(d => d.id) : [validateDifficulty(input.difficulty)];
    modes = mode === 'all' ? MODES.map(m => m.id) : [validateMode(mode)];
  } catch { throw new HttpError(400, 'Invalid score filter'); }
  const pairs = modes.flatMap(m => difficulties.map(d => ({ m, d, key: mode === 'all' ? `${m}:${d}` : d })));
  if (!input.epochs || pairs.some(p => !Number.isInteger(input.epochs[p.key]) || input.epochs[p.key] < 1)) throw new HttpError(400, 'Invalid season');
  const predicates = pairs.map(() => '(mode=? AND difficulty=? AND epoch=?)').join(' OR ');
  const args = pairs.flatMap(p => [p.m, p.d, input.epochs[p.key]]);
  // A single statement checks and advances all selected mode/difficulty seasons atomically.
  const selected = pairs.map(() => '(mode=? AND difficulty=?)').join(' OR ');
  const result = await db.prepare(`UPDATE paixu_mode_epochs SET epoch=epoch+1 WHERE (${selected}) AND (SELECT COUNT(*) FROM paixu_mode_epochs WHERE ${predicates})=?`).bind(...pairs.flatMap(p => [p.m, p.d]), ...args, pairs.length).run();
  if (result.meta.changes !== pairs.length) throw new HttpError(409, 'Season changed. Reload before clearing.');
  return { epochs: await rankingEpochs(db, mode) };
}

export async function requireRanking(db) {
  if (!(await siteSettings(db)).rankingEnabled) throw new HttpError(403, 'Rankings are disabled', 'ranking_disabled');
}
