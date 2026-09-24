const { createHash } = require('node:crypto');
const { validateUrl } = require('./source.cjs');
const { reserveAmount, runPaidCall } = require('./budget.cjs');
const { importSourceUrl, extractSavedSource, crossCheckSavedSources } = require('./pipeline.cjs');
const { providerSettingsForOwner } = require('./provider-config.cjs');
const { createProviderBalanceReader } = require('./provider-billing.cjs');

const COUNTRIES = ['SA', 'AE', 'QA', 'KW', 'OM', 'BH'];

function scheduleDate(now = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function enqueueDailyScan({ store, owner, now, timeZone = 'Asia/Shanghai' }) {
  const scheduleKey = scheduleDate(now, timeZone);
  const jobId = await store.enqueueJob(owner, 'daily_scan', scheduleKey, COUNTRIES.map(code => `discover:${code}`));
  return { jobId, scheduleKey };
}

function sourceItem(result, country) {
  const url = validateUrl(result?.url).href;
  return { item_key: `source:${createHash('sha256').update(url).digest('hex')}`, checkpoint: { country, url } };
}

async function finishRetry(store, owner, item, checkpoint, code) {
  const status = item.attempts >= 3 ? 'failed' : 'retry';
  const finished = await store.finishJobItem(owner, item.id, status, checkpoint, code, item.attempts);
  return { status: finished ? status : 'lease_lost', itemId: item.id, itemKey: item.item_key, jobId: item.job_run_id };
}

async function runDailyJobItem({ store, owner, jobId, env = process.env, discover, sourceFetcher, modelFactory, crossCheckFactory,
  balanceReaderFactory = createProviderBalanceReader }) {
  const item = await store.claimJobItem(owner, jobId ?? null, 300);
  if (!item) return { status: 'idle' };
  jobId = item.job_run_id || jobId;
  const finish = async (status, checkpoint, code = null) => {
    if (!await store.finishJobItem(owner, item.id, status, checkpoint, code, item.attempts)) {
      throw Object.assign(new Error('lease_lost'), { code: 'lease_lost' });
    }
  };
  const country = /^discover:(SA|AE|QA|KW|OM|BH)$/.exec(item.item_key)?.[1];
  if (country) {
    try {
      const providers = await providerSettingsForOwner(env, store, owner);
      const discovery = await runPaidCall({ store, owner, jobId, operation: 'discovery', currency: providers.discovery.currency,
        budgetKey: providers.discovery.budgetKey, budgetLimitMicro: providers.discovery.budgetLimitMicro,
        billingMode: providers.discovery.billingMode, readBalance: balanceReaderFactory(providers.discovery),
        providerMissingCode: 'discovery_not_configured', env,
        idempotencyKey: `${jobId}:${item.item_key}:${item.attempts}`, call: () => discover(country, providers.discovery) });
      const items = [];
      for (const result of (Array.isArray(discovery.sources) ? discovery.sources : []).slice(0, 20)) {
        try { items.push(sourceItem(result, country)); } catch { /* Invalid provider URLs do not become work items. */ }
      }
      const uniqueItems = [...new Map(items.map(value => [value.item_key, value])).values()];
      if (uniqueItems.length) await store.enqueueJobItems(owner, jobId, uniqueItems);
      await finish('succeeded', { country, result_urls: uniqueItems.map(value => value.checkpoint.url) });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, country, resultCount: uniqueItems.length };
    } catch (error) {
      if (['discovery_balance_insufficient', 'budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', { country }, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key, country };
      }
      return finishRetry(store, owner, item, { country }, 'discovery_failed');
    }
  }

  if (/^source:[a-f0-9]{64}$/.test(item.item_key) && typeof item.checkpoint?.url === 'string') {
    try {
      const saved = await importSourceUrl({ store, owner, url: item.checkpoint.url, sourceFetcher });
      const unchanged = saved.reused && saved.source.extraction_status === 'extracted'
        && saved.source.extraction_source_sha256 === saved.source.content_sha256;
      if (!unchanged) await store.enqueueJobItems(owner, jobId, [{ item_key: `extract:${saved.source.id}`, checkpoint: { source_id: saved.source.id } }]);
      await finish('succeeded', { ...item.checkpoint, source_id: saved.source.id, reused: saved.reused, unchanged });
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, sourceId: saved.source.id };
    } catch {
      return finishRetry(store, owner, item, item.checkpoint, 'source_failed');
    }
  }

  const sourceId = /^extract:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(item.item_key)?.[1];
  if (sourceId && item.checkpoint?.source_id === sourceId) {
    try {
      await extractSavedSource({ store, owner, sourceId, env, modelFactory, crossCheckFactory, jobId,
        idempotencyPrefix: `${jobId}:${item.id}:${item.attempts}`, balanceReaderFactory });
      await finish('succeeded', item.checkpoint);
      return { status: 'succeeded', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted', 'billing_sync_not_configured', 'billing_sync_unavailable',
        'billing_sync_auth_failed', 'billing_sync_pending'].includes(error?.code)) {
        await finish('budget_paused', item.checkpoint, error.code);
        return { status: 'budget_paused', jobId, itemId: item.id, itemKey: item.item_key, sourceId };
      }
      return finishRetry(store, owner, item, item.checkpoint, 'extraction_failed');
    }
  }

  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
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
