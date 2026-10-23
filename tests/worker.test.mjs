import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// Model the canonical URLs provided by Cloudflare Static Assets, not Node's file server.
const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    if (['/admin.html', '/admin/'].includes(url.pathname)) return new Response(null, { status: 307, headers: { Location: '/admin' + url.search } });
    if (url.pathname === '/admin') return new Response(request.method === 'HEAD' ? null : '<title>Admin</title>', { headers: { 'Content-Type': 'text/html' } });
    return new Response('asset');
  },
};
test('Cloudflare admin entry preserves its canonical URL instead of redirecting to itself', async () => {
  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://game.test/admin?lang=zh', { method });
    const response = await worker.fetch(request, { ASSETS: assets });
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
  }
});
test('legacy and trailing-slash admin URLs converge after exactly one redirect', async () => {
  for (const path of ['/admin/', '/admin.html']) {
    let request = new Request('https://game.test' + path + '?lang=en'), redirects = 0, response;
    for (let i = 0; i < 3; i++) {
      response = await worker.fetch(request, { ASSETS: assets });
      if (!response.headers.has('location')) break;
      redirects++; request = new Request(new URL(response.headers.get('location'), request.url));
    }
    assert.equal(response.status, 200); assert.equal(redirects, 1); assert.equal(new URL(request.url).search, '?lang=en');
  }
});
test('unrelated static requests are forwarded without changing their URL, headers, or method', async () => {
  const request = new Request('https://game.test/style.css?build=1', { method: 'HEAD', headers: { 'If-None-Match': 'test' } });
  const response = await worker.fetch(request, { ASSETS: { fetch: async received => { assert.equal(received, request); return new Response(null, { status: 304 }); } } });
  assert.equal(response.status, 304);
});

test('Workers takes coarse location from request.cf and ignores spoofed country headers', async t => {
  const {openDatabase}=await import('../backend/sqlite.mjs');
  const {digest}=await import('../backend/security.js');
  const db=openDatabase(':memory:'); t.after(()=>db.close());
  await db.prepare('UPDATE paixu_site_settings SET ranking_enabled=1').run();
  const guest='synthetic-geo-guest';
  await db.prepare('INSERT INTO paixu_players(id,token_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?)').bind('geo-test',await digest(guest),'Geo test',Date.now(),Date.now()).run();
  const request=new Request('https://game.test/api/runs',{method:'POST',headers:{'Content-Type':'application/json',cookie:'paixu_guest='+guest,'CF-Connecting-IP':'192.0.2.44','CF-IPCountry':'US'},body:JSON.stringify({mode:'six-seat',country:'US'})});
  Object.defineProperty(request,'cf',{value:{country:'CN',region:'Guangdong',city:'Shenzhen',latitude:'22.5'}});
  const response=await worker.fetch(request,{DB:db}); assert.equal(response.status,201);
  const row=await db.prepare('SELECT * FROM paixu_runs').first(); assert.equal(row.country,'CN'); assert.equal(row.region,'Guangdong'); assert.equal(row.ip,'192.0.2.44');
  assert.ok(!JSON.stringify(row).includes('Shenzhen'));
});
