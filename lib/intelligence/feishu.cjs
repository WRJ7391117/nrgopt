const failure = (code, responseCode) => Object.assign(new Error(code), { code, responseCode });
const text = (value, limit = 700) => String(value || '').replaceAll('@', '＠').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);

function buildCard({ notification, source, candidate, baseUrl }) {
  const payload = notification.payload || {};
  const evidenceNames = { unverified: '单一来源，未交叉验证', sourced: '引文已绑定', checked: '跨来源内容已比对', conflict: '来源冲突', corrected: '已更正' };
  let title;
  let content;
  let detailUrl = `${baseUrl}/intelligence/overview`;
  if (notification.notification_type === 'flash') {
    const extraction = payload.evidence_change_id ? { known_facts: (payload.facts || []).map(claim_zh => ({ claim_zh })),
      why_it_matters_zh: payload.judgment_zh, unknowns_zh: [payload.unknown_zh].filter(Boolean), next_signals_zh: [payload.next_signal_zh].filter(Boolean) } : source?.extraction_zh || {};
    const facts = (extraction.known_facts || []).slice(0, 3).map(item => `- ${text(item.claim_zh, 240)}`).join('\n') || '- 详情页查看已绑定事实。';
    const unknowns = (extraction.unknowns_zh || []).slice(0, 3).map(item => `- ${text(item, 200)}`).join('\n') || '- 尚无额外未知项记录。';
    const signals = (extraction.next_signals_zh || []).slice(0, 3).map(item => `- ${text(item, 200)}`).join('\n') || '- 继续观察后续官方披露。';
    title = `重大变化｜${text(payload.title_zh || candidate?.title_zh || '情报候选', 60)}`;
    content = `**国家/区域**\n${text((payload.countries || candidate?.occurrence_countries || []).join('、') || '待确认', 120)}\n\n` +
      `**来源发布日期**\n${text(payload.publication_date || source?.publication_date || '未披露', 30)}\n\n` +
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
    const coverage = payload.coverage || {
      succeeded: items.filter(item => item.status === 'succeeded').length,
      paused: items.filter(item => ['budget_paused', 'manual_paused'].includes(item.status)).length,
      failed: items.filter(item => ['failed', 'retry'].includes(item.status)).length
    };
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const incomplete = payload.status !== 'succeeded' || coverage.failed || coverage.paused || coverage.unfinished;
    const countries = { SA: '沙特', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', OM: '阿曼', BH: '巴林' };
    title = `每日情报摘要｜${text(payload.schedule_key, 30)}`;
    content = `**覆盖状态**\n采集与分析任务：成功 ${coverage.succeeded || 0}，暂停 ${coverage.paused || 0}，失败或待重试 ${coverage.failed || 0}。\n` +
      `${incomplete ? '本期覆盖不完整，不能据此判断市场没有新变化。' : '本轮计划已完成；固定来源覆盖范围仍以站内登记为准。'}\n\n`;
    if (!changes.length) content += incomplete ? '本期没有可列出的新增证据，采集覆盖仍不完整。' : '本轮已完成，未发现新的来源证据变化。';
    changes.forEach((change, index) => {
      const link = `${baseUrl}/intelligence/sources/${encodeURIComponent(change.source_id)}`;
      content += `**${index + 1}. ${text(change.title_zh, 80)}**\n`;
      if (change.flash_accepted) { content += `已发重大提醒 · [查看详情](${link})\n\n`; return; }
      content += `国家/区域：${text((change.countries || []).map(c => countries[c] || c).join('、') || '待确认', 80)}\n` +
        `来源发布日期：${text(change.publication_date || '未披露', 30)}\n` +
        `变化摘要：${text(change.summary_zh, 120)}\n证据状态：${evidenceNames[change.evidence_status] || '待核对'}\n` +
        `已知事实：${text((change.facts || []).join('；'), 160)}\n` +
        `NRGOPT 判断：${text(change.judgment_zh || '待进一步分析', 80)}\n` +
        `尚未知：${text(change.unknown_zh || '未列出额外未知项，不代表全部已知', 80)}\n` +
        `下一观察点：${text(change.next_signal_zh || '继续跟踪原始发布', 80)}\n[查看详情](${link})\n\n`;
    });
    if (payload.remaining_changes) content += `另有 ${Number(payload.remaining_changes)} 条待后续摘要，游标已保留；站内可查看完整来源。`;
  }

  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true },
    header: { template: notification.notification_type === 'flash' ? 'red' : 'blue', title: { tag: 'plain_text', content: title } },
    elements: [{ tag: 'markdown', content }, { tag: 'action', actions: [{ tag: 'button', type: 'primary',
      text: { tag: 'plain_text', content: '查看站内详情' }, url: detailUrl }] }] } };
}

function createFeishuSender({ webhookUrl, appId, appSecret, chatId, userOpenId, fetchImpl = global.fetch }) {
  let endpoint = null;
  if (webhookUrl) {
    try { endpoint = new URL(webhookUrl); } catch { throw failure('feishu_not_configured'); }
    const allowedHost = ['open.feishu.cn', 'open.larksuite.com'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' || !allowedHost || endpoint.username || endpoint.password ||
        !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,200}$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) throw failure('feishu_not_configured');
  }
  if (endpoint) return async input => {
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

  if (!/^[A-Za-z0-9_-]{6,200}$/.test(appId || '') || typeof appSecret !== 'string' || appSecret.length < 8 || appSecret.length > 500 ||
      (chatId && !/^oc_[A-Za-z0-9_-]{8,200}$/.test(chatId)) || (userOpenId && !/^ou_[A-Za-z0-9_-]{8,200}$/.test(userOpenId))) {
    throw failure('feishu_not_configured');
  }
  return async input => {
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
    } catch { throw failure('feishu_auth_failed'); }
    if (!tokenResponse.ok) throw failure('feishu_auth_failed', tokenResponse.status);
    let tokenPayload;
    try { tokenPayload = await tokenResponse.json(); } catch { throw failure('feishu_auth_failed', tokenResponse.status); }
    if (tokenPayload?.code !== 0 || typeof tokenPayload.tenant_access_token !== 'string') throw failure('feishu_auth_failed', tokenResponse.status);
    const authorization = `Bearer ${tokenPayload.tenant_access_token}`;
    let target = chatId || null;
    if (!target) {
      let chatsResponse;
      try {
        chatsResponse = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/chats?page_size=100', {
          redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: authorization }
        });
      } catch { throw failure('feishu_chat_access_required'); }
      if (!chatsResponse.ok) throw failure('feishu_chat_access_required', chatsResponse.status);
      let chatsPayload;
      try { chatsPayload = await chatsResponse.json(); } catch { throw failure('feishu_chat_access_required', chatsResponse.status); }
      const chats = chatsPayload?.code === 0 && Array.isArray(chatsPayload?.data?.items) ? chatsPayload.data.items : [];
      if (chatsPayload?.code !== 0) throw failure('feishu_chat_access_required', chatsResponse.status);
      if (!chats.length) throw failure('feishu_chat_membership_required');
      if (chatsPayload?.data?.has_more || chats.length !== 1) throw failure('feishu_chat_target_required');
      if (!/^oc_[A-Za-z0-9_-]{8,200}$/.test(chats[0]?.chat_id || '')) throw failure('feishu_chat_target_required');
      target = chats[0].chat_id;
    }
    let directTarget = userOpenId || null;
    if (!directTarget) {
      let membersResponse;
      try {
        membersResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(target)}/members?member_id_type=open_id&page_size=100`, {
          redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: authorization }
        });
      } catch { throw failure('feishu_user_access_required'); }
      if (!membersResponse.ok) throw failure('feishu_user_access_required', membersResponse.status);
      let membersPayload;
      try { membersPayload = await membersResponse.json(); } catch { throw failure('feishu_user_access_required', membersResponse.status); }
      if (membersPayload?.code !== 0) throw failure('feishu_user_access_required', membersResponse.status);
      const members = (Array.isArray(membersPayload?.data?.items) ? membersPayload.data.items : [])
        .map(item => item?.member_id).filter(id => /^ou_[A-Za-z0-9_-]{8,200}$/.test(id || ''));
      const uniqueMembers = [...new Set(members)];
      if (membersPayload?.data?.has_more || uniqueMembers.length !== 1) throw failure('feishu_user_target_required');
      directTarget = uniqueMembers[0];
    }
    const card = JSON.stringify(buildCard(input).card);
    const previous = input.notification?.payload?._delivery_targets || {};
    const deliveries = [];
    const failures = [];
    for (const item of [{ key: 'chat', id: target, type: 'chat_id' }, { key: 'user', id: directTarget, type: 'open_id' }]) {
      if (previous[item.key]?.status === 'accepted') continue;
      let response;
      try {
        response = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${item.type}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ receive_id: item.id, msg_type: 'interactive', content: card })
        });
      } catch {
        failures.push({ code: 'delivery_unknown', target: item.key });
        continue;
      }
      let payload;
      try { payload = await response.json(); } catch {
        failures.push({ code: 'delivery_unknown', responseCode: response.status, target: item.key });
        continue;
      }
      if (!response.ok || payload?.code !== 0) {
        failures.push({ code: 'feishu_send_rejected', responseCode: response.status, target: item.key });
        continue;
      }
      const delivered = { target: item.key, responseCode: response.status, messageId: payload?.data?.message_id || null };
      deliveries.push(delivered);
      try { await input.onTargetAccepted?.(delivered); } catch {
        const error = failure('delivery_unknown', response.status);
        error.deliveries = deliveries;
        throw error;
      }
    }
    if (failures.length) {
      const selected = failures.find(item => item.code === 'delivery_unknown') || failures[0];
      const error = failure(selected.code, selected.responseCode);
      error.target = selected.target;
      error.deliveries = deliveries;
      throw error;
    }
    return { responseCode: deliveries.at(-1)?.responseCode || 200, messageId: deliveries.at(-1)?.messageId || null,
      messageIds: deliveries.map(item => item.messageId).filter(Boolean), chatId: target };
  };
}

module.exports = { buildCard, createFeishuSender };
