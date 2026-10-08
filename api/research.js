const { settings, createStore, failure } = require('../lib/intelligence/store.cjs');
const { createResearchStore } = require('../lib/research/store.cjs');
const { researchPage, htmlPreview } = require('../lib/research/pages.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = { html: 'text/html', htm: 'text/html', md: 'text/plain', txt: 'text/plain',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip' };
const messages = { auth_required: '请登录后查看调研资料。', forbidden: '此账号没有访问权限。',
  origin_rejected: '请从本站保存资料。', invalid_request: '请检查标题、正文与附件格式；附件不能超过2MB。',
  not_found: '未找到这份调研资料。', research_conflict: '资料已在其他页面更新。当前输入仍保留，请重新读取后再编辑。',
  writes_disabled: '当前环境暂未开放保存。', not_configured: '调研服务尚未配置完成。',
  upstream_unavailable: '连接服务失败，请稍后重试。', evidence_corrupt: '附件校验失败，暂时无法打开。' };

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw failure('invalid_request', 400);
  return value.trim();
}
function identity(body) {
  if (!body.id) return {};
  if (!UUID.test(body.id) || !Number.isSafeInteger(body.revision) || body.revision < 1) throw failure('invalid_request', 400);
  return { id: body.id, revision: body.revision };
}
function attachment(value) {
  if (!value || typeof value !== 'object') throw failure('invalid_request', 400);
  const name = text(value.name, 200, true);
  const type = TYPES[name.split('.').pop().toLowerCase()];
  if (!type || /[\x00-\x1f\x7f/\\]/.test(name) || typeof value.base64 !== 'string' ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) throw failure('invalid_request', 400);
  const bytes = Buffer.from(value.base64, 'base64');
  if (!bytes.length || bytes.length > 2097152 || bytes.toString('base64') !== value.base64) throw failure('invalid_request', 400);
  return { name, type, bytes };
}
function createHandler({ env = process.env, authFactory = createStore, storeFactory = createResearchStore } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Cookie');
    const action = req.query?.action || 'page';
    try {
      const post = ['save-project', 'save-entry'].includes(action);
      if ((!post && !['page', 'projects', 'entries', 'entry', 'file'].includes(action)) || req.method !== (post ? 'POST' : 'GET')) {
        res.setHeader('Allow', post ? 'POST' : 'GET');
        return res.status(405).json({ error: 'method_not_allowed', message: '不支持此请求方式。' });
      }
      const cookieName = (env.NRGOPT_APP_ORIGIN || '').startsWith('https://') ? '__Host-nrgopt_session' : 'nrgopt_session';
      const token = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      if (!token || !/^[A-Za-z0-9._-]{1,8192}$/.test(token)) throw failure('auth_required', 401);
      const config = settings(env);
      if (post && !config.origins.includes(req.headers.origin)) throw failure('origin_rejected', 403);
      const user = await authFactory(config).user(token);
      if (!user || user.id !== config.adminId) throw failure('forbidden', 403);
      if (action === 'page') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).end(researchPage(user.email));
      }
      const store = storeFactory(config);
      if (action === 'projects') return res.status(200).json({ projects: await store.projects(user.id), writable: config.writes });
      if (['entries', 'entry', 'file'].includes(action) && !UUID.test(req.query.id || '')) throw failure('invalid_request', 400);
      if (action === 'entries') return res.status(200).json({ entries: await store.entries(user.id, req.query.id) });
      if (action === 'entry') return res.status(200).json({ entry: await store.entry(user.id, req.query.id) });
      if (action === 'file') {
        const { entry, bytes } = await store.file(user.id, req.query.id);
        const inline = req.query.preview === '1' && ['text/html', 'text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(entry.file_type);
        res.setHeader('Content-Type', inline ? entry.file_type + (entry.file_type.startsWith('text/') ? '; charset=utf-8' : '') : 'application/octet-stream');
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="research-file"; filename*=UTF-8''${encodeURIComponent(entry.file_name).replace(/'/g, '%27')}`);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
        return res.status(200).end(inline && entry.file_type === 'text/html' ? htmlPreview(bytes) : bytes);
      }
      if (!config.writes) throw failure('writes_disabled', 403);
      const body = req.body;
      if (!req.headers['content-type']?.startsWith('application/json') || !body || typeof body !== 'object' || Array.isArray(body) ||
        Buffer.byteLength(JSON.stringify(body)) > 3300000) throw failure('invalid_request', 400);
      const value = { ...identity(body), title: text(body.title, 200, true) };
      if (action === 'save-project') {
        value.region = text(body.region || '', 100);
        value.summary = text(body.summary || '', 2000);
        return res.status(200).json({ project: await store.saveProject(user.id, value) });
      }
      if (!UUID.test(body.project_id || '') || !['plan', 'note', 'interview', 'evidence'].includes(body.kind)) throw failure('invalid_request', 400);
      value.project_id = body.project_id;
      value.kind = body.kind;
      value.content = text(body.content || '', 100000);
      value.source_url = text(body.source_url || '', 2000);
      if (value.source_url) {
        let url;
        try { url = new URL(value.source_url); } catch { throw failure('invalid_request', 400); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw failure('invalid_request', 400);
      }
      // Attachments remain immutable. A revised file is saved as a new record.
      if (value.id && body.attachment) throw failure('invalid_request', 400);
      const file = body.attachment ? attachment(body.attachment) : null;
      return res.status(200).json({ entry: await store.saveEntry(user.id, value, file) });
    } catch (error) {
      const code = Object.hasOwn(messages, error.code) ? error.code : 'upstream_unavailable';
      if (action === 'page' && code === 'auth_required') {
        res.setHeader('Location', '/intelligence/login?returnTo=%2Fresearch');
        return res.status(303).end();
      }
      return res.status(error.status || 502).json({ error: code, message: messages[code] });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
