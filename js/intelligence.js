(function () {
  'use strict';

  var uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  var detailPath = new RegExp('^/intelligence/sources/(' + uuid + ')$', 'i');
  var statusLabels = {
    pending_extraction: '待中文提取',
    saving_evidence: '保存中',
    evidence_failed: '证据保存失败',
    fetch_failed: '来源获取失败'
  };

  function byId(id) { return document.getElementById(id); }
  function publicationLabel(source) {
    source = source || {};
    if (source.publication_method === 'conflicting_metadata') return '日期字段有冲突，待核验';
    var value = source.publication_date || (source.published_at || '').slice(0, 10);
    if (!value) return '未知（原文未提供可可靠识别的发布日期）';
    var age = (Date.now() - Date.parse(value + 'T00:00:00Z')) / 86400000;
    var label = source.published_at ? dateLabel(source.published_at) : value + '（仅日期）';
    return label + (age > 30 ? ' · 历史公告（超过30天）' : age < -1 ? ' · 未来日期，待核验' : '');
  }
  function status(id, message, tone) {
    var element = byId(id);
    element.textContent = message;
    element.dataset.tone = tone || '';
  }
  function safeReturnTo(value) {
    return value === '/intelligence' || value === '/intelligence/overview' || value === '/intelligence/settings' || detailPath.test(value || '') ? value : '/intelligence';
  }
  function loginLocation() {
    return '/intelligence/login?returnTo=' + encodeURIComponent(safeReturnTo(location.pathname));
  }
  async function api(action, body, id) {
    var url = '/api/intelligence?action=' + action + (id ? '&id=' + encodeURIComponent(id) : '');
    var options = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    var response = await fetch(url, options);
    var data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && action !== 'login' && !byId('login-form')) {
        location.replace(loginLocation());
      }
      throw new Error(data.message || '操作未完成，请稍后重试。');
    }
    return data;
  }
  function dateLabel(value) {
    if (!value) return '未知';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
  }
  function webUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch (_) { return null; }
  }
  function sourceHref(id) {
    return new RegExp('^' + uuid + '$', 'i').test(id || '') ? '/intelligence/sources/' + id : null;
  }
  function setSourceLink(element, id) {
    var href = sourceHref(id);
    if (href) element.href = href;
    return Boolean(href);
  }
  function sourceStatus(element, source) {
    var extractionLabels = { extracted: '单一来源情报', processing: '正在生成初析', extraction_failed: '初析未通过' };
    var value = source.extraction_status || source.status;
    element.textContent = extractionLabels[source.extraction_status] || statusLabels[source.status] || '状态未知';
    element.dataset.state = value || '';
  }
  function annotationTitle(source) {
    var note = source.extraction_zh?.summary_zh || source.annotation_zh;
    if (!note) return '待补中文注释';
    var firstSentence = note.split(/[。！？]/)[0].trim();
    return firstSentence.length > 80 ? firstSentence.slice(0, 80) + '…' : firstSentence;
  }
  function renderTextList(id, items) {
    var element = byId(id);
    element.replaceChildren();
    (items || []).forEach(function (item) {
      var row = document.createElement('li');
      row.textContent = item;
      element.append(row);
    });
  }
  function renderExtraction(source, candidate) {
    var extraction = source.extraction_zh;
    var button = byId('extract-button');
    var languageNote = byId('source-language-note');
    button.textContent = extraction ? '重新生成初析' : '生成中文初析';
    if (languageNote) languageNote.textContent = extraction ? '原文语言：英语 · 中文情报已生成，引文已与原文自动比对' : '原文语言：英语 · 中文初析尚未生成';
    byId('extraction-content').hidden = !extraction;
    if (!extraction) {
      status('extraction-status', source.extraction_status === 'extraction_failed' ? '上次结果未通过证据校验，可重新生成。' : '尚未生成模型初析。');
      return;
    }
    status('extraction-status', '单一来源分析已生成；逐条引文已与保存的原文自动比对。', 'success');
    byId('extraction-summary').textContent = extraction.summary_zh;
    byId('extraction-importance').textContent = extraction.why_it_matters_zh;
    byId('extraction-relevance').textContent = extraction.gcc_relevance_zh;
    var classification = extraction.classification;
    var radarLabels = { trigger: '触发雷达', demand: '需求雷达', project: '项目雷达' };
    var countryLabels = { SA: '沙特阿拉伯', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', OM: '阿曼', BH: '巴林' };
    var importanceLabels = { low: '低', medium: '中', high: '高', critical: '重大' };
    var evidenceLabels = { unverified: '单一来源，未交叉验证', sourced: '引文已绑定', checked: '部分事实已交叉核对', conflict: '有冲突', corrected: '已更正' };
    var maturityLabels = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
    var urgencyLabels = { none: '无即时行动', research: '待研究', prepare: '需准备', deadline: '截止临近' };
    byId('extraction-classification').hidden = !classification;
    if (classification) {
      var occurred = (classification.countries || []).filter(function (item) { return item.relation === 'occurrence'; }).map(function (item) { return countryLabels[item.code] || item.code; });
      var evidenceStatus = candidate?.evidence_status || classification.evidence_status;
      var relatedCount = candidate?.related_sources?.length || 0;
      byId('extraction-classification-summary').textContent = classification.disposition === 'candidate'
        ? '候选分类：' + (classification.radars || []).map(function (item) { return radarLabels[item] || item; }).join(' / ') + ' · 发生国：' + occurred.join('、') + ' · 重要性：' + importanceLabels[classification.importance] + ' · 证据：' + evidenceLabels[evidenceStatus] + (relatedCount ? '（另有 ' + relatedCount + ' 个独立来源）' : '') + ' · 成熟度：' + maturityLabels[extraction.maturity] + ' · 紧迫度：' + urgencyLabels[classification.urgency]
        : '仅保留在来源层：没有足够证据进入海合会三雷达候选。';
      byId('extraction-project-section').hidden = !classification.project;
      if (classification.project) byId('extraction-project').textContent = classification.project.name_zh + (classification.project.stage_zh ? ' · ' + classification.project.stage_zh : '') + ' · 证据见事实 ' + classification.project.evidence_fact_number;
      byId('extraction-procurement-section').hidden = !classification.procurement;
      if (classification.procurement) byId('extraction-procurement').textContent = classification.procurement.package_zh + (classification.procurement.stage_zh ? ' · ' + classification.procurement.stage_zh : '') + (classification.procurement.deadline_text ? ' · 截止：' + classification.procurement.deadline_text : '') + ' · 证据见事实 ' + classification.procurement.evidence_fact_number;
    }
    renderTextList('extraction-unknowns', extraction.unknowns_zh);
    var tracking = candidate?.tracking;
    var watchLabels = { active: '持续跟踪', completed: '已完成', expired: '已到期' };
    renderTextList('extraction-signals', tracking ? tracking.watches.map(function (watch) {
      return (watchLabels[watch.status] || watch.status) + '：' + watch.signal_zh;
    }) : extraction.next_signals_zh);
    var facts = byId('extraction-facts');
    facts.replaceChildren();
    (extraction.known_facts || []).forEach(function (fact) {
      var item = document.createElement('li');
      var claim = document.createElement('p');
      claim.textContent = fact.claim_zh;
      var quote = document.createElement('blockquote');
      quote.textContent = '原文证据：“' + fact.evidence_quote + '”';
      item.append(claim, quote);
      facts.append(item);
    });
    var hypotheses = byId('extraction-hypotheses');
    hypotheses.replaceChildren();
    var hypothesisLabels = { open: '待验证', strengthened: '证据增强', weakened: '证据减弱', confirmed: '已证实', rejected: '已否定', dormant: '休眠' };
    (tracking ? tracking.hypotheses : extraction.hypotheses || []).forEach(function (hypothesis) {
      var item = document.createElement('li');
      item.textContent = (hypothesis.status ? (hypothesisLabels[hypothesis.status] || hypothesis.status) + '：' : '')
        + (hypothesis.claim_zh || hypothesis.hypothesis_zh) + (hypothesis.counter_evidence_zh ? '；反证方向：' + hypothesis.counter_evidence_zh : '');
      if (hypothesis.created_at && ['open', 'strengthened', 'weakened'].includes(hypothesis.status)) {
        var expires = hypothesis.review_due_at ? Date.parse(hypothesis.review_due_at) : Date.parse(hypothesis.created_at) + 90 * 86400000;
        var windowNote = document.createElement('p');
        windowNote.className = 'intel-muted';
        windowNote.textContent = Date.now() >= expires ? '已到复查时间，系统将在下次调度自动检查；没有新消息不代表假设被否定。'
          : '下次自动复查：' + dateLabel(new Date(expires).toISOString()) + '；系统在每日限额内轮换搜索支持与反证。';
        item.append(windowNote);
      }
      if (hypothesis.status === 'dormant' && hypothesis.dormant_at) {
        var dormantNote = document.createElement('p');
        dormantNote.className = 'intel-muted';
        dormantNote.textContent = dateLabel(hypothesis.dormant_at) + ' 自动转入休眠：90 天内没有新的、日期可验证的支持或反证。停止主动搜索，保留原文和判断记录；不代表假设被否定。';
        item.append(dormantNote);
      }
      (hypothesis.assessments || []).forEach(function (assessment) {
        var detail = document.createElement('details');
        var summary = document.createElement('summary');
        var decisions = { applied: '已更新', unchanged: '状态未变', date_unverified: '发布日期不明确，未自动更新', not_newer: '证据日期未晚于已有判断，未自动更新', stale_state: '期间已有其他判断，未覆盖', terminal_state: '已结束跟踪，未自动重开', duplicate_evidence: '重复证据，未更新' };
        summary.textContent = dateLabel(assessment.created_at) + ' · ' + (decisions[assessment.decision_code] || '已记录')
          + ' · AI判断：' + (hypothesisLabels[assessment.recommendation] || '保持现状');
        var reason = document.createElement('p');
        reason.textContent = assessment.reason_zh;
        var link = document.createElement('a');
        link.href = '/intelligence/sources/' + encodeURIComponent(assessment.source_id);
        link.textContent = '查看判断来源及保存的原文';
        detail.append(summary, reason, link);
        (assessment.evidence_facts || []).forEach(function (fact) {
          var quote = document.createElement('blockquote');
          quote.textContent = fact.claim_zh + '；原文：“' + fact.evidence_quote + '”';
          detail.append(quote);
        });
        item.append(detail);
      });
      hypotheses.append(item);
    });
    byId('extraction-hypotheses-section').hidden = !hypotheses.children.length;
    byId('extraction-caution').textContent = extraction.caution_zh;
    byId('extraction-meta').textContent = (extraction.reused_from_source_id ? '正文未变，沿用已有分析 · ' : '')
      + '成熟度：' + extraction.maturity + ' · 模型：' + (source.extraction_provider || '未记录') + ' / ' + (source.extraction_model || '未记录') + ' · 生成时间：' + dateLabel(source.extracted_at);
  }
  function linkValue(id, value) {
    var container = byId(id);
    var url = webUrl(value);
    container.replaceChildren();
    if (!url) { container.textContent = '暂无'; return; }
    var link = document.createElement('a');
    link.textContent = url.href;
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
  }
  function renderSources(sources) {
    var list = byId('source-list');
    list.replaceChildren();
    sources.forEach(function (source) {
      var item = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'intel-source-row';
      var heading = document.createElement('h3');
      var link = document.createElement('a');
      link.textContent = annotationTitle(source);
      setSourceLink(link, source.id);
      heading.append(link);
      var badge = document.createElement('span');
      badge.className = 'intel-badge';
      sourceStatus(badge, source);
      row.append(heading, badge);
      var meta = document.createElement('p');
      meta.className = 'intel-source-meta';
      var url = webUrl(source.final_url || source.requested_url);
      meta.textContent = (url ? url.hostname + ' · ' : '') + '公布：' + publicationLabel(source) + ' · 获取：' + dateLabel(source.fetched_at);
      item.append(row, meta);
      var originalTitle = document.createElement('p');
      originalTitle.className = 'intel-source-original';
      originalTitle.textContent = '原文标题：' + (source.title || '未命名来源');
      item.append(originalTitle);
      var annotation = document.createElement('p');
      annotation.className = 'intel-source-annotation';
      annotation.textContent = source.annotation_zh ? '中文注释：' + source.annotation_zh : '中文注释：尚未填写。打开详情后补充这条来源与业务的关系。';
      item.append(annotation);
      if (source.excerpt) {
        var excerpt = document.createElement('p');
        excerpt.className = 'intel-source-excerpt';
        excerpt.textContent = '源文摘录：' + source.excerpt.slice(0, 220) + (source.excerpt.length > 220 ? '…' : '');
        item.append(excerpt);
      }
      list.append(item);
    });
    byId('empty-state').hidden = sources.length !== 0;
  }
  function renderDiscovery(sources) {
    var list = byId('discovery-results');
    list.replaceChildren();
    sources.forEach(function (source) {
      var item = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'intel-discovery-result-row';
      var link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title || new URL(source.url).hostname;
      var label = document.createElement('span');
      label.className = 'intel-source-level';
      label.textContent = source.source_level === 'primary' ? '官方/项目方一手来源' : '二手来源';
      var save = document.createElement('button');
      save.className = 'intel-button';
      save.type = 'button';
      save.dataset.sourceUrl = source.url;
      save.textContent = '保存此来源';
      var heading = document.createElement('div');
      heading.append(link, label);
      row.append(heading, save);
      item.append(row);
      if (source.excerpt) {
        var excerpt = document.createElement('p');
        excerpt.textContent = source.excerpt;
        item.append(excerpt);
      }
      list.append(item);
    });
  }
  function renderOverview(candidates) {
    var allCandidates = candidates.filter(function (item) { return item.disposition === 'candidate'; });
    var seen = new Set();
    var groupedCandidates = allCandidates.filter(function (candidate) {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      (candidate.related_sources || []).forEach(function (link) { seen.add(link.related_candidate_id); });
      return true;
    });
    var active = groupedCandidates.filter(function (item) { return item.review_status !== 'rejected'; });
    ['trigger', 'demand', 'project'].forEach(function (radar) {
      byId('radar-' + radar + '-count').textContent = active.filter(function (item) { return (item.radars || []).includes(radar); }).length;
    });
    byId('source-only-count').textContent = candidates.filter(function (item) { return item.disposition === 'source_only'; }).length;
    document.querySelectorAll('.intel-country-card').forEach(function (card) {
      var count = active.filter(function (item) { return (item.occurrence_countries || []).includes(card.dataset.country); }).length;
      card.querySelector('.intel-country-count').textContent = count;
      card.querySelector('.intel-country-state').textContent = count ? '有 ' + count + ' 条带来源和原文引文的候选。' : '尚未采集到有明确发生国证据的候选。';
      card.dataset.active = count ? 'true' : 'false';
    });
    var list = byId('candidate-list');
    list.replaceChildren();
    groupedCandidates.forEach(function (candidate) {
      var item = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'intel-source-row';
      var heading = document.createElement('h3');
      var link = document.createElement('a');
      link.textContent = candidate.title_zh;
      setSourceLink(link, candidate.source_id);
      heading.append(link);
      var badge = document.createElement('span');
      badge.className = 'intel-badge';
      badge.dataset.state = candidate.evidence_status;
      var evidenceBadgeNames = { unverified: '单一来源', sourced: '来源已绑定', checked: '部分事实已核对', conflict: '来源冲突', corrected: '已更正' };
      badge.textContent = evidenceBadgeNames[candidate.evidence_status] || candidate.evidence_status;
      row.append(heading, badge);
      var meta = document.createElement('p');
      meta.className = 'intel-source-meta';
      var radarNames = { trigger: '触发', demand: '需求', project: '项目' };
      var importanceNames = { low: '低', medium: '中', high: '高', critical: '重大' };
      var evidenceNames = { unverified: '单一来源，未交叉验证', sourced: '引文已绑定', checked: '部分事实已交叉核对', conflict: '有冲突', corrected: '已更正' };
      var maturityNames = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
      var countryNames = { SA: '沙特阿拉伯', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', OM: '阿曼', BH: '巴林' };
      meta.textContent = '雷达：' + (candidate.radars || []).map(function (value) { return radarNames[value] || value; }).join(' / ') +
        ' · 发生国：' + (candidate.occurrence_countries || []).map(function (value) { return countryNames[value] || value; }).join('、') + ' · 重要性：' + (importanceNames[candidate.importance] || candidate.importance) +
        ' · 证据：' + (evidenceNames[candidate.evidence_status] || candidate.evidence_status) + ' · 成熟度：' + (maturityNames[candidate.maturity] || candidate.maturity);
      var summary = document.createElement('p');
      summary.className = 'intel-source-annotation';
      summary.textContent = candidate.summary_zh;
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '来源公布：' + publicationLabel(candidate.source_timing) + ' · 系统获取：' + dateLabel(candidate.source_timing && candidate.source_timing.fetched_at);
      item.append(row, meta, timing, summary);
      var evidenceLink = document.createElement('a');
      evidenceLink.className = 'intel-evidence-link';
      evidenceLink.textContent = '查看来源与逐条引文 →';
      setSourceLink(evidenceLink, candidate.source_id);
      item.append(evidenceLink);
      (candidate.related_sources || []).forEach(function (related, index) {
        var relatedLink = document.createElement('a');
        relatedLink.className = 'intel-evidence-link';
        relatedLink.textContent = (related.relation === 'conflicts' ? '查看冲突来源 ' : '查看独立来源 ') + (index + 2) + ' →';
        setSourceLink(relatedLink, related.source_id);
        item.append(relatedLink);
      });
      list.append(item);
    });
    byId('candidate-empty').hidden = groupedCandidates.length !== 0;
  }
  function renderOperations(result) {
    byId('scheduler-state').textContent = result.scheduler_enabled ? '已开放；每次触发推进一项发现、抓取、提取或核对任务，未完成任务可跨天续跑' : '未启用；不会自动调用来源发现服务';
    var symbols = { CNY: '¥', USD: '$' };
    var budgetNames = { discovery: '来源发现', analysis: '情报分析' };
    var budgets = (result.budgets || []).filter(function (budget) { return budget.enabled; });
    byId('budget-state').textContent = budgets.length
      ? budgets.map(function (budget) {
        var symbol = symbols[budget.currency] || budget.currency + ' ';
        return (budgetNames[budget.capability] || budget.capability) + '：月度上限 ' + symbol + (Number(budget.limit_micro) / 1000000).toFixed(2)
          + (budget.billing_mode === 'included' ? ' · 已购套餐，不按次记金额' : ' · 官方余额累计减少 ' + symbol + (Number(budget.spent_micro) / 1000000).toFixed(2)
            + (budget.provider_balance_last_micro == null ? ' · 官方账户余额尚未读取' : ' · 官方账户余额 ' + symbol + (Number(budget.provider_balance_last_micro) / 1000000).toFixed(2))
            + (budget.provider_balance_synced_at ? '（最近同步 ' + new Date(budget.provider_balance_synced_at).toLocaleString('zh-CN') + '）' : '（等待首次余额同步）'))
          + ' · 已预留 ' + symbol + (Number(budget.reserved_micro) / 1000000).toFixed(2);
      }).join('；')
      : '未配置或未启用；所有付费调用保持暂停';
    var notificationCounts = (result.notifications || []).reduce(function (counts, item) {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});
    byId('notification-state').textContent = result.notifications?.length
      ? '最近记录：已接受 ' + (notificationCounts.accepted || 0) + '，待发/重试 ' + ((notificationCounts.pending || 0) + (notificationCounts.retry || 0)) + '，结果不明/失败 ' + ((notificationCounts.unknown || 0) + (notificationCounts.failed || 0))
      : '尚无待发记录；真实群机器人未配置时不会发送';
    var labels = { queued: '排队', running: '执行中', succeeded: '成功', partial: '部分成功', retry: '待重试', failed: '失败', budget_paused: '预算暂停', manual_paused: '人工暂停' };
    var countries = { SA: '沙特', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', OM: '阿曼', BH: '巴林' };
    var list = byId('job-list');
    list.replaceChildren();
    result.runs.forEach(function (run) {
      var item = document.createElement('li');
      var title = document.createElement('strong');
      title.textContent = run.schedule_key + ' · ' + (labels[run.status] || run.status);
      var detail = document.createElement('p');
      var children = result.items.filter(function (child) { return child.job_run_id === run.id; });
      detail.textContent = children.map(function (child) {
        var parts = child.item_key.split(':');
        var stage = parts[0] === 'discover' ? (countries[parts[1]] || '国家') + '来源发现'
          : ({ registry: '固定来源：' + (child.checkpoint?.name || parts[1]), source: '原文抓取', watchsource: '关注来源抓取', watchsearch: child.checkpoint?.intent === 'counter' ? '主动反证搜索' : '主动支持搜索', extract: '情报提取', cross: '跨来源核对', hypothesis: '假设与反证判断' }[parts[0]] || '采集任务');
        var errors = { discovery_balance_insufficient: '服务商返回余额不足，请核对密钥和套餐权限', discovery_plan_unavailable: '服务商返回套餐额度或权限不足，请核对搜索权限', discovery_no_primary_sources: '搜索完成，未找到符合要求的官方页面', discovery_failed: '来源发现暂未成功', source_failed: '原文获取失败', source_tls_error: '来源站点证书校验失败', source_dns_error: '来源域名暂时无法解析', source_access_denied: '来源站点拒绝自动访问', source_not_found: '原公告已下线或网址失效', source_rate_limited: '来源站点限流', source_timeout: '原文获取超时', source_empty_document: '页面没有可读取正文，未调用模型', extraction_invalid_known_facts: '未取得有原文支持的事实', extraction_invalid_known_fact_quote: '引文未通过原文校验', extraction_failed: '提取或证据校验失败', cross_check_failed: '跨来源核对失败', hypothesis_failed: '假设证据判断失败', watch_search_failed: '主动搜索暂未成功', lease_exhausted: '多次执行超时，已停止自动重试', budget_exhausted: '预算不足', billing_sync_pending: '等待账单同步' };
        Object.assign(errors, { registry_no_links: '未读到公告链接，可能需要页面适配；不算作没有新消息', registry_redirect_host: '入口跳转到其他站点，待核验', registry_failed: '固定来源读取或登记失败', source_unsupported_type: '文件格式暂不支持，待处理', source_unsupported_encoding: '来源编码暂不支持，待处理' });
        var registryResult = parts[0] === 'registry' && child.status === 'succeeded'
          ? '（发现新链接 ' + (child.checkpoint.fresh_count || 0) + ' 条，复查已有链接 ' + ((child.checkpoint.result_urls?.length || 0) - (child.checkpoint.fresh_count || 0)) + ' 条）' : '';
        return stage + ' ' + (labels[child.status] || child.status) + registryResult + (child.attempts ? '（尝试 ' + child.attempts + '）' : '') + (child.error_code ? '：' + (errors[child.error_code] || child.error_code) : '');
      }).join('；') || '任务明细尚未建立。';
      item.append(title, detail);
      var searches = children.filter(function (child) { return child.item_key.startsWith('watchsearch:'); });
      if (searches.length) {
        var searchDetails = document.createElement('details');
        var heading = document.createElement('summary');
        heading.textContent = '查看主动搜索对象、查询和结果';
        searchDetails.append(heading);
        searches.forEach(function (search) {
          var plan = search.checkpoint || {};
          var entry = document.createElement('p');
          entry.textContent = (plan.intent === 'counter' ? '反证' : '支持') + '：' + (plan.object_zh || '关注对象') + ' · ' + (labels[search.status] || search.status)
            + (plan.outcome === 'no_new_evidence' ? ' · 未找到符合要求的新来源，不代表假设被否定' : '')
            + (plan.outcome === 'watch_window_closed' ? ' · 关注已结束或到期待复查，未调用搜索服务' : '')
            + (plan.outcome === 'sources_found' ? ' · 已送去核验 ' + plan.result_urls.length + ' 条来源' : '');
          var query = document.createElement('blockquote');
          query.textContent = plan.query || '';
          var sourceLink = document.createElement('a');
          sourceLink.textContent = '查看原始假设';
          setSourceLink(sourceLink, plan.source_id);
          searchDetails.append(entry, query, sourceLink);
        });
        item.append(searchDetails);
      }
      list.append(item);
    });
    byId('job-empty').hidden = result.runs.length !== 0;
    status('automation-status', result.runs.length ? '最近 ' + result.runs.length + ' 个计划任务。失败、重试和预算暂停会在下方保留。' : '尚无自动扫描记录。');
  }
  function moneyInput(value) {
    if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) return '';
    return (Number(value) / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  function fillProviderForm(profile, writable) {
    var form = document.querySelector('.intel-provider-form[data-capability="' + profile.capability + '"]');
    if (!form) return;
    form.elements.provider.value = profile.provider || '';
    form.elements.endpoint.value = profile.endpoint || '';
    form.elements.model.value = profile.model || '';
    form.elements.currency.value = profile.currency || 'CNY';
    form.elements.billing_mode.value = profile.billing_mode || 'balance';
    form.elements.budget_limit.value = moneyInput(profile.budget_limit_micro);
    form.elements.api_key.value = '';
    var labels = { saved: '密钥已安全保存', environment: '当前使用服务器密钥', none: '密钥尚未配置' };
    var keyState = byId(profile.capability + '-key-state');
    keyState.textContent = labels[profile.key_source] || labels.none;
    keyState.dataset.state = profile.key_configured ? 'checked' : 'unverified';
    form.querySelector('button[type="submit"]').disabled = !writable;
  }
  async function loadProviderSettings() {
    try {
      var result = await api('provider-settings');
      result.profiles.forEach(function (profile) { fillProviderForm(profile, result.writable); });
      status('settings-page-status', result.writable ? '当前配置已读取。修改后保存，下一次调用立即生效。' : '当前环境禁止写入，配置仅供查看。', result.writable ? 'success' : '');
    } catch (error) { status('settings-page-status', error.message, 'error'); }
  }
  async function loadOverview() {
    status('page-status', '正在读取情报候选…');
    try {
      var results = await Promise.all([api('overview'), api('operations')]);
      var result = results[0];
      renderOverview(result.candidates);
      renderOperations(results[1]);
      var candidateIds = new Set();
      var visibleCount = result.candidates.filter(function (item) {
        if (item.disposition !== 'candidate' || candidateIds.has(item.id)) return false;
        candidateIds.add(item.id);
        (item.related_sources || []).forEach(function (link) { candidateIds.add(link.related_candidate_id); });
        return true;
      }).length;
      status('page-status', '候选 ' + visibleCount + ' 条；仅保留来源 ' + result.candidates.filter(function (item) { return item.disposition === 'source_only'; }).length + ' 条。');
    } catch (error) { status('page-status', error.message, 'error'); }
  }
  async function loadSources() {
    var button = byId('refresh-button');
    button.disabled = true;
    status('page-status', '正在读取来源…');
    try {
      var result = await api('sources');
      renderSources(result.sources);
      status('page-status', result.sources.length ? '共 ' + result.sources.length + ' 条来源' : '');
    } catch (error) { status('page-status', error.message, 'error'); }
    finally { button.disabled = false; }
  }
  function renderProjectTimeline(history) {
    var list = byId('project-timeline');
    if (!list) return;
    list.replaceChildren();
    var entries = history?.entries || [];
    byId('project-timeline-section').hidden = entries.length < 2;
    byId('project-identity').textContent = history?.identity_id ? '项目关联编号：' + history.identity_id
      + ' · 已关联 ' + history.total + ' 条来源' + (history.total > entries.length ? '（展示前 100 条）' : '') : '';
    entries.forEach(function (entry) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      setSourceLink(link, entry.source_id);
      link.textContent = (entry.publication_date || '公告日期未知') + ' · ' + entry.title_zh;
      var stage = document.createElement('p');
      stage.textContent = '该来源阶段：' + (entry.project?.stage_zh || '未披露')
        + (entry.procurement ? '；采购：' + entry.procurement.package_zh + ' · ' + entry.procurement.stage_zh : '');
      item.append(link, stage);
      [entry.project_evidence, entry.procurement_evidence].filter(Boolean).forEach(function (fact) {
        var quote = document.createElement('blockquote');
        quote.textContent = fact.claim_zh + '；原文：“' + fact.evidence_quote + '”';
        item.append(quote);
      });
      list.append(item);
    });
  }
  function renderAnalysisRevisions(revisions) {
    var maturityLabels = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
    var list = byId('analysis-revisions');
    if (!list) return;
    list.replaceChildren();
    revisions.forEach(function (revision) {
      var item = document.createElement('li');
      var details = document.createElement('details');
      var heading = document.createElement('summary');
      var extraction = revision.extraction_zh;
      heading.textContent = (revision.extracted_at ? dateLabel(revision.extracted_at) : '生成时间未记录')
        + ' · ' + (revision.provider || '未记录服务商') + ' / ' + (revision.model || '未记录模型')
        + ' · 阶段：' + (maturityLabels[extraction.maturity] || '未记录');
      var summary = document.createElement('p');
      summary.textContent = extraction.summary_zh || '';
      var hash = document.createElement('p');
      hash.className = 'intel-muted';
      hash.textContent = '对应原件 SHA-256：' + revision.source_sha256;
      details.append(heading, summary, hash);
      (extraction.known_facts || []).forEach(function (fact) {
        var quote = document.createElement('blockquote');
        quote.textContent = fact.claim_zh + '；原文：“' + fact.evidence_quote + '”';
        details.append(quote);
      });
      var inference = document.createElement('p');
      inference.textContent = '当时的假设：' + (extraction.hypotheses || []).map(function (h) { return h.hypothesis_zh; }).join('；');
      details.append(inference);
      item.append(details);
      list.append(item);
    });
    byId('analysis-revisions-section').hidden = !revisions.length;
  }
  function renderSourceHistory(versions, currentId) {
    var list = byId('source-history');
    list.replaceChildren();
    var maturityLabels = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
    versions.forEach(function (version, index) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      setSourceLink(link, version.id);
      link.textContent = '获取：' + dateLabel(version.fetched_at) + (version.id === currentId ? '（当前查看）' : ' · 查看此版本');
      var meta = document.createElement('p');
      meta.textContent = '公布：' + publicationLabel(version) + ' · 阶段分析：' + (maturityLabels[version.maturity] || '尚无可用分析')
        + (version.reused_from_source_id ? ' · 正文未变，沿用已有分析' : '');
      item.append(link, meta);
      var prior = versions[index + 1];
      if (prior && prior.maturity && version.maturity && prior.maturity !== version.maturity) {
        var change = document.createElement('p');
        change.textContent = '分析记录变化：' + maturityLabels[prior.maturity] + ' → ' + maturityLabels[version.maturity] + '。请结合下方原文核对项目和采购范围。';
        item.append(change);
      }
      [{ value: version.project, evidence: version.project_evidence, name: '项目', field: 'name_zh' },
        { value: version.procurement, evidence: version.procurement_evidence, name: '采购包', field: 'package_zh' }].forEach(function (entry) {
        if (!entry.value) return;
        var label = document.createElement('p');
        label.textContent = entry.name + '：' + entry.value[entry.field] + (entry.value.stage_zh ? ' · ' + entry.value.stage_zh : '');
        item.append(label);
        if (entry.evidence) {
          var quote = document.createElement('blockquote');
          quote.textContent = entry.evidence.claim_zh + '；原文：“' + entry.evidence.evidence_quote + '”';
          item.append(quote);
        }
      });
      list.append(item);
    });
    byId('source-history-section').hidden = !versions.length;
  }
  async function loadDetail(id) {
    try {
      var result = await api('source', undefined, id);
      var source = result.source;
      byId('source-title').textContent = source.title || '未命名来源';
      sourceStatus(byId('source-status'), source);
      linkValue('source-requested-url', source.requested_url);
      linkValue('source-final-url', source.final_url);
      byId('source-fetched-at').textContent = dateLabel(source.fetched_at);
      byId('source-published-at').textContent = publicationLabel(source);
      byId('source-publication-evidence').textContent = source.publication_evidence || '无可靠依据；不会用获取时间或模型猜测填充';
      byId('source-content-type').textContent = source.content_type || '暂无';
      byId('source-byte-size').textContent = typeof source.byte_size === 'number' ? source.byte_size.toLocaleString('zh-CN') + ' 字节' : '暂无';
      byId('source-sha256').textContent = source.content_sha256 || '暂无';
      byId('source-excerpt').textContent = source.excerpt || '暂无可展示的文本摘录。可在原件保存成功后下载查看。';
      byId('annotation-note').value = source.annotation_zh || '';
      byId('annotation-count').textContent = Array.from(byId('annotation-note').value).length + ' / 2000';
      byId('annotation-time').textContent = source.annotation_updated_at ? '更新于 ' + dateLabel(source.annotation_updated_at) : '尚未填写';
      renderExtraction(source, result.candidate);
      renderSourceHistory(result.history || [], id);
      renderAnalysisRevisions(result.revisions || []);
      renderProjectTimeline(result.project_history);
      if (source.error_code) {
        byId('source-error').hidden = false;
        status('source-error', '失败信息：' + source.error_code, 'error');
      }
      if (source.status === 'pending_extraction' && source.content_sha256) {
        var download = byId('evidence-download');
        download.href = '/api/intelligence?action=evidence&id=' + encodeURIComponent(id);
        download.hidden = false;
      }
      byId('source-detail').hidden = false;
      status('page-status', '');
    } catch (error) {
      byId('source-title').textContent = '来源未能读取';
      status('page-status', error.message, 'error');
    }
  }

  byId('themeBtn').addEventListener('click', function () { window.toggleTheme(); });
  var loginForm = byId('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = loginForm.querySelector('button[type="submit"]');
      button.disabled = true;
      status('login-status', '正在登录…');
      try {
        await api('login', { email: byId('email').value.trim(), password: byId('password').value });
        byId('password').value = '';
        location.replace(safeReturnTo(new URLSearchParams(location.search).get('returnTo')));
      } catch (error) { status('login-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
    return;
  }

  byId('logout-button').addEventListener('click', async function (event) {
    var button = event.currentTarget;
    button.disabled = true;
    try { await api('logout', {}); location.replace('/intelligence/login'); }
    catch (error) { status('page-status', error.message, 'error'); button.disabled = false; }
  });

  var importForm = byId('import-form');
  var discoveryForm = byId('discovery-form');
  var overviewList = byId('candidate-list');
  var providerForms = document.querySelectorAll('.intel-provider-form');
  providerForms.forEach(function (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var capability = form.dataset.capability;
      var button = form.querySelector('button[type="submit"]');
      var budgetLimitMicro = Math.round(Number(form.elements.budget_limit.value) * 1000000);
      var payload = {
        capability,
        provider: form.elements.provider.value.trim(),
        endpoint: form.elements.endpoint.value.trim(),
        model: form.elements.model.value.trim(),
        currency: form.elements.currency.value,
        billing_mode: form.elements.billing_mode.value,
        budget_limit_micro: budgetLimitMicro,
        api_key: form.elements.api_key.value,
      };
      button.disabled = true;
      status(capability + '-settings-status', '正在加密并保存配置…');
      try {
        var result = await api('save-provider-settings', payload);
        fillProviderForm(result.profile, true);
        status(capability + '-settings-status', '配置已保存，下一次调用将使用新配置。', 'success');
      } catch (error) { status(capability + '-settings-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
  });
  if (discoveryForm) {
    discoveryForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = discoveryForm.querySelector('button[type="submit"]');
      button.disabled = true;
      status('discovery-status', '来源发现服务正在搜索最新官方来源…');
      byId('discovery-results').replaceChildren();
      try {
        var result = await api('discover', { country: byId('discovery-country').value });
        renderDiscovery(result.sources);
        status('discovery-status', '找到 ' + result.sources.length + ' 条来源线索。选择需要保存的原始页面。', 'success');
      } catch (error) { status('discovery-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
    byId('discovery-results').addEventListener('click', async function (event) {
      var button = event.target.closest('button[data-source-url]');
      if (!button) return;
      button.disabled = true;
      button.textContent = '正在保存…';
      try {
        var result = await api('import', { url: button.dataset.sourceUrl });
        button.textContent = result.reused ? '已在来源库' : '已保存';
        await loadSources();
      } catch (error) {
        button.textContent = '保存失败';
        status('discovery-status', error.message, 'error');
        button.disabled = false;
      }
    });
  }
  if (importForm) {
    importForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var url = webUrl(byId('source-url').value.trim());
      if (!url || url.protocol !== 'https:' || url.port || url.username || url.password) {
        status('import-status', '请填写不含账号密码、使用默认 HTTPS 端口的来源网址。', 'error');
        return;
      }
      var button = importForm.querySelector('button[type="submit"]');
      button.disabled = true;
      byId('import-detail-link').hidden = true;
      status('import-status', '正在获取并保存来源，请稍候…');
      try {
        var result = await api('import', { url: url.href });
        var failed = result.source.status === 'fetch_failed' || result.source.status === 'evidence_failed';
        status('import-status', result.reused ? '已找到相同来源，复用已有记录。' : failed ? '已登记来源，但原件保存未完成。请查看详情中的失败信息。' : '来源已保存，等待后续信息提取。', failed ? 'error' : 'success');
        byId('import-detail-link').hidden = !setSourceLink(byId('import-detail-link'), result.source.id);
        await loadSources();
      } catch (error) {
        status('import-status', error.message, 'error');
        await loadSources();
      }
      finally { button.disabled = false; }
    });
    byId('refresh-button').addEventListener('click', loadSources);
  }
  var annotationForm = byId('annotation-form');
  if (annotationForm) {
    var annotationInput = byId('annotation-note');
    annotationInput.addEventListener('input', function () {
      byId('annotation-count').textContent = Array.from(annotationInput.value).length + ' / 2000';
    });
    annotationForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var match = location.pathname.match(detailPath);
      if (!match) return;
      var button = annotationForm.querySelector('button[type="submit"]');
      button.disabled = true;
      status('annotation-status', '正在保存中文注释…');
      try {
        var result = await api('annotate', { note: annotationInput.value }, match[1]);
        annotationInput.value = result.source.annotation_zh || '';
        byId('annotation-count').textContent = Array.from(annotationInput.value).length + ' / 2000';
        byId('annotation-time').textContent = result.source.annotation_updated_at ? '更新于 ' + dateLabel(result.source.annotation_updated_at) : '尚未填写';
        status('annotation-status', result.source.annotation_zh ? '中文注释已保存。' : '中文注释已清空。', 'success');
      } catch (error) { status('annotation-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
  }
  var extractButton = byId('extract-button');
  if (extractButton) {
    extractButton.addEventListener('click', async function () {
      var match = location.pathname.match(detailPath);
      if (!match) return;
      extractButton.disabled = true;
      status('extraction-status', '情报分析服务正在阅读原文并核对证据，请稍候…');
      try {
        var result = await api('extract', {}, match[1]);
        sourceStatus(byId('source-status'), result.source);
        renderExtraction(result.source, result.candidate);
        renderSourceHistory(result.history || [], match[1]);
        renderAnalysisRevisions(result.revisions || []);
      renderProjectTimeline(result.project_history);
      } catch (error) { status('extraction-status', error.message, 'error'); }
      finally { extractButton.disabled = false; }
    });
  }
  (async function () {
    try {
      var session = await api('session');
      byId('account-email').textContent = session.user.email;
      var match = location.pathname.match(detailPath);
      if (match) await loadDetail(match[1]);
      else if (importForm) await loadSources();
      else if (overviewList) await loadOverview();
      else if (providerForms.length) await loadProviderSettings();
    } catch (error) { status('page-status', error.message, 'error'); }
  })();
})();
