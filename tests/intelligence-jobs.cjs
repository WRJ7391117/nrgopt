const test = require('node:test');
const assert = require('node:assert/strict');
const { COUNTRIES, scheduleDate, runPaidCall, enqueueDailyScan, runDailyJobItem, sourceItem } = require('../lib/intelligence/jobs.cjs');
const { automaticCallReserve } = require('../lib/intelligence/budget.cjs');

const sourceId = '11111111-1111-4111-8111-111111111111';

function fakeStore({ reservationId = 'reservation-1', item = { id: 'item-1', item_key: 'discover:SA', attempts: 1, checkpoint: {} } } = {}) {
  const calls = [];
  const source = { id: sourceId, title: 'Official notice', final_url: 'https://official.example/a', content_type: 'text/plain', content_sha256: 'a'.repeat(64) };
  const methods = {
    enqueueJob: async () => 'job-1', enqueueJobItems: async (_owner, _job, items) => items.length,
    claimJobItem: async () => item, finishJobItem: async () => true,
    reserveBudget: async () => reservationId, settleBudget: async () => true, releaseBudget: async () => true,
    save: async () => ({ source, reused: false }), recordFailure: async () => {}, evidence: async () => ({ source, bytes: Buffer.from('Official source evidence.') }),
    beginExtraction: async () => {}, saveExtraction: async () => source, saveCandidate: async () => ({ id: 'candidate-1' }),
    findCandidatePeers: async () => [], saveCrossCheck: async () => ({}), failExtraction: async () => {},
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
  assert.deepEqual(store.calls[0], ['enqueueJob', 'owner-a', 'daily_scan', result.scheduleKey, COUNTRIES.map(code => `discover:${code}`)]);
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

test('provider balance delta is settled as actual spend', async () => {
  const store = fakeStore();
  const balances = [1_000_000, 980_000];
  await runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY', budgetKey: 'RESERVE',
    env: { RESERVE: '100000' }, readBalance: async () => balances.shift(), call: async () => ({ ok: true }) });
  const settled = store.calls.find(call => call[0] === 'settleBudget');
  assert.deepEqual(settled.slice(1, 5), ['owner-a', 'reservation-1', 20_000, 'actual']);
});

test('included plan releases the reservation and never records monetary spend', async () => {
  const store = fakeStore();
  await runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'USD', budgetKey: 'RESERVE',
    billingMode: 'included', env: { RESERVE: '10000' }, call: async () => ({ ok: true }) });
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
  assert.ok(!store.calls.some(call => call[0] === 'settleBudget'));
});

test('a failed pre-call balance sync releases the reservation and never calls the model', async () => {
  const store = fakeStore();
  let called = false;
  await assert.rejects(runPaidCall({ store, owner: 'owner-a', operation: 'extraction', currency: 'CNY',
    budgetKey: 'RESERVE', env: { RESERVE: '10000' }, readBalance: async () => { throw new Error('private detail'); },
    call: async () => { called = true; } }), { code: 'billing_sync_unavailable' });
  assert.equal(called, false);
  assert.ok(store.calls.some(call => call[0] === 'releaseBudget'));
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
