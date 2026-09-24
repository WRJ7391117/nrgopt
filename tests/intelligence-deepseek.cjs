const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekExtractor, validateExtraction, exactEvidenceQuote, ENDPOINT } = require('../lib/intelligence/deepseek.cjs');
const { validateNumericFacts, validateCommercialEvents } = require('../lib/intelligence/fact-context.cjs');

test('IT load requires explicit IT evidence rather than a generic AI data-centre capacity', () => {
  const fact = { evidence_quote: 'The 100 MW AI-optimized data center received a design certification.' };
  const input = { object_zh: '数据中心', field_zh: 'IT负荷', value_text: '100', unit: 'MW', raw_text: '100 MW AI-optimized data center',
    basis: 'it_load', basis_text: 'AI-optimized data center', evidence_fact_number: 1 };
  assert.throws(() => validateNumericFacts([input], [fact]), { code: 'extraction_invalid_numeric_fact' });
  const quote = '100 MW total IT load: Engineered to support hyperscale and AI workloads at scale.';
  const result = validateNumericFacts([{ ...input, raw_text: '100 MW total IT load', basis_text: 'total IT load' }], [{ evidence_quote: quote }]);
  assert.equal(result[0].basis, 'it_load');
  assert.equal(result[0].value, 100);
});

const sourceText = 'The world added 510 gigawatts of renewable capacity in 2023. This was 50% more than in 2022.';
const valid = {
  numeric_facts: [], commercial_events: [],
  summary_zh: '全球可再生能源新增装机在2023年明显增长。',
  why_it_matters_zh: '这是宏观市场背景，不能单独证明海合会存在具体项目或采购。',
  known_facts: [{ claim_zh: '2023年全球新增可再生能源装机达到510吉瓦。', evidence_quote: 'The world added 510 gigawatts of renewable capacity in 2023.' }],
  unknowns_zh: ['没有披露海合会具体项目。'],
  hypotheses: [{ hypothesis_zh: '增长趋势可能带动后续电网灵活性需求。', counter_evidence_zh: '若没有区域项目或采购文件，则不能形成具体机会判断。' }],
  next_signals_zh: ['观察海合会可研、融资、招标和授标文件。'],
  gcc_relevance_zh: '尚未发现直接关联。', maturity: 'background', caution_zh: '模型初析，需人工核对。',
  classification: { disposition: 'source_only', radars: [], countries: [], importance: 'low', evidence_status: 'sourced', urgency: 'none', title_zh: '全球可再生能源背景', organizations: [], project: null, procurement: null }
};

test('validated extraction keeps bounded Chinese fields and exact source evidence', () => {
  const result = validateExtraction(valid, sourceText);
  assert.equal(result.maturity, 'background');
  assert.equal(result.known_facts[0].evidence_quote, valid.known_facts[0].evidence_quote);
  assert.equal(result.unknowns_zh.length, 1);
});

test('fabricated or paraphrased evidence quote rejects the whole extraction', () => {
  const fabricated = structuredClone(valid);
  fabricated.known_facts[0].evidence_quote = 'The source definitely announced a GCC procurement contract.';
  assert.throws(() => validateExtraction(fabricated, sourceText), { code: 'extraction_invalid_known_fact_quote', status: 422 });
});

test('typographic quote differences resolve back to exact source characters', () => {
  const source = 'The project’s award – worth SAR 9 billion – was announced.';
  const quote = exactEvidenceQuote(source, "The project's award - worth SAR 9 billion - was announced.");
  assert.equal(quote, source);
  assert.equal(exactEvidenceQuote(source, 'The project award was announced.'), null);
});

test('evidence remains complete beyond 500 characters and rejects invented suffixes', () => {
  const long = 'The project announcement states: ' + 'Official project details. '.repeat(25) + 'Capacity is 3010 MW.';
  const extraction = structuredClone(valid);
  extraction.known_facts[0].evidence_quote = long;
  assert.equal(validateExtraction(extraction, long).known_facts[0].evidence_quote, long);
  extraction.known_facts[0].evidence_quote += ' Invented claim.';
  assert.throws(() => validateExtraction(extraction, long), { code: 'extraction_invalid_known_fact_quote' });
  extraction.known_facts[0].evidence_quote = 'x'.repeat(2001);
  assert.throws(() => validateExtraction(extraction, extraction.known_facts[0].evidence_quote), { code: 'extraction_invalid_known_fact_quote' });
});

test('Chinese and Arabic quotations retain exact offsets after supplementary characters', () => {
  for (const quote of ['项目建设正式启动，容量尚未公布。', 'بدأ تنفيذ مشروع الطاقة ولم تعلن القدرة.']) {
    assert.equal(exactEvidenceQuote('News 🌍 ' + quote, quote), quote);
  }
});

test('GCC candidate requires an occurrence country and exact evidence for entities and project', () => {
  const candidate = structuredClone(valid);
  candidate.classification = {
    disposition: 'candidate', radars: ['project'],
    countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '来源明确涉及沙特项目。', evidence_fact_number: 1 }],
    importance: 'high', evidence_status: 'sourced', urgency: 'research', title_zh: '沙特项目候选',
    organizations: [{ canonical_name: 'Example Organization', role_zh: '来源提及机构', evidence_fact_number: 1 }],
    project: { name_zh: '项目候选', stage_zh: '待核对', evidence_fact_number: 1 }, procurement: null
  };
  assert.equal(validateExtraction(candidate, sourceText).classification.countries[0].code, 'SA');
  candidate.classification.project.evidence_fact_number = 2;
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid_project_evidence' });
});

test('formal project and procurement candidates require evidence-linked names', () => {
  const candidate = structuredClone(valid);
  candidate.classification = {
    disposition: 'candidate', radars: ['project'],
    countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '来源明确涉及沙特项目。', evidence_fact_number: 1 }],
    importance: 'high', evidence_status: 'sourced', urgency: 'research', title_zh: '沙特项目候选', organizations: [],
    project: { name_zh: '', stage_zh: '资格预审', evidence_fact_number: 1 }, procurement: null
  };
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid_project_evidence' });
  candidate.classification.project.name_zh = '项目候选';
  candidate.classification.procurement = { package_zh: '', stage_zh: '资格预审', deadline_text: '', evidence_fact_number: 1 };
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid_procurement_evidence' });
});

test('source-only background cannot silently carry radar or project claims', () => {
  for (const fields of [
    { radars: ['project'] },
    { project: { name_zh: '项目', evidence_fact_number: 1 } },
    { procurement: { package_zh: '采购', evidence_fact_number: 1 } }
  ]) {
    const invalid = structuredClone(valid);
    Object.assign(invalid.classification, fields);
    assert.throws(() => validateExtraction(invalid, sourceText), { code: 'extraction_invalid_source_only_consistency' });
  }
});

test('missing or invalid disposition is rejected instead of silently becoming background', () => {
  for (const disposition of [undefined, null, '', 'project']) {
    const invalid = structuredClone(valid);
    invalid.classification.disposition = disposition;
    assert.throws(() => validateExtraction(invalid, sourceText), { code: 'extraction_invalid_classification' });
  }
});

test('DeepSeek request uses only its server key and returns validated JSON', async () => {
  let request;
  const extract = createDeepSeekExtractor({ apiKey: 'private-test-key', fetchImpl: async (input, init) => {
    request = { input, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { content: JSON.stringify(valid) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 } }), { status: 200 });
  } });
  const result = await extract({ title: 'Energy', url: 'https://source.example', sourceText });
  assert.equal(request.input, ENDPOINT);
  assert.equal(request.init.headers.Authorization, 'Bearer private-test-key');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.body.model, 'deepseek-flash');
  assert.equal(request.body.temperature, 0);
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.body.max_tokens, 6000);
  assert.ok(request.body.messages.some(message => message.content.includes('<source>')));
  assert.equal(result.extraction.summary_zh, valid.summary_zh);
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 50,
    prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 });
});

test('missing key and upstream authentication errors expose stable codes', async () => {
  assert.throws(() => createDeepSeekExtractor({}), { code: 'model_not_configured', status: 503 });
  assert.throws(() => createDeepSeekExtractor({ apiKey: 'key', endpoint: null }), { code: 'model_not_configured', status: 503 });
  const extract = createDeepSeekExtractor({ apiKey: 'bad', fetchImpl: async () => new Response('private provider detail', { status: 401 }) });
  await assert.rejects(extract({ title: '', url: 'https://source.example', sourceText }), { code: 'model_auth_failed', status: 502 });
});

test('analysis provider accepts configured identity, model and endpoint', async () => {
  let request;
  const extract = createDeepSeekExtractor({ apiKey: 'key', provider: 'custom-analysis', model: 'analysis-v2',
    endpoint: 'https://analysis.example/v1/chat/completions', fetchImpl: async (input, init) => {
      request = { input, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
    } });
  const result = await extract({ title: 'Energy', url: 'https://source.example', sourceText });
  assert.equal(request.input, 'https://analysis.example/v1/chat/completions');
  assert.equal(request.body.model, 'analysis-v2');
  assert.equal(request.body.thinking, undefined);
  assert.equal(result.provider, 'custom-analysis');
  assert.equal(result.model, 'analysis-v2');
});

test('numeric facts preserve IT load, units and missing context without inventing facility load or energy', () => {
  const quote = 'Phase 1 provides 100 MW of IT load; facility load and storage duration were not disclosed.';
  const facts = [{ evidence_quote: quote }];
  const input = { object_zh: '一期数据中心', field_zh: 'IT容量', value_text: '100', unit: 'MW',
    raw_text: '100 MW of IT load', basis: 'it_load', basis_text: 'IT load', scope_text: 'Phase 1', evidence_fact_number: 1 };
  const result = validateNumericFacts([input], facts);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 100);
  assert.equal(result[0].basis, 'it_load');
  assert.equal(result[0].effective_date_text, null);
  assert.equal(result[0].value_min, null);
  assert.equal(result[0].check_status, 'quote_bound');
  for (const changes of [{ unit: 'MWh' }, { value_text: '0' }, { fact_type: 'estimated' }, { effective_date_text: '2027' }]) {
    assert.throws(() => validateNumericFacts([{ ...input, ...changes }], facts), { code: 'extraction_invalid_numeric_fact' });
  }
  assert.equal(validateNumericFacts(undefined, facts), null, 'legacy absence is not zero or a verified empty result');
});

test('power, peak, AC and energy quantities remain separate and unknown basis is not guessed', () => {
  const quote = 'Solar: 120 MWp and 100 MWac. BESS: 50 MW / 200 MWh nameplate energy and 180 MWh usable energy.';
  const entries = [
    ['120', 'MWp', 'pv_peak', '120 MWp'], ['100', 'MWac', 'pv_ac', '100 MWac'],
    ['50', 'MW', 'storage_power', '50 MW'], ['200', 'MWh', 'nameplate_energy', '200 MWh nameplate energy'],
    ['180', 'MWh', 'usable_energy', '180 MWh usable energy']
  ].map(([value_text, unit, basis, raw_text]) => ({ object_zh: '项目', field_zh: '容量', value_text, unit, basis, raw_text, basis_text: raw_text, evidence_fact_number: 1 }));
  const result = validateNumericFacts(entries, [{ evidence_quote: quote }]);
  assert.deepEqual(result.map(item => [item.value, item.unit, item.basis]), entries.map(item => [Number(item.value_text), item.unit, item.basis]));
  for (const [index, changes] of [[0, { unit: 'MW' }], [1, { basis: 'pv_peak' }], [2, { basis: 'nameplate_energy' }]]) {
    assert.throws(() => validateNumericFacts([{ ...entries[index], ...changes }], [{ evidence_quote: quote }]), { code: 'extraction_invalid_numeric_fact' });
  }
});

test('numerical ranges, currency and scale keep original disclosures without currency conversion', () => {
  const quote = 'Phase 2 plans 100–200 MW, costing $8.3 billion, excluding tax. No currency code was given.';
  const input = { object_zh: '二期项目', field_zh: '规划容量', value_text: '100–200', unit: 'MW', raw_text: '100–200 MW',
    basis: 'unspecified', scope_text: 'Phase 2', stage_text: 'plans', evidence_fact_number: 1 };
  const capacity = validateNumericFacts([input], [{ evidence_quote: quote }])[0];
  assert.equal(capacity.value, null);
  assert.deepEqual([capacity.value_min, capacity.value_max], [100, 200]);
  const amount = { ...input, field_zh: '项目投资', value_text: '8.3', unit: '$', raw_text: '$8.3 billion', scale_text: 'billion', tax_text: 'excluding tax' };
  const investment = validateNumericFacts([amount], [{ evidence_quote: quote }])[0];
  assert.equal(investment.value, 8.3);
  assert.equal(investment.scale_text, 'billion');
  assert.equal(investment.currency, null);
  assert.throws(() => validateNumericFacts([{ ...amount, currency: 'USD' }], [{ evidence_quote: quote }]), { code: 'extraction_invalid_numeric_fact' });
  assert.equal(validateNumericFacts([{ ...input, value_text: '0', raw_text: '0 MW', scope_text: null, stage_text: null }], [{ evidence_quote: 'Disclosed capacity is 0 MW.' }])[0].value, 0);
});

test('commercial events retain EPC and named equipment package stages independently', () => {
  const facts = [{ evidence_quote: 'The EPC contract was awarded. The battery package tender is open; other equipment contracts are not disclosed.' }];
  const epc = { object_zh: '总承包', scope: 'epc', stage: 'awarded', scope_text: 'EPC contract', stage_text: 'awarded', evidence_fact_number: 1 };
  const equipment = { object_zh: '电池包', scope: 'equipment', stage: 'open', scope_text: 'battery package', stage_text: 'tender is open', evidence_fact_number: 1 };
  assert.deepEqual(validateCommercialEvents([epc, equipment], facts).map(item => [item.scope, item.stage]), [['epc', 'awarded'], ['equipment', 'open']]);
  assert.equal(validateCommercialEvents([epc], facts).some(item => item.scope === 'equipment'), false);
  assert.throws(() => validateCommercialEvents([{ ...equipment, stage_text: 'equipment contract signed' }], facts), { code: 'extraction_invalid_commercial_event' });
  assert.equal(validateCommercialEvents(undefined, facts), null);
});

test('unbound numerical or package context is excluded with visible warnings while exact facts remain usable', () => {
  const quote = 'Phase 1 has 100 MWac. The construction contract was awarded.';
  const input = { ...valid, known_facts: [{ claim_zh: '一期容量100MWac，施工合同已授标。', evidence_quote: quote }],
    numeric_facts: [{ object_zh: '一期', field_zh: '容量', value_text: '100', unit: 'MWac', raw_text: '100 MWac', basis: 'pv_ac', basis_text: 'MWac', evidence_fact_number: 1 },
      { object_zh: '总负荷', field_zh: '功率', value_text: '200', unit: 'MW', raw_text: '200 MW', evidence_fact_number: 1 }],
    commercial_events: [{ object_zh: '施工合同', scope: 'epc', stage: 'awarded', scope_text: 'construction contract', stage_text: 'awarded', evidence_fact_number: 1 }] };
  const result = validateExtraction(input, quote);
  assert.equal(result.known_facts.length, 1);
  assert.equal(result.numeric_facts.length, 1);
  assert.deepEqual(result.commercial_events, []);
  assert.equal(result.context_issues.length, 2);
  assert.equal(validateExtraction(result, quote).context_issues.length, 2, 'replaying sanitized output preserves warnings');
});
