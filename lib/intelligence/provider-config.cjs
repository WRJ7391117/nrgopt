const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const DEFAULT_DISCOVERY_ENDPOINT = 'https://api.minimaxi.com/anthropic/v1/messages';
const DEFAULT_ANALYSIS_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const failure = (code, status = 503) => Object.assign(new Error(code), { code, status });

function text(value, fallback, max = 160) {
  if (value == null || String(value).trim() === '') return fallback;
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= max ? result : null;
}

function provider(value, fallback) {
  const configured = text(value, fallback, 64);
  if (!configured) return null;
  const result = configured.toLowerCase();
  return /^[a-z0-9][a-z0-9._-]*$/.test(result) ? result : null;
}

function currency(value, fallback = 'CNY') {
  if (value == null || String(value).trim() === '') return fallback;
  const result = String(value).trim().toUpperCase();
  return ['CNY', 'USD'].includes(result) ? result : null;
}

function endpoint(value, fallback) {
  const candidate = text(value, fallback, 500);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function secret(value, fallback) {
  const selected = typeof value === 'string' && value.trim() ? value : fallback;
  return typeof selected === 'string' && selected.trim() && selected.length <= 8192 ? selected.trim() : null;
}

const configured = value => typeof value === 'string' && value.trim() !== '';
const reserve = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function providerSettings(env = process.env) {
  const customDiscovery = ['NRGOPT_DISCOVERY_PROVIDER', 'NRGOPT_DISCOVERY_ENDPOINT', 'NRGOPT_DISCOVERY_MODEL', 'NRGOPT_DISCOVERY_CURRENCY']
    .some(key => configured(env[key]));
  const customAnalysis = ['NRGOPT_ANALYSIS_PROVIDER', 'NRGOPT_ANALYSIS_ENDPOINT', 'NRGOPT_ANALYSIS_MODEL', 'NRGOPT_ANALYSIS_CURRENCY']
    .some(key => configured(env[key]));
  const discoveryReserveKey = customDiscovery || configured(env.NRGOPT_DISCOVERY_RESERVE_MICRO)
    ? 'NRGOPT_DISCOVERY_RESERVE_MICRO' : 'NRGOPT_MINIMAX_DISCOVERY_RESERVE_MICROCNY';
  const analysisReserveKey = customAnalysis || configured(env.NRGOPT_ANALYSIS_RESERVE_MICRO)
    ? 'NRGOPT_ANALYSIS_RESERVE_MICRO' : 'NRGOPT_DEEPSEEK_EXTRACTION_RESERVE_MICROCNY';
  const crossCheckReserveKey = customAnalysis || configured(env.NRGOPT_CROSS_CHECK_RESERVE_MICRO)
    ? 'NRGOPT_CROSS_CHECK_RESERVE_MICRO' : 'NRGOPT_DEEPSEEK_CROSS_CHECK_RESERVE_MICROCNY';
  return {
    discovery: {
      apiKey: secret(env.NRGOPT_DISCOVERY_API_KEY, customDiscovery ? null : env.MINIMAX_API_KEY),
      endpoint: endpoint(env.NRGOPT_DISCOVERY_ENDPOINT, customDiscovery ? null : DEFAULT_DISCOVERY_ENDPOINT),
      model: text(env.NRGOPT_DISCOVERY_MODEL, customDiscovery ? null : 'MiniMax-M3'),
      provider: provider(env.NRGOPT_DISCOVERY_PROVIDER, customDiscovery ? null : 'minimax'),
      currency: currency(env.NRGOPT_DISCOVERY_CURRENCY, customDiscovery ? null : 'CNY'),
      reserveKey: discoveryReserveKey,
    },
    analysis: {
      apiKey: secret(env.NRGOPT_ANALYSIS_API_KEY, customAnalysis ? null : env.DEEPSEEK_API_KEY),
      endpoint: endpoint(env.NRGOPT_ANALYSIS_ENDPOINT, customAnalysis ? null : DEFAULT_ANALYSIS_ENDPOINT),
      model: text(env.NRGOPT_ANALYSIS_MODEL, customAnalysis ? null : 'deepseek-flash'),
      provider: provider(env.NRGOPT_ANALYSIS_PROVIDER, customAnalysis ? null : 'deepseek'),
      currency: currency(env.NRGOPT_ANALYSIS_CURRENCY, customAnalysis ? null : 'CNY'),
      reserveKey: analysisReserveKey,
      crossCheckReserveKey,
    },
  };
}

function encryptionKey(env) {
  const encoded = typeof env.NRGOPT_PROVIDER_CONFIG_KEY === 'string' ? env.NRGOPT_PROVIDER_CONFIG_KEY.trim() : '';
  let key;
  try { key = Buffer.from(encoded, 'base64'); } catch { /* handled below */ }
  if (!encoded || key?.length !== 32) throw failure('provider_config_not_configured');
  return key;
}

function additionalData(owner, capability) {
  return Buffer.from(`nrgopt-provider-config:v1:${owner}:${capability}`, 'utf8');
}

function encryptApiKey(apiKey, env, owner, capability) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(additionalData(owner, capability));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptApiKey(envelope, env, owner, capability) {
  try {
    const [version, iv, tag, ciphertext, extra] = String(envelope || '').split('.');
    if (version !== 'v1' || extra !== undefined) throw new Error('invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(iv, 'base64url'));
    decipher.setAAD(additionalData(owner, capability));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error?.code === 'provider_config_not_configured') throw error;
    throw failure('provider_config_not_configured');
  }
}

function validateProviderInput(capability, input) {
  if (!['discovery', 'analysis'].includes(capability) || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw failure('invalid_request', 400);
  }
  const result = {
    capability,
    provider: provider(input.provider, null),
    endpoint: endpoint(input.endpoint, null),
    model: text(input.model, null, 160),
    currency: currency(input.currency, null),
    reserve_micro: reserve(input.reserve_micro),
    cross_check_reserve_micro: capability === 'analysis' ? reserve(input.cross_check_reserve_micro) : null,
    api_key: secret(input.api_key, null),
  };
  if (!result.provider || !result.endpoint || !result.model || !result.currency || !result.reserve_micro
      || (capability === 'analysis' && !result.cross_check_reserve_micro)) throw failure('invalid_request', 400);
  return result;
}

function providerConfigRecord({ env, owner, capability, input, existing = null }) {
  const value = validateProviderInput(capability, input);
  let apiKeyCiphertext = existing?.api_key_ciphertext || null;
  if (value.api_key) apiKeyCiphertext = encryptApiKey(value.api_key, env, owner, capability);
  else if (apiKeyCiphertext) decryptApiKey(apiKeyCiphertext, env, owner, capability);
  if (!apiKeyCiphertext) throw failure('provider_api_key_required', 422);
  return {
    owner_id: owner,
    capability,
    provider: value.provider,
    endpoint: value.endpoint,
    model: value.model,
    currency: value.currency,
    reserve_micro: value.reserve_micro,
    cross_check_reserve_micro: value.cross_check_reserve_micro,
    api_key_ciphertext: apiKeyCiphertext,
    updated_at: new Date().toISOString(),
  };
}

function savedRow(rows, capability) {
  return (Array.isArray(rows) ? rows : []).find(row => row?.capability === capability) || null;
}

function providerSettingsWithSaved(env, rows, owner) {
  const settings = providerSettings(env);
  for (const capability of ['discovery', 'analysis']) {
    const row = savedRow(rows, capability);
    if (!row) continue;
    const configuredProfile = {
      apiKey: decryptApiKey(row.api_key_ciphertext, env, owner, capability),
      endpoint: endpoint(row.endpoint, null),
      model: text(row.model, null, 160),
      provider: provider(row.provider, null),
      currency: currency(row.currency, null),
      reserveKey: null,
      reserveMicro: reserve(row.reserve_micro),
    };
    if (capability === 'analysis') {
      configuredProfile.crossCheckReserveKey = null;
      configuredProfile.crossCheckReserveMicro = reserve(row.cross_check_reserve_micro);
    }
    settings[capability] = configuredProfile;
  }
  return settings;
}

async function providerSettingsForOwner(env, store, owner) {
  return providerSettingsWithSaved(env, await store.providerConfigs(owner), owner);
}

function publicProviderSettings(env, rows) {
  const settings = providerSettings(env);
  return ['discovery', 'analysis'].map(capability => {
    const row = savedRow(rows, capability);
    const current = settings[capability];
    return {
      capability,
      provider: row?.provider || current.provider,
      endpoint: row?.endpoint || current.endpoint,
      model: row?.model || current.model,
      currency: row?.currency || current.currency,
      reserve_micro: row?.reserve_micro || reserve(env[current.reserveKey]),
      cross_check_reserve_micro: capability === 'analysis'
        ? (row?.cross_check_reserve_micro || reserve(env[current.crossCheckReserveKey])) : null,
      key_configured: Boolean(row?.api_key_ciphertext || current.apiKey),
      key_source: row?.api_key_ciphertext ? 'saved' : current.apiKey ? 'environment' : 'none',
      updated_at: row?.updated_at || null,
    };
  });
}

module.exports = {
  DEFAULT_DISCOVERY_ENDPOINT, DEFAULT_ANALYSIS_ENDPOINT, providerSettings, providerSettingsWithSaved,
  providerSettingsForOwner, publicProviderSettings, providerConfigRecord, validateProviderInput,
  encryptApiKey, decryptApiKey,
};
