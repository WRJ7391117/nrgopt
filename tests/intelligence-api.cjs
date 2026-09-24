const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createHandler } = require('../api/intelligence.js');
const { failure } = require('../lib/intelligence/store.cjs');
const { providerSettings, providerSettingsWithSaved } = require('../lib/intelligence/provider-config.cjs');

const id = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service', NRGOPT_ADMIN_USER_ID: admin, NRGOPT_APP_ORIGIN: 'https://preview.example', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1', DEEPSEEK_API_KEY: 'test-deepseek-key',
  NRGOPT_PROVIDER_CONFIG_KEY: Buffer.alloc(32, 7).toString('base64'),
  NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000', NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000' };
const source = { id, title: '<script>untrusted</script>', status: 'pending_extraction' };

test('provider settings accept generic profiles and keep legacy fallbacks', () => {
  const generic = providerSettings({ NRGOPT_DISCOVERY_API_KEY: 'discovery-key', NRGOPT_DISCOVERY_PROVIDER: 'search-service',
    NRGOPT_DISCOVERY_ENDPOINT: 'https://search.example/v1/messages', NRGOPT_DISCOVERY_MODEL: 'search-v2', NRGOPT_DISCOVERY_CURRENCY: 'USD',
    NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1200', NRGOPT_ANALYSIS_API_KEY: 'analysis-key', NRGOPT_ANALYSIS_PROVIDER: 'analysis-service',
    NRGOPT_ANALYSIS_ENDPOINT: 'https://analysis.example/v1/chat/completions', NRGOPT_ANALYSIS_MODEL: 'analysis-v2', NRGOPT_ANALYSIS_CURRENCY: 'USD',
    NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2300' });
  assert.deepEqual(generic.discovery, { apiKey: 'discovery-key', provider: 'search-service', endpoint: 'https://search.example/v1/messages',
    model: 'search-v2', currency: 'USD', billingMode: 'balance', budgetKey: 'NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO', budgetLimitMicro: 1200 });
  assert.deepEqual(generic.analysis, { apiKey: 'analysis-key', provider: 'analysis-service', endpoint: 'https://analysis.example/v1/chat/completions',
    model: 'analysis-v2', currency: 'USD', billingMode: 'balance', budgetKey: 'NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO', budgetLimitMicro: 2300 });
  const legacy = providerSettings({ MINIMAX_API_KEY: 'legacy-discovery', DEEPSEEK_API_KEY: 'legacy-analysis' });
  assert.equal(legacy.discovery.apiKey, 'legacy-discovery');
  assert.equal(legacy.analysis.apiKey, 'legacy-analysis');
  const invalid = providerSettings({ NRGOPT_DISCOVERY_ENDPOINT: 'http://search.example/messages',
    NRGOPT_ANALYSIS_CURRENCY: 'EUR', NRGOPT_ANALYSIS_PROVIDER: 'invalid provider' });
  assert.equal(invalid.discovery.endpoint, null);
  assert.equal(invalid.analysis.currency, null);
  assert.equal(invalid.analysis.provider, null);
  const incomplete = providerSettings({ NRGOPT_DISCOVERY_PROVIDER: 'custom-search', MINIMAX_API_KEY: 'legacy-discovery',
    NRGOPT_MINIMAX_DISCOVERY_RESERVE_MICROCNY: '1000' });
  assert.equal(incomplete.discovery.apiKey, null);
  assert.equal(incomplete.discovery.endpoint, null);
  assert.equal(incomplete.discovery.budgetKey, 'NRGOPT_DISCOVERY_RESERVE_MICRO');
});

function setup({ overrides = {}, environment = env, sourceFetcher, modelFactory, crossCheckFactory, discoveryFactory,
  balanceReaderFactory = () => async () => 1_000_000, notificationFactory } = {}) {
  const calls = [];
  const store = {
    sourceControls: async () => [], setSourceControl: async () => 0,
    login: async () => ({ user: { id: admin }, access_token: 'signed.test-token', expires_in: 7200 }),
    user: async () => ({ id: admin, email: 'local@example.test' }),
    logout: async () => {}, list: async () => [source], get: async () => source,
    candidates: async () => [], operations: async () => ({ runs: [], items: [], budgets: [], notifications: [] }), candidateBySource: async () => null, projectTimeline: async () => ({ entries: [] }), analysisRevisions: async () => [], sourceHistory: async () => [], previousExtractedSource: async () => null, findCandidatePeers: async () => [], assessmentTargets: async () => [], saveCrossCheck: async () => ({}),
    providerHistory: async () => ({ versions: [], calls: [] }),
    providerConfigs: async () => [], saveProviderConfig: async (_owner, record) => record,
    save: async () => ({ source, reused: false }), annotate: async (_id, _owner, note) => ({ ...source, annotation_zh: note, annotation_updated_at: '2026-09-22T00:00:00.000Z' }),
    beginExtraction: async () => {}, saveExtraction: async (_id, _owner, result) => ({ ...source, extraction_status: 'extracted', extraction_zh: result.extraction }),
    saveCandidate: async () => ({}),
    reviewTracking: async () => ({}), watchedSources: async () => [], watchSearchTargets: async () => [], enqueueJob: async () => '33333333-3333-4333-8333-333333333333', enqueueJobItems: async () => 0,
    claimJobItem: async () => null, finishJobItem: async () => true,
    startProviderCall: async () => true, finishProviderCall: async () => true,
    reserveBudget: async () => '44444444-4444-4444-8444-444444444444', settleBudget: async () => true, releaseBudget: async () => true,
    syncProviderBalance: async () => true,
    claimArchive: async () => null, archiveJob: async () => null, completeArchive: async () => true, failArchive: async () => true,
    jobRun: async () => ({ run: { status: 'running' }, items: [] }), enqueueNotification: async () => '77777777-7777-4777-8777-777777777777',
    claimNotification: async () => null, finishNotification: async () => true,
    failExtraction: async () => {}, recordFailure: async () => {}, ...overrides
  };
  for (const [name, fn] of Object.entries(store)) store[name] = async (...args) => { calls.push({ name, args }); return fn(...args); };
  const handler = createHandler({ env: environment, storeFactory: () => store, sourceFetcher: sourceFetcher || (async url => ({ requestedUrl: url })),
    modelFactory: modelFactory || (() => async () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable', status: 502 }); }),
    crossCheckFactory: crossCheckFactory || (() => async () => { throw failure('model_unavailable'); }),
    discoveryFactory: discoveryFactory || (() => async () => { throw failure('discovery_unavailable'); }),
    balanceReaderFactory,
    notificationFactory: notificationFactory || (() => async () => ({ responseCode: 200 })) });
  async function request(action, { method = 'GET', body, loggedIn = true, headers = {}, sourceId = id, query = {} } = {}) {
    const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, json(value) { this.body = value; }, end(value) { this.body = value; } };
    await handler({ method, query: { action, id: sourceId, ...query }, body, headers: { origin: env.NRGOPT_APP_ORIGIN, 'content-type': 'application/json', ...(loggedIn ? { cookie: '__Host-nrgopt_session=signed.test-token' } : {}), ...headers } }, res);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.match(res.headers['x-robots-tag'], /noindex/);
    return res;
  }
  return { request, calls };
}

test('private pages redirect, data and evidence deny unauthenticated access before upstream calls', async () => {
  const { request, calls } = setup();
  for (const action of ['page', 'overview-page', 'settings-page', 'detail-page']) {
    const response = await request(action, { loggedIn: false });
    assert.equal(response.code, 303);
    assert.match(response.headers.location, /^\/intelligence\/login\?returnTo=/);
    assert.equal(response.body, undefined);
  }
  for (const action of ['session', 'sources', 'source', 'overview', 'operations', 'provider-settings', 'provider-history', 'source-controls', 'evidence']) assert.equal((await request(action, { loggedIn: false })).code, 401);
  assert.deepEqual(calls, []);
});

test('source controls validate publisher, boolean, owner and write permission', async () => {
  const { request, calls } = setup();
  const listed = await request('source-controls');
  assert.equal(listed.body.sources.length, 5);
  const id = listed.body.sources[0].id;
  assert.equal((await request('save-source-control', { method: 'POST', body: { registry_id: id, paused: true } })).code, 200);
  assert.deepEqual(calls.find(call => call.name === 'setSourceControl').args, [admin, 'acwapower.com', true]);
  for (const body of [{ registry_id: 'arbitrary', paused: true }, { registry_id: id, paused: 'false' }]) {
    assert.equal((await request('save-source-control', { method: 'POST', body })).code, 400);
  }
  assert.equal((await request('save-source-control', { method: 'POST', body: { registry_id: id, paused: true }, headers: { origin: 'https://other.example' } })).code, 403);
  const disabled = setup({ environment: { ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' } });
  assert.equal((await disabled.request('save-source-control', { method: 'POST', body: { registry_id: id, paused: true } })).code, 403);
  assert.ok(!disabled.calls.some(call => call.name === 'setSourceControl'));
});

test('login cookie is secure, HttpOnly and bounded; tokens and keys never enter JSON', async () => {
  const { request } = setup();
  const page = await request('login-page', { loggedIn: false });
  assert.match(page.body, /<form id="login-form"[^>]*method="post"[^>]*action="\/api\/intelligence\?action=login"/);
  const response = await request('login', { method: 'POST', loggedIn: false, body: { email: 'local@example.test', password: 'test-password' } });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.match(response.headers['set-cookie'], /^__Host-nrgopt_session=/);
  for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=3600', 'Secure']) assert.ok(response.headers['set-cookie'].includes(flag));
});

test('wrong allowed user and revoked or invalid upstream session cannot access private data', async () => {
  const invalidCredentials = setup({ overrides: { login: async () => { throw failure('auth_required', 401); } } });
  const rejected = await invalidCredentials.request('login', { method: 'POST', loggedIn: false,
    body: { email: 'local@example.test', password: 'wrong-password' } });
  assert.equal(rejected.code, 401);
  assert.deepEqual(rejected.body, { error: 'login_failed', message: '邮箱或密码错误，或账号尚未确认。' });

  const wrong = setup({ overrides: { login: async () => ({ user: { id: 'other' }, access_token: 'token' }), user: async () => ({ id: 'other' }) } });
  const login = await wrong.request('login', { method: 'POST', body: { email: 'other@example.test', password: 'test-password' } });
  assert.equal(login.code, 403); assert.equal(login.headers['set-cookie'], undefined);
  assert.equal((await wrong.request('sources')).code, 403);
  assert.ok(!wrong.calls.some(call => call.name === 'list'));
  const expired = setup({ overrides: { user: async () => { throw failure('auth_required', 401); } } });
  assert.equal((await expired.request('detail-page')).code, 303);
  assert.equal((await expired.request('evidence')).code, 401);
});

test('mutations reject cross-origin or missing origin; bad methods cause no work', async () => {
  const { request, calls } = setup();
  for (const action of ['login', 'logout', 'import', 'annotate', 'extract', 'discover', 'save-provider-settings']) {
    for (const origin of ['https://attacker.example', undefined]) assert.equal((await request(action, { method: 'POST', body: {}, headers: { origin } })).code, 403);
    assert.equal((await request(action)).code, 405);
  }
  assert.equal((await request('sources', { method: 'POST', body: {} })).code, 405);
  assert.deepEqual(calls, []);
});

test('login accepts the current Vercel preview origin without weakening cross-origin rejection', async () => {
  const previewOrigin = 'https://nrgopt-commit-team.vercel.app';
  const previewEnv = { ...env, VERCEL_ENV: 'preview', VERCEL_URL: 'nrgopt-commit-team.vercel.app' };
  const { request } = setup({ environment: previewEnv });
  assert.equal((await request('login', { method: 'POST', body: { email: 'local@example.test', password: 'valid-password' },
    headers: { origin: previewOrigin } })).code, 200);
  assert.equal((await request('login', { method: 'POST', body: { email: 'local@example.test', password: 'valid-password' },
    headers: { origin: 'https://attacker.example' } })).code, 403);
});

test('MiniMax discovers official source links without requiring the user to know a URL', async () => {
  let options;
  let input;
  const { request } = setup({
    environment: { ...env, MINIMAX_API_KEY: 'test-minimax-key' },
    discoveryFactory: value => { options = value; return async value2 => { input = value2; return { model: 'MiniMax-M3', search_count: 1,
      usage: { input_tokens: 10, output_tokens: 5 }, results: [
        { title: 'Official award', url: 'https://www.spa.gov.sa/en/N1', excerpt: 'Award notice.' },
        { title: 'Secondary report', url: 'https://news.example/award', excerpt: 'Copied report.' }
      ] }; }; }
  });
  const response = await request('discover', { method: 'POST', body: { country: 'SA' } });
  assert.equal(response.code, 200);
  assert.equal(response.body.sources.length, 1);
  assert.equal(response.body.sources[0].url, 'https://www.spa.gov.sa/en/N1');
  assert.equal(response.body.sources[0].source_level, 'primary');
  assert.equal(options.apiKey, 'test-minimax-key');
  assert.equal(options.provider, 'minimax');
  assert.equal(options.model, 'coding-plan-search');
  assert.match(input.query, /Saudi Arabia/);
  assert.match(input.query, /site:spa\.gov\.sa/);
  assert.ok(!input.query.includes('Return original publications'));
  assert.equal((await request('discover', { method: 'POST', body: { country: 'US' } })).code, 400);
});

test('a successful search without official sources is distinct from a provider failure', async () => {
  const { request } = setup({ discoveryFactory: () => async () => ({ results: [
    { title: 'Secondary report', url: 'https://news.example/project' }
  ] }) });
  const response = await request('discover', { method: 'POST', body: { country: 'SA' } });
  assert.equal(response.code, 502);
  assert.equal(response.body.error, 'discovery_no_primary_sources');
});

test('scheduled Kuwait retry searches the project developer and still rejects secondary reports', async () => {
  let input;
  const { request } = setup({ environment: { ...env, CRON_SECRET: 'cron-test-secret', NRGOPT_SCHEDULER_ENABLED: '1' },
    overrides: {
      claimJobItem: async () => ({ id: 'item-kw', job_run_id: 'job-1', item_key: 'discover:KW', attempts: 2, checkpoint: {} }),
      jobRun: async () => ({ run: { status: 'running' }, items: [] })
    }, discoveryFactory: () => async value => { input = value; return { results: [
      { title: 'Developer announcement', url: 'https://www.acwapower.com/en/news/kuwait-project' },
      { title: 'Unverified repost', url: 'https://acwapower.com.attacker.example/news' }
    ] }; }
  });
  const result = await request('scheduled-scan', { loggedIn: false, headers: { authorization: 'Bearer cron-test-secret' } });
  assert.equal(result.code, 200);
  assert.equal(input.query, 'Kuwait energy projects site:acwapower.com');
  assert.equal(result.body.result.resultCount, 1);
});

test('paid manual calls stop before providers when budget is absent or exhausted', async () => {
  for (const current of [
    { environment: { ...env, NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '' }, overrides: {}, code: 503, error: 'budget_not_configured' },
    { environment: env, overrides: { reserveBudget: async () => null }, code: 409, error: 'budget_exhausted' }
  ]) {
    let providerCalled = false;
    const { request, calls } = setup({ ...current, discoveryFactory: () => async () => { providerCalled = true; return []; } });
    const response = await request('discover', { method: 'POST', body: { country: 'SA' } });
    assert.equal(response.code, current.code);
    assert.equal(response.body.error, current.error);
    assert.equal(providerCalled, false);
    assert.ok(!calls.some(call => call.name === 'settleBudget'));
  }
});

test('scheduled scan requires both its switch and secret, then consumes one persisted item', async () => {
  const disabled = setup();
  assert.equal((await disabled.request('scheduled-scan', { loggedIn: false })).code, 503);
  assert.deepEqual(disabled.calls, []);

  const schedulerEnv = { ...env, MINIMAX_API_KEY: 'test-minimax-key', NRGOPT_SCHEDULER_ENABLED: '1', CRON_SECRET: 'test-cron-secret' };
  const unauthorized = setup({ environment: schedulerEnv });
  assert.equal((await unauthorized.request('scheduled-scan', { loggedIn: false })).code, 401);
  assert.deepEqual(unauthorized.calls, []);

  const scheduled = setup({ environment: schedulerEnv,
    overrides: {
      claimJobItem: async () => ({ id: '55555555-5555-4555-8555-555555555555', item_key: 'discover:SA', attempts: 1, checkpoint: {} }),
      jobRun: async () => ({ run: { status: 'succeeded' }, items: [{ item_key: 'discover:SA', status: 'succeeded', attempts: 1, checkpoint: { result_urls: ['https://www.spa.gov.sa/en/N1'] }, error_code: null }] })
    },
    discoveryFactory: () => async () => ({ model: 'MiniMax-M3', search_count: 1, usage: { input_tokens: 10, output_tokens: 5 },
      results: [{ title: 'Official award', url: 'https://www.spa.gov.sa/en/N1', excerpt: 'Award notice.' }] }) });
  const response = await scheduled.request('scheduled-scan', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(response.code, 200);
  assert.equal(response.body.result.status, 'succeeded');
  assert.equal(response.body.result.country, 'SA');
  assert.ok(scheduled.calls.some(call => call.name === 'enqueueJob'));
  assert.ok(scheduled.calls.some(call => call.name === 'finishJobItem'));
  assert.equal(scheduled.calls.find(call => call.name === 'enqueueNotification').args[2], `daily:${response.body.scheduleKey}`);
});

test('independent health check records one system alert for a missing daily run', async () => {
  const healthEnv = { ...env, CRON_SECRET: 'test-cron-secret' };
  const missing = setup({ environment: healthEnv });
  const response = await missing.request('health-check', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(response.code, 200);
  assert.equal(response.body.health, 'missing');
  const alert = missing.calls.find(call => call.name === 'enqueueNotification');
  assert.equal(alert.args[0], admin);
  assert.equal(alert.args[1], 'system');
  assert.match(alert.args[2], /^system:daily-health:\d{4}-\d{2}-\d{2}:missing$/);
  assert.match(alert.args[3].issue_zh, /任务缺失/);

  const healthy = setup({ environment: healthEnv, overrides: { operations: async () => ({
    runs: [{ job_type: 'daily_scan', schedule_key: response.body.schedule_key, status: 'succeeded' }], items: [], budgets: [], notifications: []
  }) } });
  const ok = await healthy.request('health-check', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(ok.body.health, 'ok');
  assert.ok(!healthy.calls.some(call => call.name === 'enqueueNotification'));
});

test('notification worker records accepted and unknown delivery outcomes without blind retry', async () => {
  const disabled = setup();
  assert.equal((await disabled.request('notification-worker', { loggedIn: false })).code, 503);
  assert.deepEqual(disabled.calls, []);
  const workerEnv = { ...env, NRGOPT_FEISHU_ENABLED: '1', CRON_SECRET: 'test-cron-secret',
    FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook-value' };
  const notification = { id: '88888888-8888-4888-8888-888888888888', notification_type: 'daily', payload: { schedule_key: '2026-09-22', items: [] } };
  const accepted = setup({ environment: workerEnv, overrides: { claimNotification: async () => notification },
    notificationFactory: options => { assert.equal(options.webhookUrl, workerEnv.FEISHU_WEBHOOK_URL); return async () => ({ responseCode: 200 }); } });
  const response = await accepted.request('notification-worker', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(response.code, 200);
  assert.deepEqual(accepted.calls.find(call => call.name === 'finishNotification').args, [admin, notification.id, 'accepted', 200]);

  const unknown = setup({ environment: workerEnv, overrides: { claimNotification: async () => notification },
    notificationFactory: () => async () => { throw Object.assign(new Error('network'), { code: 'delivery_unknown' }); } });
  assert.equal((await unknown.request('notification-worker', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } })).code, 502);
  assert.deepEqual(unknown.calls.find(call => call.name === 'finishNotification').args, [admin, notification.id, 'unknown', null, 'delivery_result_unknown']);
});

test('archive worker is disabled by default and uses a separate bearer token when enabled', async () => {
  const disabled = setup();
  assert.equal((await disabled.request('archive-claim', { method: 'POST', loggedIn: false, body: { node_id: 'mac-mini' } })).code, 503);
  assert.deepEqual(disabled.calls, []);

  const archiveEnv = { ...env, NRGOPT_ARCHIVE_ENABLED: '1', NRGOPT_ARCHIVE_TOKEN: 'archive-secret' };
  const unauthorized = setup({ environment: archiveEnv });
  assert.equal((await unauthorized.request('archive-claim', { method: 'POST', loggedIn: false, body: { node_id: 'mac-mini' } })).code, 401);
  assert.deepEqual(unauthorized.calls, []);

  const bytes = Buffer.from('archived evidence');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const archiveId = '66666666-6666-4666-8666-666666666666';
  const archivedSource = { ...source, byte_size: bytes.length, content_sha256: hash, content_type: 'text/plain' };
  const active = setup({ environment: archiveEnv, overrides: {
    claimArchive: async () => ({ id: archiveId, source_id: id, requested_url: 'https://source.example', final_url: 'https://source.example', fetched_at: '2026-09-22T00:00:00Z', content_type: 'text/plain', byte_size: bytes.length, content_sha256: hash }),
    archiveJob: async () => ({ id: archiveId, source_id: id }), evidence: async () => ({ source: archivedSource, bytes })
  } });
  const auth = { authorization: 'Bearer archive-secret' };
  const claimed = await active.request('archive-claim', { method: 'POST', loggedIn: false, headers: auth, body: { node_id: 'mac-mini' } });
  assert.equal(claimed.code, 200);
  assert.match(claimed.body.job.download_url, /archive-object/);
  const object = await active.request('archive-object', { loggedIn: false, headers: auth, sourceId: archiveId, query: { node_id: 'mac-mini' } });
  assert.equal(object.code, 200);
  assert.deepEqual(object.body, bytes);
  const ack = await active.request('archive-ack', { method: 'POST', loggedIn: false, headers: auth,
    body: { id: archiveId, node_id: 'mac-mini', byte_size: bytes.length, content_sha256: hash } });
  assert.equal(ack.code, 200);
  assert.deepEqual(active.calls.find(call => call.name === 'completeArchive').args, [admin, archiveId, 'mac-mini', bytes.length, hash]);
});

test('private read passes owner filter and server HTML never embeds source data', async () => {
  const { request, calls } = setup();
  const list = await request('sources');
  assert.deepEqual(list.body, { sources: [source] });
  assert.deepEqual(calls.find(call => call.name === 'list').args, [admin]);
  await request('source');
  assert.deepEqual(calls.find(call => call.name === 'get').args, [id, admin]);
  assert.deepEqual(calls.find(call => call.name === 'candidateBySource').args, [id, admin]);
  assert.deepEqual(calls.find(call => call.name === 'sourceHistory').args, [id, admin]);
  await request('overview');
  assert.deepEqual(calls.find(call => call.name === 'candidates').args, [admin]);
  const operations = await request('operations');
  assert.deepEqual(operations.body, { runs: [], items: [], budgets: [], notifications: [], scheduler_enabled: false });
  assert.deepEqual(calls.find(call => call.name === 'operations').args, [admin]);
  const overviewPage = await request('overview-page');
  assert.match(overviewPage.body, /三个雷达分别看什么/);
  assert.match(overviewPage.body, /为什么现在值得关注/);
  assert.match(overviewPage.body, /谁需要解决什么问题/);
  assert.match(overviewPage.body, /项目到了哪一步/);
  assert.match(overviewPage.body, /机会、采购、合同和交付属于后续商业阶段/);
  assert.match(overviewPage.body, /不要求逐级升级/);
  assert.match(overviewPage.body, /任务与预算状态/);
  const page = await request('detail-page');
  assert.match(page.body, /中文注释/);
  assert.match(page.body, /查看英文原文摘录/);
  assert.ok(!page.body.includes(source.title));
  assert.equal((await request('source', { sourceId: '../secret' })).code, 400);
});

test('imports stay disabled by default and in production without the release switch', async () => {
  for (const environment of [{ ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' }, { ...env, VERCEL_ENV: 'production' }]) {
    let fetched = false;
    const { request, calls } = setup({ environment, sourceFetcher: async () => { fetched = true; } });
    assert.equal((await request('import', { method: 'POST', body: { url: 'https://source.example/article' } })).code, 403);
    assert.equal(fetched, false);
    assert.ok(!calls.some(call => call.name === 'save'));
  }
  const released = setup({ environment: { ...env, VERCEL_ENV: 'production', NRGOPT_INTELLIGENCE_PRODUCTION_WRITE_ENABLED: '1' } });
  assert.equal((await released.request('import', { method: 'POST', body: { url: 'https://source.example/article' } })).code, 201);
  assert.ok(released.calls.some(call => call.name === 'save'));
});

test('manual Chinese annotation is owner-scoped, length-limited and never presented as model output', async () => {
  const { request, calls } = setup();
  const note = '宏观行业背景；下一步核对海合会国家、项目主体和采购信号。';
  const response = await request('annotate', { method: 'POST', body: { note } });
  assert.equal(response.code, 200);
  assert.equal(response.body.source.annotation_zh, note);
  assert.deepEqual(calls.find(call => call.name === 'annotate').args, [id, admin, note]);
  assert.equal((await request('annotate', { method: 'POST', sourceId: '../secret', body: { note } })).code, 400);
  assert.equal((await request('annotate', { method: 'POST', body: { note: '甲'.repeat(2001) } })).code, 400);
  const page = await request('detail-page');
  assert.match(page.body, /可选补充/);
  assert.match(page.body, /不要求人工审批/);
  assert.ok(!page.body.includes(note));
});

test('model extraction reads saved evidence, records processing and persists only validated output', async () => {
  const bytes = Buffer.from('<html><main>Official source fact with enough exact evidence for validation.</main></html>');
  const saved = { ...source, title: 'Official source', final_url: 'https://source.example/news', content_type: 'text/html', content_sha256: createHash('sha256').update(bytes).digest('hex') };
  const extraction = { summary_zh: '中文摘要', why_it_matters_zh: '为什么重要', known_facts: [], unknowns_zh: [], hypotheses: [], next_signals_zh: [], gcc_relevance_zh: '待核对', maturity: 'background', caution_zh: '待人工核对' };
  let modelInput;
  const { request, calls } = setup({
    overrides: { evidence: async () => ({ source: saved, bytes }) },
    modelFactory: options => {
      assert.equal(options.apiKey, env.DEEPSEEK_API_KEY);
      return async input => { modelInput = input; return { extraction, provider: 'deepseek', model: 'deepseek-flash', usage: { prompt_tokens: 10, completion_tokens: 5 } }; };
    }
  });
  const response = await request('extract', { method: 'POST', body: {} });
  assert.equal(response.code, 200);
  assert.equal(response.body.source.extraction_status, 'extracted');
  assert.match(modelInput.sourceText, /Official source fact/);
  assert.deepEqual(calls.find(call => call.name === 'beginExtraction').args, [id, admin]);
  assert.equal(calls.find(call => call.name === 'saveExtraction').args[3], saved.content_sha256);
  assert.deepEqual(calls.find(call => call.name === 'saveCandidate').args, [id, admin, extraction, saved.content_sha256]);
});

test('provider-neutral pages describe capabilities instead of fixed vendors', async () => {
  const { request } = setup();
  const sources = await request('page');
  const detail = await request('detail-page');
  const settingsPage = await request('settings-page');
  assert.match(sources.body, /已配置的联网来源发现服务/);
  assert.match(sources.body, /已配置的情报分析服务/);
  assert.match(detail.body, /情报分析服务 · 单一来源分析/);
  assert.ok(!sources.body.includes('MiniMax'));
  assert.ok(!sources.body.includes('DeepSeek'));
  assert.ok(!detail.body.includes('DeepSeek'));
  assert.match(settingsPage.body, /模型服务配置/);
  assert.match(settingsPage.body, /API Key 是只写字段/);
  assert.match(settingsPage.body, /人民币 CNY/);
  assert.match(settingsPage.body, /美元 USD/);
  assert.match(settingsPage.body, /每月金额上限/);
  assert.ok(!settingsPage.body.includes('单次预留上限'));
});

test('private settings save an encrypted write-only key and override the environment profile', async () => {
  const rows = [];
  let discoveryOptions;
  const configured = setup({ overrides: {
    providerConfigs: async () => rows,
    saveProviderConfig: async (_owner, record) => {
      const index = rows.findIndex(item => item.capability === record.capability);
      if (index >= 0) rows[index] = record; else rows.push(record);
      return record;
    }
  }, discoveryFactory: options => {
    discoveryOptions = options;
    return async () => ({ provider: options.provider, model: options.model, search_count: 1, usage: {},
      results: [{ title: 'Official award', url: 'https://www.spa.gov.sa/en/N1' }] });
  } });
  const input = { capability: 'discovery', provider: 'custom-search', endpoint: 'https://search.example/v1/messages',
    model: 'search-v2', currency: 'USD', billing_mode: 'balance', budget_limit_micro: 125000, api_key: 'private-browser-key' };
  const saved = await configured.request('save-provider-settings', { method: 'POST', body: input });
  assert.equal(saved.code, 200);
  assert.equal(saved.body.profile.key_source, 'saved');
  assert.equal(saved.body.profile.key_configured, true);
  assert.ok(!JSON.stringify(saved.body).includes(input.api_key));
  assert.ok(!rows[0].api_key_ciphertext.includes(input.api_key));
  const resolved = providerSettingsWithSaved(env, rows, admin);
  assert.equal(resolved.discovery.apiKey, input.api_key);
  assert.equal(resolved.discovery.provider, input.provider);
  assert.equal(resolved.discovery.currency, 'USD');
  assert.equal(resolved.discovery.budgetLimitMicro, input.budget_limit_micro);
  const discovery = await configured.request('discover', { method: 'POST', body: { country: 'SA' } });
  assert.equal(discovery.code, 200);
  assert.equal(discoveryOptions.apiKey, input.api_key);
  assert.equal(discoveryOptions.endpoint, input.endpoint);
  assert.equal(discoveryOptions.model, input.model);
  const reservation = configured.calls.find(call => call.name === 'reserveBudget');
  assert.equal(reservation.args[3], 'USD');
  assert.equal(reservation.args[5], input.budget_limit_micro);

  const ciphertext = rows[0].api_key_ciphertext;
  const updated = await configured.request('save-provider-settings', { method: 'POST', body: { ...input, model: 'search-v3', api_key: '' } });
  assert.equal(updated.body.profile.model, 'search-v3');
  assert.equal(rows[0].api_key_ciphertext, ciphertext);
  const read = await configured.request('provider-settings');
  assert.equal(read.body.profiles.find(item => item.capability === 'discovery').key_source, 'saved');
  assert.ok(!JSON.stringify(read.body).includes(input.api_key));

  const invalid = await configured.request('save-provider-settings', { method: 'POST', body: { ...input, endpoint: 'http://search.example/messages' } });
  assert.equal(invalid.code, 400);
  assert.equal(rows.length, 1);
});

test('first web save can retain an existing server key without asking the user to enter it again', async () => {
  let savedRecord;
  const environment = { ...env, MINIMAX_API_KEY: 'existing-server-key' };
  const configured = setup({ environment, overrides: {
    providerConfigs: async () => [],
    saveProviderConfig: async (_owner, record) => { savedRecord = record; return record; }
  } });
  const response = await configured.request('save-provider-settings', { method: 'POST', body: {
    capability: 'discovery', provider: 'minimax', endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
    model: 'MiniMax-M3', currency: 'CNY', billing_mode: 'included', budget_limit_micro: 10_000_000, api_key: ''
  } });
  assert.equal(response.code, 200);
  assert.equal(response.body.profile.key_source, 'saved');
  assert.ok(savedRecord.api_key_ciphertext);
  assert.ok(!savedRecord.api_key_ciphertext.includes(environment.MINIMAX_API_KEY));
  assert.equal(providerSettingsWithSaved(environment, [savedRecord], admin).discovery.apiKey, environment.MINIMAX_API_KEY);
});

test('generic provider environment overrides legacy keys and request metadata', async () => {
  const customEnv = { ...env, NRGOPT_DISCOVERY_API_KEY: 'generic-discovery-key', NRGOPT_DISCOVERY_PROVIDER: 'search-service',
    NRGOPT_DISCOVERY_ENDPOINT: 'https://search.example/v1/messages', NRGOPT_DISCOVERY_MODEL: 'search-v2',
    NRGOPT_DISCOVERY_CURRENCY: 'CNY', NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000' };
  let options;
  const { request } = setup({ environment: customEnv, discoveryFactory: value => { options = value; return async () => ({
    provider: value.provider, model: value.model, search_count: 1, usage: {}, results: [
      { title: 'Official award', url: 'https://www.spa.gov.sa/en/N1' }
    ] }); } });
  assert.equal((await request('discover', { method: 'POST', body: { country: 'SA' } })).code, 200);
  assert.equal(options.apiKey, 'generic-discovery-key');
  assert.equal(options.provider, 'search-service');
  assert.equal(options.endpoint, 'https://search.example/v1/messages');
  assert.equal(options.model, 'search-v2');
});

test('a plausible second source is cross-checked and linked without requiring human approval', async () => {
  const bytes = Buffer.from('<html><main>Official source fact with enough exact evidence for validation.</main></html>');
  const saved = { ...source, title: 'Official source', final_url: 'https://source.example/news', content_type: 'text/html', content_sha256: createHash('sha256').update(bytes).digest('hex') };
  const extraction = { summary_zh: '中文摘要', why_it_matters_zh: '为什么重要', known_facts: [{ claim_zh: '项目容量一致。', evidence_quote: 'Official source fact with enough exact evidence for validation.' }], unknowns_zh: ['待观察。'], hypotheses: [], next_signals_zh: ['继续观察。'], gcc_relevance_zh: '沙特项目。', maturity: 'contract', caution_zh: '自动核对。', classification: { disposition: 'candidate', radars: ['project'], countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '位于沙特。', evidence_fact_number: 1 }], importance: 'high', evidence_status: 'unverified', urgency: 'research', title_zh: 'Haden 储能项目', organizations: [{ canonical_name: 'ACWA Power', role_zh: '开发商', evidence_fact_number: 1 }], project: { name_zh: 'Haden 储能项目', stage_zh: '签约', evidence_fact_number: 1 }, procurement: null } };
  const candidate = { id: '33333333-3333-4333-8333-333333333333', source_id: id, ...extraction.classification, project_zh: extraction.classification.project, organizations_zh: extraction.classification.organizations, occurrence_countries: ['SA'] };
  const peer = { id: '44444444-4444-4444-8444-444444444444', source_id: '55555555-5555-4555-8555-555555555555', extraction_zh: extraction };
  let crossInput;
  const { request, calls } = setup({
    overrides: { evidence: async () => ({ source: saved, bytes }), saveCandidate: async () => candidate, findCandidatePeers: async () => [peer] },
    modelFactory: () => async () => ({ extraction, provider: 'deepseek', model: 'deepseek-flash', usage: {} }),
    crossCheckFactory: () => async input => { crossInput = input; return { same_project: true, matching_facts: [{ left_fact_number: 1, right_fact_number: 1, reason_zh: '项目与容量一致。' }], conflicting_facts: [] }; }
  });
  assert.equal((await request('extract', { method: 'POST', body: {} })).code, 200);
  assert.equal(crossInput.left.id, candidate.id);
  assert.equal(crossInput.right.id, peer.id);
  assert.deepEqual(calls.find(call => call.name === 'saveCrossCheck').args.slice(0, 3), [candidate.id, peer.id, admin]);
});

test('model failures save only a stable failure state and never persist extraction output', async () => {
  const bytes = Buffer.from('<html><main>Official source evidence.</main></html>');
  const saved = { ...source, content_type: 'text/html', content_sha256: createHash('sha256').update(bytes).digest('hex') };
  const { request, calls } = setup({
    overrides: { evidence: async () => ({ source: saved, bytes }) },
    modelFactory: () => async () => { throw Object.assign(new Error('private provider response'), { code: 'extraction_invalid_known_fact_quote', status: 422 }); }
  });
  const response = await request('extract', { method: 'POST', body: {} });
  assert.equal(response.code, 422);
  assert.deepEqual(response.body, { error: 'extraction_invalid_known_fact_quote', message: '模型给出的原文引文与来源正文不一致，未保存本次结果。' });
  assert.deepEqual(calls.find(call => call.name === 'failExtraction').args, [id, admin, 'extraction_invalid_known_fact_quote']);
  assert.ok(!calls.some(call => call.name === 'saveExtraction'));
  assert.ok(!JSON.stringify(response.body).includes('private provider response'));
});

test('real source path preserves pending status and reports existing version without claiming extraction', async () => {
  const { request, calls } = setup();
  const response = await request('import', { method: 'POST', body: { url: 'https://source.example/article' } });
  assert.equal(response.code, 201);
  assert.equal(response.body.source.status, 'pending_extraction');
  assert.deepEqual(calls.find(call => call.name === 'save').args, [{ requestedUrl: 'https://source.example/article' }, admin]);
  const duplicate = setup({ overrides: { save: async () => ({ source, reused: true }) } });
  assert.equal((await duplicate.request('import', { method: 'POST', body: { url: 'https://source.example/article' } })).code, 200);
});

test('invalid URLs never fetch; fetch failures are persisted with sanitized errors', async () => {
  let fetched = false;
  const { request, calls } = setup({ sourceFetcher: async () => { fetched = true; throw Object.assign(new Error('secret upstream debug'), { code: 'source_timeout' }); } });
  for (const url of ['http://source.example', 'https://127.0.0.1', 'https://user:password@source.example']) {
    assert.equal((await request('import', { method: 'POST', body: { url } })).code, 400);
  }
  assert.equal(fetched, false);
  const response = await request('import', { method: 'POST', body: { url: 'https://source.example' } });
  assert.equal(response.code, 422);
  assert.deepEqual(calls.find(call => call.name === 'recordFailure').args, ['https://source.example', admin, 'source_timeout']);
  assert.ok(!JSON.stringify(response.body).includes('secret'));
});

test('evidence uses download sandbox, owner filter and verifies exact bytes', async () => {
  const bytes = Buffer.from('<script>untrusted</script>');
  const saved = { ...source, content_type: 'text/html', content_sha256: createHash('sha256').update(bytes).digest('hex') };
  const { request, calls } = setup({ overrides: { evidence: async () => ({ source: saved, bytes }) } });
  const response = await request('evidence');
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, bytes);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.match(response.headers['content-disposition'], /^attachment;/);
  assert.equal(response.headers['content-security-policy'], 'sandbox');
  assert.deepEqual(calls.find(call => call.name === 'evidence').args, [id, admin]);
  const corrupt = setup({ overrides: { evidence: async () => ({ source: saved, bytes: Buffer.from('different') }) } });
  assert.equal((await corrupt.request('evidence')).code, 502);
});

test('logout removes local cookie even if upstream fails and configuration fails closed', async () => {
  const { request } = setup({ overrides: { logout: async () => { throw new Error('unavailable'); } } });
  const response = await request('logout', { method: 'POST' });
  assert.equal(response.code, 200);
  assert.match(response.headers['set-cookie'], /Max-Age=0/);
  const missing = setup({ environment: { NRGOPT_APP_ORIGIN: env.NRGOPT_APP_ORIGIN } });
  assert.equal((await missing.request('sources')).code, 503);
  assert.equal((await missing.request('login-page', { loggedIn: false })).code, 200);
});

test('scheduler summary belongs to the resumed run, not the newly enqueued date', async () => {
  const oldJob = '66666666-6666-4666-8666-666666666666';
  const { request, calls } = setup({ environment: { ...env, NRGOPT_SCHEDULER_ENABLED: '1', CRON_SECRET: 'test-secret' },
    overrides: {
      claimJobItem: async () => ({ id, job_run_id: oldJob, item_key: 'invalid-item', attempts: 1, checkpoint: {} }),
      jobRun: async () => ({ run: { status: 'failed', schedule_key: '2000-01-01' }, items: [] })
    } });
  const response = await request('scheduled-scan', { loggedIn: false, headers: { authorization: 'Bearer test-secret' } });
  assert.equal(response.code, 200);
  assert.deepEqual(calls.filter(call => call.name === 'jobRun').at(-1).args, [admin, oldJob]);
  const notification = calls.find(call => call.name === 'enqueueNotification').args;
  assert.equal(notification[2], 'daily:2000-01-01');
  assert.equal(notification[3].job_id, oldJob);
});
