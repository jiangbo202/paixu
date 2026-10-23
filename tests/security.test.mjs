import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { openDatabase } from '../backend/sqlite.mjs';
import { clientAddress, trustedProxies } from '../backend/proxy.mjs';
import { validateRules } from '../rules.js';

test('untrusted forwarded IPs cannot bypass rate limits behind an explicitly trusted proxy',()=>{
 const trusted=trustedProxies('127.0.0.1,::1,192.0.2.9');
 assert.equal(clientAddress('198.51.100.7','203.0.113.99',trusted),'198.51.100.7');
 assert.equal(clientAddress('::ffff:127.0.0.1','203.0.113.99, 198.51.100.7',trusted),'198.51.100.7');
 assert.equal(clientAddress('127.0.0.1','203.0.113.99, 198.51.100.7, 192.0.2.9',trusted),'198.51.100.7');
 assert.equal(clientAddress('127.0.0.1','not-an-ip, 198.51.100.7',trusted),'127.0.0.1');
 assert.equal(clientAddress('127.0.0.1',undefined,trusted),'127.0.0.1');
 assert.equal(clientAddress('127.0.0.1','203.0.113.99'),'127.0.0.1');
 assert.throws(()=>trustedProxies('*'));assert.throws(()=>trustedProxies('127.0.0.1,example.test'));
});
test('rule allowlist rejects inherited property names and prototype payloads',()=>{
 for(const name of ['__proto__','constructor','toString','hasOwnProperty'])assert.throws(()=>validateRules(JSON.parse(`{"${name}":{"polluted":true}}`)),/Unknown rule/);
 assert.equal({}.polluted,undefined);
});
test('database and WAL permissions are private even when an existing parent directory is shared',async t=>{
 if(process.platform==='win32')return t.skip('POSIX mode bits are not enforced on Windows');
 const dir=fs.mkdtempSync(path.join(tmpdir(),'paixu-permissions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.chmodSync(dir,0o755);
 const filename=path.join(dir,'private.sqlite');fs.writeFileSync(filename,'',{mode:0o644});
 const db=openDatabase(filename);t.after(()=>db.close());
 await db.prepare("INSERT INTO paixu_meta(key,value) VALUES('test','private')").run();
 for(const file of [filename,filename+'-wal',filename+'-shm']){assert.ok(fs.existsSync(file));assert.equal(fs.statSync(file).mode&0o777,0o600,file);}
});
test('build publishes only its allowlist, removing stale files from prior builds',t=>{
 const dir=fs.mkdtempSync(path.join(tmpdir(),'paixu-build-security-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=fs.readFileSync(new URL('../scripts/build.mjs',import.meta.url),'utf8');
 const publicFiles=[...source.matchAll(/'([^']+\.(?:html|css|js|svg))'/g)].map(match=>match[1]);publicFiles.push('_headers');
 fs.mkdirSync(path.join(dir,'scripts'));fs.writeFileSync(path.join(dir,'scripts/build.mjs'),source);
 for(const name of publicFiles)fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(dir,name));
 fs.mkdirSync(path.join(dir,'dist'));fs.writeFileSync(path.join(dir,'dist','.env.production'),'synthetic fixture');fs.writeFileSync(path.join(dir,'dist','leftover.txt'),'synthetic fixture');
 fs.writeFileSync(path.join(dir,'secret.pem'),'synthetic fixture');fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','game.sqlite'),'synthetic fixture');
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:dir});
 assert.deepEqual(fs.readdirSync(path.join(dir,'dist')).sort(),[...new Set(publicFiles)].sort());
 assert.ok(fs.existsSync(path.join(dir,'secret.pem')),'Build must not remove source files');
});
test('Git excludes private configurations, keys, data, logs and local hosting metadata',()=>{
 const root=new URL('../',import.meta.url);
 for(const name of ['.env','.env.production','.env.local','.dev.vars','.dev.vars.production','.npmrc','private.pem','private.key','export.p12','game.db','game.db-wal','debug.log','backups/db.sql','security-reports/result.json','.openai/hosting.json','wrangler.production.local.jsonc','data/paixu.sqlite']){
  assert.equal(spawnSync('git',['check-ignore','--no-index','-q',name],{cwd:root}).status,0,name);
 }
 for(const name of ['README.md','README.en.md','SECURITY.md','rankings.js','wrangler.jsonc'])assert.equal(spawnSync('git',['check-ignore','--no-index','-q',name],{cwd:root}).status,1,name);
});
