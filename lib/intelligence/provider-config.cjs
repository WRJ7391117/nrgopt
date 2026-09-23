const DEFAULT_DISCOVERY_ENDPOINT = 'https://api.minimaxi.com/anthropic/v1/messages';
const DEFAULT_ANALYSIS_ENDPOINT = 'https://api.deepseek.com/chat/completions';

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

module.exports = { DEFAULT_DISCOVERY_ENDPOINT, DEFAULT_ANALYSIS_ENDPOINT, providerSettings };
