import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/sqlite.mjs';
import { usageReport } from '../backend/usage.js';
function configured(t, fetcher) { const DB=openDatabase(':memory:'); t.after(()=>DB.close()); return { DB, platform:'cloudflare', CF_ACCOUNT_ID:'test-account',CF_ANALYTICS_TOKEN:'NEVER-LEAK-TOKEN',CF_D1_DATABASE_ID:'database',analyticsFetch:fetcher }; }
const response=data=>Response.json({data:{viewer:{accounts:[data]}}});
test('native Workers fetch is invoked without an object receiver', async t => {
  const env=configured(t,async function () {
    assert.equal(this,undefined,'Native fetch must not receive the config object as this');
    return response({project:[],account:[],storage:[]});
  });
  const report=await usageReport(env);
  for (const key of ['workers','d1','d1Storage']) assert.equal(report[key].status,'ok');
});
test('local and unconfigured deployments report real status without pretending usage is zero', async t => {
  const env=configured(t,()=>{throw new Error('Must not fetch');}); delete env.CF_ANALYTICS_TOKEN;
  const missing=await usageReport(env); assert.equal(missing.configured,false); assert.deepEqual(missing.missing,['CF_ANALYTICS_TOKEN']); assert.equal(missing.workers,undefined);
  env.platform='local'; const local=await usageReport(env); assert.ok(local.localDatabaseBytes>0); assert.equal(local.environment,'local');
});
test('analytics filters each resource, separates account totals, preserves unknown storage, and caches concurrent calls', async t => {
  let calls=0; const env=configured(t,async(url,options)=>{
    calls++; assert.equal(url,'https://api.cloudflare.com/client/v4/graphql'); assert.equal(options.headers.Authorization,'Bearer NEVER-LEAK-TOKEN'); const q=JSON.parse(options.body).query;
    if(q.includes('workersInvocationsAdaptive')) { assert.ok(q.includes('scriptName:"paixu-web"')); return response({project:[{sum:{requests:7,errors:1},quantiles:{cpuTimeP50:250}}],account:[{sum:{requests:20}}]}); }
    if(q.includes('d1AnalyticsAdaptiveGroups')) { assert.ok(q.includes('databaseId:"database"')); return response({project:[{sum:{rowsRead:50,rowsWritten:2}}],account:[{sum:{rowsRead:100,rowsWritten:6}}]}); }
    if(q.includes('d1StorageAdaptiveGroups')) return response({storage:[]});
    throw new Error('Unexpected analytics query');
  });
  const [a,b]=await Promise.all([usageReport(env),usageReport(env)]); assert.deepEqual(a,b); assert.equal(calls,3); await usageReport(env); assert.equal(calls,3);
  assert.equal(a.workers.requests,7); assert.equal(a.workers.accountRequests,20); assert.equal(a.workers.cpuP50Us,250); assert.equal(a.d1.rowsWritten,2); assert.equal(a.d1Storage.bytes,null); assert.equal(a.r2,undefined); assert.equal(a.resources.bucket,undefined);
  assert.ok(!JSON.stringify(a).includes('NEVER-LEAK')); assert.equal(a.expiresAt-a.fetchedAt,300000);
});
test('upstream permission, malformed and network errors never leak errors or become fake zeros', async t => {
  const env=configured(t,async()=>new Response('NEVER-LEAK-TOKEN upstream private debug',{status:403}));
  const report=await usageReport(env); assert.equal(report.workers.status,'unavailable'); assert.equal(report.workers.error,'analytics_permission'); assert.equal(report.workers.requests,undefined); assert.ok(!JSON.stringify(report).includes('NEVER-LEAK'));
  const broken=configured(t,async()=>{throw new Error('NEVER-LEAK-TOKEN');}); assert.equal((await usageReport(broken)).workers.error,'analytics_unavailable');
  const partial=configured(t,async()=>Response.json({errors:[{message:'NEVER-LEAK-TOKEN'}]})); assert.equal((await usageReport(partial)).d1.status,'unavailable');
});
test('GraphQL errors are classified even with HTTP 200 and non-2xx JSON bodies', async t => {
  for (const [status, message, expected] of [
    [200, 'Authentication error', 'analytics_permission'],
    [400, 'Invalid API key or access token', 'analytics_permission'],
    [200, 'not authorized for that account', 'analytics_permission'],
    [400, 'unknown field "datetime_geq"', 'analytics_query'],
    [200, 'query time range is too large', 'analytics_limit'],
    [429, 'rate limiter budget depleted', 'analytics_rate_limit'],
  ]) {
    const env=configured(t,async()=>Response.json({errors:[{message:message+' NEVER-LEAK-TOKEN private debug'}]},{status}));
    const report=await usageReport(env);
    assert.equal(report.workers.error,expected,message);
    assert.equal(report.workers.httpStatus,status);
    assert.ok(!JSON.stringify(report).includes('NEVER-LEAK'));
    assert.ok(!JSON.stringify(report).includes('private debug'));
    if (message.includes('datetime_geq')) assert.equal(report.workers.field,'datetime_geq');
  }
  const missing=configured(t,async()=>Response.json({data:{viewer:{accounts:[]}}}));
  assert.equal((await usageReport(missing)).d1.error,'analytics_account');
});
