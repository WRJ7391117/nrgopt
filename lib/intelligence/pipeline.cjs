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
  try {
    result = await runPaidCall({ store, owner, jobId, operation: 'extraction', currency: configuredProviders.analysis.currency,
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
      ? error.code : 'model_unavailable';
    if (started) try { await store.failExtraction(source.id, owner, code); } catch { /* Preserve the original error. */ }
    throw error;
  }
  const saved = await store.saveExtraction(source.id, owner, result, source.content_sha256);
  const candidate = await store.saveCandidate(source.id, owner, result.extraction, source.content_sha256);
  const peers = await store.findCandidatePeers(candidate, owner);
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

module.exports = { importSourceUrl, extractSavedSource };
