const { failure } = require('./store.cjs');
const { DEFAULT_DISCOVERY_ENDPOINT } = require('./provider-config.cjs');

const DEFAULT_MODEL = 'MiniMax-M3';

function validResult(value) {
  if (!value || value.type !== 'web_search_result' || typeof value.url !== 'string') return null;
  let url;
  try { url = new URL(value.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return {
    title: String(value.title || url.hostname).replace(/\s+/g, ' ').trim().slice(0, 300),
    url: url.href,
    published_text: typeof value.page_age === 'string' ? value.page_age.slice(0, 80) : null,
    excerpt: String(value.content || '').replace(/\s+/g, ' ').trim().slice(0, 600)
  };
}

function createMiniMaxDiscoverer({ apiKey, endpoint = DEFAULT_DISCOVERY_ENDPOINT, model = DEFAULT_MODEL,
  provider = 'minimax', fetchImpl = global.fetch } = {}) {
  return async function discover({ query }) {
    if (!apiKey || !endpoint || !model || !provider) throw failure('discovery_not_configured', 503);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 2048,
          system: '你是能源情报来源发现助手。只搜索并返回政府、监管机构、业主、采购方或项目公司的原始发布页面。不要把搜索摘要当作最终事实。',
          messages: [{ role: 'user', content: query }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        })
      });
    } catch { throw failure('discovery_unavailable', 502); }
    if ([401, 403].includes(response.status)) throw failure('discovery_auth_failed', 502);
    if (response.status === 402) throw failure('discovery_balance_insufficient', 402);
    if (!response.ok) throw failure('discovery_unavailable', 502);
    let payload;
    try { payload = await response.json(); } catch { throw failure('discovery_unavailable', 502); }
    const results = [];
    const seen = new Set();
    let searchCount = 0;
    for (const block of Array.isArray(payload.content) ? payload.content : []) {
      if (block?.type === 'server_tool_use' && block.name === 'web_search') searchCount += 1;
      if (block?.type !== 'web_search_tool_result') continue;
      if (!searchCount) searchCount = 1;
      for (const item of Array.isArray(block.content) ? block.content : []) {
        const result = validResult(item);
        if (result && !seen.has(result.url)) { seen.add(result.url); results.push(result); }
      }
    }
    if (!results.length) throw failure('discovery_unavailable', 502);
    return {
      results: results.slice(0, 12), provider, model: payload.model || model, search_count: searchCount,
      usage: {
        input_tokens: Number(payload.usage?.input_tokens) || 0,
        output_tokens: Number(payload.usage?.output_tokens) || 0,
        cache_creation_input_tokens: Number(payload.usage?.cache_creation_input_tokens) || 0,
        cache_read_input_tokens: Number(payload.usage?.cache_read_input_tokens) || 0
      }
    };
  };
}

module.exports = { createMiniMaxDiscoverer, validResult, DEFAULT_MODEL };
