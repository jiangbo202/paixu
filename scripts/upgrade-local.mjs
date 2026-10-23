import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../backend/sqlite.mjs';

// Run with the server stopped. This is the explicit, one-time history reset.
const source = process.argv[2] && path.resolve(process.argv[2]);
const target = path.resolve(process.env.DB_PATH || './data/paixu.sqlite');
if (!source || !fs.existsSync(source)) {
  console.error('Usage: npm run upgrade:local -- /path/to/previous.sqlite (stop the server first)');
  process.exit(1);
}
if (source !== target && fs.existsSync(target)) {
  console.error('Destination database already exists. No data was changed.');
  process.exit(1);
}
const db = openDatabase(source);
try { await db.prepare('VACUUM').run(); }
finally { db.close(); }
if (source !== target) {
  fs.mkdirSync(path.dirname(target), {recursive:true,mode:0o700});
  fs.renameSync(source,target);
}
console.log('PAIXU database ready. Previous player/run/score history was cleared; owner credentials and rules were retained.');
