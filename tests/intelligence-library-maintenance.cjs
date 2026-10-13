const test = require('node:test'), assert = require('node:assert/strict');
const { automaticProposal, listingProof, maintainLibrary } = require('../lib/intelligence/library-maintenance.cjs');
const { scopeKey, defaults, selectChannel, validateEntry } = require('../lib/intelligence/source-library.cjs');
const { summarizeLibrary } = require('../lib/intelligence/library-summary.cjs');

const day = '2026-10-13', now = new Date(day + 'T08:00:00Z'), directionId = '11111111-1111-4111-8111-111111111111';
const directions = [{ id: directionId, config: { name: '能源项目', enabled: true, countries: ['SA'] } }];
const source = (id, path = '/authors/alice/' + id, extra = {}) => ({ id, title: id, requested_url: 'https://example.org' + path, final_url: 'https://example.org' + path,
  fetched_at: day + 'T00:00:00Z', publication_date: day, publication_method: 'metadata', status: 'pending_extraction', extraction_status: 'extracted',
  content_sha256: id === 'one' ? 'a'.repeat(64) : 'b'.repeat(64), extraction_source_sha256: id === 'one' ? 'a'.repeat(64) : 'b'.repeat(64),
  countries: [{ code: 'SA', relation: 'occurrence' }], ...extra });
const sources = [source('one'), source('two')];
const suggestion = (rows = sources) => ({ name: 'example.org', samples: rows.map(row => ({ ...row, countries: ['SA'] })) });
const page = (url, paths = sources.map(row => row.final_url)) => ({ finalUrl: url, excerpt: 'Readable public listing', bytes: Buffer.from('<html><body>' + paths.map(path => '<a href="' + path + '">Article</a>').join('') + '</body></html>') });
const proposal = () => automaticProposal(suggestion(), directions, now);
const old = entry => ({ ...entry, revision: 1, access: { ...entry.access, checked_at: '2026-10-05T00:00:00Z' } });
function fixture(entries = [], originalSources = sources, fetcher = async url => page(url)) {
  let rows = entries, reserved = new Set(), reads = 0, calls = 0, saved = [];
  const store = {
    directionList: async () => directions,
    libraryOverview: async (_owner, directionRead) => summarizeLibrary({ entries: rows, sources: originalSources, tasks: [], directions: await directionRead, day }),
    sourceLibrary: async () => rows,
    recentLibrarySources: async () => originalSources,
    reserveLibraryCheck: async (_owner, id, date) => { const key = date + ':' + id; if (reserved.has(key)) return 'duplicate'; if ([...reserved].filter(value => value.startsWith(date + ':')).length >= 18) return 'limit'; reserved.add(key); return 'reserved'; },
    saveLibraryEntry: async (_owner, entry, access) => { const current = rows.find(row => row.id === entry.id);
      if ((current?.revision || 0) !== entry.revision) throw Object.assign(Error('library_conflict'), { code: 'library_conflict' });
      const value = { ...entry, revision: entry.revision + 1, access };
      rows = rows.filter(row => row.id !== entry.id).concat(value); saved.push(value); return value;
    }
  };
  return { store, run: async (clock = now) => maintainLibrary({ store, owner: 'owner', day: clock.toISOString().slice(0, 10), now: clock, fetchSource: async url => { reads++; return fetcher(url); } }),
    rows: () => rows, saves: () => saved, reads: () => reads, reservations: () => reserved.size, setRows: value => { rows = value; } };
}
test('automatic registration is deterministic, keeps exact direct parent, requires two different raw originals and retains unknown identity', () => {
  const entry = proposal(); assert.ok(entry);
  assert.match(entry.id, /^reference:auto:[a-f0-9]{64}$/);
  assert.equal(entry.config.url, 'https://example.org/authors/alice/');
  assert.equal(entry.config.type, 'unknown'); assert.equal(entry.config.scope, 'path');
  assert.equal(entry.access.scope_verified, false); assert.equal(entry.access.scope_confirmation_needed, false);
  assert.equal(entry.access.auto_scope_key, scopeKey(entry));
  assert.equal(automaticProposal(suggestion(sources.slice().reverse()), directions, now).id, entry.id);
  assert.equal(validateEntry(entry).config.mode, 'search');
  for (const id of ['reference:auto:abc', 'reference:auto:' + 'A'.repeat(64)]) assert.throws(() => validateEntry({ ...entry, id }));
});
test('one article, root parents, different author directories and duplicate hashes cannot enlarge automatic scope', () => {
  for (const rows of [[sources[0]], [source('one', '/one'), source('two', '/two')],
    [sources[0], source('two', '/authors/bob/two')], [sources[0], source('two', '/authors/alice/two', { content_sha256: 'a'.repeat(64) })]]) {
    const entry = automaticProposal(suggestion(rows), directions, now);
    assert.equal(entry.access.scope_confirmation_needed, true);
    assert.equal(entry.config.url, rows[0].final_url);
  }
  const www = { ...sources[0], final_url: 'https://www.example.org/authors/alice/one#fragment', content_sha256: 'c'.repeat(64) };
  assert.equal(automaticProposal(suggestion([sources[0], www]), directions, now).access.scope_confirmation_needed, true);
  assert.equal(automaticProposal(suggestion([{ ...sources[0], final_url: sources[0].final_url + '?tracking=1' }]), directions, now), null);
});
test('listing proof requires two genuine matching article links and never accepts redirect scope expansion', () => {
  const entry = proposal();
  assert.equal(listingProof(entry, page(entry.config.url), sources), true);
  assert.equal(listingProof(entry, page(entry.config.url, [sources[0].final_url]), sources), false);
  assert.equal(listingProof(entry, page('https://example.org/'), sources), false);
  assert.equal(listingProof(entry, page('https://example.org/authors/alice/archive/'), sources), false);
  assert.equal(listingProof(entry, page('https://www.example.org/authors/alice/'), sources), true);
  assert.equal(listingProof(entry, page(entry.config.url, ['https://evil.example/one', 'https://evil.example/two']), sources), false);
});
test('automatic accumulation registers once then enables proved readable scope with two current originals, without paid capabilities', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.checked, 1); assert.equal(f.reads(), 1); assert.equal(f.saves().length, 2);
  assert.equal(f.rows()[0].status, 'active'); assert.equal(f.rows()[0].access.scope_verified, true);
  assert.equal(f.rows()[0].config.type, 'unknown');
  assert.equal((await f.run()).checked, 0); assert.equal(f.reads(), 1); assert.equal(f.saves().length, 2);
});
test('single saved article remains a candidate requiring user confirmation and cannot enter a targeted trial', async () => {
  const f = fixture([], [sources[0]]); await f.run(); const entry = f.rows()[0];
  assert.equal(entry.status, 'candidate'); assert.equal(entry.access.scope_confirmation_needed, true);
  assert.equal(selectChannel([entry], 'SA', directions[0], '2026-09-21'), null);
});
test('a later second valid original evolves a single-article candidate into a proved parent and integrates old history', async () => {
  const originals = [sources[0]], f = fixture([], originals);
  await f.run(); const article = f.rows()[0];
  assert.equal(article.access.scope_confirmation_needed, true);
  originals.push(sources[1]);
  const evolved = await f.run(); assert.equal(evolved.checked, 1);
  const parent = f.rows().find(entry => entry.id !== article.id);
  assert.equal(parent.status, 'active'); assert.equal(parent.config.url, 'https://example.org/authors/alice/');
  assert.equal(f.rows().find(entry => entry.id === article.id).config.url, sources[0].final_url);
  const overview = await f.store.libraryOverview('owner', Promise.resolve(directions));
  assert.equal(overview.entries.find(entry => entry.id === article.id).integration.entry_id, parent.id);
  const reads = f.reads(); await f.run(new Date('2026-10-20T08:00:00Z'));
  assert.equal(f.reads(), reads + 1, 'only the parent is due; the integrated single article must not be checked again');
});
test('no listing proof blocks promotion despite readable page and two analyzed sources', async () => {
  const f = fixture([], sources, async url => page(url, [sources[0].final_url])); await f.run();
  assert.equal(f.rows()[0].status, 'candidate'); assert.equal(f.rows()[0].access.scope_verified, false);
  assert.equal(f.rows()[0].access.reason, 'scope_unverified');
});
test('active periodic review keeps proven scope without two fresh samples; successful access clears failure streak', async () => {
  const entry = old(proposal()); entry.status = 'active'; entry.access = { ...entry.access, status: 'readable', scope_verified: true, consecutive_failures: 1 };
  const f = fixture([entry], [], async url => page(url, [])); await f.run();
  assert.equal(f.rows()[0].status, 'active'); assert.equal(f.rows()[0].access.scope_verified, true);
  assert.equal(f.rows()[0].access.reason, 'recent_samples_unknown'); assert.equal(f.rows()[0].access.consecutive_failures, 0);
});
test('two independent due free-access failures downgrade automatic active channel, while missing samples do not', async () => {
  const entry = old(proposal()); entry.status = 'active'; entry.access = { ...entry.access, status: 'readable', scope_verified: true };
  const f = fixture([entry], [], async () => { throw Object.assign(Error('denied'), { code: 'source_access_denied' }); });
  await f.run(); assert.equal(f.rows()[0].status, 'active'); assert.equal(f.rows()[0].access.consecutive_failures, 1);
  assert.equal((await f.run()).checked, 0);
  await f.run(new Date('2026-10-20T08:00:00Z'));
  assert.equal(f.rows()[0].status, 'candidate'); assert.equal(f.rows()[0].access.consecutive_failures, 2);
  assert.equal(f.rows()[0].access.reason, 'repeated_entry_failure');
});
test('user pause, removal, host pause, manual takeover and changed scope suppress automatic writes', async () => {
  for (const mutate of [entry => { entry.status = 'paused'; }, entry => { entry.status = 'removed'; }, entry => { entry.host_paused = true; },
    entry => { entry.access.managed_by = 'user'; }, entry => { entry.config.url = 'https://example.org/authors/bob/'; entry.config.scope_key = scopeKey(entry); }]) {
    const entry = old(proposal()); mutate(entry); const f = fixture([entry], []); await f.run();
    assert.equal(f.reads(), 0); assert.equal(f.saves().length, 0);
  }
});
test('a user change during the free request is retained and conflicts are safely skipped', async () => {
  const entry = old(proposal()); let f;
  f = fixture([entry], sources, async url => { f.setRows([{ ...entry, revision: 2, status: 'paused' }]); return page(url); });
  const result = await f.run(); assert.equal(result.outcomes[0].status, 'conflict'); assert.equal(f.rows()[0].status, 'paused'); assert.equal(f.saves().length, 0);
  const duplicate = fixture(); duplicate.store.saveLibraryEntry = async () => { throw Object.assign(Error('duplicate'), { code: 'library_duplicate' }); };
  assert.equal((await duplicate.run()).outcomes[0].status, 'conflict'); assert.equal(duplicate.reads(), 0);
});
test('existing reference promotion uses the same date/hash/failure standard, not successful entry fetching alone', async () => {
  const reference = { ...defaults().find(entry => entry.id.startsWith('reference:')), config: { ...proposal().config, scope: 'site', url: 'https://example.org/' } };
  for (const change of [{ publication_date: '2026-10-14' }, { publication_method: 'conflicting_metadata' }, { extraction_source_sha256: 'c'.repeat(64) }, { status: 'evidence_failed' }]) {
    const f = fixture([reference], [source('one', '/authors/alice/one', change)]); await f.run();
    assert.equal(f.rows()[0].status, 'candidate'); assert.equal(f.rows()[0].access.origin, 'reference');
  }
});
test('due reviews and new references share three checks per batch, eighteen daily reservations and seven day cadence', async () => {
  const entries = Array.from({ length: 21 }, (_, i) => ({ ...defaults().find(entry => entry.id.startsWith('reference:')), id: 'reference:fake-' + i,
    revision: 1, access: { status: 'unchecked' }, config: { ...proposal().config, url: 'https://channel-' + i + '.example.org/', scope: 'site' } }));
  const active = old(proposal()); active.status = 'active'; active.access.scope_verified = true;
  const f = fixture(entries.concat(active), [], async url => page(url, []));
  assert.equal((await f.run()).checked, 3); assert.ok(f.saves().some(entry => entry.id === active.id), 'past-due active review must precede newly unchecked references');
  for (let i = 0; i < 6; i++) await f.run();
  assert.equal(f.reservations(), 18); assert.equal(f.reads(), 18);
});
