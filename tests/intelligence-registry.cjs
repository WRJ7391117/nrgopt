const test = require('node:test');
const assert = require('node:assert/strict');
const { registry, registryLinks, registryPlan } = require('../lib/intelligence/registry.cjs');
const { runDailyJobItem } = require('../lib/intelligence/jobs.cjs');
const { createStore, settings } = require('../lib/intelligence/store.cjs');

const entry = registry[0];
const article = slug => `${entry.url}${slug}/`;
const source = html => ({ finalUrl: entry.url, bytes: Buffer.from(html) });

test('registry only follows observed article patterns on its official host', () => {
  const html = `<a href="${entry.url}">index</a><a href="${article('one')}?utm_source=test#x">one</a>
    <a href="${article('one')}">duplicate</a><a href="https://evil.example/en/media-center/latest-news/two/">other host</a>
    <a href="http://www.acwapower.com/en/media-center/latest-news/two/">insecure</a><a href="javascript:alert(1)">js</a>`;
  assert.deepEqual(registryLinks(entry, source(html)), [article('one')]);
  assert.throws(() => registryLinks(entry, source('<p>Loading...</p>')), { code: 'registry_no_links' });
  assert.throws(() => registryLinks(entry, { ...source(html), finalUrl: 'https://other.example/' }), { code: 'registry_redirect_host' });
});

test('Bahrain dated news cards exclude navigation and resolve relative links', () => {
  const ewa = registry.find(e => e.id === 'ewa-news');
  assert.deepEqual(registryLinks(ewa, { finalUrl: ewa.url, bytes: Buffer.from(
    '<a class="__news_col" href="official-announcement">news</a><a href="contact-us">contact</a>') }),
  ['https://www.ewa.bh/en/official-announcement']);
});

test('cursor only advances over queued links and preserves bounded correction overlap', () => {
  const urls = ['a', 'b', 'c', 'd', 'e'].map(article);
  const first = registryPlan(urls);
  assert.deepEqual(first.urls, urls.slice(0, 2));
  assert.deepEqual(first.seen_urls, urls.slice(0, 2));
  const second = registryPlan(urls, first);
  assert.deepEqual(second.urls, [urls[2], urls[3], urls[0], urls[1]]);
  assert.ok(!second.seen_urls.includes(urls[4]));
  const third = registryPlan(urls, second);
  assert.equal(third.fresh_count, 1);
  assert.equal(registryPlan(urls, third).fresh_count, 0);
});

test('registry worker checkpoints only after durable enqueue, never calling a model', async () => {
  let prior = {}, enqueued = [], completed;
  const store = {
    claimJobItem: async () => ({ id: 'item', job_run_id: 'run', item_key: `registry:${entry.id}`, attempts: 1 }),
    registryCursor: async () => prior,
    enqueueJobItems: async (_owner, _job, items) => { enqueued = items; return items.length; },
    finishJobItem: async (_owner, _id, status, checkpoint, code) => { completed = { status, checkpoint, code }; return true; }
  };
  const options = { store, owner: 'owner', sourceFetcher: async () => source(`<a href="${article('one')}">one</a>`),
    modelFactory: () => { throw new Error('must not call'); } };
  assert.equal((await runDailyJobItem(options)).status, 'succeeded');
  assert.equal(enqueued[0].checkpoint.url, article('one'));
  assert.equal(completed.checkpoint.fresh_count, 1);
  prior = completed.checkpoint;
  await runDailyJobItem(options);
  assert.equal(completed.checkpoint.fresh_count, 0);
  assert.equal(enqueued.length, 1); // overlap catches corrections
  store.enqueueJobItems = async () => { throw new Error('database unavailable'); };
  assert.equal((await runDailyJobItem(options)).status, 'retry');
  assert.equal(completed.checkpoint.seen_urls, undefined);
  assert.equal(completed.code, 'registry_failed');
});

test('empty index is visible failure, not a successful no-news cursor', async () => {
  let completed;
  const store = {
    claimJobItem: async () => ({ id: 'item', job_run_id: 'run', item_key: `registry:${entry.id}`, attempts: 3 }),
    registryCursor: async () => ({}),
    finishJobItem: async (_o, _id, status, checkpoint, code) => { completed = { status, checkpoint, code }; return true; }
  };
  assert.equal((await runDailyJobItem({ store, owner: 'owner', sourceFetcher: async () => source('<p>Loading</p>') })).status, 'failed');
  assert.equal(completed.code, 'registry_no_links');
  assert.equal(completed.checkpoint.seen_urls, undefined);
});

test('cursor lookup is owner scoped and excludes the current run and failed attempts', async () => {
  let query;
  const config = settings({ SUPABASE_URL: 'https://backend.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', NRGOPT_ADMIN_USER_ID: 'owner-a', NRGOPT_APP_ORIGIN: 'https://app.example' });
  const store = createStore(config, async url => { query = new URL(url); return new Response(JSON.stringify([{ checkpoint: { seen_urls: ['prior'] } }]), { status: 200 }); });
  assert.deepEqual(await store.registryCursor('owner-a', 'registry:acwa-news', 'run-current'), { seen_urls: ['prior'] });
  assert.equal(query.searchParams.get('owner_id'), 'eq.owner-a');
  assert.equal(query.searchParams.get('status'), 'eq.succeeded');
  assert.equal(query.searchParams.get('job_run_id'), 'neq.run-current');
  assert.equal(query.searchParams.get('item_key'), 'eq.registry:acwa-news');
});
