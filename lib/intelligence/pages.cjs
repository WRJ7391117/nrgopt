function page(title, content, authenticated = false) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title} · NRGOPT Energy Intelligence</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/intelligence.css">
  <script src="/js/theme.js" defer></script>
  <script src="/js/intelligence.js?v=20260926-prd-navigation" defer></script>
</head>
<body class="intelligence-app">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="intel-header">
    <a class="nav-logo" href="/">NRG<span class="primary">OPT</span></a>
    <span class="intel-private">Energy Intelligence · 私有空间</span>
    ${authenticated ? '<nav class="intel-nav" aria-label="情报模块"><a data-view="overview" href="/intelligence/overview">总览</a><a data-view="signal" href="/intelligence/overview?view=signal">早期信号</a><a data-view="demand" href="/intelligence/overview?view=demand">需求</a><a data-view="project" href="/intelligence/overview?view=project">项目</a><a data-view="opportunity" href="/intelligence/overview?view=opportunity">机会</a><span class="intel-nav-divider" aria-hidden="true"></span><a href="/intelligence">来源与导入</a><a href="/intelligence/settings">管理</a></nav>' : ''}
    <div class="intel-tools">
      ${authenticated ? '<span id="account-email" class="intel-account"></span><button id="logout-button" class="intel-button intel-button-quiet" type="button">退出</button>' : ''}
      <button id="themeBtn" class="theme-toggle" type="button" aria-label="切换主题">
        <svg id="themeIcon" viewBox="0 0 24 24" aria-hidden="true"></svg>
      </button>
    </div>
  </header>
  <main id="main" class="intel-main${authenticated ? '' : ' intel-login'}" tabindex="-1">
    ${content}
    <noscript><p class="intel-notice">请启用 JavaScript 后登录并查看来源。</p></noscript>
  </main>
</body>
</html>`;
}

function loginPage() {
  return page('登录', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <h1>登录情报空间</h1>
    <p class="intel-intro">使用已获授权的账号查看来源与证据。</p>
    <form id="login-form" class="intel-panel" method="post" action="/api/intelligence?action=login">
      <p class="intel-muted">请使用情报模块管理员邮箱和密码。Supabase 控制台账号及数据库密码不能登录此页面。</p>
      <label for="email">邮箱</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="intel-button intel-button-primary" type="submit">登录</button>
      <button id="reset-request-button" class="intel-button intel-button-quiet" type="button">忘记密码？发送重置邮件</button>
      <p id="login-status" class="intel-status" role="status" aria-live="polite"></p>
    </form>`);
}

function resetPasswordPage() {
  return page('重置密码', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <h1>设置新密码</h1>
    <p class="intel-intro">为情报空间管理员账号设置新的登录密码。</p>
    <form id="reset-password-form" class="intel-panel" method="post" action="/api/intelligence?action=reset-password">
      <label for="new-password">新密码</label>
      <input id="new-password" name="password" type="password" minlength="6" autocomplete="new-password" required>
      <label for="confirm-password">再次输入新密码</label>
      <input id="confirm-password" name="confirm-password" type="password" minlength="6" autocomplete="new-password" required>
      <button class="intel-button intel-button-primary" type="submit">保存新密码</button>
      <p id="reset-password-status" class="intel-status" role="status" aria-live="polite"></p>
      <a href="/intelligence/login">返回登录</a>
    </form>`);
}

function overviewPage() {
  const countries = [
    ['SA', '沙特阿拉伯', 'Saudi Arabia'], ['AE', '阿联酋', 'United Arab Emirates'],
    ['QA', '卡塔尔', 'Qatar'], ['KW', '科威特', 'Kuwait'], ['OM', '阿曼', 'Oman'], ['BH', '巴林', 'Bahrain']
  ];
  return page('六国情报全景', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <h1 id="overview-title">本期值得关注的能源变化</h1>
    <p id="overview-intro" class="intel-intro">先看重要变化，再进入早期信号、需求、项目或机会。所有判断都可以回到来源和原文证据。</p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p>
    <section class="intel-radar-summary" aria-label="情报概况">
      <a href="/intelligence/overview?view=signal"><strong id="radar-trigger-count">0</strong><span>早期信号</span><small>为什么现在值得关注</small></a>
      <a href="/intelligence/overview?view=demand"><strong id="radar-demand-count">0</strong><span>需求</span><small>谁需要解决什么问题</small></a>
      <a href="/intelligence/overview?view=project"><strong id="radar-project-count">0</strong><span>项目</span><small>项目进展到哪一步</small></a>
      <a href="/intelligence/overview?view=opportunity"><strong id="opportunity-count">0</strong><span>机会</span><small>哪些环节可能参与</small></a>
    </section>
    <div class="intel-list-heading intel-country-heading"><div><p class="intel-kicker">六国全景</p><h2>海合会市场状态</h2></div><span id="source-only-count" class="intel-muted">正在读取背景资料…</span></div>
    <p class="intel-muted">六国始终同时展示。这里只统计有明确发生国证据的情报；分析相关性不会伪装成当地已发生事件。</p>
    <section class="intel-country-grid" aria-label="海合会六国状态">
      ${countries.map(([code, zh, en]) => `<button class="intel-country-card" type="button" data-country="${code}">
        <p class="intel-kicker">${code} · ${en}</p><h2>${zh}</h2>
        <strong class="intel-country-count">0</strong><span class="intel-muted"> 条有效情报</span>
        <p class="intel-country-state">尚未形成有明确发生国证据的情报。</p>
      </button>`).join('')}
    </section>
    <div class="intel-list-heading"><div><p id="candidate-kicker" class="intel-kicker">决策摘要</p><h2 id="candidate-heading">本期重点变化</h2></div><a class="intel-button intel-button-quiet" href="/intelligence">查看全部来源</a></div>
    <form id="candidate-filters" class="intel-panel">
      <div class="intel-settings-grid">
        <label>发生国家<select name="country"><option value="">全部六国</option>${countries.map(([code, zh]) => `<option value="${code}">${zh}</option>`).join('')}</select></label>
        <label>内容类型<select name="view"><option value="overview">全部变化</option><option value="signal">早期信号</option><option value="demand">需求</option><option value="project">项目</option><option value="opportunity">机会</option></select></label>
      </div>
      <p id="candidate-filter-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p>
      <button type="reset" class="intel-button intel-button-quiet">返回六国全景</button>
      <p class="intel-muted">国家筛选只改变下方内容，上方六国卡片始终保留全景。同一条情报可以同时属于多个业务阶段。</p>
    </form>
    <p id="candidate-explainer" class="intel-muted">按更新时间和重要性排列。点击标题可查看为什么重要、已知与未知、假设与反证、下一观察信号及逐条原文证据。</p>
    <ul id="candidate-list" class="intel-source-list"></ul>
    <p id="candidate-empty" class="intel-empty" hidden>当前视图没有符合条件的情报。</p>
    <section id="opportunities-section" class="intel-panel" hidden>
      <h2>可参与环节与待验证机会</h2>
      <p class="intel-muted">“待验证”表示尚未披露采购开放；采购、授标和合同状态必须有对应原文。这里展示可继续研究的参与环节，不把项目存在直接当成我们的订单。</p>
      <ul id="overview-opportunities" class="intel-analysis-list"></ul>
      <p id="overview-opportunities-empty" class="intel-muted" hidden>当前窗口没有带原文依据的机会。早期需求仍继续跟踪，不自动编造采购机会。</p>
    </section>
    <details class="intel-radar-guide">
      <summary>这些分类是什么意思？</summary>
      <div class="intel-radar-guide-grid">
        <article><strong>早期信号</strong><p>可能改变能源决策的外部变化，用来回答“为什么现在值得关注”。</p></article>
        <article><strong>需求</strong><p>业主或设施形成的供能缺口，用来回答“谁需要解决什么问题”。</p></article>
        <article><strong>项目</strong><p>有明确项目证据的进展，用来回答“项目到了哪一步”。</p></article>
      </div>
      <p class="intel-stage">同一条情报可以出现在多个视图。进入视图表示值得持续关注，不等于采购已经开放。</p>
    </details>
  `, true);
}

function providerForm(capability, title, description, endpointHelp) {
  return `<form class="intel-panel intel-provider-form" data-capability="${capability}" method="post" action="/api/intelligence?action=save-provider-settings">
    <div class="intel-section-heading">
      <div><p class="intel-kicker">${capability === 'discovery' ? '来源发现' : '情报分析'}</p><h2>${title}</h2></div>
      <span id="${capability}-key-state" class="intel-badge">正在读取配置</span>
    </div>
    <p class="intel-muted">${description}</p>
    <div class="intel-settings-grid">
      <label>服务商标识<input name="provider" maxlength="64" autocomplete="off" placeholder="例如：my-provider" required></label>
      <label>模型名称<input name="model" maxlength="160" autocomplete="off" placeholder="填写 API 使用的模型名称" required></label>
      <label class="intel-settings-wide">API 地址<input name="endpoint" type="url" maxlength="500" autocomplete="off" placeholder="https://…" aria-describedby="${capability}-endpoint-help" required></label>
      <p id="${capability}-endpoint-help" class="intel-muted intel-settings-wide">${endpointHelp}</p>
      <label>计费币种<select name="currency" required><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></label>
      <label>计费方式<select name="billing_mode" required><option value="balance">按量扣费（读取供应商余额）</option><option value="included">已购套餐（不按次记金额）</option></select><span class="intel-field-help">由你按实际购买方式选择；系统不会根据 token 自行估算金额。目前已适配 DeepSeek 官方余额接口，尚未接入逐笔账单。</span></label>
      <label>每月金额上限<input name="budget_limit" type="number" min="0.01" step="0.01" inputmode="decimal" required><span class="intel-field-help">这是该服务一个自然月内可以使用的总金额；达到上限后自动停止。</span></label>
      <label class="intel-settings-wide">API Key<input name="api_key" type="password" maxlength="8192" autocomplete="new-password" placeholder="首次保存必须填写；以后留空表示保持现有密钥"><span class="intel-field-help">密钥只发送到本站服务器并加密保存，页面不会再次显示。</span></label>
    </div>
    <div class="intel-form-footer"><span class="intel-muted">保存后，下一次调用立即使用这组配置。</span><button class="intel-button intel-button-primary" type="submit">保存${title}</button></div>
    <p id="${capability}-settings-status" class="intel-status" role="status" aria-live="polite"></p>
  </form>`;
}

function settingsPage() {
  return page('运行与设置', `
    <p class="intel-eyebrow">私有管理</p>
    <h1>运行与设置</h1>
    <p class="intel-intro">这里集中显示自动运行、覆盖、通知和服务配置。日常阅读情报不需要处理这些内容。</p>
    <section class="intel-panel intel-operations" aria-labelledby="operations-title">
      <h2 id="operations-title">系统运行状态</h2>
      <p id="automation-status" class="intel-status">正在读取运行状态…</p>
      <dl class="intel-facts intel-operation-facts">
        <dt>调度入口</dt><dd id="scheduler-state">读取中</dd>
        <dt>原件归档</dt><dd id="archive-state">读取中</dd>
        <dt>调用预算</dt><dd id="budget-state">读取中</dd>
        <dt>飞书通知</dt><dd id="notification-state">读取中</dd>
      </dl>
      <p id="fixed-source-coverage" class="intel-muted">正在读取六国固定来源覆盖…</p>
      <details class="intel-job-details"><summary>查看最近计划日和故障诊断明细</summary><ul id="job-list" class="intel-job-list"></ul><p id="job-empty" class="intel-muted" hidden>尚无自动扫描任务。</p></details>
    </section>
    <div class="intel-list-heading"><div><p class="intel-kicker">服务配置</p><h2>模型、预算与通知</h2></div></div>
    <p class="intel-muted">以下设置只在更换服务、调整预算或排查通知时使用。</p>
    <div class="intel-notice"><h2>金额以哪里为准</h2><p>DeepSeek 显示官方账户余额的累计减少额，不是逐次调用账单，也不一定全部来自本网站。充值、退款、其他应用调用和延迟扣账都会影响对账，精确消费金额以服务商账单为准。系统不根据 token 估算费用。</p><p>已购套餐不按次记金额；这不表示套餐免费，也不表示剩余额度无限。月度上限用于约束本系统后续调用；余额延迟更新时，无法保证服务商实际扣费绝不越过上限。</p></div>
    <div class="intel-notice"><h2>密钥如何保存</h2><p>API Key 是只写字段：保存后只能看到“已配置”，不能从网页或接口读回完整密钥。更换密钥时重新填写即可。</p></div>
    <p id="settings-page-status" class="intel-status" role="status" aria-live="polite">正在读取当前配置…</p>
    ${providerForm('discovery', '来源发现服务', '负责联网寻找政府、采购方、业主和项目公司的原始发布。', 'MiniMax Coding Plan 请使用 https://api.minimaxi.com/v1/coding_plan/search，模型名称填 coding-plan-search（搜索服务标识，不调用聊天模型）。需要套餐对应的密钥和搜索额度。其他服务仍支持带服务端 web_search 的 Anthropic Messages 格式。')}
    ${providerForm('analysis', '情报分析服务', '负责把已保存的原文提取为中文事实、三雷达分类和逐条引文。', '当前适配 Chat Completions JSON 格式。')}
    <form id="notification-settings-form" class="intel-panel" method="post" action="/api/intelligence?action=save-notification-settings">
      <h2>通知静默时间</h2><p class="intel-muted">静默期间消息保留在队列，结束后由后续通知任务发送，不消耗重试次数。开始时间包含在内，结束时间不包含；静默不影响网站内容和自动采集。</p>
      <fieldset disabled><div class="intel-settings-grid">
        <label><input name="quiet_enabled" type="checkbox" checked>启用静默时间</label>
        <label>时区<select name="timezone"><option value="Asia/Shanghai">北京时间（UTC+8）</option><option value="Asia/Riyadh">沙特时间（UTC+3）</option><option value="Asia/Dubai">阿联酋时间（UTC+4）</option><option value="UTC">UTC</option></select></label>
        <label>开始小时（0—23）<input name="quiet_start_hour" type="number" min="0" max="23" step="1" value="23" required></label>
        <label>结束小时（0—23）<input name="quiet_end_hour" type="number" min="0" max="23" step="1" value="7" required></label>
        <label class="intel-settings-wide"><input name="flash_breaks_quiet" type="checkbox">允许重大提醒（FLASH）突破静默，日报和系统告警仍延后</label>
      </div><button class="intel-button intel-button-primary" type="submit">保存通知设置</button></fieldset>
      <p id="notification-settings-status" class="intel-status" role="status" aria-live="polite">正在读取通知设置…</p>
    </form>
    <section class="intel-panel"><h2>配置历史与调用记录</h2><p class="intel-muted">最近 30 个配置版本及 30 次调用。记录服务、模型、预算和调用用量，不保存历史密钥。调用用量不是费用；旧调用未记录版本的，不补猜。</p><h3>配置版本</h3><ul id="provider-versions" class="intel-analysis-list"></ul><h3>调用记录</h3><ul id="provider-calls" class="intel-analysis-list"></ul><p id="provider-history-status" class="intel-status" role="status"></p></section>
    <section class="intel-notice"><h2>固定来源暂停与恢复</h2><p>暂停后，该发布方的新自动抓取会停止，其他发布方继续运行。已开始的请求会完成，已保存资料仍可分析，手动导入不受影响。恢复会补跑最近一个计划日被此开关暂停的任务，历史暂停记录保留。</p><ul id="source-controls" class="intel-analysis-list"></ul><p id="source-controls-status" class="intel-status" role="status" aria-live="polite"></p></section>
  `, true);
}

function sourcesPage({ detailId = null } = {}) {
  const content = detailId ? `
    <a class="intel-back" href="/intelligence">← 返回来源工作台</a>
    <p class="intel-eyebrow">来源证据 · SOURCE EVIDENCE</p>
    <h1>来源证据详情</h1>
    <p class="intel-intro">AI 已保存原始页面并生成中文情报。系统会自动确认每条引文确实存在于原文；来源链接和摘录保留在下方供你随时查看。</p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite"></p>
    <article id="source-detail" hidden>
      <div class="intel-detail-heading">
        <div><span id="source-status" class="intel-badge"></span><span class="intel-stage-note">原件状态</span></div>
        <a id="evidence-download" class="intel-button" hidden>下载原件</a>
      </div>
      <section class="intel-panel intel-analysis">
        <div class="intel-section-heading">
          <div><p class="intel-kicker">情报分析服务 · 单一来源分析</p><h2>中文情报与证据</h2></div>
          <button id="extract-button" class="intel-button intel-button-primary" type="button">生成中文初析</button>
        </div>
        <p class="intel-muted">模型只分析已保存的公开来源。每条已知事实必须附原文摘录并通过精确匹配；来源间的内容比对不等于独立确认；转载和相同引文不能累计为独立证据。</p>
        <p id="extraction-status" class="intel-status" role="status" aria-live="polite"></p>
        <div id="extraction-content" hidden>
          <div class="intel-analysis-lead"><p class="intel-kicker">发生了什么</p><p id="extraction-summary"></p></div>
          <div class="intel-analysis-grid">
            <section><h3>为什么值得关注</h3><p id="extraction-importance"></p></section>
            <section><h3>与海合会的关系</h3><p id="extraction-relevance"></p></section>
          </div>
          <section id="extraction-classification" class="intel-classification" hidden>
            <h3>三雷达与六国分类</h3><p id="extraction-classification-summary"></p>
            <div class="intel-analysis-grid">
              <section id="extraction-project-section" hidden><h3>项目证据候选</h3><p id="extraction-project"></p></section>
              <section id="extraction-procurement-section" hidden><h3>采购证据候选</h3><p id="extraction-procurement"></p></section>
            </div>
          </section>
          <section><h3>已知事实与原文证据</h3><ul id="extraction-facts" class="intel-analysis-list"></ul></section>
          <section><h3>关联来源与比对依据</h3><p class="intel-muted">下列关联保留来源和事实编号。网站数量不等于独立证据数量；引文相同可能来自同一消息。</p><ul id="extraction-related-sources" class="intel-analysis-list"></ul><p id="related-sources-empty" class="intel-muted"></p></section>
          <section><h3>数值与口径</h3><p class="intel-muted">以下是来源披露值，已绑定原文，不代表已独立证实。功率与能量、IT与设施负荷、各期项目及金额口径分别保留，不自动相加、换算或取最大值。</p><ul id="extraction-numeric-facts" class="intel-analysis-list"></ul><p id="numeric-facts-empty" class="intel-muted"></p></section>
          <section><h3>项目与包件分别到了哪一步</h3><p class="intel-muted">开发权、PPA、EPC和设备包分别看证据。一个合同落定不会自动关闭其他设备或服务机会。</p><ul id="extraction-commercial-events" class="intel-analysis-list"></ul><p id="commercial-events-note" class="intel-muted"></p></section>
          <p id="fact-context-issues" class="intel-caution" hidden></p>
          <div class="intel-analysis-grid">
            <section><h3>仍然未知</h3><ul id="extraction-unknowns" class="intel-analysis-list"></ul></section>
            <section><h3>下一观察信号</h3><ul id="extraction-signals" class="intel-analysis-list"></ul></section>
          </div>
          <section id="extraction-hypotheses-section"><h3>待验证假设</h3><p class="intel-muted">系统会用后续来源寻找支持和反证。展开判断记录可查看中文理由与原文；日期不明确时只记录判断，不自动改状态。假设及其状态均为分析判断，不等于已知事实。</p><ul id="extraction-hypotheses" class="intel-analysis-list"></ul></section>
          <p id="extraction-caution" class="intel-caution"></p>
          <p id="extraction-meta" class="intel-muted"></p>
        </div>
      </section>
      <section class="intel-panel" id="project-timeline-section" hidden>
        <h2>同一项目的跨来源记录</h2>
        <p class="intel-muted">只有核对为相同完整项目范围的来源才会关联。按公告日期排列，日期不明的单列在后；每个阶段保留各自引文，不把不同期次或组合与子项目合并。</p>
        <p id="project-identity" class="intel-muted"></p>
        <ol id="project-timeline" class="intel-analysis-list"></ol>
      </section>
      <section id="business-history-section" class="intel-panel" hidden><h2>项目与包件持续记录</h2><p class="intel-muted">本来源分别保留项目、开发权、PPA、施工、EPC、设备和服务包的记录。日期是系统记录时间，不等于市场事件日期；未再次确认不等于取消。不同来源的同名对象尚不自动合并。</p><ul id="business-history" class="intel-analysis-list"></ul></section>
      <section id="opportunities-section" class="intel-panel" hidden><h2>可参与机会</h2><p class="intel-muted">早期机会关联下方待验证假设和触发事实，不代表已开放采购；设备或服务包需要原文证据。采购开放仍需核对参与资格；EPC 授标不会自动关闭未披露的设备机会。未再次确认不等于取消。状态记录时间是系统分析时间，不是市场公告日期。</p><ul id="opportunities-list" class="intel-analysis-list"></ul></section>
      <section class="intel-panel" id="analysis-revisions-section" hidden>
        <h2>分析修订记录</h2>
        <p class="intel-muted">从启用修订记录开始保留分析版本，显示最近 50 次记录。这里的阶段变化可能是分析更正，不能直接当作项目发生了新进展；日期为模型生成时间。</p>
        <ol id="analysis-revisions" class="intel-analysis-list"></ol>
      </section>
      <section class="intel-panel" id="source-history-section" hidden>
        <h2>来源版本与阶段记录</h2>
        <p class="intel-muted">同一网址最近 50 个原件版本，按获取时间倒序排列。分别保留公告日期、该版本的阶段分析和引文；网页更新或分析变化不自动代表项目升级或官方更正。</p>
        <ol id="source-history" class="intel-analysis-list"></ol>
      </section>
      <section class="intel-panel intel-annotation">
        <div class="intel-section-heading">
          <div><p class="intel-kicker">可选补充</p><h2>我的备注</h2></div>
          <span id="annotation-time" class="intel-muted"></span>
        </div>
        <p class="intel-muted">只有当你想记录自己的业务判断时才需要填写；阅读情报不要求人工审批。</p>
        <form id="annotation-form" method="post" action="/api/intelligence?action=annotate">
          <label class="intel-sr-only" for="annotation-note">中文注释</label>
          <textarea id="annotation-note" maxlength="2000" rows="6" placeholder="例如：这是一条宏观行业背景，尚未识别出与海合会具体项目或采购的直接关联；下一步核对涉及国家、项目主体和采购信号。"></textarea>
          <div class="intel-form-footer">
            <span id="annotation-count" class="intel-muted">0 / 2000</span>
            <button class="intel-button intel-button-primary" type="submit">保存中文注释</button>
          </div>
          <p id="annotation-status" class="intel-status" role="status" aria-live="polite"></p>
        </form>
      </section>
      <section class="intel-panel">
        <p class="intel-kicker">原文标题</p>
        <h2 id="source-title">正在读取来源…</h2>
        <p id="source-language-note" class="intel-source-language">原文语言：英语 · 中文初析尚未生成</p>
      </section>
      <div class="intel-panel">
        <h2>来源与证据</h2>
        <dl class="intel-facts">
          <dt>原始链接</dt><dd id="source-requested-url"></dd>
          <dt>最终链接</dt><dd id="source-final-url"></dd>
          <dt>获取时间</dt><dd id="source-fetched-at"></dd>
          <dt>公布时间</dt><dd id="source-published-at"></dd>
          <dt>公布时间依据</dt><dd id="source-publication-evidence"></dd>
          <dt>文件类型</dt><dd id="source-content-type"></dd>
          <dt>文件大小</dt><dd id="source-byte-size"></dd>
          <dt>内容 SHA-256</dt><dd id="source-sha256" class="intel-hash"></dd>
        </dl>
        <p id="source-error" class="intel-status" hidden></p>
      </div>
      <details class="intel-panel intel-source-copy">
        <summary>查看英文原文摘录</summary>
        <p class="intel-muted">以下为来源原文片段，仅供核对；它不是中文摘要，也不代表内容已被独立证实。</p>
        <blockquote id="source-excerpt" class="intel-excerpt"></blockquote>
      </details>
      <div class="intel-notice"><h2>系统下一步</h2><p>系统将继续寻找独立来源进行交叉验证，并监控融资、招标、授标、合同和投运等后续信号。发现矛盾时会标记“来源冲突”，由你决定是否进一步查看。</p></div>
    </article>` : `
    <p class="intel-eyebrow">G2 · AI 来源发现与证据提取</p>
    <h1>来源证据工作台</h1>
    <p class="intel-intro">AI 先找到官方来源，再保存原文并生成带逐条引文的中文情报。你不需要先知道网址。</p>
    <section class="intel-guide" aria-labelledby="guide-title">
      <div><p class="intel-kicker">系统怎么工作</p><h2 id="guide-title">从官方来源到中文情报</h2></div>
      <ol>
        <li><strong>AI 发现来源</strong><span>已配置的联网来源发现服务搜索政府、采购方、业主和项目公司的原始发布。</span></li>
        <li><strong>保存原文证据</strong><span>系统抓取正文、计算指纹并保存来源链接和原件。</span></li>
        <li><strong>生成中文情报</strong><span>已配置的情报分析服务提取事实、三雷达分类和逐条原文引文。</span></li>
      </ol>
      <p class="intel-stage">搜索摘要只用于发现链接；情报内容必须来自保存后的原始网页。单一来源、多来源一致和来源冲突会分开标识。</p>
    </section>
    <form id="discovery-form" class="intel-panel" method="post" action="/api/intelligence?action=discover">
      <h2>AI 发现官方来源</h2>
      <div class="intel-import-row">
        <label class="intel-sr-only" for="discovery-country">选择国家</label>
        <select id="discovery-country" name="country">
          <option value="SA">沙特阿拉伯</option><option value="AE">阿联酋</option><option value="QA">卡塔尔</option>
          <option value="KW">科威特</option><option value="OM">阿曼</option><option value="BH">巴林</option>
        </select>
        <button class="intel-button intel-button-primary" type="submit">搜索官方来源</button>
      </div>
      <p class="intel-muted">只把搜索结果作为来源线索。保存后仍会重新抓取原始网页，不直接采用搜索摘要。</p>
      <p id="discovery-status" class="intel-status" role="status" aria-live="polite"></p>
      <ul id="discovery-results" class="intel-discovery-results"></ul>
    </form>
    <form id="import-form" class="intel-panel" method="post" action="/api/intelligence?action=import">
      <h2>手动补充来源（可选）</h2>
      <label for="source-url">公开网页网址</label>
      <div class="intel-import-row">
        <input id="source-url" name="url" type="url" autocomplete="off" placeholder="https://…" aria-describedby="import-help" required>
        <button class="intel-button intel-button-primary" type="submit">保存来源</button>
      </div>
      <p id="import-help" class="intel-muted">填写可公开访问的 HTTPS 链接，支持 UTF-8 网页或纯文本，暂不支持 PDF。只有点击“生成中文初析”时，已保存的公开来源文本才会发送给当前配置的情报分析服务。</p>
      <p id="import-status" class="intel-status" role="status" aria-live="polite"></p>
      <a id="import-detail-link" hidden>查看来源详情 →</a>
    </form>
    <div class="intel-list-heading"><div><p class="intel-kicker">待处理队列</p><h2>已保存来源</h2></div><button id="refresh-button" class="intel-button intel-button-quiet" type="button">刷新</button></div>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取来源…</p>
    <ul id="source-list" class="intel-source-list"></ul>
    <p id="empty-state" class="intel-empty" hidden>尚未采集来源。先使用 AI 搜索官方来源；也可以手动补充已知网址。</p>`;
  return page(detailId ? '来源证据详情' : '来源证据工作台', content, true);
}

module.exports = { loginPage, resetPasswordPage, sourcesPage, overviewPage, settingsPage };
