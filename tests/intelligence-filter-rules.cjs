const test = require('node:test');
const assert = require('node:assert/strict');
const { FILTER_RULES, defaults, normalizeFilterRules, validateDirection, validateMatrix, queryTerms, directionPrompt, validateMatches } = require('../lib/intelligence/directions.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const direction = rules => ({ id, revision: 1, config: { ...structuredClone(defaults[0].config), filter_rules: rules || normalizeFilterRules() } });
const match = change => ({ id, revision: 1, relevant: true, reason_zh: '原文披露具体变化，业务路线仍待核实。', evidence_fact_number: 1, matched_rules: ['change'], business_paths: [], ...change });
const facts = [
  { statement_type: 'disclosure', claim_zh: '业主公布设备需求。', evidence_quote: 'The owner requests battery equipment.' },
  { statement_type: 'report', claim_zh: '报道合作方开展当地业务合作。', evidence_quote: 'The partners signed a distribution agreement.' },
  { statement_type: 'opinion', claim_zh: '作者预测未来需求。', evidence_quote: 'The author expects future demand.' }
];
const validate = (raw, d = direction(), evidence = facts) => validateMatches([raw], [d], evidence)[0];
const invalidMatch = raw => assert.throws(() => validate(raw), { code: 'extraction_invalid_direction_matches' });

test('filter rules default independently and normalize selected codes without changing caller data', () => {
  const expected = { include: ['change','investment','participation'], include_note: '', focus: ['equipment','partner'] };
  assert.deepEqual(normalizeFilterRules(), expected);
  assert.deepEqual(Object.keys(FILTER_RULES.include), expected.include);
  assert.deepEqual(Object.keys(FILTER_RULES.focus), expected.focus);
  for (const item of defaults) assert.deepEqual(item.config.filter_rules, expected);
  const first = normalizeFilterRules(); first.include.pop();
  assert.deepEqual(normalizeFilterRules(), expected);
  const input = { include: ['participation','change'], include_note: '  合作方在当地开展能源业务  ', focus: ['partner','equipment'] };
  assert.deepEqual(normalizeFilterRules(input), { include: ['change','participation'], include_note: '合作方在当地开展能源业务', focus: ['equipment','partner'] });
  assert.deepEqual(input.include, ['participation','change']);
  assert.equal(normalizeFilterRules({ ...expected, include_note: '😀'.repeat(300) }).include_note.length, 600);
  assert.deepEqual(normalizeFilterRules({ ...expected, focus: [] }).focus, []);
});

test('filter rules reject malformed, missing, duplicate and unknown selections', () => {
  const base = normalizeFilterRules();
  const invalid = [null, [], 'change', {},
    { ...base, include: [] }, { ...base, include: ['change','change'] }, { ...base, include: ['custom'] },
    { ...base, include: ['change',1] }, { ...base, focus: null }, { ...base, focus: ['equipment','equipment'] },
    { ...base, focus: ['other'] }, { ...base, include_note: null }, { ...base, include_note: '😀'.repeat(301) },
    { ...base, include_note: undefined }, { ...base, unexpected: true }];
  for (const input of invalid) assert.throws(() => normalizeFilterRules(input), { code: 'invalid_request', status: 400 });
});

test('old individual settings gain defaults but an old whole-set save must refresh', () => {
  const old = direction(); delete old.config.filter_rules;
  assert.deepEqual(validateDirection(old).config.filter_rules, normalizeFilterRules());
  assert.throws(() => validateMatrix({ directions: [old] }), { code: 'rules_refresh_required', status: 409 });
  assert.throws(() => validateMatrix({ directions: [direction(), { ...old, id: '22222222-2222-4222-8222-222222222222' }] }), { code: 'rules_refresh_required' });
  const reordered = direction({ include: ['participation','investment','change'], include_note: '', focus: ['partner','equipment'] });
  reordered.id = '22222222-2222-4222-8222-222222222222';
  assert.equal(validateMatrix({ directions: [direction(), reordered] }).directions.length, 2);
  reordered.config.filter_rules.focus = [];
  assert.throws(() => validateMatrix({ directions: [direction(), reordered] }), { code: 'invalid_request' });
});

test('post-reading rules stay outside search terms and preserve source and risk boundaries in the prompt', () => {
  const d = direction();
  const changed = { ...d, config: { ...d.config, exclude: '仅限排除偏好', filter_rules: { include: ['change'], include_note: '仅限原文筛选', focus: [] } } };
  assert.equal(queryTerms(changed), queryTerms(d));
  const prompt = directionPrompt([changed]);
  assert.ok(prompt.includes('"filter_rules":{"include":["change"],"include_note":"仅限原文筛选","focus":[]}'));
  for (const text of ['任一满足即可纳入','source_only/candidate','重大设施风险不要求商业条件','一般项目/EPC或受灾事实不能直接建立设备采购路线','仅供观察','不得输出attention']) assert.ok(prompt.includes(text), text);
  const legacy = direction(); delete legacy.config.filter_rules;
  assert.ok(directionPrompt([legacy]).includes('"filter_rules":{"include":["change","investment","participation"]'));
});

test('concrete sourced business routes derive priority only when a chosen focus intersects', () => {
  const raw = match({ business_paths: [{ path: 'equipment', evidence_fact_number: 1 }, { path: 'partner', evidence_fact_number: 2 }] });
  const result = validate(raw);
  assert.equal(result.attention, 'priority');
  assert.equal(result.rules_version, 1);
  assert.deepEqual(result.business_paths, raw.business_paths);
  assert.equal(validate(raw, direction({ ...normalizeFilterRules(), focus: [] })).attention, 'observe');
  assert.equal(validate(match({ business_paths: [{ path: 'equipment', evidence_fact_number: 1 }] }), direction({ ...normalizeFilterRules(), focus: ['partner'] })).attention, 'observe');
  assert.equal(validate(match()).attention, 'observe');
});

test('custom notes and selected include rules are alternative grounded reasons for relevance', () => {
  const d = direction({ include: ['change'], include_note: '对当地能源渠道形成直接影响', focus: [] });
  assert.deepEqual(validate(match({ matched_rules: ['custom'] }), d).matched_rules, ['custom']);
  assert.deepEqual(validate(match({ matched_rules: ['custom','change'] }), d).matched_rules, ['change','custom']);
  assert.throws(() => validate(match({ matched_rules: ['investment'] }), d), { code: 'extraction_invalid_direction_matches' });
  invalidMatch(match({ matched_rules: ['custom'] }));
  for (const matched_rules of [undefined, [], ['change','change'], ['unknown'], 'change']) invalidMatch(match({ matched_rules }));
});

test('opinions remain observable but cannot support business paths; each path requires its own sourced fact', () => {
  assert.equal(validate(match({ evidence_fact_number: 3 })).attention, 'observe');
  invalidMatch(match({ business_paths: [{ path: 'equipment', evidence_fact_number: 3 }] }));
  invalidMatch(match({ business_paths: [{ path: 'equipment', evidence_fact_number: 4 }] }));
  invalidMatch(match({ business_paths: [{ path: 'partner', evidence_fact_number: 0 }] }));
  const reports = [{ ...facts[1], statement_type: 'unknown' }];
  assert.throws(() => validate(match({ business_paths: [{ path: 'partner', evidence_fact_number: 1 }] }), direction(), reports), { code: 'extraction_invalid_direction_matches' });
  assert.equal(validate(match({ evidence_fact_number: 3, business_paths: [{ path: 'partner', evidence_fact_number: 2 }] })).attention, 'priority');
});

test('new matching structure rejects duplicate paths, invalid evidence and model-controlled priority', () => {
  for (const raw of [match({ evidence_fact_number: null }), match({ evidence_fact_number: '1' }), match({ evidence_fact_number: 99 }),
    match({ business_paths: undefined }), match({ business_paths: ['equipment'] }),
    match({ business_paths: [{ path: 'other', evidence_fact_number: 1 }] }),
    match({ business_paths: [{ path: 'equipment', evidence_fact_number: 1, attention: 'priority' }] }),
    match({ business_paths: [{ path: 'equipment', evidence_fact_number: 1 }, { path: 'equipment', evidence_fact_number: 2 }] }),
    match({ attention: 'priority' }), match({ rules_version: 1 }), match({ score: 100 }), match({ priority_score: 100 })]) invalidMatch(raw);
  assert.throws(() => validateMatches([null], [direction()], facts), { code: 'extraction_invalid_direction_matches' });
});

test('unrelated results cannot carry positive matches or business routes', () => {
  const raw = { id, revision: 1, relevant: false, reason_zh: '原文与关注方向无关。', evidence_fact_number: null };
  const expected = { ...raw, matched_rules: [], business_paths: [], attention: 'none', rules_version: 1 };
  assert.deepEqual(validate(raw), expected);
  assert.deepEqual(validate({ ...raw, matched_rules: [] }), expected);
  assert.deepEqual(validate({ ...raw, business_paths: [] }), expected);
  assert.deepEqual(validate({ ...raw, matched_rules: [], business_paths: [] }), expected);
  for (const key of ['matched_rules','business_paths']) {
    for (const value of [null, undefined, '', {}, ['change'], [{ path: 'equipment', evidence_fact_number: 1 }]]) invalidMatch({ ...raw, [key]: value });
  }
  invalidMatch({ ...raw, attention: 'priority' });
});

test('legacy frozen settings retain the old match contract and never acquire priority', () => {
  const legacy = direction(); delete legacy.config.filter_rules;
  const raw = { id, revision: 1, relevant: true, reason_zh: '原文披露供能变化。', evidence_fact_number: 1 };
  assert.deepEqual(validate(raw, legacy), raw);
  assert.deepEqual(validate({ ...raw, attention: 'priority', business_paths: [{ path: 'equipment', evidence_fact_number: 1 }] }, legacy), raw);
  const unrelated = { ...raw, relevant: false, evidence_fact_number: 99 };
  assert.deepEqual(validate(unrelated, legacy), { ...unrelated, evidence_fact_number: null });
});
