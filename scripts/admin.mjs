import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../backend/sqlite.mjs';

const reset = process.argv[2] === 'reset';
if (!['init', 'reset'].includes(process.argv[2])) { console.error('Usage: node scripts/admin.mjs init|reset [--cloudflare]'); process.exit(1); }
const key = 'paixu_' + randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
const cloudflare = process.argv.includes('--cloudflare');
const databaseName = process.env.CF_D1_DATABASE_NAME || 'paixu-db';
const cliConfig = process.env.WRANGLER_CONFIG ? ['--config', process.env.WRANGLER_CONFIG] : [];
if (cloudflare) {
  const query = "SELECT value FROM paixu_meta WHERE key='admin_key_hash'";
  const check = spawnSync('npx', ['--no-install', 'wrangler', ...cliConfig, 'd1', 'execute', databaseName, '--remote', '--json', '--command', query], { encoding: 'utf8' });
  if (check.status !== 0) { console.error(check.stderr || 'Authenticate with Wrangler and apply migrations first.'); process.exit(1); }
  let exists; try { exists = JSON.parse(check.stdout).some(r => r.results?.length); } catch { console.error('Could not verify administrator state. No key was changed.'); process.exit(1); }
  if (exists && !reset) { console.log('Administrator is already initialized. The key cannot be displayed again. Use admin:reset:cloudflare if it is lost.'); process.exit(0); }
  const sql = reset ? `DELETE FROM paixu_admin_sessions; INSERT INTO paixu_meta(key,value) VALUES('admin_key_hash','${hash}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;` : `INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('admin_key_hash','${hash}');`;
  const result = spawnSync('npx', ['--no-install', 'wrangler', ...cliConfig, 'd1', 'execute', databaseName, '--remote', '--json', '--command', sql], { encoding: 'utf8' });
  if (result.status !== 0) { console.error('Administrator initialization failed.'); process.exit(1); }
  const verify = spawnSync('npx', ['--no-install', 'wrangler', ...cliConfig, 'd1', 'execute', databaseName, '--remote', '--json', '--command', query], { encoding: 'utf8' });
  if (verify.status !== 0 || !verify.stdout.includes(hash)) { console.error('Administrator state changed. No key is displayed.'); process.exit(1); }
} else {
  const db = openDatabase();
  const existing = await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first();
  if (existing && !reset) { console.log('Administrator is already initialized. The key cannot be displayed again. Use npm run admin:reset if it is lost.'); db.close(); process.exit(0); }
  if (reset) await db.batch([db.prepare('DELETE FROM paixu_admin_sessions'), db.prepare("INSERT INTO paixu_meta(key,value) VALUES('admin_key_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(hash)]);
  else await db.prepare("INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('admin_key_hash',?)").bind(hash).run();
  const stored = await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first(); db.close();
  if (stored.value !== hash) { console.error('Another installation initialized the administrator. No key is displayed.'); process.exit(1); }
}
console.log(`\nAdministrator key (shown once; store it securely):\n${key}\n\nOpen /admin and sign in with this key. It is not stored in plaintext and is never returned by the API.\n`);
