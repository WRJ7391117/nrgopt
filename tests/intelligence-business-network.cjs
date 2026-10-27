const test = require('node:test'), assert = require('node:assert/strict');
const { validateBusinessRelation } = require('../lib/intelligence/business-network.cjs');
const { createStore } = require('../lib/intelligence/store.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const relation = (changes = {}) => ({ id, revision: 0, organization: '  能源机构  ', contact_name: '', role: '', region: '',
  contact_details: '', business_context: '', source_note: '', communication_note: '', next_action: '',
  status: 'identified', followup_on: null, ...changes });
const invalid = error => error.code === 'invalid_request' && error.status === 400;

test('business relation validates the user fields without inventing contact progress or accepting owner identity', () => {
  const result = validateBusinessRelation(relation({ owner_id: 'other', unexpected: 'discard', source_note: '  公开报道\n尚未核实  ' }));
  assert.equal(result.organization, '能源机构');
  assert.equal(result.source_note, '公开报道\n尚未核实');
  assert.equal(result.status, 'identified');
  assert.equal(result.communication_note, '');
  assert.equal(result.followup_on, null);
  assert.equal(result.archived, false);
  assert.equal(Object.hasOwn(result, 'owner_id'), false);
  assert.equal(Object.hasOwn(result, 'unexpected'), false);
  assert.equal(validateBusinessRelation(relation({ id: 'ABCD1111-1111-4111-8111-111111111111' })).id, 'abcd1111-1111-4111-8111-111111111111');
  for (const status of ['identified', 'contacted', 'communicating', 'paused']) {
    assert.equal(validateBusinessRelation(relation({ status })).status, status);
  }
});

test('business relation rejects missing identity, malformed revisions, statuses, dates and archive flags', () => {
  for (const input of [null, undefined, [], 'text']) assert.throws(() => validateBusinessRelation(input), invalid);
  for (const changes of [{ id: '' }, { id: 'not-a-uuid' }, { revision: -1 }, { revision: 0.5 }, { revision: '0' },
    { revision: 2147483647 }, { revision: Infinity }, { status: 'active' }, { status: '' },
    { archived: 'false' }, { archived: null }, { followup_on: undefined }, { followup_on: '' },
    { followup_on: '2026-02-29' }, { followup_on: '2026-02-30' }, { followup_on: '0000-01-01' },
    { followup_on: '2026-13-01' }, { followup_on: '2026-01-01T00:00:00Z' }, { followup_on: ' 2026-01-01' }]) {
    assert.throws(() => validateBusinessRelation(relation(changes)), invalid);
  }
  assert.equal(validateBusinessRelation(relation({ followup_on: '2028-02-29', archived: true })).followup_on, '2028-02-29');
});

test('business relation enforces each text limit and allows ordinary multiline notes', () => {
  for (const [field, limit] of Object.entries({ organization: 160, contact_name: 120, role: 160, region: 120,
    contact_details: 800, business_context: 1000, source_note: 800, communication_note: 1600, next_action: 600 })) {
    assert.equal([...validateBusinessRelation(relation({ [field]: '源'.repeat(limit) }))[field]].length, limit);
    assert.throws(() => validateBusinessRelation(relation({ [field]: '源'.repeat(limit + 1) })), invalid);
    assert.throws(() => validateBusinessRelation(relation({ [field]: null })), invalid);
    assert.throws(() => validateBusinessRelation(relation({ [field]: undefined })), invalid);
  }
  assert.throws(() => validateBusinessRelation(relation({ organization: ' \n\t ' })), invalid);
  for (const character of ['\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u001f', '\u007f', '\u0085', '\u009f']) {
    assert.throws(() => validateBusinessRelation(relation({ source_note: character + 'note' })), invalid);
  }
  assert.equal(validateBusinessRelation(relation({ communication_note: '第一行\n第二行\r\n\t备注' })).communication_note, '第一行\n第二行\r\n\t备注');
  assert.equal([...validateBusinessRelation(relation({ contact_name: '😀'.repeat(120) })).contact_name].length, 120);
});

test('business network list uses owner-scoped RPC parameters and paginates 25 items', async () => {
  const requests = [];
  let results = Array.from({ length: 26 }, (_, index) => ({ id: String(index) }));
  const store = createStore({ url: 'https://db.test', serviceKey: 'x' }, async (url, init) => {
    requests.push({ url, init }); return new Response(JSON.stringify(results));
  });
  const q = "_%' OR true; -- 中文";
  const page = await store.businessNetwork('owner-a', { status: 'communicating', q, offset: 25 });
  assert.equal(page.items.length, 25);
  assert.equal(page.has_more, true);
  assert.equal(requests[0].url, 'https://db.test/rest/v1/rpc/intelligence_business_network');
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_owner_id: 'owner-a', p_status: 'communicating', p_q: q, p_offset: 25 });
  results = results.slice(0, 25);
  assert.equal((await store.businessNetwork('owner-a')).has_more, false);
  assert.deepEqual(JSON.parse(requests[1].init.body), { p_owner_id: 'owner-a', p_status: 'all', p_q: '', p_offset: 0 });
  results = [];
  assert.deepEqual(await store.businessNetwork('owner-b', { status: 'archived' }), { items: [], has_more: false });
});

test('business relation save preserves the client ID and revision and returns the database record', async () => {
  const requests = [], value = validateBusinessRelation(relation());
  const saved = { ...value, revision: 1, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z' };
  const store = createStore({ url: 'https://db.test', serviceKey: 'x' }, async (url, init) => {
    requests.push({ url, init }); return new Response(JSON.stringify(saved));
  });
  assert.deepEqual(await store.saveBusinessRelation('owner-a', value), saved);
  assert.deepEqual(await store.saveBusinessRelation('owner-a', value), saved);
  const request = JSON.parse(requests[0].init.body);
  assert.equal(requests[0].url, 'https://db.test/rest/v1/rpc/save_intelligence_business_relation');
  assert.equal(request.p_owner_id, 'owner-a');
  assert.equal(request.p_id, id);
  assert.equal(request.p_revision, 0);
  assert.equal(request.p_value.organization, '能源机构');
  assert.equal(Object.hasOwn(request.p_value, 'revision'), false);
  assert.deepEqual(requests[0].init.body, requests[1].init.body);
});

test('business network exposes revision conflicts and invalid requests without hiding read failures as empty data', async () => {
  let result = { error: 'business_relation_conflict' };
  const store = createStore({ url: 'https://db.test', serviceKey: 'x' }, async () => new Response(JSON.stringify(result)));
  await assert.rejects(store.saveBusinessRelation('owner', validateBusinessRelation(relation())), error => error.code === 'business_relation_conflict' && error.status === 409);
  result = { error: 'invalid_request' };
  await assert.rejects(store.saveBusinessRelation('owner', validateBusinessRelation(relation())), invalid);
  await assert.rejects(store.businessNetwork('owner'), invalid);
  result = null;
  await assert.rejects(store.businessNetwork('owner'), error => error.code === 'upstream_unavailable' && error.status === 502);
});
