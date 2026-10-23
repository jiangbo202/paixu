import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/sqlite.mjs';
import { handleApi } from '../backend/api.js';
import worker from '../worker.js';
import { digest, verifyPassword } from '../backend/security.js';

const setupKey = 'synthetic-installation-key-for-tests-only-123456';
const password = 'synthetic-admin-password-12345';
function fixture(t, key = setupKey) {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const env = { DB: db, ADMIN_SETUP_KEY: key, clientIp: '192.0.2.20' };
  async function request(route = '/api/admin/setup', method = 'GET', body, headers = {}, extra = {}) {
    const req = new Request('https://game.test' + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await handleApi(req, { ...env, ...extra });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const install = (body = {}, extra = {}) => request('/api/admin/setup', 'POST', { setupKey, newPassword: password, confirmPassword: password, ...body }, {}, extra);
  return { db, env, request, install };
}
test('web setup is closed without a valid owner-configured secret and reveals only status', async t => {
  for (const key of [undefined, '', 'short-key', 'x'.repeat(257), ' '.repeat(32), 'x'.repeat(32) + '\n']) {
    const f = fixture(t, key); f.env.ADMIN_SETUP_KEY = key;
    const status = await f.request();
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(status.data, { initialized: false, setupAvailable: false });
    assert.equal((await f.install()).data.code, 'admin_setup_unavailable');
    assert.equal(await f.db.prepare("SELECT * FROM paixu_meta WHERE key='admin_key_hash'").first(), null);
  }
});
test('valid installation creates a salted verifier once, then password login works without the secret', async t => {
  const f = fixture(t);
  assert.deepEqual((await f.request()).data, { initialized: false, setupAvailable: true });
  const installed = await f.install(); assert.equal(installed.status, 201);
  assert.deepEqual(installed.data, { ok: true });
  assert.equal(installed.headers.get('set-cookie'), null);
  const stored = await f.db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first();
  assert.match(stored.value, /^pbkdf2-sha256\$/); assert.ok(await verifyPassword(password, stored.value));
  assert.notEqual(stored.value, await digest(password));
  assert.deepEqual((await f.request()).data, { initialized: true, setupAvailable: false });
  f.env.ADMIN_SETUP_KEY = undefined;
  const login = await f.request('/api/admin/login', 'POST', { key: password });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict.*Secure/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/admin/config', 'GET', undefined, { cookie })).status, 200);
  assert.equal((await f.install()).status, 409);
  const allMeta = JSON.stringify((await f.db.prepare('SELECT * FROM paixu_meta').all()).results);
  assert.ok(!allMeta.includes(setupKey)); assert.ok(!allMeta.includes(password));
});
test('wrong/missing keys, invalid passwords and mismatch never initialize an administrator', async t => {
  const f = fixture(t);
  for (const body of [{ setupKey: undefined }, { setupKey: 'x'.repeat(setupKey.length) }]) {
    const result = await f.install(body); assert.equal(result.status, 403); assert.equal(result.data.code, 'invalid_setup_key');
    assert.ok(!JSON.stringify(result.data).includes(setupKey));
  }
  assert.equal((await f.install({ newPassword: 'short', confirmPassword: 'short' })).data.code, 'invalid_password');
  assert.equal((await f.install({ confirmPassword: password + 'different' })).data.code, 'password_mismatch');
  assert.equal(await f.db.prepare("SELECT * FROM paixu_meta WHERE key='admin_key_hash'").first(), null);
  assert.equal((await f.request('/api/admin/config')).status, 401);
});
test('setup attempts are rate limited and cross-origin writes are rejected', async t => {
  const f = fixture(t);
  const body = { setupKey, newPassword: password, confirmPassword: password };
  assert.equal((await f.request('/api/admin/setup', 'POST', body, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request('/api/admin/setup', 'POST', body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await f.install({ setupKey: 'incorrect' })).status, 403);
  assert.equal((await f.install()).status, 429);
  assert.equal(await f.db.prepare("SELECT * FROM paixu_meta WHERE key='admin_key_hash'").first(), null);
});
test('existing CLI administrators and their sessions cannot be overwritten by web setup', async t => {
  const f = fixture(t), oldKey = 'synthetic-existing-owner-key';
  const hash = await digest(oldKey);
  await f.db.prepare("INSERT INTO paixu_meta(key,value) VALUES('admin_key_hash',?)").bind(hash).run();
  const login = await f.request('/api/admin/login', 'POST', { key: oldKey });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  f.env.ADMIN_SETUP_KEY = 'replacement-secret-that-must-not-reset-an-admin';
  const rejected = await f.install({ setupKey: f.env.ADMIN_SETUP_KEY });
  assert.equal(rejected.status, 409); assert.equal(rejected.data.code, 'admin_already_initialized');
  assert.equal((await f.db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value, hash);
  assert.equal((await f.request('/api/admin/config', 'GET', undefined, { cookie })).status, 200);
  assert.equal((await f.request('/api/admin/login', 'POST', { key: oldKey })).status, 200);
});
test('concurrent setup requests have one winner and never overwrite the first password', async t => {
  const f = fixture(t), otherPassword = 'synthetic-other-admin-password-56789';
  const results = await Promise.all([
    f.install(),
    f.install({ newPassword: otherPassword, confirmPassword: otherPassword }, { clientIp: '192.0.2.21' }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const winner = results.findIndex(r => r.status === 201);
  const value = (await f.db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value;
  assert.ok(await verifyPassword(winner === 0 ? password : otherPassword, value));
  assert.equal(await verifyPassword(winner === 0 ? otherPassword : password, value), false);
});
test('Worker receives the configured Secret but never returns it in the status response', async t => {
  const f = fixture(t);
  const response = await worker.fetch(new Request('https://game.test/api/admin/setup'), f.env);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { initialized: false, setupAvailable: true });
  const login = await f.request('/api/admin/login', 'POST', { key: setupKey });
  assert.equal(login.status, 503); assert.equal(login.data.code, 'admin_not_initialized');
});
