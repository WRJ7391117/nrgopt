const { matches, types, automaticScopeReady, automaticId, scopeKey, integratedBy } = require('./source-library.cjs');
const regions = require('./regions.json');
const { parseDate } = require('./publication.cjs');

const DAY = 86400000;
function firstDay(day) { return new Date(Date.parse(day + 'T00:00:00Z') - 29 * DAY).toISOString().slice(0, 10); }
function urlKey(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:') return null; url.hash = ''; return url.href; } catch { return null; }
}
function sourceUrls(source) { return [...new Set([source.final_url, source.requested_url].map(urlKey).filter(Boolean))]; }
function latestSources(sources) {
  const seen = new Set(), latest = [];
  const failed = source => ['fetch_failed', 'evidence_failed'].includes(source.status) || ['failed', 'extraction_failed'].includes(source.extraction_status);
  for (const source of sources.slice().sort((a, b) => (Date.parse(b.fetched_at) || 0) - (Date.parse(a.fetched_at) || 0)
    || Number(failed(b)) - Number(failed(a)) || String(b.id).localeCompare(String(a.id)))) {
    const urls = sourceUrls(source);
    // A newer failed fetch still supersedes the older successful version of that URL.
    if (urls.length && !urls.some(url => seen.has(url))) latest.push(source);
    urls.forEach(url => seen.add(url));
  }
  return latest;
}
function validRecentSource(source, day) {
  const date = parseDate(source.publication_date)?.date;
  const published = source.published_at ? parseDate(source.published_at) : null;
  if (source.published_at && !published) return false;
  const publicationDay = published?.timestamp ? new Date(Date.parse(published.timestamp) + 8 * 3600000).toISOString().slice(0, 10) : date;
  return source.status === 'pending_extraction' && source.extraction_status === 'extracted'
    && /^[a-f0-9]{64}$/.test(source.content_sha256 || '') && source.extraction_source_sha256 === source.content_sha256
    && ['metadata', 'publisher_dateline', 'spa_dateline'].includes(source.publication_method)
    && !!date && !!publicationDay && publicationDay >= firstDay(day) && publicationDay <= day;
}
function sourceCountries(source) {
  return [...new Set((source.countries || []).filter(item => ['occurrence', 'relevance'].includes(item.relation)
    && regions.countries.some(country => country.code === item.code)).map(item => item.code))];
}
function sample(source) {
  return { id: source.id, title: source.title, final_url: source.final_url || source.requested_url,
    publication_date: source.publication_date, published_at: source.published_at || null, fetched_at: source.fetched_at,
    content_sha256: source.content_sha256, countries: sourceCountries(source) };
}
function entryScope(entry, directions) {
  const enabled = directions.filter(direction => direction.config.enabled);
  const linked = enabled.filter(direction => !entry.config.direction_ids.length || entry.config.direction_ids.includes(direction.id));
  const matched = linked.filter(direction => direction.config.countries.some(country => entry.config.countries.includes(country)));
  const countries = [...new Set(matched.flatMap(direction => direction.config.countries).filter(country => entry.config.countries.includes(country)))];
  return { direction_ids: matched.map(direction => direction.id), countries, in_current_scope: !!matched.length,
    reason: !enabled.length ? 'no_directions' : !linked.length ? 'no_direction_match' : !countries.length ? 'no_country_match' : 'matched' };
}
function entryUsage(entry, scope, entries) {
  const mechanism = entry.config.mode;
  let reason;
  if (entry.status === 'removed') reason = 'removed';
  else if (entry.status === 'paused') reason = 'paused';
  else if (entry.host_paused) reason = 'host_paused';
  else if (entries.some(other => ['paused', 'removed'].includes(other.status) && matches(other, entry.config.url))) reason = 'scope_paused';
  else if (mechanism === 'fixed' && entry.status === 'active') reason = 'fixed_monitoring';
  else if (entry.access.status !== 'readable') reason = entry.access.status === 'failed' ? 'entry_failed' : 'entry_unchecked';
  else if (!automaticScopeReady(entry)) reason = entry.access.scope_confirmation_needed ? 'scope_confirmation_needed' : 'scope_unverified';
  else if (!scope.in_current_scope) reason = 'outside_scope';
  else if (entry.status === 'active') reason = 'search_rotation';
  else if (entry.id.startsWith('reference:') && entry.access?.managed_by !== 'user' && entry.status === 'candidate') reason = 'reference_trial';
  else reason = 'candidate';
  return { mechanism, eligible: ['fixed_monitoring', 'search_rotation', 'reference_trial'].includes(reason), reason };
}
function naturalTasks(tasks, day) {
  return tasks.filter(task => task.run?.job_type === 'daily_scan' && parseDate(task.run.schedule_key)?.date === task.run.schedule_key
    && task.run.schedule_key >= firstDay(day) && task.run.schedule_key <= day && /^(registry:[\w-]+|discover:[A-Z]{2})$/.test(task.item_key));
}
function belongs(task, entry) {
  if (entry.config.mode === 'fixed') return task.item_key === 'registry:' + entry.id.replace(/^fixed:/, '');
  return task.channel?.id === entry.id && task.channel.url === entry.config.url && task.channel.scope === entry.config.scope;
}
function taskSummary(task) {
  return { id: task.id, item_key: task.item_key, status: task.status, error_code: task.error_code || null,
    updated_at: task.updated_at, day: task.run.schedule_key, result_count: (task.result_urls || []).length };
}
function taskFound(task, source, entry) {
  return task.status === 'succeeded' && (task.result_urls || []).some(value => {
    const url = urlKey(value);
    return url && matches(entry, url) && sourceUrls(source).includes(url);
  });
}
function summarizeLibrary({ entries, sources, tasks, directions = [], day, sourceLimit = 500, taskLimit = 1000 }) {
  const latest = latestSources(sources), valid = latest.filter(source => validRecentSource(source, day));
  const natural = naturalTasks(tasks, day).sort((a, b) => b.run.schedule_key.localeCompare(a.run.schedule_key)
    || (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
  const sourcesLimited = sources.length >= sourceLimit, tasksLimited = tasks.length >= taskLimit;
  const rows = entries.map(entry => {
    const scope = entryScope(entry, directions), usage = entryUsage(entry, scope, entries);
    const sameSite = valid.filter(source => matches(entry, source.final_url || source.requested_url));
    const assigned = natural.filter(task => belongs(task, entry));
    const found = sameSite.filter(source => assigned.some(task => taskFound(task, source, entry)));
    const parent = integratedBy(entry, entries);
    return { ...entry, scope, usage, integration: parent ? { entry_id: parent.id, name: parent.config.name } : null,
      execution: assigned.find(task => task.run.schedule_key === day) || null,
      recent_sources: latest.filter(source => matches(entry, source.final_url || source.requested_url)).slice(0, 20),
      performance: { latest_task: assigned[0] ? taskSummary(assigned[0]) : null, task_count: assigned.length,
        succeeded_tasks: assigned.filter(task => task.status === 'succeeded').length,
        failed_tasks: assigned.filter(task => task.status === 'failed').length,
        pending_tasks: assigned.filter(task => ['queued', 'running', 'retry'].includes(task.status)).length,
        budget_paused_tasks: assigned.filter(task => task.status === 'budget_paused').length,
        manual_paused_tasks: assigned.filter(task => task.status === 'manual_paused').length,
        natural_source_count: found.length, same_site_source_count: sameSite.length,
        natural_sources: found.map(sample), same_site_sources: sameSite.map(sample), sources_limited: sourcesLimited, tasks_limited: tasksLimited } };
  });
  const suggestions = new Map(), enabled = directions.filter(direction => direction.config.enabled);
  for (const source of valid) {
    const url = source.final_url || source.requested_url;
    // Paused and removed scopes also suppress suggestions; the user's decision takes precedence.
    if (entries.some(entry => sourceUrls(source).some(value => matches(entry, value)) && !(automaticId.test(entry.id)
      && entry.status === 'candidate' && !entry.host_paused && entry.access?.managed_by === 'automatic'
      && entry.access.scope_confirmation_needed && entry.access.auto_scope_key === scopeKey(entry)
      && scopeKey(entry) === scopeKey({ config: { url, scope: 'path' } })))) continue;
    const countries = sourceCountries(source), relevant = enabled.filter(direction => direction.config.countries.some(country => countries.includes(country)));
    if (!relevant.length) continue;
    const domain = new URL(url).hostname.replace(/^www\./, '');
    if (!suggestions.has(domain)) suggestions.set(domain, { domain, url, name: domain, draft_scope: 'path',
      sample_url: url, sample_id: source.id, sample_date: source.publication_date, fetched_at: source.fetched_at,
      sample_count: 0, samples: [], countries: [], direction_ids: [], reason: 'recent_validated_sample' });
    const suggestion = suggestions.get(domain); suggestion.sample_count++; suggestion.samples.push(sample(source));
    suggestion.countries = [...new Set(suggestion.countries.concat(countries))];
    suggestion.direction_ids = [...new Set(suggestion.direction_ids.concat(relevant.map(direction => direction.id)))];
  }
  const countries = [...new Set(enabled.flatMap(direction => direction.config.countries))];
  const coverage = countries.map(country => {
    const directionIds = enabled.filter(direction => direction.config.countries.includes(country)).map(direction => direction.id);
    return { country, direction_ids: directionIds, types: Object.keys(types).filter(type => type !== 'unknown').map(type => {
      const relevant = rows.filter(entry => entry.config.type === type && entry.scope.countries.includes(country)
        && entry.scope.direction_ids.some(id => directionIds.includes(id)));
      const eligible = relevant.filter(entry => entry.usage.eligible && entry.status === 'active');
      const originals = new Set(), samples = new Set();
      eligible.forEach(entry => {
        entry.performance.natural_sources.filter(source => source.countries.includes(country)).forEach(source => originals.add(source.id));
        entry.performance.same_site_sources.filter(source => source.countries.includes(country)).forEach(source => samples.add(source.id));
      });
      return { type, eligible_channels: eligible.length, fixed_channels: eligible.filter(entry => entry.config.mode === 'fixed').length,
        search_channels: eligible.filter(entry => entry.config.mode === 'search').length,
        candidate_channels: relevant.filter(entry => entry.status === 'candidate' && !entry.host_paused).length,
        natural_source_count: originals.size, sample_source_count: samples.size,
        limited: sourcesLimited || tasksLimited,
        gap: !eligible.length ? 'no_channel' : !originals.size ? 'no_natural_source' : 'none' };
    }) };
  });
  return { entries: rows, suggestions: [...suggestions.values()].sort((a, b) => b.sample_count - a.sample_count || b.sample_date.localeCompare(a.sample_date)).slice(0, 50),
    coverage, sample_limit: sourceLimit, day,
    window: { first_day: firstDay(day), last_day: day, sources_read: sources.length, sources_limited: sourcesLimited,
      tasks_read: tasks.length, tasks_limited: tasksLimited, suggestion_domains: suggestions.size, suggestions_limited: suggestions.size > 50 } };
}
module.exports = { firstDay, latestSources, validRecentSource, summarizeLibrary };
