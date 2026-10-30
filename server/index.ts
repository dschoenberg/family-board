import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, root } from './config.ts';
import { Sources } from './sources.ts';
import { wifiQrSvg } from './wifi.ts';

let config;
try { config = loadConfig(); } catch (error) { console.error((error as Error).message); process.exit(1); }
process.env.TZ = config.display.timezone;
const sources = new Sources(config);
await sources.init();
const guestWifiQr = config.guestWifi?.ssid ? await wifiQrSvg(config.guestWifi) : null;
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/weather.js': ['weather.js', 'text/javascript; charset=utf-8'],
  '/calendar-fit.js': ['calendar-fit.js', 'text/javascript; charset=utf-8'],
};
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  // Reject hostile Host headers to avoid exposing local data through DNS rebinding.
  const allowed = new Set([`127.0.0.1:${config.server.port}`, `localhost:${config.server.port}`, `[::1]:${config.server.port}`]);
  if (!allowed.has(req.headers.host ?? '')) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return; }
  try {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); return; }
    if (path === '/api/board') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await sources.board())); return; }
    if (path === '/guest-wifi.svg') {
      if (!guestWifiQr) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(req.method === 'HEAD' ? undefined : guestWifiQr); return;
    }
    if (/^\/photos\/[a-f0-9]{32}$/.test(path)) {
      const photo = await sources.photos.get(path.slice('/photos/'.length));
      if (!photo) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', photo.type);
      res.setHeader('Content-Length', photo.bytes.length);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(req.method === 'HEAD' ? undefined : photo.bytes); return;
    }
    const file = files[path];
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', file[1]);
    const body = await readFile(join(root, 'public', file[0]));
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(503); res.end('Temporarily unavailable'); }
});
server.on('error', () => { console.error('Could not start server. Check whether the configured port is already in use.'); process.exit(1); });
server.listen(config.server.port, config.server.host, () => {
  console.log(`Family Board: http://localhost:${config.server.port}`);
  sources.start();
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { sources.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
