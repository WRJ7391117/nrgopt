const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekCrossChecker, plausibleSameProject, validateCrossCheck } = require('../lib/intelligence/crosscheck.cjs');
const { ENDPOINT } = require('../lib/intelligence/deepseek.cjs');

const left = {
  title_zh: 'Haden、Muwayh 和 AlKahfah 储能项目', disposition: 'candidate', occurrence_countries: ['SA'],
  organizations_zh: [{ canonical_name: 'ACWA Power' }, { canonical_name: 'Saudi Power Procurement Company (SPPC)' }],
  project_zh: { name_zh: 'Haden、Muwayh 和 AlKahfah 电池储能项目' },
  extraction_zh: { known_facts: [{ claim_zh: '每个项目为500 MW/2,000 MWh。', evidence_quote: 'Each plant is rated at 500 MW with 2,000 MWh of storage capacity.' }] }
};
const right = {
  title_zh: 'Kahafah、Haden 和 Al-Muwaih 储能项目', disposition: 'candidate', occurrence_countries: ['SA'],
  organizations_zh: [{ canonical_name: 'ACWA Power Company (ACWA)' }, { canonical_name: 'SPPC' }],
  project_zh: { name_zh: 'Kahafah、Haden 和 Al-Muwaih BESS 项目' },
  extraction_zh: { known_facts: [{ claim_zh: '三个项目各为500 MW/2,000 MWh。', evidence_quote: 'Each project will have a capacity of 500 MW and 2,000 MWh.' }] }
};

test('strict project prefilter requires country, a named project token and an organization token', () => {
  assert.equal(plausibleSameProject(left, right), true);
  assert.equal(plausibleSameProject(left, { ...right, occurrence_countries: ['AE'] }), false);
  assert.equal(plausibleSameProject(left, { ...right, project_zh: { name_zh: 'Bisha 风电项目' } }), false);
  assert.equal(plausibleSameProject(left, { ...right, organizations_zh: [{ canonical_name: 'Unrelated Developer' }] }), false);
});

test('cross-check output must reference facts that exist on both saved sources', () => {
  const value = { same_project: true, same_scope: false, matching_facts: [{ left_fact_number: 1, right_fact_number: 1, reason_zh: '项目名称与容量一致。' }], conflicting_facts: [] };
  assert.deepEqual(validateCrossCheck(value, 1, 1), value);
  assert.throws(() => validateCrossCheck({ ...value, matching_facts: [{ left_fact_number: 2, right_fact_number: 1, reason_zh: '越界。' }] }, 1, 1), { code: 'cross_check_invalid' });
  assert.throws(() => validateCrossCheck({ same_project: true, same_scope: false, matching_facts: [], conflicting_facts: [] }, 1, 1), { code: 'cross_check_invalid' });
});

test('DeepSeek cross-check sends only bounded saved evidence and validates the response', async () => {
  let request;
  const expected = { same_project: true, same_scope: false, matching_facts: [{ left_fact_number: 1, right_fact_number: 1, reason_zh: '两边均披露每个项目500 MW/2,000 MWh。' }], conflicting_facts: [] };
  const check = createDeepSeekCrossChecker({ apiKey: 'private-test-key', fetchImpl: async (input, init) => {
    request = { input, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { content: JSON.stringify(expected) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 } }), { status: 200 });
  } });
  assert.deepEqual(await check({ left, right }), { ...expected, provider: 'deepseek', model: 'deepseek-flash',
    usage: { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 } });
  assert.equal(request.input, ENDPOINT);
  assert.equal(request.init.headers.Authorization, 'Bearer private-test-key');
  assert.equal(request.body.model, 'deepseek-flash');
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.body.temperature, 0);
  assert.ok(request.body.messages[1].content.includes('500 MW'));
});

test('portfolio overlap alone does not create one project identity', () => {
  const pair = { left_fact_number: 1, right_fact_number: 1, reason_zh: '仅部分项目重合。' };
  assert.equal(validateCrossCheck({ same_project: true, matching_facts: [pair] }, 1, 1).same_scope, false);
  assert.equal(validateCrossCheck({ same_project: true, same_scope: true, matching_facts: [pair] }, 1, 1).same_scope, true);
  assert.throws(() => validateCrossCheck({ same_project: false, same_scope: true, matching_facts: [pair] }, 1, 1), { code: 'cross_check_invalid' });
  assert.throws(() => validateCrossCheck({ same_project: true, same_scope: 'yes', matching_facts: [pair] }, 1, 1), { code: 'cross_check_invalid' });
});
