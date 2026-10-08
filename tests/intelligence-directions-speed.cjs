const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, failure } = require('../lib/intelligence/store.cjs');
const { createHandler } = require('../api/intelligence.js');
const { directionsPage } = require('../lib/intelligence/pages.cjs');

const OWNER = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  NRGOPT_ADMIN_USER_ID: OWNER, NRGOPT_APP_ORIGIN: 'https://app.test', NRGOPT_INTELLIGENCE_WRITE_ENABLED: '1' };
const day = '2026-10-08';
const config = { name: '能源方向', why: '关注供电变化', industries: '医院', countries: ['SA'], targets: ['signal'], exclude: '', priority: 'normal', enabled: true };
const direction = { id: 'direction-a', revision: 2, config: { ...config, enabled: false }, effective_on: '2026-10-09', updated_at: '2026-10-08T01:00:00Z' };
const effective = [{ id: direction.id, revision: 1, config }];
const initialData = { day, directions: [direction], versions: [], tasks: [], effective, writable: true, websites: {} };

function projected(row, select) {
  if (select === '*') return row;
  return Object.fromEntries(select.split(',').map(field => {
    const colon = field.indexOf(':'), name = colon < 0 ? field : field.slice(0, colon);
    const path = (colon < 0 ? field : field.slice(colon + 1)).split(/->>?/);
    return [name, path.reduce((value, key) => value?.[key], row)];
  }));
}

test('direction read projects historical settings and search checkpoints while preserving effective and pending versions', async () => {
  const versions = [{ direction_id: direction.id, revision: 1, config: { ...config, unused: 'private-history'.repeat(100) }, effective_on: day, recorded_at: '2026-10-07T01:00:00Z' }];
  const tasks = [{ status: 'succeeded', error_code: null, updated_at: '2026-10-08T00:00:00Z', job_run_id: 'run-a',
    checkpoint: { direction: { id: direction.id, revision: 1, config }, country: 'SA', result_urls: ['https://source.test/1', 'https://source.test/2'], unused: 'private-search'.repeat(100) } },
  { status: 'failed', error_code: 'source_empty_document', updated_at: '2026-10-07T00:00:00Z', job_run_id: 'run-b', checkpoint: { country: 'AE' } }];
  const tables = { intelligence_collection_directions: [direction], intelligence_collection_direction_versions: versions, intelligence_job_items: tasks };
  const calls = [];
  const store = createStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, async (input, init) => {
    const url = new URL(input), name = url.pathname.split('/').pop();
    calls.push({ name, query: url.searchParams });
    if (name === 'intelligence_effective_collection_directions') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { p_owner_id: OWNER, p_day: day });
      return Response.json(effective);
    }
    assert.ok(!init.method || init.method === 'GET', 'table reads must never mutate');
    assert.equal(url.searchParams.get('owner_id'), `eq.${OWNER}`);
    assert.ok(Object.hasOwn(tables, name), `unexpected read ${name}`);
    return Response.json(tables[name].map(row => projected(row, url.searchParams.get('select'))));
  });
  const result = await store.collectionDirections(OWNER, day);
  assert.equal(calls.length, 4);
  assert.deepEqual(result.directions, [direction]);
  assert.deepEqual(result.effective, effective);
  assert.equal(result.directions[0].config.enabled, false);
  assert.equal(result.effective[0].config.enabled, true);
  assert.deepEqual(result.versions[0].config, { name: config.name, enabled: true });
  assert.deepEqual(result.tasks[0].checkpoint, { direction: { id: direction.id, revision: 1 }, country: 'SA', result_count: 2 });
  assert.equal(result.tasks[0].status, 'succeeded');
  assert.equal(result.tasks[0].updated_at, tasks[0].updated_at);
  assert.equal(result.tasks.length, 1, 'unassigned legacy searches stay excluded');
  assert.doesNotMatch(JSON.stringify(result), /private-history|private-search/);
  assert.ok(!Object.hasOwn(result.tasks[0], 'result_urls'));
  assert.ok(!Object.hasOwn(result.tasks[0].checkpoint, 'result_urls'));
  assert.ok(!Object.hasOwn(result.tasks[0].checkpoint.direction, 'config'));
  const history = calls.find(call => call.name === 'intelligence_collection_direction_versions');
  const searches = calls.find(call => call.name === 'intelligence_job_items');
  assert.ok(!history.query.get('select').split(',').includes('config'));
  assert.ok(!searches.query.get('select').split(',').includes('checkpoint'));
  assert.equal(history.query.get('limit'), '200');
  assert.equal(searches.query.get('limit'), '240');
  assert.equal(searches.query.get('order'), 'updated_at.desc');
});

function bootstrap(html) {
  const matches = [...html.matchAll(/<script\b[^>]*\bid="intelligence-initial-directions"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, 'the page supplies one direction snapshot');
  return JSON.parse(matches[0][1]);
}

test('direction bootstrap escapes closing tags without changing saved text', () => {
  const hostile = '</script><script>alert("direction")</script><img src=x onerror=alert(1)>';
  const data = { ...initialData, directions: [{ ...direction, config: { ...direction.config, name: hostile } }] };
  const html = directionsPage('local@app.test', data);
  assert.match(html, /type="application\/json"[^>]*id="intelligence-initial-directions"|id="intelligence-initial-directions"[^>]*type="application\/json"/);
  assert.deepEqual(bootstrap(html), data);
  assert.ok(!html.includes(hostile), 'saved text cannot terminate the inert JSON script');
});

async function request(store, { cookie = '__Host-nrgopt_session=signed.test-token', action = 'directions-page' } = {}) {
  const handler = createHandler({ env, storeFactory: () => store });
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, json(value) { this.body = value; }, end(value) { this.body = value; } };
  await handler({ method: 'GET', query: { action }, headers: cookie ? { cookie } : {} }, res);
  assert.match(res.headers['cache-control'], /private, no-store/);
  return res;
}

test('direction page authenticates once before embedding one owner-scoped snapshot', async () => {
  const calls = [];
  const response = await request({
    user: async token => { assert.equal(token, 'signed.test-token'); calls.push('auth'); return { id: OWNER, email: 'local@app.test' }; },
    collectionDirections: async (owner, currentDay) => { assert.equal(owner, OWNER); assert.match(currentDay, /^\d{4}-\d{2}-\d{2}$/); calls.push('read'); return initialData; }
  });
  assert.equal(response.code, 200);
  assert.deepEqual(calls, ['auth', 'read']);
  const data = bootstrap(response.body);
  assert.deepEqual(data.directions, initialData.directions);
  assert.deepEqual(data.effective, initialData.effective);
  assert.equal(data.writable, true);
  assert.ok(data.websites.SA.length);
  assert.match(response.body, /id="direction-list"/);
});

test('direction page denies missing or unauthorized sessions before reading direction data', async () => {
  let reads = 0, auth = 0;
  const store = { user: async () => { auth++; return { id: 'another-owner' }; }, collectionDirections: async () => { reads++; return initialData; } };
  const anonymous = await request(store, { cookie: null });
  assert.equal(anonymous.code, 303);
  assert.equal(anonymous.headers.location, '/intelligence/login?returnTo=%2Fintelligence%2Fdirections');
  assert.equal(auth, 0);
  const forbidden = await request(store);
  assert.equal(forbidden.code, 403);
  assert.equal(reads, 0);
  assert.ok(!String(forbidden.body).includes('intelligence-initial-directions'));
});

test('direction read failure keeps the page shell with a safe Chinese error and no raw upstream detail', async () => {
  for (const error of [Object.assign(new Error('secret-db-host and SQL statement'), failure('upstream_unavailable')), new Error('secret-db-host and SQL statement')]) {
    const response = await request({ user: async () => ({ id: OWNER, email: 'local@app.test' }), collectionDirections: async () => { throw error; } });
    assert.equal(response.code, 200);
    assert.match(response.body, /id="direction-list"/);
    assert.match(response.body, /id="direction-form"/);
    const data = bootstrap(response.body);
    assert.match(data.error_zh, /[\u4e00-\u9fff]/);
    assert.ok(!response.body.includes('secret-db-host'));
    assert.ok(!response.body.includes('SQL statement'));
    assert.ok(!Object.hasOwn(data, 'directions'), 'a failed read must not become an empty saved direction list');
  }
});
