const { createHash } = require('node:crypto');
const { settings, createStore, failure } = require('../lib/intelligence/store.cjs');
const { fetchSource } = require('../lib/intelligence/source.cjs');
const { createDeepSeekExtractor } = require('../lib/intelligence/deepseek.cjs');
const { createDeepSeekCrossChecker } = require('../lib/intelligence/crosscheck.cjs');
const { createMiniMaxDiscoverer } = require('../lib/intelligence/minimax.cjs');
const { runPaidCall, enqueueDailyScan, runDailyJobItem, scheduleDate } = require('../lib/intelligence/jobs.cjs');
const { importSourceUrl, extractSavedSource } = require('../lib/intelligence/pipeline.cjs');
const { createFeishuSender } = require('../lib/intelligence/feishu.cjs');
const { loginPage, sourcesPage, overviewPage, settingsPage } = require('../lib/intelligence/pages.cjs');
const { providerSettings, providerSettingsForOwner, publicProviderSettings, providerConfigRecord } = require('../lib/intelligence/provider-config.cjs');
const { createProviderBalanceReader } = require('../lib/intelligence/provider-billing.cjs');
const { registry } = require('../lib/intelligence/registry.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages = {
  auth_required: '请登录后查看。', login_failed: '邮箱或密码错误，或账号尚未确认。', forbidden: '此账号没有情报模块的访问权限。', origin_rejected: '请求来源无效，请从本站重试。',
  not_configured: '情报服务尚未配置完成。', writes_disabled: '当前环境尚未开放来源导入。', invalid_request: '请检查输入内容。',
  not_found: '没有找到这条来源记录。', upstream_unavailable: '连接服务失败，请稍后重试。', storage_failed: '原件保存失败，请重试导入。',
    evidence_not_ready: '原件尚未保存完成。', evidence_corrupt: '原件校验失败，暂时无法下载。', source_failed: '来源获取失败，请检查网址后重试。',
    archive_queue_failed: '原件已保存，但归档任务登记失败；请重试保存这条来源。',
  source_empty_document: '来源页面没有可读取的正文，未调用模型；请换用有正文的官方公告。',
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
  extraction_invalid_source_only_consistency: '背景来源与项目或雷达分类互相冲突，未保存本次结果。',
  extraction_invalid_response: '模型没有返回可解析的正文，未保存本次结果。',
  extraction_invalid_json: '模型返回内容不是有效 JSON，未保存本次结果。',
  discovery_auth_failed: '来源发现服务密钥无效或无权使用联网搜索。', discovery_unavailable: '暂时没有取得可用的官方来源，请稍后重试。',
  discovery_balance_insufficient: '来源发现服务商返回余额不足，已暂停调用。请核对所用密钥、套餐权限和接口配置；这不是系统估算的费用。',
  discovery_plan_unavailable: '来源发现服务商返回套餐额度或权限不足，已暂停调用。请核对 Coding Plan 的搜索权限和剩余额度。',
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
  delivery_failed: '飞书未接受本次通知，已保留待重试记录。', delivery_unknown: '飞书响应结果不明，已停止自动重发。'
};
const { countries, discoverCountry } = require('../lib/intelligence/discovery.cjs');
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
  balanceReaderFactory = createProviderBalanceReader, notificationFactory = createFeishuSender } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Cookie');
    const action = req.query?.action || 'sources';
    const html = value => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).end(value); };
    try {
      const post = ['login', 'logout', 'import', 'annotate', 'extract', 'discover', 'save-provider-settings', 'save-notification-settings', 'save-source-control', 'archive-claim', 'archive-ack', 'archive-fail'].includes(action);
      const get = ['login-page', 'page', 'overview-page', 'settings-page', 'detail-page', 'session', 'sources', 'source', 'overview', 'operations', 'provider-settings', 'provider-history', 'notification-settings', 'source-controls', 'evidence', 'scheduled-scan', 'health-check', 'notification-worker', 'archive-object'].includes(action);
      if ((!post && !get) || (post && req.method !== 'POST') || (get && req.method !== 'GET')) {
        res.setHeader('Allow', post ? 'POST' : 'GET');
        return res.status(405).json({ error: 'method_not_allowed', message: '不支持此请求方式。' });
      }
      if (action === 'login-page') return html(loginPage());
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
          discover: (country, profile, attempt) => discoverCountry(country, profile, discoveryFactory, attempt),
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
        const operations = await store.operations(config.adminId);
        const run = operations.runs.find(item => item.job_type === 'daily_scan' && item.schedule_key === scheduleKey);
        const health = !run ? 'missing' : run.status === 'succeeded' ? 'ok' : ['failed', 'partial', 'budget_paused', 'manual_paused'].includes(run.status) ? 'degraded' : 'running';
        if (health === 'missing' || health === 'degraded') await store.enqueueNotification(config.adminId, 'system',
          `system:daily-health:${scheduleKey}:${health}`, { schedule_key: scheduleKey, health, run_status: run?.status || null,
            issue_zh: health === 'missing' ? '今日扫描任务缺失。' : `今日扫描状态为 ${run.status}，覆盖可能不完整。` });
        return res.status(200).json({ schedule_key: scheduleKey, health, run_status: run?.status || null });
      }
      if (action === 'notification-worker') {
        if (env.NRGOPT_FEISHU_ENABLED !== '1') throw failure('feishu_disabled', 503);
        if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) throw failure('scheduler_unauthorized', 401);
        const config = settings(env);
        if (!config.writes) throw failure('writes_disabled', 403);
        const send = notificationFactory({ webhookUrl: env.FEISHU_WEBHOOK_URL, appId: env.FEISHU_APP_ID,
          appSecret: env.FEISHU_APP_SECRET, chatId: env.FEISHU_CHAT_ID });
        const store = storeFactory(config);
        const notification = await store.claimNotification(config.adminId);
        if (!notification) return res.status(200).json({ status: 'idle' });
        let source = null;
        let candidate = null;
        if (notification.payload?.source_id && UUID.test(notification.payload.source_id)) {
          source = await store.get(notification.payload.source_id, config.adminId);
          candidate = await store.candidateBySource(notification.payload.source_id, config.adminId);
        }
        try {
          const delivered = await send({ notification, source, candidate, baseUrl: config.origin });
          await store.finishNotification(config.adminId, notification.id, 'accepted', delivered.responseCode);
          return res.status(200).json({ status: 'accepted', notification_id: notification.id,
            message_id: delivered.messageId || null, chat_id: delivered.chatId || null });
        } catch (error) {
          const unknown = error.code === 'delivery_unknown';
          await store.finishNotification(config.adminId, notification.id, unknown ? 'unknown' : 'retry', error.responseCode || null,
            unknown ? 'delivery_result_unknown' : 'delivery_failed');
          throw failure(unknown ? 'delivery_unknown' : 'delivery_failed', 502);
        }
      }
      const token = sessionToken(req, env);
      if (!token && !['login', 'logout'].includes(action)) throw failure('auth_required', 401);
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
      const user = await store.user(token);
      if (!user || user.id !== config.adminId) throw failure('forbidden', 403);
      if (['detail-page', 'source', 'evidence', 'annotate', 'extract'].includes(action) && !UUID.test(req.query.id || '')) throw failure('invalid_request', 400);
      if (action === 'page' || action === 'detail-page') return html(sourcesPage({ detailId: action === 'detail-page' ? req.query.id : null }));
      if (action === 'overview-page') return html(overviewPage());
      if (action === 'settings-page') return html(settingsPage());
      if (action === 'session') return res.status(200).json({ user: { email: user.email } });
      if (action === 'sources') return res.status(200).json({ sources: await store.list(user.id) });
      if (action === 'source') return res.status(200).json({ source: await store.get(req.query.id, user.id),
        candidate: await store.candidateBySource(req.query.id, user.id), history: await store.sourceHistory(req.query.id, user.id), revisions: await store.analysisRevisions(req.query.id, user.id), project_history: await store.projectTimeline(req.query.id, user.id), business_history: await store.businessHistory(req.query.id, user.id) });
      if (action === 'overview') {
        const candidates = await store.candidates(user.id);
        return res.status(200).json({ candidates, opportunities: await store.currentOpportunities(user.id, candidates) });
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
      if (action === 'notification-settings') return res.status(200).json({ settings: await store.notificationSettings(user.id), writable: config.writes,
        delivery_enabled: env.NRGOPT_FEISHU_ENABLED === '1' && Boolean(env.FEISHU_WEBHOOK_URL || (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET)) });
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
      if (error.code === 'auth_required' && ['page', 'overview-page', 'settings-page', 'detail-page'].includes(action)) {
        let target = action === 'detail-page' && UUID.test(req.query.id || '') ? `/intelligence/sources/${req.query.id}`
          : action === 'overview-page' ? '/intelligence/overview' : action === 'settings-page' ? '/intelligence/settings' : '/intelligence';
        if (action === 'overview-page') {
          const params = new URLSearchParams();
          if (['SA', 'AE', 'QA', 'KW', 'OM', 'BH'].includes(req.query.country)) params.set('country', req.query.country);
          if (['trigger', 'demand', 'project'].includes(req.query.radar)) params.set('radar', req.query.radar);
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
