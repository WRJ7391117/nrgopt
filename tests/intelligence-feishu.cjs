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

test('Feishu app bot resolves its only chat and user, then sends both cards', async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { has_more: false,
      items: [{ chat_id: 'oc_authorized_test_chat', owner_id: 'ou_authorized_test_user' }] } }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { message_id: 'om_chat_message' } }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { message_id: 'om_user_message' } }), { status: 200 })
  ];
  const sender = createFeishuSender({ appId: 'cli_test_app', appSecret: 'private-test-secret',
    fetchImpl: async (url, init = {}) => { requests.push({ url: String(url), init }); return responses.shift(); } });
  const accepted = [];
  const result = await sender({ notification: { notification_type: 'system', payload: { schedule_key: '2026-09-25', health: 'ok' } },
    baseUrl: 'https://nrgopt.example', onTargetAccepted: item => accepted.push(item.target) });
  assert.deepEqual(result, { responseCode: 200, messageId: 'om_user_message', messageIds: ['om_chat_message', 'om_user_message'],
    chatId: 'oc_authorized_test_chat' });
  assert.deepEqual(accepted, ['chat', 'user']);
  assert.match(requests[0].url, /tenant_access_token\/internal$/);
  assert.match(requests[1].url, /\/im\/v1\/chats\?page_size=100$/);
  assert.equal(requests[1].init.headers.Authorization, 'Bearer tenant-token');
  const chat = JSON.parse(requests[2].init.body);
  const direct = JSON.parse(requests[3].init.body);
  assert.equal(chat.receive_id, 'oc_authorized_test_chat');
  assert.equal(direct.receive_id, 'ou_authorized_test_user');
  assert.equal(chat.msg_type, 'interactive');
  assert.match(chat.content, /系统运行告警/);
  assert.equal(JSON.parse(requests[0].init.body).app_secret, 'private-test-secret');
  assert.ok(!requests[2].init.body.includes('private-test-secret'));
});

test('Feishu app bot requires an explicit chat when it belongs to more than one', async () => {
  const sender = createFeishuSender({ appId: 'cli_test_app', appSecret: 'private-test-secret', fetchImpl: async url =>
    String(url).includes('tenant_access_token')
      ? new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), { status: 200 })
      : new Response(JSON.stringify({ code: 0, data: { has_more: false, items: [{ chat_id: 'oc_first_chat' }, { chat_id: 'oc_second_chat' }] } }), { status: 200 }) });
  await assert.rejects(sender({ notification: { notification_type: 'daily', payload: {} }, baseUrl: 'https://nrgopt.example' }),
    { code: 'feishu_chat_target_required' });
});

test('Feishu app bot resolves the owner of an explicit chat without listing members', async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { owner_id: 'ou_authorized_test_user' } }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { message_id: 'om_chat' } }), { status: 200 }),
    new Response(JSON.stringify({ code: 0, data: { message_id: 'om_user' } }), { status: 200 })
  ];
  const sender = createFeishuSender({ appId: 'cli_test_app', appSecret: 'private-test-secret', chatId: 'oc_authorized_test_chat',
    fetchImpl: async (url, init = {}) => { requests.push({ url: String(url), init }); return responses.shift(); } });
  const result = await sender({ notification: { notification_type: 'system', payload: {} }, baseUrl: 'https://nrgopt.example' });
  assert.match(requests[1].url, /\/chats\/oc_authorized_test_chat\?user_id_type=open_id$/);
  assert.ok(!requests.some(request => request.url.includes('/members?')));
  assert.equal(JSON.parse(requests[3].init.body).receive_id, 'ou_authorized_test_user');
  assert.deepEqual(result.messageIds, ['om_chat', 'om_user']);
});

test('Feishu app bot retries only the rejected target after recording a partial success', async () => {
  const input = { notification: { notification_type: 'daily', payload: {} }, baseUrl: 'https://nrgopt.example' };
  const accepted = [];
  const first = createFeishuSender({ appId: 'cli_test_app', appSecret: 'private-test-secret',
    chatId: 'oc_authorized_test_chat', userOpenId: 'ou_authorized_test_user', fetchImpl: async url => {
      if (String(url).includes('tenant_access_token')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), { status: 200 });
      if (String(url).includes('receive_id_type=chat_id')) return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_chat' } }), { status: 200 });
      return new Response(JSON.stringify({ code: 230001, msg: 'rejected' }), { status: 200 });
    } });
  await assert.rejects(first({ ...input, onTargetAccepted: item => accepted.push(item.target) }), error => {
    assert.equal(error.code, 'feishu_send_rejected');
    assert.deepEqual(error.deliveries.map(item => item.target), ['chat']);
    return true;
  });
  assert.deepEqual(accepted, ['chat']);

  const sent = [];
  const retry = createFeishuSender({ appId: 'cli_test_app', appSecret: 'private-test-secret',
    chatId: 'oc_authorized_test_chat', userOpenId: 'ou_authorized_test_user', fetchImpl: async url => {
      sent.push(String(url));
      return String(url).includes('tenant_access_token')
        ? new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), { status: 200 })
        : new Response(JSON.stringify({ code: 0, data: { message_id: 'om_user' } }), { status: 200 });
    } });
  const result = await retry({ ...input, notification: { ...input.notification,
    payload: { _delivery_targets: { chat: { status: 'accepted', response_code: 200 } } } } });
  assert.deepEqual(sent.filter(url => url.includes('/messages?')), ['https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id']);
  assert.deepEqual(result.messageIds, ['om_user']);
});

test('daily digest contains evidence and judgment, abbreviates accepted FLASH and discloses incomplete coverage', () => {
  const card = buildCard({ baseUrl: 'https://nrgopt.example', notification: { notification_type: 'daily', payload: {
    schedule_key: '2026-09-24', status: 'partial', coverage: { succeeded: 20, failed: 1, paused: 2 }, remaining_changes: 3,
    changes: [{ source_id: 'source-a', title_zh: '施工合同授标', summary_zh: '业主公告授标', countries: ['QA'], evidence_status: 'sourced',
      facts: ['金额已披露'], judgment_zh: '设备范围仍需观察', unknown_zh: '设备采购未知', next_signal_zh: '观察设备公告' },
      { source_id: 'source-b', title_zh: '已发送事项', flash_accepted: true, grouped_source_count: 5, summary_zh: '不应再次详述' }]
  } } });
  const output = JSON.stringify(card);
  for (const phrase of ['每日情报摘要','金额已披露','NRGOPT 判断','设备采购未知','卡塔尔','本期覆盖不完整','已发重大提醒','同一事件共 5 个来源','另有 3 条','sources/source-a']) assert.ok(output.includes(phrase));
  assert.ok(!output.includes('不应再次详述'));
  assert.ok(!output.includes('六国任务：成功 20'));
});

test('new FLASH renders its queued snapshot instead of a later model rewrite', () => {
  const card = buildCard({ baseUrl: 'https://nrgopt.example', source: { extraction_zh: { known_facts: [{ claim_zh: '后续改写' }] } },
    notification: { notification_type: 'flash', payload: { evidence_change_id: 1, facts: ['入队时的事实'], judgment_zh: '当时判断' } } });
  assert.ok(JSON.stringify(card).includes('入队时的事实'));
  assert.ok(!JSON.stringify(card).includes('后续改写'));
});
