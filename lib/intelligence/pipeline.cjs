const { randomUUID } = require('node:crypto');
const { extractDocument, validateUrl } = require('./source.cjs');
const { runPaidCall } = require('./budget.cjs');
const { providerSettingsForOwner } = require('./provider-config.cjs');
const { createProviderBalanceReader } = require('./provider-billing.cjs');

async function importSourceUrl({ store, owner, url, sourceFetcher }) {
  validateUrl(url);
  let source;
  try { source = await sourceFetcher(url); }
  catch (error) {
    const code = /^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'source_failed';
    try { await store.recordFailure(url, owner, code); } catch { throw Object.assign(new Error('storage_failed'), { code: 'storage_failed' }); }
    throw Object.assign(new Error('source_failed'), { code: 'source_failed', sourceCode: code, status: 422 });
  }
  return store.save(source, owner);
}

async function extractSavedSource({ store, owner, sourceId, env, modelFactory, crossCheckFactory, jobId = null,
  idempotencyPrefix = `manual:${sourceId}:${randomUUID()}`, providers = null,
  balanceReaderFactory = createProviderBalanceReader }) {
  const { source, bytes } = await store.evidence(sourceId, owner);
  const sourceText = extractDocument(bytes, source.content_type, 12_000).excerpt;
  const configuredProviders = providers || await providerSettingsForOwner(env, store, owner);
  let started = false;
  let result;
  const reused = jobId && source.extraction_status === 'extracted'
    && source.extraction_source_sha256 === source.content_sha256 && source.extraction_zh;
  try {
    result = reused ? { extraction: source.extraction_zh } : await runPaidCall({ store, owner, jobId, operation: 'extraction', currency: configuredProviders.analysis.currency,
      budgetKey: configuredProviders.analysis.budgetKey, budgetLimitMicro: configuredProviders.analysis.budgetLimitMicro,
      billingMode: configuredProviders.analysis.billingMode, readBalance: balanceReaderFactory(configuredProviders.analysis),
      providerMissingCode: 'model_not_configured', env,
      idempotencyKey: `${idempotencyPrefix}:extraction`, call: async () => {
        await store.beginExtraction(source.id, owner);
        started = true;
        return modelFactory(configuredProviders.analysis)({ title: source.title, url: source.final_url, sourceText });
      } });
  } catch (error) {
    const code = ['model_not_configured', 'model_auth_failed', 'model_unavailable', 'extraction_invalid'].includes(error?.code)
      || /^extraction_invalid_[a-z_]{1,40}$/.test(error?.code || '') ? error.code : 'model_unavailable';
    if (started) try { await store.failExtraction(source.id, owner, code); } catch { /* Preserve the original error. */ }
    throw error;
  }
  const saved = reused ? source : await store.saveExtraction(source.id, owner, result, source.content_sha256);
  const candidate = await store.saveCandidate(source.id, owner, result.extraction, source.content_sha256);
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
          billingMode: configuredProviders.analysis.billingMode, readBalance: balanceReaderFactory(configuredProviders.analysis),
          providerMissingCode: 'model_not_configured', env,
          idempotencyKey: `${idempotencyPrefix}:cross:${peer.id}`,
          call: () => crossCheck({ left: { ...candidate, extraction_zh: result.extraction }, right: peer }) });
        if (checked.same_project) await store.saveCrossCheck(candidate.id, peer.id, owner, checked);
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
  if (left.related_sources?.some(item => item.related_candidate_id === right.id)) return;
  const providers = await providerSettingsForOwner(env, store, owner);
  const checked = await runPaidCall({ store, owner, jobId, operation: 'cross_check', currency: providers.analysis.currency,
    budgetKey: providers.analysis.budgetKey, budgetLimitMicro: providers.analysis.budgetLimitMicro,
    billingMode: providers.analysis.billingMode, readBalance: balanceReaderFactory(providers.analysis), env,
    idempotencyKey: `${idempotencyPrefix}:cross`, call: async () => crossCheckFactory(providers.analysis)({
      left: { ...left, extraction_zh: (await store.get(leftSourceId, owner)).extraction_zh },
      right: { ...right, extraction_zh: (await store.get(rightSourceId, owner)).extraction_zh }
    }) });
  if (checked.same_project) await store.saveCrossCheck(left.id, right.id, owner, checked);
}

module.exports = { importSourceUrl, extractSavedSource, crossCheckSavedSources };
