const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, failure } = require('../lib/intelligence/store.cjs');
const { createHandler } = require('../api/intelligence.js');

const OWNER = '22222222-2222-4222-8222-222222222222';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  NRGOPT_ADMIN_USER_ID: OWNER, NRGOPT_APP_ORIGIN: 'https://app.test', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1' };
const day = '2026-10-08';
const config = { name: '能源方向', why: '关注供电变化', industries: '医院', countries: ['SA'], targets: ['signal'], exclude: '', priority: 'normal', enabled: true };
const direction = { id: ID, revision: 2, config: { ...config, enabled: false }, effective_on: '2026-10-09', updated_at: '2026-10-08T01:00:00Z' };
const effective = [{ id: ID, revision: 1, config }];
const data = { day, directions: [direction], effective };

function valueAt(row, field) { return field.split(/->>?/).reduce((value, key) => value?.[key], row); }
function projected(row, select) {
  return Object.fromEntries(select.split(',').map(field => {
    const colon = field.indexOf(':'), name = colon < 0 ? field : field.slice(0, colon);
    return [name, valueAt(row, colon < 0 ? field : field.slice(colon + 1))];
  }));
}

test('direction first read starts only settings and effective reads and preserves next-day changes', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, async (input, init) => {
    const url = new URL(input), name = url.pathname.split('/').pop();
    calls.push(name);
    await gate;
    if (name === 'intelligence_effective_collection_directions') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { p_owner_id: OWNER, p_day: day });
      return Response.json(effective);
    }
    assert.equal(name, 'intelligence_collection_directions', 'first read must not load history or search tasks');
    assert.ok(!init.method || init.method === 'GET');
    assert.equal(url.searchParams.get('owner_id'), `eq.${OWNER}`);
    return Response.json([direction]);
  });
  const pending = store.collectionDirections(OWNER, day);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.sort(), ['intelligence_collection_directions', 'intelligence_effective_collection_directions']);
  } finally { release(); }
  assert.deepEqual(await pending, data);
  assert.equal(data.directions[0].config.enabled, false);
  assert.equal(data.effective[0].config.enabled, true);
});

test('expanded direction reads only its owner latest search and five settings versions with compact fields', async () => {
  const versions = Array.from({ length: 7 }, (_, index) => ({ owner_id: OWNER, direction_id: ID, revision: index + 1,
    config: { ...config, name: `版本 ${index + 1}`, unused: 'private-history'.repeat(100) }, effective_on: day,
    recorded_at: `2026-10-0${index + 1}T01:00:00Z` }));
  versions.push({ ...versions[6], owner_id: 'another-owner', revision: 99 }, { ...versions[6], direction_id: OTHER_ID, revision: 98 });
  const task = { owner_id: OWNER, status: 'succeeded', item_key: 'discover:SA', error_code: null, updated_at: '2026-10-08T00:00:00Z', job_run_id: 'run-a',
    checkpoint: { direction: { id: ID, revision: 1, config }, country: 'SA', result_urls: ['https://source.test/1', 'https://source.test/2'], queries: ['private-search'.repeat(100)] } };
  const tasks = [task, { ...task, updated_at: '2026-10-07T00:00:00Z' }, { ...task, owner_id: 'another-owner', updated_at: '2026-10-09T00:00:00Z' },
    { ...task, updated_at: '2026-10-09T00:00:00Z', checkpoint: { ...task.checkpoint, direction: { id: OTHER_ID } } },
    { ...task, item_key: 'source:unrelated', updated_at: '2026-10-09T00:00:00Z' }];
  const tables = { intelligence_collection_direction_versions: versions, intelligence_job_items: tasks }, calls = [];
  const store = createStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, async (input, init) => {
    const url = new URL(input), query = url.searchParams, name = url.pathname.split('/').pop();
    assert.ok(!init.method || init.method === 'GET', 'activity reads must never mutate');
    assert.equal(query.get('owner_id'), `eq.${OWNER}`);
    assert.ok(Object.hasOwn(tables, name), `unexpected read ${name}`);
    calls.push({ name, query });
    let rows = tables[name].filter(row => [...query].every(([field, value]) => {
      if (['select', 'limit', 'order'].includes(field)) return true;
      if (value.startsWith('eq.')) return String(valueAt(row, field)) === value.slice(3);
      if (field === 'item_key' && value === 'like.discover:*') return row.item_key.startsWith('discover:');
      assert.fail(`unexpected filter ${field}=${value}`);
    }));
    const ordering = query.get('order').split(',').map(field => field.split('.'));
    rows = rows.sort((left, right) => {
      for (const [field, sort] of ordering) if (left[field] !== right[field]) return (left[field] > right[field] ? 1 : -1) * (sort === 'desc' ? -1 : 1);
      return 0;
    }).slice(0, Number(query.get('limit')));
    return Response.json(rows.map(row => projected(row, query.get('select'))));
  });
  const result = await store.directionActivity(OWNER, ID);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.versions.map(version => version.revision), [7, 6, 5, 4, 3]);
  assert.deepEqual(result.versions[0].config, { name: '版本 7', enabled: true });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].updated_at, task.updated_at);
  assert.equal(result.tasks[0].status, 'succeeded');
  assert.deepEqual(result.tasks[0].checkpoint, { direction: { id: ID, revision: 1 }, country: 'SA', result_count: 2 });
  assert.doesNotMatch(JSON.stringify(result), /private-history|private-search|result_urls|queries/);
  const history = calls.find(call => call.name === 'intelligence_collection_direction_versions');
  const searches = calls.find(call => call.name === 'intelligence_job_items');
  assert.equal(history.query.get('direction_id'), `eq.${ID}`);
  assert.equal(history.query.get('limit'), '5');
  assert.ok(!history.query.get('select').split(',').includes('config'));
  assert.equal(searches.query.get('checkpoint->direction->>id'), `eq.${ID}`);
  assert.equal(searches.query.get('limit'), '1');
  assert.equal(searches.query.get('order'), 'updated_at.desc');
  assert.ok(!searches.query.get('select').split(',').includes('checkpoint'));
});

async function request(store, { cookie = '__Host-nrgopt_session=signed.test-token', action = 'directions-page', id = ID } = {}) {
  const handler = createHandler({ env, storeFactory: () => store });
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, json(value) { this.body = value; }, end(value) { this.body = value; } };
  await handler({ method: 'GET', query: { action, id }, headers: cookie ? { cookie } : {} }, res);
  assert.match(res.headers['cache-control'], /private, no-store/);
  return res;
}

test('direction page authenticates once and returns the shell without preloading any direction data', async () => {
  const calls = [];
  const response = await request({
    user: async token => { assert.equal(token, 'signed.test-token'); calls.push('auth'); return { id: OWNER, email: 'local@app.test' }; },
    collectionDirections: async () => { assert.fail('HTML must not preload direction data'); },
    directionActivity: async () => { assert.fail('HTML must not preload activity'); }
  });
  assert.equal(response.code, 200);
  assert.deepEqual(calls, ['auth']);
  assert.match(response.body, /id="direction-list"/);
  assert.doesNotMatch(response.body, /intelligence-initial-directions/);
});

test('direction activity API rejects anonymous, unauthorized and malformed identifiers before activity reads', async () => {
  let reads = 0, auth = 0;
  const store = { user: async () => { auth++; return { id: OWNER }; }, directionActivity: async () => { reads++; return { versions: [], tasks: [] }; } };
  assert.equal((await request(store, { action: 'direction-activity', cookie: null })).code, 401);
  assert.equal(auth, 0);
  for (const id of ['', 'not-a-uuid', `${ID}&owner_id=another-owner`]) assert.equal((await request(store, { action: 'direction-activity', id })).code, 400);
  assert.equal((await request({ ...store, user: async () => ({ id: 'another-owner' }) }, { action: 'direction-activity' })).code, 403);
  assert.equal(reads, 0);
});

test('direction APIs scope first read and expanded activity to the authenticated owner', async () => {
  const calls = [], activity = { versions: [{ config: { name: config.name, enabled: true } }], tasks: [] };
  const store = { user: async () => ({ id: OWNER }),
    collectionDirections: async (owner, currentDay) => { assert.equal(owner, OWNER); assert.match(currentDay, /^\d{4}-\d{2}-\d{2}$/); calls.push('directions'); return data; },
    directionActivity: async (owner, id) => { assert.equal(owner, OWNER); assert.equal(id, ID); calls.push('activity'); return activity; } };
  const first = await request(store, { action: 'directions' });
  assert.equal(first.code, 200);
  assert.deepEqual(first.body.directions, data.directions);
  assert.deepEqual(first.body.effective, data.effective);
  assert.ok(!Object.hasOwn(first.body, 'tasks') && !Object.hasOwn(first.body, 'versions'));
  assert.equal(first.body.writable, true);
  assert.ok(first.body.websites.SA.length);
  assert.deepEqual(calls, ['directions']);
  const opened = await request(store, { action: 'direction-activity' });
  assert.equal(opened.code, 200);
  assert.deepEqual(opened.body, activity);
  assert.deepEqual(calls, ['directions', 'activity']);
});

test('direction activity errors expose only a Chinese message and never upstream SQL or credentials', async () => {
  for (const error of [Object.assign(new Error('secret-db-host and SQL statement'), failure('upstream_unavailable')), new Error('secret-db-host and SQL statement')]) {
    const response = await request({ user: async () => ({ id: OWNER }), directionActivity: async () => { throw error; } }, { action: 'direction-activity' });
    assert.ok(response.code >= 500);
    assert.match(response.body.message, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(JSON.stringify(response.body), /secret-db-host|SQL statement/);
    assert.ok(!Object.hasOwn(response.body, 'tasks') && !Object.hasOwn(response.body, 'versions'));
  }
});
