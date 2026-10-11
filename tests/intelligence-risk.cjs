const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRisk, riskSnapshot, riskFactFingerprint } = require('../lib/intelligence/risk.cjs');

const now = new Date('2026-10-11T08:00:00Z');
function analysis(quote = 'Harbor International Airport in Saudi Arabia was attacked on 10 October 2026.') {
  return {
    known_facts: [{ claim_zh: '来源报道沙特海港国际机场10月10日遭袭。', statement_type: 'report', attribution_zh: '测试新闻来源', evidence_quote: quote }],
    unknowns_zh: ['能源供应影响未披露。'], next_signals_zh: [], numeric_facts: [],
    classification: { disposition: 'source_only', energy_scope: 'none', countries: [{ code: 'SA', relation: 'occurrence', evidence_fact_number: 1 }] },
    risk_signal: { event_type: 'attack', facility_zh: '海港国际机场', facility_name: 'Harbor International Airport', country_code: 'SA',
      event_date: '2026-10-10', event_status: 'reported_event', severity: 'high', impact_status: 'unknown', fact_numbers: [1], date_fact_number: 1 },
  };
}
const source = { publication_date: '2026-10-10', fetched_at: '2026-10-10T20:00:00Z' };

test('recent attributed facility attack remains a risk with unknown energy impact and source-only classification', () => {
  const input = analysis();
  const normalized = normalizeRisk(input, input.known_facts[0].evidence_quote);
  assert.equal(normalized.impact_status, 'unknown');
  const snapshot = riskSnapshot(source, input, now);
  assert.equal(snapshot.status, 'reported');
  assert.equal(snapshot.notification_eligible, true);
  assert.equal(snapshot.event_date, '2026-10-10');
  assert.equal(snapshot.publication_date, '2026-10-10');
  assert.equal(snapshot.first_collected_at, source.fetched_at);
  assert.match(snapshot.event_key, /^[a-f0-9]{64}$/);
  assert.equal(typeof snapshot.facts[0], 'string');
  assert.equal(snapshot.fact_numbers[0], 1);
  assert.equal(snapshot.facts[0], input.known_facts[0].claim_zh);
  assert.equal(input.classification.disposition, 'source_only');
  assert.equal(input.classification.energy_scope, 'none');
  assert.ok(snapshot.unknowns_zh.some(text => text.includes('能源供应影响')));
});

test('condemnation statement or unknown event date is pending verification, never an immediate flash', () => {
  const input = analysis('A ministry condemned the attack on Harbor International Airport in Saudi Arabia.');
  Object.assign(input.risk_signal, { event_status: 'statement_only', event_date: null, date_fact_number: null });
  const snapshot = riskSnapshot(source, input, now);
  assert.equal(snapshot.status, 'pending_verification');
  assert.equal(snapshot.notification_eligible, false);
  assert.equal(snapshot.event_key, null);
  assert.ok(snapshot.unknowns_zh.some(text => text.includes('来源发布日期不代表事件发生日')));
  input.risk_signal.event_status = 'reported_event';
  assert.throws(() => normalizeRisk(input, input.known_facts[0].evidence_quote), { code: 'extraction_invalid_risk_statement' });
});

test('new publication cannot revive a historical event as breaking news', () => {
  const input = analysis('Harbor International Airport in Saudi Arabia was attacked on 10 October 2025.');
  input.risk_signal.event_date = '2025-10-10';
  const snapshot = riskSnapshot({ publication_date: '2026-10-11' }, input, now);
  assert.equal(snapshot.status, 'historical');
  assert.equal(snapshot.notification_eligible, false);
  assert.equal(snapshot.event_date, '2025-10-10');
});

test('four-to-thirty-day reported risks remain visible without flashes; thirty-one-day events are historical', () => {
  const recent = analysis('Harbor International Airport in Saudi Arabia was attacked on 7 October 2026.');
  recent.risk_signal.event_date = '2026-10-07';
  recent.classification.topics = [{ code: 'red-sea', evidence_fact_number: 1 }];
  const snapshot = riskSnapshot({ publication_date: '2026-10-11' }, recent, now);
  assert.equal(snapshot.status, 'reported');
  assert.equal(snapshot.notification_eligible, false);
  assert.deepEqual(snapshot.topic_codes, ['red-sea']);
  const historical = analysis('Harbor International Airport in Saudi Arabia was attacked on 10 September 2026.');
  historical.risk_signal.event_date = '2026-09-10';
  assert.equal(riskSnapshot({ publication_date: '2026-10-11' }, historical, now).status, 'historical');
});

test('confirmed energy scope preserves its existing analysis while ordinary facility risks retain unknown energy impact', () => {
  const ordinary = riskSnapshot(source, analysis(), now);
  assert.equal(ordinary.energy_impact_zh, '现有原文未披露能源影响。');
  const energy = analysis();
  energy.classification.energy_scope = 'direct';
  energy.why_it_matters_zh = '来源披露设施供电中断，恢复供电时间仍未知。';
  energy.unknowns_zh = [];
  const snapshot = riskSnapshot(source, energy, now);
  assert.equal(snapshot.energy_impact_zh, energy.why_it_matters_zh);
  assert.equal(snapshot.unknowns_zh.some(text => text === '能源供应影响尚未披露。'), false);
  assert.equal(energy.classification.disposition, 'source_only');
});

test('publication date, unsupported location, invented facility, and viewpoint cannot establish a risk', () => {
  for (const [change, code] of [[{ event_date: '2026-10-11' }, 'date'], [{ event_date: '2026-02-30' }, 'date'],
    [{ country_code: 'QA' }, 'evidence'], [{ facility_name: 'Invented Airport' }, 'evidence'], [{ facility_name: 'Saudi Arabia' }, 'facility'], [{ impact_status: 'damaged' }, 'impact']]) {
    const input = analysis(); Object.assign(input.risk_signal, change);
    assert.throws(() => normalizeRisk(input, input.known_facts[0].evidence_quote), { code: `extraction_invalid_risk_${code}` });
  }
  for (const type of ['opinion', 'unknown', undefined]) {
    const input = analysis(); input.known_facts[0].statement_type = type;
    assert.throws(() => normalizeRisk(input, input.known_facts[0].evidence_quote), { code: 'extraction_invalid_risk_evidence' });
  }
  const prediction = analysis('Harbor International Airport in Saudi Arabia could be attacked on 10 October 2026.');
  assert.throws(() => normalizeRisk(prediction, prediction.known_facts[0].evidence_quote), { code: 'extraction_invalid_risk_statement' });
});

test('risk citations must resolve to exact source facts and event date must be bound to the event', () => {
  const input = analysis();
  assert.throws(() => normalizeRisk(input, 'Unrelated original text.'), { code: 'extraction_invalid_risk_evidence' });
  input.known_facts.push({ claim_zh: '报道发表于今日。', statement_type: 'report', attribution_zh: '测试来源', evidence_quote: 'Publication date: 11 October 2026.' });
  input.risk_signal.fact_numbers = [1, 2];
  input.risk_signal.date_fact_number = 2;
  input.risk_signal.event_date = '2026-10-11';
  assert.throws(() => normalizeRisk(input, input.known_facts.map(fact => fact.evidence_quote).join('\n')), { code: 'extraction_invalid_risk_date' });
});

test('ISO, Chinese and Arabic explicit dates are retained without relative-day inference', () => {
  for (const date of ['2026-10-10', '2026年10月10日', '10 أكتوبر 2026']) {
    const input = analysis(`Harbor International Airport in Saudi Arabia was attacked on ${date}.`);
    assert.equal(normalizeRisk(input, input.known_facts[0].evidence_quote).event_date, '2026-10-10');
  }
  const relative = analysis('Harbor International Airport in Saudi Arabia was attacked yesterday.');
  assert.throws(() => normalizeRisk(relative, relative.known_facts[0].evidence_quote), { code: 'extraction_invalid_risk_date' });
});

test('same incident across sources shares identity and fingerprint; another occurrence date is distinct', () => {
  const first = analysis();
  const second = analysis('Another news agency reported Harbor International Airport in Saudi Arabia was attacked on October 10, 2026.');
  second.known_facts[0].claim_zh = '另一家媒体转述同次机场袭击。';
  second.risk_signal.facility_zh = ' 海港 国际机场 ';
  const a = riskSnapshot(source, first, now);
  const b = riskSnapshot({ ...source, publication_date: '2026-10-11' }, second, now);
  assert.equal(a.event_key, b.event_key);
  assert.equal(a.fact_fingerprint, b.fact_fingerprint);
  const again = analysis('Harbor International Airport in Saudi Arabia was attacked on 11 October 2026.');
  again.risk_signal.event_date = '2026-10-11';
  assert.notEqual(a.event_key, riskSnapshot({ publication_date: '2026-10-11' }, again, now).event_key);
});

test('only grounded material impact and structured numeric changes update the fingerprint', () => {
  const first = analysis();
  const numeric = { basis: 'facility_load', value_text: '100', unit: 'MW', evidence_fact_number: 1 };
  const other = structuredClone(first);
  other.unknowns_zh = ['另一种措辞的未知项'];
  other.numeric_facts = [{ ...numeric, evidence_fact_number: 2 }];
  assert.equal(riskFactFingerprint(first.risk_signal, first), riskFactFingerprint(other.risk_signal, other));
  other.numeric_facts = [numeric];
  assert.notEqual(riskFactFingerprint(first.risk_signal, first), riskFactFingerprint(other.risk_signal, other));
  const damaged = analysis('Harbor International Airport in Saudi Arabia was attacked and damaged on 10 October 2026.');
  damaged.risk_signal.impact_status = 'damaged';
  assert.notEqual(riskSnapshot(source, first, now).fact_fingerprint, riskSnapshot(source, damaged, now).fact_fingerprint);
});

test('historical missing risk metadata produces only conservative pending clues without mutation', () => {
  const input = analysis('Officials condemned an attack on Harbor International Airport in Saudi Arabia.');
  delete input.risk_signal;
  const before = JSON.stringify(input);
  const snapshot = riskSnapshot(source, input, now);
  assert.equal(snapshot.status, 'pending_verification');
  assert.equal(snapshot.event_status, 'statement_only');
  assert.equal(snapshot.event_date, null);
  assert.equal(snapshot.event_key, null);
  assert.equal(snapshot.notification_eligible, false);
  assert.equal(snapshot.legacy, true);
  assert.equal(JSON.stringify(input), before);
  input.risk_signal = null;
  assert.equal(riskSnapshot(source, input, now), null, 'explicit new-model absence is not overridden by legacy inference');
  delete input.risk_signal;
  input.known_facts[0].statement_type = 'opinion';
  assert.equal(riskSnapshot(source, input, now), null);
});

test('unknown publication dates, stale publications and future events never receive flash eligibility', () => {
  for (const date of [null, '2026-10-01', '2026-10-12']) assert.equal(riskSnapshot({ publication_date: date }, analysis(), now).notification_eligible, false);
  const future = analysis('Harbor International Airport in Saudi Arabia was attacked on 12 October 2026.');
  future.risk_signal.event_date = '2026-10-12';
  assert.equal(riskSnapshot({ publication_date: '2026-10-11' }, future, now).notification_eligible, false);
});

test('risk snapshots keep fact references and fit the queue without duplicating long original quotes', () => {
  const input = analysis();
  const quote = input.known_facts[0].evidence_quote + ' '.repeat(1900);
  input.known_facts = Array.from({ length: 8 }, () => ({ claim_zh: '𠮷'.repeat(300), statement_type: 'report', attribution_zh: '𠮷'.repeat(200), evidence_quote: quote }));
  input.unknowns_zh = Array.from({ length: 6 }, (_, i) => '𠮷'.repeat(239) + i);
  input.next_signals_zh = input.unknowns_zh;
  input.why_it_matters_zh = '𠮷'.repeat(700);
  input.classification.energy_scope = 'direct';
  input.risk_signal.fact_numbers = [1,2,3,4,5,6,7,8];
  const snapshot = riskSnapshot(source, input, now);
  assert.equal(snapshot.fact_numbers.length, 8);
  assert.equal(input.known_facts.length, 8);
  assert.equal(input.known_facts[0].evidence_quote, quote);
  assert.equal(snapshot.facts.length, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 17000);
});
