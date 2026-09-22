const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekExtractor, validateExtraction, ENDPOINT } = require('../lib/intelligence/deepseek.cjs');

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
  assert.throws(() => validateExtraction(fabricated, sourceText), { code: 'extraction_invalid', status: 422 });
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
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid' });
});

test('formal project and procurement candidates require evidence-linked names', () => {
  const candidate = structuredClone(valid);
  candidate.classification = {
    disposition: 'candidate', radars: ['project'],
    countries: [{ code: 'SA', relation: 'occurrence', rationale_zh: '来源明确涉及沙特项目。', evidence_fact_number: 1 }],
    importance: 'high', evidence_status: 'sourced', urgency: 'research', title_zh: '沙特项目候选', organizations: [],
    project: { name_zh: '', stage_zh: '资格预审', evidence_fact_number: 1 }, procurement: null
  };
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid' });
  candidate.classification.project.name_zh = '项目候选';
  candidate.classification.procurement = { package_zh: '', stage_zh: '资格预审', deadline_text: '', evidence_fact_number: 1 };
  assert.throws(() => validateExtraction(candidate, sourceText), { code: 'extraction_invalid' });
});

test('source-only background cannot silently carry radar or project claims', () => {
  const invalid = structuredClone(valid);
  invalid.classification.radars = ['project'];
  assert.throws(() => validateExtraction(invalid, sourceText), { code: 'extraction_invalid' });
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
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.body.max_tokens, 4000);
  assert.ok(request.body.messages.some(message => message.content.includes('<source>')));
  assert.equal(result.extraction.summary_zh, valid.summary_zh);
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 50,
    prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 });
});

test('missing key and upstream authentication errors expose stable codes', async () => {
  assert.throws(() => createDeepSeekExtractor({}), { code: 'model_not_configured', status: 503 });
  const extract = createDeepSeekExtractor({ apiKey: 'bad', fetchImpl: async () => new Response('private provider detail', { status: 401 }) });
  await assert.rejects(extract({ title: '', url: 'https://source.example', sourceText }), { code: 'model_auth_failed', status: 502 });
});
