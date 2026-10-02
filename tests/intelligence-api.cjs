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
  balanceReaderFactory = () => async () => 1_000_000, notificationFactory, feishuChecker } = {}) {
  const calls = [];
  const store = {
    sourceControls: async () => [], setSourceControl: async () => 0,
    login: async () => ({ user: { id: admin }, access_token: 'signed.test-token', expires_in: 7200 }),
    requestPasswordReset: async () => ({}), resetPassword: async () => ({ id: admin }),
    user: async () => ({ id: admin, email: 'local@example.test' }),
    logout: async () => {}, list: async () => [source], get: async () => source,
    dailyTasks: async () => ({ run: null, items: [] }), candidates: async () => [], currentOpportunities: async () => [], operations: async () => ({ runs: [], items: [], budgets: [], notifications: [] }), candidateBySource: async () => null, projectTimeline: async () => ({ entries: [] }), analysisRevisions: async () => [], sourceHistory: async () => [], businessHistory: async () => [], previousExtractedSource: async () => null, findCandidatePeers: async () => [], assessmentTargets: async () => [], saveCrossCheck: async () => ({}),
    providerHistory: async () => ({ versions: [], calls: [] }),
    feishuConfig: async () => null, notificationHistory: async () => [], saveFeishuConfig: async (_owner, revision, config) => ({ ...config, revision: revision + 1 }),
    notificationSettings: async () => ({ quiet_enabled: true, quiet_start_hour: 23, quiet_end_hour: 7, timezone: 'Asia/Shanghai', flash_breaks_quiet: false }),
    saveNotificationSettings: async (_owner, record) => record,
    providerConfigs: async () => [], saveProviderConfig: async (_owner, record) => record,
    save: async () => ({ source, reused: false }), annotate: async (_id, _owner, note) => ({ ...source, annotation_zh: note, annotation_updated_at: '2026-09-22T00:00:00.000Z' }),
    beginExtraction: async () => {}, saveExtraction: async (_id, _owner, result) => ({ ...source, extraction_status: 'extracted', extraction_zh: result.extraction }),
    saveCandidate: async () => ({}),
    sourceLibrary: async () => [], snapshotDirections: async () => null, bindDirectionSource: async () => {}, sourceDirections: async () => [],
    reviewTracking: async () => ({}), watchedSources: async () => [], watchSearchTargets: async () => [], enqueueJob: async () => '33333333-3333-4333-8333-333333333333', enqueueJobItems: async () => 0,
    claimJobItem: async () => null, finishJobItem: async () => true,
    startProviderCall: async () => true, finishProviderCall: async () => true,
    reserveBudget: async () => '44444444-4444-4444-8444-444444444444', settleBudget: async () => true, releaseBudget: async () => true,
    syncProviderBalance: async () => true,
    claimArchive: async () => null, archiveJob: async () => null, completeArchive: async () => true, failArchive: async () => true,
    jobRun: async () => ({ run: { status: 'running' }, items: [] }), enqueueDailyDigest: async () => '77777777-7777-4777-8777-777777777777', enqueueNotification: async () => '77777777-7777-4777-8777-777777777777',
    claimNotification: async () => null, finishNotification: async () => true, recordNotificationTarget: async () => true,
    failExtraction: async () => {}, recordFailure: async () => {}, ...overrides
  };
  for (const [name, fn] of Object.entries(store)) store[name] = async (...args) => { calls.push({ name, args }); return fn(...args); };
  const handler = createHandler({ env: environment, storeFactory: () => store, sourceFetcher: sourceFetcher || (async url => ({ requestedUrl: url })),
    modelFactory: modelFactory || (() => async () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable', status: 502 }); }),
    crossCheckFactory: crossCheckFactory || (() => async () => { throw failure('model_unavailable'); }),
    discoveryFactory: discoveryFactory || (() => async () => { throw failure('discovery_unavailable'); }),
    balanceReaderFactory,
    feishuChecker: feishuChecker || (async () => ({ message: '凭据有效，未发消息' })),
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
  for (const action of ['engine-page', 'page', 'overview-page', 'settings-page', 'detail-page']) {
    const response = await request(action, { loggedIn: false });
    assert.equal(response.code, 303);
    assert.match(response.headers.location, /^\/intelligence\/login\?returnTo=/);
    assert.equal(response.body, undefined);
    if (action === 'engine-page') assert.equal(response.headers.location, '/intelligence/login?returnTo=%2Fintelligence%2Fengine');
  }
  for (const action of ['session', 'sources', 'source', 'overview', 'operations', 'provider-settings', 'provider-history', 'notification-settings', 'source-controls', 'evidence']) assert.equal((await request(action, { loggedIn: false })).code, 401);
  assert.deepEqual(calls, []);
});

test('quiet-hour settings validate hours, timezone and owner without enabling delivery', async () => {
  const { request, calls } = setup();
  const read = await request('notification-settings');
  assert.equal(read.body.delivery_enabled, false);
  assert.equal(read.body.settings.quiet_start_hour, 23);
  const input = { quiet_enabled: true, quiet_start_hour: 22, quiet_end_hour: 8, timezone: 'Asia/Riyadh', flash_breaks_quiet: false };
  assert.equal((await request('save-notification-settings', { method: 'POST', body: { ...input, owner_id: 'other-owner' } })).code, 200);
  assert.deepEqual(calls.find(call => call.name === 'saveNotificationSettings').args, [admin, input]);
  for (const patch of [{ quiet_start_hour: 24 }, { quiet_end_hour: -1 }, { quiet_end_hour: 22 }, { quiet_start_hour: 22.5 },
    { timezone: 'unsupported' }, { quiet_enabled: 'false' }, { flash_breaks_quiet: 1 }]) {
    assert.equal((await request('save-notification-settings', { method: 'POST', body: { ...input, ...patch } })).code, 400);
  }
  assert.equal((await request('save-notification-settings', { method: 'POST', body: input, loggedIn: false })).code, 401);
  assert.equal((await request('save-notification-settings', { method: 'POST', body: input, headers: { origin: 'https://other.example' } })).code, 403);
  const disabled = setup({ environment: { ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' } });
  assert.equal((await disabled.request('save-notification-settings', { method: 'POST', body: input })).code, 403);
  assert.ok(!disabled.calls.some(call => call.name === 'saveNotificationSettings'));
  assert.ok(!calls.some(call => ['claimNotification', 'finishNotification'].includes(call.name)));
});

test('source controls validate publisher, boolean, owner and write permission', async () => {
  const { request, calls } = setup();
  const listed = await request('source-controls');
  assert.equal(listed.body.sources.length, 15);
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
  assert.match(page.body, /id="reset-request-button"/);
  const response = await request('login', { method: 'POST', loggedIn: false, body: { email: 'local@example.test', password: 'test-password' } });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.match(response.headers['set-cookie'], /^__Host-nrgopt_session=/);
  for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=3600', 'Secure']) assert.ok(response.headers['set-cookie'].includes(flag));
});

test('password recovery uses the production callback and changes only the configured admin password', async () => {
  const { request, calls } = setup();
  const page = await request('reset-password-page', { loggedIn: false });
  assert.match(page.body, /<form id="reset-password-form"[^>]*action="\/api\/intelligence\?action=reset-password"/);
  const requested = await request('request-password-reset', { method: 'POST', loggedIn: false,
    body: { email: 'local@example.test' } });
  assert.equal(requested.code, 200);
  assert.deepEqual(requested.body, { ok: true, message: '如果该邮箱已注册，重置邮件已发送。' });
  assert.deepEqual(calls.find(call => call.name === 'requestPasswordReset').args,
    ['local@example.test', 'https://preview.example/intelligence/reset-password']);

  const changed = await request('reset-password', { method: 'POST', loggedIn: false,
    body: { token: 'recovery.token', password: 'new-password' } });
  assert.equal(changed.code, 200);
  assert.deepEqual(calls.find(call => call.name === 'resetPassword').args, ['recovery.token', 'new-password']);
  assert.equal(changed.headers['set-cookie'], undefined);
});

test('password recovery rejects bad tokens, expired links and a different user', async () => {
  const invalid = setup();
  assert.equal((await invalid.request('reset-password', { method: 'POST', loggedIn: false,
    body: { token: 'bad token', password: 'new-password' } })).code, 400);
  assert.ok(!invalid.calls.some(call => call.name === 'resetPassword'));

  const expired = setup({ overrides: { resetPassword: async () => { throw failure('auth_required', 401); } } });
  const expiredResponse = await expired.request('reset-password', { method: 'POST', loggedIn: false,
    body: { token: 'expired.token', password: 'new-password' } });
  assert.equal(expiredResponse.code, 401);
  assert.equal(expiredResponse.body.error, 'password_reset_failed');

  const wrong = setup({ overrides: { resetPassword: async () => ({ id: 'other' }) } });
  assert.equal((await wrong.request('reset-password', { method: 'POST', loggedIn: false,
    body: { token: 'recovery.token', password: 'new-password' } })).code, 403);
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
  assert.equal((await wrong.request('engine-page')).code, 403);
  assert.ok(!wrong.calls.some(call => call.name === 'list'));
  const expired = setup({ overrides: { user: async () => { throw failure('auth_required', 401); } } });
  assert.equal((await expired.request('detail-page')).code, 303);
  assert.equal((await expired.request('evidence')).code, 401);
});

test('mutations reject cross-origin or missing origin; bad methods cause no work', async () => {
  const { request, calls } = setup();
  for (const action of ['login', 'logout', 'request-password-reset', 'reset-password', 'import', 'annotate', 'extract', 'discover', 'save-provider-settings']) {
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

test('MiniMax discovers public source links beyond fixed publishers', async () => {
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
  assert.equal(response.body.sources.length, 2);
  assert.equal(response.body.sources[0].url, 'https://www.spa.gov.sa/en/N1');
  assert.equal(response.body.sources[0].source_level, 'unverified');
  assert.equal(options.apiKey, 'test-minimax-key');
  assert.equal(options.provider, 'minimax');
  assert.equal(options.model, 'coding-plan-search');
  assert.match(input.query, /Saudi Arabia/);
  assert.ok(!input.query.includes('site:'));
  assert.ok(!input.query.includes('Return original publications'));
  assert.equal((await request('discover', { method: 'POST', body: { country: 'US' } })).code, 400);
});

test('a successful empty search is not retried as a provider failure', async () => {
  const { request } = setup({ discoveryFactory: () => async () => ({ results: [
    { title: 'Unsafe link', url: 'http://127.0.0.1/project' }
  ] }) });
  const response = await request('discover', { method: 'POST', body: { country: 'SA' } });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body.sources, []);
});

test('scheduled Kuwait retry allows media without relaxing URL safety', async () => {
  let input;
  const { request } = setup({ environment: { ...env, CRON_SECRET: 'cron-test-secret', NRGOPT_SCHEDULER_ENABLED: '1' },
    overrides: {
      claimJobItem: async () => ({ id: 'item-kw', job_run_id: 'job-1', item_key: 'discover:KW', attempts: 2, checkpoint: {} }),
      jobRun: async () => ({ run: { status: 'running' }, items: [] })
    }, discoveryFactory: () => async value => { input = value; return { results: [
      { title: 'Developer announcement', url: 'https://www.acwapower.com/en/news/kuwait-project' },
      { title: 'Unverified repost', url: 'http://127.0.0.1/news' }
    ] }; }
  });
  const result = await request('scheduled-scan', { loggedIn: false, headers: { authorization: 'Bearer cron-test-secret' } });
  assert.equal(result.code, 200);
  assert.match(input.query, /^Kuwait \(regulation OR security OR industry/);
  assert.ok(!input.query.includes('site:'));
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
  assert.deepEqual(scheduled.calls.find(call => call.name === 'enqueueDailyDigest').args, [admin, response.body.result.jobId || response.body.jobId]);
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

  const healthy = setup({ environment: healthEnv, overrides: { dailyTasks: async () => ({
    run: { status: 'succeeded' }, items: []
  }) } });
  const ok = await healthy.request('health-check', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(ok.body.health, 'ok');
  assert.ok(!healthy.calls.some(call => call.name === 'enqueueNotification'));
});

test('notification worker records accepted and unknown delivery outcomes without blind retry', async () => {
  const disabled = setup();
  assert.equal((await disabled.request('notification-worker', { loggedIn: false })).code, 401);
  assert.deepEqual(disabled.calls, []);
  const workerEnv = { ...env, NRGOPT_FEISHU_ENABLED: '1', CRON_SECRET: 'test-cron-secret',
    FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook-value' };
  const notification = { id: '88888888-8888-4888-8888-888888888888', notification_type: 'daily', payload: { schedule_key: '2026-09-22', items: [] } };
  const accepted = setup({ environment: workerEnv, overrides: { claimNotification: async () => notification },
    notificationFactory: options => { assert.equal(options.webhookUrl, workerEnv.FEISHU_WEBHOOK_URL); return async input => {
      await input.onTargetAccepted({ target: 'chat', responseCode: 200, messageId: 'om_test' });
      return { responseCode: 200, messageId: 'om_test', messageIds: ['om_test'], chatId: 'oc_test' };
    }; } });
  const response = await accepted.request('notification-worker', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(response.code, 200);
  assert.equal(response.body.message_id, 'om_test');
  assert.deepEqual(response.body.message_ids, ['om_test']);
  assert.equal(response.body.chat_id, 'oc_test');
  assert.deepEqual(accepted.calls.find(call => call.name === 'recordNotificationTarget').args,
    [admin, notification.id, notification.payload, { target: 'chat', responseCode: 200, messageId: 'om_test' }]);
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
  assert.deepEqual((await request('overview')).body.user, { email: 'local@example.test' });
  assert.deepEqual(calls.find(call => call.name === 'candidates').args, [admin]);
  assert.deepEqual(calls.find(call => call.name === 'currentOpportunities').args, [admin, []]);
  const operations = await request('operations');
  assert.deepEqual(operations.body, { runs: [], items: [], budgets: [], notifications: [], fixed_source_countries: [...new Set(require('../lib/intelligence/registry.cjs').registry.map(item => item.country))], scheduler_enabled: false, archive_status: 'disabled' });
  assert.deepEqual(calls.find(call => call.name === 'operations').args, [admin]);
  const overviewPage = await request('discover-page');
  assert.match(overviewPage.body, /发现情报/);
  assert.match(overviewPage.body, />工作台总览</);
  assert.match(overviewPage.body, />早期信号</);
  assert.match(overviewPage.body, /浏览近期变化/);
  assert.match(overviewPage.body, /id="radar-demand-count"/);
  assert.match(overviewPage.body, /id="radar-project-count"/);
  assert.match(overviewPage.body, /id="opportunity-count"/);
  assert.doesNotMatch(overviewPage.body, /跨来源核对/);
  const settingsPage = await request('settings-page');
  assert.match(settingsPage.body, /系统运行状态/);
  assert.match(settingsPage.body, /查看最近计划日和故障诊断明细/);
  const page = await request('detail-page');
  assert.match(page.body, /中文注释/);
  assert.match(page.body, /区域变化与能源韧性路径/);
  assert.match(page.body, /查看来源原文摘录/);
  assert.ok(!page.body.includes(source.title));
  assert.equal((await request('source', { sourceId: '../secret' })).code, 400);
});

test('archive readiness distinguishes missing credentials and read-only deployments without exposing the token', async () => {
  for (const [extra, expected] of [
    [{ NRGOPT_ARCHIVE_ENABLED: '1' }, 'missing_token'],
    [{ NRGOPT_ARCHIVE_ENABLED: '1', NRGOPT_ARCHIVE_TOKEN: 'private-token', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' }, 'read_only'],
    [{ NRGOPT_ARCHIVE_ENABLED: '1', NRGOPT_ARCHIVE_TOKEN: 'private-token' }, 'enabled']
  ]) {
    const { request } = setup({ environment: { ...env, ...extra } });
    const result = await request('operations');
    assert.equal(result.body.archive_status, expected);
    assert.equal(JSON.stringify(result.body).includes('private-token'), false);
    assert.equal((await request('operations', { loggedIn: false })).code, 401);
  }
});

test('overview login keeps allowed filters and discards unknown redirect parameters', async () => {
  const { request } = setup();
  const result = await request('overview-page', { loggedIn: false, query: { country: 'QA', radar: 'demand', period: 'all', next: 'https://other.example' } });
  assert.equal(new URL(result.headers.location, 'https://preview.example').searchParams.get('returnTo'), '/intelligence/overview?country=QA&view=demand&period=all');
  const opportunity = await request('overview-page', { loggedIn: false, query: { view: 'opportunity' } });
  assert.equal(new URL(opportunity.headers.location, 'https://preview.example').searchParams.get('returnTo'), '/intelligence/overview?view=opportunity');
  const invalid = await request('overview-page', { loggedIn: false, query: { country: '//other.example', radar: 'unknown', period: 'forever' } });
  assert.equal(new URL(invalid.headers.location, 'https://preview.example').searchParams.get('returnTo'), '/intelligence/overview');
});

test('imports stay disabled by default and in cloud environments without release switches', async () => {
  for (const environment of [{ ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' }, { ...env, VERCEL_ENV: 'production' },
    { ...env, VERCEL_ENV: 'preview' }]) {
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
  assert.match(detail.body, /id="business-history"/);
  assert.ok(!sources.body.includes('MiniMax'));
  assert.ok(!sources.body.includes('DeepSeek'));
  assert.ok(!detail.body.includes('DeepSeek'));
  assert.match(settingsPage.body, /模型、预算与通知/);
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

test('manual extraction makes one budgeted format repair before returning failure', async () => {
  const bytes = Buffer.from('<html><main>Official source evidence.</main></html>');
  const saved = { ...source, content_type: 'text/html', content_sha256: createHash('sha256').update(bytes).digest('hex') };
  const extraction = { summary_zh: '中文摘要', why_it_matters_zh: '为什么重要',
    known_facts: [{ claim_zh: '存在官方证据。', evidence_quote: 'Official source evidence.' }],
    unknowns_zh: ['后续状态未知。'], hypotheses: [], next_signals_zh: ['继续观察。'], gcc_relevance_zh: '海合会来源。',
    maturity: 'signal', caution_zh: '仅按原文记录。', classification: { disposition: 'source_only', radars: [], countries: [],
      importance: 'low', evidence_status: 'sourced', urgency: 'none', title_zh: '官方来源', organizations: [], project: null, procurement: null } };
  const seen = [];
  const { request, calls } = setup({
    overrides: { evidence: async () => ({ source: saved, bytes }) },
    modelFactory: () => async input => {
      seen.push(input.formatRepairCode);
      if (seen.length === 1) throw Object.assign(new Error('invalid output'), { code: 'extraction_invalid_early_opportunity_evidence', status: 422 });
      return { extraction, provider: 'deepseek', model: 'deepseek-flash', usage: {} };
    }
  });
  assert.equal((await request('extract', { method: 'POST', body: {} })).code, 200);
  assert.deepEqual(seen, [null, 'extraction_invalid_early_opportunity_evidence']);
  assert.equal(calls.filter(call => call.name === 'reserveBudget').length, 2);
  assert.equal(calls.filter(call => call.name === 'failExtraction').length, 1);
  assert.equal(calls.filter(call => call.name === 'saveExtraction').length, 1);
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
  assert.equal(calls.filter(call => call.name === 'failExtraction').length, 2);
  assert.deepEqual(calls.filter(call => call.name === 'failExtraction').at(-1).args, [id, admin, 'extraction_invalid_known_fact_quote']);
  assert.equal(calls.filter(call => call.name === 'reserveBudget').length, 2);
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
  const notification = calls.find(call => call.name === 'enqueueDailyDigest').args;
  assert.deepEqual(notification, [admin, oldJob]);
});


test('entry routes open overview while source tools and deep links keep their login destinations', async () => {
  const { request } = setup();
  const { rewrites } = require('../vercel.json');
  const entry = rewrites.find(route => route.source === '/intelligence');
  const action = new URL(entry.destination, 'https://preview.example').searchParams.get('action');
  const workbench = (await request(action)).body;
  assert.match(workbench, /<h1>工作台总览<\/h1>/);
  assert.ok(workbench.indexOf('id="workbench-actions"') < workbench.indexOf('id="workbench-highlights-title"'));
  assert.ok(workbench.indexOf('id="workbench-highlights-title"') < workbench.indexOf('id="workbench-directions-section"'));
  assert.doesNotMatch(workbench, /整体概况|id="workbench-summary"/);
  const redirect = await request(action, { loggedIn: false });
  assert.equal(new URL(redirect.headers.location, 'https://preview.example').searchParams.get('returnTo'), '/intelligence/overview');
  assert.equal(rewrites.find(route => route.source === '/intelligence/sources').destination, '/api/intelligence?action=page');
  const sources = await request('page');
  assert.match(sources.body, /<h1>情报来源<\/h1>/);
  assert.doesNotMatch(sources.body, /G2|来源证据工作台/);
  for (const [action, expected] of [['page', '/intelligence/sources'], ['settings-page', '/intelligence/settings'], ['detail-page', `/intelligence/sources/${id}`]]) {
    const response = await request(action, { loggedIn: false });
    assert.equal(new URL(response.headers.location, 'https://preview.example').searchParams.get('returnTo'), expected);
  }
});

test('workflow page and data require the administrator, preserve login return and only read today', async () => {
  const { request, calls } = setup({ overrides: { dailyTasks: async (_owner, day) => ({ day, run: null, items: [] }) } });
  const anon = await request('workflow-page', { loggedIn: false });
  assert.equal(anon.code, 303);
  assert.equal(anon.headers.location, '/intelligence/login?returnTo=%2Fintelligence%2Fworkflow');
  assert.equal((await request('workflow', { loggedIn: false })).code, 401);
  const forbidden = setup({ overrides: { user: async () => ({ id }) } });
  assert.equal((await forbidden.request('workflow')).code, 403);
  const page = await request('workflow-page');
  assert.equal(page.code, 200);
  assert.match(page.body, /采集流程与当天任务/);
  assert.match(page.body, /id="workflow-tasks"/);
  const data = await request('workflow', { query: { day: '2000-01-01', owner: id } });
  assert.equal(data.code, 200);
  const call = calls.find(item => item.name === 'dailyTasks');
  assert.equal(call.args[0], admin);
  assert.equal(call.args[1], require('../lib/intelligence/jobs.cjs').scheduleDate());
  assert.equal(data.body.user.email, 'local@example.test');
  assert.ok(!calls.some(item => ['enqueueJob', 'claimJobItem', 'enqueueJobItems'].includes(item.name)));
  const rewrite = require('../vercel.json').rewrites.find(item => item.source === '/intelligence/workflow');
  assert.equal(rewrite.destination, '/api/intelligence?action=workflow-page');
});

test('discovery keeps one region filter and accepts only supported country, group and topic return parameters', async () => {
  const { request } = setup();
  const page = await request('discover-page');
  assert.match(page.body, /aria-label="情报类型"/);
  assert.equal((page.body.match(/name="group"/g) || []).length, 1);
  assert.match(page.body, /option value="north-africa"/);
  assert.match(page.body, /option value="EG"/);
  assert.match(page.body, /西撒哈拉（地位有争议）/);
  assert.doesNotMatch(page.body, /id="region-coverage"/);
  const anon = await request('overview-page', { loggedIn: false, query: { country: 'EG', group: 'north-africa', topic: 'suez' } });
  assert.equal(decodeURIComponent(anon.headers.location.split('returnTo=')[1]), '/intelligence/overview?country=EG&group=north-africa&topic=suez');
  assert.equal((await request('coverage', { loggedIn: false })).code, 401);
});

test('MENA manual discovery lists enabled regions and rejects pending regions before billing', async () => {
  const { request, calls } = setup();
  const page = await request('page');
  const form = page.body.match(/<form id="discovery-form"[\s\S]*?<\/form>/)[0];
  for (const code of ['SA', 'TR', 'MA', 'DZ', 'EG', 'JO', 'PS', 'YE', 'SD', 'MR', 'TN', 'IR', 'CY', 'LB', 'EH', 'IQ', 'IL', 'SY']) assert.match(form, new RegExp('option value="' + code + '"'));
  const { primaryHosts } = require('../lib/intelligence/discovery.cjs');
  const syria = primaryHosts.SY;
  delete primaryHosts.SY;
  try {
    const result = await request('discover', { method: 'POST', body: { country: 'SY' } });
    assert.equal(result.code, 400);
    assert.equal(result.body.error, 'discovery_country_not_enabled');
    assert.equal(calls.filter(item => /reserve|provider/i.test(item.name)).length, 0);
  } finally { primaryHosts.SY = syria; }
});

test('every authenticated HTML page includes its verified account before loading business data', async () => {
  const { request } = setup();
  for (const action of ['engine-page', 'overview-page', 'workflow-page', 'settings-page', 'page', 'detail-page']) {
    const response = await request(action, { query: { id } });
    assert.equal(response.code, 200);
    assert.match(response.body, /id="account-email" hidden>local@example\.test<\/span>/);
    assert.match(response.body, /title="当前账号：local@example\.test" aria-label="退出当前账号：local@example\.test"/);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  const unsafe = setup({ overrides: { user: async () => ({ id: admin, email: '<img src=x onerror=alert(1)>@example.test' }) } });
  const response = await unsafe.request('overview-page');
  assert.match(response.body, /&lt;img src=x onerror=alert\(1\)&gt;@example.test/);
  assert.doesNotMatch(response.body, /<img src=x/);
  const anonymous = await request('overview-page', { loggedIn: false });
  assert.equal(anonymous.code, 303);
  assert.ok(!String(anonymous.body).includes('local@example.test'));
});

const followupInput = { revision: 0, status: 'active', reason: '验证需求', next_action: '核对新公告', priority: 'high', review_on: '2026-09-28', exit_condition: '该包件已取消', outcome: '', exit_reason: '' };
test('follow-up APIs enforce authentication, owner, write flag, origin, revision and real dates', async () => {
  const writes = [];
  const { request } = setup({ overrides: {
    followup: async (source, owner) => { assert.equal(source, id); assert.equal(owner, admin); return { watch: null, eligible: true, history: [] }; },
    saveFollowup: async (source, owner, value) => { writes.push(value); assert.equal(source, id); assert.equal(owner, admin); return { revision: 1 }; },
    followups: async (owner, state, offset) => { assert.equal(owner, admin); assert.equal(state, 'completed'); assert.equal(offset, 25); return { items: [], more: false }; }
  } });
  for (const action of ['followup','followups']) assert.equal((await request(action, { loggedIn: false })).code, 401);
  assert.equal((await request('followups-page', { loggedIn: false })).code, 303);
  assert.equal((await request('followups-page')).code, 200);
  assert.equal((await request('followup')).body.eligible, true);
  assert.equal((await request('followups', { query: { state: 'completed', offset: '25' } })).code, 200);
  assert.equal((await request('followups', { query: { state: 'completed', offset: '25' } })).body.writable, true);
  for (const bad of [{ review_on: '2026-02-30' }, { next_action: ' ' }, { revision: -1 }, { status: 'completed' }, { priority: 'x' }])
    assert.equal((await request('save-followup', { method: 'POST', body: { ...followupInput, ...bad } })).code, 400);
  assert.equal((await request('save-followup', { method: 'POST', loggedIn: false, body: followupInput })).code, 401);
  assert.equal((await request('save-followup', { method: 'POST', body: followupInput, headers: { origin: 'https://evil.example' } })).code, 403);
  assert.equal((await request('save-followup', { method: 'POST', sourceId: 'bad', body: followupInput })).code, 400);
  assert.equal((await request('save-followup', { method: 'POST', body: followupInput })).body.watch.revision, 1);
  assert.equal(writes.length, 1);
  const disabled = setup({ environment: { ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' } });
  assert.equal((await disabled.request('save-followup', { method: 'POST', body: followupInput })).code, 403);
  const readOnlyList = setup({ environment: { ...env, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' }, overrides: { followups: async () => ({ items: [], more: false }) } });
  assert.equal((await readOnlyList.request('followups')).body.writable, false);
  const conflict = setup({ overrides: { saveFollowup: async () => { throw failure('followup_conflict', 409); } } });
  assert.equal((await conflict.request('save-followup', { method: 'POST', body: followupInput })).body.error, 'followup_conflict');
});

test('decision workbench is private, read-only and separate from filtered discovery', async()=>{
  const {request,calls}=setup({overrides:{workbench:async(owner,day)=>{assert.equal(owner,admin);assert.equal(day,require('../lib/intelligence/jobs.cjs').scheduleDate());return {discoveries:[],updates:[],due:[]};}}});
  assert.equal((await request('workbench',{loggedIn:false})).code,401);
  assert.equal((await request('workbench',{method:'POST'})).code,405);
  assert.equal((await request('workbench')).code,200);
  assert.equal((await request('workbench',{query:{period:'7'}})).code,200);
  assert.equal((await request('workbench',{query:{period:'2'}})).code,400);
  assert.equal((await request('workbench',{query:{period:'all'}})).code,400);
  const page=await request('overview-page');
  for(const label of ['工作台总览','新增情报','跟踪有更新','需要处理','发现情报','我的跟踪','运行状态'])assert.ok(page.body.includes(label));
  assert.doesNotMatch(page.body,/id="overview-list"/);
  assert.match((await request('overview-page',{query:{view:'project'}})).body,/id="overview-title"/);
  const redirect=await request('discover-page',{loggedIn:false,query:{country:'EG',view:'demand',period:'90'}});
  assert.equal(new URL(redirect.headers.location,'https://preview.example').searchParams.get('returnTo'),'/intelligence/discover?country=EG&view=demand&period=90');
  assert.ok(!calls.some(c=>/save|enqueue|claim/.test(c.name)));
});

test('collection directions require authentication, owner scope, valid revisions and write permission', async()=>{
  const value={id:null,revision:0,config:require('../lib/intelligence/directions.cjs').defaults[0].config};
  const {request}=setup({overrides:{
    collectionDirections:async(owner)=>{assert.equal(owner,admin);return {directions:[]};},
    saveDirection:async(owner,input)=>{assert.equal(owner,admin);assert.deepEqual(input,value);return {id,effective_on:'2026-09-28'};}
  }});
  assert.equal((await request('directions',{loggedIn:false})).code,401);
  const page=await request('directions-page',{loggedIn:false});assert.equal(page.code,303);assert.match(page.headers.location,/directions/);
  assert.equal((await request('directions')).code,200);
  assert.equal((await request('save-direction',{method:'POST',body:value})).body.direction.id,id);
  assert.equal((await request('save-direction',{method:'POST',body:{...value,revision:-1}})).code,400);
  assert.equal((await request('save-direction',{method:'POST',body:value,headers:{origin:'https://other.test'}})).code,403);
  const locked=setup({environment:{...env,NRGOPT_INTELLIGENCE_WRITE_ENABLED:'0'}});
  assert.equal((await locked.request('save-direction',{method:'POST',body:value})).code,403);
});

test('source library routes enforce login, origin, write switch, owner directions and canonical duplicates',async()=>{
 const {defaults,validateEntry}=require('../lib/intelligence/source-library.cjs');const e=validateEntry({revision:0,status:'candidate',config:{name:'Media',url:'https://public.example/',scope:'site',type:'media',countries:['SA'],languages:[],direction_ids:[],notes:'',priority:'normal'}});
 const base={collectionDirections:async()=>({directions:[]}),sourceLibrary:async()=>[],saveLibraryEntry:async(_owner,value)=>{assert.equal(_owner,admin);return value;}};
 const s=setup({overrides:base});
 assert.equal((await s.request('library-page',{loggedIn:false})).code,303);
 assert.equal((await s.request('source-library',{loggedIn:false})).code,401);
 assert.equal((await s.request('save-library-entry',{method:'POST',body:e,loggedIn:false})).code,401);
 assert.equal((await s.request('save-library-entry',{method:'POST',body:e,headers:{origin:'https://other.example'}})).code,403);
 assert.equal((await s.request('save-library-entry',{method:'POST',body:e})).code,200);
 assert.equal((await s.request('save-library-entry',{method:'POST',body:{...e,config:{...e.config,direction_ids:[id]}}})).code,400);
 assert.equal((await setup({environment:{...env,NRGOPT_INTELLIGENCE_WRITE_ENABLED:'0'},overrides:base}).request('save-library-entry',{method:'POST',body:e})).code,403);
 const duplicate=setup({overrides:{...base,sourceLibrary:async()=>[{...e,id:'other'}]}});assert.equal((await duplicate.request('save-library-entry',{method:'POST',body:e})).code,409);
});
test('failed live entry verification is stored and deactivates an unreadable custom channel without invoking models',async()=>{
 const e={id,revision:1,status:'active',access:{status:'readable'},config:{url:'https://public.example/',scope:'site',mode:'search'}};let record;
 const s=setup({overrides:{sourceLibrary:async()=>[e],saveLibraryEntry:async(owner,value,access)=>{record={owner,value,access};return{...value,access};}},sourceFetcher:async()=>{throw failure('source_access_denied',422);},modelFactory:()=>{throw Error('must not create model');}});
 assert.equal((await s.request('check-library-entry',{method:'POST',body:{id,revision:1}})).code,200);
 assert.equal(record.owner,admin);assert.equal(record.value.status,'candidate');assert.equal(record.access.error_code,'source_access_denied');
 assert.equal((await s.request('check-library-entry',{method:'POST',body:{id,revision:0}})).code,409);
});
test('daily reference maintenance is authorized, bounded, evidence-gated and never calls a model',async()=>{
 const {defaults}=require('../lib/intelligence/source-library.cjs');
 const refs=defaults().filter(e=>e.id.startsWith('reference:')).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,4);
 let reserved=0;const saved=[];
 const sample={id,final_url:refs[0].config.url+'article',publication_date:new Date().toISOString().slice(0,10),publication_method:'metadata',extraction_status:'extracted',content_sha256:'a'.repeat(64),extraction_source_sha256:'a'.repeat(64)};
 const app=setup({environment:{...env,CRON_SECRET:'cron-test-secret',NRGOPT_SCHEDULER_ENABLED:'1'},overrides:{
   sourceLibrary:async()=>refs,recentLibrarySources:async()=>[sample],reserveLibraryCheck:async()=>reserved++<3?'reserved':'limit',
   saveLibraryEntry:async(_owner,value,access)=>{saved.push({value,access});return {...value,access};}
 },sourceFetcher:async url=>({finalUrl:url,excerpt:'Public website',bytes:Buffer.from('website')}),modelFactory:()=>{throw Error('model must not run');}});
 assert.equal((await app.request('library-maintenance',{loggedIn:false})).code,401);
 const result=await app.request('library-maintenance',{loggedIn:false,headers:{authorization:'Bearer cron-test-secret'}});
 assert.equal(result.code,200);assert.equal(result.body.checked,3);
 assert.equal(saved.filter(x=>x.value.status==='active').length,1);
 assert.equal(saved.filter(x=>x.value.status==='candidate'&&x.access.review==='recent_source_missing').length,2);
 assert.equal(app.calls.filter(c=>c.name==='reserveLibraryCheck').length,3);
 assert.equal(app.calls.filter(c=>c.name==='recentLibrarySources').length,3);
});
test('recently reviewed references wait seven days while unchecked and older entries advance',async()=>{
 const {defaults}=require('../lib/intelligence/source-library.cjs');
 const refs=defaults().filter(e=>e.id.startsWith('reference:')).slice(0,4);
 refs[0].access.checked_at=new Date().toISOString();
 refs[1].access.checked_at=new Date(Date.now()-6*86400000).toISOString();
 refs[2].access.checked_at=new Date(Date.now()-8*86400000).toISOString();
 const app=setup({environment:{...env,CRON_SECRET:'cron-test-secret',NRGOPT_SCHEDULER_ENABLED:'1'},overrides:{
   sourceLibrary:async()=>refs,recentLibrarySources:async()=>[],reserveLibraryCheck:async()=> 'reserved',
   saveLibraryEntry:async(_owner,value,access)=>({...value,access})
 },sourceFetcher:async url=>({finalUrl:url,excerpt:'Public',bytes:Buffer.from('Public')})});
 const result=await app.request('library-maintenance',{loggedIn:false,headers:{authorization:'Bearer cron-test-secret'}});
 assert.equal(result.code,200);assert.equal(result.body.checked,2);
 assert.deepEqual(new Set(result.body.outcomes.map(x=>x.id)),new Set([refs[2].id,refs[3].id]));
});


test('health alert snapshots the full daily task result with actionable grouped causes', async () => {
  const items = Array.from({ length: 1200 }, () => ({ status: 'succeeded', item_key: 'source:ok' }));
  items.push({ status: 'failed', item_key: 'source:bad', error_code: 'source_empty_document', name: '公告网站' },
    { status: 'failed', item_key: 'extract:bad', error_code: 'extraction_invalid_source_only_consistency', title: '行业文章' },
    { status: 'budget_paused', item_key: 'discover:SA', error_code: 'budget_exhausted' });
  const app = setup({ environment: { ...env, CRON_SECRET: 'test-cron-secret' }, overrides: {
    dailyTasks: async () => ({ run: { status: 'partial' }, items }) } });
  const result = await app.request('health-check', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(result.code, 200);
  const payload = app.calls.find(c => c.name === 'enqueueNotification').args[3];
  assert.deepEqual(payload.task_counts, { total: 1203, succeeded: 1200, failed: 2, budget_paused: 1, manual_paused: 0, unfinished: 0 });
  assert.equal(payload.problem_groups.length, 3);
  assert.match(payload.problem_groups.find(g => g.stage === '情报分析').reason, /背景材料与商业分类/);
  assert.ok(!app.calls.some(c => c.name === 'operations'));
  assert.deepEqual(app.calls.find(c => c.name === 'dailyTasks').args, [admin, result.body.schedule_key]);
});

test('Feishu page and settings are admin-only; saving encrypts and version checks stay server scoped', async () => {
  const environment = { ...env, NRGOPT_PROVIDER_CONFIG_KEY: Buffer.alloc(32, 9).toString('base64'), FEISHU_APP_ID: 'cli_example_app', FEISHU_APP_SECRET: 'existing-secret' };
  const app = setup({ environment });
  assert.equal((await app.request('feishu-page', { loggedIn: false })).code, 303);
  assert.equal((await app.request('feishu-config', { loggedIn: false })).code, 401);
  assert.match((await app.request('feishu-page')).body, /飞书配置与推送/);
  const read = await app.request('feishu-config');
  assert.equal(read.body.config.secret_configured, true); assert.ok(!JSON.stringify(read.body).includes('existing-secret'));
  const value = { ...read.body.config, enabled: true, send_chat: true, chat_id: 'oc_example_chat', send_user: false, user_open_id: '', app_secret: '' };
  assert.equal((await app.request('save-feishu-config', { method: 'POST', body: value, headers: { origin: 'https://evil.example' } })).code, 403);
  const saved = await app.request('save-feishu-config', { method: 'POST', body: { ...value, owner_id: 'other-owner' } });
  assert.equal(saved.code, 200); assert.equal(saved.body.config.revision, 1);
  assert.ok(!JSON.stringify(saved.body).includes('secret_ciphertext'));
  assert.equal(app.calls.find(c => c.name === 'saveFeishuConfig').args[0], admin);
  assert.equal((await app.request('check-feishu-config', { method: 'POST', body: {} })).code, 200);
  assert.ok(!app.calls.some(c => ['claimNotification','enqueueNotification'].includes(c.name)));
  const locked = setup({ environment: { ...environment, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '0' } });
  assert.equal((await locked.request('save-feishu-config', { method: 'POST', body: value })).code, 403);
  const conflict = setup({ environment, overrides: { saveFeishuConfig: async () => { throw Object.assign(new Error('conflict'), { code: 'feishu_config_conflict', status: 409 }); } } });
  assert.equal((await conflict.request('save-feishu-config', { method: 'POST', body: value })).code, 409);
});

test('worker honors stored master pause before claiming any notification', async () => {
  const app = setup({ environment: { ...env, CRON_SECRET: 'test-cron-secret', NRGOPT_FEISHU_ENABLED: '1' },
    overrides: { feishuConfig: async () => ({ revision: 1, enabled: false, secret_ciphertext: null }) } });
  const r = await app.request('notification-worker', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(r.body.status, 'paused'); assert.ok(!app.calls.some(c => c.name === 'claimNotification'));
});

test('worker uses managed bot settings even when legacy environment delivery is disabled', async () => {
  const environment = { ...env, CRON_SECRET: 'test-cron-secret', NRGOPT_FEISHU_ENABLED: '0', NRGOPT_PROVIDER_CONFIG_KEY: Buffer.alloc(32, 3).toString('base64') };
  const ciphertext = require('../lib/intelligence/provider-config.cjs').encryptApiKey('managed-secret', environment, admin, 'feishu-app');
  const app = setup({ environment, overrides: { feishuConfig: async () => ({ revision: 1, enabled: true, app_id: 'cli_managed_app', secret_ciphertext: ciphertext, chat_id: 'oc_managed_chat', user_open_id: '', send_chat: true, send_user: false }),
    claimNotification: async () => ({ id: id, notification_type: 'daily', payload: {} }) },
    notificationFactory: options => { assert.equal(options.appSecret, 'managed-secret'); assert.equal(options.sendUser, false); assert.equal(options.webhookUrl, ''); return async () => ({ responseCode: 200 }); } });
  const result = await app.request('notification-worker', { loggedIn: false, headers: { authorization: 'Bearer test-cron-secret' } });
  assert.equal(result.body.status, 'accepted'); assert.ok(!JSON.stringify(result.body).includes('managed-secret'));
});
