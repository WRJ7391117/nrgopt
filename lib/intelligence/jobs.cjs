const { createHash } = require('node:crypto');
const { validateUrl } = require('./source.cjs');
const { reserveAmount, runPaidCall } = require('./budget.cjs');
const { importSourceUrl, extractSavedSource, crossCheckSavedSources, assessSavedHypothesis } = require('./pipeline.cjs');
const { providerSettingsForOwner } = require('./provider-config.cjs');
const { createProviderBalanceReader } = require('./provider-billing.cjs');
const { watchSearchPlan, discoverWatch, expiresAt, active } = require('./watch-search.cjs');
const { registry, registryLinks, registryPlan } = require('./registry.cjs');

const COUNTRIES = ['SA', 'AE', 'QA', 'KW', 'OM', 'BH'];

function scheduleDate(now = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function enqueueDailyScan({ store, owner, now, timeZone = 'Asia/Shanghai' }) {
  const scheduleKey = scheduleDate(now, timeZone);
  const jobId = await store.enqueueJob(owner, 'daily_scan', scheduleKey, []);
  // New entry points must reopen a completed run without resuming a paused one.
  await store.enqueueJobItems(owner, jobId,
    [...COUNTRIES.map(code => `discover:${code}`), ...registry.map(entry => `registry:${entry.id}`)]
      .map(item_key => ({ item_key, checkpoint: {} })));
  await store.reviewTracking(owner);
  const watched = await store.watchedSources(owner);
  const items = [...new Map(watched.map(source => {
    const item = sourceItem(source, null);
    return [item.item_key, { ...item, checkpoint: { url: item.checkpoint.url, watch: true } }];
  })).values()];
  for (let offset = 0; offset < items.length; offset += 60) {
    await store.enqueueJobItems(owner, jobId, items.slice(offset, offset + 60));
  }
  const run = await store.jobRun(owner, jobId);
  if (!run.items.some(item => /^watchsearch:[0-9]$/.test(item.item_key))) {
    const plan = watchSearchPlan(await store.watchSearchTargets(owner, now), scheduleKey);
    if (plan.length) await store.enqueueJobItems(owner, jobId, plan);
  }
  return { jobId, scheduleKey };
}

function sourceItem(result, country) {
  const originalUrl = validateUrl(result?.url).href;
  const canonical = new URL(originalUrl);
  if (['omanpwp.om', 'www.omanpwp.om'].includes(canonical.hostname)
    && /^\/(?:public\/)?news-details\/[^/]+\/?$/.test(canonical.pathname)) {
    canonical.hostname = 'www.omanpwp.om';
    canonical.pathname = canonical.pathname.replace(/^\/public\//, '/');
  }
  const url = canonical.href;
  return { item_key: `source:${createHash('sha256').update(url).digest('hex')}`,
    checkpoint: { country, url, ...(url === originalUrl ? {} : { discovered_url: originalUrl }) } };
}

async function finishRetry(store, owner, item, checkpoint, code) {
  const status = item.attempts >= 3 ? 'failed' : 'retry';
  const finished = await store.finishJobItem(owner, item.id, status, checkpoint, code, item.attempts);
  return { status: finished ? status : 'lease_lost', itemId: item.id, itemKey: item.item_key, jobId: item.job_run_id };
}

async function runDailyJobItem({ store, owner, jobId, env = process.env, discover, sourceFetcher, modelFactory, crossCheckFactory,
  hypothesisFactory, watchDiscover = discoverWatch, now = new Date(), balanceReaderFactory = createProviderBalanceReader }) {
  const item = await store.claimJobItem(owner, jobId ?? null, 300);
  if (!item) return { status: 'idle' };
  jobId = item.job_run_id || jobId;
  const finish = async (status, checkpoint, code = null) => {
    if (!await store.finishJobItem(owner, item.id, status, checkpoint, code, item.attempts)) {
      throw Object.assign(new Error('lease_lost'), { code: 'lease_lost' });
    }
  };
  const country = /^discover:(SA|AE|QA|KW|OM|BH)$/.exec(item.item_key)?.[1];
  const entry = registry.find(value => item.item_key === `registry:${value.id}`);
  if (entry) {
    const checkpoint = { registry_id: entry.id, name: entry.name, url: entry.url, country: entry.country };
    try {
      if (await store.sourcePaused(owner, entry.url)) {
        await finish('manual_paused', { ...checkpoint, source_host: new URL(entry.url).hostname.replace(/^www\./, '') }, 'source_paused');
        return { status: 'manual_paused', jobId, itemId: item.id, itemKey: item.item_key };
      }
      const previous = await store.registryCursor(owner, item.item_key, jobId);
      const source = await sourceFetcher(entry.url);
      const links = registryLinks(entry, source);
      const plan = registryPlan(links, previous);
      const next = plan.urls.map(url => sourceItem({ url }, entry.country));
      if (next.length && await store.enqueueJobItems(owner, jobId, next) == null) throw new Error('enqueue_failed');
      await finish('succeeded', { ...checkpoint, ...plan, result_urls: plan.urls,
        checked_at: new Date(now).toISOString(), listed_count: links.length,
        outcome: plan.fresh_count ? 'sources_found' : 'no_new_links' });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, resultCount: next.length };
    } catch (error) {
      const code = /^(source|registry)_[a-z_]{1,40}$/.test(error?.code || '') ? error.code : 'registry_failed';
      return finishRetry(store, owner, item, checkpoint, code);
    }
  }
  if (country) {
    try {
      const providers = await providerSettingsForOwner(env, store, owner);
      const discovery = await runPaidCall({ store, owner, jobId, operation: 'discovery', currency: providers.discovery.currency,
        budgetKey: providers.discovery.budgetKey, budgetLimitMicro: providers.discovery.budgetLimitMicro,
        profile: providers.discovery, billingMode: providers.discovery.billingMode, readBalance: balanceReaderFactory(providers.discovery),
        providerMissingCode: 'discovery_not_configured', env,
        idempotencyKey: `${jobId}:${item.item_key}:${item.attempts}`, call: () => discover(country, providers.discovery, item.attempts) });
      const items = [];
      for (const result of (Array.isArray(discovery.sources) ? discovery.sources : []).slice(0, 20)) {
        try { items.push(sourceItem(result, country)); } catch { /* Invalid provider URLs do not become work items. */ }
      }
      const uniqueItems = [...new Map(items.map(value => [value.item_key, value])).values()];
      if (uniqueItems.length) await store.enqueueJobItems(owner, jobId, uniqueItems);
      await finish('succeeded', { country, result_urls: uniqueItems.map(value => value.checkpoint.url) });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, country, resultCount: uniqueItems.length };
    } catch (error) {
      if (['discovery_balance_insufficient', 'discovery_plan_unavailable', 'budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', { country }, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key, country };
      }
      return finishRetry(store, owner, item, { country }, error?.code === 'discovery_no_primary_sources'
        ? error.code : 'discovery_failed');
    }
  }

  if (/^watchsearch:[0-9]$/.test(item.item_key)) {
    const plan = item.checkpoint;
    try {
      if (!COUNTRIES.includes(plan?.country) || !['support', 'counter'].includes(plan.intent)
        || typeof plan.query !== 'string' || plan.query.length > 1600 || !Array.isArray(plan.hypothesis_ids)
        || !plan.hypothesis_ids.length || plan.hypothesis_ids.length > 4) throw new Error('invalid_watch_plan');
      const hypotheses = await Promise.all(plan.hypothesis_ids.map(id => store.hypothesis(id, owner)));
      const current = hypotheses.filter(h => active(h) && Date.parse(expiresAt(h)) > new Date(now).getTime()
        && h.candidate.source_id === plan.source_id);
      if (!current.length) {
        await finish('succeeded', { ...plan, outcome: 'watch_window_closed', result_urls: [] });
        return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, resultCount: 0 };
      }
      const providers = await providerSettingsForOwner(env, store, owner);
      const discovery = await runPaidCall({ store, owner, jobId, operation: 'discovery', currency: providers.discovery.currency,
        budgetKey: providers.discovery.budgetKey, budgetLimitMicro: providers.discovery.budgetLimitMicro,
        profile: providers.discovery, billingMode: providers.discovery.billingMode, readBalance: balanceReaderFactory(providers.discovery), env,
        idempotencyKey: `${jobId}:${item.item_key}:${item.attempts}`, call: () => watchDiscover(plan, providers.discovery) });
      const sources = new Map();
      for (const result of discovery.sources || []) {
        try {
          const next = sourceItem(result, plan.country);
          sources.set(next.item_key, { item_key: `watchsource:${item.item_key.split(':')[1]}:${next.item_key.slice(7)}`,
            checkpoint: { ...next.checkpoint, hypothesis_ids: current.map(h => h.id) } });
        } catch { /* Unsafe result URLs never enter collection. */ }
        if (sources.size === 2) break;
      }
      const next = [...sources.values()];
      if (next.length) await store.enqueueJobItems(owner, jobId, next);
      await finish('succeeded', { ...plan, result_urls: next.map(s => s.checkpoint.url),
        outcome: next.length ? 'sources_found' : 'no_new_evidence' });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, resultCount: next.length };
    } catch (error) {
      if (['discovery_balance_insufficient', 'discovery_plan_unavailable', 'budget_not_configured', 'budget_exhausted',
        'billing_sync_not_configured', 'billing_sync_unavailable', 'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', plan, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key };
      }
      return finishRetry(store, owner, item, plan, 'watch_search_failed');
    }
  }

  if (/^(source|watchsource:[0-9]):[a-f0-9]{64}$/.test(item.item_key) && typeof item.checkpoint?.url === 'string') {
    try {
      if (await store.sourcePaused(owner, item.checkpoint.url)) {
        await finish('manual_paused', { ...item.checkpoint, source_host: new URL(item.checkpoint.url).hostname.replace(/^www\./, '') }, 'source_paused');
        return { status: 'manual_paused', jobId, itemId: item.id, itemKey: item.item_key };
      }
      const saved = await importSourceUrl({ store, owner, url: item.checkpoint.url, sourceFetcher });
      const unchanged = saved.reused && saved.source.extraction_status === 'extracted'
        && saved.source.extraction_source_sha256 === saved.source.content_sha256 && saved.extraction_current !== false;
      if (!unchanged) await store.enqueueJobItems(owner, jobId, [{ item_key: `extract:${saved.source.id}`, checkpoint: { source_id: saved.source.id } }]);
      if (item.item_key.startsWith('watchsource:')) {
        const targets = item.checkpoint.hypothesis_ids;
        if (!Array.isArray(targets) || !targets.length || targets.length > 4) throw new Error('invalid_watch_targets');
        await store.enqueueJobItems(owner, jobId, targets.map(id => ({ item_key: `hypothesis:${id}:${saved.source.id}`,
          checkpoint: { hypothesis_id: id, source_id: saved.source.id } })));
      }
      await finish('succeeded', { ...item.checkpoint, source_id: saved.source.id, reused: saved.reused, unchanged });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, sourceId: saved.source.id };
    } catch (error) {
      const code = error?.sourceCode || error?.code;
      if (code === 'source_listing_page') {
        await finish('failed', item.checkpoint, code);
        return { status: 'failed', jobId, itemId: item.id, itemKey: item.item_key };
      }
      return finishRetry(store, owner, item, item.checkpoint,
        /^source_[a-z_]{1,40}$/.test(code || '') || ['storage_constraint', 'storage_failed', 'upstream_unavailable'].includes(code) ? code : 'source_failed');
    }
  }

  const sourceId = /^extract:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(item.item_key)?.[1];
  if (sourceId && item.checkpoint?.source_id === sourceId) {
    try {
      await extractSavedSource({ store, owner, sourceId, env, modelFactory, crossCheckFactory, jobId,
        idempotencyPrefix: `${jobId}:${item.id}:${item.attempts}`, balanceReaderFactory,
        formatRepairCode: item.checkpoint.format_repair_code || null });
      await finish('succeeded', item.checkpoint);
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', item.checkpoint, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
      }
      if (error?.code === 'source_empty_document') {
        await finish('failed', item.checkpoint, error.code);
        return { status: 'failed', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
      }
      const invalid = error?.code === 'extraction_invalid'
        || /^extraction_invalid_[a-z_]{1,40}$/.test(error?.code || '');
      if (item.checkpoint.format_repair_code) {
        await finish('failed', item.checkpoint, invalid ? error.code : 'extraction_failed');
        return { status: 'failed', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
      }
      if (invalid && item.attempts >= 3) {
        await finish('failed', item.checkpoint, error.code);
        return { status: 'failed', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
      }
      const providerCode = ['model_rate_limited', 'model_timeout'].includes(error?.code) ? error.code : 'extraction_failed';
      return finishRetry(store, owner, item,
        invalid ? { ...item.checkpoint, format_repair_code: error.code } : item.checkpoint,
        invalid ? error.code : providerCode);
    }
  }

  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  if (new RegExp(`^hypothesis:${uuid}:${uuid}$`, 'i').test(item.item_key)
    && item.item_key === `hypothesis:${item.checkpoint?.hypothesis_id}:${item.checkpoint?.source_id}`) {
    try {
      const result = await assessSavedHypothesis({ store, owner, jobId, env, hypothesisFactory, balanceReaderFactory,
        hypothesisId: item.checkpoint.hypothesis_id, sourceId: item.checkpoint.source_id,
        idempotencyPrefix: `${jobId}:${item.id}:${item.attempts}` });
      await finish('succeeded', result?.skipped ? { ...item.checkpoint, outcome: result.skipped } : item.checkpoint);
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', item.checkpoint, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key };
      }
      return finishRetry(store, owner, item, item.checkpoint, 'hypothesis_failed');
    }
  }
  if (new RegExp(`^cross:${uuid}:${uuid}$`, 'i').test(item.item_key)
    && item.item_key === `cross:${[item.checkpoint?.left_source_id, item.checkpoint?.right_source_id].sort().join(':')}`) {
    try {
      await crossCheckSavedSources({ store, owner, jobId, env, crossCheckFactory, balanceReaderFactory,
        leftSourceId: item.checkpoint.left_source_id, rightSourceId: item.checkpoint.right_source_id,
        idempotencyPrefix: `${jobId}:${item.id}:${item.attempts}` });
      await finish('succeeded', item.checkpoint);
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', item.checkpoint, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key };
      }
      return finishRetry(store, owner, item, item.checkpoint, 'cross_check_failed');
    }
  }

  await finish('failed', item.checkpoint, 'invalid_job_item');
  return { status: 'failed', jobId, itemId: item.id, itemKey: item.item_key };
}

module.exports = { COUNTRIES, scheduleDate, reserveAmount, runPaidCall, enqueueDailyScan, runDailyJobItem, sourceItem };
