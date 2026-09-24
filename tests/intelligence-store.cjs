const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { settings, createStore, organizationKeys } = require('../lib/intelligence/store.cjs');

const ENV = {
  SUPABASE_URL: 'https://backend.example',
  SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  NRGOPT_ADMIN_USER_ID: 'owner-a',
  NRGOPT_APP_ORIGIN: 'http://127.0.0.1:3000'
};
const CONFIG = settings(ENV);
const bytes = Buffer.from('<html><title>Energy source</title><p>Source evidence</p></html>');
const SOURCE = {
  requestedUrl: 'https://source.example/news',
  finalUrl: 'https://source.example/news?a=1&b=2',
  title: 'Energy source', excerpt: 'Source evidence', contentType: 'text/html', bytes,
  sha256: createHash('sha256').update(bytes).digest('hex')
};

// This models only the REST contract used here, including PostgREST projection.
// It does not exercise Supabase authentication, RLS, SQL constraints or Storage.
function backend() {
  const state = { records: [], candidates: [], hypotheses: [], watches: [], relations: [], organizations: [], aliases: [], projects: [], procurements: [], providerConfigs: [], archiveJobs: [], objects: new Map(), calls: [], failUpload: false };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  state.fetch = async (input, init) => {
    const url = new URL(input);
    const method = init.method || 'GET';
    state.calls.push({ url, method, ...init });
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/token')) return json({ access_token: 'test-token', user: { id: 'owner-a' } });
      if (url.pathname.endsWith('/user')) return json({ id: 'owner-a', email: 'admin@example.com' });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/intelligence_provider_configs') {
      if (method === 'POST') {
        const record = JSON.parse(init.body);
        const index = state.providerConfigs.findIndex(row => row.owner_id === record.owner_id && row.capability === record.capability);
        if (index >= 0) state.providerConfigs[index] = { ...state.providerConfigs[index], ...record };
        else state.providerConfigs.push({ ...record });
        return json([{ ...record }], index >= 0 ? 200 : 201);
      }
      const owner = url.searchParams.get('owner_id')?.slice(3);
      const select = url.searchParams.get('select') || '*';
      return json(state.providerConfigs.filter(row => !owner || row.owner_id === owner).map(row =>
        select === '*' ? { ...row } : Object.fromEntries(select.split(',').map(key => [key, row[key] ?? null]))));
    }
    if (url.pathname === '/rest/v1/rpc/enqueue_intelligence_archive') {
      const input = JSON.parse(init.body);
      let job = state.archiveJobs.find(row => row.owner_id === input.p_owner_id && row.source_id === input.p_source_id);
      if (!job) {
        job = { id: `archive-${state.archiveJobs.length + 1}`, owner_id: input.p_owner_id, source_id: input.p_source_id };
        state.archiveJobs.push(job);
      }
      const source = state.records.find(row => row.id === input.p_source_id && row.owner_id === input.p_owner_id);
      if (source) source.archive_status = 'queued';
      return json(job.id);
    }
    if (url.pathname === '/rest/v1/rpc/sync_intelligence_tracking') {
      const input = JSON.parse(init.body);
      for (const h of input.p_hypotheses) {
        if (!state.hypotheses.some(old => old.candidate_id === input.p_candidate_id && old.claim_zh === h.hypothesis_zh))
          state.hypotheses.push({ candidate_id: input.p_candidate_id, owner_id: input.p_owner_id, claim_zh: h.hypothesis_zh, status: 'open' });
      }
      for (const signal of input.p_signals) {
        if (!state.watches.some(old => old.candidate_id === input.p_candidate_id && old.signal_zh === signal))
          state.watches.push({ candidate_id: input.p_candidate_id, owner_id: input.p_owner_id, signal_zh: signal, status: 'active' });
      }
      return json(true);
    }
    if (url.pathname === '/rest/v1/intelligence_sources') {
      if (method === 'POST') {
        const record = JSON.parse(init.body);
        const existing = record.content_sha256 && state.records.find(row =>
          row.owner_id === record.owner_id && row.final_url === record.final_url && row.content_sha256 === record.content_sha256);
        if (existing) return json([]);
        state.records.push({ ...record });
        return json([{ ...record }], 201);
      }
      const matches = state.records.filter(row => ['id', 'owner_id', 'final_url', 'content_sha256', 'status', 'extraction_status'].every(key => {
        const condition = url.searchParams.get(key);
        return !condition || (condition.startsWith('in.(') ? condition.slice(4, -1).split(',').includes(row[key]) : condition.startsWith('neq.') ? row[key] !== condition.slice(4) : condition === `eq.${row[key]}`);
      }));
      if (method === 'PATCH') {
        matches.forEach(row => Object.assign(row, JSON.parse(init.body)));
        return new Response(null, { status: 204 });
      }
      const select = url.searchParams.get('select') || '*';
      const projected = matches.slice(0, Number(url.searchParams.get('limit') || matches.length)).map(row =>
        select === '*' ? { ...row } : Object.fromEntries(select.split(',').map(key => [key, row[key] ?? null])));
      return json(projected);
    }
    if (url.pathname === '/rest/v1/intelligence_candidates') {
      if (method === 'POST') {
        const record = JSON.parse(init.body);
        let current = state.candidates.find(row => row.owner_id === record.owner_id && row.source_id === record.source_id);
        if (current) Object.assign(current, record);
        else {
          const ids = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
          current = { id: ids[state.candidates.length], ...record };
          state.candidates.push(current);
        }
        return json([{ ...current }], current.created_at ? 200 : 201);
      }
      const matches = state.candidates.filter(row => ['id', 'owner_id', 'source_id'].every(key => {
        const condition = url.searchParams.get(key);
        return !condition || (condition.startsWith('in.(') ? condition.slice(4, -1).split(',').includes(row[key]) : condition.startsWith('neq.') ? row[key] !== condition.slice(4) : condition === `eq.${row[key]}`);
      }));
      if (method === 'PATCH') {
        matches.forEach(row => Object.assign(row, JSON.parse(init.body)));
        return new Response(null, { status: 204 });
      }
      const select = url.searchParams.get('select') || '*';
      return json(matches.map(row => select === '*' ? { ...row } : Object.fromEntries(select.split(',').map(key => [key, row[key] ?? null]))));
    }
    if (url.pathname === '/rest/v1/intelligence_candidate_relations') {
      if (method === 'POST') {
        const input = JSON.parse(init.body);
        for (const record of Array.isArray(input) ? input : [input]) {
          const current = state.relations.find(row => row.owner_id === record.owner_id && row.candidate_id === record.candidate_id && row.related_candidate_id === record.related_candidate_id);
          if (current) Object.assign(current, record);
          else state.relations.push({ id: `relation-${state.relations.length + 1}`, ...record });
        }
        return new Response(null, { status: 201 });
      }
      const owner = url.searchParams.get('owner_id')?.slice(3);
      const ids = (url.searchParams.get('candidate_id')?.match(/^in\.\((.*)\)$/)?.[1] || '').split(',').filter(Boolean);
      const matches = state.relations.filter(row => (!owner || row.owner_id === owner) && (!ids.length || ids.includes(row.candidate_id)));
      const select = url.searchParams.get('select') || '*';
      return json(matches.map(row => select === '*' ? { ...row } : Object.fromEntries(select.split(',').map(key => [key, row[key] ?? null]))));
    }
    if (url.pathname === '/rest/v1/intelligence_organizations') {
      if (method === 'POST') {
        const record = JSON.parse(init.body);
        let current = state.organizations.find(row => row.owner_id === record.owner_id && row.canonical_name === record.canonical_name);
        if (current) Object.assign(current, record);
        else {
          current = { id: `organization-${state.organizations.length + 1}`, ...record };
          state.organizations.push(current);
        }
        return json([{ ...current }], 201);
      }
      const owner = url.searchParams.get('owner_id')?.slice(3);
      return json(state.organizations.filter(row => !owner || row.owner_id === owner).map(row => ({ ...row })));
    }
    if (url.pathname === '/rest/v1/intelligence_entity_aliases' && method === 'POST') {
      const record = JSON.parse(init.body);
      let current = state.aliases.find(row => row.owner_id === record.owner_id && row.alias === record.alias);
      if (current) Object.assign(current, record);
      else {
        current = { id: `alias-${state.aliases.length + 1}`, ...record };
        state.aliases.push(current);
      }
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/intelligence_projects') {
      const owner = url.searchParams.get('owner_id')?.slice(3);
      const candidate = url.searchParams.get('candidate_id')?.slice(3);
      if (method === 'DELETE') {
        const removed = state.projects.filter(row => (!owner || row.owner_id === owner) && (!candidate || row.candidate_id === candidate));
        for (const project of removed) state.procurements = state.procurements.filter(row => row.project_id !== project.id);
        state.projects = state.projects.filter(row => !removed.includes(row));
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        const record = JSON.parse(init.body);
        let current = state.projects.find(row => row.owner_id === record.owner_id && row.candidate_id === record.candidate_id);
        if (current) Object.assign(current, record);
        else {
          current = { id: `project-${state.projects.length + 1}`, ...record };
          state.projects.push(current);
        }
        return json([{ ...current }], 201);
      }
    }
    if (url.pathname === '/rest/v1/intelligence_procurements') {
      const owner = url.searchParams.get('owner_id')?.slice(3);
      const project = url.searchParams.get('project_id')?.slice(3);
      if (method === 'DELETE') {
        state.procurements = state.procurements.filter(row => !((!owner || row.owner_id === owner) && (!project || row.project_id === project)));
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        const input = JSON.parse(init.body);
        state.procurements.push({ id: `procurement-${state.procurements.length + 1}`, ...input });
        return new Response(null, { status: 201 });
      }
    }
    if (url.pathname === '/rest/v1/intelligence_hypothesis_assessments') return new Response('[]', { status: 200 });
    if (['/rest/v1/intelligence_hypotheses', '/rest/v1/intelligence_watch_targets'].includes(url.pathname)) {
      const collection = url.pathname.endsWith('hypotheses') ? state.hypotheses : state.watches;
      if (method === 'GET') {
        const owner = url.searchParams.get('owner_id')?.slice(3);
        const candidate = url.searchParams.get('candidate_id')?.slice(3);
        return json(collection.filter(row => row.owner_id === owner && row.candidate_id === candidate));
      }
      if (method === 'DELETE') {
        const owner = url.searchParams.get('owner_id')?.slice(3);
        const candidate = url.searchParams.get('candidate_id')?.slice(3);
        for (let index = collection.length - 1; index >= 0; index--) if (collection[index].owner_id === owner && collection[index].candidate_id === candidate) collection.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        const input = JSON.parse(init.body);
        collection.push(...(Array.isArray(input) ? input : [input]));
        return new Response(null, { status: 201 });
      }
    }
    if (url.pathname.startsWith('/storage/v1/object/nrgopt-intelligence/')) {
      if (method === 'POST') {
        if (state.failUpload) return json({ message: 'private upstream detail' }, 500);
        state.objects.set(url.pathname, Buffer.from(init.body));
        return json({ Key: url.pathname });
      }
      return new Response(state.objects.get(url.pathname) || null, { status: state.objects.has(url.pathname) ? 200 : 404 });
    }
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  };
  state.store = createStore(CONFIG, state.fetch);
  return state;
}

function publicRecord(record) {
  assert.equal(Object.hasOwn(record, 'owner_id'), false);
  assert.equal(Object.hasOwn(record, 'storage_path'), false);
  assert.equal(Object.hasOwn(record, 'extraction_usage'), false);
  assert.equal(record.status, 'pending_extraction');
}

test('settings require configuration, default to read-only, and disable production writes', () => {
  assert.throws(() => settings({}), { code: 'not_configured', status: 503 });
  assert.equal(settings(ENV).writes, false);
  assert.equal(settings({ ...ENV, NRGOPT_INTELLIGENCE_WRITE_ENABLED: 'true' }).writes, false);
  assert.equal(settings({ ...ENV, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1' }).writes, true);
  assert.equal(settings({ ...ENV, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1', VERCEL_ENV: 'production' }).writes, false);
  assert.equal(settings({ ...ENV, NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1', VERCEL_ENV: 'production',
    NRGOPT_INTELLIGENCE_PRODUCTION_WRITE_ENABLED: '1' }).writes, true);
  assert.throws(() => settings({ ...ENV, SUPABASE_URL: 'http://backend.example' }), { code: 'not_configured' });
  assert.throws(() => settings({ ...ENV, NRGOPT_APP_ORIGIN: 'https://name:password@app.example' }), { code: 'not_configured' });
  assert.equal(settings({ ...ENV, SUPABASE_URL: 'http://127.0.0.1:54321' }).url, 'http://127.0.0.1:54321');
});

test('preview settings allow only the configured origin and Vercel-provided preview hosts', () => {
  const config = settings({ ...ENV, VERCEL_ENV: 'preview', VERCEL_URL: 'nrgopt-commit-team.vercel.app',
    VERCEL_BRANCH_URL: 'nrgopt-git-branch-team.vercel.app' });
  assert.deepEqual(config.origins, [
    ENV.NRGOPT_APP_ORIGIN,
    'https://nrgopt-commit-team.vercel.app',
    'https://nrgopt-git-branch-team.vercel.app'
  ]);
  const invalid = settings({ ...ENV, VERCEL_ENV: 'preview', VERCEL_URL: 'attacker.example' });
  assert.deepEqual(invalid.origins, [ENV.NRGOPT_APP_ORIGIN]);
});

test('organization aliases normalize only explicit legal-name and acronym variants', () => {
  assert.deepEqual(organizationKeys('ACWA Power Company (ACWA)'), ['acwa power', 'acwa']);
  assert.deepEqual(organizationKeys('Public Investment Fund (PIF)'), ['public investment fund', 'pif']);
  assert.deepEqual(organizationKeys('SAPCO (Saudi Aramco Power Company)'), ['saudi aramco power', 'sapco']);
  assert.deepEqual(organizationKeys('Badeel (Water and Electricity Holding Company)'), ['badeel water and electricity holding']);
});

test('job and budget RPC wrappers preserve PostgREST scalar and table response shapes', async () => {
  const calls = [];
  const responses = {
    enqueue_intelligence_job: '11111111-1111-4111-8111-111111111111',
    enqueue_intelligence_job_items: 2,
    claim_intelligence_job_item_v2: [{ id: '22222222-2222-4222-8222-222222222222', item_key: 'discover:SA', attempts: 1, checkpoint: {} }],
    finish_intelligence_job_item_v2: true,
    reserve_intelligence_budget: '33333333-3333-4333-8333-333333333333',
    settle_intelligence_budget: true,
    release_intelligence_budget: true,
    sync_intelligence_provider_balance: true,
    enqueue_intelligence_archive: '44444444-4444-4444-8444-444444444444',
    claim_intelligence_archive: [{ id: '55555555-5555-4555-8555-555555555555', source_id: 'source-a', content_sha256: 'a'.repeat(64) }],
    complete_intelligence_archive: true,
    fail_intelligence_archive: true,
    enqueue_intelligence_notification: '66666666-6666-4666-8666-666666666666',
    claim_intelligence_notification: [{ id: '77777777-7777-4777-8777-777777777777', notification_type: 'daily', payload: {} }],
    finish_intelligence_notification: true
  };
  const fetchImpl = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    calls.push({ name, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responses[name]));
  };
  const store = createStore(CONFIG, fetchImpl);
  assert.equal(await store.enqueueJob('owner-a', 'daily_scan', '2026-09-22', ['discover:SA']), responses.enqueue_intelligence_job);
  assert.equal(await store.enqueueJobItems('owner-a', responses.enqueue_intelligence_job,
    [{ item_key: 'source:a', checkpoint: { url: 'https://official.example/a' } }]), 2);
  assert.deepEqual(await store.claimJobItem('owner-a', responses.enqueue_intelligence_job, 30), responses.claim_intelligence_job_item_v2[0]);
  assert.equal(await store.finishJobItem('owner-a', 'item-a', 'succeeded', { country: 'SA' }, null, 1), true);
  assert.equal(await store.reserveBudget('owner-a', null, 'extraction', 'CNY', 'manual:1', 1000), responses.reserve_intelligence_budget);
  assert.equal(await store.settleBudget('owner-a', responses.reserve_intelligence_budget, 900, 'estimated', {
    provider: 'deepseek', model: 'deepseek-flash', usage: { prompt_tokens: 100 }, pricingVersion: 'test-price'
  }), true);
  assert.equal(await store.releaseBudget('owner-a', responses.reserve_intelligence_budget), true);
  assert.equal(await store.syncProviderBalance('owner-a', 'analysis', 'CNY', 8_980_000), true);
  assert.equal(await store.enqueueArchive('owner-a', 'source-a'), responses.enqueue_intelligence_archive);
  assert.deepEqual(await store.claimArchive('owner-a', 'mac-mini', 300), responses.claim_intelligence_archive[0]);
  assert.equal(await store.completeArchive('owner-a', responses.claim_intelligence_archive[0].id, 'mac-mini', 10, 'a'.repeat(64)), true);
  assert.equal(await store.failArchive('owner-a', responses.claim_intelligence_archive[0].id, 'mac-mini', 'disk_full'), true);
  assert.equal(await store.enqueueNotification('owner-a', 'daily', 'daily:2026-09-22', {}), responses.enqueue_intelligence_notification);
  assert.deepEqual(await store.claimNotification('owner-a', 120), responses.claim_intelligence_notification[0]);
  assert.equal(await store.finishNotification('owner-a', responses.claim_intelligence_notification[0].id, 'accepted', 200), true);
  assert.deepEqual(calls.map(call => call.name), Object.keys(responses));
  assert.equal(calls[4].body.p_job_run_id, null);
  assert.equal(calls[4].body.p_currency, 'CNY');
  assert.equal(calls[4].body.p_reserve_micro, 1000);
  const settlement = calls.find(call => call.name === 'settle_intelligence_budget');
  assert.equal(settlement.body.p_provider, 'deepseek');
  assert.equal(settlement.body.p_model, 'deepseek-flash');
  assert.deepEqual(settlement.body.p_usage, { prompt_tokens: 100 });
  assert.equal(settlement.body.p_pricing_version, 'test-price');
  assert.deepEqual(calls.find(call => call.name === 'sync_intelligence_provider_balance').body, {
    p_owner_id: 'owner-a', p_capability: 'analysis', p_currency: 'CNY', p_balance_micro: 8_980_000
  });
});

test('operations exposes recent owner-scoped jobs, item checkpoints and budget state', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith('/intelligence_job_runs')) return new Response(JSON.stringify([
      { id: 'job-a', job_type: 'daily_scan', schedule_key: '2026-09-22', status: 'budget_paused' }
    ]));
    if (url.pathname.endsWith('/intelligence_job_items')) return new Response(JSON.stringify([
      { id: 'item-a', job_run_id: 'job-a', item_key: 'discover:SA', status: 'budget_paused', attempts: 1, checkpoint: { country: 'SA' }, error_code: 'budget_exhausted' }
    ]));
    if (url.pathname.endsWith('/intelligence_provider_configs')) return new Response(JSON.stringify([
      { capability: 'discovery', currency: 'CNY', billing_mode: 'included', budget_limit_micro: 5000, budget_reserved_micro: 0, budget_spent_micro: 1000,
        budget_period_start: '2026-09-01', budget_period_end: '2026-09-30', budget_enabled: true },
      { capability: 'analysis', currency: 'USD', billing_mode: 'balance', budget_limit_micro: 2000, budget_reserved_micro: 0, budget_spent_micro: 0,
        budget_period_start: '2026-09-01', budget_period_end: '2026-09-30', budget_enabled: false }
    ]));
    if (url.pathname.endsWith('/intelligence_notification_outbox')) return new Response(JSON.stringify([
      { id: 'notification-a', notification_type: 'daily', status: 'unknown', attempts: 1, error_code: 'delivery_result_unknown' }
    ]));
    throw new Error(`unexpected ${url.pathname}`);
  };
  const result = await createStore(CONFIG, fetchImpl).operations('owner-a');
  assert.equal(result.runs[0].status, 'budget_paused');
  assert.equal(result.items[0].checkpoint.country, 'SA');
  assert.equal(result.budgets[0].currency, 'CNY');
  assert.equal(result.budgets[0].capability, 'discovery');
  assert.equal(result.budgets[0].spent_micro, 1000);
  assert.equal(result.notifications[0].status, 'unknown');
  assert.ok(calls.every(url => url.searchParams.get('owner_id') === 'eq.owner-a'));
  assert.equal(calls[1].searchParams.get('job_run_id'), 'in.(job-a)');
});

test('provider configuration is owner-scoped and stored only through the service role', async () => {
  const state = backend();
  const record = { owner_id: 'owner-a', capability: 'discovery', provider: 'custom-search',
    endpoint: 'https://search.example/v1/messages', model: 'search-v2', currency: 'USD', billing_mode: 'balance', budget_limit_micro: 1000,
    budget_reserved_micro: 0, budget_spent_micro: 0, budget_period_start: '2026-09-01', budget_period_end: '2026-09-30',
    budget_enabled: true, provider_balance_anchor_micro: null, provider_balance_anchor_spent_micro: null,
    provider_balance_last_micro: null, provider_balance_synced_at: null,
    api_key_ciphertext: 'v1.encrypted-value-for-test', updated_at: '2026-09-23T00:00:00.000Z' };
  assert.deepEqual(await state.store.saveProviderConfig('owner-a', record), record);
  assert.deepEqual(await state.store.providerConfigs('owner-a'), [record]);
  assert.deepEqual(await state.store.providerConfigs('owner-b'), []);
  await assert.rejects(state.store.saveProviderConfig('owner-b', record), { code: 'invalid_request', status: 400 });
  const requests = state.calls.filter(call => call.url.pathname.endsWith('/intelligence_provider_configs'));
  assert.ok(requests.every(call => call.headers.apikey === ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.ok(requests.every(call => call.headers.Authorization === `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`));
});

test('Auth uses the anon key and the user token; database calls use only the service role', async () => {
  const state = backend();
  await state.store.login('admin@example.com', 'test-password');
  await state.store.user('test-token');
  await state.store.logout('test-token');
  await state.store.list('owner-a');
  const [login, user, logout, list] = state.calls;
  for (const call of [login, user, logout]) {
    assert.equal(call.headers.apikey, ENV.SUPABASE_ANON_KEY);
    assert.equal(JSON.stringify(call.headers).includes(ENV.SUPABASE_SERVICE_ROLE_KEY), false);
  }
  assert.equal(login.headers.Authorization, `Bearer ${ENV.SUPABASE_ANON_KEY}`);
  assert.equal(user.headers.Authorization, 'Bearer test-token');
  assert.equal(logout.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(login.body), { email: 'admin@example.com', password: 'test-password' });
  assert.equal(login.url.searchParams.get('grant_type'), 'password');
  assert.equal(logout.url.searchParams.get('scope'), 'local');
  assert.equal(list.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(list.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
  for (const call of state.calls) {
    assert.equal(call.redirect, 'error');
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test('list and get scope records to their owner and select only public fields', async () => {
  const state = backend();
  const a = await state.store.save(SOURCE, 'owner-a');
  const b = await state.store.save(SOURCE, 'owner-b');
  const listed = await state.store.list('owner-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, a.source.id);
  publicRecord(listed[0]);
  publicRecord(await state.store.get(a.source.id, 'owner-a'));
  await assert.rejects(state.store.get(b.source.id, 'owner-a'), { code: 'not_found', status: 404 });
  await assert.rejects(state.store.evidence(b.source.id, 'owner-a'), { code: 'not_found', status: 404 });
  const mutations = state.calls.filter(call => call.method === 'PATCH');
  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations.map(call => call.url.searchParams.get('owner_id')), ['eq.owner-a', 'eq.owner-b']);
  assert.ok(mutations.every(call => call.url.searchParams.get('id')));
});

test('human Chinese annotation updates only the selected owner record and is returned publicly', async () => {
  const state = backend();
  const a = await state.store.save(SOURCE, 'owner-a');
  const b = await state.store.save(SOURCE, 'owner-b');
  const note = '行业背景，尚未形成具体项目或采购判断。';
  const annotated = await state.store.annotate(a.source.id, 'owner-a', note);
  assert.equal(annotated.annotation_zh, note);
  assert.match(annotated.annotation_updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await state.store.get(b.source.id, 'owner-b')).annotation_zh, null);
  const call = state.calls.filter(item => item.method === 'PATCH').find(item => JSON.parse(item.body).annotation_zh === note);
  assert.equal(call.url.searchParams.get('owner_id'), 'eq.owner-a');
  assert.equal(call.url.searchParams.get('id'), `eq.${a.source.id}`);
  const cleared = await state.store.annotate(a.source.id, 'owner-a', '');
  assert.equal(cleared.annotation_zh, null);
  assert.equal(cleared.annotation_updated_at, null);
});

test('model extraction updates only the selected owner and keeps usage private', async () => {
  const state = backend();
  const a = await state.store.save(SOURCE, 'owner-a');
  const b = await state.store.save(SOURCE, 'owner-b');
  const result = {
    extraction: {
      summary_zh: '可再生能源装机增长。',
      why_it_matters_zh: '这是宏观背景，尚未指向具体采购。',
      known_facts: [{ claim_zh: '来源提到增长。', evidence_quote: 'Source evidence' }],
      unknowns_zh: ['未说明具体项目。'], hypotheses: [], next_signals_zh: ['观察招标公告。'],
      gcc_relevance_zh: '未识别出直接关联。', maturity: 'background', caution_zh: '待人工核对。'
    },
    provider: 'deepseek', model: 'deepseek-flash', usage: { prompt_tokens: 120, completion_tokens: 80 }
  };

  await state.store.beginExtraction(a.source.id, 'owner-a');
  assert.equal(state.records.find(row => row.id === a.source.id).extraction_status, 'processing');
  const extracted = await state.store.saveExtraction(a.source.id, 'owner-a', result, SOURCE.sha256);
  assert.equal(extracted.extraction_status, 'extracted');
  assert.deepEqual(extracted.extraction_zh, result.extraction);
  assert.equal(extracted.extraction_provider, 'deepseek');
  assert.equal(extracted.extraction_model, 'deepseek-flash');
  assert.equal(extracted.extraction_source_sha256, SOURCE.sha256);
  assert.match(extracted.extracted_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.hasOwn(extracted, 'extraction_usage'), false);
  assert.deepEqual(state.records.find(row => row.id === a.source.id).extraction_usage, result.usage);
  assert.equal(state.records.find(row => row.id === b.source.id).extraction_status, undefined);

  const extractionPatches = state.calls.filter(call => call.method === 'PATCH' &&
    ['processing', 'extracted'].includes(JSON.parse(call.body).extraction_status));
  assert.equal(extractionPatches.length, 2);
  assert.ok(extractionPatches.every(call => call.url.searchParams.get('owner_id') === 'eq.owner-a'));
  assert.ok(extractionPatches.every(call => call.url.searchParams.get('id') === `eq.${a.source.id}`));
});

test('model extraction failure is owner-scoped and exposes only a stable code', async () => {
  const state = backend();
  const a = await state.store.save(SOURCE, 'owner-a');
  const b = await state.store.save(SOURCE, 'owner-b');
  await state.store.failExtraction(a.source.id, 'owner-a', 'extraction_invalid');
  const failed = await state.store.get(a.source.id, 'owner-a');
  assert.equal(failed.extraction_status, 'extraction_failed');
  assert.equal(failed.extraction_error_code, 'extraction_invalid');
  assert.equal((await state.store.get(b.source.id, 'owner-b')).extraction_status, null);
  const call = state.calls.filter(item => item.method === 'PATCH')
    .find(item => JSON.parse(item.body).extraction_status === 'extraction_failed');
  assert.equal(call.url.searchParams.get('owner_id'), 'eq.owner-a');
  assert.equal(call.url.searchParams.get('id'), `eq.${a.source.id}`);
  assert.deepEqual(JSON.parse(call.body), { extraction_status: 'extraction_failed', extraction_error_code: 'extraction_invalid' });
});

test('G2 candidate persists evidence-linked radar, project and procurement records without mandatory review', async () => {
  const state = backend();
  const saved = await state.store.save(SOURCE, 'owner-a');
  const extraction = {
    summary_zh: '沙特项目进入资格预审。', maturity: 'procurement',
    hypotheses: [{ hypothesis_zh: '采购将继续推进。', counter_evidence_zh: '若程序取消则不成立。' }],
    next_signals_zh: ['观察合格投标人名单。'],
    classification: {
      disposition: 'candidate', radars: ['project'],
      countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '项目位于沙特。', evidence_fact_number: 1 }],
      importance: 'high', evidence_status: 'sourced', urgency: 'research', title_zh: '沙特项目资格预审',
      organizations: [{ canonical_name: 'Principal Buyer', role_zh: '采购方', evidence_fact_number: 1 }],
      project: { name_zh: '示例项目', stage_zh: '资格预审', evidence_fact_number: 1 },
      procurement: { package_zh: '示例项目资格预审', stage_zh: '资格预审', deadline_text: '未披露', evidence_fact_number: 1 }
    }
  };
  const candidate = await state.store.saveCandidate(saved.source.id, 'owner-a', extraction, SOURCE.sha256);
  assert.equal(candidate.review_status, 'auto_validated');
  assert.deepEqual(candidate.occurrence_countries, ['SA']);
  assert.deepEqual(candidate.radars, ['project']);
  assert.equal(state.hypotheses.length, 1);
  assert.equal(state.watches.length, 1);
  assert.deepEqual(state.organizations.map(item => item.canonical_name), ['Principal Buyer']);
  assert.deepEqual(state.projects.map(item => ({ candidate_id: item.candidate_id, country_code: item.country_code, canonical_name: item.canonical_name })),
    [{ candidate_id: candidate.id, country_code: 'SA', canonical_name: '示例项目' }]);
  assert.deepEqual(state.procurements.map(item => ({ project_id: item.project_id, package_name_zh: item.package_name_zh, stage_zh: item.stage_zh })),
    [{ project_id: state.projects[0].id, package_name_zh: '示例项目资格预审', stage_zh: '资格预审' }]);
  state.hypotheses[0].status = 'weakened';
  state.watches[0].status = 'completed';
  await state.store.saveCandidate(saved.source.id, 'owner-a', extraction, SOURCE.sha256);
  assert.equal(state.hypotheses.length, 1);
  assert.equal(state.hypotheses[0].status, 'weakened');
  assert.equal(state.watches.length, 1);
  assert.equal(state.watches[0].status, 'completed');
  assert.ok(!state.calls.some(call => call.method === 'DELETE' && /hypotheses|watch_targets/.test(call.url.pathname)));
  const detail = await state.store.candidateBySource(saved.source.id, 'owner-a');
  assert.equal(detail.tracking.hypotheses[0].status, 'weakened');
  assert.equal(detail.tracking.watches[0].status, 'completed');
  const listed = await state.store.candidates('owner-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title_zh, '沙特项目资格预审');
  assert.equal(Object.hasOwn(listed[0], 'owner_id'), false);
  assert.equal(Object.hasOwn(listed[0], 'source_sha256'), false);
  assert.ok(state.calls.filter(call => call.url.pathname.includes('intelligence_candidates')).every(call =>
    call.method === 'POST' || call.url.searchParams.get('owner_id') === 'eq.owner-a'));
});

test('strict project peers are cross-linked and exposed as one independently supported candidate', async () => {
  const state = backend();
  const firstSource = await state.store.save(SOURCE, 'owner-a');
  const secondBytes = Buffer.from('<html><title>Second source</title><p>Independent evidence</p></html>');
  const secondSource = await state.store.save({ ...SOURCE, finalUrl: 'https://second.example/news', bytes: secondBytes,
    sha256: createHash('sha256').update(secondBytes).digest('hex') }, 'owner-a');
  const classification = (name, organization) => ({
    summary_zh: '沙特储能项目已签约。', maturity: 'contract', hypotheses: [], next_signals_zh: ['观察建设进度。'],
    classification: { disposition: 'candidate', radars: ['project'], countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '位于沙特。', evidence_fact_number: 1 }],
      importance: 'high', evidence_status: 'unverified', urgency: 'research', title_zh: name,
      organizations: [{ canonical_name: organization, role_zh: '开发商', evidence_fact_number: 1 }],
      project: { name_zh: name, stage_zh: '签约', evidence_fact_number: 1 }, procurement: null }
  });
  const firstExtraction = classification('Haden、Muwayh 和 AlKahfah 电池储能项目', 'ACWA Power');
  const secondExtraction = classification('Kahafah、Haden 和 Al-Muwaih BESS 项目', 'ACWA Power Company (ACWA)');
  await state.store.saveExtraction(firstSource.source.id, 'owner-a', { extraction: { ...firstExtraction, known_facts: [{ claim_zh: '容量一致。', evidence_quote: 'Source evidence' }] }, provider: 'deepseek', model: 'deepseek-flash', usage: {} }, SOURCE.sha256);
  await state.store.saveExtraction(secondSource.source.id, 'owner-a', { extraction: { ...secondExtraction, known_facts: [{ claim_zh: '容量一致。', evidence_quote: 'Independent evidence' }] }, provider: 'deepseek', model: 'deepseek-flash', usage: {} }, secondSource.source.content_sha256);
  const first = await state.store.saveCandidate(firstSource.source.id, 'owner-a', firstExtraction, SOURCE.sha256);
  const second = await state.store.saveCandidate(secondSource.source.id, 'owner-a', secondExtraction, secondSource.source.content_sha256);
  assert.equal(state.organizations.length, 1);
  assert.deepEqual(state.aliases.map(item => item.alias).sort(), ['ACWA Power', 'ACWA Power Company (ACWA)']);
  assert.equal(state.projects[0].organization_id, state.projects[1].organization_id);
  const peers = await state.store.findCandidatePeers(second, 'owner-a');
  assert.equal(peers.length, 1);
  assert.equal(peers[0].id, first.id);
  assert.equal(peers[0].extraction_zh.known_facts[0].claim_zh, '容量一致。');
  const secondRecord = state.records.find(row => row.id === second.source_id);
  const originalUrl = secondRecord.final_url;
  secondRecord.final_url = SOURCE.finalUrl;
  assert.equal((await state.store.findCandidatePeers(second, 'owner-a')).length, 0);
  secondRecord.final_url = originalUrl;
  await state.store.saveCrossCheck(second.id, first.id, 'owner-a', {
    matching_facts: [{ left_fact_number: 1, right_fact_number: 1, reason_zh: '两份来源披露相同容量。' }], conflicting_facts: []
  });
  assert.equal(state.relations.length, 2);
  assert.ok(state.candidates.every(item => item.evidence_status === 'checked'));
  const listed = await state.store.candidates('owner-a');
  assert.equal(listed[0].related_sources.length, 1);
  assert.equal(listed[0].related_sources[0].relation, 'supports');
  assert.equal((await state.store.candidateBySource(firstSource.source.id, 'owner-a')).related_sources.length, 1);
  secondRecord.final_url = SOURCE.finalUrl;
  const correctedView = await state.store.candidates('owner-a');
  assert.ok(correctedView.every(item => item.related_sources.length === 0 && item.evidence_status === 'sourced'));
  assert.equal(state.relations.length, 2, 'historical records are retained without inflating independent evidence');

});

test('identical successful imports reuse the source without uploading evidence twice', async () => {
  const state = backend();
  const first = await state.store.save(SOURCE, 'owner-a');
  const second = await state.store.save(SOURCE, 'owner-a');
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.source.id, second.source.id);
  assert.equal(state.records.length, 1);
  assert.equal(state.objects.size, 1);
  const uploads = state.calls.filter(call => call.method === 'POST' && call.url.pathname.startsWith('/storage/'));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].headers['Content-Type'], 'text/html');
  assert.equal(uploads[0].headers['x-upsert'], 'true');
  assert.equal(uploads[0].headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.deepEqual(Buffer.from(uploads[0].body), bytes);
  publicRecord(first.source);
  publicRecord(second.source);
  const evidence = await state.store.evidence(first.source.id, 'owner-a');
  assert.deepEqual(evidence.bytes, bytes);
  assert.equal(evidence.source.content_sha256, SOURCE.sha256);
});

test('an upload failure is visible and retry restores the same record to pending extraction', async () => {
  const state = backend();
  state.failUpload = true;
  await assert.rejects(state.store.save(SOURCE, 'owner-a'), { code: 'storage_failed', status: 502 });
  assert.equal(state.records.length, 1);
  const failedId = state.records[0].id;
  assert.equal(state.records[0].status, 'evidence_failed');
  assert.equal(state.records[0].error_code, 'storage_failed');
  assert.equal(state.objects.size, 0);
  await assert.rejects(state.store.evidence(failedId, 'owner-a'), { code: 'evidence_not_ready', status: 409 });
  state.failUpload = false;
  const restored = await state.store.save(SOURCE, 'owner-a');
  assert.equal(restored.source.id, failedId);
  assert.equal(restored.reused, true);
  assert.equal(state.records.length, 1);
  assert.equal(restored.source.error_code, null);
  publicRecord(restored.source);
  assert.deepEqual((await state.store.evidence(failedId, 'owner-a')).bytes, bytes);
});

test('failure records retain the owner, requested URL and failure code without claiming saved evidence', async () => {
  const state = backend();
  await state.store.recordFailure(SOURCE.requestedUrl, 'owner-a', 'invalid_content_type');
  assert.deepEqual(state.records, [{ owner_id: 'owner-a', requested_url: SOURCE.requestedUrl,
    status: 'fetch_failed', error_code: 'invalid_content_type' }]);
  assert.equal(state.objects.size, 0);
});

test('a late upload failure cannot downgrade evidence saved by a concurrent import', async () => {
  const state = backend();
  let started;
  let release;
  const uploading = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  let uploadCount = 0;
  const store = createStore(CONFIG, async (input, init) => {
    if (init.method === 'POST' && new URL(input).pathname.startsWith('/storage/') && ++uploadCount === 1) {
      started();
      await delayed;
      return new Response(null, { status: 500 });
    }
    return state.fetch(input, init);
  });
  const failedImport = assert.rejects(store.save(SOURCE, 'owner-a'), { code: 'storage_failed' });
  await uploading;
  let successful;
  try {
    successful = await store.save(SOURCE, 'owner-a');
    publicRecord(successful.source);
  } finally {
    release();
    await failedImport;
  }
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].status, 'pending_extraction');
  assert.equal(state.records[0].error_code, null);
  assert.deepEqual((await store.evidence(successful.source.id, 'owner-a')).bytes, bytes);
});

test('upstream failures expose stable errors instead of upstream bodies or transport details', async () => {
  const auth = createStore(CONFIG, async () => new Response('private auth detail', { status: 400 }));
  await assert.rejects(auth.login('admin@example.com', 'test-password'), { message: 'auth_required', code: 'auth_required', status: 401 });
  const database = createStore(CONFIG, async () => new Response('private database detail', { status: 403 }));
  await assert.rejects(database.list('owner-a'), { message: 'upstream_unavailable', status: 502 });
  const transport = createStore(CONFIG, async () => { throw new Error('private transport detail'); });
  await assert.rejects(transport.list('owner-a'), { message: 'upstream_unavailable', status: 502 });
});

test('source persistence retains explicit publication evidence and overview exposes source time', async () => {
  const state = backend();
  const bytes = Buffer.from('<meta property="article:published_time" content="2025-02-20"><p>Official project.</p>');
  const { source } = await state.store.save({ ...SOURCE, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }, 'owner-a');
  assert.equal(source.publication_date, '2025-02-20');
  assert.equal(source.published_at, null);
  assert.match(source.publication_evidence, /2025-02-20/);
  state.candidates.push({ id: '33333333-3333-4333-8333-333333333333', owner_id: 'owner-a', source_id: source.id });
  const candidates = await state.store.candidates('owner-a');
  assert.equal(candidates[0].source_timing.publication_date, '2025-02-20');
  assert.equal(candidates[0].source_timing.fetched_at, source.fetched_at);
});

test('reimporting identical evidence fills previously missing dates without changing first fetch time', async () => {
  const state = backend();
  const item = { ...SOURCE, finalUrl: 'https://spa.gov.sa/en/N2266456', excerpt: 'Riyadh, February 20, 2025, SPA -- Project.' };
  const { source } = await state.store.save(item, 'owner-a');
  const row = state.records.find(row => row.id === source.id);
  row.publication_method = null; row.publication_date = null; row.publication_evidence = null;
  row.fetched_at = '2026-09-22T00:00:00Z';
  const result = await state.store.save(item, 'owner-a');
  assert.equal(result.reused, true);
  assert.equal(result.source.publication_date, '2025-02-20');
  assert.equal(result.source.fetched_at, '2026-09-22T00:00:00Z');
  assert.equal(state.objects.size, 1);
});

test('version history is scoped to the owner and URL, exposing only hash-bound stage evidence', async () => {
  const versions = [
    { id: 'new', title: 'New', final_url: 'https://source.example/news', content_sha256: 'a'.repeat(64), extraction_source_sha256: 'a'.repeat(64),
      extraction_status: 'extracted', fetched_at: '2026-09-24T00:00:00Z', publication_date: '2026-09-23',
      extraction_zh: { maturity: 'contract', classification: { project: { name_zh: '测试项目', stage_zh: '签约', evidence_fact_number: 1 }, procurement: null },
        known_facts: [{ claim_zh: '已签约。', evidence_quote: 'The project agreement was signed.' }] } },
    { id: 'old', title: 'Old', final_url: 'https://source.example/news', content_sha256: 'b'.repeat(64), extraction_source_sha256: 'wrong',
      extraction_status: 'extracted', fetched_at: '2026-09-23T00:00:00Z', publication_date: null,
      extraction_zh: { maturity: 'procurement', classification: { project: { name_zh: '未校验', evidence_fact_number: 1 } }, known_facts: [{ evidence_quote: 'must not appear' }] } }
  ];
  const requests = [];
  const store = createStore({ url: 'https://db.example', serviceKey: 'test-key' }, async input => {
    const url = new URL(input); requests.push(url);
    assert.equal(url.searchParams.get('owner_id'), 'eq.owner-a');
    return new Response(JSON.stringify(url.searchParams.has('id') ? [versions[0]] : versions));
  });
  const history = await store.sourceHistory('new', 'owner-a');
  assert.equal(requests[1].searchParams.get('final_url'), 'eq.https://source.example/news');
  assert.equal(requests[1].searchParams.get('order'), 'fetched_at.desc');
  assert.equal(history[0].maturity, 'contract');
  assert.equal(history[0].project_evidence.evidence_quote, 'The project agreement was signed.');
  assert.equal(history[1].maturity, null);
  assert.equal(history[1].project_evidence, null);
  assert.equal(history[1].publication_date, null);
  assert.ok(!JSON.stringify(history).includes('must not appear'));
});

test('manual assessment can create or reuse a run without unsupported empty RPC keys', async () => {
  for (const exists of [false, true]) {
    const requests = [];
    const store = createStore({ url: 'https://db.example', serviceKey: 'test' }, async (input, init) => {
      const url = new URL(input); requests.push({ url, init });
      assert.equal(url.pathname, '/rest/v1/intelligence_job_runs');
      if (init.method === 'POST') {
        assert.equal(init.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
        assert.deepEqual(JSON.parse(init.body), { owner_id: 'owner', job_type: 'daily_scan', schedule_key: '2026-09-24' });
        return new Response(JSON.stringify(exists ? [] : [{ id: 'new-run' }]));
      }
      assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
      assert.equal(url.searchParams.get('job_type'), 'eq.daily_scan');
      assert.equal(url.searchParams.get('schedule_key'), 'eq.2026-09-24');
      return new Response(JSON.stringify([{ id: 'paused-existing-run' }]));
    });
    assert.equal(await store.enqueueJob('owner', 'daily_scan', '2026-09-24', []), exists ? 'paused-existing-run' : 'new-run');
    assert.equal(requests.length, exists ? 2 : 1);
    assert.ok(requests.every(r => r.init.method !== 'PATCH'));
  }
});
