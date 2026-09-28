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
function summarize({ day, period, candidates, sources, watches, followed, directions, runs, tasks, refs, library, opportunities, notifications, currentTasks }) {
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
      const verified = s && ref.match && s.extraction_status === 'extracted' && ref.analysis_sha256 === s.content_sha256
        && s.extraction_source_sha256 === s.content_sha256 && ref.analysis_extracted_at && Date.parse(ref.analysis_extracted_at) === Date.parse(s.extracted_at);
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
  for (const c of newItems) c.direction_names = directionRows.filter(d => refs.some(r => r.direction_id === d.id && r.source_id === c.source_id && r.match?.relevant
    && r.analysis_sha256 === sourceById.get(c.source_id)?.content_sha256 && Date.parse(r.analysis_extracted_at) === Date.parse(sourceById.get(c.source_id)?.extracted_at))).map(d=>d.name);
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
    notifications,
    highlights:[...updates.slice(0,3).map(w=>({kind:'update',watch:{...w,changes:w.changes.slice(0,3)}})),
      ...discoveries.slice().sort((a,b)=>(b.direction_names.length>0)-(a.direction_names.length>0)||b.created_at.localeCompare(a.created_at)).slice(0,5).map(c=>({kind:'discovery',candidate:c}))].slice(0,5)
  };
}
module.exports = { periodWindow, recentPublication, summarize };
