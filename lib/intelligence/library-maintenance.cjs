const { createHash } = require('node:crypto');
const cheerio = require('cheerio');
const library = require('./source-library.cjs');
const { latestSources, validRecentSource } = require('./library-summary.cjs');

const WEEK = 7 * 86400000;
function canonicalUrl(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.search || url.username || url.password) return null;
    url.hostname = url.hostname.replace(/^www\./, ''); url.hash = ''; return url; } catch { return null; }
}
function automaticProposal(suggestion, directions, now = new Date()) {
  const groups = new Map(), unique = new Map(), hashes = new Set();
  for (const source of suggestion.samples || []) {
    const url = canonicalUrl(source.final_url); if (!url) continue;
    if (!/^[a-f0-9]{64}$/.test(source.content_sha256 || '') || hashes.has(source.content_sha256)) continue;
    hashes.add(source.content_sha256);
    unique.set(url.href, source);
  }
  for (const [href, source] of unique) {
    const url = new URL(href), parent = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    if (parent === '/' || !parent) continue;
    const key = url.origin + parent;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  const group = [...groups].filter(([, sources]) => sources.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  const samples = group ? group[1] : [...unique.values()].slice(0, 1);
  if (!samples.length) return null;
  const url = group ? group[0] : canonicalUrl(samples[0].final_url).href;
  const countries = [...new Set(samples.flatMap(source => source.countries || []))];
  const related = directions.filter(direction => direction.config.enabled && direction.config.countries.some(country => countries.includes(country)));
  if (!related.length) return null;
  const config = { name: suggestion.name, url, scope: 'path', type: 'unknown', countries: countries.filter(country => related.some(direction => direction.config.countries.includes(country))),
    languages: [], direction_ids: related.map(direction => direction.id), notes: '由已取得的近期有效原文自动积累；来源身份与类别仍待确认。', priority: 'normal', mode: 'search' };
  const key = library.scopeKey({ config }), id = 'reference:auto:' + createHash('sha256').update(key).digest('hex');
  let entry;
  try { entry = library.validateEntry({ id, revision: 0, status: 'candidate', config }); } catch { return null; }
  entry.access = { status: 'unchecked', managed_by: 'automatic', origin: 'discovered_sources', auto_scope_key: key,
    source_sample_ids: samples.map(source => source.id), source_sample_urls: samples.map(source => canonicalUrl(source.final_url).href),
    scope_verified: false, scope_confirmation_needed: !group, reason: group ? 'scope_unverified' : 'scope_confirmation_needed', discovered_at: now.toISOString() };
  entry.updated_at = now.toISOString();
  return entry;
}
function listingProof(entry, source, samples) {
  if (!source?.bytes || !source.finalUrl || entry.config.scope !== 'path' || !library.matches(entry, source.finalUrl)) return false;
  const target = canonicalUrl(entry.config.url), final = canonicalUrl(source.finalUrl);
  if (!target || !final || target.href.replace(/\/$/, '') !== final.href.replace(/\/$/, '')) return false;
  const originals = new Set(samples.map(sample => canonicalUrl(sample.final_url || sample.requested_url)?.href).filter(Boolean));
  const linked = new Set(), $ = cheerio.load(source.bytes);
  $('a[href]').each((_, element) => {
    try { const url = canonicalUrl(new URL($(element).attr('href'), source.finalUrl).href);
      if (url && library.matches(entry, url.href) && originals.has(url.href)) linked.add(url.href);
    } catch { /* Malformed links do not prove an article listing. */ }
  });
  return linked.size >= 2;
}
function isManaged(entry) {
  return entry.id.startsWith('reference:') && entry.access?.managed_by !== 'user'
    && (!library.automaticId.test(entry.id) || entry.access?.managed_by === 'automatic' && entry.access.auto_scope_key === library.scopeKey(entry));
}
function blocked(entry, entries) {
  return entry.host_paused || ['paused', 'removed'].includes(entry.status)
    || entries.some(other => other.id !== entry.id && ['paused', 'removed'].includes(other.status) && library.matches(other, entry.config.url));
}
async function maintainLibrary({ store, owner, day, fetchSource, now = new Date() }) {
  const directionsRead = store.directionList(owner), overview = await store.libraryOverview(owner, directionsRead), directions = await directionsRead;
  const entries = overview.entries;
  const proposals = (overview.suggestions || []).map(suggestion => automaticProposal(suggestion, directions, now)).filter(Boolean)
    .filter(entry => !entries.some(other => other.id === entry.id || library.scopeKey(other) === library.scopeKey(entry)) && !blocked(entry, entries));
  const dueAt = entry => {
    const checked = Date.parse(entry.access?.checked_at);
    return Number.isFinite(checked) ? checked + WEEK : Date.parse(entry.access?.discovered_at || entry.updated_at) || now.getTime();
  };
  const candidates = entries.concat(proposals).filter(entry => isManaged(entry) && !blocked(entry, entries) && !library.integratedBy(entry, entries)
    && (entry.status === 'candidate' || library.automaticId.test(entry.id) && entry.status === 'active') && dueAt(entry) <= now.getTime())
    .sort((a, b) => dueAt(a) - dueAt(b) || a.id.localeCompare(b.id));
  const outcomes = [];
  for (let entry of candidates) {
    if (outcomes.length >= 3) break;
    const reservation = await store.reserveLibraryCheck(owner, entry.id, day);
    if (reservation === 'limit') break;
    if (reservation === 'duplicate') continue;
    if (reservation !== 'reserved') throw Object.assign(new Error('upstream_unavailable'), { code: 'upstream_unavailable', status: 502 });
    try {
      if (!entry.revision) entry = await store.saveLibraryEntry(owner, entry, entry.access);
      const sources = await store.recentLibrarySources(owner, entry), hashes = new Set();
      const valid = latestSources(sources).filter(source => {
        if (!validRecentSource(source, day) || !library.matches(entry, source.final_url || source.requested_url) || hashes.has(source.content_sha256)) return false;
        hashes.add(source.content_sha256); return true;
      });
      let page;
      const checked = await library.checkEntry(entry, async url => { page = await fetchSource(url); return page; }, sources, day);
      const automatic = library.automaticId.test(entry.id);
      const proved = automatic && (entry.access.scope_verified === true || !entry.access.scope_confirmation_needed && listingProof(entry, page, valid));
      const failures = checked.status === 'failed' ? (entry.access.consecutive_failures || 0) + 1 : 0;
      let status = entry.status;
      if (automatic) {
        if (status === 'active') { if (failures >= 2) status = 'candidate'; }
        else if (checked.status === 'readable' && proved && valid.length >= 2) status = 'active';
      } else status = checked.status === 'readable' && checked.review === 'recent_validated_source' ? 'active' : 'candidate';
      const access = { ...entry.access, ...checked, checked_at: now.toISOString(), check_only: false, managed_by: 'automatic', origin: automatic ? 'discovered_sources' : 'reference',
        consecutive_failures: failures, ...(automatic ? { scope_verified: proved, scope_confirmation_needed: entry.access.scope_confirmation_needed && !proved,
          source_sample_ids: valid.map(source => source.id), source_sample_urls: valid.map(source => source.final_url || source.requested_url) } : {}),
        reason: checked.status === 'failed' ? failures >= 2 ? 'repeated_entry_failure' : 'entry_failed'
          : automatic && !proved ? entry.access.scope_confirmation_needed ? 'scope_confirmation_needed' : 'scope_unverified'
            : automatic && valid.length < 2 ? 'recent_samples_unknown' : checked.review };
      const refreshed = await store.sourceLibrary(owner), current = refreshed.find(value => value.id === entry.id);
      if (!current || current.revision !== entry.revision || !isManaged(current) || blocked(current, refreshed)) {
        outcomes.push({ id: entry.id, status: 'conflict', review: 'changed_during_check' }); continue;
      }
      await store.saveLibraryEntry(owner, { ...entry, status }, access);
      outcomes.push({ id: entry.id, status, review: access.review, reason: access.reason, error_code: access.error_code || null });
    } catch (error) {
      if (!['library_conflict', 'library_duplicate', 'library_paused', 'library_user_managed'].includes(error.code)) throw error;
      outcomes.push({ id: entry.id, status: 'conflict', review: 'changed_during_check' });
    }
  }
  return { day, checked: outcomes.length, outcomes };
}
module.exports = { automaticProposal, listingProof, maintainLibrary };
