const test = require('node:test');
const assert = require('node:assert/strict');
const { watchSearchPlan, discoverWatch } = require('../lib/intelligence/watch-search.cjs');
const { enqueueDailyScan, runDailyJobItem } = require('../lib/intelligence/jobs.cjs');
const { createStore } = require('../lib/intelligence/store.cjs');
const sourceId = '11111111-1111-4111-8111-111111111111';
const hypothesisId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-24T00:00:00Z');
function target(n = 0) {
  return { id: n ? `hypothesis-${n}` : hypothesisId, created_at: '2026-09-22T00:00:00Z', status: 'open',
    claim_zh: '可能继续采购。', counter_evidence_zh: '官方取消或延期。', signal_zh: '观察采购公告。', source_url: `https://official.example/${n}`,
    source_title: 'Cedar solar project financing',
    candidate: { source_id: n ? `source-${n}` : sourceId, title_zh: '测试能源需求', project_zh: { name_zh: 'Cedar 项目' }, occurrence_countries: ['SA'], organizations_zh: [{ canonical_name: 'Developer' }] } };
}
function workStore(item) {
  const calls = [];
  const store = { calls, claimJobItem: async () => ({ id: 'work', job_run_id: 'job', attempts: 1, ...item }),
    hypothesis: async () => target(), providerConfigs: async () => [],
    reserveBudget: async (...args) => { calls.push(['reserve', ...args]); return 'reservation'; },
    releaseBudget: async () => true, syncProviderBalance: async () => true,
    enqueueJobItems: async (...args) => { calls.push(['enqueue', ...args]); return args[2].length; },
    finishJobItem: async (...args) => { calls.push(['finish', ...args]); return true; } };
  return store;
}
const args = { owner: 'owner', now, env: { NRGOPT_DISCOVERY_MONTHLY_LIMIT_MICRO: '10000000', NRGOPT_DISCOVERY_BILLING_MODE: 'included' } };

test('search plan pairs support and counterevidence, caps 10 fixed slots and rotates coverage', () => {
  const targets = Array.from({ length: 9 }, (_, i) => target(i));
  const plan = watchSearchPlan(targets, '2026-09-24');
  assert.equal(plan.length, 10);
  assert.deepEqual(plan.map(p => p.item_key), Array.from({ length: 10 }, (_, i) => `watchsearch:${i}`));
  for (let i = 0; i < plan.length; i += 2) {
    assert.equal(plan[i].checkpoint.intent, 'support');
    assert.equal(plan[i + 1].checkpoint.intent, 'counter');
    assert.deepEqual(plan[i].checkpoint.hypothesis_ids, plan[i + 1].checkpoint.hypothesis_ids);
    assert.match(plan[i + 1].checkpoint.query, /cancelled/);
    assert.match(plan[i].checkpoint.query, /site:gov.sa/);
  }
  const later = watchSearchPlan(targets, '2026-09-25');
  assert.equal(new Set([...plan, ...later].map(p => p.checkpoint.source_id)).size, 9);
  assert.deepEqual(plan, watchSearchPlan([...targets].reverse(), '2026-09-24'));
});

test('closed, expired, malformed and no-country targets do not enter paid search planning', () => {
  for (const h of [{ ...target(), status: 'rejected' }, { ...target(), created_at: '2026-01-01T00:00:00Z' },
    { ...target(), created_at: 'invalid' }, { ...target(), candidate: { ...target().candidate, occurrence_countries: [] } }]) {
    assert.deepEqual(watchSearchPlan([h], '2026-09-24'), []);
  }
});

test('same URL versions produce one group, query contains no user annotation or raw search operators', () => {
  const a = target(), b = { ...target(2), source_url: a.source_url, created_at: '2026-09-23T00:00:00Z' };
  b.candidate.project_zh.name_zh = 'Cedar site:malicious.example';
  b.annotation_zh = 'PRIVATE NOTE MUST NOT LEAVE';
  b.counter_evidence_zh = 'PRIVATE HYPOTHESIS';
  b.signal_zh = 'PRIVATE WATCH SIGNAL';
  const plan = watchSearchPlan([a, b], '2026-09-24');
  assert.equal(plan.length, 2);
  assert.equal(plan[0].checkpoint.source_id, 'source-2');
  assert.ok(!plan[0].checkpoint.query.includes('site:malicious.example'));
  assert.ok(!JSON.stringify(plan).includes('PRIVATE NOTE'));
  assert.ok(!plan[0].checkpoint.query.includes('Cedar site'));
  assert.ok(!JSON.stringify(plan).includes('PRIVATE HYPOTHESIS'));
  assert.ok(!JSON.stringify(plan).includes('PRIVATE WATCH SIGNAL'));
  assert.match(plan[0].checkpoint.query, /Cedar solar project financing/);
});

test('discovery keeps only allowed official hosts and accepts an empty result', async () => {
  let query;
  const factory = () => async input => { query = input.query; return { results: [
    { url: 'https://www.spa.gov.sa/a' }, { url: 'https://spa.gov.sa.attacker.test/a' }, { url: 'not a URL' }
  ], provider: 'test' }; };
  const plan = watchSearchPlan([target()], '2026-09-24')[1].checkpoint;
  const result = await discoverWatch(plan, {}, factory);
  assert.equal(query, plan.query);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_level, 'primary');
  assert.deepEqual((await discoverWatch(plan, {}, () => async () => ({ results: [] }))).sources, []);
});

test('repeated daily triggers keep the first watch plan despite changes in the candidate pool', async () => {
  const items = new Map(); let reads = 0;
  const store = { enqueueJob: async () => 'job', reviewTracking: async () => ({}), watchedSources: async () => [], jobRun: async () => ({ items: [...items.values()] }),
    watchSearchTargets: async () => { reads++; return [target()]; },
    enqueueJobItems: async (_owner, _job, values) => { values.forEach(v => { if (!items.has(v.item_key)) items.set(v.item_key, v); }); } };
  await enqueueDailyScan({ store, owner: 'owner', now });
  await enqueueDailyScan({ store, owner: 'owner', now });
  assert.equal(reads, 1);
  assert.equal([...items.keys()].filter(key => key.startsWith('watchsearch:')).length, 2);
});

test('expired or terminal persisted plans finish without a search or a budget reservation', async () => {
  for (const change of [{ created_at: '2026-01-01T00:00:00Z' }, { status: 'confirmed' }]) {
    const item = watchSearchPlan([target()], '2026-09-24')[0];
    const store = workStore(item); store.hypothesis = async () => ({ ...target(), ...change });
    const result = await runDailyJobItem({ ...args, store, watchDiscover: () => { throw new Error('must not search'); } });
    assert.equal(result.status, 'succeeded');
    assert.ok(!store.calls.some(c => c[0] === 'reserve'));
    assert.equal(store.calls.find(c => c[0] === 'finish')[4].outcome, 'watch_window_closed');
  }
});

test('zero search results are a successful no-evidence observation without changing the hypothesis', async () => {
  const store = workStore(watchSearchPlan([target()], '2026-09-24')[1]);
  const result = await runDailyJobItem({ ...args, store, watchDiscover: async () => ({ sources: [] }) });
  assert.equal(result.status, 'succeeded');
  assert.equal(store.calls.find(c => c[0] === 'finish')[4].outcome, 'no_new_evidence');
  assert.ok(!store.calls.some(c => c[0] === 'enqueue'));
});

test('search bounds source fan-out, deduplicates URLs and carries hypothesis linkage', async () => {
  const store = workStore(watchSearchPlan([target()], '2026-09-24')[1]);
  await runDailyJobItem({ ...args, store, watchDiscover: async () => ({ sources: [
    { url: 'https://official.example/a' }, { url: 'https://official.example/a#fragment' },
    { url: 'https://official.example/b' }, { url: 'https://official.example/c' }
  ] }) });
  const queued = store.calls.find(c => c[0] === 'enqueue')[3];
  assert.equal(queued.length, 2);
  assert.match(queued[0].item_key, /^watchsource:1:[a-f0-9]{64}$/);
  assert.deepEqual(queued[0].checkpoint.hypothesis_ids, [hypothesisId]);
});

test('budget exhaustion pauses before search and provider failures retain retry state', async () => {
  for (const budget of [true, false]) {
    const store = workStore(watchSearchPlan([target()], '2026-09-24')[0]);
    let calls = 0;
    if (budget) store.reserveBudget = async () => null;
    const result = await runDailyJobItem({ ...args, store, watchDiscover: async () => { calls++; throw new Error('private provider body'); } });
    assert.equal(result.status, budget ? 'budget_paused' : 'retry');
    assert.equal(calls, budget ? 0 : 1);
    assert.ok(!JSON.stringify(store.calls).includes('private provider body'));
  }
});

test('already saved and extracted search result still queues assessment of the watched hypothesis', async () => {
  const store = workStore({ item_key: 'watchsource:0:' + 'a'.repeat(64), checkpoint: { url: 'https://official.example/a', hypothesis_ids: [hypothesisId] } });
  store.save = async () => ({ reused: true, source: { id: sourceId, extraction_status: 'extracted', content_sha256: 'a'.repeat(64), extraction_source_sha256: 'a'.repeat(64) } });
  const result = await runDailyJobItem({ ...args, store, sourceFetcher: async () => ({}) });
  assert.equal(result.status, 'succeeded');
  const queued = store.calls.find(c => c[0] === 'enqueue')[3];
  assert.deepEqual(queued, [{ item_key: `hypothesis:${hypothesisId}:${sourceId}`, checkpoint: { hypothesis_id: hypothesisId, source_id: sourceId } }]);
});

test('fresh search result queues extraction before the linked evidence assessment', async () => {
  const store = workStore({ item_key: 'watchsource:0:' + 'a'.repeat(64), checkpoint: { url: 'https://official.example/a', hypothesis_ids: [hypothesisId] } });
  store.save = async () => ({ reused: false, source: { id: sourceId, extraction_status: 'pending' } });
  const result = await runDailyJobItem({ ...args, store, sourceFetcher: async () => ({}) });
  assert.equal(result.status, 'succeeded');
  const queued = store.calls.filter(c => c[0] === 'enqueue').flatMap(c => c[3]);
  assert.deepEqual(queued.map(i => i.item_key), [`extract:${sourceId}`, `hypothesis:${hypothesisId}:${sourceId}`]);
  assert.deepEqual(queued.map(i => i.item_key).sort(), queued.map(i => i.item_key));
});

test('watch target reads are owner-scoped and exclude inactive watches and unsaved originals', async () => {
  const h = target(); const calls = [];
  const store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async input => {
    const url = new URL(input); calls.push(url); assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
    let data;
    if (url.pathname.endsWith('intelligence_hypotheses')) { assert.equal(url.searchParams.get('status'), 'in.(open,strengthened,weakened)'); assert.ok(url.searchParams.get('review_due_at').startsWith('gt.')); data = [{ ...h, candidate_id: 'candidate' }]; }
    else if (url.pathname.endsWith('intelligence_candidates')) { assert.equal(url.searchParams.get('disposition'), 'eq.candidate'); data = [{ ...h.candidate, id: 'candidate' }]; }
    else if (url.pathname.endsWith('intelligence_watch_targets')) { assert.equal(url.searchParams.get('status'), 'eq.active'); data = [{ candidate_id: 'candidate', signal_zh: '关注进展' }]; }
    else { assert.equal(url.searchParams.get('status'), 'eq.pending_extraction'); data = [{ id: sourceId, final_url: 'https://official.example/a', title: 'Cedar solar project financing' }]; }
    return new Response(JSON.stringify(data));
  });
  const result = await store.watchSearchTargets('owner', now);
  assert.equal(result.length, 1); assert.equal(result[0].candidate.source_id, sourceId); assert.equal(calls.length, 4);
});

test('renewed review dates keep an older hypothesis in the search rotation', () => {
  const h = { ...target(), created_at: '2026-01-01T00:00:00Z', review_due_at: '2026-10-01T00:00:00Z' };
  assert.equal(watchSearchPlan([h], '2026-09-24').length, 2);
  assert.equal(watchSearchPlan([h], '2026-10-01').length, 0);
});
