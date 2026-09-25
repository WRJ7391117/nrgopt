const test = require('node:test');
const assert = require('node:assert/strict');
const { registry, registryLinks, registryPlan } = require('../lib/intelligence/registry.cjs');
const { runDailyJobItem } = require('../lib/intelligence/jobs.cjs');
const { sourceItem } = require('../lib/intelligence/jobs.cjs');
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

test('Kuwait KAPP listing accepts only official numbered article links', () => {
  const kapp = registry.find(e => e.id === 'kapp-news');
  const source = { finalUrl: kapp.url, bytes: Buffer.from('<a href="/media/get_details/126">energy</a>'
    + '<a href="https://www.kapp.gov.kw/media/get_details/126?utm_source=feed">same</a>'
    + '<a href="/media/get_details/other">other</a><a href="https://other.example/media/get_details/127">offsite</a>') };
  assert.deepEqual(registryLinks(kapp, source), ['https://www.kapp.gov.kw/media/get_details/126']);
});

test('Principal Buyer homepage accepts only official news articles', () => {
  const pb = registry.find(e => e.id === 'pb-news');
  const source = { finalUrl: pb.url, bytes: Buffer.from('<a href="/media-center/news/four-bess-agreements/">news</a>'
    + '<a href="https://www.pb.com.sa/media-center/news/four-bess-agreements/?campaign=x">same</a>'
    + '<a href="/media-center/#news">section</a><a href="https://other.example/media-center/news/other/">offsite</a>') };
  assert.deepEqual(registryLinks(pb, source), ['https://www.pb.com.sa/media-center/news/four-bess-agreements/']);
});

test('cursor only advances over queued links and preserves bounded correction overlap', () => {
  const urls = Array.from({ length: 60 }, (_, i) => article(String(i)));
  const first = registryPlan(urls);
  assert.deepEqual(first.urls, urls.slice(0, 50));
  assert.deepEqual(first.seen_urls, urls.slice(0, 50));
  assert.equal(first.pending_count, 10);
  const second = registryPlan(urls, first);
  assert.deepEqual(second.urls, [...urls.slice(50), ...urls.slice(0, 2)]);
  assert.equal(second.pending_count, 0);
  assert.equal(registryPlan(urls, second).fresh_count, 0);
  assert.ok(registryPlan(urls.slice(0, 25)).urls.includes(urls[2])); // A third-position demand signal must not be skipped.

});

test('registry worker checkpoints only after durable enqueue, never calling a model', async () => {
  let prior = {}, enqueued = [], completed;
  const store = {
    sourcePaused: async () => false,
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
    sourcePaused: async () => false,
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

test('publisher pause covers registry, discovered article and watch fetch before any network work', async () => {
  const articleItem = sourceItem({ url: article('one') }, 'SA');
  for (const item of [{ item_key: 'registry:' + entry.id, checkpoint: {} }, articleItem,
    { ...articleItem, item_key: articleItem.item_key.replace('source:', 'watchsource:0:') }]) {
    let completion;
    const store = { claimJobItem: async () => ({ id: 'item', job_run_id: 'run', attempts: 1, ...item }),
      sourcePaused: async (owner, url) => { assert.equal(owner, 'owner'); assert.match(url, /acwapower.com/); return true; },
      finishJobItem: async (...args) => { completion = args; return true; } };
    const result = await runDailyJobItem({ store, owner: 'owner', sourceFetcher: async () => { assert.fail('paused source fetched'); } });
    assert.equal(result.status, 'manual_paused');
    assert.equal(completion[3].source_host, 'acwapower.com');
    assert.equal(completion[4], 'source_paused');
  }
});

test('source control reads normalize www and keep owner boundaries', async () => {
  let observed;
  const store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async url => {
    observed = new URL(url); return new Response('[{"paused":true}]');
  });
  assert.equal(await store.sourcePaused('owner-a', 'https://www.acwapower.com/news'), true);
  assert.equal(observed.searchParams.get('owner_id'), 'eq.owner-a');
  assert.equal(observed.searchParams.get('hostname'), 'eq.acwapower.com');
});
