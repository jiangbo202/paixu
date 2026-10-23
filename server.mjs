import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './backend/sqlite.mjs';
import { handleApi, cleanup } from './backend/api.js';
import { trustedProxies, clientAddress } from './backend/proxy.mjs';

const root = path.resolve(process.argv.includes('--dist') ? 'dist' : '.');
const port = Number(process.env.PORT || 5173), host = process.env.HOST || '127.0.0.1';
const proxies = trustedProxies(process.env.TRUST_PROXY_IPS);
const db = openDatabase();
setInterval(() => cleanup(db).catch(() => console.error('Database cleanup failed')), 3600000).unref();
const publicFiles = new Set(['index.html', 'admin.html', 'style.css', 'frame.css', 'app.js', 'audio.js', 'engine.js', 'modes.js', 'six-seat.js', 'presentation.js', 'rules.js', 'selection.js', 'tutorial.js', 'admin.css', 'i18n.js', 'admin.js', 'usage-view.js', 'rankings.js', 'board-loader.js', 'branding.js', 'favicon.svg']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const server = http.createServer(async (req, res) => {
  try {
    const origin = process.env.PUBLIC_ORIGIN || `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url, origin); const pathname = decodeURIComponent(url.pathname);
    const remote = req.socket.remoteAddress || 'unknown';
    const clientIp = clientAddress(remote,req.headers['x-forwarded-for'],proxies);
    if (pathname.startsWith('/api/')) {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
      const response = await handleApi(request, { DB: db, clientIp, platform: 'local', ADMIN_SETUP_KEY: process.env.ADMIN_SETUP_KEY });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const file = pathname === '/' ? 'index.html' : pathname === '/admin' || pathname === '/admin/' ? 'admin.html' : pathname.slice(1);
    if (!publicFiles.has(file)) { res.writeHead(404).end('Not found'); return; }
    const data = await fs.readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch { if (!res.headersSent) res.writeHead(400); res.end('Bad request'); }
});
server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.listen(port, host, () => console.log(`Local: http://${host}:${port}\nAdmin: /admin (web setup: ADMIN_SETUP_KEY; CLI: npm run admin:init)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
