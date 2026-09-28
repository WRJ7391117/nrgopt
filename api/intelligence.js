const regions = require('../lib/intelligence/regions.json');
const { createHash } = require('node:crypto');
const { settings, createStore, failure } = require('../lib/intelligence/store.cjs');
const { fetchSource } = require('../lib/intelligence/source.cjs');
const { createDeepSeekExtractor } = require('../lib/intelligence/deepseek.cjs');
const { createDeepSeekCrossChecker } = require('../lib/intelligence/crosscheck.cjs');
const { createMiniMaxDiscoverer } = require('../lib/intelligence/minimax.cjs');
const { runPaidCall, enqueueDailyScan, runDailyJobItem, scheduleDate } = require('../lib/intelligence/jobs.cjs');
const { importSourceUrl, extractSavedSource } = require('../lib/intelligence/pipeline.cjs');
const { createFeishuSender, summarizeRun } = require('../lib/intelligence/feishu.cjs');
const { enginePage, directionsPage, loginPage, resetPasswordPage, sourcesPage, overviewPage, settingsPage, workflowPage, followupsPage, workbenchPage } = require('../lib/intelligence/pages.cjs');
const { providerSettings, providerSettingsForOwner, publicProviderSettings, providerConfigRecord } = require('../lib/intelligence/provider-config.cjs');
const { createProviderBalanceReader } = require('../lib/intelligence/provider-billing.cjs');
const feishuConfig = require('../lib/intelligence/feishu-config.cjs');
const { registry } = require('../lib/intelligence/registry.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages = {
  feishu_config_incomplete: '请填写 App ID、App Secret，并选择及填写至少一个接收目标。', feishu_secret_required: '更换 App ID 时请填写对应的新 App Secret。', feishu_config_conflict: '飞书配置已在其他页面更改。请重新读取后再修改，当前输入尚未覆盖。',
  library_duplicate:'此入口已在源库中，请编辑或恢复已有记录。', library_conflict: '渠道已在其他页面修改，请刷新后重试。当前编辑保留。', library_limit:'最多登记500个渠道。', library_unchecked:'请先验证渠道入口可读取，再启用持续搜索。', source_invalid_url:'请填写可公开访问、不含查询参数的HTTPS渠道入口。',

  direction_conflict: '此方向已在其他页面修改。你的编辑仍保留，请核对最新设置后重新编辑。', direction_limit: '最多保留20个搜集方向，请编辑已有方向。',
  auth_required: '请登录后查看。', login_failed: '邮箱或密码错误，或账号尚未确认。', password_reset_failed: '重置链接无效或已过期，请重新发送重置邮件。', forbidden: '此账号没有情报模块的访问权限。', origin_rejected: '请求来源无效，请从本站重试。',
  not_configured: '情报服务尚未配置完成。', writes_disabled: '当前环境尚未开放来源导入。', invalid_request: '请检查输入内容。',
  followup_conflict: '跟踪已在另一页面更新，请重新读取后再保存，当前输入尚未覆盖。',
  not_found: '没有找到这条来源记录。', upstream_unavailable: '连接服务失败，请稍后重试。', storage_failed: '原件保存失败，请重试导入。',
    evidence_not_ready: '原件尚未保存完成。', evidence_corrupt: '原件校验失败，暂时无法下载。', source_failed: '来源获取失败，请检查网址后重试。',
    archive_queue_failed: '原件已保存，但归档任务登记失败；请重试保存这条来源。',
  source_empty_document: '来源页面没有可读取的正文，未调用模型；请换用可公开读取正文的原文页面。',
  model_not_configured: '情报分析服务尚未配置。', model_auth_failed: '情报分析服务密钥无效或无权调用。', model_unavailable: '情报分析服务暂时不可用，请稍后重试。',
  extraction_invalid: '模型返回内容未通过证据校验，未保存本次结果。', discovery_not_configured: '来源发现服务尚未配置。',
  extraction_invalid_structure: '模型返回的整体结构不完整，未保存本次结果。',
  extraction_invalid_summary: '模型返回的中文摘要字段不完整，未保存本次结果。',
  extraction_invalid_known_fact_quote: '模型给出的原文引文与来源正文不一致，未保存本次结果。',
  extraction_invalid_known_facts: '模型没有提供可由原文核对的已知事实，未保存本次结果。',
  extraction_invalid_next_steps: '模型没有完整区分未知项和后续观察信号，未保存本次结果。',
  extraction_invalid_classification: '模型返回的分类结构不完整，未保存本次结果。',
  extraction_invalid_country_evidence: '国家判断缺少有效的事实编号，未保存本次结果。',
  extraction_invalid_organization_evidence: '机构判断缺少有效的事实编号，未保存本次结果。',
  extraction_invalid_project_evidence: '项目判断缺少名称或有效的事实编号，未保存本次结果。',
  extraction_invalid_procurement_evidence: '采购判断缺少名称或有效的事实编号，未保存本次结果。',
  extraction_invalid_candidate_scope: '候选情报缺少已发生国家或三雷达分类，未保存本次结果。',
  extraction_invalid_energy_scope: '来源没有形成可验证的能源供给、需求或韧性影响路径，未发布为候选情报。',
  extraction_invalid_resilience_signal: '早期信号缺少完整的区域变化与能源韧性影响路径，未保存本次结果。',
  extraction_invalid_source_only_consistency: '背景来源与项目或雷达分类互相冲突，未保存本次结果。',
  extraction_invalid_response: '模型没有返回可解析的正文，未保存本次结果。',
  extraction_invalid_json: '模型返回内容不是有效 JSON，未保存本次结果。',
  discovery_auth_failed: '来源发现服务密钥无效或无权使用联网搜索。', discovery_unavailable: '暂时没有取得可用的搜索响应，请稍后重试。',
  discovery_balance_insufficient: '来源发现服务商返回余额不足，已暂停调用。请核对所用密钥、套餐权限和接口配置；这不是系统估算的费用。',
  discovery_plan_unavailable: '来源发现服务商返回套餐额度或权限不足，已暂停调用。请核对 Coding Plan 的搜索权限和剩余额度。',
  discovery_country_not_enabled: '该地区尚未接入自动搜索，请查看采集覆盖状态。',
  discovery_no_primary_sources: '搜索已完成，但本次没有找到符合官方来源要求的页面。',
  provider_call_not_started: '配置已变化或该调用已启动，未重复调用；请刷新配置后重试。',
  provider_call_record_pending: '调用完成状态未保存，请先核查调用记录，避免重复扣费。',
  provider_config_not_configured: '网页配置加密尚未启用。', provider_api_key_required: '首次保存此配置时必须填写 API Key。',
  budget_not_configured: '调用预算尚未配置，未发起模型请求。', budget_exhausted: '本期调用预算已用尽，未发起模型请求。',
  billing_sync_not_configured: '该服务尚未配置可核对的账单来源，未发起模型请求。', billing_sync_unavailable: '暂时无法读取服务商账单，未发起模型请求。',
  billing_sync_auth_failed: '服务商账单接口未授权，请检查 API Key。', billing_sync_pending: '模型请求已完成，但服务商账单尚未同步；系统已暂停后续调用，避免金额失真。',
  scheduler_disabled: '自动扫描尚未启用。', scheduler_unauthorized: '自动扫描凭据无效。',
  archive_disabled: '归档节点尚未接入。', archive_unauthorized: '归档凭据无效。',
  feishu_disabled: '飞书通知尚未启用。', feishu_not_configured: '飞书机器人尚未配置。',
  feishu_auth_failed: '飞书应用凭据无效或应用尚不可用。', feishu_chat_access_required: '飞书机器人尚无权读取所在群聊。',
  feishu_chat_membership_required: '飞书机器人尚未加入测试群。', feishu_chat_target_required: '飞书机器人已加入多个群，请指定目标群。',
  feishu_user_access_required: '飞书机器人尚无权读取目标群成员。', feishu_user_target_required: '无法从目标群唯一确定本人，请指定个人 open_id。',
  feishu_send_rejected: '飞书拒绝了卡片发送，请检查机器人消息权限和目标成员状态。',
  delivery_failed: '飞书未接受本次通知，已保留待重试记录。', delivery_unknown: '飞书响应结果不明，已停止自动重发。'
};
const { countries, primaryHosts, discoverCountry } = require('../lib/intelligence/discovery.cjs');
const { discoverWatch } = require('../lib/intelligence/watch-search.cjs');
const cookieName = env => (env.NRGOPT_APP_ORIGIN || '').startsWith('https://') ? '__Host-nrgopt_session' : 'nrgopt_session';
const archiveNode = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : null;
function sessionToken(req, env) {
  const prefix = `${cookieName(env)}=`;
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(item => item.startsWith(prefix));
  const token = cookie?.slice(prefix.length);
  return token && /^[A-Za-z0-9._-]{1,8192}$/.test(token) ? token : null;
}
function sessionCookie(token, seconds, env) {
  return `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${(env.NRGOPT_APP_ORIGIN || '').startsWith('https://') ? '; Secure' : ''}`;
}

function createHandler({ env = process.env, storeFactory = createStore, sourceFetcher = fetchSource, modelFactory = createDeepSeekExtractor,
  crossCheckFactory = createDeepSeekCrossChecker, discoveryFactory = createMiniMaxDiscoverer,
  balanceReaderFactory = createProviderBalanceReader, notificationFactory = createFeishuSender, feishuChecker = feishuConfig.checkCredentials } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Cookie');
    const action = req.query?.action || 'sources';
    const html = value => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).end(value); };
    try {
      const post = ['save-feishu-config', 'check-feishu-config', 'save-library-entry', 'check-library-entry', 'save-direction', 'login', 'logout', 'request-password-reset', 'reset-password', 'import', 'annotate', 'extract', 'discover', 'save-provider-settings', 'save-notification-settings', 'save-source-control', 'save-followup', 'archive-claim', 'archive-ack', 'archive-fail'].includes(action);
      const get = ['engine-page', 'feishu-page', 'feishu-config', 'library-page', 'source-library', 'library-history', 'directions-page', 'directions', 'direction-results', 'login-page', 'reset-password-page', 'page', 'overview-page', 'discover-page', 'workflow-page', 'followups-page', 'settings-page', 'detail-page', 'followup', 'followups', 'session', 'sources', 'source', 'overview', 'workbench', 'workflow', 'coverage', 'operations', 'provider-settings', 'provider-history', 'notification-settings', 'source-controls', 'evidence', 'scheduled-scan', 'health-check', 'notification-worker', 'archive-object'].includes(action);
      if ((!post && !get) || (post && req.method !== 'POST') || (get && req.method !== 'GET')) {
        res.setHeader('Allow', post ? 'POST' : 'GET');
        return res.status(405).json({ error: 'method_not_allowed', message: '不支持此请求方式。' });
      }
      if (action === 'login-page') return html(loginPage());
      if (action === 'reset-password-page') return html(resetPasswordPage());
      if (action.startsWith('archive-')) {
        if (env.NRGOPT_ARCHIVE_ENABLED !== '1') throw failure('archive_disabled', 503);
        if (!env.NRGOPT_ARCHIVE_TOKEN || req.headers.authorization !== `Bearer ${env.NRGOPT_ARCHIVE_TOKEN}`) throw failure('archive_unauthorized', 401);
        const config = settings(env);
        if (!config.writes) throw failure('writes_disabled', 403);
        const store = storeFactory(config);
        const body = req.body;
        if (post && (!req.headers['content-type']?.startsWith('application/json') || !body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 2048)) throw failure('invalid_request', 400);
        const nodeId = archiveNode(post ? body.node_id : req.query.node_id);
        if (!nodeId) throw failure('invalid_request', 400);
        if (action === 'archive-claim') {
          const job = await store.claimArchive(config.adminId, nodeId);
          return res.status(200).json({ job: job ? { ...job,
            download_url: `/api/intelligence?action=archive-object&id=${encodeURIComponent(job.id)}&node_id=${encodeURIComponent(nodeId)}` } : null });
        }
        if (!UUID.test(post ? body.id || '' : req.query.id || '')) throw failure('invalid_request', 400);
        const id = post ? body.id : req.query.id;
        if (action === 'archive-object') {
          const job = await store.archiveJob(id, config.adminId, nodeId);
          const { source, bytes } = await store.evidence(job.source_id, config.adminId);
          if (bytes.length !== source.byte_size || createHash('sha256').update(bytes).digest('hex') !== source.content_sha256) throw failure('evidence_corrupt', 502);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="source-${source.id}.${source.content_type === 'text/html' ? 'html' : source.content_type === 'application/json' ? 'json' : 'txt'}"`);
          return res.status(200).end(bytes);
        }
        if (action === 'archive-ack') {
          if (!Number.isInteger(body.byte_size) || body.byte_size < 0 || body.byte_size > 2097152 || !/^[a-f0-9]{64}$/.test(body.content_sha256 || '')) throw failure('invalid_request', 400);
          if (!await store.completeArchive(config.adminId, id, nodeId, body.byte_size, body.content_sha256)) throw failure('invalid_request', 409);
          return res.status(200).json({ ok: true });
        }
        if (!/^[a-z_]{1,64}$/.test(body.error_code || '') || !await store.failArchive(config.adminId, id, nodeId, body.error_code)) throw failure('invalid_request', 409);
        return res.status(200).json({ ok: true });
      }
      if (action === 'scheduled-scan') {
        if (env.NRGOPT_SCHEDULER_ENABLED !== '1') throw failure('scheduler_disabled', 503);
        if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) throw failure('scheduler_unauthorized', 401);
        const config = settings(env);
        if (!config.writes) throw failure('writes_disabled', 403);
        const store = storeFactory(config);
        const scheduled = await enqueueDailyScan({ store, owner: config.adminId });
        const result = await runDailyJobItem({ store, owner: config.adminId, env,
          discover: (country, profile, attempt, direction, channel) => discoverCountry(country, profile, discoveryFactory, attempt, direction, channel),
          watchDiscover: (plan, profile) => discoverWatch(plan, profile, discoveryFactory), sourceFetcher, modelFactory, crossCheckFactory,
          balanceReaderFactory });
        const job = await store.jobRun(config.adminId, result.jobId || scheduled.jobId);
        if (['succeeded', 'partial', 'failed', 'budget_paused', 'manual_paused'].includes(job.run.status)) {
          await store.enqueueDailyDigest(config.adminId, result.jobId || scheduled.jobId);
        }
        return res.status(200).json({ ...scheduled, result });
      }
      if (action === 'health-check') {
        if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) throw failure('scheduler_unauthorized', 401);
        const config = settings(env);
        if (!config.writes) throw failure('writes_disabled', 403);
        const store = storeFactory(config);
        const scheduleKey = scheduleDate();
        const snapshot = await store.dailyTasks(config.adminId, scheduleKey);
        const run = snapshot.run;
        const health = !run ? 'missing' : run.status === 'succeeded' ? 'ok' : ['failed', 'partial', 'budget_paused', 'manual_paused'].includes(run.status) ? 'degraded' : 'running';
        if (health === 'missing' || health === 'degraded') await store.enqueueNotification(config.adminId, 'system',
          `system:daily-health:${scheduleKey}:${health}`, { schedule_key: scheduleKey, health,
            ...summarizeRun(run, snapshot.items) });
        return res.status(200).json({ schedule_key: scheduleKey, health, run_status: run?.status || null });
      }
      if (action === 'notification-worker') {
        if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) throw failure('scheduler_unauthorized', 401);
        const config = settings(env);
        if (!config.writes) throw failure('writes_disabled', 403);
        const store = storeFactory(config);
        const delivery = feishuConfig.effectiveConfig(await store.feishuConfig(config.adminId), env, config.adminId);
        if (!delivery.enabled) return res.status(200).json({ status: 'paused' });
        const send = notificationFactory(feishuConfig.senderOptions(delivery));
        const notification = await store.claimNotification(config.adminId);
        if (!notification) return res.status(200).json({ status: 'idle' });
        let source = null;
        let candidate = null;
        if (notification.payload?.source_id && UUID.test(notification.payload.source_id)) {
          source = await store.get(notification.payload.source_id, config.adminId);
          candidate = await store.candidateBySource(notification.payload.source_id, config.adminId);
        }
        try {
          const delivered = await send({ notification, source, candidate, baseUrl: config.origin,
            onTargetAccepted: deliveredTarget => store.recordNotificationTarget(config.adminId, notification.id,
              notification.payload, deliveredTarget) });
          await store.finishNotification(config.adminId, notification.id, 'accepted', delivered.responseCode);
          return res.status(200).json({ status: 'accepted', notification_id: notification.id,
            message_id: delivered.messageId || null, message_ids: delivered.messageIds || [], chat_id: delivered.chatId || null });
        } catch (error) {
          const unknown = error.code === 'delivery_unknown';
          const safeCode = ['feishu_auth_failed', 'feishu_chat_access_required', 'feishu_chat_membership_required', 'feishu_chat_target_required',
            'feishu_user_access_required', 'feishu_user_target_required', 'feishu_send_rejected'].includes(error.code)
            ? error.code : unknown ? 'delivery_result_unknown' : 'delivery_failed';
          await store.finishNotification(config.adminId, notification.id, unknown ? 'unknown' : 'retry', error.responseCode || null,
            safeCode);
          throw failure(unknown ? 'delivery_unknown' : safeCode, 502);
        }
      }
      const token = sessionToken(req, env);
      if (!token && !['login', 'logout', 'request-password-reset', 'reset-password'].includes(action)) throw failure('auth_required', 401);
      const config = settings(env);
      if (post && !config.origins.includes(req.headers.origin)) throw failure('origin_rejected', 403);
      const store = storeFactory(config);
      if (action === 'logout') {
        res.setHeader('Set-Cookie', sessionCookie('', 0, env));
        if (token) { try { await store.logout(token); } catch { /* Local cookie removal must still complete. */ } }
        return res.status(200).json({ ok: true });
      }
      let body = req.body;
      if (post) {
        const bodyLimit = action === 'save-provider-settings' ? 12000 : 8192;
        if (!req.headers['content-type']?.startsWith('application/json') || !body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > bodyLimit) throw failure('invalid_request', 400);
      }
      if (action === 'login') {
        if (typeof body.email !== 'string' || body.email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw failure('invalid_request', 400);
        let result;
        try { result = await store.login(body.email.trim(), body.password); }
        catch (error) {
          if (error.code === 'auth_required') throw failure('login_failed', 401);
          throw error;
        }
        if (!result?.user || result.user.id !== config.adminId) throw failure('forbidden', 403);
        if (typeof result.access_token !== 'string' || !/^[A-Za-z0-9._-]+$/.test(result.access_token)) throw failure('upstream_unavailable');
        res.setHeader('Set-Cookie', sessionCookie(result.access_token, Math.min(Number(result.expires_in) || 3600, 3600), env));
        return res.status(200).json({ ok: true });
      }
      if (action === 'request-password-reset') {
        if (typeof body.email !== 'string' || body.email.length > 254 || !body.email.trim()) throw failure('invalid_request', 400);
        await store.requestPasswordReset(body.email.trim(), `${config.origin}/intelligence/reset-password`);
        return res.status(200).json({ ok: true, message: '如果该邮箱已注册，重置邮件已发送。' });
      }
      if (action === 'reset-password') {
        if (typeof body.token !== 'string' || !/^[A-Za-z0-9._-]{1,8192}$/.test(body.token) ||
            typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 1024) throw failure('invalid_request', 400);
        let result;
        try { result = await store.resetPassword(body.token, body.password); }
        catch (error) {
          if (error.code === 'auth_required') throw failure('password_reset_failed', 401);
          throw error;
        }
        if (!result || result.id !== config.adminId) throw failure('forbidden', 403);
        return res.status(200).json({ ok: true });
      }
      const user = await store.user(token);
      if (!user || user.id !== config.adminId) throw failure('forbidden', 403);
      if (['detail-page', 'source', 'evidence', 'annotate', 'extract', 'followup', 'save-followup'].includes(action) && !UUID.test(req.query.id || '')) throw failure('invalid_request', 400);
      if (action === 'page' || action === 'detail-page') return html(sourcesPage({ detailId: action === 'detail-page' ? req.query.id : null, email: user.email }));
      if (action === 'overview-page') return html(['view', 'country', 'group', 'topic', 'period', 'radar'].some(key => req.query[key]) ? overviewPage(user.email) : workbenchPage(user.email));
      if (action === 'engine-page') return html(enginePage(user.email));
      if (action === 'feishu-page') return html(require('../lib/intelligence/pages.cjs').feishuPage(user.email));
      if (action === 'library-page') return html(require('../lib/intelligence/pages.cjs').sourceLibraryPage(user.email));
      if (action === 'source-library') return res.status(200).json({ ...(await store.libraryOverview(user.id)), writable:config.writes, directions:(await store.collectionDirections(user.id,scheduleDate())).directions, types:require('../lib/intelligence/source-library.cjs').types });
      if (action === 'library-history') {
        if (typeof req.query.id !== 'string' || req.query.id.length>255) throw failure('invalid_request',400);
        return res.status(200).json({ history:await store.libraryHistory(user.id,req.query.id) });
      }
      if (action === 'save-library-entry' || action === 'check-library-entry') {
        if (!config.writes) throw failure('writes_disabled',403);
        const library = require('../lib/intelligence/source-library.cjs');
        if (action === 'save-library-entry') {
          const entry = library.validateEntry(body);
          const directions = (await store.collectionDirections(user.id,scheduleDate())).directions;
          if (entry.config.direction_ids.some(id=>!directions.some(d=>d.id===id))) throw failure('invalid_request',400);
          const entries = await store.sourceLibrary(user.id);
          if (entries.some(e=>e.id!==entry.id && library.scopeKey(e)===library.scopeKey(entry))) throw failure('library_duplicate',409);
          return res.status(200).json({ entry:await store.saveLibraryEntry(user.id,entry) });
        }
        const entry = (await store.sourceLibrary(user.id)).find(e=>e.id===body.id && e.revision===body.revision);
        if (!entry) throw failure('library_conflict',409);
        if (entry.status==='removed') throw failure('invalid_request',400);
        let access;
        try {
          const source = await sourceFetcher(entry.config.url);
          if (!library.matches(entry,source.finalUrl)) throw failure('registry_redirect_host',422);
          if (!source.excerpt?.trim()) throw failure('source_empty_document',422);
          access = { status:'readable',checked_at:new Date().toISOString(),final_url:source.finalUrl,sha256:source.sha256 || createHash('sha256').update(source.bytes).digest('hex'), title:source.title, note:'仅验证入口可读取，未验证身份、文章日期、分析或持续产出。' };
        } catch(error) { access = { status:'failed',checked_at:new Date().toISOString(),error_code:/^(source|registry)_[a-z_]+$/.test(error.code||'')?error.code:'source_failed' }; }
        const checkedEntry = access.status==='failed' && entry.status==='active' && entry.config.mode!=='fixed' ? {...entry,status:'candidate'} : entry;
        return res.status(200).json({ entry:await store.saveLibraryEntry(user.id,checkedEntry,access) });
      }
      if (action === 'directions-page') return html(directionsPage(user.email));
      if (action === 'directions') return res.status(200).json({ ...(await store.collectionDirections(user.id, scheduleDate())), writable: config.writes, websites: primaryHosts });
      if (action === 'direction-results') {
        if (!UUID.test(req.query.id || '')) throw failure('invalid_request', 400);
        return res.status(200).json(await store.directionResults(user.id, req.query.id));
      }
      if (action === 'save-direction') {
        if (!config.writes) throw failure('writes_disabled', 403);
        return res.status(200).json({ direction: await store.saveDirection(user.id, require('../lib/intelligence/directions.cjs').validateDirection(body)) });
      }
      if (action === 'discover-page') return html(overviewPage(user.email));
      if (action === 'workbench') return res.status(200).json(await store.workbench(user.id, scheduleDate()));
      if (action === 'coverage') return res.status(200).json({ ...(await store.dailyEntryStatus(user.id, scheduleDate())), search_countries: Object.keys(primaryHosts), fixed_sources: registry.map(({ id, country }) => ({ id, country })) });
      if (action === 'workflow-page') return html(workflowPage(user.email));
      if (action === 'workflow') return res.status(200).json({ user: { email: user.email }, ...(await store.dailyTasks(user.id, scheduleDate())) });
      if (action === 'followups-page') return html(followupsPage(user.email));
      if (action === 'followup') return res.status(200).json({ ...(await store.followup(req.query.id, user.id)), writable: config.writes });
      if (action === 'followups') {
        const state = req.query.state || 'active';
        const offset = Number(req.query.offset || 0);
        if (!['active', 'expired', 'completed'].includes(state) || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw failure('invalid_request', 400);
        return res.status(200).json({ ...(await store.followups(user.id, state, offset)), writable: config.writes });
      }
      if (action === 'save-followup') {
        if (!config.writes) throw failure('writes_disabled', 403);
        const value = require('../lib/intelligence/followup.cjs').validateFollowup(body);
        return res.status(200).json({ watch: await store.saveFollowup(req.query.id, user.id, value) });
      }
      if (action === 'settings-page') return html(settingsPage(user.email));
      if (action === 'session') return res.status(200).json({ user: { email: user.email } });
      if (action === 'sources') return res.status(200).json({ sources: await store.list(user.id) });
      if (action === 'source') return res.status(200).json({ source: await store.get(req.query.id, user.id),
        candidate: await store.candidateBySource(req.query.id, user.id), history: await store.sourceHistory(req.query.id, user.id), revisions: await store.analysisRevisions(req.query.id, user.id), project_history: await store.projectTimeline(req.query.id, user.id), business_history: await store.businessHistory(req.query.id, user.id) });
      if (action === 'overview') {
        const candidates = await store.candidates(user.id);
        return res.status(200).json({ user: { email: user.email }, candidates, opportunities: await store.currentOpportunities(user.id, candidates) });
      }
      if (action === 'source-controls') {
        const controls = await store.sourceControls(user.id);
        return res.status(200).json({ writable: config.writes, sources: registry.map(({ id, name, url }) => ({
          id, name, url, paused: controls.find(item => item.hostname === new URL(url).hostname.replace(/^www\./, ''))?.paused === true
        })) });
      }
      if (action === 'save-source-control') {
        if (!config.writes) throw failure('writes_disabled', 403);
        const entry = registry.find(item => item.id === body.registry_id);
        if (!entry || typeof body.paused !== 'boolean') throw failure('invalid_request', 400);
        const resumed = await store.setSourceControl(user.id, new URL(entry.url).hostname.replace(/^www\./, ''), body.paused);
        return res.status(200).json({ ok: true, resumed });
      }
      if (action === 'operations') return res.status(200).json({ ...(await store.operations(user.id)),
        fixed_source_countries: [...new Set(registry.map(entry => entry.country))],
        scheduler_enabled: env.NRGOPT_SCHEDULER_ENABLED === '1' && config.writes,
        archive_status: env.NRGOPT_ARCHIVE_ENABLED !== '1' ? 'disabled' : !env.NRGOPT_ARCHIVE_TOKEN ? 'missing_token' : !config.writes ? 'read_only' : 'enabled' });
      if (action === 'provider-history') return res.status(200).json(await store.providerHistory(user.id));
      if (['feishu-config', 'save-feishu-config', 'check-feishu-config', 'notification-settings'].includes(action)) {
        const current = feishuConfig.effectiveConfig(await store.feishuConfig(user.id), env, user.id);
        if (action === 'feishu-config') return res.status(200).json({ config: feishuConfig.publicConfig(current), writable: config.writes, history: await store.notificationHistory(user.id) });
        if (action === 'notification-settings') return res.status(200).json({ settings: await store.notificationSettings(user.id), writable: config.writes,
          delivery_enabled: current.enabled && Boolean(current.webhook_url || (current.app_id && current.app_secret)) });
        if (!config.writes) throw failure('writes_disabled', 403);
        if (action === 'check-feishu-config') return res.status(200).json(await feishuChecker(current));
        const record = feishuConfig.configRecord(body, current, env, user.id);
        const saved = await store.saveFeishuConfig(user.id, body.revision, record);
        return res.status(200).json({ config: feishuConfig.publicConfig(feishuConfig.effectiveConfig(saved, env, user.id)) });
      }
      if (action === 'save-notification-settings') {
        if (!config.writes) throw failure('writes_disabled', 403);
        const { quiet_enabled, quiet_start_hour, quiet_end_hour, timezone, flash_breaks_quiet } = body;
        if (typeof quiet_enabled !== 'boolean' || typeof flash_breaks_quiet !== 'boolean' ||
            ![quiet_start_hour, quiet_end_hour].every(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23) ||
            quiet_start_hour === quiet_end_hour || !['Asia/Shanghai', 'Asia/Riyadh', 'Asia/Dubai', 'UTC'].includes(timezone)) throw failure('invalid_request', 400);
        return res.status(200).json({ settings: await store.saveNotificationSettings(user.id,
          { quiet_enabled, quiet_start_hour, quiet_end_hour, timezone, flash_breaks_quiet }) });
      }
      if (action === 'provider-settings') return res.status(200).json({
        profiles: publicProviderSettings(env, await store.providerConfigs(user.id)), writable: config.writes
      });
      if (action === 'save-provider-settings') {
        if (!config.writes) throw failure('writes_disabled', 403);
        const existingRows = await store.providerConfigs(user.id);
        const existing = existingRows.find(item => item.capability === body.capability) || null;
        const environmentProfile = providerSettings(env)[body.capability];
        const saved = await store.saveProviderConfig(user.id, providerConfigRecord({
          env, owner: user.id, capability: body.capability, input: body, existing,
          fallbackApiKey: environmentProfile?.apiKey || null
        }));
        const profiles = publicProviderSettings(env, existingRows.filter(item => item.capability !== saved.capability).concat(saved));
        return res.status(200).json({ profile: profiles.find(item => item.capability === saved.capability) });
      }
      if (action === 'discover') {
        if (!config.writes) throw failure('writes_disabled', 403);
        if (!countries[body.country]) throw failure('invalid_request', 400);
        if (!primaryHosts[body.country]?.length) throw failure('discovery_country_not_enabled', 400);
        const discoveryProvider = (await providerSettingsForOwner(env, store, user.id)).discovery;
        const discovery = await runPaidCall({ store, owner: user.id, operation: 'discovery', currency: discoveryProvider.currency,
          budgetKey: discoveryProvider.budgetKey, budgetLimitMicro: discoveryProvider.budgetLimitMicro,
          profile: discoveryProvider, billingMode: discoveryProvider.billingMode, readBalance: balanceReaderFactory(discoveryProvider),
          providerMissingCode: 'discovery_not_configured', env,
          call: () => discoverCountry(body.country, discoveryProvider, discoveryFactory) });
        return res.status(200).json({ country: body.country, sources: discovery.sources });
      }
      if (action === 'annotate') {
        if (!config.writes || typeof body.note !== 'string' || [...body.note].length > 2000) throw failure(config.writes ? 'invalid_request' : 'writes_disabled', config.writes ? 400 : 403);
        return res.status(200).json({ source: await store.annotate(req.query.id, user.id, body.note.trim()) });
      }
      if (action === 'extract') {
        if (!config.writes) throw failure('writes_disabled', 403);
        try {
          let result;
          try {
            result = await extractSavedSource({ store, owner: user.id, sourceId: req.query.id, env, modelFactory, crossCheckFactory, balanceReaderFactory });
          } catch (error) {
            const invalid = error?.code === 'extraction_invalid'
              || /^extraction_invalid_[a-z_]{1,40}$/.test(error?.code || '');
            if (!invalid) throw error;
            result = await extractSavedSource({ store, owner: user.id, sourceId: req.query.id, env, modelFactory, crossCheckFactory,
              balanceReaderFactory, formatRepairCode: error.code });
          }
          return res.status(200).json({ source: result.source, candidate: await store.candidateBySource(req.query.id, user.id),
            history: await store.sourceHistory(req.query.id, user.id), revisions: await store.analysisRevisions(req.query.id, user.id), project_history: await store.projectTimeline(req.query.id, user.id), business_history: await store.businessHistory(req.query.id, user.id) });
        }
        catch (error) {
          const code = messages[error.code] ? error.code : 'model_unavailable';
          throw failure(code, error.status || 502);
        }
      }
      if (action === 'evidence') {
        const { source, bytes } = await store.evidence(req.query.id, user.id);
        if (createHash('sha256').update(bytes).digest('hex') !== source.content_sha256) throw failure('evidence_corrupt', 502);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Security-Policy', 'sandbox');
        res.setHeader('Content-Disposition', `attachment; filename="source-${source.id}.${source.content_type === 'text/html' ? 'html' : source.content_type === 'application/json' ? 'json' : 'txt'}"`);
        return res.status(200).end(bytes);
      }
      if (!config.writes) throw failure('writes_disabled', 403);
      if (typeof body.url !== 'string' || body.url.length > 2048) throw failure('invalid_request', 400);
      const result = await importSourceUrl({ store, owner: user.id, url: body.url, sourceFetcher });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      if (error.code === 'auth_required' && ['engine-page', 'feishu-page', 'library-page', 'directions-page', 'page', 'overview-page', 'discover-page', 'workflow-page', 'followups-page', 'settings-page', 'detail-page'].includes(action)) {
        let target = action === 'detail-page' && UUID.test(req.query.id || '') ? `/intelligence/sources/${req.query.id}`
          : action === 'engine-page' ? '/intelligence/engine' : action === 'feishu-page' ? '/intelligence/feishu' : action === 'library-page' ? '/intelligence/library' : action === 'directions-page' ? '/intelligence/directions' : action === 'discover-page' ? '/intelligence/discover' : action === 'followups-page' ? '/intelligence/followups' : action === 'workflow-page' ? '/intelligence/workflow' : action === 'overview-page' ? '/intelligence/overview' : action === 'settings-page' ? '/intelligence/settings' : '/intelligence/sources';
        if (['overview-page', 'discover-page'].includes(action)) {
          const params = new URLSearchParams();
          if (regions.countries.some(item => item.code === req.query.country)) params.set('country', req.query.country);
          if (Object.hasOwn(regions.groups, req.query.group || '')) params.set('group', req.query.group);
          if (Object.hasOwn(regions.topics, req.query.topic || '')) params.set('topic', req.query.topic);
          const view = ['signal', 'demand', 'project', 'opportunity'].includes(req.query.view) ? req.query.view
            : ['trigger', 'demand', 'project'].includes(req.query.radar) ? (req.query.radar === 'trigger' ? 'signal' : req.query.radar) : null;
          if (view) params.set('view', view);
          if (['30', '90', 'all', 'unknown'].includes(req.query.period)) params.set('period', req.query.period);
          if (params.size) target += '?' + params;
        }
        res.setHeader('Location', `/intelligence/login?returnTo=${encodeURIComponent(target)}`);
        return res.status(303).end();
      }
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      const code = messages[error.code] ? error.code : (status < 500 ? 'invalid_request' : 'upstream_unavailable');
      return res.status(status).json({ error: code, message: messages[code] });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
