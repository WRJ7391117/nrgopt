const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateMatrix, selectDirection, queryTerms } = require('../lib/intelligence/directions.cjs');
const { createStore, settings, failure } = require('../lib/intelligence/store.cjs');
const { createHandler } = require('../api/intelligence.js');

const owner = '22222222-2222-4222-8222-222222222222';
const first = 'aaaaaaaa-1111-4111-8111-111111111111';
const second = 'bbbbbbbb-2222-4222-8222-222222222222';
const environment = {
  SUPABASE_URL: 'https://backend.example', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  NRGOPT_ADMIN_USER_ID: owner, NRGOPT_APP_ORIGIN: 'https://app.example', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1'
};
function matrix() {
  const config = { ...structuredClone(defaults[0].config), why: '监测能源变化与实际采购需求', countries: ['SA', 'UZ'],
    industries: '工业、水务、政府、能源机构', exclude: '无关促销', topic_codes: ['red-sea', 'hormuz'] };
  return { directions: [
    { id: first, revision: 2, config: { ...structuredClone(config), name: '地区冲突与能源保供', targets: ['signal'] } },
    { id: second, revision: 3, config: { ...structuredClone(config), name: '能源项目与采购进展', targets: ['procurement'] } }
  ] };
}
function app({ writable = true, userId = owner, save = async (_owner, value) => value } = {}) {
  const saves = [];
  const handler = createHandler({ env: { ...environment, NRGOPT_INTELLIGENCE_WRITE_ENABLED: writable ? '1' : '0' },
    storeFactory: () => ({ user: async () => ({ id: userId }), saveDirection: () => assert.fail('individual save was called'),
      saveDirectionMatrix: async (id, value) => { saves.push({ id, value }); return save(id, value); } }) });
  return { saves, request: async (body, { action = 'save-direction-matrix', method = 'POST', authenticated = true, headers = {} } = {}) => {
    const response = { code: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      status(code) { this.code = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = body; } };
    await handler({ method, query: { action }, body, headers: { origin: environment.NRGOPT_APP_ORIGIN, 'content-type': 'application/json',
      ...(authenticated ? { cookie: '__Host-nrgopt_session=signed.test-token' } : {}), ...headers } }, response);
    assert.match(response.headers['cache-control'], /no-store/);
    return response;
  } };
}

test('purpose matrix keeps each direction association while normalizing one shared scope without mutating the draft', () => {
  const input = matrix();
  input.directions[1].config.countries.reverse();
  input.directions[1].config.topic_codes.reverse();
  const before = structuredClone(input);
  const saved = validateMatrix(input);
  assert.deepEqual(input, before);
  assert.deepEqual(saved.directions.map(d => d.config.targets), [['signal'], ['procurement']]);
  assert.deepEqual(saved.directions.map(d => [d.id, d.revision]), [[first, 2], [second, 3]]);
  assert.deepEqual(saved.directions[0].config.countries, saved.directions[1].config.countries);
  assert.deepEqual(saved.directions[0].config.topic_codes, ['hormuz', 'red-sea']);
  assert.match(queryTerms(saved.directions[0]), /值得留意的变化/);
  assert.doesNotMatch(queryTerms(saved.directions[0]), /采购机会/);
  assert.match(queryTerms(saved.directions[1]), /采购机会/);
});

test('shared settings cannot diverge across directions', () => {
  for (const [key, value] of Object.entries({ why: '不同目的', industries: '其他行业', exclude: '不同排除项', priority: 'high',
    countries: ['SA'], topic_codes: ['red-sea'], filter_rules: { include: ['change'], include_note: '', focus: [] } })) {
    const input = matrix(); input.directions[1].config[key] = value;
    assert.throws(() => validateMatrix(input), { code: 'invalid_request' }, key);
  }
});

test('matrix validates bounded complete rows, unique existing IDs and new zero revisions without imposing name uniqueness', () => {
  const duplicate = matrix(); duplicate.directions[1].id = first.toUpperCase();
  assert.throws(() => validateMatrix(duplicate), { code: 'invalid_request' });
  for (const body of [null, {}, { directions: [] }, { directions: [null] }, { directions: [{}] }])
    assert.throws(() => validateMatrix(body), { code: 'invalid_request' });
  assert.throws(() => validateMatrix({ directions: Array(21).fill(matrix().directions[0]) }), { code: 'direction_limit' });
  for (const patch of [{ revision: -1 }, { id: 'invalid' }, { id: null, revision: 1 }]) {
    const input = matrix(); Object.assign(input.directions[0], patch);
    assert.throws(() => validateMatrix(input), { code: 'invalid_request' });
  }
  const input = matrix(); input.directions[1].config.name = input.directions[0].config.name;
  input.directions.push({ id: null, revision: 0, config: { ...structuredClone(input.directions[0].config), enabled: false } });
  assert.equal(validateMatrix(input).directions.length, 3);
});

test('a deselected direction keeps its legacy targets but is absent from natural search rotation', () => {
  const input = matrix(); input.directions[0].config.enabled = false;
  const saved = validateMatrix(input);
  assert.deepEqual(saved.directions[0].config.targets, ['signal']);
  assert.equal(selectDirection(saved.directions, 'SA', '2026-10-12').id, second);
  input.directions[0].config.targets = [];
  assert.throws(() => validateMatrix(input), { code: 'invalid_request' });
});

test('store saves the entire matrix through one owner-scoped RPC and returns all direction versions', async () => {
  const input = validateMatrix(matrix()), calls = [];
  const result = { directions: input.directions.map(d => ({ ...d, revision: d.revision + 1, effective_on: '2026-10-13' })) };
  const store = createStore(settings(environment), async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify(result));
  });
  assert.deepEqual(await store.saveDirectionMatrix(owner, input), result);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/rest/v1/rpc/save_intelligence_collection_matrix');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_owner_id: owner, p_directions: input.directions });
});

test('store propagates atomic conflicts without returning partial success or retrying rows', async () => {
  for (const [error, status] of [['direction_conflict', 409], ['not_found', 404], ['direction_limit', 400], ['invalid_request', 400]]) {
    let count = 0;
    const store = createStore(settings(environment), async () => { count++; return new Response(JSON.stringify({ error })); });
    await assert.rejects(store.saveDirectionMatrix(owner, validateMatrix(matrix())), { code: error, status });
    assert.equal(count, 1);
  }
  for (const result of [null, {}, { directions: [] }]) {
    const store = createStore(settings(environment), async () => new Response(JSON.stringify(result)));
    await assert.rejects(store.saveDirectionMatrix(owner, validateMatrix(matrix())), { code: 'storage_failed' });
  }
});

test('matrix route preserves authenticated owner, write gate, origin and POST protection', async () => {
  const api = app(), input = { ...matrix(), owner_id: 'other-owner' };
  const saved = await api.request(input);
  assert.equal(saved.code, 200);
  assert.deepEqual(saved.body, validateMatrix(input));
  assert.deepEqual(api.saves, [{ id: owner, value: validateMatrix(input) }]);
  const blocked = app();
  assert.equal((await blocked.request(input, { authenticated: false })).code, 401);
  assert.equal((await blocked.request(input, { headers: { origin: 'https://other.example' } })).code, 403);
  assert.equal((await blocked.request(input, { method: 'GET' })).code, 405);
  assert.equal((await blocked.request(input, { headers: { 'content-type': 'text/plain' } })).code, 400);
  assert.deepEqual(blocked.saves, []);
  const readonly = app({ writable: false });
  assert.equal((await readonly.request(input)).code, 403); assert.deepEqual(readonly.saves, []);
  const foreign = app({ userId: 'other-owner' });
  assert.equal((await foreign.request(input)).code, 403); assert.deepEqual(foreign.saves, []);
});

test('matrix route rejects mismatched scopes and surfaces stale revisions without partial saves', async () => {
  const api = app(), input = matrix(); input.directions[1].config.countries = ['AE'];
  assert.equal((await api.request(input)).code, 400); assert.deepEqual(api.saves, []);
  const conflict = app({ save: async () => { throw failure('direction_conflict', 409); } });
  const response = await conflict.request(matrix());
  assert.equal(response.code, 409); assert.equal(response.body.error, 'direction_conflict');
  assert.match(response.body.message, /编辑仍保留/); assert.equal(conflict.saves.length, 1);
});

test('old pages cannot silently remove positive filtering rules and rule validation is owner-scoped before writing', async () => {
  const api = app(), input = matrix();
  delete input.directions[0].config.filter_rules;
  const stale = await api.request(input);
  assert.equal(stale.code, 409); assert.equal(stale.body.error, 'rules_refresh_required');
  assert.match(stale.body.message, /刷新页面/); assert.deepEqual(api.saves, []);
  const invalid = matrix(); invalid.directions[1].config.filter_rules.include = [];
  assert.equal((await api.request(invalid)).code, 400); assert.deepEqual(api.saves, []);
  const saved = await api.request(matrix());
  assert.equal(saved.code, 200);
  assert.ok(saved.body.directions.every(d => JSON.stringify(d.config.filter_rules) === JSON.stringify(saved.body.directions[0].config.filter_rules)));
});

test('complete matrices have a bounded larger request limit while obsolete individual saves cannot break shared settings', async () => {
  const api = app(), base = matrix().directions[0];
  const input = { directions: Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(base),
    id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    config: { ...structuredClone(base.config), why: '关'.repeat(400), industries: '业'.repeat(200), exclude: '除'.repeat(300) } })) };
  assert.ok(JSON.stringify(input).length > 8192);
  assert.equal((await api.request(input)).code, 200);
  const oversized = await api.request({ ...input, padding: 'x'.repeat(65536) });
  assert.equal(oversized.code, 400); assert.equal(api.saves.length, 1);
  const obsolete = await api.request(base, { action: 'save-direction' });
  assert.equal(obsolete.code, 409); assert.equal(obsolete.body.error, 'matrix_required');
  assert.match(obsolete.body.message, /搜索目的与方向/); assert.equal(api.saves.length, 1);
});
