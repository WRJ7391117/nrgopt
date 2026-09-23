const test = require('node:test');
const assert = require('node:assert/strict');
const { createMiniMaxDiscoverer, validResult } = require('../lib/intelligence/minimax.cjs');

test('MiniMax discovery returns only unique safe HTTPS source results', async () => {
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
  const discovery = await createMiniMaxDiscoverer({ apiKey: 'private-test-key', fetchImpl })({ query: 'official projects' });
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
  await assert.rejects(createMiniMaxDiscoverer({ apiKey: 'key', fetchImpl: async () => new Response(JSON.stringify({ content: [] }), { status: 200 }) })({ query: 'test' }), { code: 'discovery_unavailable' });
  assert.equal(validResult({ type: 'web_search_result', url: 'https://user:secret@example.com' }), null);
});
