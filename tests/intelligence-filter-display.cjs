const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/intelligence/store.cjs');
const { defaults } = require('../lib/intelligence/directions.cjs');
const { sourceMatchVerified, sourceFilterMatch, summarize } = require('../lib/intelligence/overview-summary.cjs');

const day = '2026-10-13', at = '2026-10-13T02:00:00Z', id = '11111111-1111-4111-8111-111111111111';
function fixture(name = 'one', created_at = '2026-10-13T01:00:00Z') {
  const direction = { id, revision: 1, config: { ...structuredClone(defaults[0].config),
    filter_rules: { include: ['investment'], include_note: '', focus: ['equipment'] } } };
  const source = { id: `source-${name}`, final_url: `https://example.com/${name}`, content_sha256: 'hash',
    extraction_source_sha256: 'hash', extraction_status: 'extracted', extracted_at: at, publication_date: day,
    extraction_zh: { known_facts: [{ claim_zh: '业主披露设备采购计划。', evidence_quote: 'The owner plans to buy equipment.', statement_type: 'disclosure' }] } };
  const candidate = { id: `candidate-${name}`, source_id: source.id, source_sha256: 'hash', created_at,
    disposition: 'candidate', review_status: 'pending', evidence_status: 'sourced', radars: ['project'], title_zh: `${name} 项目` };
  const match = { id, revision: 1, relevant: true, reason_zh: '原文披露投资与设备采购计划，需核实后续。',
    evidence_fact_number: 1, matched_rules: ['investment'], business_paths: [{ path: 'equipment', evidence_fact_number: 1 }],
    attention: 'priority', rules_version: 1 };
  return { direction, source, candidate, ref: { id: `ref-${name}`, source_id: source.id, direction_id: id, direction,
    match, analysis_sha256: 'hash', analysis_extracted_at: at, created_at } };
}
function overview(items, refs = items.map(item => item.ref), extra = {}) {
  return summarize({ day, period: 1, candidates: items.map(item => item.candidate), sources: items.map(item => item.source),
    watches: [], followed: [], directions: [{ ...items[0].direction, config: { ...items[0].direction.config, name: '现在的方向名称' } }],
    runs: [], tasks: [], refs, library: [], opportunities: [], currentTasks: [], ...extra });
}

test('only a verified frozen rule match can promote a discovery', () => {
  const item = fixture(), match = sourceFilterMatch(item.ref, item.source);
  assert.equal(match.attention, 'priority');
  const discovery = overview([item]).discoveries[0];
  assert.equal(discovery.rule_attention, 'priority');
  assert.equal(discovery.rule_reason, item.ref.match.reason_zh);
  assert.deepEqual(discovery.rule_paths, [{ path: 'equipment', evidence_fact_number: 1 }]);
  const legacy = { ...item.ref, match: { relevant: true, reason_zh: '旧版相关结果。', evidence_fact_number: 1 } };
  assert.equal(sourceMatchVerified(legacy, item.source), true);
  assert.equal(sourceFilterMatch(legacy, item.source), null);
  const oldResult = overview([item], [legacy]).discoveries[0];
  assert.deepEqual(oldResult.direction_names, ['现在的方向名称']);
  assert.equal(oldResult.rule_attention, null);
  assert.deepEqual(oldResult.rule_paths, []);
  const observe = { ...item.ref, match: { ...item.ref.match, business_paths: [], attention: 'observe' } };
  assert.equal(sourceFilterMatch(observe, item.source).attention, 'observe');
  assert.equal(overview([item], [observe]).discoveries[0].rule_attention, 'observe');
  const irrelevant = { ...item.ref, match: { ...item.ref.match, relevant: false, evidence_fact_number: null,
    matched_rules: [], business_paths: [], attention: 'none' } };
  assert.equal(sourceFilterMatch(irrelevant, item.source).attention, 'none');
  assert.equal(overview([item], [irrelevant]).discoveries[0].rule_attention, null);
  assert.equal(sourceFilterMatch({ ...irrelevant, match: { ...irrelevant.match, matched_rules: ['investment'] } }, item.source), null);
});

test('changed originals, analyses, snapshots and forged attention cannot gain rule priority', () => {
  const item = fixture();
  const invalid = [
    { source: { ...item.source, content_sha256: 'changed' } },
    { source: { ...item.source, extracted_at: '2026-10-13T03:00:00Z' } },
    { source: { ...item.source, extraction_source_sha256: 'old' } },
    { ref: { ...item.ref, analysis_extracted_at: null } },
    { ref: { ...item.ref, direction: { ...item.direction, id: 'another' } } },
    { ref: { ...item.ref, direction: { ...item.direction, revision: 2 } } },
    { ref: { ...item.ref, direction: { ...item.direction, config: { ...item.direction.config, filter_rules: undefined } } } },
    { ref: { ...item.ref, match: { ...item.ref.match, rules_version: 2 } } },
    { ref: { ...item.ref, match: { ...item.ref.match, attention: 'observe' } } },
    { ref: { ...item.ref, match: { ...item.ref.match, matched_rules: ['change'] } } },
    { ref: { ...item.ref, match: { ...item.ref.match, matched_rules: ['investment', 'investment'] } } },
    { ref: { ...item.ref, match: { ...item.ref.match, matched_rules: ['custom'] } } },
    { ref: { ...item.ref, direction: { ...item.direction, config: { ...item.direction.config,
      filter_rules: { ...item.direction.config.filter_rules, focus: ['partner'] } } } } },
    { ref: { ...item.ref, direction: { ...item.direction, config: { ...item.direction.config,
      filter_rules: { ...item.direction.config.filter_rules, include: ['unknown'] } } } } }
  ];
  for (const change of invalid) assert.equal(sourceFilterMatch(change.ref || item.ref, change.source || item.source), null);
  assert.equal(overview([item], [item.ref], { directions: [{ ...item.direction, config: { ...item.direction.config,
    filter_rules: { include: ['change'], include_note: '', focus: ['partner'] } } }] }).discoveries[0].rule_attention, 'priority',
    'editing current rules does not rewrite a previously frozen result');
});

test('each business path must bind a current disclosed or reported fact', () => {
  const item = fixture();
  for (const statement_type of ['opinion', 'unknown', undefined]) {
    const source = { ...item.source, extraction_zh: { known_facts: [{ ...item.source.extraction_zh.known_facts[0], statement_type }] } };
    assert.equal(sourceFilterMatch(item.ref, source), null, `${statement_type} cannot establish an equipment path`);
  }
  for (const business_paths of [
    ['equipment'], [{ path: 'equipment', evidence_fact_number: 2 }],
    [{ path: 'order', evidence_fact_number: 1 }],
    [{ path: 'equipment', evidence_fact_number: 1 }, { path: 'equipment', evidence_fact_number: 1 }]
  ]) assert.equal(sourceFilterMatch({ ...item.ref, match: { ...item.ref.match, business_paths } }, item.source), null);
  const mixedSource = { ...item.source, extraction_zh: { known_facts: [...item.source.extraction_zh.known_facts,
    { claim_zh: '作者认为伙伴可能参与。', evidence_quote: 'Partners may participate.', statement_type: 'opinion' }] } };
  assert.equal(sourceFilterMatch({ ...item.ref, match: { ...item.ref.match,
    business_paths: [{ path: 'equipment', evidence_fact_number: 1 }, { path: 'partner', evidence_fact_number: 2 }] } }, mixedSource), null);
  assert.equal(sourceFilterMatch(item.ref, { ...item.source, extraction_zh: { known_facts: [
    { ...item.source.extraction_zh.known_facts[0], statement_type: 'report' }] } }).attention, 'priority');
});

test('conflicts remain observation, priorities sort first and followed actions retain their order', () => {
  const ordinary = fixture('ordinary', '2026-10-13T05:00:00Z'), priority = fixture('priority'), conflict = fixture('conflict', '2026-10-13T04:00:00Z');
  ordinary.ref.match = { relevant: true };
  conflict.candidate.evidence_status = 'conflict';
  const result = overview([ordinary, priority, conflict]);
  assert.deepEqual(result.discoveries.map(candidate => candidate.id), [priority.candidate.id, conflict.candidate.id, ordinary.candidate.id]);
  assert.deepEqual(result.highlights.map(candidate => candidate.id), [priority.candidate.id, conflict.candidate.id, ordinary.candidate.id]);
  assert.equal(result.discoveries[1].rule_attention, 'observe');
  assert.notEqual(overview([{ ...priority, candidate: { ...priority.candidate, disposition: 'source_only' } }]).discoveries[0].rule_attention, 'priority');
  const watch = { id: 'watch', candidate_id: priority.candidate.id, candidate: priority.candidate,
    followup: { review_on: '2026-10-12' }, changes: [{ created_at: at }] };
  const followed = overview([ordinary, priority, conflict], undefined, { watches: [watch], followed: [watch] });
  assert.equal(followed.highlights.some(candidate => candidate.id === priority.candidate.id), false);
  assert.equal(followed.updates[0].id, 'watch');
  assert.equal(followed.due[0].id, 'watch');
  assert.equal(followed.active[0].id, 'watch');
  assert.equal(followed.counts.discoveries, 3);
  const stale = fixture('stale'); stale.source.publication_date = '2026-09-12';
  assert.deepEqual(overview([stale]).highlights, []);
});

test('a duplicate URL cannot inherit another source version rule match or refresh discovery time', () => {
  const earlier = fixture('earlier'), latest = fixture('latest', '2026-10-13T06:00:00Z');
  latest.source.final_url = earlier.source.final_url;
  const selected = overview([earlier, latest], [earlier.ref]).discoveries[0];
  assert.equal(selected.source_id, latest.source.id);
  assert.equal(selected.rule_attention, null);
  assert.equal(selected.created_at, earlier.candidate.created_at);
  assert.equal(overview([earlier, latest]).discoveries[0].rule_attention, 'priority');
  earlier.candidate.created_at = '2026-10-12T01:00:00Z';
  assert.deepEqual(overview([earlier, latest]).discoveries, []);
});

test('direction results distinguish old relevance from rule verification without extra reads', async () => {
  const item = fixture();
  const refs = [item.ref, { ...item.ref, id: 'legacy', match: { relevant: true } },
    { ...item.ref, id: 'pending-snapshot', direction: null }, { ...item.ref, id: 'old-analysis', analysis_sha256: 'old' }];
  const calls = [];
  const store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async (input, init) => {
    assert.ok(!init.method || init.method === 'GET');
    const url = new URL(input); assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
    const table = url.pathname.split('/').pop(); calls.push(table);
    return Response.json(table === 'intelligence_collection_directions' ? [{ id }] : table === 'intelligence_direction_sources' ? refs
      : table === 'intelligence_sources' ? [item.source] : table === 'intelligence_candidates' ? [item.candidate] : []);
  });
  const result = await store.directionResults('owner', id);
  assert.deepEqual(result.items.map(ref => [ref.id, ref.verified, ref.rules_verified]), [
    [item.ref.id, true, true], ['legacy', true, false], ['pending-snapshot', true, false], ['old-analysis', false, false]
  ]);
  assert.equal(calls.length, 4);
});

test('workbench reads frozen rules and recent fact types in existing projections', async () => {
  const item = fixture(), calls = [];
  const project = (row, select) => Object.fromEntries(select.split(',').map(field => {
    const [name, expression = name] = field.split(':');
    return [name, expression.split(/->>?/).reduce((value, key) => value?.[key], row)];
  }));
  const store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async (input, init) => {
    assert.ok(!init.method || init.method === 'GET');
    const url = new URL(input), select = url.searchParams.get('select');
    assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
    const table = url.pathname.split('/').pop(); calls.push({ table, select });
    const rows = table === 'intelligence_candidates' ? [item.candidate] : table === 'intelligence_sources' ? [item.source]
      : table === 'intelligence_collection_directions' ? [item.direction] : table === 'intelligence_direction_sources' ? [item.ref] : [];
    return Response.json(rows.map(row => project(row, select)));
  });
  const result = await store.workbench('owner', day);
  assert.equal(result.highlights[0].rule_attention, 'priority');
  assert.equal(calls.filter(call => call.table === 'intelligence_direction_sources').length, 1);
  const refFields = calls.find(call => call.table === 'intelligence_direction_sources').select.split(',');
  assert.equal(refFields.includes('direction'), false);
  assert.ok(refFields.includes('snapshot_id:direction->>id'));
  assert.ok(refFields.includes('snapshot_revision:direction->revision'));
  assert.ok(refFields.includes('filter_rules:direction->config->filter_rules'));
  const sourceReads = calls.filter(call => call.table === 'intelligence_sources');
  assert.equal(sourceReads.length, 2);
  assert.equal(sourceReads[0].select.includes('known_facts'), false);
  assert.equal(sourceReads[1].select.includes('known_facts:extraction_zh->known_facts'), true);
});
