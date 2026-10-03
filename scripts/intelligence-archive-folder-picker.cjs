const http = require('node:http');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = 47431;
const ORIGINS = new Set(['https://www.nrgopt.com', 'https://nrgopt.com']);

function chooseFolder() {
  return new Promise(resolve => {
    execFile(path.join(__dirname, 'NRGOPTArchivePicker.app', 'Contents', 'MacOS', 'NRGOPTArchivePicker'), [],
      { timeout: 300000 }, (error, stdout) => resolve(error ? '' : stdout.trim().replace(/\/$/, '')));
  });
}

function createServer(pick = chooseFolder) {
  let busy = false;
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    const origin = url.searchParams.get('origin');
    const nonce = url.searchParams.get('nonce');
    if (request.method !== 'GET' || !['/pick', '/choose'].includes(url.pathname) || !ORIGINS.has(origin) || !/^[a-f0-9]{32}$/.test(nonce || '')) {
      response.writeHead(404).end(); return;
    }
    if (url.pathname === '/pick') {
      const query = new URLSearchParams({ origin, nonce });
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
      response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>选择归档目录</title><style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:32px;color:#172338;background:#f6f8fb}main{max-width:420px;margin:24px auto}h1{font-size:21px;margin:0 0 12px}p{margin:0;color:#526178}</style><main><h1>请选择归档文件夹</h1><p id="status">请在前方的 Mac 文件夹窗口中选择。完成或取消后，此窗口会自动关闭。</p></main><script>(async()=>{try{const response=await fetch('/choose?${query}');if(!response.ok)throw Error();const result=await response.json();if(window.opener){window.opener.postMessage(result,${JSON.stringify(origin)});window.opener.focus()}window.close()}catch{document.getElementById('status').textContent='无法打开文件夹选择窗口，请返回系统设置重试。'}})()</script></html>`);
      return;
    }
    if (busy) { response.writeHead(409).end('已有目录选择窗口打开。'); return; }
    busy = true;
    let directory = '', result = 'cancelled';
    try {
      directory = await pick();
      if (directory) result = 'selected';
      if (directory && (!/^\/(?:Users\/[^/]+\/.+|Volumes\/[^/]+\/.+)$/.test(directory) || /[\x00-\x1f\x7f\\]/.test(directory))) {
        directory = ''; result = 'unsupported';
      }
      if (directory) {
        const stat = await fs.stat(directory);
        if (!stat.isDirectory()) { directory = ''; result = 'unavailable'; }
      }
    } catch { directory = ''; result = 'unavailable'; }
    finally { busy = false; }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ type: 'nrgopt-archive-directory', nonce, directory, result }));
  });
}

if (require.main === module) createServer().listen(PORT, '127.0.0.1');
module.exports = { createServer };
