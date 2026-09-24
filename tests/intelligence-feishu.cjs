const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCard, createFeishuSender } = require('../lib/intelligence/feishu.cjs');

test('FLASH card separates facts, NRGOPT judgment, unknowns and next signals with a stable detail link', () => {
  const card = buildCard({ baseUrl: 'https://nrgopt.example',
    notification: { notification_type: 'flash', payload: { source_id: '11111111-1111-4111-8111-111111111111', title_zh: '沙特储能进展',
      summary_zh: '官方来源披露项目进展。', countries: ['SA'], evidence_status: 'unverified' } },
    source: { extraction_zh: { known_facts: [{ claim_zh: '项目已签署协议。' }], why_it_matters_zh: '需要继续核对设备范围。',
      unknowns_zh: ['设备供应商未知。'], next_signals_zh: ['观察采购公告。'] } } });
  const serialized = JSON.stringify(card);
  for (const phrase of ['已知事实', 'NRGOPT 判断', '尚未知', '下一观察点', '/intelligence/sources/11111111-1111-4111-8111-111111111111']) assert.match(serialized, new RegExp(phrase));
  assert.equal(card.msg_type, 'interactive');
});

test('system card identifies an operational issue without presenting it as market news', () => {
  const card = buildCard({ notification: { notification_type: 'system', payload: { schedule_key: '2026-09-22',
    health: 'missing', run_status: null, issue_zh: '今日扫描任务缺失。' } }, baseUrl: 'https://nrgopt.example' });
  const serialized = JSON.stringify(card);
  assert.match(serialized, /系统运行告警/);
  assert.match(serialized, /今日扫描任务缺失/);
  assert.match(serialized, /不代表市场发生变化/);
});

test('Feishu sender accepts only official webhook hosts and classifies lost responses as unknown', async () => {
  assert.throws(() => createFeishuSender({ webhookUrl: 'https://attacker.example/open-apis/bot/v2/hook/value123' }), { code: 'feishu_not_configured' });
  const input = { notification: { notification_type: 'daily', payload: { schedule_key: '2026-09-22', items: [] } }, baseUrl: 'https://nrgopt.example' };
  const accepted = createFeishuSender({ webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/value123',
    fetchImpl: async () => new Response(JSON.stringify({ code: 0 }), { status: 200 }) });
  assert.deepEqual(await accepted(input), { responseCode: 200 });
  const unknown = createFeishuSender({ webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/value123',
    fetchImpl: async () => { throw new Error('timeout'); } });
  await assert.rejects(unknown(input), { code: 'delivery_unknown' });
});

test('daily digest contains evidence and judgment, abbreviates accepted FLASH and discloses incomplete coverage', () => {
  const card = buildCard({ baseUrl: 'https://nrgopt.example', notification: { notification_type: 'daily', payload: {
    schedule_key: '2026-09-24', status: 'partial', coverage: { succeeded: 20, failed: 1, paused: 2 }, remaining_changes: 3,
    changes: [{ source_id: 'source-a', title_zh: '施工合同授标', summary_zh: '业主公告授标', countries: ['QA'], evidence_status: 'sourced',
      facts: ['金额已披露'], judgment_zh: '设备范围仍需观察', unknown_zh: '设备采购未知', next_signal_zh: '观察设备公告' },
      { source_id: 'source-b', title_zh: '已发送事项', flash_accepted: true, summary_zh: '不应再次详述' }]
  } } });
  const output = JSON.stringify(card);
  for (const phrase of ['每日情报摘要','金额已披露','NRGOPT 判断','设备采购未知','卡塔尔','本期覆盖不完整','已发重大提醒','另有 3 条','sources/source-a']) assert.ok(output.includes(phrase));
  assert.ok(!output.includes('不应再次详述'));
  assert.ok(!output.includes('六国任务：成功 20'));
});

test('new FLASH renders its queued snapshot instead of a later model rewrite', () => {
  const card = buildCard({ baseUrl: 'https://nrgopt.example', source: { extraction_zh: { known_facts: [{ claim_zh: '后续改写' }] } },
    notification: { notification_type: 'flash', payload: { evidence_change_id: 1, facts: ['入队时的事实'], judgment_zh: '当时判断' } } });
  assert.ok(JSON.stringify(card).includes('入队时的事实'));
  assert.ok(!JSON.stringify(card).includes('后续改写'));
});
