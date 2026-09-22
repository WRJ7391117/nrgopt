const failure = (code, responseCode) => Object.assign(new Error(code), { code, responseCode });
const text = (value, limit = 700) => String(value || '').replaceAll('@', '＠').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);

function buildCard({ notification, source, candidate, baseUrl }) {
  const payload = notification.payload || {};
  const evidenceNames = { unverified: '单一来源，未交叉验证', sourced: '引文已绑定', checked: '部分事实已交叉核对', conflict: '来源冲突', corrected: '已更正' };
  let title;
  let content;
  let detailUrl = `${baseUrl}/intelligence/overview`;
  if (notification.notification_type === 'flash') {
    const extraction = source?.extraction_zh || {};
    const facts = (extraction.known_facts || []).slice(0, 3).map(item => `- ${text(item.claim_zh, 240)}`).join('\n') || '- 详情页查看已绑定事实。';
    const unknowns = (extraction.unknowns_zh || []).slice(0, 3).map(item => `- ${text(item, 200)}`).join('\n') || '- 尚无额外未知项记录。';
    const signals = (extraction.next_signals_zh || []).slice(0, 3).map(item => `- ${text(item, 200)}`).join('\n') || '- 继续观察后续官方披露。';
    title = `重大变化｜${text(payload.title_zh || candidate?.title_zh || '情报候选', 60)}`;
    content = `**国家/区域**\n${text((payload.countries || candidate?.occurrence_countries || []).join('、') || '待确认', 120)}\n\n` +
      `**变化摘要**\n${text(payload.summary_zh || candidate?.summary_zh, 700)}\n\n` +
      `**证据状态**\n${evidenceNames[payload.evidence_status || candidate?.evidence_status] || '待核对'}\n\n` +
      `**已知事实**\n${facts}\n\n**NRGOPT 判断**\n${text(extraction.why_it_matters_zh || '等待进一步分析。', 700)}\n\n` +
      `**尚未知**\n${unknowns}\n\n**下一观察点**\n${signals}`;
    if (payload.source_id) detailUrl = `${baseUrl}/intelligence/sources/${encodeURIComponent(payload.source_id)}`;
  } else if (notification.notification_type === 'system') {
    title = '系统运行告警';
    content = `**检查日期**\n${text(payload.schedule_key, 30) || '未知'}\n\n` +
      `**运行状态**\n${text(payload.run_status || payload.health || '未知', 80)}\n\n` +
      `**问题**\n${text(payload.issue_zh || '自动检查发现异常，请打开站内任务状态查看。', 700)}\n\n` +
      `**说明**\n这是一条系统告警，不代表市场发生变化。`;
  } else {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const completed = items.filter(item => item.status === 'succeeded').length;
    const paused = items.filter(item => item.status === 'budget_paused').length;
    const failed = items.filter(item => ['failed', 'retry'].includes(item.status)).length;
    const leads = items.reduce((sum, item) => sum + (Number(item.result_count) || 0), 0);
    title = `每日情报扫描｜${text(payload.schedule_key, 30)}`;
    content = `**覆盖状态**\n六国任务：成功 ${completed}，预算暂停 ${paused}，失败或待重试 ${failed}。\n\n` +
      `**本轮发现**\n取得 ${leads} 条官方来源线索；线索需保存原文并完成证据提取后才进入三雷达。\n\n` +
      `**说明**\n${failed || paused ? '本期覆盖不完整，不能据此判断市场没有新变化。' : '本轮扫描已完成；请在站内查看已保存证据和候选。'}`;
  }
  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true },
    header: { template: notification.notification_type === 'flash' ? 'red' : 'blue', title: { tag: 'plain_text', content: title } },
    elements: [{ tag: 'markdown', content }, { tag: 'action', actions: [{ tag: 'button', type: 'primary',
      text: { tag: 'plain_text', content: '查看站内详情' }, url: detailUrl }] }] } };
}

function createFeishuSender({ webhookUrl, fetchImpl = global.fetch }) {
  let endpoint;
  try { endpoint = new URL(webhookUrl); } catch { throw failure('feishu_not_configured'); }
  const allowedHost = ['open.feishu.cn', 'open.larksuite.com'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' || !allowedHost || endpoint.username || endpoint.password ||
      !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,200}$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) throw failure('feishu_not_configured');
  return async input => {
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildCard(input)) });
    } catch { throw failure('delivery_unknown'); }
    if (!response.ok) throw failure('delivery_failed', response.status);
    let payload;
    try { payload = await response.json(); } catch { throw failure('delivery_unknown', response.status); }
    if (payload?.code !== 0 && payload?.StatusCode !== 0) throw failure('delivery_failed', response.status);
    return { responseCode: response.status };
  };
}

module.exports = { buildCard, createFeishuSender };
