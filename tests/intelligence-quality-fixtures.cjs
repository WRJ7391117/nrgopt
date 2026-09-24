const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/intelligence-quality-v1.json');
const { evaluateQuality } = require('../scripts/intelligence-quality-report.cjs');

const officialHosts = new Set(['www.pif.gov.sa', 'www.spa.gov.sa']);
const radars = new Set(['trigger', 'demand', 'project']);
const maturities = new Set(['background', 'signal', 'demand', 'project', 'opportunity', 'procurement', 'contract']);

test('frozen quality baseline contains attributed English, Chinese and Arabic official excerpts', () => {
  assert.deepEqual(new Set(fixtures.map(item => item.language)), new Set(['en', 'zh', 'ar']));
  assert.equal(new Set(fixtures.map(item => item.id)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.ok(officialHosts.has(new URL(fixture.source_url).hostname));
    assert.match(fixture.source_page_sha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.acquired_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(fixture.usage_note, /official/i);
    assert.equal(fixture.expected.disposition, 'candidate');
    assert.equal(fixture.expected.occurrence_country, 'SA');
    assert.ok(fixture.expected.radars.length && fixture.expected.radars.every(item => radars.has(item)));
    assert.ok(maturities.has(fixture.expected.maturity));
    assert.ok(fixture.expected.facts.length >= 2);
    for (const fact of fixture.expected.facts) {
      assert.ok(fact.claim_zh.length > 5);
      assert.ok(fixture.text.includes(fact.evidence_quote));
    }
  }
  assert.match(fixtures.find(item => item.language === 'zh').text, /[\u3400-\u9fff]/u);
  assert.match(fixtures.find(item => item.language === 'ar').text, /[\u0600-\u06ff]/u);
  assert.match(fixtures.find(item => item.language === 'en').text, /\bpower purchase agreements\b/i);
});

test('quality denominators retain missing outputs, separate languages and never invent recall', () => {
  const cases = [
    { id: 'en-hit', language: 'en', expected: { disposition: 'candidate', occurrence_countries: ['SA'] }, early_signal: true },
    { id: 'en-missing', language: 'en', expected: { disposition: 'candidate' }, early_signal: true },
    { id: 'zh-unlabelled', language: 'zh' },
    { id: 'ar-unknown', language: 'ar', expected: { project: null } }
  ];
  const report = evaluateQuality(cases, [
    { id: 'en-hit', extraction: { classification: { disposition: 'candidate', countries: [{ code: 'SA', relation: 'occurrence' }, { code: 'AE', relation: 'relevance' }], radars: ['demand'] } } },
    { id: 'ar-unknown', extraction: { classification: { project: null } } },
    { id: 'outside-set', extraction: {} }
  ]);
  assert.equal(report.total.checked_fields, 4);
  assert.equal(report.total.correct_fields, 3);
  assert.equal(report.total.field_accuracy, 0.75);
  assert.equal(report.total.early_signal_recall, 0.5);
  assert.equal(report.languages.en.early_signal_positives, 2);
  assert.equal(report.languages.zh.field_accuracy, null);
  assert.equal(report.languages.ar.early_signal_recall, null);
  assert.equal(report.total.unlabelled_cases, 1);
  assert.equal(report.total.missing_predictions, 2);
  assert.equal(report.unmatched_predictions, 1);
  assert.equal(evaluateQuality([], []).total.field_accuracy, null);
});

test('quality reports reject duplicate cases and distinguish an omitted field from explicit unknown', () => {
  const one = { id: 'case', language: 'zh', expected: { project: null } };
  assert.throws(() => evaluateQuality([one, one], []), /quality_ids_invalid/);
  assert.throws(() => evaluateQuality([one], [{ id: 'case' }, { id: 'case' }]), /quality_ids_invalid/);
  const report = evaluateQuality([one], [{ id: 'case', extraction: { classification: {} } }]);
  assert.equal(report.total.correct_fields, 0);
  assert.equal(report.total.checked_fields, 1);
  assert.throws(() => evaluateQuality([{ ...one, expected: { imaginary_score: 100 } }], []), /quality_reference_field_invalid/);
});
