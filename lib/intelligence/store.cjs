const { randomUUID } = require('node:crypto');
const { publicationMetadata } = require('./publication.cjs');

const BUCKET = 'nrgopt-intelligence';
const FIELDS = 'id,title,requested_url,final_url,fetched_at,published_at,publication_date,publication_method,publication_evidence,status,error_code,excerpt,content_type,byte_size,content_sha256,archive_status,archived_at,annotation_zh,annotation_updated_at,extraction_status,extraction_zh,extraction_provider,extraction_model,extraction_config_version_id,extraction_source_sha256,extraction_error_code,extracted_at';
const CANDIDATE_FIELDS = 'id,source_id,title_zh,summary_zh,disposition,radars,occurrence_countries,relevance_countries,importance,evidence_status,maturity,urgency,countries_zh,organizations_zh,project_zh,procurement_zh,review_status,updated_at';
const RELATION_FIELDS = 'candidate_id,related_candidate_id,relation,matching_facts_zh,conflicting_facts_zh,checked_at,same_scope,left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at';
const PROVIDER_CONFIG_FIELDS = 'config_version_id,owner_id,capability,provider,endpoint,model,currency,billing_mode,budget_limit_micro,budget_reserved_micro,budget_spent_micro,budget_period_start,budget_period_end,budget_enabled,provider_balance_anchor_micro,provider_balance_anchor_spent_micro,provider_balance_last_micro,provider_balance_synced_at,api_key_ciphertext,updated_at';
const failure = (code, status = 502) => Object.assign(new Error(code), { code, status });
const LEGAL_SUFFIXES = new Set(['co', 'company', 'corp', 'corporation', 'inc', 'limited', 'llc', 'ltd', 'pjsc', 'plc', 'saoc']);

function normalizedOrganizationWords(value) {
  const words = String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.filter(word => !LEGAL_SUFFIXES.has(word)))].join(' ');
}

function organizationKeys(value) {
  const raw = String(value || '').normalize('NFKC').trim();
  const groups = [...raw.matchAll(/\(([^()]*)\)/g)].map(match => match[1].trim());
  const outside = raw.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const acronym = text => /^[A-Z0-9]{2,12}$/.test(text);
  let primary = normalizedOrganizationWords(raw);
  const aliases = [];
  if (groups.length === 1 && acronym(groups[0])) {
    primary = normalizedOrganizationWords(outside);
    aliases.push(normalizedOrganizationWords(groups[0]));
  } else if (groups.length === 1 && acronym(outside)) {
    primary = normalizedOrganizationWords(groups[0]);
    aliases.push(normalizedOrganizationWords(outside));
  }
  return [...new Set([primary, ...aliases].filter(Boolean))];
}

function settings(env = process.env) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NRGOPT_ADMIN_USER_ID', 'NRGOPT_APP_ORIGIN'];
  if (required.some(key => !env[key])) throw failure('not_configured', 503);
  const origin = new URL(env.NRGOPT_APP_ORIGIN);
  const url = new URL(env.SUPABASE_URL);
  const local = value => value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname);
  if ((origin.protocol !== 'https:' && !local(origin)) || (url.protocol !== 'https:' && !local(url))) throw failure('not_configured', 503);
  if (origin.username || origin.password || url.username || url.password || origin.pathname !== '/' || url.pathname !== '/') throw failure('not_configured', 503);
  const writesRequested = env.NRGOPT_INTELLIGENCE_WRITE_ENABLED === '1';
  const productionAllowed = env.VERCEL_ENV !== 'production' || env.NRGOPT_INTELLIGENCE_PRODUCTION_WRITE_ENABLED === '1';
  const origins = new Set([origin.origin]);
  if (env.VERCEL_ENV === 'preview') {
    for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) {
      if (!env[key]) continue;
      try {
        const preview = new URL(`https://${env[key]}`);
        if (preview.hostname.endsWith('.vercel.app') && preview.pathname === '/' && !preview.username && !preview.password) {
          origins.add(preview.origin);
        }
      } catch { /* Invalid platform metadata is ignored. */ }
    }
  }
  return { url: url.origin, origin: origin.origin, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    adminId: env.NRGOPT_ADMIN_USER_ID, origins: [...origins], writes: writesRequested && productionAllowed };
}

function createStore(config, fetchImpl = global.fetch) {
  async function request(path, options = {}) {
    const { token, publicKey = false, raw = false, ...init } = options;
    const key = publicKey ? config.anonKey : config.serviceKey;
    let response;
    try {
      response = await fetchImpl(`${config.url}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', ...init.headers } });
    } catch { throw failure('upstream_unavailable'); }
    if (!response.ok) {
      if (publicKey && [400, 401, 403].includes(response.status)) throw failure('auth_required', 401);
      throw failure('upstream_unavailable');
    }
    if (raw) return Buffer.from(await response.arrayBuffer());
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { throw failure('upstream_unavailable'); }
  }
  const tableRows = (table, query, options) => request(`/rest/v1/${table}?${query}`, options);
  const rows = (query, options) => tableRows('intelligence_sources', query, options);
  const filter = (id, owner) => `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`;
  async function one(id, owner, privateFields = false) {
    const result = await rows(`${filter(id, owner)}&select=${privateFields ? '*' : FIELDS}&limit=1`);
    if (!Array.isArray(result) || !result[0]) throw failure('not_found', 404);
    return result[0];
  }
  async function update(id, owner, body, condition = '') {
    await rows(filter(id, owner) + condition, { method: 'PATCH', body: JSON.stringify(body) });
  }
  async function enqueueArchive(owner, sourceId) {
    const id = await request('/rest/v1/rpc/enqueue_intelligence_archive', { method: 'POST', body: JSON.stringify({
      p_owner_id: owner, p_source_id: sourceId
    }) });
    if (!id) throw failure('archive_queue_failed');
    return id;
  }
  async function relations(owner, candidateIds = []) {
    if (!candidateIds.length) return [];
    const ids = candidateIds.map(encodeURIComponent).join(',');
    return tableRows('intelligence_candidate_relations', `owner_id=eq.${encodeURIComponent(owner)}&candidate_id=in.(${ids})&select=${RELATION_FIELDS}`);
  }
  async function attachRelations(candidates, owner) {
    if (!candidates.length) return candidates;
    const byId = new Map(candidates.map(item => [item.id, item]));
    const linked = await relations(owner, candidates.map(item => item.id));
    if (!linked.length) return candidates.map(item => ({ ...item, related_sources: [] }));
    const missing = [...new Set(linked.map(item => item.related_candidate_id).filter(id => !byId.has(id)))];
    if (missing.length) {
      const peers = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&id=in.(${missing.map(encodeURIComponent).join(',')})&select=id,source_id`);
      for (const peer of peers) byId.set(peer.id, peer);
    }
    const { distinctSourcePublishers } = require('./crosscheck.cjs');
    const sourceIds = [...new Set([...byId.values()].map(item => item.source_id))];
    const sources = await rows(`owner_id=eq.${encodeURIComponent(owner)}&id=in.(${sourceIds.map(encodeURIComponent).join(',')})&select=id,final_url,content_sha256,extracted_at,fetched_at`);
    const sourceFor = id => sources.find(source => source.id === byId.get(id)?.source_id);
    const valid = linked.filter(link => {
      const left = sourceFor(link.candidate_id), right = sourceFor(link.related_candidate_id);
      return left && right && distinctSourcePublishers(left, right)
        && (!link.left_source_sha256 || (link.left_source_sha256 === left.content_sha256 && link.right_source_sha256 === right.content_sha256
          && Date.parse(link.left_extracted_at) === Date.parse(left.extracted_at) && Date.parse(link.right_extracted_at) === Date.parse(right.extracted_at)));
    });
    return candidates.map(item => {
      const original = linked.filter(link => link.candidate_id === item.id);
      const retained = [];
      const originals = new Set();
      for (const link of valid.filter(link => link.candidate_id === item.id).sort((left, right) =>
        (Date.parse(right.checked_at) || 0) - (Date.parse(left.checked_at) || 0)
        || (Date.parse(sourceFor(right.related_candidate_id)?.fetched_at) || 0) - (Date.parse(sourceFor(left.related_candidate_id)?.fetched_at) || 0))) {
        const source = sourceFor(link.related_candidate_id);
        const key = source.content_sha256 || source.final_url || source.id;
        if (!originals.has(key)) retained.push(link);
        originals.add(key);
      }
      const evidenceStatus = original.length !== retained.length && ['checked', 'conflict'].includes(item.evidence_status)
        ? retained.some(link => link.relation === 'conflicts') ? 'conflict' : retained.length ? 'checked' : 'sourced'
        : item.evidence_status;
      return { ...item, evidence_status: evidenceStatus, related_sources: retained.map(link => ({
      related_candidate_id: link.related_candidate_id,
      source_id: byId.get(link.related_candidate_id)?.source_id || null,
      relation: link.relation, same_scope: link.same_scope,
      matching_facts_zh: link.matching_facts_zh,
      conflicting_facts_zh: link.conflicting_facts_zh,
      checked_at: link.checked_at
      })).filter(link => link.source_id) };
    });
  }
  async function materializeBusinessObjects(candidate, classification, owner) {
    const project = classification.project;
    const occurrences = classification.countries.filter(item => item.relation === 'occurrence');
    const projectCountry = occurrences.find(item => item.evidence_fact_number === project?.evidence_fact_number)?.code
      || ([...new Set(occurrences.map(item => item.code))].length === 1 ? occurrences[0]?.code : null);
    const projectFilter = `owner_id=eq.${encodeURIComponent(owner)}&candidate_id=eq.${encodeURIComponent(candidate.id)}`;
    if (!project?.name_zh || !projectCountry) {
      await tableRows('intelligence_projects', projectFilter, { method: 'DELETE' });
      return;
    }

    const knownOrganizations = await tableRows('intelligence_organizations',
      `owner_id=eq.${encodeURIComponent(owner)}&select=id,canonical_name,country_code`);
    const organizations = new Map();
    for (const item of classification.organizations) {
      const keys = organizationKeys(item.canonical_name);
      let saved = knownOrganizations.filter(existing => organizationKeys(existing.canonical_name).some(key => keys.includes(key)))
        .sort((left, right) => left.canonical_name.length - right.canonical_name.length || left.canonical_name.localeCompare(right.canonical_name))[0];
      if (!saved) {
        const result = await tableRows('intelligence_organizations', 'on_conflict=owner_id,canonical_name', {
          method: 'POST', body: JSON.stringify({ owner_id: owner, canonical_name: item.canonical_name, country_code: projectCountry }),
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
        });
        saved = result?.[0];
        if (saved?.id) knownOrganizations.push(saved);
      }
      if (!saved?.id) throw failure('storage_failed');
      organizations.set(item.canonical_name, saved.id);
      await tableRows('intelligence_entity_aliases', 'on_conflict=owner_id,alias', {
        method: 'POST', body: JSON.stringify({ owner_id: owner, organization_id: saved.id, alias: item.canonical_name }),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    }
    const linkedOrganization = classification.organizations.find(item => item.evidence_fact_number === project.evidence_fact_number);
    const projectRows = await tableRows('intelligence_projects', 'on_conflict=owner_id,candidate_id', {
      method: 'POST', body: JSON.stringify({ owner_id: owner, candidate_id: candidate.id,
        organization_id: organizations.get(linkedOrganization?.canonical_name) || null, country_code: projectCountry,
        canonical_name: project.name_zh, stage_zh: project.stage_zh }),
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
    const savedProject = projectRows?.[0];
    if (!savedProject?.id) throw failure('storage_failed');
    const procurementFilter = `owner_id=eq.${encodeURIComponent(owner)}&project_id=eq.${encodeURIComponent(savedProject.id)}`;
    await tableRows('intelligence_procurements', procurementFilter, { method: 'DELETE' });
    if (classification.procurement?.package_zh) await tableRows('intelligence_procurements', '', {
      method: 'POST', body: JSON.stringify({ owner_id: owner, project_id: savedProject.id,
        package_name_zh: classification.procurement.package_zh, stage_zh: classification.procurement.stage_zh,
        deadline_text: classification.procurement.deadline_text }), headers: { Prefer: 'return=minimal' }
    });
  }
  return {
    async login(email, password) {
      return request('/auth/v1/token?grant_type=password', { method: 'POST', publicKey: true, body: JSON.stringify({ email, password }) });
    },
    async user(token) { return request('/auth/v1/user', { publicKey: true, token }); },
    async logout(token) { return request('/auth/v1/logout?scope=local', { method: 'POST', publicKey: true, token }); },
    async list(owner) { return rows(`owner_id=eq.${encodeURIComponent(owner)}&select=${FIELDS}&order=fetched_at.desc&limit=50`); },
    get: one,
    async annotate(id, owner, note) {
      await update(id, owner, { annotation_zh: note || null, annotation_updated_at: note ? new Date().toISOString() : null });
      return one(id, owner);
    },
    async beginExtraction(id, owner) {
      await update(id, owner, { extraction_status: 'processing', extraction_error_code: null });
    },
    async saveExtraction(id, owner, result, sourceHash) {
      await update(id, owner, { extraction_status: 'extracted', extraction_zh: result.extraction,
        extraction_provider: result.provider, extraction_model: result.model, extraction_config_version_id: result.configVersionId || null, extraction_source_sha256: sourceHash,
        extraction_usage: result.usage, extraction_error_code: null, extracted_at: result.extractedAt || new Date().toISOString() });
      return one(id, owner);
    },
    async previousExtractedSource(source, owner) {
      const previous = await rows(`owner_id=eq.${encodeURIComponent(owner)}&final_url=eq.${encodeURIComponent(source.final_url)}&id=neq.${encodeURIComponent(source.id)}&status=eq.pending_extraction&extraction_status=eq.extracted&select=${FIELDS}&order=fetched_at.desc&limit=1`);
      return previous[0] || null;
    },
    async projectTimeline(sourceId, owner) {
      return request('/rest/v1/rpc/intelligence_project_timeline', { method: 'POST', body: JSON.stringify({ p_owner_id: owner, p_source_id: sourceId }) });
    },
    async analysisRevisions(sourceId, owner) {
      await one(sourceId, owner);
      return tableRows('intelligence_analysis_revisions', `owner_id=eq.${encodeURIComponent(owner)}&source_id=eq.${encodeURIComponent(sourceId)}&select=id,revision_no,config_version_id,source_sha256,extraction_zh,provider,model,extracted_at,recorded_at&order=revision_no.desc&limit=50`);
    },
    async sourceHistory(sourceId, owner) {
      const source = await one(sourceId, owner);
      if (!source.final_url) return [];
      const versions = await rows(`owner_id=eq.${encodeURIComponent(owner)}&final_url=eq.${encodeURIComponent(source.final_url)}&status=eq.pending_extraction&select=id,title,content_sha256,fetched_at,publication_date,published_at,publication_method,extraction_status,extraction_source_sha256,extraction_zh&order=fetched_at.desc&limit=50`);
      return versions.map(version => {
        const extraction = version.extraction_status === 'extracted' && version.extraction_source_sha256 === version.content_sha256
          ? version.extraction_zh : null;
        const project = extraction?.classification?.project || null;
        const procurement = extraction?.classification?.procurement || null;
        const fact = object => extraction?.known_facts?.[object?.evidence_fact_number - 1] || null;
        return { id: version.id, title: version.title, content_sha256: version.content_sha256, fetched_at: version.fetched_at,
          publication_date: version.publication_date, published_at: version.published_at, publication_method: version.publication_method,
          maturity: extraction?.maturity || null, reused_from_source_id: extraction?.reused_from_source_id || null,
          project, procurement, project_evidence: fact(project), procurement_evidence: fact(procurement) };
      });
    },
    async saveCandidate(sourceId, owner, extraction, sourceHash) {
      const classification = extraction.classification;
      const occurrence = classification.countries.filter(item => item.relation === 'occurrence').map(item => item.code);
      const relevance = classification.countries.filter(item => item.relation === 'relevance').map(item => item.code);
      const record = { owner_id: owner, source_id: sourceId, title_zh: classification.title_zh, summary_zh: extraction.summary_zh,
        disposition: classification.disposition, radars: classification.radars, occurrence_countries: [...new Set(occurrence)],
        relevance_countries: [...new Set(relevance)], importance: classification.importance,
        evidence_status: classification.evidence_status, maturity: extraction.maturity, urgency: classification.urgency,
        countries_zh: classification.countries, organizations_zh: classification.organizations,
        project_zh: classification.project, procurement_zh: classification.procurement, source_sha256: sourceHash,
        review_status: classification.disposition === 'candidate' ? 'auto_validated' : 'source_only', updated_at: new Date().toISOString() };
      const result = await tableRows('intelligence_candidates', 'on_conflict=owner_id,source_id', { method: 'POST', body: JSON.stringify(record),
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
      const candidate = result?.[0];
      if (!candidate?.id) throw failure('storage_failed');
      const tracked = await request('/rest/v1/rpc/sync_intelligence_tracking', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_candidate_id: candidate.id, p_hypotheses: extraction.hypotheses, p_signals: extraction.next_signals_zh
      }) });
      if (!tracked) throw failure('storage_failed');
      await materializeBusinessObjects(candidate, classification, owner);
      return candidate;
    },
    async candidates(owner) {
      const candidates = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&select=${CANDIDATE_FIELDS}&order=updated_at.desc&limit=100`);
      const sources = candidates.length ? await rows(`owner_id=eq.${encodeURIComponent(owner)}&id=in.(${candidates.map(item => encodeURIComponent(item.source_id)).join(',')})&select=id,final_url,content_sha256,fetched_at,published_at,publication_date,publication_method`) : [];
      const sourceById = new Map(sources.map(source => [source.id, source]));
      const newest = new Map();
      for (const item of candidates) {
        const source = sourceById.get(item.source_id);
        const key = source?.final_url || item.source_id;
        const previous = newest.get(key);
        if (!previous || Date.parse(source?.fetched_at) > Date.parse(sourceById.get(previous.source_id)?.fetched_at)) newest.set(key, item);
      }
      const byContent = new Map();
      for (const item of newest.values()) {
        const source = sourceById.get(item.source_id);
        const key = source?.content_sha256 || item.source_id;
        const previous = byContent.get(key);
        if (!previous || Date.parse(source?.fetched_at) > Date.parse(sourceById.get(previous.source_id)?.fetched_at)) byContent.set(key, item);
      }
      const latestIds = new Set([...byContent.values()].map(item => item.id));
      const latest = candidates.filter(item => latestIds.has(item.id));
      const linked = await attachRelations(latest.map(item => ({ ...item, source_timing: sourceById.get(item.source_id) || null })), owner);
      const visibleIds = new Set(linked.map(item => item.id));
      const supersededIds = new Set(candidates.filter(item => !visibleIds.has(item.id)).map(item => item.id));
      const grouped = [];
      for (const item of linked) {
        // A relation to an older source version must not suppress its newer analysis.
        const originalCount = item.related_sources.length;
        item.related_sources = item.related_sources.filter(link => !supersededIds.has(link.related_candidate_id));
        if (originalCount !== item.related_sources.length && ['checked', 'conflict'].includes(item.evidence_status)) {
          item.evidence_status = item.related_sources.some(link => link.relation === 'conflicts') ? 'conflict'
            : item.related_sources.length ? 'checked' : 'sourced';
        }
        const representative = item.disposition === 'candidate' && item.evidence_status !== 'conflict' && grouped.find(other => other.disposition === 'candidate'
          && other.evidence_status !== 'conflict'
          && other.review_status === item.review_status && other.related_sources.some(link =>
            link.related_candidate_id === item.id && link.same_scope === true && link.relation === 'supports'));
        if (representative) {
          for (const field of ['radars', 'occurrence_countries', 'relevance_countries']) {
            representative[field] = [...new Set([...(representative[field] || []), ...(item[field] || [])])];
          }
          continue;
        }
        grouped.push(item);
      }
      return grouped;
    },
    async operations(owner) {
      const runs = await tableRows('intelligence_job_runs', `owner_id=eq.${encodeURIComponent(owner)}&select=id,job_type,schedule_key,status,error_code,created_at,updated_at&order=created_at.desc&limit=10`);
      const runIds = runs.map(item => item.id);
      const items = runIds.length ? await tableRows('intelligence_job_items',
        `owner_id=eq.${encodeURIComponent(owner)}&job_run_id=in.(${runIds.map(encodeURIComponent).join(',')})&select=id,job_run_id,item_key,status,attempts,checkpoint,error_code,updated_at&order=item_key.asc`) : [];
      const budgetRows = await tableRows('intelligence_provider_configs',
        `owner_id=eq.${encodeURIComponent(owner)}&select=capability,currency,billing_mode,budget_limit_micro,budget_reserved_micro,budget_spent_micro,budget_period_start,budget_period_end,budget_enabled,provider_balance_last_micro,provider_balance_synced_at&order=capability.asc`);
      const budgets = budgetRows.map(item => ({ capability: item.capability, currency: item.currency, billing_mode: item.billing_mode,
        limit_micro: item.budget_limit_micro, reserved_micro: item.budget_reserved_micro, spent_micro: item.budget_spent_micro,
        period_start: item.budget_period_start, period_end: item.budget_period_end, enabled: item.budget_enabled,
        provider_balance_last_micro: item.provider_balance_last_micro ?? null,
        provider_balance_synced_at: item.provider_balance_synced_at }));
      const notifications = await tableRows('intelligence_notification_outbox',
        `owner_id=eq.${encodeURIComponent(owner)}&select=id,notification_type,status,attempts,error_code,created_at,updated_at&order=created_at.desc&limit=10`);
      return { runs, items, budgets, notifications };
    },
    async sourceControls(owner) {
      return tableRows('intelligence_source_controls', `owner_id=eq.${encodeURIComponent(owner)}&select=hostname,paused,updated_at`);
    },
    async sourcePaused(owner, url) {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      const controls = await tableRows('intelligence_source_controls', `owner_id=eq.${encodeURIComponent(owner)}&hostname=eq.${encodeURIComponent(hostname)}&select=paused&limit=1`);
      return controls[0]?.paused === true;
    },
    async setSourceControl(owner, hostname, paused) {
      return request('/rest/v1/rpc/set_intelligence_source_control', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_hostname: hostname, p_paused: paused
      }) });
    },
    async providerConfigs(owner) {
      return tableRows('intelligence_provider_configs',
        `owner_id=eq.${encodeURIComponent(owner)}&select=${PROVIDER_CONFIG_FIELDS}&order=capability.asc`);
    },
    async providerHistory(owner) {
      const scope = `owner_id=eq.${encodeURIComponent(owner)}`;
      const [versions, calls] = await Promise.all([
        tableRows('intelligence_provider_versions', `${scope}&select=id,capability,provider,model,currency,billing_mode,budget_limit_micro,budget_enabled,key_changed,created_at&order=created_at.desc&limit=30`),
        tableRows('intelligence_budget_reservations', `${scope}&config_version_id=not.is.null&select=id,config_version_id,operation,provider,model,usage,call_status,call_error_code,call_started_at,call_finished_at&order=call_started_at.desc&limit=30`)
      ]);
      return { versions, calls };
    },
    async startProviderCall(owner, reservationId, configVersionId) {
      return request('/rest/v1/rpc/start_intelligence_provider_call', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_reservation_id: reservationId, p_config_version_id: configVersionId || null
      }) });
    },
    async finishProviderCall(owner, reservationId, errorCode, usage) {
      return request('/rest/v1/rpc/finish_intelligence_provider_call', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_reservation_id: reservationId, p_error_code: errorCode, p_usage: usage
      }) });
    },
    async saveProviderConfig(owner, record) {
      if (record.owner_id !== owner) throw failure('invalid_request', 400);
      const result = await tableRows('intelligence_provider_configs', 'on_conflict=owner_id,capability', {
        method: 'POST', body: JSON.stringify(record), headers: { Prefer: 'resolution=merge-duplicates,return=representation,missing=default' }
      });
      if (!result?.[0]) throw failure('storage_failed');
      return result[0];
    },
    async jobRun(owner, id) {
      const runs = await tableRows('intelligence_job_runs',
        `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}&select=id,job_type,schedule_key,status,error_code,created_at,updated_at&limit=1`);
      if (!runs[0]) throw failure('not_found', 404);
      const items = await tableRows('intelligence_job_items',
        `job_run_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}&select=id,item_key,status,attempts,checkpoint,error_code,updated_at&order=item_key.asc`);
      return { run: runs[0], items };
    },
    async candidateBySource(sourceId, owner) {
      const candidates = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&source_id=eq.${encodeURIComponent(sourceId)}&select=${CANDIDATE_FIELDS}&limit=1`);
      const candidate = (await attachRelations(candidates, owner)).find(item => item.source_id === sourceId);
      if (!candidate) return null;
      const scope = `owner_id=eq.${encodeURIComponent(owner)}&candidate_id=eq.${encodeURIComponent(candidate.id)}`;
      const [hypotheses, watches] = await Promise.all([
        tableRows('intelligence_hypotheses', `${scope}&select=id,claim_zh,counter_evidence_zh,status,created_at,review_due_at,last_reviewed_at,dormant_at&order=created_at.asc`),
        tableRows('intelligence_watch_targets', `${scope}&select=id,signal_zh,status,created_at&order=created_at.asc`)
      ]);
      const assessments = hypotheses.length ? await tableRows('intelligence_hypothesis_assessments',
        `owner_id=eq.${encodeURIComponent(owner)}&hypothesis_id=in.(${hypotheses.map(h => encodeURIComponent(h.id)).join(',')})&select=*&order=created_at.desc`) : [];
      return { ...candidate, tracking: { hypotheses: hypotheses.map(h => ({ ...h,
        assessments: assessments.filter(a => a.hypothesis_id === h.id) })), watches } };
    },
    async hypothesis(id, owner) {
      const result = await tableRows('intelligence_hypotheses', `owner_id=eq.${encodeURIComponent(owner)}&id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      if (!result[0]) throw failure('not_found', 404);
      const candidates = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&id=eq.${encodeURIComponent(result[0].candidate_id)}&select=*&limit=1`);
      if (!candidates[0]) throw failure('not_found', 404);
      return { ...result[0], candidate: candidates[0] };
    },
    async hypothesisAssessment(hypothesisId, source, owner) {
      const result = await tableRows('intelligence_hypothesis_assessments', `owner_id=eq.${encodeURIComponent(owner)}&hypothesis_id=eq.${encodeURIComponent(hypothesisId)}&source_id=eq.${encodeURIComponent(source.id)}&source_sha256=eq.${encodeURIComponent(source.content_sha256)}&select=id&limit=1`);
      return result[0] || null;
    },
    async assessmentTargets(candidate, source, owner) {
      const { plausibleSameProject } = require('./crosscheck.cjs');
      if (candidate.disposition !== 'candidate') return [];
      const peers = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&id=neq.${encodeURIComponent(candidate.id)}&disposition=eq.candidate&select=*&order=updated_at.desc&limit=100`);
      if (!peers.length) return [];
      const sources = await rows(`owner_id=eq.${encodeURIComponent(owner)}&id=in.(${peers.map(p => encodeURIComponent(p.source_id)).join(',')})&select=id,final_url,content_sha256,extraction_zh`);
      const matched = peers.filter(peer => {
        const old = sources.find(s => s.id === peer.source_id);
        return old && old.content_sha256 !== source.content_sha256
          && JSON.stringify(old.extraction_zh?.known_facts) !== JSON.stringify(source.extraction_zh?.known_facts)
          && (old.final_url === source.final_url || plausibleSameProject(candidate, peer));
      }).slice(0, 3);
      if (!matched.length) return [];
      return tableRows('intelligence_hypotheses', `owner_id=eq.${encodeURIComponent(owner)}&candidate_id=in.(${matched.map(p => encodeURIComponent(p.id)).join(',')})&status=in.(open,strengthened,weakened)&select=id&order=created_at.asc&limit=12`);
    },
    async saveHypothesisAssessment(hypothesis, source, owner, result) {
      const id = await request('/rest/v1/rpc/save_intelligence_hypothesis_assessment', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_hypothesis_id: hypothesis.id, p_source_id: source.id, p_source_sha256: source.content_sha256,
        p_expected_status: hypothesis.status, p_recommendation: result.recommendation, p_reason_zh: result.reason_zh,
        p_fact_numbers: result.fact_numbers, p_provider: result.provider, p_model: result.model
      }) });
      if (!id) throw failure('hypothesis_save_failed');
      return id;
    },
    async watchedSources(owner) {
      return request('/rest/v1/rpc/intelligence_watched_sources', { method: 'POST', body: JSON.stringify({ p_owner_id: owner }) });
    },
    async reviewTracking(owner) {
      return request('/rest/v1/rpc/review_intelligence_tracking', { method: 'POST', body: JSON.stringify({ p_owner_id: owner }) });
    },
    async watchSearchTargets(owner, now = new Date()) {
      const after = new Date(now).toISOString();
      const hypotheses = await tableRows('intelligence_hypotheses', `owner_id=eq.${encodeURIComponent(owner)}&status=in.(open,strengthened,weakened)&review_due_at=gt.${encodeURIComponent(after)}&select=id,candidate_id,claim_zh,counter_evidence_zh,status,created_at,review_due_at&order=created_at.desc,id.asc&limit=100`);
      if (!hypotheses.length) return [];
      const ids = [...new Set(hypotheses.map(h => h.candidate_id))].map(encodeURIComponent).join(',');
      const candidates = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&id=in.(${ids})&disposition=eq.candidate&select=id,source_id,title_zh,project_zh,organizations_zh,occurrence_countries`);
      if (!candidates.length) return [];
      const [watches, sources] = await Promise.all([
        tableRows('intelligence_watch_targets', `owner_id=eq.${encodeURIComponent(owner)}&candidate_id=in.(${ids})&status=eq.active&select=candidate_id&order=created_at.asc`),
        rows(`owner_id=eq.${encodeURIComponent(owner)}&id=in.(${candidates.map(c => encodeURIComponent(c.source_id)).join(',')})&status=eq.pending_extraction&select=id,final_url,title`)
      ]);
      return hypotheses.flatMap(h => {
        const candidate = candidates.find(c => c.id === h.candidate_id);
        const watch = watches.find(w => w.candidate_id === h.candidate_id);
        const source = sources.find(s => s.id === candidate?.source_id);
        return candidate && watch && source ? [{ ...h, candidate, source_url: source.final_url, source_title: source.title }] : [];
      });
    },
    async enqueueJob(owner, jobType, scheduleKey, itemKeys) {
      if (!itemKeys.length) {
        // Manual assessment adds checkpointed items separately; the older RPC requires non-empty keys.
        const inserted = await tableRows('intelligence_job_runs', 'on_conflict=owner_id,job_type,schedule_key', {
          method: 'POST', body: JSON.stringify({ owner_id: owner, job_type: jobType, schedule_key: scheduleKey }),
          headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }
        });
        const existing = inserted?.[0] || (await tableRows('intelligence_job_runs',
          `owner_id=eq.${encodeURIComponent(owner)}&job_type=eq.${encodeURIComponent(jobType)}&schedule_key=eq.${encodeURIComponent(scheduleKey)}&select=id&limit=1`))[0];
        if (!existing?.id) throw failure('storage_failed');
        return existing.id;
      }
      return request('/rest/v1/rpc/enqueue_intelligence_job', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_job_type: jobType, p_schedule_key: scheduleKey, p_item_keys: itemKeys
      }) });
    },
    async registryCursor(owner, itemKey, jobId) {
      const items = await tableRows('intelligence_job_items',
        `owner_id=eq.${encodeURIComponent(owner)}&item_key=eq.${encodeURIComponent(itemKey)}&job_run_id=neq.${encodeURIComponent(jobId)}&status=eq.succeeded&select=checkpoint&order=updated_at.desc,id.desc&limit=1`);
      return items[0]?.checkpoint || {};
    },
    async enqueueJobItems(owner, jobId, items) {
      return request('/rest/v1/rpc/enqueue_intelligence_job_items', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_job_run_id: jobId, p_items: items
      }) });
    },
    async claimJobItem(owner, jobId = null, leaseSeconds = 300) {
      const result = await request('/rest/v1/rpc/claim_intelligence_job_item_v2', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_job_run_id: jobId, p_lease_seconds: leaseSeconds
      }) });
      return result?.[0] || null;
    },
    async finishJobItem(owner, itemId, status, checkpoint = {}, errorCode = null, attempts) {
      return request('/rest/v1/rpc/finish_intelligence_job_item_v2', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_item_id: itemId, p_status: status, p_checkpoint: checkpoint, p_error_code: errorCode, p_attempts: attempts
      }) });
    },
    async reserveBudget(owner, jobId, operation, currency, idempotencyKey, reserveMicro) {
      return request('/rest/v1/rpc/reserve_intelligence_budget', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_job_run_id: jobId, p_operation: operation, p_currency: currency,
        p_idempotency_key: idempotencyKey, p_reserve_micro: reserveMicro
      }) });
    },
    async settleBudget(owner, reservationId, chargedMicro, costStatus, billing = null) {
      return request('/rest/v1/rpc/settle_intelligence_budget', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_reservation_id: reservationId, p_charged_micro: chargedMicro, p_cost_status: costStatus,
        p_provider: billing?.provider || null, p_model: billing?.model || null,
        p_usage: billing?.usage || null, p_pricing_version: billing?.pricingVersion || null
      }) });
    },
    async releaseBudget(owner, reservationId) {
      return request('/rest/v1/rpc/release_intelligence_budget', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_reservation_id: reservationId
      }) });
    },
    async syncProviderBalance(owner, capability, currency, balanceMicro) {
      return request('/rest/v1/rpc/sync_intelligence_provider_balance', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_capability: capability, p_currency: currency, p_balance_micro: balanceMicro
      }) });
    },
    enqueueArchive,
    async claimArchive(owner, nodeId, leaseSeconds = 300) {
      const result = await request('/rest/v1/rpc/claim_intelligence_archive', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_archive_node_id: nodeId, p_lease_seconds: leaseSeconds
      }) });
      return result?.[0] || null;
    },
    async archiveJob(id, owner, nodeId) {
      const result = await tableRows('intelligence_archive_jobs',
        `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}&archive_node_id=eq.${encodeURIComponent(nodeId)}&status=eq.claimed&select=id,source_id&limit=1`);
      if (!result?.[0]) throw failure('not_found', 404);
      return result[0];
    },
    async completeArchive(owner, id, nodeId, byteSize, sha256) {
      return request('/rest/v1/rpc/complete_intelligence_archive', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_archive_id: id, p_archive_node_id: nodeId, p_byte_size: byteSize, p_content_sha256: sha256
      }) });
    },
    async failArchive(owner, id, nodeId, errorCode) {
      return request('/rest/v1/rpc/fail_intelligence_archive', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_archive_id: id, p_archive_node_id: nodeId, p_error_code: errorCode
      }) });
    },
    async enqueueNotification(owner, type, key, payload) {
      return request('/rest/v1/rpc/enqueue_intelligence_notification', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_notification_type: type, p_notification_key: key, p_payload: payload
      }) });
    },
    async claimNotification(owner, leaseSeconds = 120) {
      const result = await request('/rest/v1/rpc/claim_intelligence_notification', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_lease_seconds: leaseSeconds
      }) });
      return result?.[0] || null;
    },
    async finishNotification(owner, id, status, responseCode = null, errorCode = null) {
      return request('/rest/v1/rpc/finish_intelligence_notification', { method: 'POST', body: JSON.stringify({
        p_owner_id: owner, p_id: id, p_status: status, p_response_code: responseCode, p_error_code: errorCode
      }) });
    },
    async findCandidatePeers(candidate, owner) {
      const { plausibleSameProject, distinctSourcePublishers } = require('./crosscheck.cjs');
      const result = await tableRows('intelligence_candidates', `owner_id=eq.${encodeURIComponent(owner)}&id=neq.${encodeURIComponent(candidate.id)}&select=*&order=updated_at.desc&limit=100`);
      const peers = result.filter(item => plausibleSameProject(candidate, item));
      if (!peers.length) return [];
      const source = await one(candidate.source_id, owner, true);
      const independent = [];
      for (const item of peers) {
        const other = await one(item.source_id, owner, true);
        if (!distinctSourcePublishers(source, other)) continue;
        independent.push({ ...item, extraction_zh: other.extraction_zh, source_snapshot: { sha256: other.content_sha256, extracted_at: other.extracted_at } });
        if (independent.length === 3) break;
      }
      return independent;
    },
    async saveCrossCheck(candidateId, relatedCandidateId, owner, checked) {
      const relation = checked.conflicting_facts.length ? 'conflicts' : 'supports';
      const reverse = items => items.map(item => ({ left_fact_number: item.right_fact_number, right_fact_number: item.left_fact_number, reason_zh: item.reason_zh }));
      const now = new Date().toISOString();
      const left = checked.source_snapshots?.left, right = checked.source_snapshots?.right;
      const scope = left && right ? checked.same_scope === true : null;
      const records = [
        { owner_id: owner, candidate_id: candidateId, related_candidate_id: relatedCandidateId, relation,
          matching_facts_zh: checked.matching_facts, conflicting_facts_zh: checked.conflicting_facts, checked_at: now, same_scope: scope,
          left_source_sha256: left?.sha256 || null, right_source_sha256: right?.sha256 || null, left_extracted_at: left?.extracted_at || null, right_extracted_at: right?.extracted_at || null },
        { owner_id: owner, candidate_id: relatedCandidateId, related_candidate_id: candidateId, relation,
          matching_facts_zh: reverse(checked.matching_facts), conflicting_facts_zh: reverse(checked.conflicting_facts), checked_at: now, same_scope: scope,
          left_source_sha256: right?.sha256 || null, right_source_sha256: left?.sha256 || null, left_extracted_at: right?.extracted_at || null, right_extracted_at: left?.extracted_at || null }
      ];
      await tableRows('intelligence_candidate_relations', 'on_conflict=owner_id,candidate_id,related_candidate_id', { method: 'POST', body: JSON.stringify(records),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      for (const id of [candidateId, relatedCandidateId]) {
        const current = await relations(owner, [id]);
        const evidenceStatus = current.some(item => item.relation === 'conflicts') ? 'conflict' : 'checked';
        await tableRows('intelligence_candidates', `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`, {
          method: 'PATCH', body: JSON.stringify({ evidence_status: evidenceStatus, updated_at: now })
        });
      }
      return { relation };
    },
    async failExtraction(id, owner, code) {
      await update(id, owner, { extraction_status: 'extraction_failed', extraction_error_code: code });
    },
    async save(source, owner) {
      const publication = publicationMetadata(source.bytes, source.contentType, source.finalUrl, source.excerpt);
      const record = { id: randomUUID(), owner_id: owner, requested_url: source.requestedUrl, final_url: source.finalUrl,
        title: source.title, fetched_at: new Date().toISOString(), ...publication, status: 'saving_evidence',
        content_sha256: source.sha256, content_type: source.contentType, byte_size: source.bytes.length,
        excerpt: source.excerpt, storage_path: `${owner}/${source.sha256}`, error_code: null };
      const inserted = await rows('on_conflict=owner_id,final_url,content_sha256', { method: 'POST', body: JSON.stringify(record),
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' } });
      const existing = inserted?.[0] || (await rows(`owner_id=eq.${encodeURIComponent(owner)}&final_url=eq.${encodeURIComponent(source.finalUrl)}&content_sha256=eq.${source.sha256}&select=*&limit=1`))?.[0];
      if (!existing) throw failure('storage_failed');
      if (!inserted?.length && !existing.publication_method && publication.publication_method) {
        await update(existing.id, owner, publication, '&publication_method=is.null');
      }
      if (!inserted?.length && (existing.title !== source.title || existing.excerpt !== source.excerpt)) {
        await update(existing.id, owner, { title: source.title, excerpt: source.excerpt }, `&content_sha256=eq.${source.sha256}`);
      }
      if (existing.status === 'pending_extraction') {
        if (!existing.archive_status || ['not_queued', 'queue_failed'].includes(existing.archive_status)) {
          try { await enqueueArchive(owner, existing.id); }
          catch {
            await update(existing.id, owner, { archive_status: 'queue_failed' });
            throw failure('archive_queue_failed');
          }
        }
        return { source: await one(existing.id, owner), reused: true };
      }
      try {
        await request(`/storage/v1/object/${BUCKET}/${existing.storage_path}`, { method: 'POST', body: source.bytes,
          headers: { 'Content-Type': source.contentType, 'x-upsert': 'true' } });
        await update(existing.id, owner, { status: 'pending_extraction', error_code: null });
      } catch {
        try { await update(existing.id, owner, { status: 'evidence_failed', error_code: 'storage_failed' }, '&status=neq.pending_extraction'); } catch { /* Keep the existing saving state visible for retry. */ }
        throw failure('storage_failed');
      }
      try { await enqueueArchive(owner, existing.id); }
      catch {
        await update(existing.id, owner, { archive_status: 'queue_failed' });
        throw failure('archive_queue_failed');
      }
      return { source: await one(existing.id, owner), reused: !inserted?.length };
    },
    async recordFailure(url, owner, code) {
      await rows('', { method: 'POST', body: JSON.stringify({ owner_id: owner, requested_url: url, status: 'fetch_failed', error_code: code }) });
    },
    async evidence(id, owner) {
      const source = await one(id, owner, true);
      if (source.status !== 'pending_extraction' || !source.storage_path) throw failure('evidence_not_ready', 409);
      const bytes = await request(`/storage/v1/object/${BUCKET}/${source.storage_path}`, { raw: true });
      return { source, bytes };
    }
  };
}

module.exports = { settings, createStore, failure, organizationKeys };
