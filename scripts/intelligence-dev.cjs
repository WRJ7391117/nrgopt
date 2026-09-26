// Local preview only; binds to loopback and never exposes the repository as a directory.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const handler = require('../api/intelligence.js');
const root = path.resolve(__dirname, '..');
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    req.query = Object.fromEntries(url.searchParams);
    if (url.pathname === '/intelligence/login') req.query.action = 'login-page';
    else if (url.pathname === '/intelligence/overview') req.query.action = 'overview-page';
    else if (url.pathname === '/intelligence/settings') req.query.action = 'settings-page';
    else if (url.pathname === '/intelligence') req.query.action = 'page';
    else if (url.pathname.startsWith('/intelligence/sources/')) {
      req.query.action = 'detail-page'; req.query.id = url.pathname.slice('/intelligence/sources/'.length);
    }
    if (url.pathname === '/api/intelligence' || url.pathname === '/intelligence' || url.pathname.startsWith('/intelligence/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { res.status(413).json({ message: '请求内容过长。' }); return; }
        chunks.push(chunk);
      }
      if (size) {
        try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { res.status(400).json({ message: '请求格式无效。' }); return; }
      }
      return await handler(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!/^(?:[a-z0-9-]+\.html|(?:css|js|images|fonts)\/[a-zA-Z0-9_./-]+|favicon\.ico)$/.test(relative) || relative.split('/').some(part => part === '..' || part.startsWith('.'))) {
      res.status(404).end(); return;
    }
    const type = mime[path.extname(relative)];
    if (!type) { res.status(404).end(); return; }
    const bytes = await fs.readFile(path.join(root, relative));
    res.setHeader('Content-Type', `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}`);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.status(404).end(); }
}).listen(Number(process.env.PORT) || 4317, '127.0.0.1', () => {
  console.log(`NRGOPT local preview: http://127.0.0.1:${Number(process.env.PORT) || 4317}/intelligence`);
});
