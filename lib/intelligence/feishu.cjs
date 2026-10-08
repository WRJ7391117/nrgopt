const regions = require('./regions.json');
const countryNames = Object.fromEntries(regions.countries.map(item => [item.code, item.name]));
const failure = (code, responseCode) => Object.assign(new Error(code), { code, responseCode });
const text = (value, limit = 700) => String(value || '').replaceAll('@', '＠').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
const runNames = { partial: '扫描已结束，部分任务失败', succeeded: '扫描已完成', failed: '扫描未能完成',
  budget_paused: '扫描因预算限制暂停', manual_paused: '扫描已暂停', running: '扫描正在进行', queued: '扫描等待执行',
  missing: '未发现当天扫描任务', ok: '运行正常', degraded: '部分任务需要关注' };
const runIssues = { partial: '成功任务的结果仍可使用；失败部分可能造成信息遗漏，不能据此判断相关地区没有新动态。',
  failed: '本轮任务执行失败，信息覆盖不足；请查看下方原因。', budget_paused: '部分任务因预算限制未执行，已有结果保留。',
  manual_paused: '部分任务已暂停，已有结果保留。', missing: '今日扫描任务缺失。' };

function summarizeRun(run, items) {
  const task_counts = { total: items.length, succeeded: 0, failed: 0, budget_paused: 0, manual_paused: 0, unfinished: 0 };
  const groups = new Map();
  const stages = { discover: '区域搜索', registry: '公告入口', source: '原文抓取', watchsource: '关注来源抓取',
    extract: '情报分析', cross: '跨来源核对', hypothesis: '假设判断', watchsearch: '证据搜索' };
  const reasons = { source_empty_document: '没有可读取的正文', source_access_denied: '来源拒绝自动访问',
    source_listing_page: '页面是目录或列表，未作为正文分析', source_fetch_failed: '原文获取失败', source_http_error: '来源网站返回访问错误',
    source_tls_error: '来源证书校验失败', source_timeout: '原文获取超时', source_not_found: '原文已下线或网址失效',
    source_rate_limited: '来源站点限流', source_dns_error: '来源域名无法解析', source_failed: '原文获取失败',
    registry_no_links: '没有读到公告链接', discovery_no_primary_sources: '未找到符合要求的来源',
    extraction_invalid_source_only_consistency: '模型对背景材料与商业分类的判断不一致',
    extraction_invalid_attribution: '模型主张的类型或归属未通过校验',
    extraction_invalid_known_fact_quote: '模型引文未能与原文对应', extraction_invalid_candidate_scope: '模型候选分类未通过范围校验',
    model_timeout: '模型请求超时', model_rate_limited: '模型服务限流', lease_exhausted: '多次执行超时',
    budget_exhausted: '调用预算不足', budget_not_configured: '尚未配置调用预算', billing_sync_pending: '等待账单同步', source_paused: '该来源已暂停' };
  for (const item of items) {
    if (Object.hasOwn(task_counts, item.status) && item.status !== 'total') task_counts[item.status]++;
    else task_counts.unfinished++;
    if (!['failed', 'budget_paused', 'manual_paused'].includes(item.status)) continue;
    const stage = stages[item.item_key?.split(':')[0]] || '任务处理';
    const code = item.error_code || item.status;
    const key = `${stage}:${code}`;
    if (!groups.has(key)) groups.set(key, { stage, code, count: 0, examples: [], reason: reasons[code]
      || (/^extraction_invalid/.test(code) ? '模型结果未通过结构或原文证据校验' : item.status === 'budget_paused' ? '预算限制，暂未执行' : item.status === 'manual_paused' ? '已暂停执行' : item.error_code ? `处理未成功（诊断代码：${text(code, 80)}）` : '处理失败，具体原因尚未记录') });
    const group = groups.get(key); group.count++;
    let label = item.title || item.name;
    if (!label && item.url) { try { label = new URL(item.url).hostname; } catch { /* Keep unknown source unnamed. */ } }
    if (label && group.examples.length < 2 && !group.examples.includes(label)) group.examples.push(text(label, 80));
  }
  return { run_status: run?.status || null, issue_zh: runIssues[run?.status || 'missing'], task_counts,
    problem_groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}

function buildCard({ notification, source, candidate, baseUrl, now = new Date() }) {
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
    content = `**国家/区域**\n${text((payload.countries || candidate?.occurrence_countries || []).map(code => countryNames[code] || code).join('、') || '待确认', 120)}\n\n` +
      `**来源发布日期**\n${text(payload.publication_date || source?.publication_date || '未披露', 30)}\n\n` +
      `**变化摘要**\n${text(payload.summary_zh || candidate?.summary_zh, 700)}\n\n` +
      `**证据状态**\n${evidenceNames[payload.evidence_status || candidate?.evidence_status] || '待核对'}\n\n` +
      `**已知事实**\n${facts}\n\n**NRGOPT 判断**\n${text(extraction.why_it_matters_zh || '等待进一步分析。', 700)}\n\n` +
      `**尚未知**\n${unknowns}\n\n**下一观察点**\n${signals}`;
    if (payload.source_id) detailUrl = `${baseUrl}/intelligence/sources/${encodeURIComponent(payload.source_id)}`;
  } else if (notification.notification_type === 'system') {
    const connected = payload.health === 'connected';
    const status = payload.run_status || payload.health;
    title = connected ? '飞书推送已接通' : '系统运行告警';
    content = `**检查日期**\n${text(payload.schedule_key, 30) || '未知'}\n\n` +
      `**运行状态**\n${connected ? text(status, 80) : runNames[status] || '状态待确认'}\n\n`;
    if (!connected && payload.task_counts) {
      const c = payload.task_counts;
      content += `**任务结果（检查时快照）**\n共 ${c.total} 项：成功 ${c.succeeded}，失败 ${c.failed}，预算暂停 ${c.budget_paused}，人工暂停 ${c.manual_paused}，未结束 ${c.unfinished}。\n统计的是处理任务，不是文章或国家数量。\n\n`;
      const groups = payload.problem_groups || [];
      if (groups.length) content += '**具体原因**\n' + groups.slice(0, 6).map(g =>
        `- ${text(g.stage, 30)} ${g.count} 项：${text(g.reason, 100)}${g.examples?.length ? `（如：${g.examples.map(s => text(s, 80)).join('；')}）` : ''}`).join('\n')
        + (groups.length > 6 ? `\n另有 ${groups.length - 6} 类原因，站内可查看任务明细。` : '') + '\n\n';
    } else if (!connected && ['partial', 'failed', 'budget_paused', 'manual_paused'].includes(status)) {
      content += '**任务结果**\n这条通知未保存任务统计与具体原因，不能据此推算成功或失败数量。\n\n';
    }
    content += `**${connected ? '接通验证' : '对情报的影响'}**\n${text((connected ? payload.issue_zh : runIssues[status] || payload.issue_zh) || '请查看站内任务明细。', 700)}\n\n` +
      `**说明**\n${connected ? '这是一条接通验证消息，不代表市场发生变化或系统故障。' : '这是一条系统告警，不代表市场发生变化。'}`;
    if (!connected) detailUrl = `${baseUrl}/intelligence/workflow`;
  } else {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const coverage = payload.coverage || {
      succeeded: items.filter(item => item.status === 'succeeded').length,
      paused: items.filter(item => ['budget_paused', 'manual_paused'].includes(item.status)).length,
      failed: items.filter(item => ['failed', 'retry'].includes(item.status)).length
    };
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const incomplete = payload.status !== 'succeeded' || coverage.failed || coverage.paused || coverage.unfinished;
    const countries = countryNames;
    const sentDate = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
    title = `每日情报摘要｜${sentDate.year}-${sentDate.month}-${sentDate.day}`;
    content = `**本期完成的搜集计划**\n${text(payload.schedule_key, 30)}\n\n` +
      `**覆盖状态**\n采集与分析任务：成功 ${coverage.succeeded || 0}，暂停 ${coverage.paused || 0}，失败或待重试 ${coverage.failed || 0}。\n` +
      `${incomplete ? '当天覆盖不完整，不能据此判断市场没有新变化。' : '本轮计划已完成；固定来源覆盖范围仍以站内登记为准。'}\n` +
      '产品范围为中东和北非24个国家或地区；当天任务完成不代表24地全部接入。各地接入与缺口见站内总览。\n\n';
    if (!changes.length) content += incomplete ? '本期没有可列出的新增证据，采集覆盖仍不完整。' : '本轮已完成，未发现新的来源证据变化。';
    changes.forEach((change, index) => {
      const link = `${baseUrl}/intelligence/sources/${encodeURIComponent(change.source_id)}`;
      const grouped = Number(change.grouped_source_count) > 1 ? ` · 同一事件共 ${Number(change.grouped_source_count)} 个来源` : '';
      content += `**${index + 1}. ${text(change.title_zh, 80)}**\n`;
      if (change.flash_accepted) { content += `已发重大提醒${grouped} · [查看详情](${link})\n\n`; return; }
      content += `国家/区域：${text((change.countries || []).map(c => countries[c] || c).join('、') || '待确认', 80)}\n` +
        `来源发布日期：${text(change.publication_date || '未披露', 30)}\n` +
        `变化摘要：${text(change.summary_zh, 120)}${grouped}\n证据状态：${evidenceNames[change.evidence_status] || '待核对'}\n` +
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
      text: { tag: 'plain_text', content: notification.notification_type === 'system' && payload.health !== 'connected' ? '查看当前任务明细' : '查看站内详情' }, url: detailUrl }] }] } };
}

function createFeishuSender({ webhookUrl, appId, appSecret, chatId, userOpenId, sendChat = true, sendUser = true, fetchImpl = global.fetch }) {
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
    let chatOwnerOpenId = null;
    if (!target && (sendChat || (sendUser && !userOpenId))) {
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
      if (/^ou_[A-Za-z0-9_-]{8,200}$/.test(chats[0]?.owner_id || '')) chatOwnerOpenId = chats[0].owner_id;
    }
    if (sendUser && chatId && !userOpenId) {
      try {
        const chatResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(target)}?user_id_type=open_id`, {
          redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: authorization }
        });
        const chatPayload = chatResponse.ok ? await chatResponse.json() : null;
        if (chatPayload?.code === 0 && /^ou_[A-Za-z0-9_-]{8,200}$/.test(chatPayload?.data?.owner_id || '')) {
          chatOwnerOpenId = chatPayload.data.owner_id;
        }
      } catch { /* Fall back to the bounded member lookup below. */ }
    }
    let directTarget = userOpenId || chatOwnerOpenId;
    if (sendUser && !directTarget) {
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
    for (const item of [{ key: 'chat', id: target, type: 'chat_id', enabled: sendChat }, { key: 'user', id: directTarget, type: 'open_id', enabled: sendUser }].filter(item => item.enabled)) {
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

module.exports = { buildCard, createFeishuSender, summarizeRun };
