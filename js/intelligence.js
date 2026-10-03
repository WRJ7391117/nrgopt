(function () {
  'use strict';

  var regions = JSON.parse(byId('intelligence-regions').textContent);
  var topicNames = { ...regions.topics };
  var regionNames = Object.fromEntries(regions.countries.map(function (item) { return [item.code, item.name]; }));
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
    if (!value) return '未知（原文未提供可核验的发布时间）';
    var day = publicationDay(source), age = beijingToday() - day;
    if (!Number.isFinite(day)) return '日期无效，待核验';
    var label = source.published_at ? dateLabel(source.published_at) : dateLabel(value);
    return label + (age >= 30 ? ' · 历史公告（不在近30天内）' : age < 0 ? ' · 未来日期，待核验' : '');
  }
  function beijingToday() { return Math.floor((Date.now() + 8 * 3600000) / 86400000); }
  function publicationDay(source) {
    source = source || {};
    if (source.publication_method === 'conflicting_metadata') return NaN;
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(source.published_at || '')) {
      return Math.floor((Date.parse(source.published_at) + 8 * 3600000) / 86400000);
    }
    var value = source.publication_date || (source.published_at || '').slice(0, 10);
    var date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value) return NaN;
    return Math.floor(date / 86400000);
  }
  function publicationAge(source) {
    var age = beijingToday() - publicationDay(source);
    return !Number.isFinite(age) || age < 0 ? null : age;
  }
  function publicationSortDay(source) { return publicationAge(source) === null ? 0 : publicationDay(source); }
  function inPublicationPeriod(source, period) {
    var age = publicationAge(source);
    return period === 'all' || (period === 'unknown' ? age === null : age !== null && age < Number(period));
  }
  function status(id, message, tone) {
    var element = byId(id);
    element.textContent = message;
    element.dataset.tone = tone || '';
  }
  function safeReturnTo(value) {
    if (typeof value === 'string' && /^\/intelligence\/(overview|discover)\?/.test(value)) {
      var params = new URLSearchParams(value.slice(value.indexOf('?') + 1)), retained = new URLSearchParams();
      if (regions.countries.some(function (item) { return item.code === params.get('country'); })) retained.set('country', params.get('country'));
      if (Object.hasOwn(regions.groups, params.get('group') || '')) retained.set('group', params.get('group'));
      if (/^[a-z0-9-]{1,80}$/.test(params.get('topic') || '')) retained.set('topic', params.get('topic'));
      var view = params.get('view');
      if (!view && ['trigger', 'demand', 'project'].includes(params.get('radar'))) view = params.get('radar') === 'trigger' ? 'signal' : params.get('radar');
      if (['signal', 'demand', 'project', 'opportunity'].includes(view)) retained.set('view', view);
      if (['30', '90', 'all', 'unknown'].includes(params.get('period'))) retained.set('period', params.get('period'));
      return value.slice(0, value.indexOf('?')) + (retained.size ? '?' + retained : '');
    }
    return value === '/intelligence/engine' || value === '/intelligence/library' || value === '/intelligence/directions' || value === '/intelligence/topics' || value === '/intelligence/overview' || value === '/intelligence/discover' || value === '/intelligence/followups' || value === '/intelligence/sources' || value === '/intelligence/settings' || value === '/intelligence/workflow' || detailPath.test(value || '') ? value : '/intelligence/overview';
  }
  function loginLocation() {
    return '/intelligence/login?returnTo=' + encodeURIComponent(safeReturnTo(location.pathname + (['/intelligence/overview', '/intelligence/discover'].includes(location.pathname) ? location.search : '')));
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
    if (Number.isNaN(date.getTime())) return '未知';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value + '（仅日期，具体时刻未知）';
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value + '（时区未注明）';
    var parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    var fields = {};
    parts.forEach(function (part) { fields[part.type] = part.value; });
    return fields.year + '-' + fields.month + '-' + fields.day + ' ' + fields.hour + ':' + fields.minute + ':' + fields.second + '（北京时间 UTC+8）';
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
  function renderResilienceChain(element, signal, change, nextSignals) {
    var categoryLabels = { political_regulatory: '政治与监管', security_geopolitical: '安全与地缘',
      economic_industrial: '经济与产业', public_services: '民生与公共服务', climate_environment: '气候与环境',
      natural_hazard: '自然灾害', infrastructure: '基础设施', energy_market: '能源市场' };
    var steps = [
      ['区域变化', (categoryLabels[signal.category] ? categoryLabels[signal.category] + '：' : '') + change],
      ['受影响对象', (signal.affected_objects_zh || []).join('；')],
      ['能源影响机制', signal.energy_impact_mechanism_zh],
      ['韧性需求', (signal.resilience_needs_zh || []).join('；')],
      ['可能响应（待验证）', (signal.possible_responses_zh || []).join('；')],
      ['下一验证证据', (nextSignals || []).join('；')]
    ];
    element.replaceChildren();
    steps.forEach(function (step) {
      var item = document.createElement('li');
      var title = document.createElement('strong');
      var copy = document.createElement('p');
      title.textContent = step[0];
      copy.textContent = step[1] || '尚待确认';
      item.append(title, copy);
      element.append(item);
    });
  }
  function renderExtraction(source, candidate) {
    var extraction = source.extraction_zh;
    byId('detail-published-at').textContent = publicationLabel(source);
    byId('detail-fetched-at').textContent = dateLabel(source.fetched_at);
    byId('detail-analyzed-at').textContent = source.extracted_at ? dateLabel(source.extracted_at) : (extraction ? '未知（未记录分析时间）' : '尚未生成分析');
    var button = byId('extract-button');
    var languageNote = byId('source-language-note');
    button.textContent = extraction ? '重新生成初析' : '生成中文初析';
    if (languageNote) languageNote.textContent = extraction ? '中文情报已生成，引文保留来源原文语言' : '中文初析尚未生成';
    byId('extraction-content').hidden = !extraction;
    if (!extraction) {
      status('extraction-status', source.extraction_status === 'extraction_failed' ? '上次结果未通过证据校验，可重新生成。' : '尚未生成模型初析。');
      return;
    }
    status('extraction-status', '单一来源分析已生成；逐条引文已与保存的原文自动比对。', 'success');
    var age = publicationAge(source);
    var recencyNote = byId('extraction-recency');
    recencyNote.hidden = age !== null && age < 30;
    recencyNote.textContent = age === null ? '原文发布日期尚待核验，不能据采集时间判断为近期情报。以下为来源当时的分析。' : '历史资料 · 原文发布于 ' + (source.publication_date || source.published_at.slice(0, 10)) + '。以下阶段和参与方向反映当时披露，不能作为当前早期信号或仍开放的机会；需有近期证据重新确认。';
    byId('extraction-summary').textContent = extraction.summary_zh;
    byId('extraction-importance').textContent = extraction.why_it_matters_zh;
    byId('extraction-relevance').textContent = extraction.gcc_relevance_zh;
    var classification = extraction.classification;
    var radarLabels = { trigger: '早期信号', demand: '需求', project: '项目' };
    var countryLabels = regionNames;
    var importanceLabels = { low: '低', medium: '中', high: '高', critical: '重大' };
    var evidenceLabels = { unverified: '单一来源，未交叉验证', sourced: '引文已绑定', checked: '跨来源内容已比对', conflict: '有冲突', corrected: '已更正' };
    var maturityLabels = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
    var urgencyLabels = { none: '无即时行动', research: '待研究', prepare: '需准备', deadline: '截止临近' };
    byId('extraction-classification').hidden = !classification;
    if (classification) {
      var occurred = (classification.countries || []).filter(function (item) { return item.relation === 'occurrence'; }).map(function (item) { return countryLabels[item.code] || item.code; });
      var evidenceStatus = candidate?.evidence_status || classification.evidence_status;
      var relatedCount = candidate?.related_sources?.length || 0;
      var fields = byId('extraction-classification-summary');
      fields.replaceChildren();
      fields.hidden = classification.disposition !== 'candidate';
      var note = byId('extraction-classification-note');
      note.hidden = classification.disposition === 'candidate';
      note.textContent = '仅保留为背景资料：尚无足够证据进入早期信号、需求或项目分类。';
      if (classification.disposition === 'candidate') {
        [
          ['业务分类', (classification.radars || []).map(function (item) { return radarLabels[item] || item; }).join(' / ') || '未分类'],
          ['发生国家/地区', occurred.join('、') || '尚未明确'],
          ['受影响地区（关联判断）', (classification.countries || []).filter(function (item) { return item.relation === 'relevance'; }).map(function (item) { return countryLabels[item.code] || item.code; }).join('、') || '未单列'],
          ['跨境专题', (classification.topics || []).map(function (item) { return topicNames[item.code] || item.code; }).join('、') || '未单列'],
          ['重要性', importanceLabels[classification.importance]],
          ['证据状态', evidenceLabels[evidenceStatus] + (relatedCount ? '（另有 ' + relatedCount + ' 份关联原文）' : '')],
          ['成熟度', maturityLabels[extraction.maturity]],
          ['紧迫度', urgencyLabels[classification.urgency]]
        ].forEach(function (field) {
          var item = document.createElement('div');
          var label = document.createElement('dt');
          var value = document.createElement('dd');
          label.textContent = field[0];
          value.textContent = field[1];
          item.append(label, value);
          fields.append(item);
        });
      }
      byId('extraction-classification-evidence').hidden = !classification.project && !classification.procurement;
      var resilienceSection = byId('extraction-resilience-section');
      resilienceSection.hidden = !classification.resilience_signal;
      if (classification.resilience_signal) renderResilienceChain(byId('extraction-resilience-chain'), classification.resilience_signal,
        extraction.summary_zh, extraction.next_signals_zh);
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
    (extraction.known_facts || []).forEach(function (fact, index) {
      var item = document.createElement('li');
      item.id = 'fact-' + (index + 1);
      var claim = document.createElement('p');
      claim.textContent = fact.claim_zh;
      var quote = document.createElement('blockquote');
      quote.textContent = '原文证据：“' + fact.evidence_quote + '”';
      item.append(claim, quote);
      var statementNames = { disclosure: '发布方披露', report: '报道或转述', opinion: '观点或预测', unknown: '归属待核实' };
      paragraph(item, (statementNames[fact.statement_type] || '历史分析 · 尚未区分披露、报道与观点') + (fact.attribution_zh ? ' · ' + fact.attribution_zh : ''), 'intel-muted');
      facts.append(item);
    });
    var relatedList = byId('extraction-related-sources');
    relatedList.replaceChildren();
    (candidate?.related_sources || []).forEach(function (related) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.textContent = related.relation === 'conflicts' ? '查看冲突来源 →'
        : related.independence === 'same_publisher' ? '查看同一发布方更正 →' : '查看关联来源 →';
      setSourceLink(link, related.source_id);
      var note = document.createElement('p');
      note.textContent = related.independence === 'same_publisher'
        ? '这是同一发布方的更正、延期或取消后重新邀请；用于更新项目状态，不计为独立确认。'
        : related.shared_quote_count
          ? related.shared_quote_count + ' 组引文相同，可能同源；不能累计为独立确认。'
          : '来源独立性尚未确认；内容一致不等于独立确认。';
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '来源核对时间：' + dateLabel(related.checked_at);
      item.append(link, timing, note);
      ['matching_facts_zh', 'conflicting_facts_zh'].forEach(function (field) {
        (related[field] || []).forEach(function (pair) {
          var reason = document.createElement('p');
          reason.textContent = (field === 'matching_facts_zh' ? '一致' : '冲突') + '：本页事实 ' + pair.left_fact_number
            + ' / 关联页事实 ' + pair.right_fact_number + ' — ' + pair.reason_zh;
          item.append(reason);
        });
      });
      relatedList.append(item);
    });
    byId('related-sources-empty').textContent = candidate?.related_sources?.length ? '' : '尚无可展示的跨来源比对；当前仅能核对本页引文。';
    var basisLabels = { unspecified: '口径未明确', it_load: 'IT负荷', facility_load: '设施总负荷', pv_peak: '光伏峰值（DC）', pv_ac: '光伏交流侧（AC）', storage_power: '储能功率', nameplate_energy: '名义能量', usable_energy: '可用能量', project_investment: '项目总投资', contract_value: '本合同金额', financing: '融资金额', equipment_value: '设备金额' };
    var numericFacts = byId('extraction-numeric-facts');
    numericFacts.replaceChildren();
    (extraction.numeric_facts || []).forEach(function (number) {
      var item = document.createElement('li');
      var label = document.createElement('p');
      label.textContent = number.object_zh + ' · ' + number.field_zh + '：' + (number.qualifier_text ? number.qualifier_text + ' ' : '') + number.value_text + (number.scale_text ? ' ' + number.scale_text : '') + ' ' + (number.unit || '单位未披露') + ' · ' + (basisLabels[number.basis] || '口径未明确');
      var context = document.createElement('p');
      context.className = 'intel-muted';
      context.textContent = '原文口径：' + (number.basis_text || '未明确') + ' · 范围：' + (number.scope_text || '未明确') + ' · 阶段：' + (number.stage_text || '未明确') + ' · 有效日期：' + (number.effective_date_text || '未披露') +
        (number.currency || number.tax_text ? ' · 币种：' + (number.currency || '未明确') + ' · 税费：' + (number.tax_text || '未披露') : '');
      var quote = document.createElement('blockquote');
      quote.textContent = '原文披露：“' + number.raw_text + '”';
      var link = document.createElement('a');
      link.href = '#fact-' + number.evidence_fact_number;
      link.textContent = '查看事实 ' + number.evidence_fact_number + ' 的完整引文';
      item.append(label, context, quote, link);
      numericFacts.append(item);
    });
    byId('numeric-facts-empty').hidden = Boolean(extraction.numeric_facts?.length);
    byId('numeric-facts-empty').textContent = extraction.numeric_facts == null ? '这份历史分析尚未提取结构化数值，原始披露见上方事实与引文。' : '本次分析未列出关键数值；不代表容量或金额为零。';
    var scopeLabels = { project: '项目建设', development_rights: '开发权', ppa: '购电协议（PPA）', epc: '工程总承包（EPC）', construction_contract: '施工合同（未推定EPC范围）', equipment: '设备采购', service: '服务采购' };
    var eventStages = { planned: '计划中', open: '采购开放', shortlisted: '已入围', awarded: '已授标', signed: '已签约', construction: '建设中', delivered: '已交付', operating: '已投运', cancelled: '已取消' };
    var commercialEvents = byId('extraction-commercial-events');
    commercialEvents.replaceChildren();
    (extraction.commercial_events || []).forEach(function (event) {
      var item = document.createElement('li');
      var label = document.createElement('p');
      label.textContent = event.object_zh + ' · ' + scopeLabels[event.scope] + ' · ' + eventStages[event.stage];
      var quote = document.createElement('blockquote');
      quote.textContent = '类型依据：“' + event.scope_text + '”；阶段依据：“' + event.stage_text + '”。';
      var link = document.createElement('a');
      link.href = '#fact-' + event.evidence_fact_number;
      link.textContent = '查看事实 ' + event.evidence_fact_number + ' 的完整引文';
      item.append(label, quote, link);
      commercialEvents.append(item);
    });
    byId('commercial-events-note').textContent = extraction.commercial_events == null ? '这份历史分析尚未分别记录各项采购进展，请查看原文核实。' :
      extraction.commercial_events.some(function (event) { return event.scope === 'equipment'; }) ? '这里的设备采购进展仅适用于上方明确列出的采购事项，其他采购进展仍待核实。' : '设备采购进展待核实：本次分析未找到明确的设备采购披露。仅凭工程总承包或购电协议签约，无法判断设备是否已采购。';
    var contextIssues = extraction.context_issues || [];
    byId('fact-context-issues').hidden = !contextIssues.length;
    byId('fact-context-issues').textContent = contextIssues.length ? contextIssues.length + ' 项数值或采购信息未通过原文/口径校验，已排除出以上结构化结果，不能用于统计或判断：' + contextIssues.map(function (issue) {
      return issue.object_zh + (issue.evidence_fact_number ? '（见事实 ' + issue.evidence_fact_number + '）' : '（事实引用无效）');
    }).join('；') + '。基础事实与原文仍保留在上方。' : '';
    var hypotheses = byId('extraction-hypotheses');
    hypotheses.replaceChildren();
    var hypothesisLabels = { open: '待验证', strengthened: '证据增强', weakened: '证据减弱', confirmed: '已证实', rejected: '已否定', dormant: '休眠' };
    (tracking ? tracking.hypotheses : extraction.hypotheses || []).forEach(function (hypothesis) {
      var item = document.createElement('li');
      item.textContent = (hypothesis.status ? (hypothesisLabels[hypothesis.status] || hypothesis.status) + '：' : '')
        + (hypothesis.claim_zh || hypothesis.hypothesis_zh) + (hypothesis.counter_evidence_zh ? '；反证方向：' + hypothesis.counter_evidence_zh : '');
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '判断形成：' + dateLabel(hypothesis.created_at) + ' · 最近复查：' + (hypothesis.last_reviewed_at ? dateLabel(hypothesis.last_reviewed_at) : '尚无记录');
      item.append(timing);
      if (hypothesis.current_in_analysis === false) {
        var historyNote = document.createElement('p');
        historyNote.className = 'intel-muted';
        historyNote.textContent = hypothesis.status === 'rejected'
          ? '历史假设：本来源的最新分析未重申此命题；后续新证据已将其否定，判断记录保留如下。'
          : hypothesis.status === 'confirmed'
            ? '历史假设：本来源的最新分析未重申此命题；后续新证据已将其证实，判断记录保留如下。'
            : '历史假设：本来源的最新分析未重申此命题，已停止主动验证。原状态与判断记录保留；不表示命题已被否定。';
        item.append(historyNote);
      }
      if (hypothesis.current_in_analysis !== false && hypothesis.created_at && ['open', 'strengthened', 'weakened'].includes(hypothesis.status)) {
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
      meta.textContent = (url ? url.hostname + ' · ' : '') + '原文发布：' + publicationLabel(source) + ' · 系统采集：' + dateLabel(source.fetched_at) + ' · 分析更新：' + (source.extracted_at ? dateLabel(source.extracted_at) : '尚无记录');
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
      label.textContent = '搜索线索 · 原文及发布者待核验';
      var save = document.createElement('button');
      save.className = 'intel-button';
      save.type = 'button';
      save.dataset.sourceUrl = source.url;
      save.textContent = '保存这篇原文';
      var heading = document.createElement('div');
      heading.append(link, label);
      var channel = document.createElement('a'); channel.className='intel-button'; channel.textContent='添加此渠道'; channel.href='/intelligence/library?channel='+encodeURIComponent(new URL(source.url).origin+'/');
      row.append(heading, save, channel);
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '原文发布时间：待核验' + (source.published_text ? ' · 搜索结果标注：' + source.published_text + '（保存原文后核验）' : '（保存原文后核验）');
      item.append(row, timing);
      if (source.excerpt) {
        var excerpt = document.createElement('p');
        excerpt.textContent = source.excerpt;
        item.append(excerpt);
      }
      list.append(item);
    });
  }
  var navigationPath = location.pathname;
  var navigationTarget = navigationPath === '/intelligence/overview' && !location.search || navigationPath === '/intelligence' ? '/intelligence/overview'
    : navigationPath === '/intelligence/engine' || navigationPath === '/intelligence/followups' || navigationPath === '/intelligence/directions' ? navigationPath
      : navigationPath === '/intelligence/discover' || navigationPath === '/intelligence/topics' || navigationPath === '/intelligence/overview' || /^\/intelligence\/sources\//.test(navigationPath) ? '/intelligence/discover' : '/intelligence/settings';
  document.querySelectorAll('.intel-nav a').forEach(function (link) { if (link.getAttribute('href') === navigationTarget) link.setAttribute('aria-current', 'page'); });
  function emptyWorkList(list, message) {
    var item = document.createElement('li'); item.className = 'intel-muted'; item.textContent = message; list.append(item);
  }
  function watchCard(watch, writable) {
    var item = document.createElement('li'), f = watch.followup;
    var heading = document.createElement('h3'), link = document.createElement('a');
    link.href = '/intelligence/sources/' + encodeURIComponent(watch.candidate.source_id) + '#followup-section';
    link.textContent = watch.candidate.title_zh; heading.append(link); item.append(heading);
    paragraph(item, '跟踪理由：' + f.reason, 'intel-watch-reason');
    if ((watch.changes || []).length) {
      paragraph(item, '最新证据判断：' + watch.changes[0].reason_zh);
      paragraph(item, '判断记录：' + dateLabel(watch.changes[0].created_at) + ' · 共 ' + watch.change_count + ' 条新判断，需核对原文', 'intel-source-meta');
    } else paragraph(item, '暂无新的支持、削弱或反证判断；不代表市场没有变化。', 'intel-muted');
    if (watch.source_timing?.error_code || watch.source_timing?.extraction_error_code) paragraph(item, '来源抓取或分析有失败，请核对采集状态；不能据此判断没有价值。', 'intel-caution');
    if (watch.candidate.evidence_status === 'conflict') paragraph(item, '存在原文冲突，请先核对适用范围与时间。', 'intel-caution');
    paragraph(item, '下一步：' + f.next_action, 'intel-watch-next');
    paragraph(item, '复核日期：' + f.review_on + '（北京时间） · 优先级：' + (priorityLabels[f.priority] || f.priority) + ' · 原文发布：' + publicationLabel(watch.source_timing), 'intel-source-meta');
    if (f.outcome) paragraph(item, '上次记录的实际结果：' + f.outcome);
    if (watch.status !== 'active') paragraph(item, '暂缓 / 退出原因：' + f.exit_reason);
    var action = document.createElement('a'); action.className = 'intel-evidence-link'; action.href = link.href; action.textContent = '复核证据、记录结果或调整计划 →'; item.append(action);
    if (writable !== undefined) appendWatchActions(item, watch, writable);
    return item;
  }
  function appendWatchActions(item, watch, writable) {
    var actions = document.createElement('div'); actions.className = 'intel-watch-actions';
    var form = document.createElement('form'); form.className = 'intel-watch-confirm'; form.hidden = true;
    var heading = document.createElement('h4'), description = document.createElement('p'); description.className = 'intel-muted';
    var label = document.createElement('label'), reasonLabel = document.createElement('span'), reason = document.createElement('textarea');
    reason.required = true; reason.maxLength = 600; reason.rows = 2; label.append(reasonLabel, reason);
    var controls = document.createElement('div'); controls.className = 'intel-watch-actions';
    var confirm = document.createElement('button'); confirm.type = 'submit'; confirm.className = 'intel-button intel-button-primary';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'intel-button'; cancel.textContent = '取消';
    var feedback = document.createElement('p'); feedback.className = 'intel-status'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    controls.append(confirm, cancel); form.append(heading, description, label, controls, feedback); item.append(actions, form);
    var target, pending = false;
    var labels = { active: ['恢复跟踪', '恢复原因', '确认恢复', '已恢复跟踪'], expired: ['暂缓跟踪', '暂缓原因', '确认暂缓', '已暂缓跟踪'], completed: ['退出跟踪', '退出原因', '确认退出', '已退出跟踪'] };
    var destinations = watch.status === 'active' ? ['expired', 'completed'] : watch.status === 'expired' ? ['active', 'completed'] : ['active'];
    destinations.forEach(function (state) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'intel-button'; button.textContent = labels[state][0]; button.disabled = !writable;
      button.addEventListener('click', function () {
        target = state; heading.textContent = labels[state][0]; reasonLabel.textContent = labels[state][1]; confirm.textContent = labels[state][2];
        description.textContent = state === 'active' ? '恢复后回到“正在跟踪”，原计划和复核日期保留。'
          : state === 'expired' ? '暂时移出“正在跟踪”，可在“暂不关注 / 暂缓”中恢复。原计划、原文和历史记录都会保留。'
            : '结束当前跟踪，移至“已退出”，以后仍可恢复。原计划、原文和历史记录都会保留。';
        reason.value = ''; feedback.textContent = ''; form.hidden = false; reason.focus();
      });
      actions.append(button);
    });
    cancel.addEventListener('click', function () { form.hidden = true; actions.querySelector('button').focus(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (pending) return;
      if (!reason.value.trim()) { feedback.textContent = '请填写原因后再确认。'; feedback.dataset.tone = 'error'; reason.focus(); return; }
      pending = true;
      item.querySelectorAll('button, textarea').forEach(function (field) { field.disabled = true; });
      confirm.textContent = '正在保存…'; feedback.textContent = '正在保存跟踪状态…'; feedback.dataset.tone = '';
      try {
        var saved = await api('save-followup', Object.assign({}, watch.followup, { revision: watch.revision, status: target, exit_reason: reason.value.trim() }), watch.candidate.source_id);
        item.replaceChildren();
        var title = document.createElement('h3'); title.textContent = watch.candidate.title_zh; item.append(title);
        paragraph(item, labels[saved.watch.status][3] + ' · ' + dateLabel(saved.watch.updated_at) + '。原计划和历史记录已保留。', 'intel-status').dataset.tone = 'success';
        var view = document.createElement('button'); view.type = 'button'; view.className = 'intel-button';
        view.textContent = '查看' + ({ active: '正在跟踪', expired: '暂缓事项', completed: '已退出事项' }[saved.watch.status]);
        view.addEventListener('click', function () { byId('followups-state').value = saved.watch.status; followupsOffset = 0; loadFollowups(); });
        item.append(view); item.classList.add('intel-watch-receipt'); item.setAttribute('role', 'status');
      } catch (error) {
        feedback.textContent = error.message + ' 本次填写的原因已保留；状态以保存结果为准，如网络中断请刷新核对。'; feedback.dataset.tone = 'error';
        item.querySelectorAll('button, textarea').forEach(function (field) { field.disabled = false; }); confirm.textContent = labels[target][2];
      } finally { pending = false; }
    });
  }
  function renderReviewPoints(list, analysis, candidate) {
    list.replaceChildren();
    var points = [];
    (candidate?.related_sources || []).filter(function (source) { return source.relation === 'conflicts'; }).forEach(function (source) {
      (source.conflicting_facts_zh || []).forEach(function (fact) {
        if (fact.reason_zh) points.push('原文分歧：' + fact.reason_zh);
      });
    });
    if (candidate?.evidence_status === 'conflict' && !points.length) points.push('原文存在冲突，具体差异未列出；请打开关联原文比对。');
    (analysis.unknowns_zh || []).forEach(function (point) { if (point && !points.includes(point)) points.push(point); });
    if (!points.length) points.push('当前分析未列出具体核实点；这不代表全部信息已证实。');
    points.forEach(function (point) { var li = document.createElement('li'); li.textContent = point; list.append(li); });
  }
  function reviewPointsSection(analysis, candidate) {
    var section = document.createElement('section'); section.className = 'intel-review-points';
    var heading = document.createElement('strong'); heading.textContent = '尚待核实的具体问题';
    var list = document.createElement('ul');
    renderReviewPoints(list, analysis, candidate);
    section.append(heading, list);
    return section;
  }
  function overviewDiscovery(candidate, compact) {
    var item=document.createElement('li'), heading=directionText(item,'h3','');
    var link=directionText(heading,'a',candidate.title_zh);setSourceLink(link,candidate.source_id);
    var labels={trigger:'早期信号',demand:'需求',project:'项目'};
    paragraph(item,(candidate.occurrence_countries||[]).map(function(c){return regionNames[c]||c;}).join('、')+' · '+(candidate.radars||[]).map(function(r){return labels[r]||r;}).join(' / '),'intel-source-meta');
    paragraph(item,candidate.summary_zh);
    paragraph(item,'与你的关注有关：'+(candidate.direction_names.length?candidate.direction_names.join('、')+'。':'尚无已核验的方向归属。')+(candidate.why_it_matters_zh||''),'intel-overview-impact');
    if(compact) {
      paragraph(item,'关键未知：'+(candidate.unknowns_zh[0]||'当前未列出具体核实点，不代表全部证实。'),'intel-muted');
      paragraph(item,'原文发布：'+publicationLabel(candidate.source_timing)+' · 首次收录：'+dateLabel(candidate.created_at),'intel-source-meta');
      var details=directionText(item,'details','');directionText(details,'summary','查看全部核实点与依据');details.append(reviewPointsSection(candidate,candidate));
    } else { item.append(reviewPointsSection(candidate,candidate));paragraph(item,'原文发布：'+publicationLabel(candidate.source_timing)+' · 首次收录：'+dateLabel(candidate.created_at),'intel-source-meta'); }
    var action=directionText(item,'a','查看证据与跟踪计划 →','intel-evidence-link');action.href=link.href;
    return item;
  }
  function overviewWatch(watch) {
    var item=document.createElement('li'), heading=directionText(item,'h3',''),link=directionText(heading,'a',watch.candidate.title_zh);
    link.href='/intelligence/sources/'+encodeURIComponent(watch.candidate.source_id)+'#followup-section';
    paragraph(item,watch.changes.length?'最新证据：'+watch.changes[0].reason_zh:'暂无新的证据判断；不代表市场没有变化。');
    if(watch.candidate.evidence_status==='conflict')paragraph(item,'原文存在冲突，需要核对。','intel-caution');
    paragraph(item,'下一步：'+watch.followup.next_action,'intel-overview-impact');
    paragraph(item,'复核日 '+watch.followup.review_on+' · '+(priorityLabels[watch.followup.priority]||'普通')+'优先级','intel-source-meta');
    return item;
  }
  var workbenchRenderedPeriod = '1';
  async function loadWorkbench() {
    var button=byId('workbench-refresh'),range=byId('workbench-range');button.disabled=true;range.disabled=true;
    status('page-status','正在核对情报、方向成果和运行记录…');
    try {
      var data=await api('workbench&period='+range.value);workbenchRenderedPeriod=String(data.period);
      byId('workbench-period').textContent='本期 '+data.from+'—'+data.day+' · 读取 '+dateLabel(data.captured_at);
      Object.keys(data.counts).forEach(function(key){byId('workbench-count-'+key).textContent=data.counts[key];});
      var run=data.runtime,failed=run.counts.failed||0,paused=(run.counts.budget_paused||0)+(run.counts.manual_paused||0);
      var alert=byId('workbench-alert');alert.hidden=!failed&&!paused&&!!run.run;
      alert.textContent=!run.run?'今天暂无搜集计划记录 · 查看当天任务 →':'今天 '+failed+' 项失败、'+paused+' 项暂停 · 查看当天任务 →';
      var highlights=byId('workbench-highlights');highlights.replaceChildren();
      data.highlights.forEach(function(candidate){highlights.append(overviewDiscovery(candidate,true));});
      if(!data.highlights.length)emptyWorkList(highlights,'本期暂无未跟踪的新情报。');
      var fresh=byId('workbench-new');fresh.replaceChildren();data.new_items.forEach(function(c){fresh.append(overviewDiscovery(c,false));});
      if(!data.new_items.length)emptyWorkList(fresh,'本期暂无符合首次收录、原文日期与有效证据条件的新增情报。');
      byId('workbench-new-label').textContent='查看本期全部新增情报（'+data.counts.discoveries+'）';
      var directionList=byId('workbench-directions');directionList.replaceChildren();
      var coverage=byId('workbench-coverage');
      coverage.replaceChildren(document.createTextNode('已保存 '+data.directions.length+' 个方向 · 当前启用渠道 '+data.library.active+' / '+data.library.total+' · '));
      var libraryLink=directionText(coverage,'a','查看情报渠道库 →');libraryLink.href='/intelligence/library';
      data.directions.forEach(function(d){
        var row=directionText(directionList,'article','','intel-overview-direction');
        var title=directionText(row,'div','','intel-overview-direction-title'),link=directionText(title,'a',d.name);link.href='/intelligence/directions?direction='+encodeURIComponent(d.id);
        directionText(title,'small',(d.effective_on>data.day?d.effective_on+' 起生效': '已保存设置')+' · '+(d.enabled?'启用':'暂停'));
        var scope=directionText(row,'div','');directionText(scope,'small','关注范围');directionText(scope,'p',d.industries||'未设置行业');
        var details=directionText(scope,'details','');directionText(details,'summary',d.countries.length+' 个地区');directionText(details,'p',d.countries.map(function(c){return regionNames[c]||c;}).join('、'));
        var execution=directionText(row,'div','');directionText(execution,'small','本期定向搜索');
        directionText(execution,'p',d.task_count?'已完成 '+(d.status_counts.succeeded||0)+' / '+d.task_count+' 项':'尚无执行记录 / 未轮到');
        if(d.searched_countries.length)directionText(execution,'p','安排：'+d.searched_countries.map(function(c){return regionNames[c]||c;}).join('、'),'intel-muted');
        if(d.succeeded_countries.length)directionText(execution,'p','完成：'+d.succeeded_countries.map(function(c){return regionNames[c]||c;}).join('、'),'intel-muted');
        var result=directionText(row,'div','');directionText(result,'small','本期新增相关情报');directionText(result,'strong',String(d.new_count),'intel-overview-direction-count');
        if(d.latest){var latest=directionText(result,'a',d.latest.title);setSourceLink(latest,d.latest.source_id);directionText(result,'p','原文 '+publicationLabel(d.latest.source_timing),'intel-source-meta');}else directionText(result,'p','本期暂无有效新发现','intel-muted');
        var gap=directionText(row,'div','');directionText(gap,'small','仍待补齐');
        var outstanding=Object.keys(d.status_counts).filter(function(s){return s!=='succeeded';}).map(function(s){return (taskStates[s]||'状态未知')+' '+d.status_counts[s]+' 项';});
        if(d.unverified_links)outstanding.push(d.unverified_links+' 条关联记录待原文或相关性核验');
        directionText(gap,'p',outstanding.join('；')||(d.task_count?'搜索已执行，结果不等于完整覆盖':'等待实际执行记录'));
      });
      if(!data.directions.length)directionText(directionList,'p','尚未设置搜集方向。先明确关注什么，再查看对应搜集成果。','intel-muted');
      var distribution=byId('workbench-distribution');distribution.replaceChildren();
      byId('workbench-corpus-note').textContent='累计 '+data.distribution.total+' 条有效情报来源，包含历史资料。';
      [['trigger','早期信号'],['demand','需求'],['project','项目'],['procurement','采购机会来源']].forEach(function(pair){var a=directionText(distribution,'a','');a.href='/intelligence/discover?view='+(pair[0]==='procurement'?'opportunity':pair[0]==='trigger'?'signal':pair[0])+'&period=all';directionText(a,'strong',String(data.distribution[pair[0]]));directionText(a,'span',pair[1]);});
      var visibleDue=new Set(data.due.map(function(w){return w.candidate.id;}));
      [['due','当前没有到期或存在原文冲突的活跃跟踪。'],['updates','本期没有新的跟踪证据判断。'],['active','尚未建立跟踪计划，可从发现情报中选择值得跟进的事项。']].forEach(function(entry){
        var list=byId('workbench-'+entry[0]);list.replaceChildren();
        var items=entry[0]==='updates'?data.updates.filter(function(w){return !visibleDue.has(w.candidate.id);}):data[entry[0]];
        items.forEach(function(w){list.append(overviewWatch(w));});
        if(!items.length)emptyWorkList(list,entry[0]==='updates'&&data.updates.length?'更新事项已在“需要处理”列出。':entry[1]);
        else if(entry[0]==='updates'&&items.length<data.updates.length)directionText(list,'li',(data.updates.length-items.length)+' 项更新已在“需要处理”列出。','intel-muted');
        if(data[entry[0]+'_more']){var li=directionText(list,'li','');var a=directionText(li,'a','查看更多跟踪事项 →');a.href='/intelligence/followups';}
      });
      var states={running:'搜集进行中',queued:'等待执行',retry:'等待重试',partial:'已结束，部分失败或暂停',completed:'搜集已完成',succeeded:'搜集已完成',failed:'搜集失败',budget_paused:'预算暂停',manual_paused:'人工暂停'};
      byId('workbench-run-status').textContent=run.day+' · '+(run.run?(states[run.run.status]||'运行状态待核对'):'尚无计划记录');
      byId('workbench-run-counts').textContent=run.run?Object.keys(run.counts).map(function(s){return (taskStates[s]||'状态未知')+' '+run.counts[s];}).join(' · ')+'（任务数）':'暂无可统计的当天任务。';
      var failures=byId('workbench-failures');failures.replaceChildren();
      run.failures.forEach(function(f){var name=f.name;if(f.url){try{name=new URL(f.url).hostname;}catch{}}var reason=/tls/.test(f.error_code)?'来源连接验证失败':/empty/.test(f.error_code)?'未取得有效正文':/large/.test(f.error_code)?'原文超过抓取大小限制':/extraction/.test(f.error_code)?'原文分析未通过核验':'执行失败';directionText(failures,'li',name+'：'+reason);});
      if(failed>run.failures.length)directionText(failures,'li','其余失败与具体影响请查看当天任务详情。');
      byId('workbench-content').hidden=false;status('page-status','');
    } catch(error){range.value=workbenchRenderedPeriod;status('page-status',error.message+' 本次读取未完成，已有内容仍是上次快照，不能据此判断没有新情报。','error');}
    finally{button.disabled=false;range.disabled=false;}
  }
  if(byId('workbench-refresh')) {
    byId('workbench-refresh').addEventListener('click',loadWorkbench);
    byId('workbench-range').addEventListener('change',loadWorkbench);
    document.querySelectorAll('.intel-overview-metrics a').forEach(function(a){a.addEventListener('click',function(){var target=document.querySelector(a.getAttribute('href'));if(target.tagName==='DETAILS')target.open=true;});});
  }
  var overviewCandidates = [], overviewOpportunities = [], overviewLoaded = false;
  function renderOverviewHeading() {
    var filters = byId('candidate-filters'), period = filters.elements.period.value, view = filters.elements.view.value || 'overview';
    var prefix = period === 'all' ? '全部记录' : period === 'unknown' ? '日期待核验' : '近' + period + '天';
    var range;
    if (period === 'all') range = '原文发布时间不限，包含历史资料和日期待核验条目；不代表近期变化。';
    else if (period === 'unknown') range = '仅展示日期缺失、冲突、无效或未来日期的条目；核验前不计入近期情报。';
    else {
      var end = beijingToday(), start = end - Number(period) + 1;
      range = '原文发布日期：' + new Date(start * 86400000).toISOString().slice(0, 10) + ' 至 ' + new Date(end * 86400000).toISOString().slice(0, 10)
        + '（含今天，共' + period + '天；北京时间 UTC+8）。';
    }
    byId('overview-period').textContent = range;
    var viewCopy = {
      overview: ['全部变化', '浏览近期变化，按地区和原文日期缩小范围；打开详情核对证据，再决定是否跟踪。'],
      signal: ['早期信号', '查看区域变化如何传导到能源需求。'],
      demand: ['需求', '查看哪些业主或设施需要解决供能问题。'],
      project: ['项目', '查看有项目级原文证据的进展。'],
      opportunity: ['机会', '查看有原文依据的参与环节，并核对采购状态。']
    }[view];
    byId('overview-intro').textContent = viewCopy[1];
    byId('candidate-heading').textContent = prefix + ' · ' + viewCopy[0];
    var extraFiltersActive = Boolean(filters.elements.group.value || filters.elements.topic.value);
    byId('candidate-more-filters').querySelector('summary').textContent = extraFiltersActive ? '更多筛选 · 已选条件' : '更多筛选：地区分组、跨境专题';
    byId('candidate-reset').hidden = !extraFiltersActive && !filters.elements.country.value && view === 'overview' && period === '30';
    document.querySelectorAll('.intel-discover-views a').forEach(function (link) {
      var target = new URL(link.href, location.origin);
      target.searchParams.set('period', period);
      ['group', 'country', 'topic'].forEach(function (name) { var value = filters.elements[name].value; if (value) target.searchParams.set(name, value); else target.searchParams.delete(name); });
      link.href = target.pathname + target.search;
      if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  function renderOverview(candidates) {
    renderOverviewHeading();
    var filters = byId('candidate-filters');
    var period = filters.elements.period.value;
    var group = filters.elements.group.value, topic = filters.elements.topic.value, selectedCountry = filters.elements.country.value;
    function inGroup(item) { return (!selectedCountry || (item.occurrence_countries || []).includes(selectedCountry)) && (!group || (item.occurrence_countries || []).some(function (code) { return regions.countries.some(function (region) { return region.code === code && region.group === group; }); })); }
    var periodOpportunities = overviewOpportunities.filter(function (item) { return inPublicationPeriod(item.source_timing, period) && inGroup(item) && (!topic || (item.topic_codes || []).includes(topic)); });
    var periodCandidates = candidates.filter(function (item) { return inPublicationPeriod(item.source_timing, period) && inGroup(item) && (!topic || (item.topic_codes || []).includes(topic)); });
    var groupedCandidates = periodCandidates.filter(function (item) { return item.disposition === 'candidate'; });
    var active = groupedCandidates.filter(function (item) { return item.review_status !== 'rejected'; });
    ['trigger', 'demand', 'project'].forEach(function (radar) {
      byId('radar-' + radar + '-count').textContent = active.filter(function (item) { return (item.radars || []).includes(radar); }).length;
    });
    byId('candidate-total-count').textContent = active.length;
    byId('opportunity-count').textContent = periodOpportunities.length;
    var list = byId('candidate-list');
    list.replaceChildren();
    var country = filters.elements.country.value, view = filters.elements.view.value || 'overview';
    var radar = { signal: 'trigger', demand: 'demand', project: 'project' }[view];
    var filtered = active.filter(function (item) {
      return (!country || (item.occurrence_countries || []).includes(country)) && (!radar || (item.radars || []).includes(radar));
    });
    var visibleOpportunities = periodOpportunities.filter(function (item) { return !country || (item.occurrence_countries || []).includes(country); });
    byId('candidate-filter-status').textContent = view === 'opportunity' ? visibleOpportunities.length + ' 条机会' : filtered.length + ' 条情报';
    var importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort(function (left, right) {
      return publicationSortDay(right.source_timing) - publicationSortDay(left.source_timing)
        || (importanceOrder[left.importance] ?? 9) - (importanceOrder[right.importance] ?? 9)
        || Date.parse(right.updated_at || 0) - Date.parse(left.updated_at || 0);
    });
    var displayed = filtered;

    displayed.forEach(function (candidate) {
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
      var evidenceBadgeNames = { unverified: '已有原文依据', sourced: '已有原文依据', checked: '已比对多份原文', conflict: '原文有冲突', corrected: '已根据新原文更正' };
      badge.textContent = evidenceBadgeNames[candidate.evidence_status] || candidate.evidence_status;
      row.append(heading, badge);
      var meta = document.createElement('p');
      meta.className = 'intel-source-meta';
      var radarNames = { trigger: '早期信号', demand: '需求', project: '项目' };
      var importanceNames = { low: '低', medium: '中', high: '高', critical: '重大' };
      var maturityNames = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
      var countryNames = regionNames;
      meta.textContent = (candidate.occurrence_countries || []).map(function (value) { return countryNames[value] || value; }).join('、') +
        ' · ' + (candidate.radars || []).map(function (value) { return radarNames[value] || value; }).join(' / ') +
        ' · 重要性 ' + (importanceNames[candidate.importance] || candidate.importance) + ' · ' + (maturityNames[candidate.maturity] || candidate.maturity);
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '原文发布：' + publicationLabel(candidate.source_timing) + ' · 情报更新：' + dateLabel(candidate.updated_at);
      item.append(row, meta, timing);
      var summary = document.createElement('p');
      summary.className = 'intel-discover-summary';
      summary.textContent = candidate.summary_zh;
      item.append(summary);
      if (candidate.why_it_matters_zh) {
        var why = document.createElement('p');
        why.className = 'intel-discover-why';
        why.textContent = '为什么重要：' + candidate.why_it_matters_zh;
        item.append(why);
      }
      var evidenceLink = document.createElement('a');
      evidenceLink.className = 'intel-evidence-link';
      evidenceLink.textContent = '查看详情与原文证据 →';
      setSourceLink(evidenceLink, candidate.source_id);
      item.append(evidenceLink);
      var groupedSources = (candidate.grouped_sources || []).filter(function (source) {
        return source.source_id !== candidate.source_id && !(candidate.related_sources || []).some(function (related) { return related.source_id === source.source_id; });
      });
      if (groupedSources.length) {
        var grouped = document.createElement('details');
        grouped.className = 'intel-discover-related';
        var groupedSummary = document.createElement('summary');
        groupedSummary.textContent = '同范围其他原文 ' + groupedSources.length + ' 条';
        grouped.append(groupedSummary);
        groupedSources.forEach(function (source) {
          var groupedLink = document.createElement('a');
          groupedLink.textContent = '查看关联原文 →';
          setSourceLink(groupedLink, source.source_id);
          grouped.append(groupedLink);
        });
        item.append(grouped);
      }
      list.append(item);
    });
    var opportunityView = view === 'opportunity';
    list.hidden = opportunityView;
    byId('candidate-explainer').hidden = opportunityView;
    byId('candidate-explainer').textContent = period === 'unknown' ? '原文日期待核验，按重要性和情报更新时间排列。' : '按原文发布日期由近到远排列，同日优先展示重要变化。';
    byId('candidate-empty').hidden = opportunityView || filtered.length !== 0;
    byId('candidate-empty').textContent = country || radar ? '当前筛选没有匹配的情报；不代表当地没有市场变化。可调整筛选查看其他内容。'
      : '当前没有符合条件的情报。背景资料会保留在来源层，不会为填满页面自动创建项目或机会。';
    byId('opportunities-section').hidden = !opportunityView;
    renderOverviewOpportunities(periodOpportunities, country);
  }
  function renderOverviewOpportunities(opportunities, country) {
    var list = byId('overview-opportunities');
    list.replaceChildren();
    var scopes = { early: '早期机会', equipment: '设备采购', service: '服务采购' };
    var states = { unverified: '待验证，未披露采购开放', public_tender_open: '采购开放已披露，参与资格待核',
      package_awarded: '该包已授标或签约', cancelled: '该包已取消' };
    var visible = opportunities.filter(function (entry) { return !country || (entry.occurrence_countries || []).includes(country); });
    visible.sort(function (left, right) {
      return publicationSortDay(right.source_timing) - publicationSortDay(left.source_timing)
        || Date.parse(right.updated_at || 0) - Date.parse(left.updated_at || 0);
    });
    visible.forEach(function (entry) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      setSourceLink(link, entry.source_id);
      link.textContent = (scopes[entry.scope] || '采购事项') + '：' + entry.package_name_zh;
      var meta = document.createElement('p');
      meta.textContent = (entry.title_zh || '来源未命名') + ' · ' + (states[entry.participation_status] || states.unverified)
        + (entry.scope === 'early' ? ' · 关联待验证假设，详情见来源' : '');
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '原文发布：' + publicationLabel(entry.source_timing) + ' · 机会更新：' + dateLabel(entry.updated_at);
      item.append(link, meta, timing);
      list.append(item);
    });
    byId('overview-opportunities-empty').hidden = visible.length !== 0;
  }
  var workflowData, workflowPage = 0;
  var taskStates = { running: '执行中', queued: '排队', retry: '待重试', failed: '失败', budget_paused: '预算暂停', manual_paused: '人工暂停', succeeded: '成功' };
  var taskStages = { discover: '区域搜索', registry: '固定公告入口', watchsearch: '主动证据搜索', source: '原文抓取', watchsource: '关注来源抓取', extract: '情报分析', cross: '跨来源核对', hypothesis: '假设与反证判断' };
  var taskErrors = { source_tls_error: '来源站点证书校验失败', source_listing_page: '这是目录页，未作为正文分析', source_empty_document: '没有可读取的正文，未调用模型', source_failed: '原文获取失败', source_not_found: '原公告已下线或网址失效', source_access_denied: '来源拒绝自动访问', source_dns_error: '来源域名无法解析', source_timeout: '原文获取超时', source_rate_limited: '来源站点限流', discovery_no_primary_sources: '没有找到符合要求的官方页面', discovery_failed: '来源搜索失败', model_timeout: '模型请求超时', model_rate_limited: '模型服务限流', extraction_failed: '情报提取或证据校验失败', cross_check_failed: '跨来源核对失败', hypothesis_failed: '假设判断失败', watch_search_failed: '主动证据搜索失败', budget_exhausted: '调用预算不足', budget_not_configured: '尚未配置调用预算', billing_sync_pending: '等待账单同步', source_paused: '此发布方已暂停自动采集', lease_exhausted: '多次执行超时，已停止自动重试', registry_no_links: '没有读到公告链接，需要核查入口', upstream_unavailable: '数据服务暂时不可用', storage_failed: '原文保存失败' };
  function taskDescription(item) {
    var countries = regionNames;
    var stage = item.item_key.split(':')[0];
    return item.title || item.object_zh || item.name || (stage === 'discover' ? (countries[item.country || item.item_key.split(':')[1]] || '') + '公开来源搜索' : item.url || '来源资料处理');
  }
  function taskError(item) {
    if (!item.error_code) return '';
    return taskErrors[item.error_code] || (/^extraction_invalid/.test(item.error_code) ? '模型结果未通过结构或原文证据校验' : '处理未成功，诊断代码见下方');
  }
  function renderWorkflowTasks() {
    if (!workflowData) return;
    var form = byId('workflow-filters'), state = form.elements.state.value, stage = form.elements.stage.value, search = form.elements.search.value.trim().toLowerCase();
    var items = workflowData.items.filter(function (item) {
      return (!state || (state === 'unfinished' ? !['succeeded', 'failed'].includes(item.status) : item.status === state))
        && (!stage || item.item_key.split(':')[0] === stage)
        && (!search || [taskDescription(item), item.url, item.error_code, taskError(item)].join(' ').toLowerCase().includes(search));
    });
    var priority = { running: 0, retry: 1, budget_paused: 2, manual_paused: 3, failed: 4, queued: 5, succeeded: 6 };
    items.sort(function (a, b) { return (priority[a.status] ?? 7) - (priority[b.status] ?? 7) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id); });
    var pages = Math.max(1, Math.ceil(items.length / 25));
    workflowPage = Math.min(workflowPage, pages - 1);
    var list = byId('workflow-tasks'); list.replaceChildren();
    items.slice(workflowPage * 25, (workflowPage + 1) * 25).forEach(function (item) {
      var row = document.createElement('li'); row.dataset.state = item.status;
      var head = document.createElement('div'); head.className = 'intel-task-heading';
      var stage = document.createElement('strong'); stage.textContent = taskStages[item.item_key.split(':')[0]] || '采集任务';
      var badge = document.createElement('span'); badge.className = 'intel-badge'; badge.textContent = taskStates[item.status] || item.status;
      head.append(stage, badge);
      var title = document.createElement('p'); title.className = 'intel-task-title'; title.textContent = taskDescription(item);
      var timing = document.createElement('p'); timing.className = 'intel-muted'; timing.textContent = '已尝试 ' + item.attempts + ' 次 · 更新于 ' + dateLabel(item.updated_at);
      row.append(head, title, timing);
      if (item.status === 'retry' && item.next_attempt_at) {
        var retry = document.createElement('p'); retry.className = 'intel-muted'; retry.textContent = '最早再次尝试：' + dateLabel(item.next_attempt_at) + '（仍受暂停与其他在途任务影响）'; row.append(retry);
      }
      if (item.error_code) {
        var error = document.createElement('p'); error.className = 'intel-task-error'; error.textContent = taskError(item) + ' · ' + item.error_code; row.append(error);
      }
      if (item.outcome) {
        var outcomes = { no_new_evidence: '搜索已完成，未找到符合要求的新来源，不代表假设被否定。', watch_window_closed: '关注窗口已结束，未调用搜索服务。', sources_found: '已找到来源并送入后续核验。' };
        if (outcomes[item.outcome]) { var outcome = document.createElement('p'); outcome.textContent = outcomes[item.outcome]; row.append(outcome); }
      }
      if (item.source_id && new RegExp('^' + uuid + '$', 'i').test(item.source_id)) {
        var link = document.createElement('a'); setSourceLink(link, item.source_id); link.textContent = '查看来源与证据'; row.append(link);
      } else if (item.url) {
        try {
          var url = new URL(item.url);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            var external = document.createElement('a'); external.href = url.href; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.textContent = '原文：' + url.hostname + url.pathname; row.append(external);
          }
        } catch { /* Invalid task URLs remain plain text. */ }
      }
      list.append(row);
    });
    byId('workflow-list-status').textContent = items.length ? '符合筛选 ' + items.length + ' 项 · 每页 25 项；执行中与需关注的任务优先。' : workflowData.run ? '没有符合当前筛选的任务。' : '今天尚无计划任务记录；这不表示当天已经完成。';
    byId('workflow-page').textContent = (workflowPage + 1) + ' / ' + pages;
    byId('workflow-prev').disabled = workflowPage === 0;
    byId('workflow-next').disabled = workflowPage + 1 >= pages;
  }
  async function loadWorkflow() {
    var button = byId('workflow-refresh'); button.disabled = true;
    status('page-status', workflowData ? '正在刷新，下面暂为上次读取的记录…' : '正在读取当天任务…');
    try {
      var data = await api('workflow'); workflowData = data;
      byId('account-email').textContent = data.user.email;
      document.querySelector('.intel-nav a[href="/intelligence/settings"]').setAttribute('aria-current', 'page');
      byId('workflow-date').textContent = data.day;
      var counts = data.items.reduce(function (all, item) { all[item.status] = (all[item.status] || 0) + 1; return all; }, {});
      var unfinished = data.items.some(function (item) { return !['succeeded', 'failed'].includes(item.status); });
      var ended = data.run && ['succeeded', 'partial', 'failed'].includes(data.run.status) && data.items.length > 0 && !unfinished && !data.changed_during_read;
      var summary = !data.run ? '尚未建立当天计划' : data.changed_during_read ? '任务在读取期间有变化，请刷新核对' : ended
        ? counts.failed ? (counts.succeeded ? '已结束 · 有失败' : '已结束 · 全部失败') : '已结束 · 全部成功'
        : ['budget_paused', 'manual_paused'].includes(data.run.status) ? (taskStates[data.run.status] + ' · 尚未完成') : '尚未结束';
      byId('workflow-summary').textContent = summary;
      byId('workflow-time').textContent = '读取时间：' + dateLabel(data.read_at) + (data.run ? ' · 计划建立：' + dateLabel(data.run.created_at) : '')
        + (ended && data.run.finished_at ? ' · 结束时间：' + dateLabel(data.run.finished_at) : '');
      var boxes = byId('workflow-counts'); boxes.replaceChildren();
      [['全部任务', data.items.length]].concat(Object.keys(taskStates).map(function (key) { return [taskStates[key], counts[key] || 0]; })).filter(function (pair, index) { return index === 0 || pair[1] > 0; }).forEach(function (pair) {
        var box = document.createElement('div'), number = document.createElement('strong'), label = document.createElement('span');
        number.textContent = pair[1]; label.textContent = pair[0]; box.append(number, label); boxes.append(box);
      });
      renderWorkflowTasks();
      status('page-status', data.changed_during_read ? '运行仍在变化，此次记录不用于判定完成。' : '');
    } catch (error) { status('page-status', error.message + (workflowData ? ' 下方保留上次记录，未更新为最新状态。' : ' 请点击刷新重试。'), 'error'); }
    finally { button.disabled = false; }
  }
  if (byId('workflow-tasks')) {
    byId('workflow-refresh').addEventListener('click', loadWorkflow);
    byId('workflow-filters').addEventListener('submit', function (event) { event.preventDefault(); });
    byId('workflow-filters').addEventListener('input', function () { workflowPage = 0; renderWorkflowTasks(); });
    byId('workflow-prev').addEventListener('click', function () { workflowPage--; renderWorkflowTasks(); });
    byId('workflow-next').addEventListener('click', function () { workflowPage++; renderWorkflowTasks(); });
  }

  function renderOperations(result) {
    byId('scheduler-state').textContent = result.scheduler_enabled ? '本站已开启定时搜集；实际进度以当天任务为准。' : '本站不直接执行定时搜集；实际进度以当天任务为准。';
    var countryNames = regionNames;
    var fixedCountries = result.fixed_source_countries || [];
    var missingCountries = Object.keys(countryNames).filter(function (code) { return !fixedCountries.includes(code); });
    byId('fixed-source-coverage').textContent = '已登记固定公告入口：' + (fixedCountries.map(function (code) { return countryNames[code]; }).filter(Boolean).join('、') || '暂无')
      + '。' + (missingCountries.length ? missingCountries.map(function (code) { return countryNames[code]; }).join('、') + '暂无固定入口；未接入地区不自动安排搜索；' : '已登记范围均有固定入口；')
      + '入口实际抓取结果以任务记录为准。';
    var archiveStates = { disabled: '尚未开启自动同步；已保存的原文仍保留在云端。',
      missing_token: '缺少 Mac 归档凭据，暂时无法同步；已保存的原文仍在云端。', read_only: '当前网站只读，无法处理 Mac 归档；已保存的原文仍在云端。',
      enabled: '已允许 Mac 同步原文；每篇是否成功存到本地，需查看归档记录。' };
    byId('archive-state').textContent = archiveStates[result.archive_status] || 'Mac 归档状态暂时无法确认。';
    var symbols = { CNY: '¥', USD: '$' };
    var budgetNames = { discovery: '来源发现', analysis: '情报分析' };
    var budgets = (result.budgets || []).filter(function (budget) { return budget.enabled; });
    byId('budget-state').textContent = budgets.length
      ? budgets.map(function (budget) {
        var symbol = symbols[budget.currency] || budget.currency + ' ';
        return (budgetNames[budget.capability] || budget.capability) + '：月度上限 ' + symbol + (Number(budget.limit_micro) / 1000000).toFixed(2)
          + (budget.billing_mode === 'included' ? ' · 已购套餐，不按次记金额' : ' · 官方余额累计减少 ' + symbol + (Number(budget.spent_micro) / 1000000).toFixed(2)
            + (budget.provider_balance_last_micro == null ? ' · 官方账户余额尚未读取' : ' · 官方账户余额 ' + symbol + (Number(budget.provider_balance_last_micro) / 1000000).toFixed(2))
            + (budget.provider_balance_synced_at ? '（最近同步 ' + dateLabel(budget.provider_balance_synced_at) + '）' : '（等待首次余额同步）'))
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
    var countries = regionNames;
    var list = byId('job-list');
    list.replaceChildren();
    result.runs.forEach(function (run) {
      var item = document.createElement('li');
      var title = document.createElement('strong');
      title.textContent = run.schedule_key + ' · ' + (labels[run.status] || run.status);
      var detail = document.createElement('p');
      var children = result.items.filter(function (child) { return child.job_run_id === run.id; });
      var childCounts = children.reduce(function (counts, child) {
        counts[child.status] = (counts[child.status] || 0) + 1;
        return counts;
      }, {});
      var runSummary = document.createElement('p');
      runSummary.textContent = children.length + ' 项任务：成功 ' + (childCounts.succeeded || 0) + '，执行中/排队 ' + ((childCounts.running || 0) + (childCounts.queued || 0))
        + '，待重试 ' + (childCounts.retry || 0) + '，失败 ' + (childCounts.failed || 0) + '。';
      detail.textContent = children.map(function (child) {
        var parts = child.item_key.split(':');
        var stage = parts[0] === 'discover' ? (countries[parts[1]] || '国家') + '来源发现'
          : ({ registry: '固定来源：' + (child.checkpoint?.name || parts[1]), source: '原文抓取', watchsource: '关注来源抓取', watchsearch: child.checkpoint?.intent === 'counter' ? '主动反证搜索' : '主动支持搜索', extract: '情报提取', cross: '跨来源核对', hypothesis: '假设与反证判断' }[parts[0]] || '采集任务');
        var errors = { discovery_balance_insufficient: '服务商返回余额不足，请核对密钥和套餐权限', discovery_plan_unavailable: '服务商返回套餐额度或权限不足，请核对搜索权限', discovery_no_primary_sources: '搜索完成，未找到符合要求的官方页面', discovery_failed: '来源发现暂未成功', source_failed: '原文获取失败', storage_constraint: '原文已获取，但数据保存约束未通过', storage_failed: '原文保存失败', upstream_unavailable: '数据库或证据存储暂时不可用', source_tls_error: '来源站点证书校验失败', source_dns_error: '来源域名暂时无法解析', source_access_denied: '来源站点拒绝自动访问', source_not_found: '原公告已下线或网址失效', source_rate_limited: '来源站点限流', source_timeout: '原文获取超时', source_empty_document: '页面没有可读取正文，未调用模型', extraction_invalid_known_facts: '未取得有原文支持的事实', extraction_invalid_known_fact_quote: '引文未通过原文校验', extraction_failed: '提取或证据校验失败', cross_check_failed: '跨来源核对失败', hypothesis_failed: '假设证据判断失败', watch_search_failed: '主动搜索暂未成功', lease_exhausted: '多次执行超时，已停止自动重试', budget_exhausted: '预算不足', billing_sync_pending: '等待账单同步' };
        Object.assign(errors, { source_paused: '此发布方的自动抓取已暂停，覆盖不完整', registry_no_links: '未读到公告链接，可能需要页面适配；不算作没有新消息', registry_redirect_host: '入口跳转到其他站点，待核验', registry_failed: '固定来源读取或登记失败', source_unsupported_type: '文件格式暂不支持，待处理', source_unsupported_encoding: '来源编码暂不支持，待处理' });
        var registryResult = parts[0] === 'registry' && child.status === 'succeeded'
          ? '（发现新链接 ' + (child.checkpoint.fresh_count || 0) + ' 条，复查已有链接 ' + ((child.checkpoint.result_urls?.length || 0) - (child.checkpoint.fresh_count || 0)) + ' 条'
            + (child.checkpoint.pending_count ? '，仍待补收 ' + child.checkpoint.pending_count + ' 条' : '') + '）' : '';
        return stage + ' ' + (labels[child.status] || child.status) + registryResult + (child.attempts ? '（尝试 ' + child.attempts + '）' : '') + (child.error_code ? '：' + (errors[child.error_code] || child.error_code) : '');
      }).join('；') || '任务明细尚未建立。';
      var itemDetails = document.createElement('details');
      var itemSummary = document.createElement('summary');
      itemSummary.textContent = '查看任务明细';
      itemDetails.append(itemSummary, detail);
      item.append(title, runSummary, itemDetails);
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
        itemDetails.append(searchDetails);
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
  async function loadProviderHistory() {
    try {
      var result = await api('provider-history');
      var versions = byId('provider-versions'), calls = byId('provider-calls');
      versions.replaceChildren(); calls.replaceChildren();
      result.versions.forEach(function (version) {
        var li = document.createElement('li');
        li.textContent = dateLabel(version.created_at) + ' · ' + (version.capability === 'discovery' ? '来源发现' : '情报分析') +
          ' · ' + version.provider + ' / ' + version.model + ' · 月上限 ' + version.currency + ' ' + moneyInput(version.budget_limit_micro) +
          ' · ' + (version.billing_mode === 'included' ? '已购套餐' : '官方余额对账') + ' · 版本 ' + version.id + (version.key_changed ? ' · 密钥有更新（不展示）' : '');
        versions.append(li);
      });
      result.calls.forEach(function (call) {
        var li = document.createElement('li');
        var states = { started: '已开始，尚无完成回执', succeeded: '调用成功', failed: '调用失败' };
        var operations = { discovery: '来源发现', extraction: '原文分析', cross_check: '证据核对' };
        li.textContent = dateLabel(call.call_started_at) + ' · ' + operations[call.operation] +
          ' · ' + call.provider + ' / ' + call.model + ' · ' + states[call.call_status] + ' · 版本 ' + call.config_version_id +
          (call.usage ? ' · 服务商返回的 token 用量：' + JSON.stringify(call.usage) : ' · 服务商未返回 token 用量') +
          (call.call_error_code ? ' · 错误：' + call.call_error_code : '');
        calls.append(li);
      });
      status('provider-history-status', result.calls.length ? '调用记录已读取。' : '尚无带配置版本的调用记录。');
    } catch (error) { status('provider-history-status', error.message, 'error'); }
  }
  async function loadProviderSettings() {
    loadProviderHistory();
    try {
      var result = await api('provider-settings');
      result.profiles.forEach(function (profile) { fillProviderForm(profile, result.writable); });
      status('settings-page-status', result.writable ? '当前配置已读取。修改后保存，下一次调用立即生效。' : '当前环境禁止写入，配置仅供查看。', result.writable ? 'success' : '');
    } catch (error) { status('settings-page-status', error.message, 'error'); }
  }
  function updateNotificationSummary() {
    var fields = byId('notification-settings-form').elements;
    var start = Number(fields.quiet_start_hour.value), end = Number(fields.quiet_end_hour.value);
    fields.quiet_end_hour.setCustomValidity(start === end ? '请选择与暂停时间不同的恢复时间。' : '');
    var summary = !fields.quiet_enabled.checked ? '免打扰已关闭，通知不受此时段限制。' : start === end ? '暂停和恢复时间不能相同，请调整时间。' :
      '按' + fields.timezone.options[fields.timezone.selectedIndex].text + '，每天 ' + String(start).padStart(2, '0') + ':00 暂停通知，' +
      (start > end ? '次日 ' : '当天 ') + String(end).padStart(2, '0') + ':00 起恢复，积压消息随后陆续发送。' +
      (fields.flash_breaks_quiet.checked ? '重大提醒仍可发送。' : '重大提醒也会延后。');
    byId('notification-schedule-summary').textContent = '当前选择：' + summary;
  }
  function fillNotificationForm(settings) {
    var form = byId('notification-settings-form');
    ['quiet_enabled', 'flash_breaks_quiet'].forEach(function (name) { form.elements[name].checked = settings[name]; });
    ['quiet_start_hour', 'quiet_end_hour', 'timezone'].forEach(function (name) { form.elements[name].value = settings[name]; });
    updateNotificationSummary();
  }
  async function loadNotificationSettings() {
    try {
      var result = await api('notification-settings');
      fillNotificationForm(result.settings);
      byId('notification-settings-form').querySelector('fieldset').disabled = !result.writable;
      status('notification-settings-status', '免打扰设置已读取。机器人和推送开关在上方单独管理；已在发送中的消息不受随后修改影响。');
    } catch (error) { status('notification-settings-status', error.message, 'error'); }
  }
  async function loadOverview() {
    status('page-status', '正在读取情报…');
    try {
      var result = await api('overview');
      topicNames = Object.fromEntries((result.topics || []).map(function (topic) { return [topic.code, topic.name]; }));
      var topicSelect = byId('candidate-filters').elements.topic;
      var selectedTopic = new URLSearchParams(location.search).get('topic') || topicSelect.value;
      topicSelect.replaceChildren(new Option('全部专题', ''));
      (result.topics || []).forEach(function (topic) { topicSelect.add(new Option(topic.name + (topic.active ? '' : '（已停用，历史）'), topic.code)); });
      if (Array.from(topicSelect.options).some(function (option) { return option.value === selectedTopic; })) topicSelect.value = selectedTopic;
      if (result.user?.email) byId('account-email').textContent = result.user.email;
      overviewLoaded = true;
      overviewCandidates = result.candidates;
      overviewOpportunities = result.opportunities || [];
      renderOverview(result.candidates);
      status('page-status', '');
    } catch (error) {
      status('page-status', error.message, 'error');
      status('candidate-filter-status', '情报读取失败，请刷新重试。', 'error');
    }
  }
  async function loadOperations() {
    try { renderOperations(await api('operations')); }
    catch (error) { status('automation-status', error.message, 'error'); }
  }
  var archiveSettings = null;
  function renderArchiveSettings(result) {
    archiveSettings = result.node;
    var node = result.node, form = byId('archive-directory-form');
    byId('archive-directory-current').textContent = node?.active_directory || 'Mac 尚未回报保存目录';
    form.hidden = !node || !result.writable;
    if (!node) {
      byId('archive-directory-meta').textContent = 'Mac 下次连接后会显示实际目录；目前无法从网站确认本地路径。';
      status('archive-directory-status', '');
      return;
    }
    form.elements.directory.value = '';
    byId('archive-directory-selection').textContent = '尚未选择新目录';
    form.querySelector('button[type="submit"]').disabled = true;
    var pending = node.revision > node.active_revision;
    var errors = { invalid_directory: '目录格式无效', directory_unavailable: '目录不存在、磁盘未挂载或位置已变化',
      directory_not_writable: '目录不可写', archive_state_failed: 'Mac 无法保存目录状态' };
    byId('archive-directory-meta').textContent = 'Mac 最近检查：' + dateLabel(node.last_seen_at) +
      (node.previous_directories?.length ? ' · 旧原件仍在：' + node.previous_directories.join('；') : '');
    status('archive-directory-status', node.error_code ? '切换未完成：' + (errors[node.error_code] || '请检查 Mac 归档日志') + '。原件没有写入所填新目录。' :
      pending ? '已保存新目录：' + node.requested_directory + '。Mac 将在下次 23:30 自动检查并切换；确认前仍使用当前目录。' : '当前目录已由 Mac 确认。', node.error_code ? 'error' : pending ? '' : 'success');
  }
  async function loadArchiveSettings() {
    try { renderArchiveSettings(await api('local-archive-settings')); }
    catch (error) { status('archive-directory-status', error.message, 'error'); }
  }
  if (byId('archive-directory-refresh')) {
    byId('archive-directory-refresh').addEventListener('click', loadArchiveSettings);
    byId('archive-directory-pick').addEventListener('click', async function () {
      var nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      this.disabled = true;
      status('archive-directory-status', '请在 Mac 文件夹窗口中选择目录…');
      try {
        var response = await fetch('http://127.0.0.1:47431/choose-direct?nonce=' + nonce, { method: 'POST', mode: 'cors', cache: 'no-store' });
        if (!response.ok) throw new Error('folder_picker_failed');
        var result = await response.json();
        if (result.type !== 'nrgopt-archive-directory' || result.nonce !== nonce) throw new Error('folder_picker_failed');
        if (!result.directory) {
          status('archive-directory-status', result.result === 'unsupported' ? '请选择用户目录或外接磁盘中的子文件夹。' :
            result.result === 'unavailable' ? '所选目录无法读取，请检查磁盘后重试。' : '已取消选择，保存目录未更改。',
          result.result === 'cancelled' ? '' : 'error');
          return;
        }
        byId('archive-directory-input').value = result.directory;
        byId('archive-directory-selection').textContent = result.directory;
        byId('archive-directory-form').querySelector('button[type="submit"]').disabled = false;
        status('archive-directory-status', '已选择目录。点击“保存目录”后，Mac 将在下次 23:30 自动检查并切换。');
      } catch {
        status('archive-directory-status', '无法连接这台 Mac 的目录选择服务，请确认本机服务正在运行后重试。', 'error');
      } finally {
        this.disabled = false;
      }
    });
    byId('archive-directory-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!archiveSettings || !event.currentTarget.elements.directory.value) return;
      var form = event.currentTarget, button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status('archive-directory-status', '正在保存目录…');
      try {
        var result = await api('save-local-archive-directory', { node_id: archiveSettings.node_id,
          revision: archiveSettings.revision, directory: form.elements.directory.value.trim() });
        renderArchiveSettings({ node: result.node, writable: true });
      } catch (error) { status('archive-directory-status', error.message + ' 所选目录仍保留。', 'error'); }
      finally { button.disabled = !form.elements.directory.value; }
    });
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
      link.textContent = publicationLabel(entry) + ' · ' + entry.title_zh;
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
  function renderBusinessHistory(history) {
    var list = byId('business-history'); list.replaceChildren();
    var names = { unspecified: '范围未细分', development_rights: '开发权', ppa: '购电协议', epc: '工程总承包（EPC）', construction_contract: '施工合同', equipment: '设备采购', service: '服务采购' };
    var stages = { planned: '规划', open: '采购开放', shortlisted: '已入围', awarded: '已授标', signed: '已签约', construction: '建设中', delivered: '已交付', operating: '已投运', cancelled: '已取消' };
    var seen = new Set();
    history.forEach(function (item) {
      var value = item.snapshot || {}, identity = item.procurement_id || item.project_id;
      var current = !seen.has(identity); seen.add(identity);
      var li = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = dateLabel(item.recorded_at) + ' · ' + (current ? '最近记录' : '历史记录') + ' · ' +
        (item.procurement_id ? names[value.scope] + '：' + value.package_name_zh : '项目：' + value.canonical_name) + ' · ' +
        (value.current_in_analysis ? (stages[value.stage_code] || value.stage_zh || '阶段未披露') : '本次分析未再次确认');
      var quote = document.createElement('p'); quote.textContent = value.evidence_quote ? '记录对应原文：' + value.evidence_quote : '对应依据保存在本来源的事实和分析修订中。';
      details.append(summary, quote); li.append(details); list.append(li);
    });
    byId('business-history-section').hidden = !history.length;
  }
  function renderOpportunities(opportunities, history, hypotheses) {
    var list = byId('opportunities-list');
    if (!list) return;
    list.replaceChildren();
    var scopes = { early: '早期机会', equipment: '设备采购', service: '服务采购' };
    var states = { unverified: '待验证，未披露采购开放', public_tender_open: '采购开放已披露，参与资格待核',
      package_awarded: '该包已授标或签约', cancelled: '该包已取消' };
    opportunities.forEach(function (entry) {
      var item = document.createElement('li');
      var hypothesis = entry.scope === 'early' ? (hypotheses || []).find(function (row) { return row.id === entry.hypothesis_id; }) : null;
      var earlyStatus = hypothesis && ({ rejected: '关联假设已否定，停止追踪', dormant: '关联假设休眠，停止主动追踪',
        confirmed: '关联假设已证实，待关联正式机会' })[hypothesis.status];
      var title = document.createElement('strong');
      title.textContent = (scopes[entry.scope] || '采购事项') + '：' + entry.package_name_zh + ' · '
        + (entry.current_in_analysis ? (earlyStatus || states[entry.participation_status] || states.unverified) : '本次分析未再次确认');
      var quote = document.createElement('blockquote');
      quote.textContent = '事实 ' + entry.evidence_fact_number + '，原文：“' + entry.evidence_quote + '”';
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '机会更新：' + dateLabel(entry.updated_at) + ' · 原文发布时间见本页顶部';
      item.append(title, timing, quote);
      if (entry.scope === 'early') {
        var link = document.createElement('p');
        link.textContent = '关联待验证假设：' + (hypothesis ? hypothesis.claim_zh : '请查看本来源的假设记录');
        item.append(link);
      }
      var changes = (history || []).filter(function (record) { return record.opportunity_id === entry.id; });
      if (changes.length > 1) {
        var details = document.createElement('details');
        var heading = document.createElement('summary');
        heading.textContent = '查看状态记录（' + changes.length + '）';
        details.append(heading);
        changes.forEach(function (record) {
          var change = document.createElement('p');
          change.textContent = dateLabel(record.recorded_at) + ' · '
            + (record.snapshot.current_in_analysis ? (states[record.snapshot.participation_status] || states.unverified) : '本次分析未再次确认');
          details.append(change);
        });
        item.append(details);
      }
      list.append(item);
    });
    byId('opportunities-section').hidden = !opportunities.length;
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
      link.textContent = '系统采集：' + dateLabel(version.fetched_at) + (version.id === currentId ? '（当前查看）' : ' · 查看此版本');
      var meta = document.createElement('p');
      meta.textContent = '原文发布：' + publicationLabel(version) + ' · 阶段分析：' + (maturityLabels[version.maturity] || '尚无可用分析')
        + (version.reused_from_source_id ? ' · 正文未变，沿用已有分析' : '');
      item.append(link, meta);
      var prior = versions[index + 1];
      if (prior && prior.maturity && version.maturity && prior.maturity !== version.maturity) {
        var change = document.createElement('p');
        change.textContent = '分析记录变化：' + maturityLabels[prior.maturity] + ' → ' + maturityLabels[version.maturity] + '。请结合下方原文核对项目和采购范围。';
        item.append(change);
      }
      [{ value: version.project, evidence: version.project_evidence, name: '项目', field: 'name_zh' },
        { value: version.procurement, evidence: version.procurement_evidence, name: '采购事项', field: 'package_zh' }].forEach(function (entry) {
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
  var followupForm = byId('followup-form');
  var followupRevision = 0;
  var followupBusy = false, followupWritable = true;
  function followupStatus(message, tone) {
    status('followup-status', message, tone);
    status('followup-save-status', message, tone);
  }
  function followupPending(pending, label) {
    followupBusy = pending;
    followupForm.setAttribute('aria-busy', String(pending));
    Array.from(followupForm.elements).forEach(function (field) { field.disabled = pending || !followupWritable; });
    byId('followup-save').textContent = label || '保存跟踪';
  }
  var followupCandidate = null, followupSource = null, followupWatch = null;
  var followupLabels = { active: '正在跟踪', expired: '暂缓', completed: '已退出' };
  var priorityLabels = { high: '高', normal: '普通', low: '低' };
  function paragraph(parent, text, className) {
    var p = document.createElement('p'); p.textContent = text;
    if (className) p.className = className;
    parent.append(p); return p;
  }
  function followupEvidence(watch) {
    var section = byId('followup-evidence');
    var list = byId('followup-evidence-list');
    list.replaceChildren();
    section.hidden = !watch;
    if (!watch) return;
    var since = Date.parse(watch.updated_at);
    var changes = [];
    (followupCandidate?.tracking?.hypotheses || []).forEach(function (h) {
      (h.assessments || []).filter(function (a) { return Date.parse(a.created_at) > since; }).forEach(function (a) { changes.push({ hypothesis: h, assessment: a }); });
    });
    changes.sort(function (a, b) { return Date.parse(b.assessment.created_at) - Date.parse(a.assessment.created_at); });
    byId('followup-evidence-note').textContent = '比较起点：' + dateLabel(watch.updated_at) + '。' + (changes.length ? '以下是随后记录的 AI 判断，请据原文决定下一行动。' : '尚无新的判断记录；不代表来源没有变化或情报没有价值。可在下方查看全部判断与原文。');
    changes.forEach(function (entry) {
      var a = entry.assessment, item = document.createElement('li');
      paragraph(item, entry.hypothesis.claim_zh);
      paragraph(item, dateLabel(a.created_at) + ' · ' + ({ strengthened: '新增支持', weakened: '新增削弱证据', rejected: '反证建议否定', unchanged: '未形成实质变化' }[a.recommendation] || '待复核') + ' · ' + (a.applied ? '已更新假设状态' : '仅记录建议，未更新假设状态'), 'intel-source-meta');
      paragraph(item, a.reason_zh);
      (a.evidence_facts || []).forEach(function (fact) { var quote = document.createElement('blockquote'); quote.textContent = fact.claim_zh + '；原文：“' + fact.evidence_quote + '”'; item.append(quote); });
      var link = document.createElement('a'); link.href = '/intelligence/sources/' + encodeURIComponent(a.source_id); link.textContent = '核对证据来源'; item.append(link);
      paragraph(item, ['weakened', 'rejected'].includes(a.recommendation) ? '建议：先核对反证适用的项目、环节与时间，再决定暂缓或退出；尚未执行。' : '建议：核对是否回答了你的下一验证问题，再记录结论与后续动作；尚未执行。', 'intel-muted');
      list.append(item);
    });
  }
  function renderFollowup(data) {
    var watch = data.watch, fields = followupForm.elements;
    followupWatch = watch;
    ['decision-track', 'decision-defer'].forEach(function (id) { byId(id).disabled = !data.eligible || data.writable === false; });
    byId('decision-track').textContent = watch ? '复核与记录结果' : '加入跟踪';
    byId('decision-defer').hidden = !!watch;
    byId('decision-saved').textContent = watch ? '已保存：' + followupLabels[watch.status] + ' · 复核 ' + watch.followup.review_on + '（北京时间）' : '当前尚未保存跟踪计划。';
    followupRevision = watch?.revision || 0;
    followupForm.hidden = !data.eligible;
    byId('followup-editor').hidden = !data.eligible;
    byId('followup-editor-label').textContent = watch ? '更新计划、记录结果或调整状态' : '加入持续跟踪';
    if (['#followup-section', '#defer'].includes(location.hash)) byId('followup-editor').open = true;
    followupWritable = data.writable !== false;
    Array.from(fields).forEach(function (field) { field.disabled = followupBusy || !followupWritable; });
    byId('followup-reload').hidden = !watch;
    byId('followup-reload-help').hidden = !watch;
    if (!data.eligible) { followupStatus('这条来源尚未形成可跟踪的业务情报，请先查看或生成中文分析。'); return; }
    var draft = followupSource?.extraction_status === 'extracted' && followupSource.content_sha256 === followupSource.extraction_source_sha256 ? followupSource.extraction_zh || {} : {};
    var value = watch?.followup || { reason: (draft.why_it_matters_zh || '').slice(0, 600), next_action: (draft.next_signals_zh?.[0] || draft.unknowns_zh?.[0] || '核对原文依据和当前进展，再决定是否继续跟进。').slice(0, 240), exit_condition: '出现可靠反证，或确认该事项与我的业务无关时，复核后退出。', outcome: '', exit_reason: '', priority: 'normal', review_on: new Date((beijingToday() + 7) * 86400000).toISOString().slice(0, 10) };
    Object.keys(value).forEach(function (key) { if (fields.namedItem(key)) fields.namedItem(key).value = value[key]; });
    fields.namedItem('status').value = watch?.status || 'active';
    fields.namedItem('exit_reason').required = watch?.status !== 'active' && !!watch;
    byId('followup-summary').hidden = !watch;
    if (watch) byId('followup-summary').textContent = followupLabels[watch.status] + ' · 复核日期：' + value.review_on + '（北京时间）'
      + (watch.status === 'active' && value.review_on <= new Date(beijingToday() * 86400000).toISOString().slice(0, 10) ? ' · 已到期，请复核；未自动退出' : '')
      + ' · 最近人工记录：' + dateLabel(watch.updated_at);
    var history = byId('followup-history-list'); history.replaceChildren();
    (data.history || []).forEach(function (entry) {
      var item = document.createElement('li'), after = entry.after_state, before = entry.before_state;
      paragraph(item, dateLabel(entry.recorded_at) + ' · ' + (before ? followupLabels[before.status] + ' → ' : '进入跟踪 → ') + followupLabels[after.status], 'intel-source-meta');
      paragraph(item, '理由：' + after.followup.reason + '\n下一步：' + after.followup.next_action + '\n复核：' + after.followup.review_on + '（北京时间） · 优先级：' + priorityLabels[after.followup.priority] + '\n退出条件：' + after.followup.exit_condition);
      if (after.followup.outcome) paragraph(item, '当时记录的实际结果：' + after.followup.outcome);
      if (after.followup.exit_reason) paragraph(item, '暂缓 / 退出 / 恢复原因：' + after.followup.exit_reason);
      history.append(item);
    });
    byId('followup-history').hidden = !history.children.length;
    followupEvidence(watch);
    if (!watch && location.hash === '#defer') { fields.namedItem('status').value = 'expired'; fields.namedItem('exit_reason').required = true; }
    followupStatus(data.writable === false ? '当前环境只读。' : watch ? '已读取保存的跟踪计划。' : '以下是可编辑草稿，尚未保存；请确认理由、下一步和复核日期。');
  }
  function renderDecision(source, candidate) {
    followupSource = source;
    byId('detail-title').textContent = candidate?.title_zh || source.title || '情报详情';
    var extraction = source.extraction_status === 'extracted' && source.content_sha256 === source.extraction_source_sha256 ? source.extraction_zh : null;
    byId('decision-brief').hidden = !extraction;
    if (!extraction) { byId('detail-evidence').open = true; return; }
    byId('decision-change').textContent = extraction.summary_zh || '尚待分析。';
    byId('decision-impact').textContent = extraction.why_it_matters_zh || '能源影响尚待确认。';
    byId('decision-confidence').textContent = candidate?.disposition === 'source_only' ? '目前仅作为背景资料，尚不足以形成业务线索。'
      : ({ unverified: '已有原文依据；原文中的说法尚未充分核实，具体信息缺口见下方。', sourced: '原文引文已核对；这不等于原文中的说法已被独立证实。', checked: '已比对多份原文；仍需核对是否为独立来源。', conflict: '原文存在冲突，先核对差异再作决定。', corrected: '判断已依据新证据更正，请查看历史。' }[candidate?.evidence_status] || '已有来源分析；证据核实状态尚未明确。');
    renderReviewPoints(byId('decision-unknowns'), extraction, candidate);
    byId('decision-next').textContent = extraction.next_signals_zh?.[0] || '先核对原文，再确定需要验证的问题。';
    var deadline = extraction.classification?.procurement?.deadline_text;
    byId('decision-deadline').textContent = deadline ? '来源披露的截止信息：' + deadline + '。参与前请核对原公告及后续更正。' : '当前没有已确认的采购截止信息。复核日期由你另行设定。';
    var age = publicationAge(source);
    byId('decision-recency').hidden = age !== null && age < 30;
    byId('decision-recency').textContent = age === null ? '发布日期待核验，暂不能判断时效；以下是来源当时的分析。' : '历史资料：以下判断反映原文发布时的情况，跟进前须取得近期证据。';
  }
  async function loadFollowup(id) { renderFollowup(await api('followup', undefined, id)); }
  if (followupForm) {
    ['decision-track', 'decision-defer'].forEach(function (id) {
      byId(id).addEventListener('click', function () {
        byId('followup-editor').open = true;
        if (!followupWatch) {
          followupForm.elements.namedItem('status').value = id === 'decision-defer' ? 'expired' : 'active';
          followupForm.elements.namedItem('exit_reason').required = id === 'decision-defer';
        }
        byId('followup-section').scrollIntoView({ block: 'start' });
        followupForm.elements.namedItem(id === 'decision-defer' ? 'exit_reason' : followupWatch ? 'outcome' : 'reason').focus();
        followupStatus(id === 'decision-defer' ? '请填写暂不关注的原因，再保存。记录会保留，可从“我的跟踪 → 暂缓”恢复。' : '确认计划或填写实际结果后保存；草稿不会自动执行。');
      });
    });
    followupForm.elements.namedItem('status').addEventListener('change', function () { followupForm.elements.namedItem('exit_reason').required = this.value !== 'active'; });
    followupForm.elements.namedItem('priority').addEventListener('change', function () {
      followupForm.elements.namedItem('review_on').value = new Date((beijingToday() + ({ high: 1, normal: 7, low: 30 }[this.value])) * 86400000).toISOString().slice(0, 10);
    });
    followupForm.addEventListener('input', function () {
      byId('followup-save').textContent = '保存跟踪';
      followupStatus('有未保存的修改，请点击“保存跟踪”。');
    });
    followupForm.addEventListener('invalid', function () {
      followupStatus('尚未保存：请补全或修正表单中提示的内容。', 'error');
    }, true);
    byId('followup-reload').addEventListener('click', async function () {
      if (followupBusy || !window.confirm('放弃保存本次修改？表单将回到已保存的跟踪理由、下一步、复核日期、状态和处理结果等内容。已保存记录不会被删除。')) return;
      followupPending(true);
      followupStatus('正在还原已保存的跟踪计划…');
      try {
        await loadFollowup(location.pathname.match(detailPath)[1]);
        followupStatus('已放弃未保存的修改，表单已回到保存的跟踪计划。', 'success');
      } catch (error) { followupStatus(error.message + ' 表单内容已保留。', 'error'); }
      finally { followupPending(false); }
    });
    followupForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (followupBusy) return;
      var body = Object.fromEntries(new FormData(followupForm)); body.revision = followupRevision;
      followupPending(true, '保存中…');
      followupStatus('正在保存跟踪计划…');
      var saved;
      try {
        var id = location.pathname.match(detailPath)[1];
        saved = await api('save-followup', body, id);
        followupRevision = saved.watch.revision;
        var message = '已保存 · ' + dateLabel(saved.watch.updated_at) + '。'
          + (saved.watch.status === 'active' ? '可在“我的跟踪”查看；实际行动后可回来记录结果。' : '已移出活跃跟踪，原因与历史保留，可在“我的跟踪”恢复。');
        byId('followup-save').textContent = '已保存';
        followupStatus(message, 'success');
        try { await loadFollowup(id); followupStatus(message, 'success'); }
        catch {
          // The write succeeded; reflect its revision and state even if reading history fails.
          renderFollowup({ watch: saved.watch, eligible: true, writable: followupWritable });
          followupStatus(message + ' 历史记录暂未刷新，可刷新页面查看，无需重复保存。', 'success');
        }
      } catch (error) { followupStatus(error.message + ' 表单内容已保留；如网络中断，请先在“我的跟踪”核对是否保存成功。', 'error'); }
      finally { followupPending(false, saved ? '已保存' : '重试保存'); }
    });
  }
  var followupsOffset = 0;
  async function loadFollowups() {
    var scope = byId('followups-state'), previous = byId('followups-prev'), next = byId('followups-next');
    scope.disabled = previous.disabled = next.disabled = byId('followups-refresh').disabled = true;
    try {
      var result = await api('followups&state=' + scope.value + '&offset=' + followupsOffset);
      var list = byId('followups-list'); list.replaceChildren();
      result.items.forEach(function (watch) { list.append(watchCard(watch, result.writable === true)); });
      if (!result.items.length) paragraph(list, scope.value === 'active' ? '尚无主动跟踪事项。从情报详情填写跟踪计划即可加入。' : '此范围暂无记录。', 'intel-muted');
      previous.disabled = followupsOffset === 0; next.disabled = !result.more;
      byId('followups-page').textContent = '第 ' + (followupsOffset / 25 + 1) + ' 页';
      status('page-status', '');
    } catch (error) { status('page-status', error.message + ' 已显示的列表保留，可能不是最新状态。', 'error'); }
    finally { scope.disabled = byId('followups-refresh').disabled = false; }
  }
  if (byId('followups-list')) {
    document.querySelector('.intel-nav a[href="/intelligence/followups"]').setAttribute('aria-current', 'page');
    byId('followups-state').addEventListener('change', function () { followupsOffset = 0; loadFollowups(); });
    byId('followups-refresh').addEventListener('click', loadFollowups);
    byId('followups-prev').addEventListener('click', function () { followupsOffset = Math.max(0, followupsOffset - 25); loadFollowups(); });
    byId('followups-next').addEventListener('click', function () { followupsOffset += 25; loadFollowups(); });
  }

  async function loadDetail(id) {
    try {
      var result = await api('source', undefined, id);
      topicNames = Object.fromEntries((result.topics || []).map(function (topic) { return [topic.code, topic.name]; }));
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
      renderDecision(source, result.candidate);
      renderSourceHistory(result.history || [], id);
      renderAnalysisRevisions(result.revisions || []);
      renderProjectTimeline(result.project_history);
      renderBusinessHistory(result.business_history || []);
      renderOpportunities(result.candidate?.opportunities || [], result.candidate?.opportunity_history || [], result.candidate?.tracking?.hypotheses || []);
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
      followupCandidate = result.candidate;
      loadFollowup(id).catch(function (error) { status('followup-status', error.message, 'error'); });
      status('page-status', '');
    } catch (error) {
      byId('source-title').textContent = '来源未能读取';
      status('page-status', error.message, 'error');
    }
  }

  byId('themeBtn').addEventListener('click', function () { window.toggleTheme(); });
  var resetPasswordForm = byId('reset-password-form');
  if (resetPasswordForm) {
    var recovery = new URLSearchParams(location.hash.slice(1));
    var recoveryToken = recovery.get('type') === 'recovery' ? recovery.get('access_token') : null;
    history.replaceState(null, '', location.pathname);
    if (!recoveryToken) {
      resetPasswordForm.querySelector('button[type="submit"]').disabled = true;
      status('reset-password-status', '重置链接无效或已过期，请返回登录页重新发送。', 'error');
    }
    resetPasswordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var password = byId('new-password').value;
      var button = resetPasswordForm.querySelector('button[type="submit"]');
      if (password !== byId('confirm-password').value) {
        status('reset-password-status', '两次输入的密码不一致。', 'error');
        return;
      }
      button.disabled = true;
      status('reset-password-status', '正在保存新密码…');
      try {
        await api('reset-password', { token: recoveryToken, password: password });
        byId('new-password').value = '';
        byId('confirm-password').value = '';
        recoveryToken = null;
        status('reset-password-status', '密码已更新，请返回登录。');
      } catch (error) {
        status('reset-password-status', error.message, 'error');
        button.disabled = false;
      }
    });
    return;
  }
  var loginForm = byId('login-form');
  if (loginForm) {
    byId('reset-request-button').addEventListener('click', async function (event) {
      if (!byId('email').reportValidity()) return;
      var button = event.currentTarget;
      button.disabled = true;
      status('login-status', '正在发送重置邮件…');
      try {
        var result = await api('request-password-reset', { email: byId('email').value.trim() });
        status('login-status', result.message);
      } catch (error) { status('login-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
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
  if (overviewList) {
    var candidateFilters = byId('candidate-filters');
    function readCandidateFilters() {
      var filterParams = new URLSearchParams(location.search);
      var legacyRadar = filterParams.get('radar');
      if (!filterParams.get('view') && legacyRadar) filterParams.set('view', legacyRadar === 'trigger' ? 'signal' : legacyRadar);
      ['group', 'country', 'topic', 'period'].forEach(function (name) {
        var control = candidateFilters.elements[name], value = filterParams.get(name) || '';
        control.value = name === 'period' ? '30' : '';
        if (Array.from(control.options).some(function (option) { return option.value === value; })) control.value = value;
      });
      candidateFilters.elements.view.value = ['overview', 'signal', 'demand', 'project', 'opportunity'].includes(filterParams.get('view')) ? filterParams.get('view') : 'overview';
      byId('candidate-more-filters').open = Boolean(candidateFilters.elements.group.value || candidateFilters.elements.topic.value);
    }
    readCandidateFilters();
    renderOverviewHeading();
    function applyCandidateFilters(pushHistory) {
      var url = new URL(location.href);
      url.searchParams.delete('radar');
      ['group', 'country', 'topic', 'view', 'period'].forEach(function (name) {
        var value = candidateFilters.elements[name].value;
        if (value && !(name === 'view' && value === 'overview')) url.searchParams.set(name, value); else url.searchParams.delete(name);
      });
      if (url.href !== location.href) history[pushHistory ? 'pushState' : 'replaceState'](null, '', url.pathname + url.search + url.hash);
      if (overviewLoaded) renderOverview(overviewCandidates);
      else renderOverviewHeading();
    }
    document.querySelectorAll('.intel-discover-views a').forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        candidateFilters.elements.view.value = link.dataset.view || new URL(link.href).searchParams.get('view') || 'overview';
        applyCandidateFilters(true);
      });
    });
    window.addEventListener('popstate', function () {
      readCandidateFilters();
      if (overviewLoaded) renderOverview(overviewCandidates);
      else renderOverviewHeading();
    });
    candidateFilters.addEventListener('change', function (event) {
      var country = regions.countries.find(function (item) { return item.code === candidateFilters.elements.country.value; });
      if (event.target.name === 'country') candidateFilters.elements.group.value = '';
      else if (event.target.name === 'group' && country && candidateFilters.elements.group.value && country.group !== candidateFilters.elements.group.value) candidateFilters.elements.country.value = '';
      applyCandidateFilters();
    });
    candidateFilters.addEventListener('submit', function (event) { event.preventDefault(); });
    candidateFilters.addEventListener('reset', function (event) {
      event.preventDefault();
      candidateFilters.elements.group.value = ''; candidateFilters.elements.topic.value = ''; candidateFilters.elements.country.value = ''; candidateFilters.elements.view.value = 'overview'; candidateFilters.elements.period.value = '30';
      byId('candidate-more-filters').open = false;
      applyCandidateFilters();
    });

  }
  var providerForms = document.querySelectorAll('.intel-provider-form');
  var notificationForm = byId('notification-settings-form');
  if (notificationForm) {
    loadNotificationSettings();
    notificationForm.addEventListener('change', updateNotificationSummary);
    notificationForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = notificationForm.querySelector('button[type="submit"]');
      var fields = notificationForm.elements;
      button.disabled = true;
      try {
        var result = await api('save-notification-settings', {
          quiet_enabled: fields.quiet_enabled.checked, quiet_start_hour: Number(fields.quiet_start_hour.value),
          quiet_end_hour: Number(fields.quiet_end_hour.value), timezone: fields.timezone.value,
          flash_breaks_quiet: fields.flash_breaks_quiet.checked
        });
        fillNotificationForm(result.settings);
        status('notification-settings-status', '已保存。后续消息按所选时区和静默时间发送；不会开启尚未启用的飞书发送。', 'success');
      } catch (error) { status('notification-settings-status', error.message, 'error'); }
      finally { button.disabled = false; }
    });
  }
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
        loadProviderHistory();
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
      status('discovery-status', '正在搜索公开来源线索…');
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
        renderDecision(result.source, result.candidate);
        followupCandidate = result.candidate;
        await loadFollowup(match[1]);
        renderSourceHistory(result.history || [], match[1]);
        renderAnalysisRevisions(result.revisions || []);
      renderProjectTimeline(result.project_history);
      renderBusinessHistory(result.business_history || []);
      renderOpportunities(result.candidate?.opportunities || [], result.candidate?.opportunity_history || [], result.candidate?.tracking?.hypotheses || []);
      } catch (error) { status('extraction-status', error.message, 'error'); }
      finally { extractButton.disabled = false; }
    });
  }
  var directionData, editingDirection, directionResults = [], directionResultId = null, directionDirty = false, directionSaving = false;
  function directionText(parent, tag, text, className) {
    var node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node); return node;
  }
  function directionView(view) {
    byId('direction-home').hidden = view !== 'home';
    byId('direction-editor').hidden = view !== 'edit';
    byId('direction-results-panel').hidden = view !== 'results';
  }
  function returnToDirections(id) {
    directionResultId = null; editingDirection = null; directionDirty = false;
    directionView('home');
    var button = Array.from(document.querySelectorAll('[data-direction-edit]')).find(function(n){return n.dataset.directionEdit === id;});
    var target = button && !button.disabled ? button : Array.from(document.querySelectorAll('[data-direction-results]')).find(function(n){return n.dataset.directionResults===id;}) || byId('direction-new');
    var card = target.closest('.intel-direction-card');
    if (card) card.open = true;
    target.focus();
  }
  function renderDirections() {
    var list = byId('direction-list'); list.replaceChildren();
    byId('direction-new').disabled = !directionData.writable;
    var priority = { high: '高', normal: '普通', low: '低' };
    var active = directionData.effective.filter(function(d){return d.config.enabled;}).length;
    byId('direction-count').textContent = '共 ' + directionData.directions.length + ' 个方向 · 今天已启用 ' + active + ' 个。启用不代表今天已完成搜索。';
    directionData.directions.forEach(function (d, index) {
      var card = directionText(list, 'details', '', 'intel-panel intel-direction-card');
      var summary = directionText(card, 'summary', '');
      var heading = directionText(summary, 'span', '', 'intel-direction-heading');
      directionText(heading, 'span', String(index + 1).padStart(2, '0'), 'intel-direction-number');
      directionText(heading, 'strong', d.config.name);
      var effective = directionData.effective.find(function (v) { return v.id === d.id; });
      directionText(summary, 'span', effective ? (effective.config.enabled ? '今天已启用' : '今天已暂停') : '尚未生效', 'intel-badge');
      var body = directionText(card, 'div', '', 'intel-direction-card-body');
      if (d.effective_on > directionData.day) directionText(body, 'p', '以下为已保存设置，' + d.effective_on + ' 北京时间起' + (d.config.enabled ? '启用' : '暂停') + '；今天的任务不受本次修改影响。', 'intel-direction-pending');
      directionText(body, 'p', d.config.why, 'intel-direction-purpose');
      directionText(body, 'p', '关注对象：' + d.config.industries, 'intel-muted');
      directionText(body, 'p', '范围：' + d.config.countries.length + ' 个地区 · 希望找到：' + d.config.targets.map(function(t){return ({signal:'变化线索',investment:'投资动向',procurement:'采购机会'})[t];}).join('、'), 'intel-muted');
      var actions = directionText(body, 'div', '', 'intel-direction-buttons');
      var edit = directionText(actions, 'button', '修改搜集要求', 'intel-button'); edit.type = 'button'; edit.disabled = !directionData.writable; edit.dataset.directionEdit = d.id;
      edit.addEventListener('click',function(){ openDirection(d); });
      var results = directionText(actions, 'button', '查看搜集结果', 'intel-button'); results.type='button'; results.dataset.directionResults=d.id;
      results.addEventListener('click',function(){ loadDirectionResults(d); });
      var toggle = directionText(actions, 'button', d.config.enabled ? '暂停搜集' : '恢复搜集', 'intel-button intel-button-quiet'); toggle.type='button'; toggle.disabled=!directionData.writable;
      toggle.addEventListener('click',function(){ openDirection(d, !d.config.enabled); });
      var task = directionData.tasks.find(function (t) { return t.checkpoint.direction.id === d.id; });
      var states = {queued:'等待执行', running:'正在执行', retry:'等待重试', succeeded:'已执行', failed:'执行失败', budget_paused:'预算或账单暂停', manual_paused:'已暂停'};
      directionText(body, 'p', task ? '最近搜索：' + dateLabel(task.updated_at) + ' · ' + regionNames[task.checkpoint.country] + ' · ' + (states[task.status] || task.status) + ' · 使用版本 ' + task.checkpoint.direction.revision + (task.status === 'succeeded' ? ' · 找到 ' + (task.checkpoint.result_urls || []).length + ' 条线索' : '') : '尚无搜索记录，等待生效或地区轮转。', 'intel-source-meta');
      if (task?.error_code) directionText(body, 'p', '本次搜索未完成，可在“当天任务”查看原因。', 'intel-muted');
      var details = document.createElement('details'); body.appendChild(details);
      directionText(details, 'summary', '查看完整设置、来源网站与修改记录');
      directionText(details, 'p', '已保存的地区：' + d.config.countries.map(function(c){return regionNames[c];}).join('、'));
      directionText(details, 'p', '优先级：' + priority[d.config.priority] + ' · 排除：' + (d.config.exclude || '未设置'));
      directionText(details, 'p', '最近保存：' + dateLabel(d.updated_at), 'intel-muted');
      if (effective) {
        directionText(details, 'h4', '今天生效的设置 · 版本 ' + effective.revision);
        directionText(details, 'p', effective.config.name + '；' + effective.config.why + '；对象：' + effective.config.industries + '；地区：' + effective.config.countries.map(function(c){return regionNames[c];}).join('、'));
      }
      directionText(details, 'h4', '既有发布者入口参考');
      directionText(details, 'p', '按方向搜索也会发现这些网站以外的政府、企业、媒体和公开作者文章。下列入口不代表已采集成功或独立核实。', 'intel-muted');
      d.config.countries.forEach(function (country) {
        var row = directionText(details, 'p', regionNames[country] + '：');
        (directionData.websites[country] || []).forEach(function (host) {
          var link = directionText(row, 'a', host + ' '); link.href = 'https://' + host; link.target = '_blank'; link.rel = 'noopener noreferrer';
        });
      });
      directionText(details, 'h4', '最近保存记录');
      directionData.versions.filter(function(v){return v.direction_id===d.id;}).slice(0,5).forEach(function(v){ directionText(details,'p',dateLabel(v.recorded_at)+' · '+(v.config.enabled?'启用':'暂停')+' · '+v.config.name+' · '+v.effective_on+' 北京时间生效'); });
    });
    if (!directionData.directions.length) directionText(list, 'p', '还没有搜集方向。点击“新增搜集方向”，告诉系统你希望找到什么。');
  }
  function openDirection(direction, enabled) {
    editingDirection = direction || { id:null, revision:0, config:{name:'',why:'',industries:'',exclude:'',countries:[],targets:['signal','investment','procurement'],priority:'normal',enabled:true} };
    var config = editingDirection.config, toggle = enabled !== undefined;
    directionDirty = toggle; directionResultId = null;
    ['name','why','industries','exclude','priority'].forEach(function(k){byId('direction-'+k).value=config[k];});
    document.querySelectorAll('[name="direction-country"]').forEach(function(n){n.checked=config.countries.includes(n.value);});
    document.querySelectorAll('[name="direction-target"]').forEach(function(n){n.checked=config.targets.includes(n.value);});
    byId('direction-enabled').checked = toggle ? enabled : config.enabled;
    byId('direction-config-fields').hidden = toggle;
    byId('direction-save').disabled=false;
    byId('direction-editor-title').textContent = toggle ? (enabled ? '恢复搜集：' : '暂停搜集：') + config.name : direction ? '修改：' + config.name : '新增搜集方向';
    byId('direction-editor-note').textContent = toggle ? '只调整这个方向的启用状态，原搜集要求保持不变。已有情报和“我的跟踪”中的事项保留。' : '按下面三步填写，最后保存。返回列表前可以放弃修改，已有设置不会被删除。';
    byId('direction-save').textContent = toggle ? (enabled ? '确认恢复搜集' : '确认暂停搜集') : '保存搜集方向';
    byId('direction-saved-results').hidden = true;
    byId('direction-cancel').textContent = toggle ? '取消，返回列表' : '返回方向列表';
    status('direction-save-status',toggle ? '确认后次日北京时间 00:00 起生效，今天已开始的任务保持原设置。' : '尚未保存。保存后次日生效。');
    directionView('edit');
    byId('direction-editor-title').focus();
    byId('direction-editor').scrollIntoView({block:'start'});
  }
  async function loadDirections() {
    directionData=await api('directions'); renderDirections();
    status('page-status',directionData.writable?'':'当前为只读模式。');
  }
  async function loadDirectionResults(direction) {
    directionResultId=direction.id; directionResults=[];
    directionView('results');
    byId('direction-period').value='30';
    byId('direction-results-title').textContent=direction.config.name+' · 搜集结果';
    byId('direction-results').replaceChildren();
    byId('direction-results-status').textContent='正在读取实际搜索记录…';
    byId('direction-results-title').focus();
    byId('direction-results-panel').scrollIntoView({block:'start'});
    try {
      var result=await api('direction-results',undefined,direction.id);
      if(directionResultId!==direction.id)return;
      directionResults=result.items;
      byId('direction-results-status').textContent='仅展示这个方向实际搜索产生的记录；同一原文合并展示。搜索命中仍是线索，须看原文分析与日期。'+(result.limited?' 当前读取最近100条搜索记录。':'');
      renderDirectionResults();
    } catch(error){if(directionResultId===direction.id)byId('direction-results-status').textContent=error.message;}
  }
  function renderDirectionResults() {
    var list=byId('direction-results');list.replaceChildren();
    var seen=new Set(), filtered=0;
    directionResults.forEach(function(item){
      var key=item.source_id||item.url;if(seen.has(key))return;seen.add(key);
      if(!inPublicationPeriod(item.source,byId('direction-period').value)){filtered++;return;}
      var row=directionText(list,'li','');
      var label=!item.source?'搜索线索 · 原文尚未就绪':item.source.extraction_status==='failed'?'原文分析失败':!item.verified?'搜索线索 · 尚未按此方向核验':!item.match.relevant?'经分析与此方向无关':item.candidate?.disposition!=='candidate'?'相关背景资料':'原文支持相关性';
      if (!item.source && item.processing) label = ({queued:'等待获取原文',running:'正在获取原文',retry:'获取失败，等待重试',failed:'原文获取失败',manual_paused:'来源已暂停',budget_paused:'等待预算或账单恢复'})[item.processing.status] || label;
      directionText(row,'strong',label);
      var title=item.candidate?.title_zh||item.source?.title||new URL(item.url).hostname;
      if(item.source){var link=directionText(row,'a',title);link.href='/intelligence/sources/'+item.source_id;}
      else directionText(row,'p',title);
      directionText(row,'p','原文发布：'+publicationLabel(item.source)+' · 搜集：'+dateLabel(item.created_at)+' · 方向版本 '+item.direction.revision,'intel-source-meta');
      if(item.verified)directionText(row,'p',item.match.reason_zh+(item.match.evidence_fact_number?'（原文事实 '+item.match.evidence_fact_number+'）':''));
      var url=webUrl(item.url);if(url){var original=directionText(row,'a','查看来源原文');original.href=url.href;original.target='_blank';original.rel='noopener noreferrer';}
    });
    if(!list.children.length)directionText(list,'li',filtered?'当前日期筛选下没有记录，可选择“全部”查看历史、待获取或日期未知的线索。':'尚无实际搜集结果。未执行、没有命中或采集失败，都不能据此判断没有价值。');
  }
  if(byId('direction-form')) {
    byId('direction-new').addEventListener('click',function(){openDirection(null);});
    byId('direction-period').addEventListener('change',renderDirectionResults);
    byId('direction-results-back').addEventListener('click',function(){returnToDirections(directionResultId);});
    byId('direction-saved-results').addEventListener('click',function(){loadDirectionResults(editingDirection);});
    byId('direction-editor-back').addEventListener('click',function(){byId('direction-cancel').click();});
    byId('direction-cancel').addEventListener('click',function(){
      if(directionSaving)return;
      if(directionDirty && !byId('direction-config-fields').hidden && this.textContent!=='确认放弃修改'){
        this.textContent='确认放弃修改';status('direction-save-status','有未保存的修改。再次点击将放弃这些修改并返回列表，已有设置保持不变。');byId('direction-save-status').scrollIntoView({block:'center'});return;
      }
      returnToDirections(editingDirection?.id);
    });
    function markDirectionDirty(){
      directionDirty=true;byId('direction-save').disabled=false;byId('direction-cancel').textContent='放弃修改，返回列表';
      byId('direction-save').textContent='保存搜集方向';byId('direction-saved-results').hidden=true;
      status('direction-save-status','有未保存的修改。保存后次日生效。');
    }
    byId('direction-form').addEventListener('input',markDirectionDirty);
    byId('direction-form').addEventListener('invalid',function(){status('direction-save-status','尚未保存，请补全表单中提示的必填项。','error');},true);
    document.querySelectorAll('[data-countries]').forEach(function(button){button.addEventListener('click',function(){
      document.querySelectorAll('[name="direction-country"]').forEach(function(n){n.checked=button.dataset.countries==='all';});markDirectionDirty();
    });});
    byId('direction-form').addEventListener('submit',async function(event){
      event.preventDefault();if(!editingDirection||directionSaving)return;
      var config={};['name','why','industries','exclude','priority'].forEach(function(k){config[k]=byId('direction-'+k).value;});
      config.countries=Array.from(document.querySelectorAll('[name="direction-country"]:checked')).map(function(n){return n.value;});
      config.targets=Array.from(document.querySelectorAll('[name="direction-target"]:checked')).map(function(n){return n.value;});
      config.enabled=byId('direction-enabled').checked;
      if(!config.countries.length||!config.targets.length){status('direction-save-status','请至少选择一个地区和一种希望找到的信息。','error');return;}
      directionSaving=true;
      var fields=this.querySelectorAll('button,input,select,textarea');fields.forEach(function(n){n.disabled=true;});
      status('direction-save-status','正在保存…');
      try {
        var result=await api('save-direction',{id:editingDirection.id,revision:editingDirection.revision,config});
        editingDirection=result.direction;directionDirty=false;
        var savedIndex=directionData.directions.findIndex(function(d){return d.id===result.direction.id;});
        if(savedIndex<0)directionData.directions.push(result.direction);else directionData.directions[savedIndex]=result.direction;
        renderDirections();
        var message='已保存「'+result.direction.config.name+'」。将于 '+result.direction.effective_on+' 北京时间 00:00 起'+(config.enabled?'启用':'暂停')+'，今天的任务继续使用原设置。';
        status('direction-save-status',message,'success');
        byId('direction-save').textContent='已保存';byId('direction-cancel').textContent='完成，返回方向列表';
        byId('direction-saved-results').hidden=false;
        try {await loadDirections();}
        catch(error){status('direction-save-status',message+' 列表暂未刷新，无需重复保存。请稍后刷新页面。','success');status('page-status','本次保存已确认；其他执行状态暂未刷新，请稍后刷新页面。','error');}
      } catch(error){directionDirty=true;status('direction-save-status',error.message+' 未保存的内容已保留。','error');}
      finally{directionSaving=false;fields.forEach(function(n){n.disabled=false;});byId('direction-save').disabled=!directionDirty;}
    });
  }
  var topicData, topicSaving = false;
  function renderTopics() {
    var list = byId('topic-list'); list.replaceChildren();
    var active = topicData.topics.filter(function (topic) { return topic.active; }).length;
    byId('topic-count').textContent = '已启用 ' + active + ' 个 · 已停用 ' + (topicData.topics.length - active) + ' 个';
    byId('topic-new').disabled = !topicData.writable || active >= 20;
    topicData.topics.forEach(function (topic, index) {
      var card = directionText(list, 'article', '', 'intel-panel intel-topic-card');
      var heading = directionText(card, 'div', '', 'intel-topic-heading');
      directionText(heading, 'span', String(index + 1).padStart(2, '0'), 'intel-direction-number');
      directionText(heading, 'h3', topic.name);
      directionText(heading, 'span', topic.active ? '已启用' : '已停用', 'intel-badge');
      directionText(card, 'p', topic.description);
      var actions = directionText(card, 'div', '', 'intel-direction-buttons');
      var toggle = directionText(actions, 'button', topic.active ? '停用专题' : '恢复专题', 'intel-button intel-button-quiet'); toggle.type = 'button'; toggle.disabled = !topicData.writable;
      toggle.addEventListener('click', async function () {
        if (topicSaving) return;
        topicSaving = true; toggle.disabled = true;
        status('page-status', '正在保存专题状态…');
        try {
          var result = await api('save-topic', { code: topic.code, revision: topic.revision, active: !topic.active });
          topicData.topics = topicData.topics.map(function (item) { return item.code === result.topic.code ? { ...item, ...result.topic } : item; });
          renderTopics();
          status('page-status', topic.active ? '专题已停用；已有分类和历史记录保留。' : '专题已恢复，后续原文分析可以重新标注。', 'success');
        } catch (error) { status('page-status', error.message + ' 请刷新名单后重试。', 'error'); }
        finally { topicSaving = false; toggle.disabled = false; }
      });
    });
  }
  function openTopic() {
    byId('topic-name').value = '';
    byId('topic-description').value = '';
    byId('topic-editor').hidden = false;
    status('topic-save-status', '尚未保存。');
    byId('topic-editor').scrollIntoView({ block: 'start' });
    byId('topic-name').focus();
  }
  async function loadTopics() {
    topicData = await api('topics');
    renderTopics();
    status('page-status', topicData.writable ? '' : '当前为只读模式。');
  }
  if (byId('topic-list')) {
    byId('topic-new').addEventListener('click', function () { openTopic(null); });
    byId('topic-cancel').addEventListener('click', function () { if (!topicSaving) byId('topic-editor').hidden = true; });
    byId('topic-form').addEventListener('submit', async function (event) {
      event.preventDefault(); if (topicSaving) return;
      topicSaving = true; byId('topic-save').disabled = true;
      var input = { code: null, revision: 0, name: byId('topic-name').value, description: byId('topic-description').value, active: true };
      status('topic-save-status', '正在保存…');
      try {
        var result = await api('save-topic', input);
        topicData.topics.push(result.topic);
        renderTopics();
        byId('topic-editor').hidden = true;
        status('page-status', '专题已保存；后续新分析使用更新后的名单。', 'success');
      } catch (error) { status('topic-save-status', error.message + ' 未保存的内容仍在表单中。', 'error'); }
      finally { topicSaving = false; byId('topic-save').disabled = false; }
    });
  }
  (async function () {
    try {
      if (byId('topic-list')) { await loadTopics(); return; }
      if (byId('direction-list')) { await loadDirections(); var requestedDirection=new URLSearchParams(location.search).get('direction'); var selectedDirection=directionData.directions.find(function(d){return d.id===requestedDirection;}); if(selectedDirection)await loadDirectionResults(selectedDirection); return; }
      if (byId('workbench-new')) { await loadWorkbench(); return; }
      if (byId('followups-list')) { await loadFollowups(); return; }
      if (byId('workflow-tasks')) { await loadWorkflow(); return; }
      if (overviewList) { await loadOverview(); return; }
      var session = await api('session');
      byId('account-email').textContent = session.user.email;
      var match = location.pathname.match(detailPath);
      if (match) await loadDetail(match[1]);
      else if (importForm) await loadSources();
      else if (providerForms.length) await Promise.all([loadProviderSettings(), loadOperations(), loadArchiveSettings()]);
    } catch (error) { status('page-status', error.message, 'error'); }
  })();
})();
