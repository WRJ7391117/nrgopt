const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAssessment, createHypothesisEvaluator, hypothesisInAnalysis } = require('../lib/intelligence/hypotheses.cjs');
const { assessSavedHypothesis } = require('../lib/intelligence/pipeline.cjs');
const { runDailyJobItem } = require('../lib/intelligence/jobs.cjs');

const sourceId = '11111111-1111-4111-8111-111111111111';
const hypothesisId = '22222222-2222-4222-8222-222222222222';
const fact = { claim_zh: '公告取消采购。', evidence_quote: 'The authority has cancelled the tender for the Haden project.' };
function source(id, quote = fact.evidence_quote) {
  return { id, content_type: 'text/plain', content_sha256: id, extraction_source_sha256: id, extraction_status: 'extracted',
    extraction_zh: { summary_zh: '测试用采购公告。', why_it_matters_zh: '用于验证状态变化。', known_facts: [{ ...fact, evidence_quote: quote }],
      unknowns_zh: ['没有其他资料。'], hypotheses: [], next_signals_zh: ['关注后续公告。'], gcc_relevance_zh: '测试资料。', maturity: 'background', caution_zh: '仅测试。',
      classification: { disposition: 'source_only', radars: [], countries: [], importance: 'low', evidence_status: 'sourced', urgency: 'none', title_zh: '测试', organizations: [], project: null, procurement: null } } };
}
const result = { recommendation: 'rejected', reason_zh: '明确取消对应采购，是直接反证。', fact_numbers: [1], provider: 'deepseek', model: 'test' };
function setup() {
  const calls = [];
  const current = source(sourceId), original = source('original', 'The Haden project tender will be opened next month.');
  const hypothesis = { id: hypothesisId, status: 'open', claim_zh: '该采购可能推进。', candidate: { source_id: original.id } };
  const store = { hypothesis: async () => hypothesis, hypothesisAssessment: async () => null,
    evidence: async id => { const s = id === sourceId ? current : original; return { source: s, bytes: Buffer.from(s.extraction_zh.known_facts[0].evidence_quote) }; },
    startProviderCall: async () => true, finishProviderCall: async () => true,
    providerConfigs: async () => [], reserveBudget: async (...args) => { calls.push(['reserve', ...args]); return 'reservation'; },
    syncProviderBalance: async () => true, releaseBudget: async () => true,
    saveHypothesisAssessment: async (...args) => { calls.push(['save', ...args]); return 'assessment'; } };
  return { store, current, original, hypothesis, calls, args: { store, owner: 'owner', hypothesisId, sourceId, env: { NRGOPT_ANALYSIS_MONTHLY_LIMIT_MICRO: '10000000' },
    jobId: 'job', idempotencyPrefix: 'test', balanceReaderFactory: () => async () => 10000000,
    hypothesisFactory: () => async () => { calls.push(['model']); return result; } } };
}

test('assessment rejects missing evidence, invented fact indices and automatic confirmation', () => {
  for (const invalid of [{ ...result, fact_numbers: [] }, { ...result, fact_numbers: [2] }, { ...result, fact_numbers: ['1'] },
    { ...result, recommendation: 'confirmed' }, { ...result, reason_zh: '' }]) {
    assert.throws(() => validateAssessment(invalid, [fact]), { code: 'hypothesis_invalid' });
  }
  assert.equal(validateAssessment({ ...result, recommendation: 'unchanged', fact_numbers: [] }, [fact]).recommendation, 'unchanged');
});

test('evaluator sends original context and citations, disables thinking and validates provider output', async () => {
  let body;
  const evaluator = createHypothesisEvaluator({ apiKey: 'test-only', fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  } });
  const state = setup();
  const assessed = await evaluator({ ...state, source: state.current });
  assert.equal(assessed.recommendation, 'rejected');
  assert.equal(body.thinking.type, 'disabled');
  const input = JSON.parse(body.messages[1].content);
  assert.equal(input.original.facts.length, 1);
  assert.match(body.messages[0].content, /延期或缺少进展当成取消/);
});

test('validated evidence is assessed through the existing provider budget and persisted', async () => {
  const state = setup();
  assert.equal(await assessSavedHypothesis(state.args), 'assessment');
  assert.equal(state.calls.find(c => c[0] === 'reserve')[3], 'cross_check');
  assert.equal(state.calls.find(c => c[0] === 'save')[4].recommendation, 'rejected');
});

test('replays and terminal hypotheses do not call or charge the model', async () => {
  for (const terminal of [false, true]) {
    const state = setup();
    if (terminal) state.hypothesis.status = 'rejected';
    else state.store.hypothesisAssessment = async () => ({ id: 'saved' });
    await assessSavedHypothesis(state.args);
    assert.deepEqual(state.calls, []);
  }
});

test('historical hypotheses absent from current analysis retain history without paid reassessment', async () => {
  const state = setup();
  state.hypothesis.current_in_analysis = false;
  assert.deepEqual(await assessSavedHypothesis(state.args), { skipped: 'not_in_current_analysis' });
  assert.deepEqual(state.calls, []);
  assert.equal(state.hypothesis.status, 'open');
  const hypothesis = { claim_zh: '项目可能推进。', counter_evidence_zh: '明确取消。' };
  assert.equal(hypothesisInAnalysis(hypothesis, { hypotheses: [{ hypothesis_zh: hypothesis.claim_zh, counter_evidence_zh: hypothesis.counter_evidence_zh }] }), true);
  assert.equal(hypothesisInAnalysis(hypothesis, { hypotheses: [] }), false);
  assert.equal(hypothesisInAnalysis(hypothesis, { hypotheses: [{ hypothesis_zh: hypothesis.claim_zh, counter_evidence_zh: '不同反证范围。' }] }), false);
});

test('same announcement with changed HTML or paraphrased analysis does not trigger paid reassessment', async () => {
  const state = setup();
  state.original.extraction_zh.known_facts = [{ ...fact, claim_zh: '同一事实的不同中文表述。' }];
  state.original.final_url = state.current.final_url = 'https://official.example/notice';
  state.original.title = state.current.title = 'Official notice';
  await assessSavedHypothesis(state.args);
  assert.deepEqual(state.calls, []);
});

test('stale extraction hash and fabricated quotation stop before provider billing', async () => {
  for (const type of ['hash', 'quote']) {
    const state = setup();
    if (type === 'hash') state.current.extraction_source_sha256 = 'wrong';
    else { const read = state.store.evidence; state.store.evidence = async id => ({ ...await read(id), bytes: Buffer.from('Unrelated original evidence.') }); }
    await assert.rejects(assessSavedHypothesis(state.args));
    assert.deepEqual(state.calls, []);
  }
});

test('hypothesis queue runs assessment and uses retry or budget pause on failure', async () => {
  for (const failure of [null, 'budget_exhausted', 'model_unavailable']) {
    const state = setup();
    const item = { id: 'item', job_run_id: 'job', item_key: `hypothesis:${hypothesisId}:${sourceId}`, attempts: 1,
      checkpoint: { hypothesis_id: hypothesisId, source_id: sourceId } };
    state.store.claimJobItem = async () => item;
    state.store.finishJobItem = async (_owner, _id, status) => { state.calls.push(['finish', status]); return true; };
    if (failure) state.store.reserveBudget = async () => { throw Object.assign(new Error(failure), { code: failure }); };
    const outcome = await runDailyJobItem(state.args);
    assert.equal(outcome.status, failure === 'budget_exhausted' ? 'budget_paused' : failure ? 'retry' : 'succeeded');
  }
});

test('target selection includes same-URL corrections, excludes unrelated projects and identical facts', async () => {
  const { createStore } = require('../lib/intelligence/store.cjs');
  const candidate = { id: 'new', source_id: 'new-source', disposition: 'candidate', project_zh: null };
  const peers = ['correction', 'unrelated', 'same-facts'].map(id => ({ id, source_id: id, disposition: 'candidate' }));
  const newSource = { final_url: 'https://example.test/news', content_sha256: 'new-hash', extraction_zh: { known_facts: [fact] } };
  const calls = [];
  const store = createStore({ url: 'https://db.test', serviceKey: 'test' }, async input => {
    const url = new URL(input); calls.push(url);
    let body;
    if (url.pathname.endsWith('intelligence_candidates')) body = peers;
    else if (url.pathname.endsWith('intelligence_sources')) body = peers.map(p => ({ id: p.id, content_sha256: p.id,
      final_url: p.id === 'unrelated' ? 'https://elsewhere.test/news' : newSource.final_url,
      extraction_zh: { known_facts: p.id === 'same-facts' ? [fact] : [], hypotheses: [{ hypothesis_zh: '当前命题' }] } }));
    else if (url.pathname.endsWith('intelligence_hypotheses')) { assert.equal(url.searchParams.get('candidate_id'), 'in.(correction)'); body = [
      { id: hypothesisId, candidate_id: 'correction', claim_zh: '当前命题' },
      { id: 'historical', candidate_id: 'correction', claim_zh: '旧命题' }]; }
    else throw new Error('unexpected request');
    assert.equal(url.searchParams.get('owner_id'), 'eq.owner');
    return new Response(JSON.stringify(body));
  });
  assert.deepEqual(await store.assessmentTargets(candidate, newSource, 'owner'), [{ id: hypothesisId }]);
  assert.equal(calls.length, 3);
});
