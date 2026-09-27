const regions = require('./regions.json');
const { primaryHosts } = require('./discovery.cjs');

function page(title, content, authenticated = false, email = '') {
  const account = String(email || '已登录').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title} · NRGOPT Energy Intelligence</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/intelligence.css?v=20260927-followup-actions">
  <script id="intelligence-regions" type="application/json">${JSON.stringify(regions)}</script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/intelligence.js?v=20260927-followup-actions" defer></script>
</head>
<body class="intelligence-app">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="intel-header">
    <a class="nav-logo" href="/">NRG<span class="primary">OPT</span></a>
    <span class="intel-private">Energy Intelligence · 私有空间</span>
    ${authenticated ? '<nav class="intel-nav" aria-label="情报模块"><a href="/intelligence/overview">总览</a><a href="/intelligence/discover">发现情报</a><a href="/intelligence/followups">我的跟踪</a><a href="/intelligence/settings">管理</a></nav>' : ''}
    <div class="intel-tools">
      ${authenticated ? '<span id="account-email" class="intel-account">' + account + '</span><button id="logout-button" class="intel-button intel-button-quiet" type="button">退出</button>' : ''}
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

function workbenchPage(email = '') {
  return page('情报工作台', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <div class="intel-section-heading"><div><h1>今天值得关注什么</h1><p class="intel-intro">发现变化，作出判断，再持续跟进。先处理到期事项，也可以从一条新情报开始。</p></div><button id="workbench-refresh" class="intel-button" type="button">刷新</button></div>
    <p id="workbench-period" class="intel-source-meta"></p><p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取工作台…</p>
    <nav class="intel-workbench-shortcuts" aria-label="今天的工作"><a href="#workbench-new-section">01 新发现</a><a href="#workbench-updates-section">02 跟踪有更新</a><a href="#workbench-due-section">03 需要处理</a></nav>
    <section class="intel-panel" id="workbench-new-section"><div class="intel-section-heading"><div><p class="intel-kicker">发现 → 判断</p><h2>新发现</h2></div><a href="/intelligence/discover">浏览全部情报 →</a></div><p class="intel-muted">今天首次收录、原文发布在近30天内，且你尚未选择跟踪或暂缓的情报。收录时间不是事件发生时间，重新分析不会刷新首次收录时间。</p><ul id="workbench-new" class="intel-workbench-list"></ul></section>
    <section class="intel-panel" id="workbench-updates-section"><div class="intel-section-heading"><div><p class="intel-kicker">新证据 → 重新判断</p><h2>跟踪有更新</h2></div><a href="/intelligence/followups">查看我的跟踪 →</a></div><p class="intel-muted">你上次保存计划或结果后，出现了支持、削弱或反证判断。请核对原文，AI判断不等于事实已确认，也不代表你已行动。</p><ul id="workbench-updates" class="intel-workbench-list"></ul></section>
    <section class="intel-panel" id="workbench-due-section"><div class="intel-section-heading"><div><p class="intel-kicker">复核 → 记录结果</p><h2>需要处理</h2></div><a href="/intelligence/followups">管理跟踪计划 →</a></div><p class="intel-muted">已到复核日期或存在原文冲突的活跃跟踪。复核日期由你设定，不是采购截止日；真实截止信息仍须核对原公告。</p><ul id="workbench-due" class="intel-workbench-list"></ul></section>
    <p class="intel-muted">没有新情报不代表市场没有变化。<a href="/intelligence/workflow">查看当天采集进度与缺口</a></p>
  `, true, email);
}

function followupsPage(email = '') {
  return page('我的跟踪', `
    <p class="intel-eyebrow">从情报到行动</p><h1>我的跟踪</h1>
    <p class="intel-intro">先处理到期或有冲突的事项，再看新证据判断，其余按复核日排列。每个事项保留理由、下一步和结果；由你决定继续、暂缓或退出。</p>
    <div class="intel-section-heading"><label>查看范围<select id="followups-state"><option value="active">正在跟踪</option><option value="expired">暂不关注 / 暂缓</option><option value="completed">已退出</option></select></label><button id="followups-refresh" class="intel-button">刷新</button></div>
    <p id="page-status" class="intel-status" role="status" aria-live="polite"></p>
    <ul id="followups-list" class="intel-analysis-list"></ul>
    <div class="intel-actions"><button id="followups-prev" class="intel-button" disabled>上一页</button><span id="followups-page"></span><button id="followups-next" class="intel-button" disabled>下一页</button></div>
    <p class="intel-muted">主动跟踪按高／普通／低优先级，以1／7／30天间隔进入候选队列；复核到期后每天待查。有待验证假设时使用现有证据搜索，每天最多5组，预算或排队可能延后。固定公告入口仍按原计划采集。没有消息或采集失败不代表没有价值。AI 建议不代表你已执行，更不会自动联系外部对象。</p>`, true, email);
}

function followupForm() {
  return `<section id="followup-section" class="intel-panel" aria-labelledby="followup-title">
    <div class="intel-section-heading"><div><p class="intel-kicker">从情报到行动</p><h2 id="followup-title">我的下一步与处理结果</h2></div><a href="/intelligence/followups">查看我的跟踪</a></div>
    <p class="intel-muted">先确认跟踪理由和下一步。系统可用已有分析填入草稿；只有你点击保存后才生效，实际结果保持空白，等行动后再记录。</p>
    <p id="followup-status" class="intel-status" role="status" aria-live="polite">正在读取跟踪记录…</p>
    <p id="followup-summary" class="intel-caution" hidden></p>
    <details id="followup-editor"><summary id="followup-editor-label">确认跟踪计划</summary>
    <form id="followup-form" hidden>
      <div class="intel-followup-grid">
        <label>为什么值得跟进<textarea name="reason" maxlength="600" rows="3" required></textarea></label>
        <label>下一验证问题或行动<textarea name="next_action" maxlength="240" rows="3" required></textarea></label>
        <label>优先级<select name="priority"><option value="high">高 · 尽快复核</option><option value="normal" selected>普通</option><option value="low">低 · 降低复核频率</option></select></label>
        <label>下次复核日期（北京时间）<input type="date" name="review_on" required></label>
        <label>什么条件下退出<textarea name="exit_condition" maxlength="600" rows="3" required></textarea></label>
        <label>最近实际处理结果（未行动可留空）<textarea name="outcome" maxlength="2000" rows="3" placeholder="只记录实际做过的事情、得到的结果或复核结论"></textarea></label>
        <label>跟踪状态<select name="status"><option value="active">正在跟踪</option><option value="expired">暂缓，等待复核</option><option value="completed">退出活跃列表</option></select></label>
        <label>暂缓、退出或恢复的原因<textarea name="exit_reason" maxlength="600" rows="3" placeholder="退出时写明依据及适用环节；某次投标结束不代表整个项目结束"></textarea></label>
      </div>
      <p class="intel-muted">优先级会建议1／7／30天后的复核日，可手动调整；到期只提示待复核。无新消息、抓取失败均不能自动判为无价值。退出后可在“已退出”中恢复；情报分类列表仍保留历史来源。</p>
      <div class="intel-followup-actions"><button id="followup-save" class="intel-button intel-button-primary" type="submit">保存跟踪</button><button id="followup-reload" class="intel-button" type="button" aria-describedby="followup-reload-help">放弃保存</button></div>
      <p id="followup-save-status" class="intel-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <p id="followup-reload-help" class="intel-muted">放弃本次对跟踪理由、下一步、复核日期、状态和处理结果等字段的修改，回到已保存的跟踪计划。已保存记录和情报原文不受影响。</p>
    </form>
    </details>
    <section id="followup-evidence" hidden><h3>相对上次人工记录的证据变化</h3><p id="followup-evidence-note" class="intel-muted"></p><ul id="followup-evidence-list" class="intel-analysis-list"></ul></section>
    <details id="followup-history" hidden><summary>查看人工处理历史</summary><p class="intel-muted">保留最近100次记录，更早历史仍在数据库保留。</p><ul id="followup-history-list" class="intel-analysis-list"></ul></details>
  </section>`;
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

function overviewPage(email = '') {
  const countries = regions.countries.map(item => [item.code, item.name, item.english]);
  return page('发现情报', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <h1 id="overview-title">发现情报</h1>
    <p id="overview-period" class="intel-source-meta"></p>
    <p id="overview-intro" class="intel-intro">寻找值得跟进的变化。按地区、类型和原文日期筛选，打开详情判断价值，再决定是否加入跟踪。</p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p>
    <p id="recency-status" class="intel-muted"></p>
    <p class="intel-muted">当前范围分类统计：同一条情报可同时属于早期信号、需求和项目，分类数量不能相加。机会单独计数，一条情报可关联多个机会。</p>
    <section class="intel-radar-summary" aria-label="当前范围分类统计">
      <a href="/intelligence/discover?view=signal"><strong id="radar-trigger-count">—</strong><span>早期信号</span><small>区域变化如何影响能源韧性</small></a>
      <a href="/intelligence/discover?view=demand"><strong id="radar-demand-count">—</strong><span>需求</span><small>谁需要解决什么问题</small></a>
      <a href="/intelligence/discover?view=project"><strong id="radar-project-count">—</strong><span>项目</span><small>项目进展到哪一步</small></a>
      <a href="/intelligence/discover?view=opportunity"><strong id="opportunity-count">—</strong><span>机会</span><small>哪些环节可能参与</small></a>
    </section>
    <div class="intel-country-heading"><p class="intel-kicker">区域全景</p><div class="intel-country-title-row"><h2>中东和北非能源情报（MENA）</h2><span id="source-only-count" class="intel-background-count">正在读取背景资料…</span></div></div>
    <p class="intel-country-description intel-muted">按原文支持的发生国家归类，同一条跨国情报可出现在多个国家。下方数量随当前内容类型切换；情报条目不代表已人工核实。</p>
    <div class="intel-region-tabs" aria-label="地区快捷分组"><button type="button" data-region="" aria-pressed="true">全部</button>${Object.entries(regions.groups).map(([code, name]) => `<button type="button" data-region="${code}" aria-pressed="false">${name}</button>`).join('')}</div>
    <p class="intel-muted">本产品约定24个国家或地区；不代表统一的MENA地理定义。西撒哈拉地位有争议，单列追踪；埃及只计一次。跨境专题单列，不计入国家数量。</p>
    <details class="intel-panel"><summary>查看各地区采集接入与缺口</summary><p class="intel-muted">“待接入”表示自动采集尚未启用，不表示没有市场变化。入口处理成功也不代表全市场覆盖；详细失败见采集流程。</p><p id="coverage-status" role="status">正在读取入口状态…</p><ul id="region-coverage" class="intel-region-coverage"></ul></details>
    <div class="intel-list-heading"><div><p id="candidate-kicker" class="intel-kicker">决策摘要</p><h2 id="candidate-heading">近30天 · 重点变化</h2></div><a class="intel-button intel-button-quiet" href="/intelligence/sources">查看全部来源</a></div>
    <form id="candidate-filters" class="intel-panel">
      <div class="intel-settings-grid">
        <label>地区分组<select name="group"><option value="">全部地区</option>${Object.entries(regions.groups).map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}</select></label>
        <label>发生国家/地区<select name="country"><option value="">全部国家/地区</option>${countries.map(([code, zh]) => `<option value="${code}">${zh}</option>`).join('')}</select></label>
        <label>跨境专题<select name="topic"><option value="">全部（专题不计入国家数量）</option>${Object.entries(regions.topics).map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}</select></label>
        <label>内容类型<select name="view"><option value="overview">全部变化</option><option value="signal">早期信号</option><option value="demand">需求</option><option value="project">项目</option><option value="opportunity">机会</option></select></label>
        <label>原文发布时间<select name="period"><option value="30">近30天</option><option value="90">近90天</option><option value="all">全部（含历史资料）</option><option value="unknown">日期待核验</option></select></label>
      </div>
      <p id="candidate-filter-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p>
      <button type="reset" class="intel-button intel-button-quiet">返回区域全景</button>
      <p class="intel-muted">按事件发生地筛选；受影响地区在详情单列。跨国情报在全局统计中只计一次。</p>
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
        <article><strong>早期信号</strong><p>监管、安全、产业、公共服务、气候灾害或基础设施变化，只有能说明具体能源影响路径时才进入。</p></article>
        <article><strong>需求</strong><p>业主或设施形成的供能缺口，用来回答“谁需要解决什么问题”。</p></article>
        <article><strong>项目</strong><p>有明确项目证据的进展，用来回答“项目到了哪一步”。</p></article>
      </div>
      <p class="intel-stage">同一条情报可以出现在多个视图。进入视图表示值得持续关注，不等于采购已经开放。</p>
    </details>
  `, true, email);
}

function workflowPage(email = '') {
  return page('采集流程与当天任务', `
    <p class="intel-eyebrow">自动采集 · 运行记录</p>
    <h1>采集流程与当天任务</h1>
    <p class="intel-intro">每天北京时间 00:00 起建立新计划，云端逐项处理。无需保持网页、电脑或聊天窗口打开；采集结果会陆续进入情报页面。</p>
    <p><a href="#workflow-date">直接查看当天任务 ↓</a></p>
    <ol class="intel-workflow-steps" aria-label="自动采集流程">
      <li><span>01 · 定时检查</span><h2>云端每分钟检查</h2><p>Supabase 的 pg_cron 检查是否需要推进任务。有任务正在执行、等待重试时间或已暂停时，不会重复启动调用。</p></li>
      <li><span>02 · 先建任务</span><h2>登记当天采集计划</h2><p>首次需要运行时，调用 Vercel 上的采集程序，先在数据库建立当天任务：已启用地区的搜索、固定公告入口、关注来源与主动证据搜索。</p></li>
      <li><span>03 · 逐项推进</span><h2>抓取、分析和核对</h2><p>每次调用领取一项可执行任务，保存结果和状态。发现新链接会追加抓取，抓取后可追加分析与证据判断；并非每个任务都调用 AI。</p></li>
      <li><span>04 · 汇总与通知</span><h2>对账结果，发送通知</h2><p>任务逐项结束后汇总当天结果。飞书由独立的每分钟检查处理待发通知，受免打扰时段约束；发送成功的通知不会再次发送。</p></li>
    </ol>
    <details class="intel-panel intel-workflow-guide" open><summary>怎样判断当天任务结束？</summary>
      <p>没有排队、执行中、待重试或暂停的任务，且当天计划已汇总为终态，才显示“已结束”。全部成功则显示“全部成功”；有失败则显示“已结束 · 有失败”或“已结束 · 全部失败”。失败记录保留，不等于这一天没有运行。</p>
      <p>预算暂停、人工暂停都不算完成。可重试任务通常最多尝试 3 次，间隔等待后继续；其他任务仍可推进。一天可能运行数小时，没有固定结束时刻，未完成任务可以跨天续跑。</p>
      <p>任务总数会随新链接与分析结果增加，因此不显示预计完成百分比。成功指这一项处理成功，不保证发现新情报；若后续补入任务，已结束的计划也可能重新运行。</p>
      <p>通知发送和原件归档另有队列，采集结束不代表它们全部完成。这里展示当天计划下的任务，后续人工回补若追加到同一计划也会列入，不代表增加自然计划运行日。</p>
    </details>
    <section class="intel-panel intel-workflow-today" aria-labelledby="workflow-date">
      <div class="intel-section-heading"><h2 id="workflow-date">当天任务</h2><button type="button" class="intel-button intel-button-quiet" id="workflow-refresh">刷新任务状态</button></div>
      <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取当天任务…</p>
      <p id="workflow-summary" class="intel-workflow-summary"></p>
      <p id="workflow-time" class="intel-muted"></p>
      <p class="intel-muted">时间统一为北京时间（UTC+8）。这是读取时的记录；点击刷新只更新显示，不触发采集或 AI 调用。午夜后刷新会切换到新一天；任务执行时状态和数量仍会变化。</p>
      <div id="workflow-counts" class="intel-workflow-counts" aria-label="当天任务状态统计"></div>
      <form id="workflow-filters" class="intel-settings-grid">
        <label>任务状态<select name="state"><option value="">全部状态</option><option value="unfinished">全部未完成</option><option value="running">执行中</option><option value="queued">排队</option><option value="retry">待重试</option><option value="failed">失败</option><option value="budget_paused">预算暂停</option><option value="manual_paused">人工暂停</option><option value="succeeded">成功</option></select></label>
        <label>处理环节<select name="stage"><option value="">全部环节</option><option value="discover">地区搜索</option><option value="registry">固定公告入口</option><option value="watchsearch">主动证据搜索</option><option value="source">原文抓取</option><option value="watchsource">关注来源抓取</option><option value="extract">情报分析</option><option value="cross">跨来源核对</option><option value="hypothesis">假设与反证判断</option></select></label>
        <label>查找任务<input name="search" type="search" placeholder="输入来源、网址或失败原因"></label>
      </form>
      <p id="workflow-list-status" class="intel-muted" role="status" aria-live="polite"></p>
      <ol id="workflow-tasks" class="intel-workflow-tasks" aria-label="当天任务列表"></ol>
      <div class="intel-workflow-pager"><button id="workflow-prev" type="button" class="intel-button intel-button-quiet" disabled>上一页</button><span id="workflow-page"></span><button id="workflow-next" type="button" class="intel-button intel-button-quiet" disabled>下一页</button></div>
    </section>
  `, true, email);
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

function settingsPage(email = '') {
  return page('运行与设置', `
    <p class="intel-eyebrow">私有管理</p>
    <h1>运行与设置</h1>
    <p class="intel-intro">这里集中显示自动运行、覆盖、通知和服务配置。日常阅读情报不需要处理这些内容。</p>
    <nav class="intel-management-links" aria-label="管理快捷入口"><a class="intel-button" href="/intelligence/workflow">采集流程与当天任务</a><a class="intel-button" href="/intelligence/sources">情报来源与手动导入</a></nav>
    <section class="intel-panel intel-operations" aria-labelledby="operations-title">
      <h2 id="operations-title">系统运行状态</h2>
      <p id="automation-status" class="intel-status">正在读取运行状态…</p>
      <dl class="intel-facts intel-operation-facts">
        <dt>调度入口</dt><dd id="scheduler-state">读取中</dd>
        <dt>原件归档</dt><dd id="archive-state">读取中</dd>
        <dt>调用预算</dt><dd id="budget-state">读取中</dd>
        <dt>飞书通知</dt><dd id="notification-state">读取中</dd>
      </dl>
      <p id="fixed-source-coverage" class="intel-muted">正在读取区域固定来源覆盖…</p>
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
      <h2 id="notification-settings-title">通知免打扰</h2>
      <p class="intel-muted">在指定时段暂停发送通知，结束后再陆续发送。网站情报更新和自动采集照常进行。</p>
      <fieldset class="intel-quiet-fields" aria-labelledby="notification-settings-title" disabled>
        <label class="intel-quiet-check"><input name="quiet_enabled" type="checkbox" checked><span>每天启用免打扰</span></label>
        <div class="intel-quiet-times">
          <label>暂停通知时间<select name="quiet_start_hour">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${hour === 23 ? ' selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <label>恢复通知时间<select name="quiet_end_hour">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${hour === 7 ? ' selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <label>使用时区<select name="timezone"><option value="Asia/Shanghai">北京时间（UTC+8）</option><option value="Asia/Riyadh">沙特时间（UTC+3）</option><option value="Asia/Dubai">阿联酋时间（UTC+4）</option><option value="UTC">UTC</option></select></label>
        </div>
        <p id="notification-schedule-summary" class="intel-quiet-summary" aria-live="polite">正在读取免打扰时段…</p>
        <label class="intel-quiet-check"><input name="flash_breaks_quiet" type="checkbox"><span>重大提醒仍可发送<span class="intel-field-help">仅重大提醒（FLASH）可在免打扰时段发送；日报和系统告警仍延后。</span></span></label>
        <button class="intel-button intel-button-primary" type="submit">保存通知设置</button>
      </fieldset>
      <p id="notification-settings-status" class="intel-status" role="status" aria-live="polite">正在读取通知设置…</p>
    </form>
    <section class="intel-panel"><h2>配置历史与调用记录</h2><p class="intel-muted">最近 30 个配置版本及 30 次调用。记录服务、模型、预算和调用用量，不保存历史密钥。调用用量不是费用；旧调用未记录版本的，不补猜。</p><h3>配置版本</h3><ul id="provider-versions" class="intel-analysis-list"></ul><h3>调用记录</h3><ul id="provider-calls" class="intel-analysis-list"></ul><p id="provider-history-status" class="intel-status" role="status"></p></section>
    <section class="intel-notice"><h2>固定来源暂停与恢复</h2><p>暂停后，该发布方的新自动抓取会停止，其他发布方继续运行。已开始的请求会完成，已保存资料仍可分析，手动导入不受影响。恢复会补跑最近一个计划日被此开关暂停的任务，历史暂停记录保留。</p><ul id="source-controls" class="intel-analysis-list"></ul><p id="source-controls-status" class="intel-status" role="status" aria-live="polite"></p></section>
  `, true, email);
}

function sourcesPage({ detailId = null, email = '' } = {}) {
  const content = detailId ? `
    <a class="intel-back" href="/intelligence/discover">← 发现情报</a> · <a href="/intelligence/overview">返回总览</a>
    <p class="intel-eyebrow">理解变化 → 判断价值 → 决定下一步</p>
    <h1 id="detail-title">情报详情</h1>
    <p class="intel-intro">先了解变化和可能影响，再核对未知项。原文与历史保留在下方；你可以据此选择跟踪、暂缓或退出。</p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite"></p>
    <article id="source-detail" hidden>
      <dl class="intel-classification-fields intel-time-summary" aria-label="情报时间">
        <div><dt>原文发布时间</dt><dd id="detail-published-at"></dd></div>
        <div><dt>系统采集时间</dt><dd id="detail-fetched-at"></dd></div>
        <div><dt>分析更新时间</dt><dd id="detail-analyzed-at"></dd></div>
      </dl>
      <p class="intel-muted">判断时效请看原文发布时间；采集或重新分析不会改变原文日期。仅有日期时不补造具体时刻，事件发生时间以原文为准。</p>
      <section class="intel-panel" id="decision-brief" hidden>
        <p id="decision-recency" class="intel-caution" hidden></p>
        <div class="intel-decision-steps">
          <section><p class="intel-kicker">01 · 来源披露</p><h2>发生了什么</h2><p id="decision-change"></p></section>
          <section><p class="intel-kicker">02 · 能源影响</p><h2>为什么值得关注</h2><p id="decision-impact"></p><p class="intel-muted">影响分析是待验证判断，事实依据见下方原文。</p></section>
          <section><p class="intel-kicker">03 · 当前判断</p><h2>证据支持到哪一步</h2><p id="decision-confidence"></p><ul id="decision-unknowns"></ul></section>
          <section><p class="intel-kicker">04 · 下一步</p><h2>先确认什么</h2><p id="decision-next"></p><p id="decision-deadline" class="intel-source-meta"></p></section>
        </div>
        <div class="intel-decision-actions"><button id="decision-track" class="intel-button intel-button-primary" type="button" disabled>加入跟踪</button><button id="decision-defer" class="intel-button" type="button" disabled>暂不关注</button></div>
        <p id="decision-saved" class="intel-muted" role="status"></p>
        <a class="intel-decision-evidence" href="#detail-evidence">核对原文与分析 ↓</a>
      </section>
      ${followupForm()}
      <div class="intel-detail-heading">
        <div><span id="source-status" class="intel-badge"></span><span class="intel-stage-note">原件状态</span></div>
        <a id="evidence-download" class="intel-button" hidden>下载原件</a>
      </div>
      <details id="detail-evidence" class="intel-panel intel-analysis"><summary>05 · 核对原文、完整分析与证据</summary>
        <div class="intel-section-heading">
          <div><p class="intel-kicker">情报分析服务 · 单一来源分析</p><h2>中文情报与证据</h2></div>
          <button id="extract-button" class="intel-button intel-button-primary" type="button">生成中文初析</button>
        </div>
        <p class="intel-muted">模型只分析已保存的公开来源。每条已知事实必须附原文摘录并通过精确匹配；来源间的内容比对不等于独立确认；转载和相同引文不能累计为独立证据。</p>
        <p id="extraction-status" class="intel-status" role="status" aria-live="polite"></p>
        <div id="extraction-content" hidden>
          <p id="extraction-recency" class="intel-caution" hidden></p>
          <div class="intel-analysis-lead"><p class="intel-kicker">发生了什么</p><p id="extraction-summary"></p></div>
          <div class="intel-analysis-grid">
            <section><h3>为什么值得关注</h3><p id="extraction-importance"></p></section>
            <section><h3>与所在地区的关系</h3><p id="extraction-relevance"></p></section>
          </div>
          <section id="extraction-classification" class="intel-classification" hidden>
            <h3>业务分类与发生区域</h3>
            <dl id="extraction-classification-summary" class="intel-classification-fields"></dl>
            <p id="extraction-classification-note" hidden></p>
            <section id="extraction-resilience-section" hidden>
              <h3>区域变化与能源韧性路径</h3>
              <ol id="extraction-resilience-chain" class="intel-signal-chain"></ol>
            </section>
            <div id="extraction-classification-evidence" class="intel-analysis-grid">
              <section id="extraction-project-section" hidden><h3>项目证据候选</h3><p id="extraction-project"></p></section>
              <section id="extraction-procurement-section" hidden><h3>采购证据候选</h3><p id="extraction-procurement"></p></section>
            </div>
          </section>
          <section><h3>已知事实与原文证据</h3><ul id="extraction-facts" class="intel-analysis-list"></ul></section>
          <section><h3>关联来源与比对依据</h3><p class="intel-muted">下列关联保留来源和事实编号。网站数量不等于独立证据数量；引文相同可能来自同一消息。</p><ul id="extraction-related-sources" class="intel-analysis-list"></ul><p id="related-sources-empty" class="intel-muted"></p></section>
          <section><h3>数值与口径</h3><p class="intel-muted">以下是来源披露值，已绑定原文，不代表已独立证实。功率与能量、IT与设施负荷、各期项目及金额口径分别保留，不自动相加、换算或取最大值。</p><ul id="extraction-numeric-facts" class="intel-analysis-list"></ul><p id="numeric-facts-empty" class="intel-muted"></p></section>
          <section><h3>项目进展与采购进展</h3><p class="intel-muted">项目开发、购电协议、工程承包和设备采购可能处于不同阶段，需要分别核实。某项合同已签订，不代表其他设备或服务采购机会已经结束。</p><ul id="extraction-commercial-events" class="intel-analysis-list"></ul><p id="commercial-events-note" class="intel-muted"></p></section>
          <p id="fact-context-issues" class="intel-caution" hidden></p>
          <div class="intel-analysis-grid">
            <section><h3>仍然未知</h3><ul id="extraction-unknowns" class="intel-analysis-list"></ul></section>
            <section><h3>下一观察信号</h3><ul id="extraction-signals" class="intel-analysis-list"></ul></section>
          </div>
          <section id="extraction-hypotheses-section"><h3>待验证假设</h3><p class="intel-muted">系统会用后续来源寻找支持和反证。展开判断记录可查看中文理由与原文；日期不明确时只记录判断，不自动改状态。假设及其状态均为分析判断，不等于已知事实。</p><ul id="extraction-hypotheses" class="intel-analysis-list"></ul></section>
          <p id="extraction-caution" class="intel-caution"></p>
          <p id="extraction-meta" class="intel-muted"></p>
        </div>
      </details>
      <section class="intel-panel" id="project-timeline-section" hidden>
        <h2>同一项目的跨来源记录</h2>
        <p class="intel-muted">只有核对为相同完整项目范围的来源才会关联。按公告日期排列，日期不明的单列在后；每个阶段保留各自引文，不把不同期次或组合与子项目合并。</p>
        <p id="project-identity" class="intel-muted"></p>
        <ol id="project-timeline" class="intel-analysis-list"></ol>
      </section>
      <section id="business-history-section" class="intel-panel" hidden><h2>项目与采购事项的历史记录</h2><p class="intel-muted">这里分别记录项目进展，以及开发权、购电协议、工程承包、设备采购和服务采购的变化。显示的日期为系统记录时间；本次未提及，不代表该事项已取消。不同来源中名称相同的事项仍需核对，不会自动合并。</p><ul id="business-history" class="intel-analysis-list"></ul></section>
      <section id="opportunities-section" class="intel-panel" hidden><h2>可参与机会</h2><p class="intel-muted">早期参与方向来自原文事实和待验证判断，不代表已开放采购。设备采购和服务采购机会需有原文依据，参与前还须核对资格。工程总承包已确定，不代表设备采购已结束；本次未提及的事项，也不能视为已取消。状态记录时间是系统分析时间，不是公告发布时间。</p><ul id="opportunities-list" class="intel-analysis-list"></ul></section>
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
        <p id="source-language-note" class="intel-source-language">来源原文 · 中文初析尚未生成</p>
      </section>
      <div class="intel-panel">
        <h2>来源与证据</h2>
        <dl class="intel-facts">
          <dt>原始链接</dt><dd id="source-requested-url"></dd>
          <dt>最终链接</dt><dd id="source-final-url"></dd>
          <dt>系统采集时间</dt><dd id="source-fetched-at"></dd>
          <dt>原文发布时间</dt><dd id="source-published-at"></dd>
          <dt>发布时间依据</dt><dd id="source-publication-evidence"></dd>
          <dt>文件类型</dt><dd id="source-content-type"></dd>
          <dt>文件大小</dt><dd id="source-byte-size"></dd>
          <dt>内容 SHA-256</dt><dd id="source-sha256" class="intel-hash"></dd>
        </dl>
        <p id="source-error" class="intel-status" hidden></p>
      </div>
      <details class="intel-panel intel-source-copy">
        <summary>查看来源原文摘录</summary>
        <p class="intel-muted">以下为来源原文片段，仅供核对；它不是中文摘要，也不代表内容已被独立证实。</p>
        <blockquote id="source-excerpt" class="intel-excerpt"></blockquote>
      </details>
      <div class="intel-notice"><h2>系统下一步</h2><p>系统将继续寻找独立来源进行交叉验证，并监控融资、招标、授标、合同和投运等后续信号。发现矛盾时会标记“来源冲突”，由你决定是否进一步查看。</p></div>
    </article>` : `
    <p class="intel-eyebrow">原始发布 · 情报依据</p>
    <h1>情报来源</h1>
    <p class="intel-intro">查阅情报依据的原始发布，也可以搜索官方信息或补充已知网页。</p>
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
          ${regions.countries.filter(item => primaryHosts[item.code]?.length).map(item => `<option value="${item.code}">${item.name}</option>`).join('')}
        </select>
        <button class="intel-button intel-button-primary" type="submit">搜索官方来源</button>
      </div>
      <p class="intel-muted">仅列出已接入官方搜索的地区。搜索结果只作为来源线索；保存后仍会重新抓取原始网页，不直接采用搜索摘要。</p>
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
  return page(detailId ? '情报详情' : '情报来源', content, true, email);
}

module.exports = { loginPage, resetPasswordPage, sourcesPage, overviewPage, settingsPage, workflowPage, followupsPage, workbenchPage };
