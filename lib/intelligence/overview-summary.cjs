// Read-only overview projection. Counts refer to source records, not unique market projects.
const DAY = 86400000;
function periodWindow(day, period = 1) {
  if (![1, 7, 30].includes(period)) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request', status: 400 });
  const end = Date.parse(day + 'T00:00:00+08:00') + DAY;
  return { start: new Date(end - period * DAY).toISOString(), end: new Date(end).toISOString(), from: new Date(end - period * DAY + 8 * 3600000).toISOString().slice(0, 10) };
}
function recentPublication(source, day) {
  if (source.publication_method === 'conflicting_metadata') return false;
  const timestamp = source.published_at && /(Z|[+-]\d{2}:?\d{2})$/i.test(source.published_at) ? Date.parse(source.published_at) : NaN;
  const published = Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) : source.publication_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published || '') || !Number.isFinite(Date.parse(published)) || new Date(published).toISOString().slice(0, 10) !== published) return false;
  const age = (Date.parse(day) - Date.parse(published)) / DAY;
  return Number.isFinite(age) && age >= 0 && age < 30;
}
function sourceMatchVerified(ref, source) {
  return !!(ref.match && source?.extraction_status === 'extracted' && source.content_sha256
    && ref.analysis_sha256 === source.content_sha256 && source.extraction_source_sha256 === source.content_sha256
    && Number.isFinite(Date.parse(ref.analysis_extracted_at)) && Date.parse(ref.analysis_extracted_at) === Date.parse(source.extracted_at));
}
function sourceFilterMatch(ref, source) {
  const snapshot = ref.direction, match = ref.match;
  if (!sourceMatchVerified(ref, source) || match.rules_version !== 1 || !snapshot?.config?.filter_rules
    || snapshot.id !== ref.direction_id || match.id !== snapshot.id || match.revision !== snapshot.revision) return null;
  try {
    const { normalizeFilterRules, validateMatches } = require('./directions.cjs');
    const direction = { ...snapshot, config: { ...snapshot.config, filter_rules: normalizeFilterRules(snapshot.config.filter_rules) } };
    const { attention, rules_version, ...raw } = match;
    if (!raw.relevant) {
      if (!Array.isArray(raw.matched_rules) || raw.matched_rules.length || !Array.isArray(raw.business_paths) || raw.business_paths.length) return null;
      delete raw.matched_rules; delete raw.business_paths;
    }
    const checked = validateMatches([raw], [direction], source.known_facts || source.extraction_zh?.known_facts || [])[0];
    return checked.rules_version === rules_version && checked.attention === attention ? checked : null;
  } catch { return null; }
}
function summarize({ day, period, candidates, sources, watches, followed, directions, runs, tasks, refs, library, opportunities, currentTasks }) {
  const window = periodWindow(day, period), sourceById = new Map(sources.map(s => [s.id, s]));
  const byUrl = new Map();
  for (const c of candidates.slice().sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))) {
    const s = sourceById.get(c.source_id), key = s?.final_url || c.source_id;
    if (!s || s.extraction_status !== 'extracted' || !s.content_sha256 || s.extraction_source_sha256 !== s.content_sha256
      || (c.source_sha256 && c.source_sha256 !== s.content_sha256)) continue;
    // Keep the latest valid version while preserving the URL's first discovery time.
    if (byUrl.has(key)) { byUrl.get(key).created_at = c.created_at; continue; }
    byUrl.set(key, { ...c, source_timing: { publication_date:s.publication_date, published_at:s.published_at, publication_method:s.publication_method },
      why_it_matters_zh:s.why_it_matters_zh, unknowns_zh:s.unknowns_zh || [], next_signals_zh:s.next_signals_zh || [] });
  }
  const corpus = [...byUrl.values()];
  const newItems = corpus.filter(c => Date.parse(c.created_at) >= Date.parse(window.start) && Date.parse(c.created_at) < Date.parse(window.end) && recentPublication(sourceById.get(c.source_id), day)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  const handled = new Set(watches.map(w => w.candidate_id));
  const discoveries = newItems.filter(c => !handled.has(c.id));
  const updates = followed.map(w => {
    const changes = w.changes.filter(c => Date.parse(c.created_at) >= Date.parse(window.start) && Date.parse(c.created_at) < Date.parse(window.end));
    return { ...w, changes, change_count: changes.length };
  }).filter(w => w.change_count).sort((a,b) => b.changes[0].created_at.localeCompare(a.changes[0].created_at));
  const due = followed.filter(w => w.followup.review_on <= day || w.candidate.evidence_status === 'conflict')
    .sort((a,b) => a.followup.review_on.localeCompare(b.followup.review_on));
  const active = followed.slice().sort((a,b) => a.followup.review_on.localeCompare(b.followup.review_on));
  const run = runs.find(r => r.schedule_key === day) || null;
  const counts = {};
  currentTasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
  const newBySource = new Map(newItems.map(c => [c.source_id, c]));
  const directionRows = directions.map(d => {
    const searched = tasks.filter(t => t.checkpoint?.direction?.id === d.id);
    const links = refs.filter(r => r.direction_id === d.id);
    const matched = new Map();
    let unverified = 0;
    for (const ref of links) {
      const s = sourceById.get(ref.source_id);
      const verified = sourceMatchVerified(ref, s);
      if (!verified) { unverified++; continue; }
      if (ref.match.relevant && newBySource.has(ref.source_id)) matched.set(ref.source_id, newBySource.get(ref.source_id));
    }
    const ordered = [...matched.values()].sort((a,b) => b.created_at.localeCompare(a.created_at));
    const status_counts = {};searched.forEach(t => { status_counts[t.status] = (status_counts[t.status] || 0) + 1; });
    return { id:d.id, name:d.config.name, countries:d.config.countries, industries:d.config.industries, enabled:d.config.enabled, effective_on:d.effective_on,
      searched_countries:[...new Set(searched.map(t => t.checkpoint.country).filter(Boolean))], succeeded_countries:[...new Set(searched.filter(t=>t.status==='succeeded').map(t=>t.checkpoint.country).filter(Boolean))],
      status_counts, task_count:searched.length, new_count:matched.size, unverified_links:unverified,
      latest:ordered[0] ? { source_id:ordered[0].source_id,title:ordered[0].title_zh,created_at:ordered[0].created_at,source_timing:ordered[0].source_timing } : null };
  });
  for (const c of newItems) {
    const source = sourceById.get(c.source_id), links = refs.filter(r => r.source_id === c.source_id);
    c.direction_names = directionRows.filter(d => links.some(r => r.direction_id === d.id && r.match?.relevant && sourceMatchVerified(r, source))).map(d=>d.name);
    const matches = links.map(ref => sourceFilterMatch(ref, source)).filter(match => match?.relevant);
    const match = matches.find(match => match.attention === 'priority') || matches.find(match => match.attention === 'observe');
    c.rule_attention = match ? match.attention === 'priority' && c.disposition === 'candidate' && c.evidence_status !== 'conflict' ? 'priority' : 'observe' : null;
    c.rule_reason = match?.reason_zh || null;
    c.rule_paths = match?.business_paths || [];
  }
  const ruleRank = c => ({ priority:2, observe:1 })[c.rule_attention] || 0;
  discoveries.sort((a,b) => ruleRank(b)-ruleRank(a) || b.created_at.localeCompare(a.created_at));
  const visible = new Map(corpus.map(c => [c.id,c]));
  const procurementSources = new Set(opportunities.filter(o => {
    const c = visible.get(o.candidate_id), s = sourceById.get(c?.source_id);
    return c && o.source_sha256 === s.content_sha256 && o.source_sha256 === c.source_sha256;
  }).map(o => visible.get(o.candidate_id).source_id));
  const distribution = { trigger:0,demand:0,project:0,procurement:procurementSources.size,total:corpus.length };
  for(const c of corpus) for(const key of ['trigger','demand','project']) if(c.radars?.includes(key)) distribution[key]++;
  return { day, period, from:window.from, captured_at:new Date().toISOString(),
    counts:{ discoveries:newItems.length,updates:updates.length,due:due.length,active:active.length },
    new_items:newItems, discoveries:discoveries.slice(0,6),discovery_more:discoveries.length>6,
    updates:updates.slice(0,6).map(w=>({...w,changes:w.changes.slice(0,3)})),updates_more:updates.length>6,
    due:due.slice(0,6).map(w=>({...w,changes:w.changes.slice(0,3)})),due_more:due.length>6,active:active.slice(0,6).map(w=>({...w,changes:w.changes.slice(0,3)})),active_more:active.length>6,
    directions:directionRows,distribution,
    library:{active:library.filter(e=>e.status==='active'&&!e.host_paused).length,total:library.filter(e=>e.status!=='removed').length},
    runtime:{ day,run:run ? {status:run.status,updated_at:run.updated_at,finished_at:run.finished_at} : null, counts,total:currentTasks.length,
      failures:currentTasks.filter(t=>t.status==='failed').slice(0,3).map(t=>({error_code:t.error_code,url:t.checkpoint?.url,name:t.checkpoint?.name || t.item_key})) },
    highlights:discoveries.slice().sort((a,b)=>ruleRank(b)-ruleRank(a)||(b.direction_names.length>0)-(a.direction_names.length>0)||b.created_at.localeCompare(a.created_at)).slice(0,5)
  };
}
module.exports = { periodWindow, recentPublication, sourceMatchVerified, sourceFilterMatch, summarize };
