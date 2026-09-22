const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/intelligence-quality-v1.json');

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
