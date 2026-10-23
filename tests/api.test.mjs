import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../backend/sqlite.mjs';
import { handleApi, cleanup } from '../backend/api.js';
import { digest } from '../backend/security.js';
import { DEFAULT_RULES, validateRules } from '../rules.js';
import * as E from '../engine.js';
function setup(t) {
  const db = openDatabase(':memory:'); db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1 WHERE id=1').run(); t.after(() => db.close());
  const env = { DB: db, clientIp: '192.0.2.10' };
  const client = () => {
    let jar = '';
    return {
      get cookie() { return jar; },
      async request(route, method = 'GET', body, extra = {}) {
        const headers = { cookie: jar, 'user-agent': 'Integration Test Browser', ...extra };
        if (body !== undefined && !(body instanceof Uint8Array)) headers['content-type'] = 'application/json';
        const response = await handleApi(new Request('http://game.test' + route, { method, headers, ...(body !== undefined ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) } : {}) }), env);
        const cookie = response.headers.get('set-cookie'); if (cookie) { const name = cookie.split('=')[0]; jar = [...jar.split('; ').filter(c => c && !c.startsWith(name + '=')), cookie.split(';')[0]].join('; '); }
        const data = response.headers.get('content-type')?.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
        return { status: response.status, data, headers: response.headers };
      },
    };
  };
  return { db, env, client };
}
async function profile(client, name = 'Player') { return (await client.request('/api/profile', 'POST', { displayName: name })).data.profile; }
async function owner(db, client) { const key = 'synthetic-test-owner-key'; await db.prepare("INSERT INTO paixu_meta(key,value) VALUES('admin_key_hash',?)").bind(await digest(key)).run(); return client.request('/api/admin/login', 'POST', { key }); }

test('visitors need only a nickname, duplicate names have independent identities', async t => {
  const s = setup(t), a = s.client(), b = s.client();
  assert.equal((await a.request('/api/me')).data.profile, null);
  const av = await profile(a, '同名玩家'), bv = await profile(b, '同名玩家'); assert.notEqual(av.id, bv.id); assert.equal(av.displayName, bv.displayName);
  assert.match(a.cookie, /paixu_guest=/); assert.equal((await a.request('/api/me')).data.profile.id, av.id);
  assert.equal((await a.request('/api/profile', 'POST', { displayName: '<script>' })).status, 400);
});
test('cross-origin mutations, oversized JSON and anonymous ranked runs are rejected', async t => {
  const { client } = setup(t), c = client();
  assert.equal((await c.request('/api/runs', 'POST', {})).status, 401);
  assert.equal((await c.request('/api/profile', 'POST', { displayName: 'CSRF' }, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await c.request('/api/profile', 'POST', { displayName: 'a'.repeat(9000) })).status, 413);
});
test('ranked state reveals neither random generator nor future draw order', async t => {
  const { client } = setup(t), c = client(); await profile(c);
  const created = (await c.request('/api/runs', 'POST', { score: 9999999, seed: 'ATTACKER' })).data.run;
  assert.equal(created.state.seed, 'SERVER'); assert.equal(created.state.rng, undefined); assert.equal(created.state.serverEntropy, undefined);
  const started = (await c.request(`/api/runs/${created.id}/actions`, 'POST', { revision: 0, action: 'start' })).data.run;
  assert.equal(started.state.hand.length, 8); assert.equal(started.state.drawPile.length, 44); assert.ok(started.state.drawPile.every(id => id === null));
});
test('ownership, revision checks and card selection prevent score injection and replay', async t => {
  const { client } = setup(t), a = client(), b = client(); await profile(a); await profile(b);
  const r = (await a.request('/api/runs', 'POST', {})).data.run;
  assert.equal((await b.request(`/api/runs/${r.id}`)).status, 404);
  const start = (await a.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 0, action: 'start' })).data.run;
  assert.equal((await a.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 0, action: 'skip' })).status, 409);
  assert.equal((await a.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 1, action: 'play', cards: ['FORGED'] })).status, 400);
  const id = start.state.hand[0];
  assert.equal((await a.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 1, action: 'play', cards: [id, id] })).status, 400);
  const played = (await a.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 1, action: 'play', cards: [id], score: 1e12, money: 1e9 })).data.run;
  assert.ok(played.state.bestHand < 100); assert.equal(played.state.money, 4); assert.equal(played.revision, 2);
  const restored = (await a.request(`/api/runs/${r.id}`)).data.run; assert.equal(restored.state.bestHand, played.state.bestHand); assert.equal(restored.revision, 2);
});
test('final scores are written once, expose only public fields, and retain private admin metadata', async t => {
  const s = setup(t), c = s.client(); await profile(c, 'Scorer'); const r = (await c.request('/api/runs', 'POST', {})).data.run;
  const started = (await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 0, action: 'start' })).data.run;
  await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 1, action: 'play', cards: [started.state.hand[0]] });
  const runCreatedAt = Date.now() - 125000;
  await s.db.prepare('UPDATE paixu_runs SET created_at=? WHERE id=?').bind(runCreatedAt, r.id).run();
  assert.equal((await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 2, action: 'finish', score: 1e20 })).data.submitted, true);
  assert.equal((await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 2, action: 'finish' })).status, 409);
  const board = (await c.request('/api/leaderboard')).data; assert.equal(board.entries.length, 1); assert.equal(board.entries[0].displayName, 'Scorer');
  assert.equal(board.entries[0].durationMs, board.entries[0].createdAt - runCreatedAt);
  assert.ok(!JSON.stringify(board).includes('192.0.2.10')); assert.ok(!JSON.stringify(board).includes('Integration Test Browser'));
  await owner(s.db, c); const privateRows = (await c.request('/api/admin/scores')).data.entries;
  assert.equal(privateRows[0].ip, '192.0.2.10'); assert.equal(privateRows[0].browser, 'Integration Test Browser');
  await c.request(`/api/admin/scores/${r.id}`, 'PATCH', { hidden: true }); assert.equal((await c.request('/api/leaderboard')).data.entries.length, 0);
  await c.request(`/api/admin/scores/${r.id}`, 'PATCH', { hidden: false }); assert.equal((await c.request('/api/leaderboard')).data.entries.length, 1);
});
test('admin sessions are HTTP-only, protected, revocable and never return the stored key digest', async t => {
  const s = setup(t), c = s.client(); assert.equal((await c.request('/api/admin/config')).status, 401);
  const login = await owner(s.db, c); assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await c.request('/api/admin/config')).status, 200);
  assert.equal((await c.request('/api/admin/key')).status, 404);
  await c.request('/api/admin/logout', 'POST', {}); assert.equal((await c.request('/api/admin/config')).status, 401);
});
test('admin brute force is rate limited across independent requests', async t => {
  const s = setup(t), c = s.client(); await s.db.prepare("INSERT INTO paixu_meta(key,value) VALUES('admin_key_hash',?)").bind(await digest('test')).run();
  for (let i = 0; i < 5; i++) assert.equal((await c.request('/api/admin/login', 'POST', { key: 'wrong' })).status, 401);
  assert.equal((await c.request('/api/admin/login', 'POST', { key: 'wrong' })).status, 429);
});
test('rule snapshots remain fixed and new rules create independent leaderboard versions', async t => {
  const s = setup(t), c = s.client(); await profile(c); await owner(s.db, c);
  const original = (await c.request('/api/runs', 'POST', {})).data.run; const config = (await c.request('/api/admin/config')).data;
  const next = await c.request('/api/admin/config', 'PUT', { expectedVersion: config.id, rules: { ...config.rules, startingMoney: 25, rareWeight: 100 } }); assert.equal(next.status, 200);
  assert.equal((await c.request(`/api/runs/${original.id}`)).data.run.state.money, 4);
  const fresh = (await c.request('/api/runs', 'POST', {})).data.run; assert.equal(fresh.state.money, 25); assert.notEqual(fresh.configVersion, original.configVersion);
  assert.equal((await c.request('/api/admin/config', 'PUT', { expectedVersion: config.id, rules: DEFAULT_RULES })).status, 409);
  assert.equal((await c.request('/api/admin/config', 'PUT', { expectedVersion: next.data.id, rules: { hands: 100 } })).status, 400);
});
test('default player names are generated, stable, editable, and contain no avatar fields', async t => {
  const {client,db}=setup(t), a=client(), b=client();
  const first=await a.request('/api/profile','POST',{});
  assert.equal(first.status,200);assert.match(first.data.profile.displayName,/^牌友-[A-F0-9]{8}$/);
  assert.deepEqual(Object.keys(first.data.profile).sort(),['displayName','id']);
  assert.deepEqual((await a.request('/api/profile','POST',{})).data.profile,first.data.profile);
  assert.deepEqual((await a.request('/api/me')).data.profile,first.data.profile);
  const second=(await b.request('/api/profile','POST',{})).data.profile;assert.notEqual(first.data.profile.id,second.id);
  assert.equal((await a.request('/api/profile','POST',{displayName:'新牌友'})).data.profile.displayName,'新牌友');
  assert.equal((await a.request('/api/profile/avatar','PUT',{})).status,404);
  const columns=(await db.prepare('PRAGMA table_info(paixu_players)').all()).results.map(c=>c.name);
  assert.ok(!columns.some(c=>c.includes('avatar')));
});
test('bounded rules change actual gameplay, rarity weights and shop prices', () => {
  assert.throws(() => validateRules({ rareWeight: NaN })); assert.throws(() => validateRules({ hands: 1.5 })); assert.throws(() => validateRules({ commonWeight: 0, uncommonWeight: 0, rareWeight: 0 }));
  const s = E.newRun('CUSTOM', { ...DEFAULT_RULES, hands: 2, discards: 1, handSize: 6, startingMoney: 10, targetScale: .5, skipReward: 8, commonWeight: 0, uncommonWeight: 0, rareWeight: 100, priceScale: 2 });
  assert.equal(s.money, 10); assert.equal(E.targetFor(s), 150); E.startBlind(s); assert.equal(s.hands, 2); assert.equal(s.discards, 1); assert.equal(s.hand.length, 6);
  for (let i = 0; i < 20; i++) assert.equal(E.shopItem('joker', s).id, 'banana');
  assert.equal(E.itemInfo({ type: 'joker', id: 'joker' }, s).price, 4);
  assert.equal(E.jokerSellPrice(s, 'joker'), 2);
  const cheap = E.newRun('CHEAP', { ...DEFAULT_RULES, priceScale: .25 }); cheap.jokers = [{ id: 'banana' }]; const before = cheap.money;
  E.sellJoker(cheap, 0); assert.equal(cheap.money - before, 1);
});
test('scheduled cleanup removes expired private metadata without deleting public scores', async t => {
  const s = setup(t), c = s.client(); await profile(c); const r = (await c.request('/api/runs', 'POST', {})).data.run;
  const start = (await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 0, action: 'start' })).data.run;
  await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 1, action: 'play', cards: [start.state.hand[0]] });
  await c.request(`/api/runs/${r.id}/actions`, 'POST', { revision: 2, action: 'finish' });
  const old = Date.now() - 31 * 86400000;
  await s.db.prepare('UPDATE paixu_scores SET created_at=?').bind(old).run(); await s.db.prepare('UPDATE paixu_runs SET updated_at=?').bind(old).run();
  await cleanup(s.db);
  assert.equal((await s.db.prepare('SELECT COUNT(*) AS n FROM paixu_runs').first()).n, 0);
  const score = await s.db.prepare('SELECT * FROM paixu_scores').first(); assert.equal(score.ip, ''); assert.equal(score.browser, ''); assert.ok(score.best_hand > 0);
});
test('owner installation displays a random key only once and reset revokes sessions', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paixu-install-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'game.sqlite'); const opts = { cwd: new URL('../', import.meta.url), env: { ...process.env, DB_PATH: filename }, encoding: 'utf8' };
  const first = execFileSync(process.execPath, ['scripts/admin.mjs', 'init'], opts); const key = first.match(/paixu_[a-f0-9]{64}/)?.[0]; assert.ok(key);
  const second = execFileSync(process.execPath, ['scripts/admin.mjs', 'init'], opts); assert.ok(!second.includes(key)); assert.match(second, /already initialized/);
  const db = openDatabase(filename); const stored = await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first(); assert.equal(stored.value, await digest(key));
  await db.prepare('INSERT INTO paixu_admin_sessions VALUES(?,?)').bind('test-session', Date.now() + 1000).run(); db.close();
  const reset = execFileSync(process.execPath, ['scripts/admin.mjs', 'reset'], opts); assert.ok(!reset.includes(key));
  const check = openDatabase(filename); assert.equal((await check.prepare('SELECT COUNT(*) AS count FROM paixu_admin_sessions').first()).count, 0); check.close();
});

test('ranked difficulty is validated, snapshotted by the server, and cannot be changed by action payloads', async t => {
  const s = setup(t), c = s.client(); await profile(c);
  for (const difficulty of ['unknown', null, '', {}, 1]) assert.equal((await c.request('/api/runs', 'POST', { difficulty })).status, 400);
  const created = (await c.request('/api/runs', 'POST', { difficulty: 'easy', rules: { targetScale: .1 }, difficultyRules: { targetGrowth: 0 } })).data.run;
  assert.equal(created.state.difficulty, 'easy'); assert.equal(E.targetFor(created.state), 210); assert.equal(created.state.money, 8); assert.deepEqual(created.state.jokers, [{ id: 'joker' }]);
  const start = (await c.request(`/api/runs/${created.id}/actions`, 'POST', { revision: 0, action: 'start', difficulty: 'nightmare' })).data.run;
  assert.equal(start.state.difficulty, 'easy'); assert.equal(start.state.hands, 5);
  const restored = (await c.request(`/api/runs/${created.id}`)).data.run;
  assert.deepEqual(restored.state.difficultyRules, { targetGrowth: 1 }); assert.equal(restored.state.difficulty, 'easy');
});
test('each difficulty has independent all-time and daily ranks, still separated by rules version', async t => {
  const s = setup(t), c = s.client(); await profile(c, 'Difficulty scorer');
  const ids = {};
  for (const difficulty of ['easy', 'medium', 'hard', 'nightmare']) {
    const created = (await c.request('/api/runs', 'POST', { difficulty })).data.run; ids[difficulty] = created.id;
    const start = (await c.request(`/api/runs/${created.id}/actions`, 'POST', { revision: 0, action: 'start' })).data.run;
    const played = (await c.request(`/api/runs/${created.id}/actions`, 'POST', { revision: 1, action: 'play', cards: [start.state.hand[0]], difficulty: 'easy' })).data.run;
    assert.equal(played.state.difficulty, difficulty);
    const finish = await c.request(`/api/runs/${created.id}/actions`, 'POST', { revision: 2, action: 'finish', difficulty: 'easy' });
    assert.equal(finish.data.submitted, true);
  }
  for (const difficulty of Object.keys(ids)) {
    for (const period of ['all', 'daily']) {
      const board = (await c.request(`/api/leaderboard?difficulty=${difficulty}&period=${period}`)).data;
      assert.equal(board.difficulty, difficulty); assert.equal(board.entries.length, 1); assert.equal(board.entries[0].rank, 1); assert.equal(board.entries[0].difficulty, difficulty); assert.equal(board.entries[0].runId, ids[difficulty]);
    }
    assert.equal((await c.request(`/api/leaderboard?difficulty=${difficulty}&version=another-version`)).data.entries.length, 0);
  }
  assert.equal((await c.request('/api/leaderboard')).data.entries[0].runId, ids.medium);
  assert.equal((await c.request('/api/leaderboard?difficulty=invalid')).status, 400);
  // Existing scores and active games without a difficulty remain medium.
  const legacy = (await c.request('/api/runs', 'POST', {})).data.run;
  const stored = JSON.parse((await s.db.prepare('SELECT state FROM paixu_runs WHERE id=?').bind(legacy.id).first()).state); delete stored.difficulty; delete stored.difficultyRules; stored.bestHand = 42; stored.totalScore = 42;
  await s.db.prepare('UPDATE paixu_runs SET state=? WHERE id=?').bind(JSON.stringify(stored), legacy.id).run();
  await c.request(`/api/runs/${legacy.id}/actions`, 'POST', { revision: 0, action: 'finish', difficulty: 'nightmare' });
  assert.equal((await c.request('/api/leaderboard')).data.entries.length, 2);
  assert.equal((await c.request('/api/leaderboard?difficulty=nightmare')).data.entries.length, 1);
});

test('fresh installs disable rankings and do not require or create an identity', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const request = async (route, method = 'GET', body) => handleApi(new Request('https://fresh.test' + route, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), { DB: db });
  assert.equal((await (await request('/api/config')).json()).rankingEnabled, false);
  for (const [route, method, body] of [['/api/leaderboard','GET'],['/api/profile','POST',{displayName:'Unneeded'}],['/api/runs','POST',{}]]) assert.equal((await request(route, method, body)).status, 403);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM paixu_players').first()).n, 0);
  assert.equal((await (await request('/api/config')).json()).rankingEnabled, false);
});
test('ranking settings and usage are owner-only and reject stale writes', async t => {
  const s = setup(t), c = s.client();
  for (const path of ['/api/admin/settings','/api/admin/usage']) assert.equal((await c.request(path)).status, 401);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:false,expectedRevision:0})).status, 401);
  assert.equal((await c.request('/api/admin/leaderboard/reset','POST',{})).status, 401);
  await owner(s.db,c); const settings = (await c.request('/api/admin/settings')).data;
  assert.equal(settings.rankingEnabled,true); assert.equal(settings.epochs.medium,1);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:'false',expectedRevision:0})).status,400);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:false,expectedRevision:0})).status,200);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:true,expectedRevision:0})).status,409);
  assert.equal((await c.request('/api/config')).data.rankingEnabled,false);
});
test('disabling ranking preserves games and scores, blocks new identities and permanently disqualifies active runs', async t => {
  const s = setup(t), c = s.client(); await profile(c); await owner(s.db,c);
  const r = (await c.request('/api/runs','POST',{})).data.run;
  const start = (await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'start'})).data.run;
  await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]]});
  await c.request('/api/admin/settings','PUT',{rankingEnabled:false,expectedRevision:0});
  assert.equal((await c.request('/api/runs','POST',{})).data.code,'ranking_disabled');
  assert.equal((await c.request('/api/profile','POST',{displayName:'Cannot change'})).status,403);
  assert.equal((await c.request(`/api/runs/${r.id}`)).data.run.eligible,false);
  const continued = await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'discard',cards:[(await c.request(`/api/runs/${r.id}`)).data.run.state.hand[0]]});
  assert.equal(continued.status,200); assert.equal(continued.data.rankingEnabled,false);
  await c.request('/api/admin/settings','PUT',{rankingEnabled:true,expectedRevision:1});
  const end = await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:3,action:'finish',ranking_epoch:1});
  assert.equal(end.data.submitted,false); assert.equal(end.data.run.eligible,false); assert.equal((await c.request('/api/leaderboard')).data.entries.length,0);
});
test('difficulty resets archive scores, leave other boards intact, and exclude old in-flight runs', async t => {
  const s=setup(t), a=s.client(), b=s.client(); await profile(a,'Old scorer'); await profile(b,'In flight'); await owner(s.db,a);
  async function play(c,difficulty) { const r=(await c.request('/api/runs','POST',{difficulty})).data.run; const start=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'start'})).data.run; await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]]}); return r; }
  const easy=await play(a,'easy'); await a.request(`/api/runs/${easy.id}/actions`,'POST',{revision:2,action:'finish'});
  const medium=await play(a,'medium'); await a.request(`/api/runs/${medium.id}/actions`,'POST',{revision:2,action:'finish'});
  const active=await play(b,'easy'); const before=(await a.request('/api/admin/settings')).data;
  const reset=await a.request('/api/admin/leaderboard/reset','POST',{difficulty:'easy',epochs:before.epochs}); assert.equal(reset.status,200);
  assert.equal((await a.request('/api/leaderboard?difficulty=easy')).data.entries.length,0); assert.equal((await a.request('/api/leaderboard')).data.entries.length,1);
  assert.equal((await b.request(`/api/runs/${active.id}/actions`,'POST',{revision:2,action:'finish',ranking_epoch:2})).data.submitted,false);
  const archived=(await a.request('/api/admin/scores?view=archived&difficulty=easy')).data.entries;
  assert.equal(archived.length,1); assert.equal(archived[0].run_id,easy.id); assert.equal(archived[0].archived,1);
  assert.equal((await a.request('/api/admin/leaderboard/reset','POST',{difficulty:'all',epochs:before.epochs})).status,409);
  assert.deepEqual((await a.request('/api/admin/settings')).data.epochs,reset.data.epochs);
  const fresh=await play(b,'easy'); assert.equal((await b.request(`/api/runs/${fresh.id}/actions`,'POST',{revision:2,action:'finish'})).data.submitted,true);
  assert.equal((await b.request('/api/leaderboard?difficulty=easy')).data.entries.length,1);
});
test('all-difficulty clearing is atomic and score filtering validates scope', async t => {
  const s=setup(t), c=s.client(); await owner(s.db,c); const site=(await c.request('/api/admin/settings')).data;
  const result=await c.request('/api/admin/leaderboard/reset','POST',{difficulty:'all',epochs:site.epochs}); assert.equal(result.status,200); assert.ok(Object.values(result.data.epochs).every(n=>n===2));
  assert.equal((await c.request('/api/admin/scores?difficulty=oops')).status,400); assert.equal((await c.request('/api/admin/scores?view=oops')).status,400);
  assert.equal((await c.request('/api/admin/leaderboard/reset','POST',{difficulty:'oops',epochs:site.epochs})).status,400);
});

test('switching rankings off never deletes published scores and current runs remain private', async t => {
  const s=setup(t), c=s.client(); await profile(c); await owner(s.db,c);
  const run=(await c.request('/api/runs','POST',{})).data.run;
  const start=(await c.request(`/api/runs/${run.id}/actions`,'POST',{revision:0,action:'start'})).data.run;
  await c.request(`/api/runs/${run.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]]});
  await c.request(`/api/runs/${run.id}/actions`,'POST',{revision:2,action:'finish'});
  await c.request('/api/admin/settings','PUT',{rankingEnabled:false,expectedRevision:0});
  assert.equal((await c.request('/api/leaderboard')).status,403); assert.equal((await s.db.prepare('SELECT COUNT(*) AS n FROM paixu_scores').first()).n,1);
  await c.request('/api/admin/settings','PUT',{rankingEnabled:true,expectedRevision:1}); assert.equal((await c.request('/api/leaderboard')).data.entries.length,1);
});

test('every mode/difficulty has independent ranks and rejects mode changes in action payloads', async t => {
  const s=setup(t), c=s.client(); await profile(c, 'Mode scorer'); const ids={};
  for (const mode of ['classic','six-seat','quick']) for (const difficulty of ['easy','medium','hard','nightmare']) {
    const r=(await c.request('/api/runs','POST',{mode,difficulty,modeRules:{antes:1}})).data.run;
    assert.equal(r.state.mode,mode); assert.equal(r.state.modeRules.antes,{classic:8,'six-seat':5,quick:3}[mode]);
    const start=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'start',mode:'classic'})).data.run;
    const play=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]],mode:'classic',modeRules:{targets:[1]}})).data.run;
    assert.equal(play.state.mode,mode); assert.deepEqual(play.state.modeRules,r.state.modeRules);
    assert.equal((await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'finish'})).data.submitted,true);
    ids[mode+':'+difficulty]=r.id;
  }
  for (const [key,id] of Object.entries(ids)) {
    const [mode,difficulty]=key.split(':');
    for (const period of ['all','daily']) {
      const board=(await c.request(`/api/leaderboard?mode=${mode}&difficulty=${difficulty}&period=${period}`)).data;
      assert.equal(board.mode,mode); assert.equal(board.entries.length,1); assert.equal(board.entries[0].runId,id); assert.equal(board.entries[0].rank,1);
    }
  }
  assert.equal((await c.request('/api/leaderboard')).data.entries[0].runId,ids['classic:medium']);
  for (const mode of ['invalid',null,'',{},1]) assert.equal((await c.request('/api/runs','POST',{mode})).status,400);
  assert.equal((await c.request('/api/leaderboard?mode=invalid')).status,400);
});

test('clearing a mode archives only that mode and disqualifies only its old in-flight runs', async t => {
  const s=setup(t), c=s.client(), inFlight=s.client(); await profile(c); await profile(inFlight,'Still playing'); await owner(s.db,c);
  async function play(client,mode) {
    const r=(await client.request('/api/runs','POST',{mode})).data.run;
    const start=(await client.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'start'})).data.run;
    await client.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]]}); return r;
  }
  for(const mode of ['classic','six-seat','quick']) { const r=await play(c,mode); await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'finish'}); }
  const old=await play(inFlight,'six-seat');
  const scores=(await c.request('/api/admin/scores?mode=six-seat')).data;
  const reset=await c.request('/api/admin/leaderboard/reset','POST',{mode:'six-seat',difficulty:'all',epochs:scores.epochs}); assert.equal(reset.status,200);
  assert.equal((await c.request('/api/leaderboard?mode=six-seat')).data.entries.length,0);
  assert.equal((await c.request('/api/leaderboard?mode=classic')).data.entries.length,1);
  assert.equal((await c.request('/api/leaderboard?mode=quick')).data.entries.length,1);
  assert.equal((await inFlight.request(`/api/runs/${old.id}/actions`,'POST',{revision:2,action:'finish',mode:'classic'})).data.submitted,false);
  assert.equal((await c.request('/api/admin/scores?mode=six-seat&view=archived')).data.entries.length,1);
  const before=(await c.request('/api/admin/scores?mode=all')).data.epochs;
  assert.equal(Object.keys(before).length,12);
  const stale={...before,'classic:medium':99};
  assert.equal((await c.request('/api/admin/leaderboard/reset','POST',{mode:'all',difficulty:'all',epochs:stale})).status,409);
  assert.deepEqual((await c.request('/api/admin/scores?mode=all')).data.epochs,before);
  const all=await c.request('/api/admin/leaderboard/reset','POST',{mode:'all',difficulty:'all',epochs:before}); assert.equal(all.status,200);
  for(const key of Object.keys(before)) assert.equal(all.data.epochs[key],before[key]+1);
});

test('network details are server snapshots, public summaries are masked, and geo expires with IP metadata', async t => {
  const s=setup(t), c=s.client(); s.env.clientRegion={country:'CN',region:'Guangdong'}; await profile(c);
  const r=(await c.request('/api/runs','POST',{}, {'user-agent':'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36','cf-ipcountry':'US','x-region':'Spoofed'})).data.run;
  s.env.clientRegion={country:'GB',region:'England'};
  const start=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'start'})).data.run;
  await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'play',cards:[start.state.hand[0]]});
  await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'finish'});
  const board=(await c.request('/api/leaderboard')).data, network=board.entries[0].network;
  assert.deepEqual(network,{ip:'192.0.*.*',browser:'Chrome 140',country:'CN',region:'Guangdong'});
  assert.doesNotMatch(JSON.stringify(board),/192\.0\.2\.10|Mozilla|Spoofed/);
  await owner(s.db,c); const admin=(await c.request('/api/admin/scores')).data.entries[0];
  assert.equal(admin.ip,'192.0.2.10'); assert.match(admin.browser,/Mozilla/); assert.equal(admin.region,'Guangdong');
  await s.db.prepare('UPDATE paixu_scores SET created_at=?').bind(Date.now()-31*86400000).run(); await cleanup(s.db);
  const old=(await c.request('/api/leaderboard')).data.entries[0].network;
  assert.deepEqual(old,{ip:'',browser:'',country:'',region:''});
});

test('ranked document mode supports the sixth joker, validates slot limits and ignores injected card sets',async t=>{
 const s=setup(t),c=s.client();await profile(c,'Six slots');
 const r=(await c.request('/api/runs','POST',{mode:'six-seat',jokers:[{id:'banana'}],jokerSet:'forged'})).data.run;
 assert.equal(r.state.modeRules.jokerSet,'six-seat-v1');assert.deepEqual(r.state.jokers,[]);
 const saved=JSON.parse((await s.db.prepare('SELECT state FROM paixu_runs WHERE id=?').bind(r.id).first()).state);
 saved.phase='shop';saved.money=100;saved.jokers=['joker','scary','smiley','green','banner'].map(id=>({id:'ss-'+id,value:0}));saved.shop={items:[{type:'joker',id:'ss-blue'},{type:'joker',id:'ss-order'}],pack:null};
 await s.db.prepare('UPDATE paixu_runs SET state=? WHERE id=?').bind(JSON.stringify(saved),r.id).run();
 const six=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'buy',index:0})).data.run;assert.equal(six.state.jokers.length,6);
 assert.equal((await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'buy',index:1})).status,400);
 const moved=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'move-left',index:5})).data.run;assert.equal(moved.state.jokers[4].id,'ss-blue');
 const sold=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'sell',index:5})).data.run;assert.equal(sold.state.jokers.length,5);
});

test('ranked Six-seat enforces joker-only economy and server-owned target snapshots',async t=>{
 const s=setup(t),c=s.client();await profile(c,'Joker economy');
 const r=(await c.request('/api/runs','POST',{mode:'six-seat',difficulty:'hard',modeRules:{jokersOnly:false,targets:[1]}})).data.run;
 assert.equal(r.state.modeRules.jokersOnly,true);assert.deepEqual(r.state.modeRules.targets,[250,750,2000,5000,12000]);assert.equal(r.state.difficultyRules.targetGrowth,1.04);
 const saved=JSON.parse((await s.db.prepare('SELECT state FROM paixu_runs WHERE id=?').bind(r.id).first()).state);
 saved.phase='shop';saved.money=100;E.createShop(saved);saved.consumables=['hermit'];saved.shop.voucher='hand';saved.shop.items[0]={type:'planet',id:'pair'};
 await s.db.prepare('UPDATE paixu_runs SET state=? WHERE id=?').bind(JSON.stringify(saved),r.id).run();
 for(const action of [{action:'buy',index:0},{action:'voucher'},{action:'use-tarot',index:0},{action:'sell-tarot',index:0}]){
  assert.equal((await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,...action})).status,400);
 }
 const rerolled=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:0,action:'reroll'})).data.run;
 assert.equal(rerolled.state.money,95);assert.equal(rerolled.state.shop.items.length,3);assert.ok(rerolled.state.shop.items.every(item=>item.type==='joker'));
 const pack=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:1,action:'booster'})).data.run;
 assert.equal(pack.state.shop.pack.length,3);assert.equal(pack.state.money,89);
 const picked=(await c.request(`/api/runs/${r.id}/actions`,'POST',{revision:2,action:'pack-pick',index:1})).data.run;
 assert.equal(picked.state.jokers.length,1);assert.equal(picked.state.shop.pack,null);
});

test('privacy cleanup redacts runs outside the bounded deletion batch and long-lived active runs',async t=>{
 const s=setup(t),old=Date.now()-31*86400000;
 const statement=s.db.prepare("INSERT INTO paixu_runs(id,player_id,state,config_version,status,created_at,updated_at,ip,browser,country,region) VALUES(?,'fixture','{}','default-v1',?,?,?,'192.0.2.1','Private UA','CN','Region')");
 for(let i=0;i<105;i++)await statement.bind('old-'+i,'finished',old,old).run();
 await statement.bind('long-active','active',old,Date.now()).run();await cleanup(s.db);
 const remaining=(await s.db.prepare('SELECT * FROM paixu_runs').all()).results;assert.equal(remaining.length,6);
 for(const row of remaining)for(const field of ['ip','browser','country','region'])assert.equal(row[field],'');
});
test('finishing a long-lived run never renews expired network metadata in its score',async t=>{
 const s=setup(t),c=s.client();await profile(c);const run=(await c.request('/api/runs','POST',{})).data.run;
 const state=E.newRun('long-lived-fixture');state.bestHand=100;state.totalScore=100;state.round=2;
 await s.db.prepare("UPDATE paixu_runs SET created_at=?,state=?,country='CN',region='Region' WHERE id=?").bind(Date.now()-31*86400000,JSON.stringify(state),run.id).run();
 const finished=await c.request(`/api/runs/${run.id}/actions`,'POST',{revision:0,action:'finish'});assert.equal(finished.status,200);assert.equal(finished.data.submitted,true);
 const score=await s.db.prepare('SELECT * FROM paixu_scores WHERE run_id=?').bind(run.id).first();for(const field of ['ip','browser','country','region'])assert.equal(score[field],'');
});
