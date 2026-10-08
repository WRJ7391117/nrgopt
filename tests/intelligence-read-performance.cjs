const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/intelligence/store.cjs');
const { summarize } = require('../lib/intelligence/overview-summary.cjs');
const { defaults } = require('../lib/intelligence/source-library.cjs');

const CONFIG = { url: 'https://db.test', serviceKey: 'test-only' };
const OWNER = 'owner-a';
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function latch() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function projected(row, select) {
  if (select === '*') return row;
  return Object.fromEntries(select.split(',').map(field => {
    const colon = field.indexOf(':');
    const name = colon < 0 ? field : field.slice(0, colon);
    const path = (colon < 0 ? field : field.slice(colon + 1)).split(/->>?/);
    return [name, path.reduce((value, key) => value?.[key], row)];
  }));
}
function readOnlyFetch(tables, calls) {
  return async (input, init) => {
    assert.ok(!init.method || init.method === 'GET', 'performance reads must not write');
    const url = new URL(input), query = url.searchParams;
    assert.equal(query.get('owner_id'), `eq.${OWNER}`);
    const table = url.pathname.split('/').pop();
    calls.push({ table, query });
    assert.ok(Object.hasOwn(tables, table), `unexpected table ${table}`);
    let rows = tables[table];
    for (const [field, value] of query) {
      if (['select', 'limit', 'offset', 'order', 'owner_id'].includes(field)) continue;
      if (value.startsWith('in.(')) {
        const accepted = new Set(value.slice(4, -1).split(','));
        rows = rows.filter(row => accepted.has(String(row[field])));
      } else if (value.startsWith('eq.')) rows = rows.filter(row => String(row[field]) === value.slice(3));
      else if (value.startsWith('neq.')) rows = rows.filter(row => String(row[field]) !== value.slice(4));
      else if (value.startsWith('gte.')) rows = rows.filter(row => row[field] >= value.slice(4));
      else if (value.startsWith('lte.')) rows = rows.filter(row => row[field] <= value.slice(4));
      else if (value.startsWith('lt.')) rows = rows.filter(row => row[field] < value.slice(3));
      else if (value === 'like.discover:*') rows = rows.filter(row => row[field].startsWith('discover:'));
      else if (value === 'not.is.null') rows = rows.filter(row => row[field] != null);
      else assert.fail(`unexpected filter ${field}=${value}`);
    }
    if (query.has('order')) {
      const order = query.get('order').split(',').map(value => value.split('.'));
      rows = rows.slice().sort((left, right) => {
        for (const [field, direction] of order) {
          if (left[field] === right[field]) continue;
          return (left[field] > right[field] ? 1 : -1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
    }
    const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || rows.length);
    return Response.json(rows.slice(offset, offset + limit).map(row => projected(row, query.get('select'))));
  };
}

test('workbench retains complete counts and current detail while reading historical text only as metadata', async () => {
  const day = '2026-10-08', created = '2026-10-08T00:00:00.000Z', extracted = '2026-10-08T01:00:00.000Z';
  const candidate = (id, created_at, radars) => ({
    id, source_id: `source-${id}`, source_sha256: 'hash', created_at, radars,
    title_zh: `${id} 标题`, summary_zh: `${id} 摘要`, disposition: 'candidate', review_status: 'pending',
    occurrence_countries: ['SA'], relevance_countries: ['AE'], topic_codes: ['crossborder'],
    importance: 'high', evidence_status: 'sourced', maturity: 'project', urgency: 'high',
    countries_zh: ['沙特'], organizations_zh: ['业主'], project_zh: { name_zh: '项目' },
    procurement_zh: { stage_code: 'open' }, updated_at: extracted
  });
  const history = Array.from({ length: 502 }, (_, i) => candidate(`old-${i}`, '2026-09-01T00:00:00.000Z', ['trigger']));
  const fresh = [
    candidate('new-1', created, ['project']), candidate('new-2', created, ['demand']),
    candidate('new-version', created, ['project']), candidate('new-stale', created, ['trigger']),
    candidate('new-invalid-hash', created, ['demand'])
  ];
  const candidates = history.concat(fresh);
  const sources = candidates.map(c => ({
    id: c.source_id, final_url: `https://example.com/${c.id === 'new-version' ? 'old-0' : c.id}`,
    content_sha256: 'hash', extraction_source_sha256: 'hash', extraction_status: 'extracted',
    extracted_at: extracted, publication_date: day, published_at: null, publication_method: 'metadata',
    extraction_zh: { why_it_matters_zh: `${c.id} 意义`, unknowns_zh: [`${c.id} 未披露事项`], next_signals_zh: [`${c.id} 后续信号`] }
  }));
  sources.find(source => source.id === 'source-new-stale').publication_date = '2026-08-31';
  sources.find(source => source.id === 'source-new-invalid-hash').extraction_source_sha256 = 'outdated-hash';
  sources.push({ ...sources[0], id: 'source-ref-only', final_url: 'https://example.com/ref-only' });
  const directions = [{ id: 'direction-1', config: { name: '项目方向', countries: ['SA', 'AE'], industries: '能源', enabled: true }, effective_on: day }];
  const refs = [
    { id: 'ref-1', source_id: 'source-new-1', direction_id: 'direction-1', created_at: created, match: { relevant: true }, analysis_sha256: 'hash', analysis_extracted_at: extracted },
    { id: 'ref-2', source_id: 'source-new-2', direction_id: 'direction-1', created_at: created, match: { relevant: true }, analysis_sha256: 'stale-hash', analysis_extracted_at: extracted },
    { id: 'ref-3', source_id: 'source-old-1', direction_id: 'direction-1', created_at: created, match: { relevant: true }, analysis_sha256: 'hash', analysis_extracted_at: extracted },
    { id: 'ref-4', source_id: 'source-ref-only', direction_id: 'direction-1', created_at: created, match: { relevant: true }, analysis_sha256: 'hash', analysis_extracted_at: extracted }
  ];
  const runs = [{ id: 'run-today', job_type: 'daily_scan', schedule_key: day, status: 'partial', updated_at: extracted, finished_at: extracted }];
  const checkpoint = { direction: { id: 'direction-1' }, country: 'SA', url: 'https://example.com/task', name: '来源名称', unused_large_result: 'x'.repeat(10000) };
  const tasks = [
    { id: 'task-1', job_run_id: 'run-today', item_key: 'discover:SA', status: 'succeeded', error_code: null, created_at: created, checkpoint },
    { id: 'task-2', job_run_id: 'run-today', item_key: 'discover:AE', status: 'failed', error_code: 'source_empty_document', created_at: created, checkpoint: { ...checkpoint, country: 'AE' } },
    { id: 'task-3', job_run_id: 'run-today', item_key: 'registry:source', status: 'succeeded', error_code: null, created_at: created, checkpoint },
    { id: 'task-4', job_run_id: 'run-today', item_key: 'extract:source', status: 'queued', error_code: null, created_at: created, checkpoint }
  ];
  const opportunities = [
    { id: 'op-1', candidate_id: 'old-300', source_sha256: 'hash', current_in_analysis: true, scope: 'procurement' },
    { id: 'op-2', candidate_id: 'new-1', source_sha256: 'hash', current_in_analysis: true, scope: 'procurement' }
  ];
  const tables = {
    intelligence_candidates: candidates, intelligence_sources: sources, intelligence_watch_targets: [],
    intelligence_collection_directions: directions, intelligence_job_runs: runs,
    intelligence_direction_sources: refs, intelligence_source_library: [], intelligence_source_controls: [],
    intelligence_opportunities: opportunities, intelligence_job_items: tasks
  };
  const calls = [], store = createStore(CONFIG, readOnlyFetch(tables, calls));
  const actual = await store.workbench(OWNER, day, 1);
  const expected = summarize({ day, period: 1, candidates, sources: sources.map(source => ({ ...source, ...source.extraction_zh })),
    watches: [], followed: [], directions, runs, refs, library: defaults(), opportunities,
    tasks: tasks.filter(item => item.item_key.startsWith('discover:')), currentTasks: tasks });
  delete actual.captured_at; delete expected.captured_at;
  assert.deepEqual(actual, expected, 'lightweight reads must preserve the complete overview result');
  assert.equal(actual.distribution.total, 505);
  assert.deepEqual(actual.counts, { discoveries: 2, updates: 0, due: 0, active: 0 });
  assert.deepEqual(actual.new_items.map(c => c.id).sort(), ['new-1', 'new-2'], 'old original dates, invalid hashes and old URLs must not become new discoveries');
  assert.equal(actual.new_items[0].summary_zh, 'new-1 摘要');
  assert.deepEqual(actual.new_items[0].unknowns_zh, ['new-1 未披露事项']);
  assert.deepEqual(actual.directions[0].searched_countries, ['SA', 'AE']);
  assert.equal(actual.directions[0].new_count, 1);
  assert.equal(actual.directions[0].unverified_links, 1);
  assert.deepEqual(actual.runtime.counts, { succeeded: 2, failed: 1, queued: 1 });
  assert.deepEqual(actual.runtime.failures, [{ error_code: 'source_empty_document', url: checkpoint.url, name: checkpoint.name }]);

  const candidateCalls = calls.filter(call => call.table === 'intelligence_candidates');
  const metadataCalls = candidateCalls.filter(call => !call.query.get('select').includes('summary_zh'));
  assert.deepEqual(metadataCalls.map(call => Number(call.query.get('offset'))), [0, 500]);
  for (const call of metadataCalls) {
    assert.deepEqual(call.query.get('select').split(',').sort(), ['id', 'source_id', 'created_at', 'source_sha256', 'radars', 'disposition', 'review_status'].sort());
  }
  const detailCalls = candidateCalls.filter(call => call.query.get('select').includes('summary_zh'));
  assert.ok(detailCalls.length > 0);
  const visibleIds = new Set(actual.new_items.map(c => c.id));
  for (const call of detailCalls) {
    const requested = readRequestedRows(candidates, call.query);
    assert.ok(requested.length > 0);
    assert.ok(requested.every(row => visibleIds.has(row.id)), 'only actual new discoveries may request full candidate text');
  }
  const sourceCalls = calls.filter(call => call.table === 'intelligence_sources');
  const sourceDetails = sourceCalls.filter(call => call.query.get('select').includes('unknowns_zh'));
  assert.ok(sourceDetails.length > 0);
  const visibleSourceIds = new Set(actual.new_items.map(c => c.source_id));
  for (const call of sourceDetails) {
    const requested = readRequestedRows(sources, call.query);
    assert.ok(requested.length > 0);
    assert.ok(requested.every(row => visibleSourceIds.has(row.id)), 'old publication, stale hash and old-URL source text must not be read');
  }
  for (const call of calls.filter(call => call.table === 'intelligence_job_items')) {
    assert.ok(!call.query.get('select').split(',').includes('checkpoint'), 'overview must project only needed checkpoint fields');
  }
});

function readRequestedRows(rows, query) {
  const id = query.get('id');
  return rows.filter(row => (!id || new Set(id.slice(4, -1).split(',')).has(row.id))
    && (!query.has('created_at') || (query.getAll('created_at').every(condition => condition.startsWith('gte.')
      ? row.created_at >= condition.slice(4) : row.created_at < condition.slice(3)))));
}

function changingWorkbench(candidateChange = {}, sourceChange = {}) {
  const candidate = { id: 'candidate-1', source_id: 'source-1', created_at: '2026-10-08T00:00:00.000Z',
    source_sha256: 'old-hash', disposition: 'candidate', review_status: 'pending', radars: ['project'],
    title_zh: '项目标题', summary_zh: '项目摘要' };
  const source = { id: 'source-1', final_url: 'https://example.com/project', publication_date: '2026-10-08',
    content_sha256: 'old-hash', extraction_source_sha256: 'old-hash', extraction_status: 'extracted',
    extracted_at: '2026-10-08T01:00:00.000Z', publication_method: 'metadata',
    extraction_zh: { why_it_matters_zh: '本次提取意义', unknowns_zh: ['本次提取未知点'], next_signals_zh: ['本次提取信号'] } };
  const calls = [];
  const store = createStore(CONFIG, async (input, init) => {
    assert.ok(!init.method || init.method === 'GET');
    const url = new URL(input), select = url.searchParams.get('select');
    assert.equal(url.searchParams.get('owner_id'), `eq.${OWNER}`);
    const table = url.pathname.split('/').pop();
    if (table === 'intelligence_candidates') {
      const phase = select.includes('summary_zh') ? 'candidate-detail' : 'candidate-metadata';
      calls.push(phase);
      return Response.json([projected(phase === 'candidate-detail' ? { ...candidate, ...candidateChange } : candidate, select)]);
    }
    if (table === 'intelligence_sources') {
      const phase = select.includes('unknowns_zh') ? 'source-detail' : 'source-metadata';
      calls.push(phase);
      return Response.json([projected(phase === 'source-detail' ? { ...source, ...sourceChange } : source, select)]);
    }
    return Response.json([]);
  });
  return { store, calls };
}

for (const change of [{ disposition: 'source_only' }, { review_status: 'rejected' }]) {
  test(`workbench excludes a candidate changed to ${Object.values(change)[0]} between metadata and detail reads`, async () => {
    const { store, calls } = changingWorkbench(change);
    const result = await store.workbench(OWNER, '2026-10-08');
    assert.deepEqual(calls.slice().sort(), ['candidate-detail', 'candidate-metadata', 'source-detail', 'source-metadata']);
    assert.equal(result.counts.discoveries, 0);
    assert.equal(result.distribution.total, 0);
    assert.equal(result.distribution.project, 0);
    assert.deepEqual(result.new_items, []);
    assert.deepEqual(result.discoveries, []);
    assert.deepEqual(result.highlights, []);
  });
}

test('workbench rechecks supplemental source hashes before displaying changed extraction text', async () => {
  const { store, calls } = changingWorkbench({}, { content_sha256: 'new-hash', extraction_source_sha256: 'new-hash' });
  const result = await store.workbench(OWNER, '2026-10-08');
  assert.deepEqual(calls.slice().sort(), ['candidate-detail', 'candidate-metadata', 'source-detail', 'source-metadata']);
  assert.equal(result.counts.discoveries, 0);
  assert.equal(result.distribution.total, 0);
  assert.deepEqual(result.new_items, []);
  assert.deepEqual(result.highlights, []);
  assert.ok(!JSON.stringify(result).includes('本次提取'), 'changed source text cannot appear under an older candidate hash');
});

test('source library reads saved entries and host controls before either read finishes', async () => {
  const gate = latch(), started = [];
  const store = createStore(CONFIG, async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('owner_id'), `eq.${OWNER}`);
    started.push(url.pathname.split('/').pop());
    await gate.promise;
    return Response.json(url.pathname.endsWith('intelligence_source_controls') ? [{ hostname: 'example.org', paused: true }] : [{
      id: 'custom', status: 'active', revision: 1, config: { url: 'https://example.org/' }
    }]);
  });
  const pending = store.sourceLibrary(OWNER);
  try {
    await nextTurn();
    assert.deepEqual(started.sort(), ['intelligence_source_controls', 'intelligence_source_library']);
  } finally { gate.release(); }
  const result = await pending;
  assert.equal(result.find(entry => entry.id === 'custom').host_paused, true);
});

test('channel overview starts entries, recent sources and daily execution independently', async () => {
  const gate = latch(), started = [];
  const store = createStore(CONFIG, async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/rest/v1/intelligence_sources');
    assert.equal(url.searchParams.get('owner_id'), `eq.${OWNER}`);
    started.push('sources');
    await gate.promise;
    return Response.json([]);
  });
  store.sourceLibrary = async owner => { assert.equal(owner, OWNER); started.push('entries'); await gate.promise; return []; };
  store.dailyEntryStatus = async owner => { assert.equal(owner, OWNER); started.push('daily'); await gate.promise; return { day: '2026-10-08', items: [] }; };
  const pending = store.libraryOverview(OWNER);
  try {
    await nextTurn();
    assert.deepEqual(started.sort(), ['daily', 'entries', 'sources']);
  } finally { gate.release(); }
  assert.deepEqual(await pending, { entries: [], suggestions: [], sample_limit: 500, day: '2026-10-08' });
});

test('direction list reads only the owner direction table without histories, tasks or effective RPC', async () => {
  const directions = [{ id: 'direction-1', revision: 2, config: { name: '项目方向' }, effective_on: '2026-10-08' }];
  const calls = [], store = createStore(CONFIG, readOnlyFetch({ intelligence_collection_directions: directions }, calls));
  assert.deepEqual(await store.directionList(OWNER), directions);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'intelligence_collection_directions');
});
