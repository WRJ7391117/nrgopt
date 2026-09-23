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
  <script src="/js/intelligence.js" defer></script>
</head>
<body class="intelligence-app">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="intel-header">
    <a class="nav-logo" href="/">NRG<span class="primary">OPT</span></a>
    <span class="intel-private">Energy Intelligence · 私有空间</span>
    ${authenticated ? '<nav class="intel-nav" aria-label="情报模块"><a href="/intelligence/overview">六国全景</a><a href="/intelligence">来源工作台</a><a href="/intelligence/settings">服务配置</a></nav>' : ''}
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
      <label for="email">邮箱</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="intel-button intel-button-primary" type="submit">登录</button>
      <p id="login-status" class="intel-status" role="status" aria-live="polite"></p>
    </form>`);
}

function overviewPage() {
  const countries = [
    ['SA', '沙特阿拉伯', 'Saudi Arabia'], ['AE', '阿联酋', 'United Arab Emirates'],
    ['QA', '卡塔尔', 'Qatar'], ['KW', '科威特', 'Kuwait'], ['OM', '阿曼', 'Oman'], ['BH', '巴林', 'Bahrain']
  ];
  return page('六国情报全景', `
    <p class="intel-eyebrow">G2 · 三雷达与六国全景</p>
    <h1>海合会六国情报全景</h1>
    <p class="intel-intro">六国始终同时展示。这里只统计有明确发生国证据的候选；分析相关性不会伪装成当地已发生事件。</p>
    <section class="intel-radar-guide" aria-labelledby="radar-guide-title">
      <div><p class="intel-kicker">使用说明</p><h2 id="radar-guide-title">三个雷达分别看什么？</h2></div>
      <div class="intel-radar-guide-grid">
        <article><strong>触发雷达</strong><p>关注会改变能源决策的外部变化，例如供电事件、政策规则、能源价格和资源约束。</p><span>回答：为什么现在值得关注？</span></article>
        <article><strong>需求雷达</strong><p>关注业主或设施因新增负荷、可靠性、并网、成本或碳目标形成的供能缺口。</p><span>回答：谁需要解决什么问题？</span></article>
        <article><strong>项目雷达</strong><p>关注项目从公告、可研和融资，进入招标、授标、签约、建设及投运的进展。</p><span>回答：项目到了哪一步？</span></article>
      </div>
      <p class="intel-stage">同一条情报可以同时进入多个雷达。进入雷达表示值得持续关注，不等于已经形成商业机会或订单。</p>
      <p class="intel-stage"><strong>雷达之后：</strong>机会、采购、合同和交付属于后续商业阶段，不是另外几个雷达。情报可以从任何阶段开始收录，不要求逐级升级。</p>
    </section>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取情报候选…</p>
    <section class="intel-radar-summary" aria-label="三雷达候选统计">
      <div><strong id="radar-trigger-count">0</strong><span>触发雷达</span></div>
      <div><strong id="radar-demand-count">0</strong><span>需求雷达</span></div>
      <div><strong id="radar-project-count">0</strong><span>项目雷达</span></div>
      <div><strong id="source-only-count">0</strong><span>仅保留来源</span></div>
    </section>
    <section class="intel-country-grid" aria-label="海合会六国状态">
      ${countries.map(([code, zh, en]) => `<article class="intel-country-card" data-country="${code}">
        <p class="intel-kicker">${code} · ${en}</p><h2>${zh}</h2>
        <strong class="intel-country-count">0</strong><span class="intel-muted"> 条有效候选</span>
        <p class="intel-country-state">尚未采集到有明确发生国证据的候选。</p>
      </article>`).join('')}
    </section>
    <section class="intel-panel" aria-labelledby="operations-title">
      <p class="intel-kicker">自动运行</p><h2 id="operations-title">任务与预算状态</h2>
      <p id="automation-status" class="intel-status">正在读取运行状态…</p>
      <dl class="intel-facts intel-operation-facts">
        <dt>调度入口</dt><dd id="scheduler-state">读取中</dd>
        <dt>调用预算</dt><dd id="budget-state">读取中</dd>
        <dt>飞书通知</dt><dd id="notification-state">读取中</dd>
      </dl>
      <ul id="job-list" class="intel-job-list"></ul>
      <p id="job-empty" class="intel-muted" hidden>尚无自动扫描任务。未配置预算和调度开关时，系统不会发起付费调用。</p>
    </section>
    <div class="intel-list-heading"><div><p class="intel-kicker">AI 情报结果</p><h2>三雷达候选</h2></div><a class="intel-button intel-button-quiet" href="/intelligence">查看来源库</a></div>
    <p class="intel-muted">AI 负责发现、提取和基础证据核验。点击标题即可查看来源链接、原文摘录和逐条引文；“部分事实已核对”只表示列出的事实有独立来源支持，不代表整条内容全部得到确认。你不需要逐条审批。</p>
    <ul id="candidate-list" class="intel-source-list"></ul>
    <p id="candidate-empty" class="intel-empty" hidden>当前没有三雷达候选。宏观背景会保留在来源层，不会为填满页面自动创建项目。</p>
  `, true);
}

function providerForm(capability, title, description, endpointHelp) {
  const analysis = capability === 'analysis';
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
      <label>${analysis ? '分析单次预留上限' : '搜索单次预留上限'}<input name="reserve" type="number" min="0.000001" step="0.000001" inputmode="decimal" required><span class="intel-field-help">按所选币种填写，例如 0.08。</span></label>
      ${analysis ? '<label>交叉核对单次预留上限<input name="cross_check_reserve" type="number" min="0.000001" step="0.000001" inputmode="decimal" required><span class="intel-field-help">两条来源自动核对时的调用上限。</span></label>' : ''}
      <label class="intel-settings-wide">API Key<input name="api_key" type="password" maxlength="8192" autocomplete="new-password" placeholder="首次保存必须填写；以后留空表示保持现有密钥"><span class="intel-field-help">密钥只发送到本站服务器并加密保存，页面不会再次显示。</span></label>
    </div>
    <div class="intel-form-footer"><span class="intel-muted">保存后，下一次调用立即使用这组配置。</span><button class="intel-button intel-button-primary" type="submit">保存${title}</button></div>
    <p id="${capability}-settings-status" class="intel-status" role="status" aria-live="polite"></p>
  </form>`;
}

function settingsPage() {
  return page('模型服务配置', `
    <p class="intel-eyebrow">PRIVATE ADMIN · SERVER-SIDE CONFIG</p>
    <h1>模型服务配置</h1>
    <p class="intel-intro">在这里决定系统使用哪家 API。来源发现与情报分析可以使用不同服务商、模型和币种；中国模型按人民币预算，美国模型按美元预算。</p>
    <div class="intel-notice"><h2>密钥如何保存</h2><p>API Key 是只写字段：保存后只能看到“已配置”，不能从网页或接口读回完整密钥。更换密钥时重新填写即可。</p></div>
    <p id="settings-page-status" class="intel-status" role="status" aria-live="polite">正在读取当前配置…</p>
    ${providerForm('discovery', '来源发现服务', '负责联网寻找政府、采购方、业主和项目公司的原始发布。', '当前适配 Anthropic Messages 格式，并要求服务端支持 web_search 工具。')}
    ${providerForm('analysis', '情报分析服务', '负责把已保存的原文提取为中文事实、三雷达分类和逐条引文。', '当前适配 Chat Completions JSON 格式。')}
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
        <p class="intel-muted">模型只分析已保存的公开来源。每条已知事实必须附原文摘录并通过精确匹配；独立来源尚未一致前，会明确标为“未交叉验证”。</p>
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
          <div class="intel-analysis-grid">
            <section><h3>仍然未知</h3><ul id="extraction-unknowns" class="intel-analysis-list"></ul></section>
            <section><h3>下一观察信号</h3><ul id="extraction-signals" class="intel-analysis-list"></ul></section>
          </div>
          <section id="extraction-hypotheses-section"><h3>待验证假设</h3><ul id="extraction-hypotheses" class="intel-analysis-list"></ul></section>
          <p id="extraction-caution" class="intel-caution"></p>
          <p id="extraction-meta" class="intel-muted"></p>
        </div>
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
        <button class="intel-button intel-button-primary" type="submit">搜索最新官方来源</button>
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

module.exports = { loginPage, sourcesPage, overviewPage, settingsPage };
