const { randomUUID } = require('node:crypto');
const { extractDocument, isPlaceholderDocument, validateUrl } = require('./source.cjs');
const { runPaidCall } = require('./budget.cjs');
const { providerSettingsForOwner } = require('./provider-config.cjs');
const { createProviderBalanceReader } = require('./provider-billing.cjs');
const { validateExtraction } = require('./deepseek.cjs');
const { distinctSourcePublishers } = require('./crosscheck.cjs');
const { createHypothesisEvaluator, validateAssessment } = require('./hypotheses.cjs');
const { registry } = require('./registry.cjs');

const listingPages = new Set([...registry.map(entry => entry.url), 'https://www.omanpwp.om/public/index.php/news']);

function extractionFitsDocument(source, text) {
  if (source.extraction_status !== 'extracted' || source.extraction_source_sha256 !== source.content_sha256) return false;
  try { validateExtraction(source.extraction_zh, text); return true; } catch { return false; }
}

async function importSourceUrl({ store, owner, url, sourceFetcher }) {
  validateUrl(url);
  if (listingPages.has(new URL(url).href)) {
    throw Object.assign(new Error('source_listing_page'), { code: 'source_listing_page', status: 422 });
  }
  let source;
  try { source = await sourceFetcher(url); }
  catch (error) {
    const code = /^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'source_failed';
    try { await store.recordFailure(url, owner, code); } catch { throw Object.assign(new Error('storage_failed'), { code: 'storage_failed' }); }
    throw Object.assign(new Error('source_failed'), { code: 'source_failed', sourceCode: code, status: 422 });
  }
  if (listingPages.has(source.finalUrl)) {
    throw Object.assign(new Error('source_listing_page'), { code: 'source_listing_page', status: 422 });
  }
  const saved = await store.save(source, owner);
  if (saved.reused && source.bytes) {
    saved.extraction_current = extractionFitsDocument(saved.source, extractDocument(source.bytes, source.contentType, 12_000, source.finalUrl).excerpt);
  }
  return saved;
}

async function extractSavedSource({ store, owner, sourceId, env, modelFactory, crossCheckFactory, jobId = null,
  idempotencyPrefix = `manual:${sourceId}:${randomUUID()}`, providers = null,
  balanceReaderFactory = createProviderBalanceReader, formatRepairCode = null }) {
  const { source, bytes } = await store.evidence(sourceId, owner);
  const sourceText = extractDocument(bytes, source.content_type, 12_000, source.final_url).excerpt;
  if (!sourceText || isPlaceholderDocument(source.final_url, source.title)) {
    await store.failExtraction(source.id, owner, 'source_empty_document');
    throw Object.assign(new Error('source_empty_document'), { code: 'source_empty_document', status: 422 });
  }
  const configuredProviders = providers || await providerSettingsForOwner(env, store, owner);
  let started = false;
  let result;
  const reused = jobId && extractionFitsDocument(source, sourceText);
  let previousResult;
  if (jobId && !reused) {
    const previous = await store.previousExtractedSource(source, owner);
    if (previous && previous.title === source.title && previous.final_url === source.final_url
      && previous.extraction_source_sha256 === previous.content_sha256 && previous.extraction_zh) {
      const evidence = await store.evidence(previous.id, owner);
      if (extractDocument(evidence.bytes, previous.content_type, 12_000, previous.final_url).excerpt === sourceText
        && extractionFitsDocument(previous, sourceText)) {
        previousResult = {
          extraction: { ...validateExtraction(previous.extraction_zh, sourceText), reused_from_source_id: previous.id },
          provider: previous.extraction_provider, model: previous.extraction_model, configVersionId: previous.extraction_config_version_id,
          extractedAt: previous.extracted_at, usage: { reused_from_source_id: previous.id }
        };
      }
    }
  }
  try {
    result = reused ? { extraction: source.extraction_zh } : previousResult || await runPaidCall({ store, owner, jobId, operation: 'extraction', currency: configuredProviders.analysis.currency,
      budgetKey: configuredProviders.analysis.budgetKey, budgetLimitMicro: configuredProviders.analysis.budgetLimitMicro,
      profile: configuredProviders.analysis, billingMode: configuredProviders.analysis.billingMode, readBalance: balanceReaderFactory(configuredProviders.analysis),
      providerMissingCode: 'model_not_configured', env,
      idempotencyKey: `${idempotencyPrefix}:extraction`, call: async () => {
        await store.beginExtraction(source.id, owner);
        started = true;
        return modelFactory(configuredProviders.analysis)({ title: source.title, url: source.final_url, sourceText, formatRepairCode });
      } });
  } catch (error) {
    const code = ['model_not_configured', 'model_auth_failed', 'model_unavailable', 'extraction_invalid'].includes(error?.code)
      || /^extraction_invalid_[a-z_]{1,40}$/.test(error?.code || '') ? error.code : 'model_unavailable';
    if (started) try { await store.failExtraction(source.id, owner, code); } catch { /* Preserve the original error. */ }
    throw error;
  }
  const saved = reused ? source : await store.saveExtraction(source.id, owner, result, source.content_sha256);
  const candidate = await store.saveCandidate(source.id, owner, result.extraction, source.content_sha256);
  const targets = await store.assessmentTargets(candidate, { ...source, extraction_zh: result.extraction }, owner);
  if (targets.length) {
    const assessmentJob = jobId || await store.enqueueJob(owner, 'daily_scan', require('./jobs.cjs').scheduleDate(), []);
    await store.enqueueJobItems(owner, assessmentJob, targets.map(h => ({
      item_key: `hypothesis:${h.id}:${source.id}`, checkpoint: { hypothesis_id: h.id, source_id: source.id }
    })));
  }
  const peers = await store.findCandidatePeers(candidate, owner);
  if (jobId && peers.length) {
    await store.enqueueJobItems(owner, jobId, peers.map(peer => ({
      item_key: `cross:${[source.id, peer.source_id].sort().join(':')}`,
      checkpoint: { left_source_id: source.id, right_source_id: peer.source_id }
    })));
    return { source: saved, candidate };
  }
  if (peers.length) {
    const crossCheck = crossCheckFactory(configuredProviders.analysis);
    for (const peer of peers) {
      try {
        const checked = await runPaidCall({ store, owner, jobId, operation: 'cross_check', currency: configuredProviders.analysis.currency,
          budgetKey: configuredProviders.analysis.budgetKey, budgetLimitMicro: configuredProviders.analysis.budgetLimitMicro,
          profile: configuredProviders.analysis, billingMode: configuredProviders.analysis.billingMode, readBalance: balanceReaderFactory(configuredProviders.analysis),
          providerMissingCode: 'model_not_configured', env,
          idempotencyKey: `${idempotencyPrefix}:cross:${peer.id}`,
          call: () => crossCheck({ left: { ...candidate, extraction_zh: result.extraction }, right: peer }) });
        if (checked.same_project) await store.saveCrossCheck(candidate.id, peer.id, owner, { ...checked, source_snapshots: { left: { sha256: saved.content_sha256, extracted_at: saved.extracted_at }, right: peer.source_snapshot } });
      } catch { /* The validated extraction remains usable; a later job can retry cross-checking. */ }
    }
  }
  return { source: saved, candidate };
}

async function crossCheckSavedSources({ store, owner, leftSourceId, rightSourceId, env, jobId,
  idempotencyPrefix, crossCheckFactory, balanceReaderFactory = createProviderBalanceReader }) {
  const left = await store.candidateBySource(leftSourceId, owner);
  const right = await store.candidateBySource(rightSourceId, owner);
  if (!left || !right) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  if (left.related_sources?.some(item => item.related_candidate_id === right.id && typeof item.same_scope === 'boolean')) return;
  const leftSource = await store.get(leftSourceId, owner);
  const rightSource = await store.get(rightSourceId, owner);
  if (!distinctSourcePublishers(leftSource, rightSource)) return;
  const providers = await providerSettingsForOwner(env, store, owner);
  const checked = await runPaidCall({ store, owner, jobId, operation: 'cross_check', currency: providers.analysis.currency,
    budgetKey: providers.analysis.budgetKey, budgetLimitMicro: providers.analysis.budgetLimitMicro,
    profile: providers.analysis, billingMode: providers.analysis.billingMode, readBalance: balanceReaderFactory(providers.analysis), env,
    idempotencyKey: `${idempotencyPrefix}:cross`, call: async () => crossCheckFactory(providers.analysis)({
      left: { ...left, extraction_zh: leftSource.extraction_zh },
      right: { ...right, extraction_zh: rightSource.extraction_zh }
    }) });
  if (checked.same_project) await store.saveCrossCheck(left.id, right.id, owner, { ...checked, source_snapshots: { left: { sha256: leftSource.content_sha256, extracted_at: leftSource.extracted_at }, right: { sha256: rightSource.content_sha256, extracted_at: rightSource.extracted_at } } });
}

async function assessSavedHypothesis({ store, owner, hypothesisId, sourceId, env, jobId, idempotencyPrefix,
  hypothesisFactory = createHypothesisEvaluator, balanceReaderFactory = createProviderBalanceReader }) {
  const hypothesis = await store.hypothesis(hypothesisId, owner);
  if (hypothesis.current_in_analysis === false) return { skipped: 'not_in_current_analysis' };
  if (!['open', 'strengthened', 'weakened'].includes(hypothesis.status)) return;
  const { source, bytes } = await store.evidence(sourceId, owner);
  if (await store.hypothesisAssessment(hypothesis.id, source, owner)) return;
  const originalEvidence = await store.evidence(hypothesis.candidate.source_id, owner);
  const original = originalEvidence.source;
  if (original.id === source.id || original.content_sha256 === source.content_sha256) return;
  const evidenceTexts = [];
  for (const evidence of [originalEvidence, { source, bytes }]) {
    if (evidence.source.extraction_status !== 'extracted' || evidence.source.extraction_source_sha256 !== evidence.source.content_sha256) {
      throw Object.assign(new Error('hypothesis_invalid'), { code: 'hypothesis_invalid' });
    }
    const text = extractDocument(evidence.bytes, evidence.source.content_type, 12_000, evidence.source.final_url).excerpt;
    validateExtraction(evidence.source.extraction_zh, text);
    evidenceTexts.push(text);
  }
  if (original.final_url === source.final_url && original.title === source.title && evidenceTexts[0] === evidenceTexts[1]) return;
  const providers = await providerSettingsForOwner(env, store, owner);
  const checked = await runPaidCall({ store, owner, jobId, operation: 'cross_check', currency: providers.analysis.currency,
    budgetKey: providers.analysis.budgetKey, budgetLimitMicro: providers.analysis.budgetLimitMicro,
    profile: providers.analysis, billingMode: providers.analysis.billingMode, readBalance: balanceReaderFactory(providers.analysis), env,
    idempotencyKey: `${idempotencyPrefix}:hypothesis`, call: () => hypothesisFactory(providers.analysis)({ hypothesis, original, source }) });
  validateAssessment(checked, source.extraction_zh.known_facts);
  return store.saveHypothesisAssessment(hypothesis, source, owner, checked);
}

module.exports = { importSourceUrl, extractSavedSource, crossCheckSavedSources, assessSavedHypothesis };
