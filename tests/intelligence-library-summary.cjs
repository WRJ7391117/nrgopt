const test = require('node:test'), assert = require('node:assert/strict');
const { summarizeLibrary, latestSources, validRecentSource } = require('../lib/intelligence/library-summary.cjs');
const { createStore } = require('../lib/intelligence/store.cjs');

const day = '2026-10-13', hash = 'a'.repeat(64);
const direction = (id = 'd-sa', countries = ['SA']) => ({ id, config: { enabled: true, countries } });
const entry = (changes = {}) => ({ id: 'channel', status: 'active', access: { status: 'readable' },
  config: { url: 'https://example.org/authors/alice/', scope: 'path', mode: 'search', countries: ['SA'], direction_ids: [], type: 'research' }, ...changes });
const source = (changes = {}) => ({ id: 'source', final_url: 'https://example.org/authors/alice/article',
  requested_url: 'https://example.org/authors/alice/article', title: 'Energy announcement', fetched_at: '2026-10-13T00:00:00Z',
  status: 'pending_extraction', publication_date: '2026-10-12', published_at: null, publication_method: 'metadata',
  extraction_status: 'extracted', content_sha256: hash, extraction_source_sha256: hash,
  countries: [{ code: 'SA', relation: 'occurrence', evidence_fact_number: 1 }], ...changes });
const task = (changes = {}) => ({ id: 'task', item_key: 'discover:SA', status: 'succeeded', updated_at: '2026-10-13T01:00:00Z',
  channel: { id: 'channel', url: 'https://example.org/authors/alice/', scope: 'path' },
  result_urls: ['https://example.org/authors/alice/article'], run: { job_type: 'daily_scan', schedule_key: day }, ...changes });
const summarize = (changes = {}) => summarizeLibrary({ day, entries: [entry()], directions: [direction()], sources: [source()], tasks: [task()], ...changes });

test('current scope distinguishes allowed rotation, natural task findings and independent same-site samples', () => {
  const result = summarize({ sources: [source(), source({ id: 'manual-sample', final_url: 'https://example.org/authors/alice/other', requested_url: 'https://example.org/authors/alice/other' })] });
  const row = result.entries[0];
  assert.deepEqual(row.scope, { countries: ['SA'], direction_ids: ['d-sa'], in_current_scope: true, reason: 'matched' });
  assert.deepEqual(row.usage, { mechanism: 'search', eligible: true, reason: 'search_rotation' });
  assert.equal(row.performance.natural_source_count, 1);
  assert.equal(row.performance.same_site_source_count, 2);
  assert.deepEqual(row.performance.natural_sources.map(item => item.id), ['source']);
  assert.equal(row.performance.latest_task.day, day);
});
test('entry search success, missing provenance, wrong path or renamed frozen scope cannot become natural originals', () => {
  for (const changed of [
    { result_urls: [] }, { status: 'failed' }, { channel: null },
    { result_urls: ['https://example.org/authors/bob/article'] },
    { channel: { id: 'channel', url: 'https://example.org/', scope: 'site' } },
    { run: { job_type: 'manual', schedule_key: day } },
    { run: { job_type: 'daily_scan', schedule_key: '2026-10-12:historical' } },
    { run: { job_type: 'daily_scan', schedule_key: '2026-09-13' } }
  ]) {
    const result = summarize({ tasks: [task(changed)] });
    assert.equal(result.entries[0].performance.natural_source_count, 0, JSON.stringify(changed));
    assert.equal(result.entries[0].performance.same_site_source_count, 1);
  }
});
test('recent effective sources require explicit dates, current source hashes and evidence-ready successful analysis', () => {
  assert.equal(validRecentSource(source({ publication_date: '2026-09-14' }), day), true);
  for (const changed of [
    { publication_date: '2026-09-13' }, { publication_date: '2026-10-14' }, { publication_date: '2026-09-31' },
    { publication_date: null }, { publication_method: null }, { publication_method: 'conflicting_metadata' },
    { publication_method: 'unknown' }, { content_sha256: 'short' }, { extraction_source_sha256: 'b'.repeat(64) },
    { extraction_status: 'extraction_failed' }, { status: 'evidence_failed' }, { published_at: 'invalid' }
  ]) {
    assert.equal(validRecentSource(source(changed), day), false, JSON.stringify(changed));
    const row = summarize({ sources: [source(changed)] }).entries[0];
    assert.equal(row.performance.natural_source_count, 0);
    assert.equal(row.performance.same_site_source_count, 0);
  }
});
test('publication instant applies Beijing day boundaries rather than silently treating UTC future dates as today', () => {
  assert.equal(validRecentSource(source({ publication_date: day, published_at: '2026-10-13T16:00:00Z' }), day), false);
  assert.equal(validRecentSource(source({ publication_date: '2026-09-13', published_at: '2026-09-13T16:00:00Z' }), day), true);
});
test('latest URL versions retain failure precedence even through redirect request aliases', () => {
  const old = source({ fetched_at: '2026-10-12T01:00:00Z', requested_url: 'https://example.org/link', final_url: 'https://example.org/authors/alice/article' });
  const failed = source({ id: 'failed', requested_url: 'https://example.org/link', final_url: null, status: 'fetch_failed' });
  assert.deepEqual(latestSources([old, failed]).map(item => item.id), ['failed']);
  assert.equal(summarize({ sources: [old, failed] }).entries[0].performance.same_site_source_count, 0);
  const newer = source({ id: 'newest', fetched_at: '2026-10-13T02:00:00Z' });
  assert.equal(summarize({ sources: [newer, old, failed] }).entries[0].performance.same_site_source_count, 1);
  assert.equal(summarize({ sources: [source(), source({ id: 'a', status: 'fetch_failed' })] }).entries[0].performance.same_site_source_count, 0);
});
test('coverage uses enabled direction-country intersections and evidence region, not channel country declarations alone', () => {
  const result = summarize({ directions: [direction(), { ...direction('disabled', ['AE']), config: { countries: ['AE'], enabled: false } }],
    entries: [entry({ config: { ...entry().config, countries: ['SA', 'AE'] } })], sources: [source({ countries: [{ code: 'AE', relation: 'occurrence' }] })] });
  assert.deepEqual(result.coverage.map(row => row.country), ['SA']);
  const cell = result.coverage[0].types.find(row => row.type === 'research');
  assert.equal(cell.eligible_channels, 1);
  assert.equal(cell.natural_source_count, 0);
  assert.equal(cell.gap, 'no_natural_source');
  const mismatch = summarize({ entries: [entry({ config: { ...entry().config, direction_ids: ['another-direction'] } })] });
  assert.equal(mismatch.entries[0].scope.reason, 'no_direction_match');
  assert.equal(mismatch.coverage[0].types.find(row => row.type === 'research').gap, 'no_channel');
});
test('fixed monitoring is an independent real mechanism, including outside configured direction countries', () => {
  const fixed = entry({ id: 'fixed:verified', access: { status: 'unchecked' }, config: { ...entry().config, mode: 'fixed' } });
  const result = summarize({ entries: [fixed], tasks: [task({ item_key: 'registry:verified', channel: null })], directions: [direction('d-ae', ['AE'])] });
  assert.equal(result.entries[0].scope.in_current_scope, false);
  assert.equal(result.entries[0].usage.reason, 'fixed_monitoring');
  assert.equal(result.entries[0].usage.eligible, true);
  assert.equal(result.entries[0].performance.natural_source_count, 1);
  assert.equal(result.coverage[0].types.find(row => row.type === 'research').eligible_channels, 0);
});
test('paused, removed or host-paused channels preserve evidence but are not current eligible coverage', () => {
  for (const changed of [{ status: 'paused' }, { status: 'removed' }, { host_paused: true }]) {
    const result = summarize({ entries: [entry(changed)] });
    assert.equal(result.entries[0].usage.eligible, false);
    assert.equal(result.entries[0].performance.natural_source_count, 1);
    assert.equal(result.coverage[0].types.find(row => row.type === 'research').eligible_channels, 0);
    assert.equal(result.suggestions.length, 0);
  }
});
test('another paused or removed scope blocks the covered entry URL without widening a child path to its parent', () => {
  for (const mode of ['fixed', 'search']) for (const status of ['paused', 'removed']) {
    const active = entry({ id: mode === 'fixed' ? 'fixed:verified' : 'channel', config: { ...entry().config, mode } });
    const blocked = entry({ id: 'blocked', status });
    const result = summarize({ entries: [active, blocked], tasks: [task({ item_key: mode === 'fixed' ? 'registry:verified' : 'discover:SA' })] });
    assert.equal(result.entries[0].usage.reason, 'scope_paused');
    assert.equal(result.entries[0].usage.eligible, false);
    assert.equal(result.entries[0].performance.natural_source_count, 1);
    assert.equal(result.coverage[0].types.find(row => row.type === 'research').eligible_channels, 0);
  }
  for (const url of ['https://example.org/authors/alice/child/', 'https://example.org/authors/bob/',
    'https://example.org/authors/alice-other/', 'https://example.org.evil.test/authors/alice/']) {
    const fixed = entry({ id: 'fixed:verified', config: { ...entry().config, mode: 'fixed' } });
    const paused = entry({ id: 'blocked', status: 'paused', config: { ...entry().config, url } });
    const result = summarize({ entries: [fixed, paused] });
    assert.equal(result.entries[0].usage.reason, 'fixed_monitoring', url);
    assert.equal(result.entries[0].usage.eligible, true, url);
  }
});
test('suggestions group only recent analyzed unregistered source domains without widening the selected article path', () => {
  const one = source({ id: 'one', requested_url: 'https://new.example/authors/alice/one', final_url: 'https://new.example/authors/alice/one' });
  const two = source({ id: 'two', fetched_at: '2026-10-12T00:00:00Z', requested_url: 'https://www.new.example/authors/bob/two', final_url: 'https://www.new.example/authors/bob/two' });
  const result = summarize({ sources: [two, one] });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].sample_count, 2);
  assert.equal(result.suggestions[0].url, one.final_url);
  assert.equal(result.suggestions[0].draft_scope, 'path');
  assert.deepEqual(result.suggestions[0].direction_ids, ['d-sa']);
  assert.equal(result.suggestions[0].sample_date, '2026-10-12');
  assert.equal(result.suggestions[0].fetched_at, one.fetched_at);
  assert.equal(result.suggestions[0].reason, 'recent_validated_sample');
});
test('unknown, future, failed, outside-scope and explicitly suppressed domains do not become usable suggestions', () => {
  const saved = source({ requested_url: 'https://new.example/alice/article', final_url: 'https://new.example/alice/article' });
  for (const changed of [{ publication_date: '2026-10-14' }, { publication_date: '2026-08-01' }, { publication_method: 'conflicting_metadata' },
    { extraction_status: 'extraction_failed' }, { countries: [] }, { countries: [{ code: 'AE', relation: 'occurrence' }] }])
    assert.equal(summarize({ sources: [{ ...saved, ...changed }] }).suggestions.length, 0, JSON.stringify(changed));
  for (const status of ['removed', 'paused']) {
    const blocked = entry({ status, config: { ...entry().config, url: 'https://new.example/alice/', scope: 'path' } });
    assert.equal(summarize({ entries: [blocked], sources: [saved] }).suggestions.length, 0);
    assert.equal(summarize({ entries: [blocked], sources: [{ ...saved, requested_url: 'https://new.example/bob/article', final_url: 'https://new.example/bob/article' }] }).suggestions.length, 1);
  }
});
test('sample and task windows explicitly retain unknown completeness without promoting saved samples to natural output', () => {
  const result = summarize({ sourceLimit: 1, taskLimit: 1, tasks: [task({ result_urls: [] })] });
  assert.equal(result.window.sources_limited, true);
  assert.equal(result.window.tasks_limited, true);
  assert.equal(result.entries[0].performance.sources_limited, true);
  assert.equal(result.entries[0].performance.tasks_limited, true);
  assert.equal(result.entries[0].performance.natural_source_count, 0);
  assert.equal(result.entries[0].performance.same_site_source_count, 1);
  assert.equal(result.coverage[0].types.find(cell => cell.type === 'research').limited, true);
});
test('a complete source read does not mark zero or five hundred originals as truncated, while task caps remain explicit', () => {
  for (const count of [0, 500]) {
    const result = summarize({ sourceLimit: null, sources: Array.from({ length: count }, (_, i) => source({ id: 'source-' + i })), tasks: [] });
    assert.equal(result.window.sources_limited, false); assert.equal(result.entries[0].performance.sources_limited, false);
    assert.equal(result.sample_limit, null); assert.equal(result.coverage[0].types.find(cell => cell.type === 'research').limited, false);
  }
  const tasks = Array.from({ length: 1000 }, (_, i) => task({ id: 'task-' + i }));
  const capped = summarize({ sourceLimit: null, sources: [], tasks });
  assert.equal(capped.window.sources_limited, false); assert.equal(capped.window.tasks_limited, true);
  assert.equal(capped.coverage[0].types.find(cell => cell.type === 'research').limited, true);
});
test('no saved enabled directions yields no fabricated scope coverage or usable discovery suggestion', () => {
  const result = summarize({ directions: [] });
  assert.deepEqual(result.coverage, []);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.entries[0].scope.reason, 'no_directions');
});
test('user takeover of a reference candidate does not falsely advertise automatic trial eligibility', () => {
  const result = summarize({ entries: [entry({ id: 'reference:auto:' + 'a'.repeat(64), status: 'candidate', access: { status: 'readable', managed_by: 'user' } })] });
  assert.equal(result.entries[0].usage.eligible, false);
  assert.equal(result.entries[0].usage.reason, 'candidate');
});
test('a safely scoped automatic candidate is system trial work and never counts as active coverage', () => {
  const candidate = entry({ id: 'reference:auto:' + 'a'.repeat(64), status: 'candidate',
    access: { status: 'readable', managed_by: 'automatic', trial_scope_verified: true, scope_verified: false, auto_scope_key: 'example.org/authors/alice' } });
  const result = summarize({ entries: [candidate], tasks: [] });
  assert.equal(result.entries[0].usage.reason, 'reference_trial'); assert.equal(result.entries[0].usage.eligible, true);
  const cell = result.coverage[0].types.find(row => row.type === 'research');
  assert.equal(cell.eligible_channels, 0); assert.equal(cell.candidate_channels, 1); assert.equal(cell.gap, 'no_channel');
});
test('growth reports recorded times and distinct channel counts, leaving old activation dates unknown', () => {
  const recent = entry({ access: { status: 'readable', managed_by: 'automatic', checked_at: '2026-10-13T00:00:00Z',
    discovered_at: '2026-10-12T00:00:00Z', activated_at: '2026-10-13T01:00:00Z' } });
  const old = entry({ id: 'old', access: { status: 'readable', managed_by: 'automatic', checked_at: '2026-09-01T00:00:00Z' } });
  const future = entry({ id: 'future', status: 'candidate', access: { status: 'unchecked', checked_at: '2026-10-13T16:00:00Z', discovered_at: 'invalid' } });
  const result = summarize({ entries: [recent, old, future] });
  assert.deepEqual(result.growth, { first_day: '2026-09-14', last_day: day, last_checked_at: recent.access.checked_at, checked_channels: 1,
    last_registered_at: recent.access.discovered_at, registered_channels: 1, last_activated_at: recent.access.activated_at, activated_channels: 1,
    activation_dates_complete: false });
  const unknown = summarize({ entries: [entry()] }).growth;
  assert.equal(unknown.last_checked_at, null); assert.equal(unknown.last_registered_at, null); assert.equal(unknown.last_activated_at, null);
  assert.equal(unknown.checked_channels, 0); assert.equal(unknown.activated_channels, 0);
});
test('library store reuses caller direction read and a single bounded projected natural task query', async () => {
  const calls = [], store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async (input, init) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('intelligence_library_recent_sources')) {
      assert.equal(init.method, 'POST'); assert.equal(JSON.parse(init.body).p_owner_id, 'owner');
      return Response.json([]);
    }
    assert.ok(!init.method || init.method === 'GET');
    assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
    if (url.pathname.endsWith('intelligence_job_items')) return Response.json([]);
    throw Error('unexpected read');
  });
  store.sourceLibrary = async () => [entry()];
  const result = await store.libraryOverview('owner', Promise.resolve([direction()]));
  assert.equal(calls.length, 2);
  const taskRead = calls.find(url => url.pathname.endsWith('intelligence_job_items'));
  assert.match(taskRead.searchParams.get('select'), /run:intelligence_job_runs!inner\(job_type,schedule_key\)/);
  assert.equal(taskRead.searchParams.get('run.job_type'), 'eq.daily_scan');
  assert.equal(taskRead.searchParams.get('limit'), '1000');
  assert.ok(!taskRead.searchParams.get('select').split(',').includes('checkpoint'));
  const sourceRead = calls.find(url => url.pathname.endsWith('intelligence_library_recent_sources'));
  assert.ok(sourceRead.pathname.includes('/rpc/'));
  assert.equal(sourceRead.searchParams.has('limit'), false);
  assert.equal(result.window.sources_limited, false);
  assert.equal(result.sample_limit, null);
  assert.equal(result.entries[0].scope.in_current_scope, true);
});
