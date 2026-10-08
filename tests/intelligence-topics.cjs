const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, catalog, validateTopic, activeTopics, topicNames } = require('../lib/intelligence/topics.cjs');

test('default topics remain visible while owner overrides and custom topics control future labels', () => {
  const custom = { code: 'custom-11111111-1111-4111-8111-111111111111', name: '跨境电网', description: '跨境输电线路', active: true, revision: 1 };
  const topics = catalog([{ code: 'suez', name: '苏伊士航运', description: '苏伊士航运及能源运输', active: false, revision: 1 }, custom]);
  assert.equal(topics.length, defaults.length + 1);
  assert.equal(topics.find(item => item.code === 'suez').active, false);
  assert.equal(topicNames(topics).suez, '苏伊士航运');
  assert.ok(activeTopics(topics).some(item => item.code === custom.code));
  assert.ok(!activeTopics(topics).some(item => item.code === 'suez'));
});

test('topic edits require bounded definitions and revisions; new topics get stable codes', () => {
  const created = validateTopic({ code: null, revision: 0, name: ' 跨境电网 ', description: ' 跨国电力互联 ', active: true });
  assert.match(created.code, /^custom-[0-9a-f-]{36}$/);
  assert.equal(created.name, '跨境电网');
  assert.equal(created.description, '跨国电力互联');
  for (const patch of [{ revision: -1 }, { active: 'true' }, { name: '' }, { description: '' },
    { name: 'x'.repeat(61) }, { code: 'EG' }, { active: false }]) {
    assert.throws(() => validateTopic({ code: null, revision: 0, name: '专题', description: '跨境范围', active: true, ...patch }), { code: 'invalid_request' });
  }
});

test('active topic snapshots preserve definition revisions and exclude stopped topics', () => {
  const custom = { code: 'custom-11111111-1111-4111-8111-111111111111', name: '跨境电网', description: '跨国输电线路', active: true, revision: 4 };
  const items = catalog([
    { code: 'suez', name: '苏伊士', description: '已停用的航运范围', active: false, revision: 2 },
    custom
  ]);
  const snapshot = activeTopics(items);
  assert.deepEqual(snapshot.find(topic => topic.code === custom.code), { code: custom.code, name: custom.name, description: custom.description, revision: 4 });
  assert.equal(snapshot.find(topic => topic.code === 'red-sea').revision, 0, 'built-in definitions have an explicit initial revision');
  assert.ok(!snapshot.some(topic => topic.code === 'suez'));
  custom.name = '下次生效的名称'; custom.description = '下次分析的新范围'; custom.revision = 5; custom.active = false;
  assert.equal(snapshot.find(topic => topic.code === custom.code).name, '跨境电网');
  assert.equal(snapshot.find(topic => topic.code === custom.code).revision, 4);
  assert.ok(!activeTopics(catalog([custom])).some(topic => topic.code === custom.code));
});
