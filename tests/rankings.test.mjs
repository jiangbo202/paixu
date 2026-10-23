import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/sqlite.mjs';
import { handleApi, cleanup } from '../backend/api.js';
import { retentionSql, pruneScoresStatement } from '../backend/leaderboard.js';
import { digest, hashPassword, verifyPassword, validNewPassword } from '../backend/security.js';
import { RANKINGS, rankingFor } from '../rankings.js';
import { newRun } from '../engine.js';

function setup(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const env={DB:db,clientIp:'192.0.2.123'};
  const client=()=>{
    let jar='';
    return {async request(path,method='GET',body,extra={}) {
      const response=await handleApi(new Request('http://game.test'+path,{method,headers:{cookie:jar,...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
      const cookie=response.headers.get('set-cookie');if(cookie){const name=cookie.split('=')[0];jar=[...jar.split('; ').filter(c=>c&&!c.startsWith(name+'=')),cookie.split(';')[0]].join('; ');}
      return {status:response.status,data:await response.json(),headers:response.headers};
    }};
  };
  return {db,client,env};
}
const oldPassword='synthetic-old-password';
async function owner(db,c) {await db.prepare("INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('admin_key_hash',?)").bind(await digest(oldPassword)).run();assert.equal((await c.request('/api/admin/login','POST',{key:oldPassword})).status,200);}
async function seed(db,values={}) {
  const row={run_id:crypto.randomUUID(),player_id:'fixture-v',display_name:'Fixture player',best_hand:100,total_score:200,rounds:2,ante:1,outcome:'lost',config_version:'default-v1',created_at:Date.now(),duration_ms:1000,ip:'192.0.2.1',browser:'Test UA',difficulty:'medium',mode:'classic',ranking_epoch:1,hidden:0,...values};
  await db.prepare(`INSERT INTO paixu_scores(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();return row;
}
async function count(db) {return (await db.prepare('SELECT COUNT(*) AS n FROM paixu_scores').first()).n;}

test('leaderboard metrics are explicitly allowlisted',()=>{
  assert.equal(rankingFor().id,'best');assert.deepEqual(RANKINGS.map(r=>r.id),['best','total','rounds']);
  for(const value of ['','unknown','best_hand DESC; DROP TABLE paixu_scores',null,{},1])assert.throws(()=>rankingFor(value));
});
test('default limit is 20; each metric sorts independently and unknown rounds never enter the rounds board',async t=>{
  const {db,client}=setup(t),c=client();await db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1').run();
  const a=await seed(db,{best_hand:900,total_score:1000,rounds:3});
  const b=await seed(db,{best_hand:800,total_score:9000,rounds:5});
  const z=await seed(db,{best_hand:1,total_score:10,rounds:20});await seed(db,{best_hand:10,total_score:100,rounds:null});
  for(const [metric,id]of [['best',a.run_id],['total',b.run_id],['rounds',z.run_id]]){
    const result=await c.request('/api/leaderboard?metric='+metric);assert.equal(result.status,200);assert.equal(result.data.metric,metric);assert.equal(result.data.limit,20);assert.equal(result.data.entries[0].runId,id);
    if(metric==='rounds')assert.equal(result.data.entries.length,3);
  }
  assert.equal((await c.request('/api/leaderboard')).data.entries[0].runId,a.run_id);
  assert.equal((await c.request('/api/leaderboard?metric=invalid')).status,400);
  assert.equal((await c.request('/api/leaderboard?metric=best_hand%20DESC')).status,400);
});
test('retention keeps the union of metric winners and current-day winners, with deterministic ties and isolated groups',async t=>{
  const {db}=setup(t);await db.prepare('UPDATE paixu_site_settings SET ranking_limit=2').run();
  const today=Math.floor(Date.now()/86400000)*86400000;
  const old=[];
  for(let i=0;i<12;i++)old.push(await seed(db,{best_hand:1000-i,total_score:1000+((i+4)%12),rounds:(i+8)%12,created_at:today-1000-i}));
  const day=[];for(let i=0;i<8;i++)day.push(await seed(db,{best_hand:100-i,total_score:200-i,rounds:1,created_at:today+10+i}));
  const other=await seed(db,{mode:'six-seat',best_hand:1,total_score:1,rounds:1});
  const expected=new Set([other.run_id]);
  const sort=column=>(a,b)=>b[column]-a[column]||a.created_at-b.created_at||a.run_id.localeCompare(b.run_id);
  for(const pool of [[...old,...day],day])for(const metric of RANKINGS)for(const row of [...pool].sort(sort(metric.column)).slice(0,2))expected.add(row.run_id);
  await pruneScoresStatement(db).run();
  const retained=(await db.prepare('SELECT run_id FROM paixu_scores').all()).results.map(r=>r.run_id);
  assert.deepEqual(new Set(retained),expected);assert.ok(retained.length>2);assert.ok(retained.length<21);
  // The expired daily winners no longer survive unless they also won an all-time board.
  await db.prepare('UPDATE paixu_scores SET created_at=created_at-86400000').run();await cleanup(db);
  assert.ok(await count(db)<=7);assert.ok(await db.prepare('SELECT run_id FROM paixu_scores WHERE run_id=?').bind(other.run_id).first());
});
test('limit changes prune immediately, preserve other metric winners, validate bounds and reject stale saves',async t=>{
  const {db,client}=setup(t),c=client();await owner(db,c);
  const a=await seed(db,{best_hand:1000,total_score:1000,rounds:1}),b=await seed(db,{best_hand:900,total_score:9000,rounds:2}),z=await seed(db,{best_hand:1,total_score:1,rounds:99});
  const outsider=await seed(db,{best_hand:1,total_score:1,rounds:1});
  for(const rankingLimit of [0,-1,1.2,'20',1001])assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:true,rankingLimit,expectedRevision:0})).status,400);
  const result=await c.request('/api/admin/settings','PUT',{rankingEnabled:true,rankingLimit:1,expectedRevision:0});assert.equal(result.status,200);assert.equal(result.data.rankingLimit,1);
  assert.deepEqual(new Set((await db.prepare('SELECT run_id FROM paixu_scores').all()).results.map(r=>r.run_id)),new Set([a.run_id,b.run_id,z.run_id]));
  assert.equal(await db.prepare('SELECT run_id FROM paixu_scores WHERE run_id=?').bind(outsider.run_id).first(),null);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:true,rankingLimit:20,expectedRevision:0})).status,409);
  assert.equal((await c.request('/api/admin/settings','PUT',{rankingEnabled:true,rankingLimit:20,expectedRevision:1})).status,200);assert.equal(await count(db),3);
});
test('server finish records real metrics, drops outsiders, and reports the outcome consistently after reload',async t=>{
  const {db,client}=setup(t),c=client();await db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1,ranking_limit=1').run();
  await c.request('/api/profile','POST',{displayName:'Ranker'});
  const winner=await seed(db,{best_hand:10000,total_score:100000,rounds:100});
  const first=(await c.request('/api/runs','POST',{})).data.run;
  const state=newRun('fixture');state.bestHand=100;state.totalScore=200;state.round=7;
  await db.prepare('UPDATE paixu_runs SET state=? WHERE id=?').bind(JSON.stringify(state),first.id).run();
  const finish=await c.request(`/api/runs/${first.id}/actions`,'POST',{action:'finish',revision:0,bestHand:999999999,rounds:99999});
  assert.equal(finish.status,200);assert.equal(finish.data.submitted,false);assert.equal(finish.data.run.rankingStatus,'outside_top');assert.equal(await count(db),1);
  const reloaded=(await c.request('/api/runs/'+first.id)).data.run;assert.equal(reloaded.rankingStatus,'outside_top');assert.equal(reloaded.rankingLimit,1);
  const second=(await c.request('/api/runs','POST',{})).data.run;state.round=101;
  await db.prepare('UPDATE paixu_runs SET state=? WHERE id=?').bind(JSON.stringify(state),second.id).run();
  const accepted=await c.request(`/api/runs/${second.id}/actions`,'POST',{action:'finish',revision:0,rounds:9000});assert.equal(accepted.status,200);assert.equal(accepted.data.submitted,true);
  assert.equal((await db.prepare('SELECT rounds FROM paixu_scores WHERE run_id=?').bind(second.id).first()).rounds,101);assert.equal(await count(db),2);
  assert.equal((await c.request('/api/leaderboard?metric=rounds')).data.entries[0].runId,second.id);
  assert.equal((await c.request('/api/leaderboard?metric=best')).data.entries[0].runId,winner.run_id);
  assert.equal((await c.request(`/api/runs/${second.id}/actions`,'POST',{action:'finish',revision:0})).status,409);
});
test('moderation uses bounded hidden records and restoring cannot overflow public boards',async t=>{
  const {db,client}=setup(t),c=client();await owner(db,c);await db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1,ranking_limit=1').run();
  const a=await seed(db,{best_hand:100,total_score:100,rounds:10});
  assert.equal((await c.request('/api/admin/scores/'+a.run_id,'PATCH',{hidden:true})).status,200);
  await seed(db,{best_hand:200,total_score:200,rounds:20});
  assert.equal((await c.request('/api/admin/scores/'+a.run_id,'PATCH',{hidden:false})).status,200);
  assert.equal(await count(db),1);assert.equal((await c.request('/api/leaderboard')).data.entries.length,1);
});
test('password hashing uses unique salts and accepts the original installation key format',async()=>{
  const a=await hashPassword('a-valid-new-password'),b=await hashPassword('a-valid-new-password');assert.notEqual(a,b);assert.match(a,/^pbkdf2-sha256\$100000\$/);
  assert.ok(await verifyPassword('a-valid-new-password',a));assert.equal(await verifyPassword('different-password',a),false);
  assert.ok(await verifyPassword(oldPassword,await digest(oldPassword)));
  for(const stored of ['pbkdf2-sha256$999999999$bad$bad','bad',null])assert.equal(await verifyPassword(oldPassword,stored),false);
  for(const value of ['short',' '.repeat(12),'a'.repeat(129),'a-valid-new\npassword',null])assert.equal(validNewPassword(value),false);
});
test('password change requires login and original password, confirmation and valid new password',async t=>{
  const {db,client}=setup(t),c=client();const payload={currentPassword:oldPassword,newPassword:'new-password-12345',confirmPassword:'new-password-12345'};
  assert.equal((await c.request('/api/admin/password','PUT',payload)).status,401);await owner(db,c);
  assert.equal((await c.request('/api/admin/password','PUT',payload,{origin:'https://attacker.test'})).status,403);
  assert.equal((await c.request('/api/admin/password','PUT',{...payload,newPassword:'short'})).status,400);
  assert.equal((await c.request('/api/admin/password','PUT',{...payload,confirmPassword:'mismatch'})).status,400);
  assert.equal((await c.request('/api/admin/password','PUT',{...payload,currentPassword:'wrong-password'})).status,403);
  assert.equal((await c.request('/api/admin/password','PUT',{...payload,newPassword:oldPassword,confirmPassword:oldPassword})).status,400);
  assert.equal((await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value,await digest(oldPassword));
  assert.equal((await c.request('/api/admin/settings')).status,200);
});
test('successful password rotation revokes every session, rejects the old password, and persists the salted verifier',async t=>{
  const {db,client}=setup(t),a=client(),b=client(),fresh=client();await owner(db,a);await owner(db,b);
  const password='new-password-12345';const changed=await a.request('/api/admin/password','PUT',{currentPassword:oldPassword,newPassword:password,confirmPassword:password});
  assert.equal(changed.status,200);assert.deepEqual(changed.data,{ok:true});assert.match(changed.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM paixu_admin_sessions').first()).n,0);
  for(const c of [a,b])assert.equal((await c.request('/api/admin/settings')).status,401);
  assert.equal((await fresh.request('/api/admin/login','POST',{key:oldPassword})).status,401);
  assert.equal((await fresh.request('/api/admin/login','POST',{key:password})).status,200);
  const stored=(await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value;assert.notEqual(stored,await digest(password));assert.ok(await verifyPassword(password,stored));
});
test('password change attempts are rate limited without changing the password',async t=>{
  const {db,client}=setup(t),c=client();await owner(db,c);
  for(let i=0;i<5;i++)assert.equal((await c.request('/api/admin/password','PUT',{})).status,400);
  assert.equal((await c.request('/api/admin/password','PUT',{})).status,429);
  assert.equal((await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value,await digest(oldPassword));
});

test('the default twenty-entry limit physically removes the twenty-first result on every board',async t=>{
 const {db,client}=setup(t),c=client();await db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1').run();
 for(let i=0;i<25;i++)await seed(db,{best_hand:100+i,total_score:200+i,rounds:i+1});
 await pruneScoresStatement(db).run();assert.equal(await count(db),20);
 for(const {id}of RANKINGS){const board=await c.request('/api/leaderboard?metric='+id);assert.equal(board.data.entries.length,20);assert.equal(board.data.entries[0].rounds,25);}
});
test('concurrent password changes cannot overwrite a successful rotation with a stale original password',async t=>{
 const {db,client}=setup(t),a=client(),b=client();await owner(db,a);await owner(db,b);
 const passwords=['concurrent-password-A','concurrent-password-B'];
 const results=await Promise.all([a,b].map((c,i)=>c.request('/api/admin/password','PUT',{currentPassword:oldPassword,newPassword:passwords[i],confirmPassword:passwords[i]})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results.findIndex(r=>r.status===200),stored=(await db.prepare("SELECT value FROM paixu_meta WHERE key='admin_key_hash'").first()).value;
 assert.ok(await verifyPassword(passwords[winner],stored));assert.equal(await verifyPassword(passwords[1-winner],stored),false);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM paixu_admin_sessions').first()).n,0);
});
