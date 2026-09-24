const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekExtractor, validateExtraction, exactEvidenceQuote, ENDPOINT } = require('../lib/intelligence/deepseek.cjs');

const sourceText = 'The world added 510 gigawatts of renewable capacity in 2023. This was 50% more than in 2022.';
const valid = {
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
  assert.equal(request.body.max_tokens, 4000);
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
