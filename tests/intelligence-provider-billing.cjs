const test = require('node:test');
const assert = require('node:assert/strict');
const { microAmount, createProviderBalanceReader } = require('../lib/intelligence/provider-billing.cjs');

test('provider decimal balances convert to micro-units without floating point rounding', () => {
  assert.equal(microAmount('12.345678'), 12_345_678);
  assert.equal(microAmount('0.02'), 20_000);
  assert.equal(microAmount('1.1234567'), null);
});

test('DeepSeek billing reads the official account balance endpoint', async () => {
  let request;
  const reader = createProviderBalanceReader({ billingMode: 'balance', provider: 'deepseek', apiKey: 'private-key',
    endpoint: 'https://api.deepseek.com/chat/completions' }, async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '8.98' }] }));
  });
  assert.equal(await reader('CNY'), 8_980_000);
  assert.equal(request.url, 'https://api.deepseek.com/user/balance');
  assert.equal(request.init.headers.Authorization, 'Bearer private-key');
});

test('included plans and providers without an official balance adapter do not invent a reader', () => {
  assert.equal(createProviderBalanceReader({ billingMode: 'included', provider: 'minimax' }), null);
  assert.equal(createProviderBalanceReader({ billingMode: 'balance', provider: 'custom', apiKey: 'key', endpoint: 'https://example.com/v1' }), null);
});
