(function () {
  'use strict';

  var regions = JSON.parse(byId('intelligence-regions').textContent);
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
    if (typeof value === 'string' && value.startsWith('/intelligence/overview?')) {
      var params = new URLSearchParams(value.slice(value.indexOf('?') + 1)), retained = new URLSearchParams();
      if (regions.countries.some(function (item) { return item.code === params.get('country'); })) retained.set('country', params.get('country'));
      if (Object.hasOwn(regions.groups, params.get('group') || '')) retained.set('group', params.get('group'));
      if (Object.hasOwn(regions.topics, params.get('topic') || '')) retained.set('topic', params.get('topic'));
      var view = params.get('view');
      if (!view && ['trigger', 'demand', 'project'].includes(params.get('radar'))) view = params.get('radar') === 'trigger' ? 'signal' : params.get('radar');
      if (['signal', 'demand', 'project', 'opportunity'].includes(view)) retained.set('view', view);
      if (['30', '90', 'all', 'unknown'].includes(params.get('period'))) retained.set('period', params.get('period'));
      return '/intelligence/overview' + (retained.size ? '?' + retained : '');
    }
    return value === '/intelligence/overview' || value === '/intelligence/sources' || value === '/intelligence/settings' || value === '/intelligence/workflow' || detailPath.test(value || '') ? value : '/intelligence/overview';
  }
  function loginLocation() {
    return '/intelligence/login?returnTo=' + encodeURIComponent(safeReturnTo(location.pathname + (location.pathname === '/intelligence/overview' ? location.search : '')));
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
    if (languageNote) languageNote.textContent = extraction ? '原文语言：英语 · 中文情报已生成，引文已与原文自动比对' : '原文语言：英语 · 中文初析尚未生成';
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
          ['跨境专题', (classification.topics || []).map(function (item) { return regions.topics[item.code] || item.code; }).join('、') || '未单列'],
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
        ? '这是同一官方发布方的更正、延期或取消后重新邀请；用于更新项目状态，不计为独立确认。'
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
    var scopeLabels = { project: '项目建设', development_rights: '开发权', ppa: '购电协议（PPA）', epc: '工程总承包（EPC）', construction_contract: '施工合同（未推定EPC范围）', equipment: '设备包', service: '服务包' };
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
    byId('commercial-events-note').textContent = extraction.commercial_events == null ? '这份历史分析尚未区分包件状态，请结合上方原文。' :
      extraction.commercial_events.some(function (event) { return event.scope === 'equipment'; }) ? '设备采购状态仅适用于列出的具名设备包，其他包件仍未知。' : '设备采购状态未知：本次分析没有设备包的明确披露。EPC或PPA签约不能代替设备采购证据。';
    var contextIssues = extraction.context_issues || [];
    byId('fact-context-issues').hidden = !contextIssues.length;
    byId('fact-context-issues').textContent = contextIssues.length ? contextIssues.length + ' 项数值或包件提取未通过原文/口径校验，已排除出以上结构化结果，不能用于统计或判断：' + contextIssues.map(function (issue) {
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
      label.textContent = source.source_level === 'primary' ? '官方/项目方一手来源' : '二手来源';
      var save = document.createElement('button');
      save.className = 'intel-button';
      save.type = 'button';
      save.dataset.sourceUrl = source.url;
      save.textContent = '保存此来源';
      var heading = document.createElement('div');
      heading.append(link, label);
      row.append(heading, save);
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
      overview: ['能源变化', '先看重要变化，再进入早期信号、需求、项目或机会。所有判断都可以回到来源和原文证据。', '决策摘要', '重点变化'],
      signal: ['区域变化与能源韧性早期信号', '查看监管、安全、产业、公共服务、气候灾害和基础设施变化如何传导到能源需求，并沿验证证据继续跟踪。', '从区域变化到能源响应', '早期信号'],
      demand: ['能源需求', '查看哪些业主或设施已出现新增负荷、可靠性、并网、成本或减碳需求。', '谁需要解决什么问题', '需求'],
      project: ['能源项目', '查看已经出现项目级证据的公告、可研、融资、招标、授标、建设和投运进展。', '项目进展到哪一步', '项目'],
      opportunity: ['商业机会', '查看由原文事实支持的早期参与方向、设备包和服务包，并区分待验证、采购开放和已授标。', '哪些环节可能参与', '机会']
    }[view];
    byId('overview-title').textContent = view === 'overview' ? (period === 'all' ? '全部能源情报' : period === 'unknown' ? '日期待核验的能源情报' : prefix + '的能源变化') : prefix + ' · ' + viewCopy[0];
    byId('overview-intro').textContent = viewCopy[1];
    byId('candidate-kicker').textContent = viewCopy[2];
    byId('candidate-heading').textContent = prefix + ' · ' + viewCopy[3];
    document.querySelectorAll('.intel-nav [data-view], .intel-radar-summary a').forEach(function (link) {
      var target = new URL(link.href, location.origin);
      target.searchParams.set('period', period);
      ['group', 'country', 'topic'].forEach(function (name) { var value = filters.elements[name].value; if (value) target.searchParams.set(name, value); else target.searchParams.delete(name); });
      link.href = target.pathname + target.search;
    });
    document.querySelectorAll('.intel-nav [data-view]').forEach(function (link) {
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
    var allActive = candidates.filter(function (item) { return item.disposition === 'candidate' && item.review_status !== 'rejected'; });
    byId('recency-status').textContent = '按原文发布日期筛选，采集或重新分析不刷新日期。当前载入的情报中，' + allActive.filter(function (item) { var age = publicationAge(item.source_timing); return age !== null && age >= 30; }).length + ' 条不在近30天内，' + allActive.filter(function (item) { return publicationAge(item.source_timing) === null; }).length + ' 条日期待核验；可切换时间范围查阅。';
    var periodCandidates = candidates.filter(function (item) { return inPublicationPeriod(item.source_timing, period) && inGroup(item) && (!topic || (item.topic_codes || []).includes(topic)); });
    var groupedCandidates = periodCandidates.filter(function (item) { return item.disposition === 'candidate'; });
    var active = groupedCandidates.filter(function (item) { return item.review_status !== 'rejected'; });
    ['trigger', 'demand', 'project'].forEach(function (radar) {
      byId('radar-' + radar + '-count').textContent = active.filter(function (item) { return (item.radars || []).includes(radar); }).length;
    });
    byId('source-only-count').textContent = '本时间范围另有 ' + periodCandidates.filter(function (item) { return item.disposition === 'source_only'; }).length + ' 条背景资料';
    byId('opportunity-count').textContent = periodOpportunities.length;
    var list = byId('candidate-list');
    list.replaceChildren();
    var country = filters.elements.country.value, view = filters.elements.view.value || 'overview';
    var radar = { signal: 'trigger', demand: 'demand', project: 'project' }[view];
    var viewLabel = { overview: '情报', signal: '早期信号', demand: '需求', project: '项目', opportunity: '机会' }[view];
    var filtered = active.filter(function (item) {
      return (!country || (item.occurrence_countries || []).includes(country)) && (!radar || (item.radars || []).includes(radar));
    });
    document.querySelectorAll('[data-region]').forEach(function (button) { button.setAttribute('aria-pressed', button.dataset.region === group ? 'true' : 'false'); });
    var visibleOpportunities = periodOpportunities.filter(function (item) { return !country || (item.occurrence_countries || []).includes(country); });
    byId('candidate-filter-status').textContent = filters.elements.group.selectedOptions[0].textContent + ' · ' + filters.elements.country.selectedOptions[0].textContent + ' · ' + filters.elements.view.selectedOptions[0].textContent + ' · ' + filters.elements.period.selectedOptions[0].textContent + ' · '
      + (view === 'opportunity' ? visibleOpportunities.length + ' 条有原文依据的机会' : filtered.length + ' 条情报');
    var importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort(function (left, right) {
      return (importanceOrder[left.importance] ?? 9) - (importanceOrder[right.importance] ?? 9)
        || Date.parse(right.updated_at || 0) - Date.parse(left.updated_at || 0);
    });
    var displayed = view === 'overview' ? filtered.slice(0, 8) : filtered;
    if (view === 'overview') byId('candidate-filter-status').textContent += '；先显示其中 ' + displayed.length + ' 条重点，其他内容可从上方分类进入';
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
      var evidenceBadgeNames = { unverified: '有原文，待复核', sourced: '有原文', checked: '已比对多份原文', conflict: '原文有冲突', corrected: '已根据新原文更正' };
      badge.textContent = evidenceBadgeNames[candidate.evidence_status] || candidate.evidence_status;
      row.append(heading, badge);
      var meta = document.createElement('p');
      meta.className = 'intel-source-meta';
      var radarNames = { trigger: '早期信号', demand: '需求', project: '项目' };
      var importanceNames = { low: '低', medium: '中', high: '高', critical: '重大' };
      var evidenceNames = { unverified: '单一来源待复核', sourced: '原文引文已核对', checked: '多份原文已比对', conflict: '原文之间有冲突', corrected: '已根据新原文更正' };
      var maturityNames = { background: '研究背景', signal: '研究中', demand: '需求形成', project: '项目组织', opportunity: '机会评估', procurement: '采购开放', contract: '已授标/签约' };
      var countryNames = regionNames;
      meta.textContent = (candidate.occurrence_countries || []).map(function (value) { return countryNames[value] || value; }).join('、') +
        ' · ' + (candidate.radars || []).map(function (value) { return radarNames[value] || value; }).join(' / ') +
        ' · 重要性 ' + (importanceNames[candidate.importance] || candidate.importance) + ' · ' + (maturityNames[candidate.maturity] || candidate.maturity) +
        ' · ' + (evidenceNames[candidate.evidence_status] || candidate.evidence_status);
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '原文发布：' + publicationLabel(candidate.source_timing) + ' · 情报更新：' + dateLabel(candidate.updated_at);
      item.append(row, meta, timing);
      if (view === 'signal' && candidate.resilience_signal) {
        var signalChain = document.createElement('ol');
        signalChain.className = 'intel-signal-chain';
        renderResilienceChain(signalChain, candidate.resilience_signal, candidate.summary_zh, candidate.next_signals_zh);
        item.append(signalChain);
      } else {
        var decision = document.createElement('div');
        decision.className = 'intel-decision-grid';
        var change = document.createElement('section');
        change.className = 'intel-decision-change';
        change.innerHTML = '<strong>发生了什么</strong><p></p>';
        change.querySelector('p').textContent = candidate.summary_zh;
        decision.append(change);
        if (candidate.why_it_matters_zh) {
          var why = document.createElement('section');
          why.innerHTML = '<strong>为什么重要</strong><p></p>';
          why.querySelector('p').textContent = candidate.why_it_matters_zh;
          decision.append(why);
        }
        if ((candidate.next_signals_zh || []).length) {
          var next = document.createElement('section');
          next.innerHTML = '<strong>下一步观察</strong><p></p>';
          next.querySelector('p').textContent = candidate.next_signals_zh[0];
          decision.append(next);
        } else if ((candidate.unknowns_zh || []).length) {
          var unknown = document.createElement('section');
          unknown.innerHTML = '<strong>仍需确认</strong><p></p>';
          unknown.querySelector('p').textContent = candidate.unknowns_zh[0];
          decision.append(unknown);
        }
        if (decision.children.length) item.append(decision);
      }
      var evidenceLink = document.createElement('a');
      evidenceLink.className = 'intel-evidence-link';
      evidenceLink.textContent = '打开情报详情与原文证据 →';
      setSourceLink(evidenceLink, candidate.source_id);
      item.append(evidenceLink);
      (candidate.related_sources || []).forEach(function (related, index) {
        var relatedLink = document.createElement('a');
        relatedLink.className = 'intel-evidence-link';
        relatedLink.textContent = (related.relation === 'conflicts' ? '查看冲突来源 ' : '查看关联来源 ') + (index + 2) + ' →';
        setSourceLink(relatedLink, related.source_id);
        item.append(relatedLink);
      });
      (candidate.grouped_sources || []).forEach(function (source) {
        if (source.source_id === candidate.source_id || (candidate.related_sources || []).some(function (link) { return link.source_id === source.source_id; })) return;
        var groupedLink = document.createElement('a');
        groupedLink.className = 'intel-evidence-link';
        groupedLink.textContent = '查看同范围关联链中的原文 →';
        setSourceLink(groupedLink, source.source_id);
        item.append(groupedLink);
      });
      list.append(item);
    });
    var opportunityView = view === 'opportunity';
    list.hidden = opportunityView;
    byId('candidate-explainer').hidden = opportunityView;
    byId('candidate-empty').hidden = opportunityView || filtered.length !== 0;
    byId('candidate-empty').textContent = country || radar ? '当前筛选没有匹配的情报；不代表当地没有市场变化。可返回区域全景查看其他内容。'
      : '当前没有符合条件的情报。背景资料会保留在来源层，不会为填满页面自动创建项目或机会。';
    byId('opportunities-section').hidden = !opportunityView;
    renderOverviewOpportunities(periodOpportunities, country);
  }
  function renderOverviewOpportunities(opportunities, country) {
    var list = byId('overview-opportunities');
    list.replaceChildren();
    var scopes = { early: '早期机会', equipment: '设备包', service: '服务包' };
    var states = { unverified: '待验证，未披露采购开放', public_tender_open: '采购开放已披露，参与资格待核',
      package_awarded: '该包已授标或签约', cancelled: '该包已取消' };
    var visible = opportunities.filter(function (entry) { return !country || (entry.occurrence_countries || []).includes(country); });
    visible.forEach(function (entry) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      setSourceLink(link, entry.source_id);
      link.textContent = (scopes[entry.scope] || '包件') + '：' + entry.package_name_zh;
      var meta = document.createElement('p');
      meta.textContent = (entry.title_zh || '来源未命名') + ' · ' + (states[entry.participation_status] || states.unverified)
        + (entry.scope === 'early' ? ' · 关联待验证假设，详情见来源' : '');
      var quote = document.createElement('blockquote');
      quote.textContent = '事实 ' + entry.evidence_fact_number + '，原文：“' + entry.evidence_quote + '”';
      var timing = document.createElement('p');
      timing.className = 'intel-source-meta';
      timing.textContent = '原文发布：' + publicationLabel(entry.source_timing) + ' · 机会更新：' + dateLabel(entry.updated_at);
      item.append(link, meta, timing, quote);
      if (entry.related_sources && entry.related_sources.length) {
        var related = document.createElement('p');
        related.textContent = '同包件证据关联（各来源状态独立）：';
        entry.related_sources.forEach(function (source, index) {
          if (index) related.append('、');
          var sourceLink = document.createElement('a');
          setSourceLink(sourceLink, source.source_id);
          sourceLink.textContent = '来源' + (index + 1) + '：' + (states[source.participation_status] || states.unverified);
          related.append(sourceLink);
        });
        item.append(related);
      }
      list.append(item);
    });
    byId('overview-opportunities-empty').hidden = visible.length !== 0;
  }
  async function loadCoverage() {
    try {
      var data = await api('coverage');
      var list = byId('region-coverage'); list.replaceChildren();
      regions.countries.forEach(function (region) {
        var entries = data.fixed_sources.filter(function (entry) { return entry.country === region.code; });
        var search = data.search_countries.includes(region.code);
        var tasks = data.items.filter(function (item) { return item.item_key === 'discover:' + region.code || entries.some(function (entry) { return item.item_key === 'registry:' + entry.id; }); });
        var label = !search && !entries.length ? '待接入' : !data.run ? '已启用 · 等待当天计划' : !tasks.length ? '已启用 · 待轮转采集'
          : tasks.some(function (item) { return ['failed', 'retry', 'budget_paused', 'manual_paused'].includes(item.status); }) ? '入口有失败或暂停 · 存在缺口'
          : ['budget_paused', 'manual_paused'].includes(data.run.status) ? '当天计划已暂停 · 存在缺口'
          : tasks.some(function (item) { return item.status !== 'succeeded'; }) ? '入口任务尚未完成' : '当天入口已处理 · 不代表全市场覆盖';
        var row = document.createElement('li'), name = document.createElement('strong'), value = document.createElement('span');
        var pending = tasks.reduce(function (sum, item) { return sum + (Number(item.pending) || 0); }, 0);
        name.textContent = region.name; value.textContent = label + (pending ? ' · 当前入口待补收 ' + pending + ' 条链接' : ''); row.append(name, value); list.append(row);
        var option = byId('candidate-filters').elements.country.querySelector('option[value="' + region.code + '"]');
        if (option) option.textContent = region.name + (!search && !entries.length ? ' · 待接入' : '');
      });
      byId('coverage-status').textContent = data.day + '（北京时间）· 仅反映搜索与固定入口任务；正文与分析的失败请查看采集流程。';
    } catch (error) { byId('coverage-status').textContent = '覆盖状态读取失败，请刷新重试；不能据此判断各地区没有情报。'; }
  }

  var workflowData, workflowPage = 0;
  var taskStates = { running: '执行中', queued: '排队', retry: '待重试', failed: '失败', budget_paused: '预算暂停', manual_paused: '人工暂停', succeeded: '成功' };
  var taskStages = { discover: '区域搜索', registry: '固定公告入口', watchsearch: '主动证据搜索', source: '原文抓取', watchsource: '关注来源抓取', extract: '情报分析', cross: '跨来源核对', hypothesis: '假设与反证判断' };
  var taskErrors = { source_tls_error: '来源站点证书校验失败', source_listing_page: '这是目录页，未作为正文分析', source_empty_document: '没有可读取的正文，未调用模型', source_failed: '原文获取失败', source_not_found: '原公告已下线或网址失效', source_access_denied: '来源拒绝自动访问', source_dns_error: '来源域名无法解析', source_timeout: '原文获取超时', source_rate_limited: '来源站点限流', discovery_no_primary_sources: '没有找到符合要求的官方页面', discovery_failed: '来源搜索失败', model_timeout: '模型请求超时', model_rate_limited: '模型服务限流', extraction_failed: '情报提取或证据校验失败', cross_check_failed: '跨来源核对失败', hypothesis_failed: '假设判断失败', watch_search_failed: '主动证据搜索失败', budget_exhausted: '调用预算不足', budget_not_configured: '尚未配置调用预算', billing_sync_pending: '等待账单同步', source_paused: '此发布方已暂停自动采集', lease_exhausted: '多次执行超时，已停止自动重试', registry_no_links: '没有读到公告链接，需要核查入口', upstream_unavailable: '数据服务暂时不可用', storage_failed: '原文保存失败' };
  function taskDescription(item) {
    var countries = regionNames;
    var stage = item.item_key.split(':')[0];
    return item.title || item.object_zh || item.name || (stage === 'discover' ? (countries[item.country || item.item_key.split(':')[1]] || '') + '官方来源搜索' : item.url || '来源资料处理');
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
      document.querySelector('.intel-nav a[href="/intelligence/workflow"]').setAttribute('aria-current', 'page');
      byId('workflow-date').textContent = data.day + ' · 当天任务';
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
      [['全部任务', data.items.length]].concat(Object.keys(taskStates).map(function (key) { return [taskStates[key], counts[key] || 0]; })).forEach(function (pair) {
        var box = document.createElement('div'), number = document.createElement('strong'), label = document.createElement('span');
        number.textContent = pair[1]; label.textContent = pair[0]; box.append(number, label); boxes.append(box);
      });
      renderWorkflowTasks();
      status('page-status', '已读取数据库任务记录。' + (data.changed_during_read ? '运行仍在变化，此次记录不用于判定完成。' : ''));
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
    byId('scheduler-state').textContent = result.scheduler_enabled ? '已开放；每次触发推进一项发现、抓取、提取或核对任务，未完成任务可跨天续跑' : '未启用；不会自动调用来源发现服务';
    var countryNames = regionNames;
    var fixedCountries = result.fixed_source_countries || [];
    var missingCountries = Object.keys(countryNames).filter(function (code) { return !fixedCountries.includes(code); });
    byId('fixed-source-coverage').textContent = '已登记固定公告入口：' + (fixedCountries.map(function (code) { return countryNames[code]; }).filter(Boolean).join('、') || '暂无')
      + '。' + (missingCountries.length ? missingCountries.map(function (code) { return countryNames[code]; }).join('、') + '暂无固定入口；未接入地区不自动安排搜索；' : '已登记范围均有固定入口；')
      + '入口实际抓取结果以任务记录为准。';
    var archiveStates = { disabled: '尚未启用云端归档入口，待归档原件继续保留在云端。',
      missing_token: '归档凭据尚未配置，节点暂时无法连接。', read_only: '当前部署只读，不能领取或确认归档任务。',
      enabled: '云端入口已启用；仍需归档节点实际拉取并校验，不代表原件已经完成归档。' };
    byId('archive-state').textContent = archiveStates[result.archive_status] || '归档状态尚未确认。';
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
      status('notification-settings-status', result.delivery_enabled ? '设置已读取。已在发送中的消息不受随后修改影响。' : '设置已读取。飞书发送尚未启用；保存静默时间不会启用发送。');
    } catch (error) { status('notification-settings-status', error.message, 'error'); }
  }
  async function loadOverview() {
    status('page-status', '正在读取情报…');
    try {
      var result = await api('overview');
      if (result.user?.email) byId('account-email').textContent = result.user.email;
      overviewLoaded = true;
      overviewCandidates = result.candidates;
      overviewOpportunities = result.opportunities || [];
      renderOverview(result.candidates);
      var visibleCount = result.candidates.filter(function (item) {
        return item.disposition === 'candidate' && item.review_status !== 'rejected';
      }).length;
      status('page-status', '已载入 ' + visibleCount + ' 条情报记录（含历史及日期待核验条目）；下方统计与列表按所选原文发布时间筛选。');
    } catch (error) {
      status('page-status', error.message, 'error');
      status('candidate-filter-status', '情报读取失败，请刷新重试。', 'error');
      byId('source-only-count').textContent = '背景资料尚未读取';
      document.querySelectorAll('.intel-country-state').forEach(function (item) { item.textContent = '尚未取得数据'; });
    }
  }
  async function loadOperations() {
    try { renderOperations(await api('operations')); }
    catch (error) { status('automation-status', error.message, 'error'); }
  }
  async function loadSourceControls() {
    try {
      var result = await api('source-controls');
      var list = byId('source-controls');
      list.replaceChildren();
      result.sources.forEach(function (source) {
        var item = document.createElement('li');
        var label = document.createElement('p');
        label.textContent = source.name + ' · ' + (source.paused ? '已暂停自动抓取' : '自动抓取已开启');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'intel-button intel-button-quiet';
        button.textContent = source.paused ? '恢复此来源' : '暂停此来源';
        button.disabled = !result.writable;
        button.addEventListener('click', async function () {
          button.disabled = true;
          try {
            var saved = await api('save-source-control', { registry_id: source.id, paused: !source.paused });
            await loadSourceControls();
            status('source-controls-status', source.paused ? '已恢复此来源；最近计划日有 ' + saved.resumed + ' 项任务重新排队。' : '已暂停此来源的后续自动抓取。其他来源继续运行。', 'success');
          } catch (error) { status('source-controls-status', error.message, 'error'); button.disabled = false; }
        });
        item.append(label, button);
        list.append(item);
      });
    } catch (error) { status('source-controls-status', error.message, 'error'); }
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
    var names = { unspecified: '范围未细分', development_rights: '开发权', ppa: '购电协议', epc: 'EPC 总包', construction_contract: '施工合同', equipment: '设备包', service: '服务包' };
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
    var scopes = { early: '早期机会', equipment: '设备包', service: '服务包' };
    var states = { unverified: '待验证，未披露采购开放', public_tender_open: '采购开放已披露，参与资格待核',
      package_awarded: '该包已授标或签约', cancelled: '该包已取消' };
    opportunities.forEach(function (entry) {
      var item = document.createElement('li');
      var hypothesis = entry.scope === 'early' ? (hypotheses || []).find(function (row) { return row.id === entry.hypothesis_id; }) : null;
      var earlyStatus = hypothesis && ({ rejected: '关联假设已否定，停止追踪', dormant: '关联假设休眠，停止主动追踪',
        confirmed: '关联假设已证实，待关联正式机会' })[hypothesis.status];
      var title = document.createElement('strong');
      title.textContent = (scopes[entry.scope] || '包件') + '：' + entry.package_name_zh + ' · '
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
  var followupForm = byId('followup-form');
  var followupRevision = 0;
  var followupCandidate = null;
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
    followupRevision = watch?.revision || 0;
    followupForm.hidden = !data.eligible;
    byId('followup-editor').hidden = !data.eligible;
    byId('followup-editor-label').textContent = watch ? '更新计划、记录结果或调整状态' : '加入持续跟踪';
    if (location.hash === '#followup-section') byId('followup-editor').open = true;
    Array.from(fields).forEach(function (field) { field.disabled = data.writable === false; });
    if (!data.eligible) { status('followup-status', '这条来源尚未形成可跟踪的业务情报，请先查看或生成中文分析。'); return; }
    var value = watch?.followup || { reason: '', next_action: '', exit_condition: '', outcome: '', exit_reason: '', priority: 'normal', review_on: new Date((beijingToday() + 7) * 86400000).toISOString().slice(0, 10) };
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
    status('followup-status', data.writable === false ? '当前环境只读。' : watch ? '已读取保存的跟踪计划。' : '填写后保存，即可加入“我的跟踪”。');
  }
  async function loadFollowup(id) { renderFollowup(await api('followup', undefined, id)); }
  if (followupForm) {
    followupForm.elements.namedItem('status').addEventListener('change', function () { followupForm.elements.namedItem('exit_reason').required = this.value !== 'active'; });
    followupForm.elements.namedItem('priority').addEventListener('change', function () {
      followupForm.elements.namedItem('review_on').value = new Date((beijingToday() + ({ high: 1, normal: 7, low: 30 }[this.value])) * 86400000).toISOString().slice(0, 10);
    });
    byId('followup-reload').addEventListener('click', async function () {
      if (!window.confirm('重新读取会替换表单里尚未保存的内容。继续吗？')) return;
      try { await loadFollowup(location.pathname.match(detailPath)[1]); }
      catch (error) { status('followup-status', error.message, 'error'); }
    });
    followupForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = Object.fromEntries(new FormData(followupForm)); body.revision = followupRevision;
      Array.from(followupForm.elements).forEach(function (field) { field.disabled = true; });
      status('followup-status', '正在保存跟踪计划…');
      try {
        var id = location.pathname.match(detailPath)[1];
        var saved = await api('save-followup', body, id);
        followupRevision = saved.watch.revision;
        try { await loadFollowup(id); status('followup-status', saved.watch.status === 'active' ? '跟踪已保存。建议仍需你实际执行并记录结果。' : '已移出活跃跟踪，原因与历史保留，可随时恢复。', 'success'); }
        catch { status('followup-status', '已保存，但历史读取暂时失败。请重新读取已保存记录。', 'success'); }
      } catch (error) { status('followup-status', error.message + ' 表单内容已保留。', 'error'); }
      finally { Array.from(followupForm.elements).forEach(function (field) { field.disabled = false; }); }
    });
  }
  var followupsOffset = 0;
  async function loadFollowups() {
    var scope = byId('followups-state'), previous = byId('followups-prev'), next = byId('followups-next');
    scope.disabled = previous.disabled = next.disabled = byId('followups-refresh').disabled = true;
    try {
      var result = await api('followups&state=' + scope.value + '&offset=' + followupsOffset);
      var list = byId('followups-list'); list.replaceChildren();
      result.items.forEach(function (watch) {
        var item = document.createElement('li'), link = document.createElement('a'), f = watch.followup;
        link.href = '/intelligence/sources/' + encodeURIComponent(watch.candidate.source_id) + '#followup-section';
        link.textContent = watch.candidate.title_zh; item.append(link);
        paragraph(item, '优先级：' + priorityLabels[f.priority] + ' · 复核：' + f.review_on + '（北京时间）' + (watch.status === 'active' && f.review_on <= new Date(beijingToday() * 86400000).toISOString().slice(0, 10) ? ' · 待复核' : ''), 'intel-source-meta');
        paragraph(item, '下一步：' + f.next_action + '\n理由：' + f.reason);
        if (watch.status !== 'active') paragraph(item, '原因：' + f.exit_reason);
        paragraph(item, '最近人工记录：' + dateLabel(watch.updated_at), 'intel-source-meta');
        list.append(item);
      });
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
        location.replace('/intelligence/overview');
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
      ['group', 'country', 'topic', 'view', 'period'].forEach(function (name) {
        var control = candidateFilters.elements[name], value = filterParams.get(name) || '';
        control.value = name === 'period' ? '30' : name === 'view' ? 'overview' : '';
        if (Array.from(control.options).some(function (option) { return option.value === value; })) control.value = value;
      });
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
    document.querySelectorAll('.intel-nav [data-view], .intel-radar-summary a').forEach(function (link) {
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
      if (country && candidateFilters.elements.group.value && country.group !== candidateFilters.elements.group.value) {
        if (event.target.name === 'group') candidateFilters.elements.country.value = ''; else candidateFilters.elements.group.value = country.group;
      }
      applyCandidateFilters();
    });
    document.querySelectorAll('[data-region]').forEach(function (button) { button.addEventListener('click', function () {
      candidateFilters.elements.group.value = button.dataset.region; candidateFilters.elements.country.value = ''; applyCandidateFilters();
    }); });
    candidateFilters.addEventListener('submit', function (event) { event.preventDefault(); });
    candidateFilters.addEventListener('reset', function (event) {
      event.preventDefault();
      candidateFilters.elements.group.value = ''; candidateFilters.elements.topic.value = ''; candidateFilters.elements.country.value = ''; candidateFilters.elements.view.value = 'overview'; candidateFilters.elements.period.value = '30';
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
  if (byId('source-controls')) loadSourceControls();
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
      renderBusinessHistory(result.business_history || []);
      renderOpportunities(result.candidate?.opportunities || [], result.candidate?.opportunity_history || [], result.candidate?.tracking?.hypotheses || []);
      } catch (error) { status('extraction-status', error.message, 'error'); }
      finally { extractButton.disabled = false; }
    });
  }
  (async function () {
    try {
      if (byId('followups-list')) { await loadFollowups(); return; }
      if (byId('workflow-tasks')) { await loadWorkflow(); return; }
      if (overviewList) { loadCoverage(); await loadOverview(); return; }
      var session = await api('session');
      byId('account-email').textContent = session.user.email;
      var match = location.pathname.match(detailPath);
      if (match) await loadDetail(match[1]);
      else if (importForm) await loadSources();
      else if (providerForms.length) await Promise.all([loadProviderSettings(), loadOperations()]);
    } catch (error) { status('page-status', error.message, 'error'); }
  })();
})();
