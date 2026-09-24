const test = require('node:test');
const assert = require('node:assert/strict');
const { createMiniMaxDiscoverer, validResult } = require('../lib/intelligence/minimax.cjs');

test('custom hosted search returns only unique safe HTTPS source results', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, ...init };
    return new Response(JSON.stringify({ model: 'MiniMax-M3', content: [
      { type: 'text', text: 'searching' },
      { type: 'server_tool_use', name: 'web_search', input: { query: 'official projects' } },
      { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', title: ' Official source ', url: 'https://energy.example/news/1', page_age: '2026-09-22', content: 'Project award.' },
        { type: 'web_search_result', title: 'duplicate', url: 'https://energy.example/news/1', content: 'duplicate' },
        { type: 'web_search_result', title: 'unsafe', url: 'http://energy.example/news/2', content: 'unsafe' }
      ] }
    ], usage: { input_tokens: 3200, output_tokens: 300, cache_read_input_tokens: 200 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const discovery = await createMiniMaxDiscoverer({ apiKey: 'private-test-key', endpoint: 'https://search.example/v1/messages', model: 'MiniMax-M3', fetchImpl })({ query: 'official projects' });
  assert.equal(discovery.results.length, 1);
  assert.equal(discovery.results[0].title, 'Official source');
  assert.equal(discovery.results[0].url, 'https://energy.example/news/1');
  assert.equal(discovery.search_count, 1);
  assert.equal(discovery.provider, 'minimax');
  assert.deepEqual(discovery.usage, { input_tokens: 3200, output_tokens: 300,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 200 });
  assert.equal(request.headers['x-api-key'], 'private-test-key');
  assert.ok(!request.body.includes('private-test-key'));
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'MiniMax-M3');
  assert.deepEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search' }]);
});

test('discovery provider accepts configured identity, model and endpoint', async () => {
  let request;
  const discovery = await createMiniMaxDiscoverer({ apiKey: 'key', provider: 'custom-search', model: 'search-v2',
    endpoint: 'https://search.example/v1/messages', fetchImpl: async (input, init) => {
      request = { input, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ content: [{ type: 'server_tool_use', name: 'web_search' },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://official.example/a' }] }] }));
    } })({ query: 'test' });
  assert.equal(request.input, 'https://search.example/v1/messages');
  assert.equal(request.body.model, 'search-v2');
  assert.equal(discovery.provider, 'custom-search');
  assert.equal(discovery.model, 'search-v2');
});

test('discovery provider fails closed for missing keys, auth errors and malformed results', async () => {
  await assert.rejects(createMiniMaxDiscoverer({})({ query: 'test' }), { code: 'discovery_not_configured', status: 503 });
  await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', endpoint: null })({ query: 'test' }), { code: 'discovery_not_configured', status: 503 });
  await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => new Response('', { status: 401 }) })({ query: 'test' }), { code: 'discovery_auth_failed' });
  await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => new Response('private response', { status: 402 }) })({ query: 'test' }), { code: 'discovery_balance_insufficient', status: 402 });
  await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => new Response(JSON.stringify({ content: [] }), { status: 200 }) })({ query: 'test' }), { code: 'discovery_unavailable' });
  assert.equal(validResult({ type: 'web_search_result', url: 'https://user:secret@example.com' }), null);
});


test('MiniMax Coding Plan uses the dedicated search API without a model call', async () => {
  let request;
  const result = await createMiniMaxDiscoverer({ apiKey: 'private-test-key', fetchImpl: async (url, init) => {
    request = { url, ...init };
    return Response.json({ base_resp: { status_code: 0 }, organic: [
      { title: ' Official award ', link: 'https://energy.example/award', snippet: 'Evidence snippet', date: '2026-09-24' },
      { link: 'https://energy.example/award' }, { link: 'http://energy.example/unsafe' },
      { link: 'https://user:secret@energy.example/unsafe' }, null
    ] });
  } })({ query: 'official energy projects' });
  assert.equal(request.url, 'https://api.minimaxi.com/v1/coding_plan/search');
  assert.equal(request.headers.Authorization, 'Bearer private-test-key');
  assert.equal(request.headers['x-api-key'], undefined);
  assert.deepEqual(JSON.parse(request.body), { q: 'official energy projects' });
  assert.equal(result.model, 'coding-plan-search');
  assert.equal(result.search_count, 1);
  assert.equal(result.usage, null);
  assert.deepEqual(result.results, [{ title: 'Official award', url: 'https://energy.example/award',
    excerpt: 'Evidence snippet', published_text: '2026-09-24' }]);
});

test('Coding Plan honors HTTP 200 business errors and distinguishes empty search from malformed data', async () => {
  for (const [status_code, code] of [[1008, 'discovery_balance_insufficient'], [1028, 'discovery_plan_unavailable'],
    [1030, 'discovery_plan_unavailable'], [2061, 'discovery_plan_unavailable'], [9999, 'discovery_unavailable']]) {
    await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () =>
      Response.json({ base_resp: { status_code, status_msg: 'private diagnostic' }, organic: [] }) })({ query: 'test' }), { code });
  }
  for (const payload of [null, {}, { organic: {} }]) {
    await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => Response.json(payload) })({ query: 'test' }),
      { code: 'discovery_unavailable' });
  }
  const empty = await createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => Response.json({ organic: [] }) })({ query: 'test' });
  assert.deepEqual(empty.results, []);
});
