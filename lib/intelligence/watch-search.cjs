const { countries, primaryHosts, primarySource } = require('./discovery.cjs');
const { createMiniMaxDiscoverer } = require('./minimax.cjs');

const WINDOW_DAYS = 90;
const DAILY_GROUPS = 5;
const active = h => ['open', 'strengthened', 'weakened'].includes(h.status);
const expiresAt = h => h.review_due_at || new Date(Date.parse(h.created_at) + WINDOW_DAYS * 86400000).toISOString();
const words = (value, limit) => String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

function watchSearchPlan(targets, scheduleKey) {
  const day = Date.parse(scheduleKey + 'T00:00:00Z');
  if (!Number.isFinite(day)) return [];
  const groups = new Map();
  for (const target of [...targets].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a.id.localeCompare(b.id))) {
    if (!active(target) || !Number.isFinite(Date.parse(target.created_at)) || Date.parse(expiresAt(target)) <= day) continue;
    const country = target.candidate.occurrence_countries?.find(code => countries[code]);
    if (!country || !target.source_url || !target.source_title) continue;
    const key = target.source_url;
    if (!groups.has(key)) groups.set(key, { country, source_id: target.candidate.source_id, candidate: target.candidate, hypotheses: [], source_url: key, source_title: target.source_title });
    const group = groups.get(key);
    if (group.source_id === target.candidate.source_id && group.hypotheses.length < 4) group.hypotheses.push(target);
  }
  const pool = [...groups.values()].sort((a, b) => a.source_url.localeCompare(b.source_url));
  if (!pool.length) return [];
  const offset = (Math.floor(day / 86400000) * DAILY_GROUPS) % pool.length;
  const selected = Array.from({ length: Math.min(DAILY_GROUPS, pool.length) }, (_, n) => pool[(offset + n) % pool.length]);
  return selected.flatMap((group, index) => {
    const project = words(group.candidate.project_zh?.name_zh || group.candidate.title_zh, 140);
    // Search only the public page title; internal hypotheses and notes stay in the database.
    const base = `${countries[group.country]} ${words(group.source_title, 180)}`;
    const sites = '(' + primaryHosts[group.country].map(host => 'site:' + host).join(' OR ') + ')';
    return ['support', 'counter'].map((intent, side) => {
      const terms = intent === 'support' ? '(tender OR award OR financing OR construction OR commissioning)'
        : '(cancelled OR suspended OR delayed OR terminated OR 取消 OR 延期 OR إلغاء OR تأجيل)';
      return { item_key: `watchsearch:${index * 2 + side}`, checkpoint: {
        country: group.country, intent, object_zh: project, query: `${base} ${terms} ${sites}`,
        source_id: group.source_id, hypothesis_ids: group.hypotheses.map(h => h.id),
        expires_at: group.hypotheses.map(expiresAt).sort()[0]
      } };
    });
  });
}

async function discoverWatch(plan, profile, discoveryFactory = createMiniMaxDiscoverer) {
  const result = await discoveryFactory(profile)({ query: plan.query });
  const sources = result.results.filter(item => {
    try { return primarySource(item.url, plan.country); } catch { return false; }
  }).map(item => ({ ...item, source_level: 'primary' }));
  // No result is an observation, not evidence against the hypothesis and not a retryable failure.
  return { ...result, results: undefined, sources };
}

module.exports = { watchSearchPlan, discoverWatch, expiresAt, active, WINDOW_DAYS, DAILY_GROUPS };
