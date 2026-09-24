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

const { runPaidCall } = require('../lib/intelligence/budget.cjs');

test('calls bind the captured version and retain only provider numeric usage, without fees or secrets', async () => {
  const records = [];
  const store = {
    reserveBudget: async () => 'reservation',
    startProviderCall: async (...args) => { records.push(args); return true; },
    finishProviderCall: async (...args) => { records.push(args); return true; },
    releaseBudget: async () => true
  };
  await runPaidCall({ store, owner: 'owner', operation: 'discovery', currency: 'CNY', budgetLimitMicro: 10000000,
    billingMode: 'included', profile: { configVersionId: 'version-a', apiKey: 'secret' },
    call: async () => ({ usage: { input_tokens: 10, output_tokens: 2, api_key: 'secret', cost: 2, prompt_tokens: -1 } }) });
  assert.deepEqual(records, [['owner', 'reservation', 'version-a'],
    ['owner', 'reservation', null, { input_tokens: 10, output_tokens: 2 }]]);
});

test('replayed or changed-version calls never dispatch or release another running call reservation', async () => {
  for (const billingMode of ['included', 'balance']) {
    let calls = 0, releases = 0;
    const store = { reserveBudget: async () => 'reservation', startProviderCall: async () => false,
      syncProviderBalance: async () => true, releaseBudget: async () => { releases++; } };
    await assert.rejects(runPaidCall({ store, owner: 'owner', operation: 'extraction', currency: 'CNY',
      budgetLimitMicro: 10000000, billingMode, readBalance: async () => 10000000,
      profile: { configVersionId: 'stale' }, call: async () => { calls++; } }), { code: 'provider_call_not_started' });
    assert.equal(calls, 0); assert.equal(releases, 0);
  }
});

test('failed calls record a bounded error code and keep raw provider errors out of history', async () => {
  let record;
  const store = { reserveBudget: async () => 'reservation', startProviderCall: async () => true,
    finishProviderCall: async (...args) => { record = args; return true; }, releaseBudget: async () => true };
  await assert.rejects(runPaidCall({ store, owner: 'owner', operation: 'extraction', currency: 'CNY',
    budgetLimitMicro: 10000000, billingMode: 'included',
    call: async () => { throw Object.assign(new Error('private upstream response'), { code: 'Bearer secret' }); } }));
  assert.deepEqual(record, ['owner', 'reservation', 'provider_call_failed', null]);
});
