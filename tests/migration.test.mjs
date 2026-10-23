import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../backend/sqlite.mjs';

const migration=readFileSync(new URL('../migrations/0008_paixu_reset.sql',import.meta.url),'utf8');
function fixture(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'paixu-migration-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));return path.join(dir,'game.sqlite');
}
function legacy(file) {
  const db=new DatabaseSync(file);
  // These names intentionally model the retired schema; none may survive migration.
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES('admin_key_hash','synthetic-owner-verifier'),('current_config','custom-rules'),('retired_marker','old');
    CREATE TABLE configs(id TEXT PRIMARY KEY,body TEXT,created_at INTEGER);
    INSERT INTO configs VALUES('custom-rules','{"hands":4}',1);
    CREATE TABLE site_settings(id INTEGER PRIMARY KEY,ranking_enabled INTEGER,revision INTEGER,updated_at INTEGER);
    INSERT INTO site_settings VALUES(1,1,7,1);
    CREATE TABLE visitors(id TEXT PRIMARY KEY,username TEXT,avatar_key TEXT);
    INSERT INTO visitors VALUES('old-player','Previous player','old.png');
    CREATE TABLE runs(id TEXT);INSERT INTO runs VALUES('old-run');
    CREATE TABLE scores(run_id TEXT);INSERT INTO scores VALUES('old-score');
    CREATE TABLE admin_sessions(token_hash TEXT);INSERT INTO admin_sessions VALUES('old-session');
    CREATE TABLE rate_limits(key TEXT);CREATE TABLE ranking_epochs(difficulty TEXT);CREATE TABLE mode_epochs(mode TEXT);
  `);return db;
}
test('fresh Node and D1 installs use the same namespaced schema without image storage',async t=>{
  const file=fixture(t),raw=new DatabaseSync(file);raw.exec(migration);raw.close();
  const db=openDatabase(file);t.after(()=>db.close());
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name);
  assert.ok(tables.every(name=>name.startsWith('paixu_')));
  assert.equal(tables.length,9);
  const players=(await db.prepare('PRAGMA table_info(paixu_players)').all()).results.map(c=>c.name);
  assert.ok(players.includes('display_name'));assert.ok(!players.some(name=>/avatar|username/.test(name)));
  const runs=(await db.prepare('PRAGMA table_info(paixu_runs)').all()).results.map(c=>c.name);
  assert.ok(runs.includes('player_id'));assert.ok(!runs.includes('visitor_id'));
  const settings=await db.prepare('SELECT * FROM paixu_site_settings').first();assert.equal(settings.ranking_enabled,0);assert.equal(settings.ranking_limit,20);
  const modes=(await db.prepare('SELECT DISTINCT mode FROM paixu_mode_epochs ORDER BY mode').all()).results.map(r=>r.mode);
  assert.deepEqual(modes,['classic','quick','six-seat']);
});
test('legacy upgrade clears player history and old sessions but retains owner credentials and settings',async t=>{
  const file=fixture(t);legacy(file).close();
  const db=openDatabase(file);
  assert.equal((await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value,'synthetic-owner-verifier');
  assert.equal((await db.prepare("SELECT value FROM paixu_meta WHERE key='current_config'").first()).value,'custom-rules');
  assert.equal((await db.prepare('SELECT id FROM paixu_configs').first()).id,'custom-rules');
  assert.equal((await db.prepare('SELECT ranking_enabled FROM paixu_site_settings').first()).ranking_enabled,1);
  for(const table of ['paixu_players','paixu_runs','paixu_scores','paixu_admin_sessions'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results;
  assert.ok(tables.every(row=>row.name.startsWith('paixu_')));
  await db.prepare("INSERT INTO paixu_players VALUES('new-player','new-token','牌友-12345678',1,1)").run();
  db.close();
  const reopened=openDatabase(file);t.after(()=>reopened.close());
  assert.equal((await reopened.prepare('SELECT display_name FROM paixu_players').first()).display_name,'牌友-12345678');
});
test('D1 reset also upgrades legacy schema once and can be reapplied without clearing PAIXU data',t=>{
  const raw=legacy(fixture(t));t.after(()=>raw.close());raw.exec(migration);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM paixu_players').get().n,0);
  raw.prepare("INSERT INTO paixu_players VALUES('new','token','New player',1,1)").run();
  raw.exec(migration);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM paixu_players').get().n,1);
  assert.equal(raw.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").get().value,'synthetic-owner-verifier');
});

test('explicit local upgrade renames the file and refuses to overwrite an existing database',async t=>{
  const source=fixture(t),target=path.join(path.dirname(source),'paixu.sqlite');legacy(source).close();
  const options={cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:target},encoding:'utf8'};
  const upgraded=spawnSync(process.execPath,['scripts/upgrade-local.mjs',source],options);
  assert.equal(upgraded.status,0,upgraded.stderr);
  const next=openDatabase(target);assert.equal((await next.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value,'synthetic-owner-verifier');next.close();
  legacy(source).close();
  const refused=spawnSync(process.execPath,['scripts/upgrade-local.mjs',source],options);assert.equal(refused.status,1);
  const original=new DatabaseSync(source);assert.equal(original.prepare('SELECT COUNT(*) AS n FROM visitors').get().n,1);original.close();
});
