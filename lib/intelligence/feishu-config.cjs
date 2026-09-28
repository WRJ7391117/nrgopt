const { encryptApiKey, decryptApiKey } = require('./provider-config.cjs');
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const flags = ['enabled', 'send_chat', 'send_user', 'daily_enabled', 'flash_enabled', 'system_enabled'];

function effectiveConfig(row, env, owner) {
  if (!row) return { revision: 0, managed: false, enabled: env.NRGOPT_FEISHU_ENABLED === '1',
    app_id: env.FEISHU_APP_ID || '', app_secret: env.FEISHU_APP_SECRET || '', chat_id: env.FEISHU_CHAT_ID || '',
    user_open_id: env.FEISHU_USER_OPEN_ID || '', webhook_url: env.FEISHU_WEBHOOK_URL || '',
    send_chat: true, send_user: true, daily_enabled: true, flash_enabled: true, system_enabled: true };
  return { ...row, managed: true, app_secret: row.secret_ciphertext ? decryptApiKey(row.secret_ciphertext, env, owner, 'feishu-app') : '', webhook_url: '' };
}
function publicConfig(config) {
  return { revision: config.revision, managed: config.managed, app_id: config.app_id, chat_id: config.chat_id,
    user_open_id: config.user_open_id, secret_configured: Boolean(config.app_secret), legacy_webhook: Boolean(config.webhook_url),
    ...Object.fromEntries(flags.map(k => [k, config[k]])), updated_at: config.updated_at || null };
}
function configRecord(value, existing, env, owner) {
  if (!Number.isInteger(value.revision) || value.revision < 0 || flags.some(k => typeof value[k] !== 'boolean')) throw failure('invalid_request');
  const clean = (key, pattern) => {
    if (typeof value[key] !== 'string' || (value[key] && !pattern.test(value[key].trim()))) throw failure('invalid_request');
    return value[key].trim();
  };
  const record = { ...Object.fromEntries(flags.map(k => [k, value[k]])),
    app_id: clean('app_id', /^[A-Za-z0-9_-]{6,200}$/), chat_id: clean('chat_id', /^oc_[A-Za-z0-9_-]{8,200}$/),
    user_open_id: clean('user_open_id', /^ou_[A-Za-z0-9_-]{8,200}$/) };
  if (typeof value.app_secret !== 'string' || value.app_secret.length > 500) throw failure('invalid_request');
  const secret = value.app_secret.trim() || (record.app_id === existing.app_id ? existing.app_secret : '');
  if (secret && secret.length < 8) throw failure('invalid_request');
  if (record.app_id !== existing.app_id && !value.app_secret.trim() && record.app_id) throw failure('feishu_secret_required');
  if (record.enabled && (!record.app_id || !secret || (!record.send_chat && !record.send_user)
    || (record.send_chat && !record.chat_id) || (record.send_user && !record.user_open_id && !record.chat_id))) throw failure('feishu_config_incomplete');
  record.secret_ciphertext = secret ? encryptApiKey(secret, env, owner, 'feishu-app') : null;
  return record;
}
function senderOptions(config) {
  return { webhookUrl: config.webhook_url, appId: config.app_id, appSecret: config.app_secret,
    chatId: config.chat_id, userOpenId: config.user_open_id, sendChat: config.send_chat, sendUser: config.send_user };
}
async function checkCredentials(config, fetchImpl = global.fetch) {
  if (!config.app_id || !config.app_secret) throw failure('feishu_config_incomplete');
  try {
    const r = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.app_id, app_secret: config.app_secret }) });
    const body = r.ok ? await r.json() : null;
    if (body?.code !== 0 || typeof body.tenant_access_token !== 'string') throw Error('invalid');
    return { checked_at: new Date().toISOString(), message: '机器人凭据有效。此检查没有发送消息，也不代表接收目标或消息权限已验证。' };
  } catch { throw failure('feishu_auth_failed', 502); }
}
module.exports = { effectiveConfig, publicConfig, configRecord, senderOptions, checkCredentials };
