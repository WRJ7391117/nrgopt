const test = require('node:test');
const assert = require('node:assert/strict');
const regions = require('../lib/intelligence/regions.json');
const { defaults: directions, validateDirection } = require('../lib/intelligence/directions.cjs');
const { defaults: libraryDefaults, validateEntry, selectChannel } = require('../lib/intelligence/source-library.cjs');
const { primaryHosts, discoveryQuery } = require('../lib/intelligence/discovery.cjs');
const { dailySearchCountries } = require('../lib/intelligence/jobs.cjs');
const { watchSearchPlan } = require('../lib/intelligence/watch-search.cjs');

const centralAsia = ['KZ', 'UZ', 'KG', 'TJ', 'TM'];
const core = ['SA', 'AE', 'QA', 'KW', 'OM', 'BH'];
const originalCountries = [...core, 'YE', 'IQ', 'IR', 'JO', 'LB', 'SY', 'IL', 'PS', 'TR', 'CY', 'EG', 'DZ', 'LY', 'MA', 'TN', 'SD', 'EH', 'MR'];
// Persist the pre-expansion search order so a catalog release cannot reorder existing directions.
const originalExtraOrder = ['TR', 'MA', 'DZ', 'LY', 'EG', 'JO', 'PS', 'YE', 'SD', 'MR', 'TN', 'IR', 'CY', 'LB', 'EH', 'IQ', 'IL', 'SY'];
const dayAt = offset => new Date(Date.UTC(2026, 9, 11) + offset * 86400000).toISOString().slice(0, 10);
const direction = countries => ({ id: '11111111-1111-4111-8111-111111111111', revision: 1,
  config: { ...structuredClone(directions[0].config), countries } });
function oldSearchPlan(day, countries) {
  const extra = originalExtraOrder.filter(code => countries.includes(code));
  const offset = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000) % Math.max(1, extra.length);
  return [...core.filter(code => countries.includes(code)),
    ...Array.from({ length: Math.min(2, extra.length) }, (_, i) => extra[(offset + i) % extra.length])];
}

test('Central Asia adds five named countries in a fourth group without altering the original catalog', () => {
  assert.equal(regions.countries.length, 29);
  assert.equal(new Set(regions.countries.map(country => country.code)).size, 29);
  assert.deepEqual(regions.countries.slice(0, 24).map(country => country.code), originalCountries);
  assert.deepEqual(regions.countries.filter(country => country.group === 'central-asia').map(country => [country.code, country.name, country.english]), [
    ['KZ', '哈萨克斯坦', 'Kazakhstan'], ['UZ', '乌兹别克斯坦', 'Uzbekistan'],
    ['KG', '吉尔吉斯斯坦', 'Kyrgyzstan'], ['TJ', '塔吉克斯坦', 'Tajikistan'], ['TM', '土库曼斯坦', 'Turkmenistan']
  ]);
  assert.equal(Object.keys(regions.groups).length, 4);
  assert.equal(regions.groups['central-asia'], '中亚');
});

test('directions and custom channels accept all five Central Asian countries and the full 29-country scope', () => {
  const all = regions.countries.map(country => country.code);
  for (const countries of [centralAsia, all, ...centralAsia.map(code => [code])]) {
    const savedDirection = validateDirection(direction(countries));
    assert.deepEqual(savedDirection.config.countries, countries);
    const channel = validateEntry({ id: null, revision: 0, status: 'candidate', config: {
      name: '公开能源渠道', url: 'https://publisher.example/', scope: 'site', type: 'media',
      countries, languages: ['en'], direction_ids: [], notes: '', priority: 'normal'
    } });
    assert.deepEqual(channel.config.countries, countries);
    assert.equal(channel.status, 'candidate');
    assert.equal(channel.config.mode, 'search');
  }
  assert.throws(() => validateDirection(direction(['XX'])), { code: 'invalid_request' });
});

test('new country options neither select themselves in the five defaults nor invent verified channels', () => {
  assert.equal(directions.length, 5);
  for (const saved of directions) assert.deepEqual(saved.config.countries, originalCountries);
  const entries = libraryDefaults();
  assert.equal(entries.length, 43);
  assert.equal(entries.filter(entry => entry.config.mode === 'fixed').length, 15);
  assert.equal(entries.filter(entry => entry.id.startsWith('reference:')).length, 28);
  assert.equal(entries.some(entry => entry.config.countries.some(code => centralAsia.includes(code))), false);
  assert.equal(centralAsia.some(code => Object.hasOwn(primaryHosts, code)), false);
  for (const code of centralAsia) assert.match(discoveryQuery(code), new RegExp(regions.countries.find(country => country.code === code).english));
});

test('existing country selections keep their original daily search rotation after the catalog expands', () => {
  for (const scope of [originalCountries, ['SA', 'TR', 'EG'], ['JO', 'PS', 'YE', 'SD', 'TN', 'IR'], core]) {
    for (let offset = 0; offset < 60; offset++) {
      assert.deepEqual(dailySearchCountries(dayAt(offset), [direction(scope)]), oldSearchPlan(dayAt(offset), scope));
    }
  }
  for (let offset = 0; offset < 60; offset++) {
    assert.deepEqual(dailySearchCountries(dayAt(offset), null), oldSearchPlan(dayAt(offset), originalCountries));
  }
});

test('legacy and original direction scopes preserve channel choices for GCC and extra countries', () => {
  const entries = ['high', 'normal', 'low'].map((priority, index) => ({
    id: 'channel-' + index, revision: 1, status: 'active', access: { status: 'readable' },
    config: { mode: 'search', countries: ['SA', 'JO'], direction_ids: [], priority,
      name: 'Channel ' + index, url: 'https://publisher' + index + '.example/', scope: 'site' }
  }));
  const weighted = [entries[0], entries[0], entries[0], entries[1], entries[1], entries[2]];
  for (let offset = 0; offset < 60; offset++) {
    const day = dayAt(offset), n = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
    for (const country of ['SA', 'JO']) {
      const turn = country === 'SA' ? Math.floor(n / 2) : Math.floor(n / originalExtraOrder.length);
      const expected = n % 2 === 0 ? null : weighted[turn % weighted.length].id;
      for (const scope of [null, direction(originalCountries), direction(['SA', 'JO'])]) {
        assert.equal(selectChannel(entries, country, scope, day)?.id || null, expected);
      }
    }
  }
});

test('selected Central Asian countries share at most two extra daily slots while GCC and paused scopes retain their limits', () => {
  const selected = [direction([...core, ...centralAsia])];
  const seen = new Set();
  for (let offset = 0; offset < 30; offset++) {
    const countries = dailySearchCountries(dayAt(offset), selected);
    assert.deepEqual(countries.slice(0, 6), core);
    assert.equal(countries.length, 8);
    assert.equal(new Set(countries).size, countries.length);
    for (const code of countries.slice(6)) {
      assert.ok(centralAsia.includes(code));
      seen.add(code);
    }
  }
  assert.deepEqual([...seen].sort(), [...centralAsia].sort());
  const paused = direction(['TM']); paused.config.enabled = false;
  const narrow = [direction(['SA', 'UZ', 'KG']), paused];
  for (let offset = 0; offset < 30; offset++) {
    assert.deepEqual(dailySearchCountries(dayAt(offset), narrow).sort(), ['KG', 'SA', 'UZ']);
  }
  assert.deepEqual(dailySearchCountries(dayAt(0), [paused]), []);
});

test('Uzbekistan followups get paired support and counterevidence searches within the existing five-group ceiling', () => {
  const targets = Array.from({ length: 9 }, (_, i) => ({ id: 'hypothesis-' + i,
    status: 'open', created_at: '2026-10-10T00:00:00Z', source_url: 'https://publisher.example/article/' + i,
    source_title: 'Solar project notice ' + i,
    candidate: { source_id: 'source-' + i, title_zh: '能源项目', occurrence_countries: ['UZ'] }
  }));
  assert.equal(watchSearchPlan([targets[0]], dayAt(0)).length, 2);
  const plan = watchSearchPlan(targets, dayAt(0));
  assert.equal(plan.length, 10);
  for (let i = 0; i < plan.length; i += 2) {
    assert.equal(plan[i].checkpoint.country, 'UZ');
    assert.equal(plan[i + 1].checkpoint.country, 'UZ');
    assert.equal(plan[i].checkpoint.intent, 'support');
    assert.equal(plan[i + 1].checkpoint.intent, 'counter');
    assert.deepEqual(plan[i].checkpoint.hypothesis_ids, plan[i + 1].checkpoint.hypothesis_ids);
    assert.match(plan[i].checkpoint.query, /Uzbekistan/);
    assert.match(plan[i + 1].checkpoint.query, /cancelled/);
  }
});
