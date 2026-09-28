const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveConfig, publicConfig, configRecord, checkCredentials } = require('../lib/intelligence/feishu-config.cjs');
const env = { NRGOPT_PROVIDER_CONFIG_KEY: Buffer.alloc(32, 7).toString('base64'), NRGOPT_FEISHU_ENABLED: '1',
  FEISHU_APP_ID: 'cli_example_app', FEISHU_APP_SECRET: 'private-secret-value', FEISHU_CHAT_ID: 'oc_example_chat', FEISHU_USER_OPEN_ID: 'ou_example_user' };
const current = effectiveConfig(null, env, 'owner');
const input = { ...publicConfig(current), app_secret: '' };
test('Feishu config adopts existing credentials encrypted, blank retains, API never reveals secrets', () => {
  const record = configRecord(input, current, env, 'owner');
  assert.ok(!JSON.stringify(record).includes(env.FEISHU_APP_SECRET));
  const resolved = effectiveConfig({ ...record, revision: 1 }, env, 'owner');
  assert.equal(resolved.app_secret, env.FEISHU_APP_SECRET);
  assert.equal(publicConfig(resolved).secret_configured, true);
  assert.ok(!JSON.stringify(publicConfig(resolved)).includes(env.FEISHU_APP_SECRET));
  assert.ok(!JSON.stringify(publicConfig(resolved)).includes('ciphertext'));
  assert.throws(() => effectiveConfig({ ...record, revision: 1 }, env, 'other-owner'));
  const disabled = effectiveConfig({ ...record, enabled: false }, env, 'owner');
  assert.equal(disabled.enabled, false, 'database pause overrides enabled environment');
});
test('Feishu config requires matching new secret and selected recipient IDs', () => {
  assert.throws(() => configRecord({ ...input, app_id: 'cli_other_app' }, current, env, 'owner'));
  for (const patch of [{ send_chat: false, send_user: false }, { chat_id: '' }, { send_chat: false, chat_id: '', user_open_id: '' }, { app_secret: 12 }])
    assert.throws(() => configRecord({ ...input, ...patch }, current, env, 'owner'));
  assert.equal(configRecord({ ...input, user_open_id: '' }, current, env, 'owner').user_open_id, '', 'legacy group owner resolution retained');
  assert.equal(configRecord({ ...input, send_chat: false, chat_id: '' }, current, env, 'owner').send_chat, false);
  assert.equal(configRecord({ ...input, enabled: false, send_chat: false, send_user: false }, current, env, 'owner').enabled, false);
});
test('credential check uses only the official token endpoint and never sends a message or returns token', async () => {
  let calls = 0;
  const result = await checkCredentials(current, async (url, init) => {
    calls++; assert.equal(url, 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    assert.equal(init.redirect, 'error'); return Response.json({ code: 0, tenant_access_token: 'private-token' });
  });
  assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes('private-token'));
  await assert.rejects(checkCredentials(current, async () => Response.json({ code: 999 })), { code: 'feishu_auth_failed' });
});
