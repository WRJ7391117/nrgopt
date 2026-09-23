const { createHash } = require('node:crypto');
const { validateUrl } = require('./source.cjs');
const { reserveAmount, runPaidCall } = require('./budget.cjs');
const { importSourceUrl, extractSavedSource } = require('./pipeline.cjs');
const { providerSettings } = require('./provider-config.cjs');

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
  await store.finishJobItem(owner, item.id, 'retry', checkpoint, code);
  return { status: 'retry', itemId: item.id, itemKey: item.item_key };
}

async function runDailyJobItem({ store, owner, jobId, env = process.env, discover, sourceFetcher, modelFactory, crossCheckFactory }) {
  const providers = providerSettings(env);
  const item = await store.claimJobItem(owner, jobId, 240);
  if (!item) return { status: 'idle' };
  const country = /^discover:(SA|AE|QA|KW|OM|BH)$/.exec(item.item_key)?.[1];
  if (country) {
    try {
      const discovery = await runPaidCall({ store, owner, jobId, operation: 'discovery', currency: providers.discovery.currency,
        budgetKey: providers.discovery.reserveKey, providerMissingCode: 'discovery_not_configured', env,
        idempotencyKey: `${jobId}:${item.item_key}:${item.attempts}`, call: () => discover(country) });
      const items = [];
      for (const result of (Array.isArray(discovery.sources) ? discovery.sources : []).slice(0, 20)) {
        try { items.push(sourceItem(result, country)); } catch { /* Invalid provider URLs do not become work items. */ }
      }
      const uniqueItems = [...new Map(items.map(value => [value.item_key, value])).values()];
      if (uniqueItems.length) await store.enqueueJobItems(owner, jobId, uniqueItems);
      await store.finishJobItem(owner, item.id, 'succeeded', { country, result_urls: uniqueItems.map(value => value.checkpoint.url) });
      return { status: 'succeeded', itemId: item.id, itemKey: item.item_key, country, resultCount: uniqueItems.length };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted'].includes(error?.code)) {
        await store.finishJobItem(owner, item.id, 'budget_paused', { country }, error.code);
        return { status: 'budget_paused', itemId: item.id, itemKey: item.item_key, country };
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
      await store.finishJobItem(owner, item.id, 'succeeded', { ...item.checkpoint, source_id: saved.source.id, reused: saved.reused, unchanged });
      return { status: 'succeeded', itemId: item.id, itemKey: item.item_key, sourceId: saved.source.id };
    } catch {
      return finishRetry(store, owner, item, item.checkpoint, 'source_failed');
    }
  }

  const sourceId = /^extract:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(item.item_key)?.[1];
  if (sourceId && item.checkpoint?.source_id === sourceId) {
    try {
      await extractSavedSource({ store, owner, sourceId, env, modelFactory, crossCheckFactory, jobId,
        idempotencyPrefix: `${jobId}:${item.id}:${item.attempts}` });
      await store.finishJobItem(owner, item.id, 'succeeded', item.checkpoint);
      return { status: 'succeeded', itemId: item.id, itemKey: item.item_key, sourceId };
    } catch (error) {
      if (['budget_not_configured', 'budget_exhausted'].includes(error?.code)) {
        await store.finishJobItem(owner, item.id, 'budget_paused', item.checkpoint, error.code);
        return { status: 'budget_paused', itemId: item.id, itemKey: item.item_key, sourceId };
      }
      return finishRetry(store, owner, item, item.checkpoint, 'extraction_failed');
    }
  }

  await store.finishJobItem(owner, item.id, 'failed', item.checkpoint, 'invalid_job_item');
  return { status: 'failed', itemId: item.id, itemKey: item.item_key };
}

module.exports = { COUNTRIES, scheduleDate, reserveAmount, runPaidCall, enqueueDailyScan, runDailyJobItem, sourceItem };
