const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/research.js');
const { createResearchStore } = require('../lib/research/store.cjs');
const admin = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'private',
  NRGOPT_ADMIN_USER_ID: admin, NRGOPT_APP_ORIGIN: 'https://www.nrgopt.com', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1' };
function setup({ user = admin, environment = env } = {}) {
  const calls = [];
  const store = { projects: async owner => { calls.push(['projects', owner]); return []; },
    entries: async (owner, project) => { calls.push(['entries', owner, project]); return []; },
    entry: async () => ({ id, content: '<script>malicious</script>' }),
    saveProject: async (owner, value) => { calls.push(['saveProject', owner, value]); return { id, ...value }; },
    saveEntry: async (owner, value, file) => { calls.push(['saveEntry', owner, value, file]); return { id, ...value }; },
    file: async owner => { calls.push(['file', owner]); return { entry: { file_name: '行动计划.html', file_type: 'text/html' }, bytes: Buffer.from('<script>parent.document.body.innerHTML="bad"</script>') }; } };
  const handler = createHandler({ env: environment, authFactory: () => ({ user: async () => { calls.push(['auth']); return { id: user }; } }), storeFactory: () => store });
  async function request(action, { method = 'GET', body, cookie = '__Host-nrgopt_session=valid.token', origin = env.NRGOPT_APP_ORIGIN } = {}) {
    const res = { code: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; }, end(value) { this.body = value; } };
    await handler({ method, query: { action, id }, body, headers: { cookie, origin, 'content-type': 'application/json' } }, res);
    assert.equal(res.headers['cache-control'], 'private, no-store'); return res;
  }
  return { calls, request };
}
test('anonymous pages redirect to shared password login; data and attachments deny before upstream access', async () => {
  const { request, calls } = setup();
  const page = await request('page', { cookie: '' }); assert.equal(page.code, 303); assert.equal(page.headers.location, '/intelligence/login?returnTo=%2Fresearch');
  for (const action of ['projects', 'entries', 'entry', 'file']) assert.equal((await request(action, { cookie: '' })).code, 401);
  assert.deepEqual(calls, []);
});
test('another authenticated user is denied; foreign origins cannot write', async () => {
  assert.equal((await setup({ user: id }).request('projects')).code, 403);
  const { request, calls } = setup();
  assert.equal((await request('save-project', { method: 'POST', origin: 'https://evil.example', body: { title: 'x' } })).code, 403);
  assert.deepEqual(calls, []);
});
test('projects, text and files save for configured owner only, never client supplied owner', async () => {
  const { request, calls } = setup();
  assert.equal((await request('save-project', { method: 'POST', body: { title: '乌兹别克', owner_id: id } })).code, 200);
  const saved = await request('save-entry', { method: 'POST', body: { title: '行动计划', kind: 'plan', project_id: id, content: '待核验', owner_id: id,
    attachment: { name: '计划.html', base64: Buffer.from('<h1>计划</h1>').toString('base64') } } });
  assert.equal(saved.code, 200);
  const call = calls.find(c => c[0] === 'saveEntry'); assert.equal(call[1], admin); assert.equal(call[2].owner_id, undefined); assert.equal(call[3].type, 'text/html');
});
test('invalid attachment, active URLs, oversized text and unversioned edits are rejected', async () => {
  const { request, calls } = setup(); const base = { title: '记录', kind: 'note', project_id: id };
  for (const value of [ { ...base, attachment: { name: '../x.html', base64: 'YWJj' } }, { ...base, attachment: { name: 'x.exe', base64: 'YWJj' } },
    { ...base, attachment: { name: 'x.html', base64: 'invalid' } }, { ...base, source_url: 'javascript:alert(1)' },
    { ...base, content: 'x'.repeat(100001) }, { ...base, id } ]) {
    assert.equal((await request('save-entry', { method: 'POST', body: value })).code, 400);
  }
  assert.equal(calls.filter(c => c[0] === 'saveEntry').length, 0);
});
test('production read-only settings deny research writes', async () => {
  const { request } = setup({ environment: { ...env, VERCEL_ENV: 'production' } });
  assert.equal((await request('save-project', { method: 'POST', body: { title: 'x' } })).code, 403);
});
test('downloaded HTML is an attachment by default and has a sandbox with no same-origin or network access', async () => {
  const { request } = setup(); const response = await request('file');
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.match(response.headers['content-disposition'], /^attachment/);
  assert.match(response.headers['content-security-policy'], /sandbox allow-scripts allow-downloads;/);
  assert.doesNotMatch(response.headers['content-security-policy'], /allow-same-origin/);
  assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
});
test('stale revision cannot overwrite a newer entry', async () => {
  const calls = [];
  const store = createResearchStore({ url: env.SUPABASE_URL, serviceKey: 'private' }, async (url, options) => {
    calls.push([url, options]);
    const body = url.includes('research_projects') ? [{ id }] : options.method === 'PATCH' ? [] : [{ id, project_id: id }];
    return { ok: true, text: async () => JSON.stringify(body) };
  });
  await assert.rejects(store.saveEntry(admin, { id, revision: 1, project_id: id, title: 'x' }), { code: 'research_conflict' });
  const patch = calls.find(c => c[1].method === 'PATCH'); assert.match(patch[0], /owner_id=eq\.11111111/); assert.match(patch[0], /revision=eq\.1/);
  assert.equal(JSON.parse(patch[1].body).revision, 2);
});
test('cross-project owner mismatch is rejected before inserting entry or uploading file', async () => {
  const calls = [];
  const store = createResearchStore({ url: env.SUPABASE_URL, serviceKey: 'private' }, async (url, options) => {
    calls.push([url, options]); return { ok: true, text: async () => '[]' };
  });
  await assert.rejects(store.saveEntry(admin, { project_id: id, title: 'x' }, { name: 'a.txt', bytes: Buffer.from('x'), type: 'text/plain' }), { code: 'not_found' });
  assert.equal(calls.length, 1); assert.match(calls[0][0], /owner_id=eq\.11111111/);
});
