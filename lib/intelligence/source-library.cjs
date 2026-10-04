const { randomUUID, createHash } = require('node:crypto');
const { validateUrl } = require('./source.cjs');
const { registry } = require('./registry.cjs');
const { primaryHosts } = require('./discovery.cjs');
const regions = require('./regions.json');
const types = { government: '政府与监管', utility: '公用事业与系统运营', owner: '用能业主与开发商', supply: '项目供应链', procurement: '采购与法定披露', finance: '金融与投资', media: '新闻与行业媒体', research: '研究与公开作者', unknown: '待分类' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), { code, status: 400 }); };
const fixedTypes = { 'acwa-news': 'owner', 'pb-news': 'utility', 'nama-news': 'utility', 'ewa-news': 'utility', 'masdar-news': 'owner', 'qna-economy': 'media', 'kapp-news': 'government', 'tr-energy-news': 'government', 'masen-news': 'government', 'sonelgaz-news': 'utility', 'noc-news': 'owner', 'eehc-news': 'utility', 'anme-news': 'government', 'mauritania-energy-news': 'government', 'presstv-energy': 'media' };
function host(url) { return new URL(url).hostname.replace(/^www\./, ''); }
function defaults() {
  const entries = registry.map(e => ({ id: 'fixed:' + e.id, revision: 0, status: 'active', access: { status: 'unchecked' }, config: {
    name: e.name, url: e.url, scope: 'site', type: fixedTypes[e.id], countries: [e.country], languages: [], direction_ids: [], notes: '已有固定入口；所在地不代表全部报道范围。', priority: 'normal', mode: 'fixed'
  } }));
  for (const [country, hosts] of Object.entries(primaryHosts)) for (const domain of hosts) {
    const found = entries.find(e => host(e.config.url) === domain.replace(/^www\./, ''));
    if (found) { if (!found.config.countries.includes(country)) found.config.countries.push(country); continue; }
    entries.push({ id: 'reference:' + domain, revision: 0, status: 'candidate', access: { status: 'unchecked' }, config: {
      name: domain, url: 'https://' + domain + '/', scope: 'site', type: 'unknown', countries: [country], languages: [], direction_ids: [], notes: '既有发布者参考，身份分类与入口尚待确认。', priority: 'normal', mode: 'search'
    } });
  }
  return entries.map(e=>({...e,config:{...e.config,scope_key:scopeKey(e)}}));
}
function scopeKey(e) {
  const u=new URL(e.config.url);return host(u)+(e.config.scope==='site'?'':u.pathname.replace(/\/$/,''));
}
function validateEntry(body) {
  if (!body || !Number.isInteger(body.revision) || body.revision < 0 || !['candidate','active','paused','removed'].includes(body.status)) fail('invalid_request');
  const id = body.id || randomUUID();
  const seed = defaults().find(e => e.id === id);
  if (!seed && !uuid.test(id)) fail('invalid_request');
  const c = body.config;
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('invalid_request');
  for (const [key, min, max] of [['name',1,120],['url',1,2048],['notes',0,600]]) if (typeof c[key] !== 'string' || c[key].trim().length < min || c[key].length > max) fail('invalid_request');
  const url = validateUrl(c.url.trim());
  if (url.search || !/^[\w.-]+$/.test(url.hostname) || !['site','path'].includes(c.scope) || !Object.hasOwn(types,c.type) || !['high','normal','low'].includes(c.priority)) fail('invalid_request');
  if (c.scope === 'site') url.pathname = '/';
  // Fixed adapters keep their verified entry URL and scope. Their metadata is editable.
  if (seed?.config.mode === 'fixed' && (c.url !== seed.config.url || c.scope !== seed.config.scope)) fail('invalid_request');
  if (!Array.isArray(c.countries) || c.countries.length < 1 || c.countries.length > 24 || c.countries.some(code => !regions.countries.some(r => r.code === code))) fail('invalid_request');
  if (!Array.isArray(c.languages) || c.languages.length > 10 || c.languages.some(l => !['ar','en','zh','fr','tr','fa','he','other'].includes(l))) fail('invalid_request');
  if (!Array.isArray(c.direction_ids) || c.direction_ids.length > 20 || c.direction_ids.some(d => !uuid.test(d))) fail('invalid_request');
  const value = { id, revision: body.revision, status: body.status, config: { name:c.name.trim(), url:seed?.config.mode==='fixed'?seed.config.url:url.href, scope:c.scope, type:c.type, countries:[...new Set(c.countries)], languages:[...new Set(c.languages)], direction_ids:[...new Set(c.direction_ids)], notes:c.notes.trim(), priority:c.priority, mode:seed?.config.mode==='fixed'?'fixed':'search' } };
  value.config.scope_key=scopeKey(value);return value;
}
function matches(entry, url) {
  try {
    const source = new URL(url), base = new URL(entry.config.url);
    if (host(source) !== host(base)) return false;
    const p = base.pathname.replace(/\/$/, '');
    return entry.config.scope === 'site' || source.pathname === p || source.pathname.startsWith(p + '/');
  } catch { return false; }
}
async function checkEntry(entry, fetchSource, recentSources = [], day = null) {
  const checked_at = new Date().toISOString();
  const firstDay = day ? new Date(Date.parse(day + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0,10) : null;
  const current = new Map();
  for (const source of recentSources) {
    const url = source.final_url || source.requested_url;
    if (url && !current.has(url)) current.set(url, source);
  }
  try {
    const source = await fetchSource(entry.config.url);
    if (!matches(entry, source.finalUrl)) fail('registry_redirect_host');
    if (!source.excerpt?.trim()) fail('source_empty_document');
    const sample = day && [...current.values()].find(s => matches(entry, s.final_url || s.requested_url)
      && s.publication_date >= firstDay && s.publication_date <= day
      && s.publication_method && s.publication_method !== 'conflicting_metadata'
      && s.extraction_status === 'extracted' && /^[a-f0-9]{64}$/.test(s.content_sha256 || '')
      && s.extraction_source_sha256 === s.content_sha256);
    return { status:'readable', checked_at, final_url:source.finalUrl,
      sha256:source.sha256 || createHash('sha256').update(source.bytes).digest('hex'), title:source.title,
      review:day ? sample ? 'recent_validated_source' : 'recent_source_missing' : 'entry_only',
      ...(sample ? { sample_id:sample.id, sample_date:sample.publication_date } : {}),
      note:'入口可读不代表身份、文章日期或持续产出；近期样本须另有匹配当前原件哈希的有效分析。' };
  } catch(error) {
    return { status:'failed', checked_at, review:'entry_unreadable', error_code:/^(source|registry)_[a-z_]+$/.test(error.code||'')?error.code:'source_failed' };
  }
}
function selectChannel(entries, country, direction, day) {
  // Alternate unrestricted discovery with a targeted channel, inside the same country query slot.
  const n = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
  if (n % 2 === 0) return null;
  const matchesPlan = e => !e.host_paused && e.config.mode === 'search' && e.access.status === 'readable' && e.config.countries.includes(country)
    && (!e.config.direction_ids.length || e.config.direction_ids.includes(direction?.id));
  const trials = n % 4 === 1 ? entries.filter(e => e.id.startsWith('reference:') && e.status === 'candidate' && matchesPlan(e)) : [];
  const eligible = (trials.length ? trials : entries.filter(e => e.status === 'active' && matchesPlan(e))).sort((a,b) => a.id.localeCompare(b.id));
  const weighted = eligible.flatMap(e => Array(({ high:3,normal:2,low:1 })[e.config.priority]).fill(e));
  const core=regions.countries.filter(r=>r.group==='gcc').map(r=>r.code);
  const cycle=Object.keys(primaryHosts).filter(code=>!core.includes(code)).length;
  const turn=core.includes(country)?Math.floor(n/2):Math.floor(n/cycle);
  const e = weighted[turn % weighted.length];
  return e ? { id:e.id, revision:e.revision, name:e.config.name, url:e.config.url, scope:e.config.scope, ...(trials.length ? { trial:true } : {}) } : null;
}
module.exports = { scopeKey, types, defaults, validateEntry, matches, checkEntry, selectChannel };
