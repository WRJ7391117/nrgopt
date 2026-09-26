const { failure } = require('./store.cjs');
const { DEFAULT_DISCOVERY_ENDPOINT } = require('./provider-config.cjs');

const DEFAULT_MODEL = 'coding-plan-search';

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
    const codingPlan = new URL(endpoint).pathname === '/v1/coding_plan/search';
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: codingPlan
          ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
          : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(codingPlan ? { q: query } : {
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
    // MiniMax can report a failed request inside an HTTP 200 response.
    const statusCode = Number(payload?.base_resp?.status_code || 0);
    if (statusCode === 1008) throw failure('discovery_balance_insufficient', 402);
    if ([1028, 1030, 2061].includes(statusCode)) throw failure('discovery_plan_unavailable', 402);
    if (statusCode) throw failure('discovery_unavailable', 502);
    if (codingPlan) {
      if (!Array.isArray(payload?.organic)) throw failure('discovery_unavailable', 502);
      const results = payload.organic.map(item => validResult({
        type: 'web_search_result', url: item?.link, title: item?.title,
        page_age: item?.date, content: item?.snippet
      })).filter(Boolean);
      const unique = new Map();
      for (const item of results) if (!unique.has(item.url)) unique.set(item.url, item);
      return {
        results: [...unique.values()].slice(0, 12),
        provider, model: 'coding-plan-search', search_count: 1, usage: null
      };
    }
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
