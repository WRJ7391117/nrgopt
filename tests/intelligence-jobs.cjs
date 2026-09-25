const test = require('node:test');
const assert = require('node:assert/strict');
const { COUNTRIES, scheduleDate, runPaidCall, enqueueDailyScan, runDailyJobItem, sourceItem } = require('../lib/intelligence/jobs.cjs');
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
    sourcePaused: async () => false,
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
  assert.deepEqual(store.calls[1], ['enqueueJobItems', 'owner-a', 'job-1',
    [...COUNTRIES.map(code => `discover:${code}`), ...registry.map(entry => `registry:${entry.id}`)]
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
