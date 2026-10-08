const test = require('node:test');
const assert = require('node:assert/strict');
const { COUNTRIES, dailySearchCountries, scheduleDate, runPaidCall, enqueueDailyScan, runDailyJobItem, sourceItem } = require('../lib/intelligence/jobs.cjs');
const { automaticCallReserve } = require('../lib/intelligence/budget.cjs');
const { registry } = require('../lib/intelligence/registry.cjs');

const sourceId = '11111111-1111-4111-8111-111111111111';
const groundedExtraction = { summary_zh: '已保存的官方证据。', why_it_matters_zh: '仅作为背景，不创建项目。',
  known_facts: [{ claim_zh: '官方证据原文。', evidence_quote: 'Official source evidence.' }],
  unknowns_zh: ['未披露项目。'], hypotheses: [], next_signals_zh: ['等待正式项目公告。'], maturity: 'background',
  classification: { disposition: 'source_only', countries: [], radars: [], organizations: [], project: null, procurement: null } };

function fakeStore({ reservationId = 'reservation-1', item = { id: 'item-1', item_key: 'discover:SA', attempts: 1, checkpoint: {} } } = {}) {
  const calls = [];
  const source = { id: sourceId, title: 'Official notice', final_url: 'https://official.example/a', content_type: 'text/plain', content_sha256: 'a'.repeat(64) };
  const methods = {
    snapshotDirections: async () => null, bindDirectionSource: async () => {}, sourceDirections: async () => [],
    directionQueryCounts: async () => [], jobTopics: async () => null,
    topicCatalog: async () => require('../lib/intelligence/topics.cjs').defaults,
    sourcePaused: async () => false, sourceLibrary: async () => [],
    reviewTracking: async () => ({}), watchedSources: async () => [], watchSearchTargets: async () => [], jobRun: async () => ({ items: [] }), enqueueJob: async () => 'job-1', enqueueJobItems: async (_owner, _job, items) => items.length,
    claimJobItem: async () => item, finishJobItem: async () => true,
    startProviderCall: async () => true, finishProviderCall: async () => true,
    reserveBudget: async () => reservationId, settleBudget: async () => true, releaseBudget: async () => true,
    syncProviderBalance: async () => true,
    save: async () => ({ source, reused: false }), recordFailure: async () => {}, evidence: async () => ({ source, bytes: Buffer.from('Official source evidence.') }),
    beginExtraction: async () => {}, saveExtraction: async () => source, saveCandidate: async () => ({ id: 'candidate-1' }),
    previousExtractedSource: async () => null, findCandidatePeers: async () => [], assessmentTargets: async () => [], saveCrossCheck: async () => ({}), failExtraction: async () => {},
    providerConfigs: async () => []
  };
  const store = { calls };
  for (const [name, fn] of Object.entries(methods)) store[name] = async (...args) => { calls.push([name, ...args]); return fn(...args); };
  store.snapshotSearchPlan = async (...args) => ({ directions: await store.snapshotDirections(...args), topics: null, legacy: false });
  return store;
}

const dependencies = {
  sourceFetcher: async url => ({ requestedUrl: url }),
  modelFactory: () => async () => ({ extraction: {}, provider: 'deepseek', model: 'deepseek-flash', usage: {} }),
  crossCheckFactory: () => async () => ({ same_project: false, matching_facts: [], conflicting_facts: [] }),
  balanceReaderFactory: () => async () => 1_000_000
};

test('daily schedule uses the configured timezone and stable six-country item keys', async () => {
  assert.equal(scheduleDate(new Date('2026-09-21T16:30:00Z')), '2026-09-22');
  const store = fakeStore();
  const result = await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-09-22T00:00:00Z') });
  assert.equal(result.jobId, 'job-1');
  assert.deepEqual(store.calls[0], ['enqueueJob', 'owner-a', 'daily_scan', result.scheduleKey, []]);
  assert.deepEqual(store.calls.find(call => call[0] === 'enqueueJobItems'), ['enqueueJobItems', 'owner-a', 'job-1',
    [...dailySearchCountries(result.scheduleKey).map(code => `discover:${code}`), ...registry.map(entry => `registry:${entry.id}`)]
      .map(item_key => ({ item_key, checkpoint: {} }))]);
});

test('Nama article aliases use the verified canonical article URL while retaining discovery provenance', () => {
  const slug = 'nama-power-and-water-procurement-signs-agreement-with-sembcorp-utilities-and-oq-alternative-energy-to-develop-the-dhofar-ii-wind-power-project-in-the-sultanate-of-oman';
  const original = `https://omanpwp.om/public/news-details/${slug}`;
  const canonical = `https://www.omanpwp.om/news-details/${slug}`;
  const alias = sourceItem({ url: original }, 'OM');
  const standard = sourceItem({ url: canonical }, 'OM');
  assert.equal(alias.item_key, standard.item_key);
  assert.deepEqual(alias.checkpoint, { country: 'OM', url: canonical, discovered_url: original });
  assert.deepEqual(standard.checkpoint, { country: 'OM', url: canonical });
});

test('the server derives a bounded call reservation from each service monthly limit', () => {
  assert.equal(automaticCallReserve('discovery', 'CNY', 10_000_000), 2_000_000);
  assert.equal(automaticCallReserve('extraction', 'CNY', 10_000_000), 1_000_000);
  assert.equal(automaticCallReserve('cross_check', 'CNY', 10_000_000), 500_000);
  assert.equal(automaticCallReserve('discovery', 'USD', 200_000), 200_000);
  assert.equal(automaticCallReserve('extraction', 'EUR', 10_000_000), null);
});

test('missing or exhausted discovery budget pauses before calling MiniMax', async () => {
  for (const setup of [{ env: {}, reservationId: 'reservation-1', error: 'budget_not_configured' },
    { env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000' }, reservationId: null, error: 'budget_exhausted' }]) {
    const store = fakeStore({ reservationId: setup.reservationId });
    let called = false;
    const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: setup.env,
      discover: async () => { called = true; return []; }, ...dependencies });
    assert.equal(result.status, 'budget_paused');
    assert.equal(called, false);
    assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], setup.error);
  }
});

test('duplicate discovery URLs enqueue one source item and finish only discovery', async () => {
  const store = fakeStore();
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1',
    env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1200' }, ...dependencies,
    discover: async () => ({ sources: [{ url: 'https://official.example/a' }, { url: 'https://official.example/a#duplicate' }],
      model: 'MiniMax-M3', search_count: 1, usage: { input_tokens: 10, output_tokens: 5 } }) });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultCount, 1);
  const enqueued = store.calls.find(call => call[0] === 'enqueueJobItems');
  assert.equal(enqueued[3].length, 1);
  assert.deepEqual(enqueued[3][0], sourceItem({ url: 'https://official.example/a' }, 'SA'));
  assert.equal(store.calls.filter(call => call[0] === 'finishJobItem').length, 1);
});

test('source item saves evidence idempotently and queues one extraction item', async () => {
  const work = sourceItem({ url: 'https://official.example/a' }, 'SA');
  const store = fakeStore({ item: { id: 'item-source', item_key: work.item_key, attempts: 1, checkpoint: work.checkpoint } });
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, discover: async () => [], ...dependencies });
  assert.equal(result.sourceId, sourceId);
  assert.ok(store.calls.some(call => call[0] === 'save'));
  assert.deepEqual(store.calls.find(call => call[0] === 'enqueueJobItems')[3],
    [{ item_key: `extract:${sourceId}`, checkpoint: { source_id: sourceId } }]);
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[3], 'succeeded');
});

test('a database rejection during source saving is not labelled a website fetch failure', async () => {
  const work = sourceItem({ url: 'https://official.example/a' }, 'BH');
  const store = fakeStore({ item: { id: 'item-source', item_key: work.item_key, attempts: 3, checkpoint: work.checkpoint } });
  store.save = async () => { throw Object.assign(new Error('private database message'), { code: 'storage_constraint' }); };
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'storage_constraint');
  assert.equal(store.calls.some(call => call[0] === 'enqueueJobItems'), false);
});

test('source failure keeps its safe cause and does not enqueue a model call', async () => {
  const work = sourceItem({ url: 'https://official.example/a' }, 'OM');
  const store = fakeStore({ item: { id: 'item-source', item_key: work.item_key, attempts: 3, checkpoint: work.checkpoint } });
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies,
    sourceFetcher: async () => { throw Object.assign(new Error('private TLS details'), { code: 'source_tls_error' }); } });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'source_tls_error');
  assert.ok(!store.calls.some(call => ['reserveBudget', 'enqueueJobItems'].includes(call[0])));
});

test('discovered publisher listings are rejected as articles without retry or model call', async () => {
  for (const finalUrl of ['https://masdar.ae/en/news/newsroom', 'https://www.omanpwp.om/public/index.php/news']) {
    const work = sourceItem({ url: finalUrl }, 'AE');
    const store = fakeStore({ item: { id: 'item-listing', item_key: work.item_key, attempts: 1, checkpoint: work.checkpoint } });
    const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies,
      sourceFetcher: async () => { throw new Error('Known listing must not be fetched'); } });
    assert.equal(result.status, 'failed');
    assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'source_listing_page');
    assert.ok(!store.calls.some(call => ['save', 'reserveBudget', 'enqueueJobItems'].includes(call[0])));
  }
  const work = sourceItem({ url: 'https://masdar.ae/New-News-and-Events' }, 'AE');
  const store = fakeStore({ item: { id: 'item-redirected-listing', item_key: work.item_key, attempts: 1, checkpoint: work.checkpoint } });
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies,
    sourceFetcher: async () => ({ finalUrl: 'https://masdar.ae/en/news/newsroom' }) });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'source_listing_page');
});

test('saved empty shell stops before budget and model calls without repeated extraction', async () => {
  const store = fakeStore({ item: { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } } });
  store.evidence = async () => ({ source: { id: sourceId, content_type: 'text/html' }, bytes: Buffer.from('<body><script>loadArticle()</script></body>') });
  let modelCalled = false;
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies,
    modelFactory: () => { modelCalled = true; throw new Error('must not call'); } });
  assert.equal(result.status, 'failed');
  assert.equal(modelCalled, false);
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'source_empty_document');
  assert.ok(!store.calls.some(call => ['reserveBudget', 'providerConfigs'].includes(call[0])));
});

test('discovery retries pass their bounded attempt to the query selector', async () => {
  const store = fakeStore({ item: { id: 'item-1', item_key: 'discover:KW', attempts: 2, checkpoint: {} } });
  let received;
  await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', ...dependencies,
    env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1200' },
    discover: async (country, _profile, attempt) => { received = { country, attempt }; return { sources: [] }; } });
  assert.deepEqual(received, { country: 'KW', attempt: 2 });
});

test('unchanged extracted source finishes without another DeepSeek task', async () => {
  const work = sourceItem({ url: 'https://official.example/a' }, 'SA');
  const unchanged = { id: sourceId, content_sha256: 'a'.repeat(64), extraction_status: 'extracted', extraction_source_sha256: 'a'.repeat(64) };
  const store = fakeStore({ item: { id: 'item-source', item_key: work.item_key, attempts: 1, checkpoint: work.checkpoint } });
  store.save = async (...args) => { store.calls.push(['save', ...args]); return { source: unchanged, reused: true }; };
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, discover: async () => ({}), ...dependencies });
  assert.equal(result.status, 'succeeded');
  assert.ok(!store.calls.some(call => call[0] === 'enqueueJobItems'));
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[4].unchanged, true);
});

test('provider balance is synced before and after a paid call without estimating from tokens', async () => {
  const store = fakeStore();
  const balances = [1_000_000, 980_000];
  await runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY', budgetKey: 'RESERVE',
    env: { RESERVE: '100000' }, readBalance: async () => balances.shift(), call: async () => ({ ok: true }) });
  assert.deepEqual(store.calls.filter(call => call[0] === 'syncProviderBalance').map(call => call.slice(1)), [
    ['owner-a', 'analysis', 'CNY', 1_000_000], ['owner-a', 'analysis', 'CNY', 980_000]
  ]);
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('included plan releases the reservation and never records monetary spend', async () => {
  const store = fakeStore();
  await runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'USD', budgetKey: 'RESERVE',
    billingMode: 'included', env: { RESERVE: '10000' }, call: async () => ({ ok: true }) });
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('a failed pre-call balance sync does not reserve budget or call the model', async () => {
  const store = fakeStore();
  let called = false;
  await assert.rejects(runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY',
    budgetKey: 'RESERVE', env: { RESERVE: '10000' }, readBalance: async () => { throw new Error('private detail'); },
    call: async () => { called = true; } }), { code: 'billing_sync_unavailable' });
  assert.equal(called, false);
  assert.ok(!store.calls.some(call => call[0] === 'reserveBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('a failed post-call balance sync keeps the reservation pending instead of inventing spend', async () => {
  const store = fakeStore();
  let reads = 0;
  await assert.rejects(runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY',
    budgetKey: 'RESERVE', env: { RESERVE: '10000' }, readBalance: async () => {
      reads += 1;
      if (reads === 1) return 1_000_000;
      throw new Error('private detail');
    }, call: async () => ({ ok: true }) }), { code: 'billing_sync_pending' });
  assert.ok(!store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('missing extraction budget keeps saved evidence and pauses before DeepSeek', async () => {
  const item = { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } };
  const store = fakeStore({ item });
  let modelCalled = false;
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, discover: async () => [], ...dependencies,
    modelFactory: () => async () => { modelCalled = true; return {}; } });
  assert.equal(result.status, 'budget_paused');
  assert.equal(modelCalled, false);
  assert.ok(store.calls.some(call => call[0] === 'evidence'));
  assert.ok(!store.calls.some(call => call[0] === 'beginExtraction'));
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'budget_not_configured');
});

test('successful extraction finishes only its claimed item', async () => {
  const item = { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } };
  const store = fakeStore({ item });
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1',
    env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000' }, discover: async () => [], ...dependencies });
  assert.equal(result.status, 'succeeded');
  assert.ok(store.calls.some(call => call[0] === 'saveExtraction'));
  assert.equal(store.calls.filter(call => call[0] === 'finishJobItem').length, 1);
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[2], 'item-extract');
});

test('failed extraction retries only its item and records a stable source failure', async () => {
  const item = { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } };
  const store = fakeStore({ item });
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1',
    env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000' }, discover: async () => [], ...dependencies,
    modelFactory: () => async () => { throw new Error('private provider detail'); } });
  assert.equal(result.status, 'retry');
  assert.deepEqual(store.calls.find(call => call[0] === 'failExtraction').slice(1), [sourceId, 'owner-a', 'model_unavailable']);
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[5], 'extraction_failed');
  assert.equal(store.calls.filter(call => call[0] === 'finishJobItem').length, 1);
});

test('controlled model rate limits and timeouts retry once claimed and become visible terminal failures', async () => {
  for (const code of ['model_rate_limited', 'model_timeout']) {
    const first = fakeStore({ item: { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 1,
      checkpoint: { source_id: sourceId } } });
    const options = { owner: 'owner-a', jobId: 'job-1', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000' },
      discover: async () => [], ...dependencies,
      modelFactory: () => async () => { throw Object.assign(new Error('controlled provider failure'), { code }); } };
    assert.equal((await runDailyJobItem({ ...options, store: first })).status, 'retry');
    assert.deepEqual(first.calls.find(call => call[0] === 'failExtraction').slice(1), [sourceId, 'owner-a', code]);
    assert.equal(first.calls.find(call => call[0] === 'finishJobItem')[5], code);

    const terminal = fakeStore({ item: { id: 'item-extract', item_key: `extract:${sourceId}`, attempts: 3,
      checkpoint: { source_id: sourceId } } });
    assert.equal((await runDailyJobItem({ ...options, store: terminal })).status, 'failed');
    assert.deepEqual(terminal.calls.find(call => call[0] === 'failExtraction').slice(1), [sourceId, 'owner-a', code]);
    assert.equal(terminal.calls.find(call => call[0] === 'finishJobItem')[3], 'failed');
    assert.equal(terminal.calls.find(call => call[0] === 'finishJobItem')[5], code);
  }
});

test('a missing provider configuration releases a manual reservation without marking it spent', async () => {
  const store = fakeStore();
  await assert.rejects(runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY',
    budgetKey: 'RESERVE', providerMissingCode: 'model_not_configured', env: { RESERVE: '900' },
    readBalance: async () => 1_000_000,
    call: async () => { throw Object.assign(new Error('missing'), { code: 'model_not_configured' }); } }), { code: 'model_not_configured' });
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('paid calls require an explicit supported currency before reserving', async () => {
  const store = fakeStore();
  await assert.rejects(runPaidCall({ store, owner: 'owner-a', operation: 'extraction',
    budgetKey: 'RESERVE', providerMissingCode: 'model_not_configured', env: { RESERVE: '900' }, call: async () => ({}) }),
  { code: 'budget_not_configured' });
  assert.ok(!store.calls.some(call => call[0] === 'reserveBudget'));
});

test('scheduler resumes the claimed older run and fences completion with its attempt', async () => {
  const store = fakeStore({ item: { id: 'item-old', job_run_id: 'job-yesterday', item_key: 'discover:SA', attempts: 2, checkpoint: {} } });
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000' },
    ...dependencies, discover: async () => ({ sources: [] }) });
  assert.equal(result.jobId, 'job-yesterday');
  assert.deepEqual(store.calls.find(call => call[0] === 'claimJobItem').slice(1), ['owner-a', null, 300]);
  assert.equal(store.calls.find(call => call[0] === 'finishJobItem')[6], 2);
  assert.equal(store.calls.find(call => call[0] === 'reserveBudget')[2], 'job-yesterday');
});

test('third failure is terminal and a stale completion never reports success', async () => {
  const store = fakeStore({ item: { id: 'item-old', job_run_id: 'job-old', item_key: 'discover:SA', attempts: 3, checkpoint: {} } });
  const options = { store, owner: 'owner-a', ...dependencies, env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000' },
    discover: async () => { throw new Error('private response'); } };
  assert.equal((await runDailyJobItem(options)).status, 'failed');
  store.finishJobItem = async () => false;
  assert.equal((await runDailyJobItem({ ...options, discover: async () => ({ sources: [] }) })).status, 'lease_lost');
});

test('saved extraction survives retry and schedules peer checks without another model call', async () => {
  const store = fakeStore({ item: { id: 'item-extract', job_run_id: 'job-1', item_key: `extract:${sourceId}`,
    attempts: 2, checkpoint: { source_id: sourceId } } });
  store.evidence = async () => ({ source: { id: sourceId, content_type: 'text/plain', content_sha256: 'a'.repeat(64),
    extraction_status: 'extracted', extraction_source_sha256: 'a'.repeat(64), extraction_zh: groundedExtraction },
    bytes: Buffer.from('Official source evidence.') });
  const peerId = '22222222-2222-4222-8222-222222222222';
  store.findCandidatePeers = async () => [{ id: 'candidate-peer', source_id: peerId }];
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: {}, ...dependencies,
    modelFactory: () => { throw new Error('must not re-extract'); },
    crossCheckFactory: () => { throw new Error('cross-check must be a separate item'); } });
  assert.equal(result.status, 'succeeded');
  assert.ok(!store.calls.some(call => ['reserveBudget', 'saveExtraction', 'beginExtraction'].includes(call[0])));
  assert.deepEqual(store.calls.find(call => call[0] === 'enqueueJobItems')[3], [{
    item_key: `cross:${sourceId}:${peerId}`, checkpoint: { left_source_id: sourceId, right_source_id: peerId }
  }]);
});

test('one budgeted format repair uses the checkpoint and a second invalid result stops', async () => {
  const env = { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '10000000', NRGOPT_ANALYSIS_BILLING_MODE: 'included' };
  const first = { id: 'item-extract', job_run_id: 'job-1', item_key: `extract:${sourceId}`, attempts: 1,
    checkpoint: { source_id: sourceId } };
  const store = fakeStore({ item: first });
  let item = first;
  store.claimJobItem = async () => item;
  const seen = [];
  const options = { store, owner: 'owner-a', env, ...dependencies, modelFactory: () => async input => {
    seen.push(input.formatRepairCode);
    throw Object.assign(new Error('invalid provider output'), { code: 'extraction_invalid_early_opportunity_evidence' });
  } };
  assert.equal((await runDailyJobItem(options)).status, 'retry');
  const checkpoint = store.calls.filter(call => call[0] === 'finishJobItem').at(-1)[4];
  assert.equal(checkpoint.format_repair_code, 'extraction_invalid_early_opportunity_evidence');
  item = { ...first, attempts: 2, checkpoint };
  assert.equal((await runDailyJobItem(options)).status, 'failed');
  assert.deepEqual(seen, [null, 'extraction_invalid_early_opportunity_evidence']);
  assert.equal(store.calls.filter(call => call[0] === 'reserveBudget').length, 2);
  assert.equal(store.calls.filter(call => call[0] === 'finishJobItem').at(-1)[3], 'failed');
  const recovered = fakeStore({ item: { ...first, attempts: 2, checkpoint } });
  const success = await runDailyJobItem({ ...options, store: recovered,
    modelFactory: () => async input => {
      assert.equal(input.formatRepairCode, 'extraction_invalid_early_opportunity_evidence');
      return { extraction: groundedExtraction, provider: 'deepseek', model: 'deepseek-flash', usage: {} };
    } });
  assert.equal(success.status, 'succeeded');
  assert.equal(recovered.calls.filter(call => call[0] === 'reserveBudget').length, 1);
  const exhausted = fakeStore({ item: { ...first, attempts: 3 } });
  assert.equal((await runDailyJobItem({ ...options, store: exhausted })).status, 'failed');
  assert.equal(exhausted.calls.filter(call => call[0] === 'finishJobItem').at(-1)[4].format_repair_code, undefined);
});

test('cross-check work uses saved evidence and does not repeat a persisted relation', async () => {
  const peerId = '22222222-2222-4222-8222-222222222222';
  const store = fakeStore({ item: { id: 'item-cross', job_run_id: 'job-1', item_key: `cross:${sourceId}:${peerId}`, attempts: 1,
    checkpoint: { left_source_id: sourceId, right_source_id: peerId } } });
  let related = false;
  store.candidateBySource = async id => ({ id: id === sourceId ? 'left' : 'right',
    related_sources: related ? [{ related_candidate_id: 'right', same_scope: false }] : [] });
  store.get = async id => ({ final_url: id === sourceId ? 'https://left.example/a' : 'https://right.example/b',
    content_sha256: id, extraction_zh: { summary_zh: id } });
  let checked = 0;
  const options = { store, owner: 'owner-a', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '1000' }, ...dependencies,
    crossCheckFactory: () => async ({ left, right }) => {
      checked += 1;
      assert.equal(left.extraction_zh.summary_zh, sourceId);
      assert.equal(right.extraction_zh.summary_zh, peerId);
      return { same_project: true, matching_facts: [], conflicting_facts: [] };
    } };
  assert.equal((await runDailyJobItem(options)).status, 'succeeded');
  assert.equal(checked, 1);
  assert.ok(store.calls.some(call => call[0] === 'saveCrossCheck'));
  related = true;
  assert.equal((await runDailyJobItem(options)).status, 'succeeded');
  assert.equal(checked, 1);
});

test('provider HTTP 402 pauses discovery instead of scheduling repeated balance failures', async () => {
  const store = fakeStore();
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1',
    env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000', NRGOPT_DISCOVERY_BILLING_MODE: 'included' }, ...dependencies,
    discover: async () => { throw Object.assign(new Error('insufficient balance (1008)'), { code: 'discovery_balance_insufficient' }); } });
  assert.equal(result.status, 'budget_paused');
  const finish = store.calls.find(call => call[0] === 'finishJobItem');
  assert.equal(finish[3], 'budget_paused');
  assert.equal(finish[5], 'discovery_balance_insufficient');
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('provider plan limit pauses discovery instead of scheduling repeated balance failures', async () => {
  const store = fakeStore();
  const result = await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1',
    env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '1000', NRGOPT_DISCOVERY_BILLING_MODE: 'included' }, ...dependencies,
    discover: async () => { throw Object.assign(new Error('plan quota exhausted'), { code: 'discovery_plan_unavailable' }); } });
  assert.equal(result.status, 'budget_paused');
  const finish = store.calls.find(call => call[0] === 'finishJobItem');
  assert.equal(finish[3], 'budget_paused');
  assert.equal(finish[5], 'discovery_plan_unavailable');
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('daily scan revisits active watched URLs with the same deduplicated source keys', async () => {
  const store = fakeStore();
  store.watchedSources = async () => [{ url: 'https://official.example/watch' }, { url: 'https://official.example/watch#fragment' }];
  await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-09-24T00:00:00Z') });
  const items = store.calls.find(call => call[0] === 'enqueueJobItems' && call[3][0]?.checkpoint.watch)[3];
  assert.equal(items.length, 1);
  assert.equal(items[0].item_key, sourceItem({ url: 'https://official.example/watch' }, null).item_key);
  assert.deepEqual(items[0].checkpoint, { url: 'https://official.example/watch', watch: true });
});

test('template-only source changes reuse verified model input without another paid extraction', async () => {
  const previousId = '22222222-2222-4222-8222-222222222222';
  const text = 'The official report states that the project is under construction.';
  const extraction = { summary_zh: '项目正在建设。', why_it_matters_zh: '关注项目建设进度。',
    known_facts: [{ claim_zh: '项目正在建设。', evidence_quote: text }], unknowns_zh: ['投运日期未披露。'],
    hypotheses: [], next_signals_zh: ['观察投运公告。'], maturity: 'background',
    classification: { disposition: 'source_only', countries: [], radars: [], organizations: [], project: null, procurement: null } };
  for (const changed of [false, true]) {
    const store = fakeStore({ item: { id: 'item-extract', job_run_id: 'job-1', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } } });
    const previous = { id: previousId, title: 'Official notice', final_url: 'https://official.example/a', content_type: 'text/html',
      content_sha256: 'b'.repeat(64), extraction_source_sha256: 'b'.repeat(64), extraction_status: 'extracted', extraction_zh: extraction,
      extraction_provider: 'deepseek', extraction_model: 'old-model', extracted_at: '2026-09-23T00:00:00Z' };
    store.previousExtractedSource = async () => previous;
    store.evidence = async id => ({ source: id === previousId ? previous : {
      id: sourceId, title: previous.title, final_url: previous.final_url, content_type: 'text/html', content_sha256: 'a'.repeat(64)
    }, bytes: Buffer.from(`<script>nonce-${id}</script><main>${text}${changed && id === sourceId ? ' New project stage.' : ''}</main>`) });
    let calls = 0;
    const result = await runDailyJobItem({ store, owner: 'owner-a', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000000' }, ...dependencies,
      modelFactory: () => async () => { calls++; return { extraction, provider: 'deepseek', model: 'new-model', usage: {} }; } });
    assert.equal(result.status, 'succeeded');
    assert.equal(calls, changed ? 1 : 0);
    const saved = store.calls.find(call => call[0] === 'saveExtraction');
    assert.equal(saved[4], 'a'.repeat(64));
    if (!changed) {
      assert.equal(saved[3].extraction.reused_from_source_id, previousId);
      assert.equal(saved[3].extractedAt, previous.extracted_at);
      assert.equal(saved[3].model, 'old-model');
      assert.ok(!store.calls.some(call => call[0] === 'reserveBudget'));
    }
  }
});

test('already queued cross-check skips another version from the same publisher', async () => {
  const peerId = '22222222-2222-4222-8222-222222222222';
  const store = fakeStore({ item: { id: 'item-cross', job_run_id: 'job-1', item_key: `cross:${sourceId}:${peerId}`, attempts: 1,
    checkpoint: { left_source_id: sourceId, right_source_id: peerId } } });
  store.candidateBySource = async id => ({ id, related_sources: [] });
  store.get = async id => ({ final_url: id === sourceId ? 'https://www.official.example/a' : 'https://official.example/b', content_sha256: id });
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: {}, ...dependencies,
    crossCheckFactory: () => { throw Error('same publisher must not count as independent'); } });
  assert.equal(result.status, 'succeeded');
  assert.ok(!store.calls.some(call => ['reserveBudget', 'saveCrossCheck'].includes(call[0])));
});

test('same publisher correction with shared project evidence is cross-checked', async () => {
  const peerId = '22222222-2222-4222-8222-222222222222';
  const store = fakeStore({ item: { id: 'item-cross-correction', job_run_id: 'job-1',
    item_key: `cross:${sourceId}:${peerId}`, attempts: 1,
    checkpoint: { left_source_id: sourceId, right_source_id: peerId } } });
  const candidate = id => ({ id, related_sources: [], disposition: 'candidate', occurrence_countries: ['KW'],
    organizations_zh: [{ canonical_name: 'هيئة مشروعات الشراكة بين القطاعين العام والخاص' }],
    project_zh: { name_zh: id === sourceId ? 'Al-Khairan Phase One' : 'محطة الخيران المرحلة الأولى' } });
  const extraction = id => ({ known_facts: [{ claim_zh: id === sourceId
    ? 'Al-Khairan一期资格预审截止2022年8月16日。'
    : '官方取消旧邀请并重新邀请Al-Khairan一期资格申请，截止2023年7月11日。' }] });
  store.candidateBySource = async id => candidate(id);
  store.get = async id => ({ final_url: `https://official.example/${id}`, content_sha256: id,
    extracted_at: '2026-09-25T00:00:00Z', extraction_zh: extraction(id) });
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: {
    DEEPSEEK_API_KEY: 'test-key', NRGOPT_DEEPSEEK_EXTRACTION_RESERVE_MICROCNY: '500000'
  }, ...dependencies, crossCheckFactory: () => async () => ({ same_project: true, same_scope: true,
    matching_facts: [{ left_fact_number: 1, right_fact_number: 1, reason_zh: '同一项目资格预审更新。' }], conflicting_facts: [] }) });
  assert.equal(result.status, 'succeeded');
  assert.ok(store.calls.some(call => call[0] === 'reserveBudget'));
  assert.ok(store.calls.some(call => call[0] === 'saveCrossCheck'));
});

test('saved extraction durably queues prior hypotheses for evidence assessment', async () => {
  const hypothesisId = '22222222-2222-4222-8222-222222222222';
  const store = fakeStore({ item: { id: 'extract-item', job_run_id: 'job-1', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } } });
  store.assessmentTargets = async () => [{ id: hypothesisId }];
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000000' }, ...dependencies });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(store.calls.find(c => c[0] === 'enqueueJobItems')[3], [{ item_key: `hypothesis:${hypothesisId}:${sourceId}`, checkpoint: { hypothesis_id: hypothesisId, source_id: sourceId } }]);
});

test('unchanged raw HTML queues re-extraction when old evidence came from an excluded sidebar', async () => {
  const work = sourceItem({ url: 'https://official.example/a' }, 'OM');
  const old = { id: sourceId, content_sha256: 'a'.repeat(64), extraction_status: 'extracted',
    extraction_source_sha256: 'a'.repeat(64), extraction_zh: groundedExtraction };
  const bytes = Buffer.from('<main><div class="news-dt-body"><h3>Current project notice</h3><p>New primary article.</p></div><section>Official source evidence.</section></main>');
  const store = fakeStore({ item: { id: 'item-source', item_key: work.item_key, attempts: 1, checkpoint: work.checkpoint } });
  store.save = async () => ({ source: old, reused: true });
  assert.equal((await runDailyJobItem({ store, owner: 'owner-a', jobId: 'job-1', env: {}, ...dependencies,
    sourceFetcher: async () => ({ bytes, contentType: 'text/html' }) })).status, 'succeeded');
  assert.ok(store.calls.some(c => c[0] === 'enqueueJobItems' && c[3][0].item_key === `extract:${sourceId}`));
  assert.equal(store.calls.find(c => c[0] === 'finishJobItem')[4].unchanged, false);
  store.claimJobItem = async () => ({ id: 'extract-item', job_run_id: 'job-1', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } });
  store.evidence = async () => ({ source: { ...old, content_type: 'text/html' }, bytes });
  let calls = 0;
  const result = await runDailyJobItem({ store, owner: 'owner-a', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000000' }, ...dependencies,
    modelFactory: () => async () => { calls++; return { extraction: {}, provider: 'deepseek', model: 'fixture', usage: {} }; } });
  assert.equal(result.status, 'succeeded');
  assert.equal(calls, 1);
});

test('supported MENA countries do not silently enable searches and extra searches remain bounded', () => {
  const { primaryHosts, discoveryQuery } = require('../lib/intelligence/discovery.cjs');
  assert.equal(COUNTRIES.length, 24);
  assert.match(discoveryQuery('EH'), /Western Sahara.*Laayoune/);
  assert.match(discoveryQuery('EH', 2), /Laayoune/);
  assert.deepEqual(dailySearchCountries('2026-09-27').slice(0, 6), ['SA', 'AE', 'QA', 'KW', 'OM', 'BH']);
  assert.ok(dailySearchCountries('2026-09-27').length <= 8);
  assert.equal(Object.keys(primaryHosts).length, 24);
  assert.match(discoveryQuery('SY'), /Syria/);
  assert.throws(() => discoveryQuery('XX'), { code: 'discovery_country_not_enabled' });
  const saved = { ...primaryHosts };
  for (const code of ['EG', 'TR', 'MA']) primaryHosts[code] = ['fixture.invalid'];
  try {
    const first = dailySearchCountries('2026-09-27');
    assert.equal(first.length, 8);
    assert.deepEqual(first.slice(0, 6), ['SA', 'AE', 'QA', 'KW', 'OM', 'BH']);
    assert.notDeepEqual(first, dailySearchCountries('2026-09-28'));
    assert.ok(!discoveryQuery('TR', 3).includes('site:'));
  } finally { for (const code of ['EG', 'TR', 'MA']) { if (saved[code]) primaryHosts[code] = saved[code]; else delete primaryHosts[code]; } }
});

test('a mid-day region release keeps the first persisted country search selection', async () => {
  const store = fakeStore();
  const selected = ['SA','AE','QA','KW','OM','BH','TR','DZ'];
  store.jobRun = async () => ({ items: selected.map(code => ({ item_key: 'discover:' + code, status: 'succeeded' })) });
  await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-09-27T03:00:00Z') });
  const entries = store.calls.find(call => call[0] === 'enqueueJobItems')[3];
  assert.deepEqual(entries.filter(item => item.item_key.startsWith('discover:')).map(item => item.item_key), selected.map(code => 'discover:' + code));
  assert.ok(entries.some(item => item.item_key === 'registry:noc-news'));
});

test('a frozen direction is attached to the same eight daily country slots', async()=>{
  const direction={id:'d',revision:1,config:require('../lib/intelligence/directions.cjs').defaults[0].config};
  const store=fakeStore();store.snapshotDirections=async()=>[direction];
  await enqueueDailyScan({store,owner:'owner-a',now:new Date('2026-09-28T00:00:00Z')});
  const items=store.calls.find(c=>c[0]==='enqueueJobItems')[3];
  const searches=items.filter(i=>i.item_key.startsWith('discover:'));
  assert.equal(searches.length,8);assert.ok(searches.every(i=>i.checkpoint.direction.id==='d'));
  assert.ok(items.filter(i=>i.item_key.startsWith('registry:')).every(i=>!i.checkpoint.direction));
});

test('enabled direction countries narrow discovery while fixed monitoring and user tracking remain separate', async () => {
  const base = structuredClone(require('../lib/intelligence/directions.cjs').defaults[0].config);
  const plan = [
    { id: 'sa', revision: 1, config: { ...base, countries: ['SA'], topic_codes: [] } },
    { id: 'qa', revision: 1, config: { ...base, countries: ['QA'], topic_codes: [] } },
    { id: 'paused', revision: 1, config: { ...base, countries: ['AE', 'TR'], enabled: false, topic_codes: [] } }
  ];
  const store = fakeStore();
  store.snapshotDirections = async () => plan;
  store.watchedSources = async () => [{ url: 'https://official.example/independent-watch' }];
  await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-10-09T00:00:00Z') });
  const entries = store.calls.find(call => call[0] === 'enqueueJobItems')[3];
  assert.deepEqual(entries.filter(item => item.item_key.startsWith('discover:')).map(item => item.item_key), ['discover:SA', 'discover:QA']);
  assert.deepEqual(entries.filter(item => item.item_key.startsWith('registry:')).map(item => item.item_key), registry.map(entry => `registry:${entry.id}`));
  assert.ok(store.calls.some(call => call[0] === 'enqueueJobItems' && call[3].some(item => item.checkpoint.watch && item.checkpoint.url === 'https://official.example/independent-watch')));
});

test('direction country union deduplicates overlaps and rotates at most two selected non-GCC regions', () => {
  const base = structuredClone(require('../lib/intelligence/directions.cjs').defaults[0].config);
  const plan = [
    { id: 'one', config: { ...base, countries: ['SA', 'TR', 'EG', 'MA'] } },
    { id: 'two', config: { ...base, countries: ['SA', 'QA', 'MA', 'TN'] } },
    { id: 'paused', config: { ...base, countries: ['AE', 'BH', 'IR'], enabled: false } }
  ];
  const seen = new Set();
  for (let offset = 0; offset < 12; offset++) {
    const day = new Date(Date.UTC(2026, 9, 9 + offset)).toISOString().slice(0, 10);
    const countries = dailySearchCountries(day, plan);
    assert.deepEqual(countries.slice(0, 2), ['SA', 'QA']);
    assert.equal(new Set(countries).size, countries.length);
    assert.ok(countries.length <= 4, 'the selected subset cannot expand the six GCC plus two other regions ceiling');
    const extra = countries.slice(2);
    assert.ok(extra.length <= 2 && extra.every(country => ['TR', 'EG', 'MA', 'TN'].includes(country)));
    extra.forEach(country => seen.add(country));
  }
  assert.deepEqual([...seen].sort(), ['EG', 'MA', 'TN', 'TR']);
  assert.deepEqual(dailySearchCountries('2026-10-09', []), []);
  assert.deepEqual(dailySearchCountries('2026-10-09', plan.map(direction => ({ ...direction, config: { ...direction.config, enabled: false } }))), []);
  assert.deepEqual(dailySearchCountries('2026-10-09', null), dailySearchCountries('2026-10-09'), 'legacy runs retain the original region selection');
});

test('a changed direction scope never replaces the country selection already persisted for today', async () => {
  const store = fakeStore();
  const selected = ['SA', 'TR'];
  store.jobRun = async () => ({ items: selected.map(country => ({ item_key: `discover:${country}`, checkpoint: { direction_plan_applied: true }, status: 'succeeded' })) });
  store.snapshotDirections = async () => [{ id: 'changed', revision: 3, config: { ...structuredClone(require('../lib/intelligence/directions.cjs').defaults[0].config), countries: ['QA'], topic_codes: [] } }];
  await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-10-09T03:00:00Z') });
  const entries = store.calls.find(call => call[0] === 'enqueueJobItems')[3];
  assert.deepEqual(entries.filter(item => item.item_key.startsWith('discover:')).map(item => item.item_key), selected.map(country => `discover:${country}`));
});

test('topic search replaces an existing region query and consecutive turns of one direction keep ordinary searches', async () => {
  const topic = { code: 'red-sea', name: '红海', description: '跨境能源运输', revision: 2, active: true };
  const direction = { id: 'topic-direction', revision: 4, config: { ...structuredClone(require('../lib/intelligence/directions.cjs').defaults[0].config), countries: ['SA', 'QA'], topic_codes: [topic.code] } };
  const store = fakeStore();
  store.snapshotSearchPlan = async () => ({ directions: [direction], topics: [topic], legacy: false });
  store.directionQueryCounts = async () => [{ direction_id: direction.id, query_count: 1 }];
  await enqueueDailyScan({ store, owner: 'owner-a', now: new Date('2026-10-09T00:00:00Z') });
  const entries = store.calls.find(call => call[0] === 'enqueueJobItems')[3];
  const searches = entries.filter(item => item.item_key.startsWith('discover:'));
  assert.deepEqual(searches.map(item => item.item_key), ['discover:SA', 'discover:QA']);
  assert.deepEqual(searches[0].checkpoint.direction.search_topic, { code: topic.code, name: topic.name, description: topic.description, revision: topic.revision });
  assert.equal(searches[1].checkpoint.direction.search_topic, null);
  assert.ok(!entries.some(item => item.item_key.startsWith('topic:')), 'a topic must not add separate searches or a new paid queue');
  assert.equal(entries.filter(item => item.item_key.startsWith('registry:')).length, registry.length);
});

test('a topic retry uses its persisted direction definition instead of current catalog changes', async () => {
  const topic = { code: 'red-sea', name: '旧名称', description: '旧跨境运输范围', revision: 2 };
  const direction = { id: 'direction-a', revision: 4, config: { ...structuredClone(require('../lib/intelligence/directions.cjs').defaults[0].config), topic_codes: [topic.code] }, search_topic: topic };
  const checkpoint = { direction_plan_applied: true, direction };
  const store = fakeStore({ item: { id: 'topic-retry', item_key: 'discover:SA', attempts: 2, checkpoint } });
  store.topicCatalog = async () => { throw Error('retry must not reread current topic catalog'); };
  store.snapshotSearchPlan = async () => { throw Error('retry must not replace a frozen plan'); };
  let seen;
  const result = await runDailyJobItem({ ...dependencies, store, owner: 'owner-a', env: {
    NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '10000000', NRGOPT_DISCOVERY_BILLING_MODE: 'included'
  }, discover: async (_country, _profile, _attempt, current) => { seen = structuredClone(current); throw Error('temporary provider failure'); } });
  assert.equal(result.status, 'retry');
  assert.deepEqual(seen, direction);
  assert.deepEqual(store.calls.find(call => call[0] === 'finishJobItem')[4].direction, direction);
});

test('extraction uses the run frozen topic catalog while legacy jobs keep current catalog behavior', async () => {
  const frozen = [{ code: 'red-sea', name: '冻结名称', description: '冻结范围', revision: 2 }];
  const current = [{ code: 'hormuz', name: '修改后的名单', description: '后续轮次范围', revision: 3, active: true }];
  for (const topics of [frozen, null, []]) {
    const store = fakeStore({ item: { id: 'extract-frozen', job_run_id: 'job-1', item_key: `extract:${sourceId}`, attempts: 1, checkpoint: { source_id: sourceId } } });
    store.jobTopics = async (owner, job) => { assert.equal(owner, 'owner-a'); assert.equal(job, 'job-1'); return topics; };
    store.topicCatalog = async () => { assert.equal(topics, null, 'an intentionally empty frozen catalog is not permission to load current topics'); return current; };
    let received;
    const result = await runDailyJobItem({ ...dependencies, store, owner: 'owner-a', env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '2000000' },
      modelFactory: () => async input => { received = input.topics; return { extraction: groundedExtraction, provider: 'test', model: 'test-only' }; } });
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(received, topics === null ? require('../lib/intelligence/topics.cjs').activeTopics(current) : topics);
  }
});
test('a candidate trial changes one planned query without adding search items',async()=>{
  const direction={id:'d',revision:1,config:require('../lib/intelligence/directions.cjs').defaults[0].config};
  const store=fakeStore();store.snapshotDirections=async()=>[direction];
  store.sourceLibrary=async()=>[{id:'reference:example.org',revision:1,status:'candidate',access:{status:'readable'},config:{name:'Example',url:'https://example.org/',scope:'site',mode:'search',countries:['SA'],direction_ids:[],priority:'normal'}}];
  await enqueueDailyScan({store,owner:'owner-a',now:new Date('2026-10-07T00:00:00Z')});
  const items=store.calls.find(c=>c[0]==='enqueueJobItems')[3],searches=items.filter(i=>i.item_key.startsWith('discover:'));
  assert.equal(searches.length,8);
  assert.equal(searches.find(i=>i.item_key==='discover:SA').checkpoint.channel.trial,true);
  assert.equal(searches.filter(i=>i.checkpoint.channel).length,1);
});
test('no applicable enabled direction finishes without paying and retry retains the original direction',async()=>{
  const direction={id:'d',revision:1,config:require('../lib/intelligence/directions.cjs').defaults[0].config};
  for(const chosen of [null,direction]) {
    const checkpoint={direction_plan_applied:true,direction:chosen};
    const store=fakeStore({item:{id:'item-1',item_key:'discover:SA',attempts:1,checkpoint}});
    const result=await runDailyJobItem({...dependencies,store,owner:'owner-a',jobId:'job-1',env:{NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO:'10000000',NRGOPT_DISCOVERY_BILLING_MODE:'included'},discover:async(_c,_p,_a,context)=>{assert.deepEqual(context,direction);throw Error('provider failure');}});
    assert.equal(result.status,chosen?'retry':'succeeded');
    assert.equal(store.calls.some(c=>c[0]==='reserveBudget'),!!chosen);
    assert.deepEqual(store.calls.find(c=>c[0]==='finishJobItem')[4].direction,chosen);
  }
});

test('removed channel in a frozen search plan stops before paid discovery without replacing the plan',async()=>{
 const store=fakeStore({item:{id:'item-1',item_key:'discover:SA',attempts:1,checkpoint:{channel:{id:'channel-1',url:'https://example.org/',scope:'site'}}}});
 store.sourceLibrary=async()=>[{id:'channel-1',status:'removed',config:{url:'https://example.org/',scope:'site'}}];
 let called=false;const result=await runDailyJobItem({store,owner:'owner',jobId:'job',discover:async()=>{called=true;},...dependencies});
 assert.equal(called,false);assert.equal(result.status,'manual_paused');assert.equal(store.calls.some(c=>c[0]==='reserveBudget'),false);
});

test('reference trial rechecks candidate state before using the original discovery slot',async()=>{
 const channel={id:'reference:example.org',url:'https://example.org/',scope:'site',trial:true};
 for(const status of ['candidate','paused','removed']){
  const store=fakeStore({item:{id:'item-1',item_key:'discover:SA',attempts:1,checkpoint:{channel}}});
  store.sourceLibrary=async()=>[{id:channel.id,status,access:{status:'readable'},config:{url:channel.url,scope:channel.scope}}];
  let called=false;
  const result=await runDailyJobItem({...dependencies,store,owner:'owner',jobId:'job',env:{NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO:'10000000',NRGOPT_DISCOVERY_BILLING_MODE:'included'},discover:async()=>{called=true;return {sources:[]};}});
  assert.equal(called,status==='candidate');assert.equal(result.status,status==='candidate'?'succeeded':'manual_paused');
  assert.equal(store.calls.some(c=>c[0]==='reserveBudget'),status==='candidate');
 }
});
