import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// A small D1-compatible adapter keeps all SQL and API behavior shared with Workers.
export function openDatabase(filename = process.env.DB_PATH || './data/paixu.sqlite') {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    // Secure the database before SQLite creates its journal, including in existing shared directories.
    fs.closeSync(fs.openSync(filename, 'a', 0o600));
    for(const file of [filename, filename+'-wal', filename+'-shm']) if(fs.existsSync(file)) fs.chmodSync(file,0o600);
  }
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  // Node and D1 apply the same reset/schema. Reopening never clears new PAIXU data.
  const migration = fs.readFileSync(new URL('../migrations/0008_paixu_reset.sql', import.meta.url), 'utf8');
  sqlite.exec('BEGIN IMMEDIATE');
  try { sqlite.exec(migration); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); sqlite.close(); throw error; }
  function prepared(sql, values = []) {
    return {
      bind: (...next) => prepared(sql, next),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: r.changes } }; },
      execute: () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: r.changes } }; },
    };
  }
  return {
    prepare: sql => prepared(sql),
    batch: async statements => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close: () => sqlite.close(),
  };
}
