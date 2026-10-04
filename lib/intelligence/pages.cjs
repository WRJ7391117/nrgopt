const regions = require('./regions.json');
const { primaryHosts } = require('./discovery.cjs');

function journey(current = 0) {
  const steps = [
    ['directions', '设定搜集方向', '你决定关注什么'],
    ['engine', '自动搜集与核验', '系统寻找原文和证据'],
    ['discover', '查看发现', '你判断是否值得跟进'],
    ['followups', '跟踪与处理', '你记录结果，决定下一步']
  ];
  return `<nav class="intel-journey" aria-label="情报使用流程"><ol>${steps.map(([path, label, note], index) => `<li><a href="/intelligence/${path}"${current === index + 1 ? ' aria-current="step"' : ''}><span class="intel-journey-number">${index + 1}</span><span><strong>${label}</strong><small>${note}</small></span></a></li>`).join('')}</ol><p>首次使用先设定方向；日常从工作台总览处理事项。根据发现和处理结果，<a href="/intelligence/directions">返回调整搜集方向 ↺</a>。</p></nav>`;
}

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
  <link rel="stylesheet" href="/css/intelligence.css?v=20261004-engine-theme">
  <script id="intelligence-regions" type="application/json">${JSON.stringify(regions)}</script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/intelligence.js?v=20261003-compact-settings" defer></script>
</head>
<body class="intelligence-app">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="intel-header">
    <a class="nav-logo" href="/">NRG<span class="primary">OPT</span></a>
    ${authenticated ? '<nav class="intel-nav" aria-label="情报模块"><a href="/intelligence/engine">运行机制</a><a href="/intelligence/directions">情报搜集方向</a><a href="/intelligence/library">情报渠道库</a><a href="/intelligence/overview">工作台总览</a><a href="/intelligence/discover">发现情报</a><a href="/intelligence/followups">我的跟踪</a><a class="intel-nav-utility" href="/intelligence/settings">系统设置</a></nav>' : ''}
    <div class="intel-tools">
      ${authenticated ? '<span id="account-email" hidden>' + account + '</span><button id="logout-button" class="intel-button intel-button-quiet" type="button" title="当前账号：' + account + '" aria-label="退出当前账号：' + account + '">退出</button>' : ''}
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

function enginePage(email = '') {
  const steps = [
    ['①', '你设定', '设定方向与渠道', '地区、行业、企业与主题', 'directions'],
    ['②', '系统自动', '搜集原文', '搜索线索、监测渠道、保存原件', 'workflow'],
    ['③', '系统自动', '分析与核验', '匹配方向、核对引文、标明未知', 'discover'],
    ['④', '你判断', '查看与判断', '工作台总览、发现与详情', 'overview'],
    ['⑤', '人机协作', '持续跟踪与处理', '系统关注新证据，你记录计划与结果', 'followups']
  ];
  const node = (title, note, path = '', id = '') => `<div class="intel-diagram-node"${id ? ` data-diagram-node="${id}"` : ''}><strong>${title}</strong><span>${note}</span>${path ? `<a href="/intelligence/${path}">进入页面 →</a>` : ''}</div>`;
  return page('运行机制', `
    <div class="intel-engine">
      <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
      <h1>运行机制</h1>

      <section class="intel-engine-section" id="engine-workflow" aria-labelledby="engine-workflow-title">
        <h2 id="engine-workflow-title"><span class="intel-engine-number">01</span> 情报如何运转</h2>
        <p class="intel-muted">图中①至⑤是情报处理的先后关系；你决定关注范围和行动，系统负责搜集、核验与提醒。</p>
        <figure class="intel-engine-figure intel-engine-native" data-engine-diagram="flow" aria-labelledby="engine-flow-caption">
          <svg class="intel-diagram-wires" aria-hidden="true"></svg>
          <div class="intel-diagram-loop"><span>依据发现与处理结果，调整关注重点</span></div>
          <ol class="intel-diagram-flow">${steps.map(([number, role, title, note, path], i) => `<li class="intel-diagram-node" data-diagram-node="step${i + 1}"><small>${number} · ${role}</small><strong>${title}</strong><span>${note}</span><a href="/intelligence/${path}">进入页面 →</a></li>`).join('')}</ol>
          <div class="intel-diagram-branches" aria-hidden="true"></div>
          <div class="intel-diagram-delivery">
            <div class="intel-diagram-failure">${node('②/③ 失败与缺口', '原文或引文核验失败不建候选；达到告警条件才进入通知队列', '', 'failure')}</div>
            <div class="intel-diagram-notify"><div class="intel-diagram-notify-flow">${node('通知队列', '分析结果、重要变化或系统告警满足条件后入队', '', 'queue')}${node('读取推送设置', '总开关 · 接收目标 · 免打扰', 'feishu', 'settings')}${node('⑥ 飞书推送', '群聊与个人通知，记录投递结果', 'feishu', 'feishu')}</div></div>
          </div>
          <div class="intel-diagram-return">飞书卡片回链 → <a href="/intelligence/discover">打开站内情报，继续查看与判断</a></div>
          <figcaption id="engine-flow-caption">飞书推送按日报、重大变化或系统告警条件独立触发，无需先手动跟踪。虚线表示反馈与失败分支。</figcaption>
        </figure>
        <details class="intel-engine-details"><summary>查看采集执行细节</summary>
          <ol class="intel-workflow-steps" aria-label="自动采集执行细节">
            <li><span>01 · 定时检查</span><h3>云端每分钟检查</h3><p>Supabase 的 pg_cron 检查是否需要推进任务。有任务正在执行、等待重试时间或已暂停时，不会重复启动调用。</p></li>
            <li><span>02 · 先建任务</span><h3>登记当天采集计划</h3><p>首次需要运行时，调用 Vercel 上的采集程序，先在数据库建立当天任务：已启用地区的搜索、固定公告入口、关注来源与主动证据搜索。</p></li>
            <li><span>03 · 逐项推进</span><h3>抓取、分析和核对</h3><p>每次调用领取一项可执行任务，保存结果和状态。发现新链接会追加抓取，抓取后可追加分析与证据判断；并非每个任务都调用 AI。</p></li>
            <li><span>04 · 汇总与通知</span><h3>对账结果，发送通知</h3><p>任务逐项结束后汇总当天结果。飞书由独立的每分钟检查处理待发通知，受免打扰时段约束；发送成功的通知不会再次发送。</p></li>
          </ol>
        </details>
        <details class="intel-engine-details"><summary>查看原矢量图</summary><div class="intel-engine-links"><a href="/images/engine/workflow-desktop-20260928.svg" target="_blank" rel="noopener">桌面版 SVG ↗</a><a href="/images/engine/workflow-mobile-20260928.svg" target="_blank" rel="noopener">手机版 SVG ↗</a></div></details>
      </section>

      <section class="intel-engine-section" id="engine-architecture" aria-labelledby="engine-architecture-title">
        <h2 id="engine-architecture-title"><span class="intel-engine-number">02</span> 系统如何搭建</h2>
        <p class="intel-muted">从访问网站，到云端搜集、保存和分析，再由网站发送通知；各服务的职责如下。</p>
        <figure class="intel-engine-figure intel-engine-native" data-engine-diagram="architecture" aria-labelledby="engine-architecture-caption">
          <svg class="intel-diagram-wires" aria-hidden="true"></svg>
          <div class="intel-diagram-access">${node('用户浏览器', 'www.nrgopt.com', '', 'browser')}${node('域名与 DNS', '新网管理域名 · Vercel DNS 解析', '', 'dns')}</div>
          <div class="intel-diagram-access-line">访问网站与 API</div>
          <div class="intel-diagram-architecture">
            <section class="intel-diagram-group intel-diagram-vercel" data-diagram-node="vercel"><h3>Vercel <small>网页与独立采集</small></h3>${node('网站与 API', '页面、配置、情报查询；发送通知', '', 'website')}${node('独立采集服务', '取任务、抓原文、分析核验', '', 'collector')}</section>
            <div class="intel-diagram-group-link intel-diagram-supabase-link"><span>任务调度、数据读写</span></div>
            <section class="intel-diagram-group intel-diagram-supabase" data-diagram-node="supabase"><h3>Supabase <small>数据与调度</small></h3><div class="intel-diagram-group-grid">${node('Auth', '登录与身份验证')}${node('PostgreSQL', '方向、情报、任务、通知队列')}${node('Storage', '私有原件与证据')}${node('Cron / pg_net', '采集、通知、健康检查调度')}</div></section>
            <div class="intel-diagram-group-link intel-diagram-external-link"><span>采集服务调用</span></div>
            <section class="intel-diagram-group intel-diagram-external" data-diagram-node="external"><h3>外部能力 <small>公开来源与服务</small></h3>${node('MiniMax', '搜索公开线索')}${node('公开信息渠道', '机构、企业、媒体与作者')}${node('DeepSeek', '分析原文、匹配方向')}</section>
          </div>
          <div class="intel-diagram-delivery-line"><span>Supabase 每分钟调度；网站 API 按设置发送</span>${node('飞书', '群聊与个人通知', 'feishu', 'feishu')}</div>
          <div class="intel-diagram-release"><span>开发与发布</span>${node('Codex', '开发、测试与维护', '', 'codex')}${node('GitHub', '版本管理与发布', '', 'github')}${node('Vercel 部署', '网站与独立采集按变更发布', '', 'deploy')}</div>
          <figcaption id="engine-architecture-caption">云端计划不依赖个人电脑在线；开发发布链路独立于每日自动采集。</figcaption>
        </figure>
        <details class="intel-engine-details"><summary>查看原矢量图</summary><div class="intel-engine-links"><a href="/images/engine/architecture-desktop-20260928.svg" target="_blank" rel="noopener">桌面版 SVG ↗</a><a href="/images/engine/architecture-mobile-20260928.svg" target="_blank" rel="noopener">手机版 SVG ↗</a></div></details>
      </section>
      <script src="/js/intelligence-engine.js?v=20261004-engine-theme" defer></script>
    </div>
  `, true, email);
}

function workbenchPage(email = '') {
  return page('工作台总览', `
    <div class="intel-overview">
      <div class="intel-section-heading"><h1>工作台总览</h1><div class="intel-overview-controls"><label for="workbench-range">统计期间<select id="workbench-range"><option value="1">今天</option><option value="7">近7天</option><option value="30">近30天</option></select></label><button id="workbench-refresh" class="intel-button" type="button">刷新</button></div></div>
      <p id="workbench-period" class="intel-source-meta">北京时间 UTC+8</p>
      <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取工作台…</p>
      <div id="workbench-content" hidden>
        <nav class="intel-overview-metrics" aria-label="工作台概况"><a href="#workbench-new-section" id="workbench-new-metric"><span>新增情报</span><strong id="workbench-count-discoveries">—</strong><small>所选期间 · 首次收录</small></a><a href="#workbench-active-section"><span>正在跟踪</span><strong id="workbench-count-active">—</strong><small>当前 · 活跃计划</small></a><a href="#workbench-updates-section"><span>跟踪有更新</span><strong id="workbench-count-updates">—</strong><small>所选期间 · 新证据</small></a><a href="#workbench-due-section"><span>需要处理</span><strong id="workbench-count-due">—</strong><small>当前 · 到期或冲突</small></a></nav>
        <a id="workbench-alert" class="intel-overview-alert" href="/intelligence/workflow" hidden></a>
        <section class="intel-overview-section" id="workbench-actions"><div class="intel-section-heading"><div><p class="intel-kicker"><span>01 /</span>我的行动</p><h2>先处理这些事项</h2></div><a href="/intelligence/followups">查看我的跟踪 →</a></div><div class="intel-overview-actions"><div id="workbench-due-section"><h3>需要处理 <span>当前</span></h3><ul id="workbench-due" class="intel-workbench-list"></ul></div><div id="workbench-updates-section"><h3>跟踪有更新 <span>所选期间</span></h3><ul id="workbench-updates" class="intel-workbench-list"></ul></div></div><details id="workbench-active-section" class="intel-overview-details"><summary>查看正在跟踪的事项</summary><ul id="workbench-active" class="intel-workbench-list"></ul></details></section>
        <section class="intel-overview-section" aria-labelledby="workbench-highlights-title"><div class="intel-section-heading"><div><p class="intel-kicker"><span>02 /</span>新发现</p><h2 id="workbench-highlights-title">值得关注的情报</h2></div><a href="/intelligence/discover">发现情报 →</a></div><ul id="workbench-highlights" class="intel-workbench-list intel-overview-highlights"></ul>
          <details id="workbench-new-section" class="intel-overview-details"><summary id="workbench-new-label">查看本期全部新增情报</summary><p class="intel-muted">按首次收录计；原文须在近30天内且证据有效。</p><ul id="workbench-new" class="intel-workbench-list"></ul></details></section>
        <section class="intel-overview-section" id="workbench-directions-section"><div class="intel-section-heading"><div><p class="intel-kicker"><span>03 /</span>搜集成效</p><h2>方向与实际成果</h2></div><a href="/intelligence/directions">情报搜集方向 →</a></div><p id="workbench-coverage" class="intel-muted"></p><div id="workbench-directions" class="intel-overview-directions"></div><details class="intel-overview-details intel-overview-corpus"><summary>查看累计情报分类</summary><p id="workbench-corpus-note" class="intel-muted"></p><div id="workbench-distribution" class="intel-overview-distribution"></div><p class="intel-muted">历史累计，类别可能重叠；采购机会来源不等于当前可参与机会。</p></details></section>
        <section class="intel-overview-section" id="workbench-runtime"><div class="intel-section-heading"><div><p class="intel-kicker"><span>04 /</span>运行状态</p><h2>今天的搜集</h2></div><a href="/intelligence/workflow">当天任务详情 →</a></div><p id="workbench-run-status"></p><p id="workbench-run-counts" class="intel-muted"></p><ul id="workbench-failures" class="intel-analysis-list"></ul></section>
      </div>
    </div>`, true, email);
}

function followupsPage(email = '') {
  return page('我的跟踪', `
    <p class="intel-eyebrow">从情报到行动</p><h1>我的跟踪</h1>
    <p class="intel-intro">先处理到期或有冲突的事项，再看新证据判断，其余按复核日排列。每个事项保留理由、下一步和结果；由你决定继续、暂缓或退出。</p>
    ${journey(4)}
    <div class="intel-followups-toolbar"><label for="followups-state">跟踪状态<select id="followups-state"><option value="active">正在跟踪</option><option value="expired">暂不关注 / 暂缓</option><option value="completed">已退出</option></select></label><button id="followups-refresh" class="intel-button">刷新</button></div>
    <p id="page-status" class="intel-status" role="status" aria-live="polite"></p>
    <ul id="followups-list" class="intel-followups-list"></ul>
    <nav class="intel-followups-pagination" aria-label="跟踪列表分页"><button id="followups-prev" class="intel-button" disabled>上一页</button><span id="followups-page" aria-live="polite"></span><button id="followups-next" class="intel-button" disabled>下一页</button></nav>
    <aside class="intel-followups-help"><p class="intel-muted">没有新消息或采集失败，不代表事项没有价值。AI 建议不会替你执行或联系外部对象。</p><details><summary>了解跟踪频率与复核规则</summary><p class="intel-muted">主动跟踪按高／普通／低优先级，以1／7／30天间隔进入候选队列；复核到期后每天待查。有待验证假设时使用现有证据搜索，每天最多5组，预算或排队可能延后。固定公告入口仍按原计划采集。</p></details></aside>`, true, email);
}

function followupForm() {
  return `<section id="followup-section" class="intel-panel" aria-labelledby="followup-title">
    <div class="intel-section-heading"><div><p class="intel-kicker">下一步 · 确认计划 → 保存跟踪 → 记录处理结果</p><h2 id="followup-title">我的下一步与处理结果</h2></div><a href="/intelligence/followups">查看我的跟踪</a></div>
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

function directionsPage(email = '') {
  return page('情报搜集方向', `
    <h1>情报搜集方向</h1>
    <p class="intel-intro">管理你希望系统持续寻找的内容。先选一个方向，再修改要求或查看搜集结果。</p>
    <div id="direction-home">
      <div class="intel-section-heading"><div><h2>我的搜集方向</h2><p id="direction-count" class="intel-muted"></p><p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取搜集方向…</p></div><button id="direction-new" class="intel-button intel-button-primary" type="button" disabled>新增搜集方向</button></div>
      <div id="direction-list" class="intel-direction-list"></div>
      <details class="intel-direction-help"><summary>系统如何按方向搜集？</summary><p><a href="/intelligence/library">管理情报渠道库与覆盖缺口 →</a></p>
        <p>读取原文后区分发布方披露、报道转述和观点预测。未匹配方向、历史资料、日期未知及读取失败分别保留；转载同一消息不算多方确认。受登录或付费限制的正文不会绕过限制获取。</p>
        <p>例如：地区冲突可能影响供电，医院可能需要提高备用能力。只有出现明确的预算、项目或采购证据，才进一步判断投资与采购机会。</p>
        <p>海合会六国每天搜索，其他地区每天最多轮转两个；各地区按方向优先级轮转，无法每天搜完全部方向。固定网站采集、已有跟踪和预算保持原规则。</p>
        <p>暂停方向只调整后续搜集，不会暂缓或删除“我的跟踪”中的事项。<a href="/intelligence/workflow">查看当天采集进度</a></p>
      </details>
    </div>
    <div id="direction-editor" class="intel-panel intel-direction-workspace" hidden>
      <button id="direction-editor-back" class="intel-button intel-button-quiet" type="button">← 返回方向列表</button>
      <p class="intel-kicker">我的搜集方向 / 编辑设置</p>
      <h2 id="direction-editor-title" tabindex="-1">编辑搜集方向</h2>
      <p id="direction-editor-note" class="intel-muted"></p>
      <form id="direction-form" class="intel-direction-form">
        <div id="direction-config-fields">
          <fieldset><legend>1 · 想找什么</legend>
            <label>方向名称<input id="direction-name" required maxlength="80" placeholder="例如：地区冲突与能源保供"></label>
            <label>为什么关注<textarea id="direction-why" required maxlength="400" rows="3" placeholder="例如：了解供能中断是否推动关键设施增加备用能力"></textarea></label>
            <div><p class="intel-field-label">希望找到的信息（至少选一项）</p><div class="intel-direction-choices"><label><input type="checkbox" name="direction-target" value="signal">值得留意的变化</label><label><input type="checkbox" name="direction-target" value="investment">投资动向</label><label><input type="checkbox" name="direction-target" value="procurement">采购机会</label></div></div>
          </fieldset>
          <fieldset><legend>2 · 关注哪里和谁</legend>
            <label>行业或对象<input id="direction-industries" required maxlength="200" placeholder="例如：医院、水务、通信、工业设施"></label>
            <div><p class="intel-field-label">关注地区（至少选一项）</p><div class="intel-direction-country-tools"><button type="button" class="intel-button intel-button-quiet" data-countries="all">选择全部地区</button><button type="button" class="intel-button intel-button-quiet" data-countries="none">清空地区</button></div>
            ${Object.entries(regions.groups).map(([group, name]) => `<div class="intel-direction-country-group"><h3>${name}</h3><div class="intel-direction-choices">${regions.countries.filter(c => c.group === group).map(c => `<label><input type="checkbox" name="direction-country" value="${c.code}">${c.name}</label>`).join('')}</div></div>`).join('')}</div>
          </fieldset>
          <fieldset><legend>3 · 确认搜集设置</legend>
            <label class="intel-direction-enable"><input id="direction-enabled" type="checkbox">启用这个搜集方向</label>
            <label>搜集优先级<select id="direction-priority"><option value="high">高 · 更频繁轮到</option><option value="normal">普通</option><option value="low">低 · 较少轮到</option></select></label>
            <label>不希望搜集的内容（选填）<textarea id="direction-exclude" maxlength="300" rows="2" placeholder="例如：没有具体受影响对象的一般评论"></textarea></label>
            <p class="intel-muted">优先级调整既有搜索的轮转顺序，不增加预算或保证每天执行。以上内容会作为搜索与 AI 分析偏好发送给已配置的服务商，请填写公开业务关注点。</p>
          </fieldset>
        </div>
        <p id="direction-save-status" class="intel-status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="intel-direction-buttons"><button id="direction-save" class="intel-button intel-button-primary" type="submit">保存搜集方向</button><button id="direction-cancel" class="intel-button" type="button">返回方向列表</button><button id="direction-saved-results" class="intel-button intel-button-quiet" type="button" hidden>查看该方向结果</button></div>
      </form>
    </div>
    <div id="direction-results-panel" class="intel-panel intel-direction-workspace" hidden>
      <button id="direction-results-back" class="intel-button intel-button-quiet" type="button">← 返回方向列表</button>
      <h2 id="direction-results-title" tabindex="-1">搜集结果</h2>
      <p id="direction-results-status" role="status"></p>
      <label>原文日期 <select id="direction-period"><option value="30">近30天</option><option value="all">全部（含历史和日期未知）</option><option value="unknown">日期未知或待核验</option></select></label>
      <ul id="direction-results" class="intel-workbench-list"></ul>
    </div>
  `, true, email);
}

function topicsPage(email = '') {
  return page('跨境专题', `
    <h1>跨境专题</h1>
    <p class="intel-intro">在这里增减“发现情报”的跨境专题。启用的专题用于后续原文分析；停用保留历史标签，不增加搜集次数或模型预算。</p>
    <p><a href="/intelligence/discover">← 返回发现情报</a></p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取专题…</p>
    <div class="intel-section-heading"><div><h2>专题名单</h2><p id="topic-count" class="intel-muted"></p></div><button id="topic-new" class="intel-button intel-button-primary" type="button" disabled>新增跨境专题</button></div>
    <div id="topic-list" class="intel-direction-list"></div>
    <section id="topic-editor" class="intel-panel intel-direction-workspace" hidden>
      <h2 id="topic-editor-title">新增跨境专题</h2>
      <form id="topic-form" class="intel-direction-form">
        <label>专题名称<input id="topic-name" required maxlength="60" placeholder="例如：跨境电网互联"></label>
        <label>识别范围<textarea id="topic-description" required maxlength="240" rows="3" placeholder="描述哪些跨境事实应归入这个专题"></textarea></label>
        <p class="intel-muted">名称与识别范围只用于原文事实分类。新增专题不会追溯改写旧情报，也不会启动额外搜索。</p>
        <p id="topic-save-status" class="intel-status" role="status" aria-live="polite"></p>
        <div class="intel-direction-buttons"><button id="topic-save" class="intel-button intel-button-primary" type="submit">保存专题</button><button id="topic-cancel" class="intel-button" type="button">取消</button></div>
      </form>
    </section>
  `, true, email);
}

function overviewPage(email = '') {
  const countries = regions.countries.map(item => [item.code, item.name, item.english]);
  return page('发现情报', `
    <p class="intel-eyebrow">NRGOPT ENERGY INTELLIGENCE</p>
    <h1 id="overview-title">发现情报</h1>
    <p id="overview-intro" class="intel-intro">浏览近期变化，按地区和原文日期缩小范围；打开详情核对证据，再决定是否跟踪。</p>
    <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p>
    <nav class="intel-discover-views" aria-label="情报类型">
      <a href="/intelligence/discover" data-view="overview"><span>全部变化</span><strong id="candidate-total-count">—</strong></a>
      <a href="/intelligence/discover?view=signal" data-view="signal"><span>早期信号</span><strong id="radar-trigger-count">—</strong></a>
      <a href="/intelligence/discover?view=demand" data-view="demand"><span>需求</span><strong id="radar-demand-count">—</strong></a>
      <a href="/intelligence/discover?view=project" data-view="project"><span>项目</span><strong id="radar-project-count">—</strong></a>
      <a href="/intelligence/discover?view=opportunity" data-view="opportunity"><span>机会</span><strong id="opportunity-count">—</strong></a>
    </nav>
    <form id="candidate-filters" class="intel-panel intel-discover-filters">
      <input type="hidden" name="view" value="overview">
      <div class="intel-discover-filter-grid">
        <label>发生国家/地区<select name="country"><option value="">全部国家/地区</option>${countries.map(([code, zh]) => `<option value="${code}">${zh}</option>`).join('')}</select></label>
        <label>原文发布时间<select name="period"><option value="30">近30天</option><option value="90">近90天</option><option value="all">全部（含历史资料）</option><option value="unknown">日期待核验</option></select></label>
      </div>
      <details id="candidate-more-filters" class="intel-discover-more"><summary>更多筛选：地区分组、跨境专题</summary><div class="intel-discover-filter-grid">
        <label>地区分组<select name="group"><option value="">全部地区</option>${Object.entries(regions.groups).map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}</select></label>
        <div><label>跨境专题<select name="topic"><option value="">全部专题</option></select></label><p class="intel-discover-topic-link"><a href="/intelligence/topics">管理专题 →</a></p></div>
      </div></details>
      <button id="candidate-reset" type="reset" class="intel-button intel-button-quiet" hidden>清除筛选</button>
    </form>
    <div class="intel-list-heading intel-discover-list-heading"><h2 id="candidate-heading">近30天 · 全部变化</h2><p id="candidate-filter-status" class="intel-status" role="status" aria-live="polite">正在读取情报…</p></div>
    <p id="overview-period" class="intel-source-meta"></p>
    <p id="candidate-explainer" class="intel-muted">按原文发布日期由近到远排列，同日优先展示重要变化。</p>
    <ul id="candidate-list" class="intel-source-list"></ul>
    <p id="candidate-empty" class="intel-empty" hidden>当前视图没有符合条件的情报。</p>
    <section id="opportunities-section" class="intel-panel" hidden>
      <h2>可参与环节与待验证机会</h2>
      <p class="intel-muted">这里展示有原文依据的参与环节；待验证不表示采购已经开放。点开详情核对原文和状态。</p>
      <ul id="overview-opportunities" class="intel-source-list"></ul>
      <p id="overview-opportunities-empty" class="intel-muted" hidden>当前窗口没有带原文依据的机会。早期需求仍继续跟踪，不自动编造采购机会。</p>
    </section>
    <details class="intel-radar-guide">
      <summary>这些分类是什么意思？</summary>
      <div class="intel-radar-guide-grid">
        <article><strong>早期信号</strong><p>监管、安全、产业、公共服务、气候灾害或基础设施变化，只有能说明具体能源影响路径时才进入。</p></article>
        <article><strong>需求</strong><p>业主或设施形成的供能缺口，用来回答“谁需要解决什么问题”。</p></article>
        <article><strong>项目</strong><p>有明确项目证据的进展，用来回答“项目到了哪一步”。</p></article>
      </div>
      <p class="intel-stage">同一条情报可以出现在多个类型，数量不能相加；一条情报也可能关联多个机会。时间筛选以原文发布日期为准，采集和重新分析不会刷新原文日期。地区按事件发生地筛选，跨境专题不计入国家数量。进入视图不代表采购已经开放。</p>
    </details>
  `, true, email);
}

function workflowPage(email = '') {
  return page('当天任务', `
    <h1>当天任务</h1>
    <section class="intel-panel intel-workflow-today" aria-labelledby="workflow-date">
      <div class="intel-section-heading"><h2 id="workflow-date">今天</h2><button type="button" class="intel-button intel-button-quiet" id="workflow-refresh">刷新任务状态</button></div>
      <p id="page-status" class="intel-status" role="status" aria-live="polite">正在读取当天任务…</p>
      <p id="workflow-summary" class="intel-workflow-summary"></p>
      <p id="workflow-time" class="intel-muted"></p>
      <div id="workflow-counts" class="intel-workflow-counts" aria-label="当天任务状态统计"></div>
      <details class="intel-workflow-guide"><summary>状态说明：怎样判断任务结束？</summary>
        <p>时间统一为北京时间（UTC+8）。这是读取时的记录；点击刷新只更新显示，不触发采集或 AI 调用。午夜后刷新会切换到新一天；任务执行时状态和数量仍会变化。</p>
        <p>没有排队、执行中、待重试或暂停的任务，且当天计划已汇总为终态，才显示“已结束”。全部成功则显示“全部成功”；有失败则显示“已结束 · 有失败”或“已结束 · 全部失败”。失败记录保留，不等于这一天没有运行。</p>
        <p>预算暂停、人工暂停都不算完成。可重试任务通常最多尝试 3 次，间隔等待后继续；其他任务仍可推进。一天可能运行数小时，没有固定结束时刻，未完成任务可以跨天续跑。</p>
        <p>任务总数会随新链接与分析结果增加，因此不显示预计完成百分比。成功指这一项处理成功，不保证发现新情报；若后续补入任务，已结束的计划也可能重新运行。</p>
        <p>这里展示当天计划下的任务，后续人工回补若追加到同一计划也会列入，不代表增加自然计划运行日。</p>
      </details>
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
      <div><p class="intel-kicker">${capability === 'discovery' ? '来源发现' : '情报分析'}</p><h3>${title}</h3></div>
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
  return page('系统设置', `
    <p class="intel-eyebrow">私有管理</p>
    <h1>系统设置</h1>
    <section class="intel-settings-module" aria-labelledby="operations-title">
      <div class="intel-section-heading"><div><p class="intel-kicker"><span>01 /</span> 系统</p><h2 id="operations-title">运行状态</h2></div></div>
      <p id="automation-status" class="intel-status">正在读取运行状态…</p>
      <dl class="intel-facts intel-operation-facts">
        <dt>网站自动搜集</dt><dd><span id="scheduler-state">读取中</span> <a href="/intelligence/workflow">查看当天任务 →</a></dd>
        <dt>Mac 原文归档</dt><dd><span id="archive-state">读取中</span>
          <div class="intel-archive-directory">
            <p><strong>当前目录</strong><code id="archive-directory-current">等待 Mac 回报…</code></p>
            <p id="archive-directory-pending" hidden><strong>待切换目录</strong><code id="archive-directory-requested"></code></p>
            <p id="archive-directory-meta" class="intel-muted"></p>
            <p id="archive-directory-status" class="intel-status" role="status" aria-live="polite"></p>
            <div class="intel-archive-actions"><button id="archive-directory-refresh" class="intel-button intel-button-quiet" type="button">刷新状态</button>
              <details id="archive-directory-edit-details" class="intel-settings-inline-details"><summary>更改目录</summary>
                <form id="archive-directory-form" hidden>
                  <input id="archive-directory-input" name="directory" type="hidden">
                  <div class="intel-archive-directory-edit"><output id="archive-directory-selection" aria-label="已选择的保存目录"></output><button id="archive-directory-pick" class="intel-button" type="button">选择目录</button><button class="intel-button intel-button-quiet" type="submit">保存目录</button></div>
                  <p class="intel-field-help">只影响后续原件；旧文件不会自动移动。</p>
                </form>
              </details>
              <details class="intel-settings-inline-details"><summary>归档说明</summary>
                <p>原文先存云端，Mac 每天 23:30 拉取校验。留存本地副本，便于原站变更时核对；云端原件目前不会自动删除。单篇可从<a href="/intelligence/sources">情报来源</a>下载，手动下载不算自动归档。</p>
                <p id="archive-directory-history" hidden></p>
              </details>
            </div>
          </div>
        </dd>
      </dl>
      <details class="intel-job-details"><summary>最近任务与故障</summary><ul id="job-list" class="intel-job-list"></ul><p id="job-empty" class="intel-muted" hidden>尚无自动扫描任务。</p></details>
    </section>
    <section class="intel-settings-module" aria-labelledby="settings-feishu-title">
      <div class="intel-section-heading"><div><p class="intel-kicker"><span>02 /</span> 消息推送</p><h2 id="settings-feishu-title">飞书推送</h2></div><a class="intel-button" href="/intelligence/feishu">打开飞书配置与记录 →</a></div>
      <p id="notification-state" class="intel-muted">正在读取飞书通知状态…</p>
    </section>
    <section class="intel-settings-module" aria-labelledby="settings-model-title">
      <div class="intel-section-heading"><div><p class="intel-kicker"><span>03 /</span> 服务配置</p><h2 id="settings-model-title">模型与预算</h2></div></div>
      <p id="settings-page-status" class="intel-status" role="status" aria-live="polite">正在读取当前配置…</p>
      <details class="intel-settings-help"><summary>调用预算与余额</summary><p id="budget-state">读取中</p></details>
      <details class="intel-settings-help intel-settings-form-details"><summary>来源发现配置</summary>${providerForm('discovery', '来源发现服务', '负责联网寻找政府、采购方、业主和项目公司的原始发布。', 'MiniMax Coding Plan 请使用 https://api.minimaxi.com/v1/coding_plan/search，模型名称填 coding-plan-search（搜索服务标识，不调用聊天模型）。需要套餐对应的密钥和搜索额度。其他服务仍支持带服务端 web_search 的 Anthropic Messages 格式。')}</details>
      <details class="intel-settings-help intel-settings-form-details"><summary>情报分析配置</summary>${providerForm('analysis', '情报分析服务', '负责把已保存的原文提取为中文事实、三雷达分类和逐条引文。', '当前适配 Chat Completions JSON 格式。')}</details>
      <details class="intel-settings-help"><summary>费用与密钥说明</summary><div class="intel-notice"><h3>金额以哪里为准</h3><p>DeepSeek 显示官方账户余额的累计减少额，不是逐次调用账单，也不一定全部来自本网站。充值、退款、其他应用调用和延迟扣账都会影响对账，精确消费金额以服务商账单为准。系统不根据 token 估算费用。</p><p>已购套餐不按次记金额；这不表示套餐免费，也不表示剩余额度无限。月度上限用于约束本系统后续调用；余额延迟更新时，无法保证服务商实际扣费绝不越过上限。</p></div><div class="intel-notice"><h3>密钥如何保存</h3><p>API Key 是只写字段：保存后只能看到“已配置”，不能从网页或接口读回完整密钥。更换密钥时重新填写即可。</p></div></details>
      <details class="intel-job-details intel-settings-help"><summary>配置历史与调用记录</summary><p class="intel-muted">最近 30 个配置版本及 30 次调用。记录服务、模型、预算和调用用量，不保存历史密钥。调用用量不是费用；旧调用未记录版本的，不补猜。</p><h3>配置版本</h3><ul id="provider-versions" class="intel-analysis-list"></ul><h3>调用记录</h3><ul id="provider-calls" class="intel-analysis-list"></ul><p id="provider-history-status" class="intel-status" role="status"></p></details>
    </section>
  `, true, email);
}

function feishuPage(email = '') {
  return page('飞书配置与推送', `
    <a class="intel-back" href="/intelligence/settings">← 系统设置</a>
    <h1>飞书配置与推送</h1><p class="intel-intro">设置机器人、接收位置和推送规则。保存后，后续待发消息使用这里的配置。</p>
    <p id="feishu-origin" class="intel-notice">正在读取当前配置…</p>
    <form id="feishu-form" class="intel-panel">
      <fieldset class="intel-quiet-fields" disabled>
        <h2>1 · 机器人与接收目标</h2>
        <p class="intel-muted">使用飞书自建应用机器人。App Secret 加密保存，留空保留当前密钥；更换 App ID 时需填写对应的新密钥。</p>
        <div class="intel-settings-grid">
          <label>App ID<input name="app_id" maxlength="200" autocomplete="off" placeholder="cli_…"></label>
          <label>App Secret<input name="app_secret" type="password" maxlength="500" autocomplete="new-password" placeholder="留空保留已有密钥"><span id="feishu-secret-status" class="intel-field-help"></span></label>
          <label class="intel-quiet-check"><input name="send_chat" type="checkbox"><span>推送到群聊</span></label>
          <label>群聊 ID<input name="chat_id" maxlength="200" autocomplete="off" placeholder="oc_…"></label>
          <label class="intel-quiet-check"><input name="send_user" type="checkbox"><span>推送到私聊</span></label>
          <label>私聊接收人 Open ID<input name="user_open_id" maxlength="200" autocomplete="off" placeholder="ou_…"><span class="intel-field-help">填写当前应用下的接收人 Open ID；留空则沿用上述群的群主或唯一群成员识别。换群或换应用时请核对接收人。</span></label>
        </div>
        <details class="intel-job-details"><summary>首次配置需要准备什么？</summary><p>在飞书开放平台创建自建应用，启用机器人并发布版本，开通以应用身份发送消息的权限，将机器人加入接收群。App ID 和 App Secret 位于应用凭据页；接收群 ID（oc_…）及本人 Open ID（ou_…）可通过飞书开放平台的 API 调试台获取。应用创建、权限授权和群成员管理仍在飞书完成。</p><a href="https://open.feishu.cn/app" target="_blank" rel="noopener noreferrer">打开飞书开放平台 →</a></details>
        <h2>2 · 推送开关与内容</h2>
        <label class="intel-quiet-check"><input name="enabled" type="checkbox"><span>启用飞书推送</span></label>
        <div class="intel-settings-grid">
          <label class="intel-quiet-check"><input name="daily_enabled" type="checkbox"><span>每日情报摘要<span class="intel-field-help">当天自然扫描结束后生成摘要。</span></span></label>
          <label class="intel-quiet-check"><input name="flash_enabled" type="checkbox"><span>重大变化提醒<span class="intel-field-help">符合现有重大变化规则时发送。</span></span></label>
          <label class="intel-quiet-check"><input name="system_enabled" type="checkbox"><span>系统运行告警<span class="intel-field-help">扫描缺失、部分失败等运行问题。</span></span></label>
        </div>
        <p class="intel-muted">关闭总开关或某类消息后，对应待发消息暂停；重新开启后按免打扰规则继续。已发送、历史失败和结果未知的消息不会自动重发。已在发送中的消息可能继续完成。修改接收目标会影响后续待发消息。</p>
        <div class="intel-form-footer"><button class="intel-button intel-button-primary" type="submit">保存机器人与推送</button><button class="intel-button" id="feishu-check" type="button">检查已保存凭据</button></div>
      </fieldset>
      <p id="feishu-save-status" class="intel-status" role="status" aria-live="polite"></p>
      <p id="feishu-check-status" class="intel-status" role="status" aria-live="polite">凭据检查不发送消息；不代表群聊、私聊或消息权限已验证。</p>
    </form>
    <form id="notification-settings-form" class="intel-panel" method="post" action="/api/intelligence?action=save-notification-settings">
      <h2 id="notification-settings-title">3 · 免打扰时段</h2>
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

    <section class="intel-panel"><div class="intel-section-heading"><h2>4 · 最近投递记录</h2><button id="feishu-refresh" class="intel-button" type="button">重新读取配置与记录</button></div><p class="intel-muted">最近30条。“飞书已接收”不代表用户已读；“结果未知”不会盲目重发。这里只展示记录，不补发旧消息。</p><ul id="feishu-history" class="intel-analysis-list"></ul><p id="feishu-history-status" class="intel-status" role="status"></p></section>
    <script src="/js/feishu-settings.js?v=20260928-feishu" defer></script>
  `, true, email);
}

function sourcesPage({ detailId = null, email = '' } = {}) {
  const content = detailId ? `
    <a class="intel-back" href="/intelligence/discover">← 发现情报</a> · <a href="/intelligence/overview">返回工作台总览</a>
    <p class="intel-eyebrow">理解变化 → 判断价值 → 决定下一步</p>
    <h1 id="detail-title">情报详情</h1>
    <p class="intel-intro">先了解变化和可能影响，再核对未知项。原文与历史保留在下方；你可以据此选择跟踪、暂缓或退出。</p>
    ${journey(3)}
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
          <section><p class="intel-kicker">03 · 当前判断</p><h2>证据支持到哪一步</h2><p id="decision-confidence"></p><h3>尚待核实的具体问题</h3><ul id="decision-unknowns"></ul><p class="intel-muted">这些是分析列出的信息缺口，供后续核实，不表示原文有误，也不是必须完成的人工审核。可通过下一步观察寻找证据；跟踪复核日期由你另行设定。</p></section>
          <section><p class="intel-kicker">04 · 下一步</p><h2>先确认什么</h2><p id="decision-next"></p><p id="decision-deadline" class="intel-source-meta"></p></section>
        </div>
        <div class="intel-decision-actions"><button id="decision-track" class="intel-button intel-button-primary" type="button" disabled>加入跟踪</button><button id="decision-defer" class="intel-button" type="button" disabled>暂不关注</button></div>
        <p id="decision-saved" class="intel-muted" role="status"></p>
        <a class="intel-decision-evidence" href="#detail-evidence">核对原文与分析 ↓</a>
      </section>
      ${followupForm()}
      <div class="intel-detail-heading">
        <div><span id="source-status" class="intel-badge"></span><span class="intel-stage-note">原件状态</span></div>
        <a id="evidence-download" class="intel-button" hidden>下载原件到当前设备</a>
      </div>
      <details id="detail-evidence" class="intel-panel intel-analysis"><summary>05 · 核对原文、完整分析与证据</summary>
        <div class="intel-section-heading">
          <div><p class="intel-kicker">情报分析服务 · 单一来源分析</p><h2>中文情报与证据</h2></div>
          <button id="extract-button" class="intel-button intel-button-primary" type="button">生成中文初析</button>
        </div>
        <p class="intel-muted">模型只分析已保存的公开来源。每条来源主张必须附原文摘录并通过精确匹配；来源间的内容比对不等于独立确认；转载和相同引文不能累计为独立证据。</p>
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
          <section><h3>原文主张与证据</h3><ul id="extraction-facts" class="intel-analysis-list"></ul></section>
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
    <h1>情报来源</h1><p><a href="/intelligence/library">管理持续关注的渠道 →</a></p>
    <p class="intel-intro">查阅情报依据的原始发布，也可以搜索公开信息或补充已知网页。</p>
    <section class="intel-guide" aria-labelledby="guide-title">
      <div><p class="intel-kicker">系统怎么工作</p><h2 id="guide-title">从公开来源到有据可查的情报</h2></div>
      <ol>
        <li><strong>AI 发现来源</strong><span>已配置的联网来源发现服务搜索政府、采购方、业主和项目公司的原始发布。</span></li>
        <li><strong>保存原文证据</strong><span>系统抓取正文、计算指纹并保存来源链接和原件。</span></li>
        <li><strong>生成中文情报</strong><span>已配置的情报分析服务提取事实、三雷达分类和逐条原文引文。</span></li>
      </ol>
      <p class="intel-stage">搜索摘要只用于发现链接；情报内容必须来自保存后的原始网页。单一来源、多来源一致和来源冲突会分开标识。</p>
    </section>
    <form id="discovery-form" class="intel-panel" method="post" action="/api/intelligence?action=discover">
      <h2>搜索公开情报来源</h2>
      <div class="intel-import-row">
        <label class="intel-sr-only" for="discovery-country">选择国家</label>
        <select id="discovery-country" name="country">
          ${regions.countries.filter(item => primaryHosts[item.code]?.length).map(item => `<option value="${item.code}">${item.name}</option>`).join('')}
        </select>
        <button class="intel-button intel-button-primary" type="submit">搜索公开来源</button>
      </div>
      <p class="intel-muted">搜索范围包括政府、企业、当地及专业媒体、公开行业博客和自媒体文章。搜索结果只作为来源线索；保存后仍会重新抓取原始网页，不直接采用搜索摘要。</p>
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
    <p id="empty-state" class="intel-empty" hidden>尚未采集来源。先使用 AI 搜索公开来源；也可以手动补充已知网址。</p>`;
  return page(detailId ? '情报详情' : '情报来源', content, true, email);
}

function sourceLibraryPage(email = '') {
  const types = require('./source-library.cjs').types;
  const management = `
    <div class="intel-section-heading"><div><h2>渠道覆盖与管理</h2><p class="intel-muted">渠道决定持续从哪里找；单篇文章保存到下方原文资料。登记、入口可读和有效情报分别记录。</p></div><button id="library-add" class="intel-button intel-button-primary" disabled>添加渠道</button></div>
    <p id="library-status" class="intel-status" role="status" aria-live="polite">正在读取渠道…</p>
    <div id="library-overview" class="intel-library-overview"></div>
    <p class="intel-muted">参考入口晚间分批巡检，每批最多 3 个、每天最多 18 个；已检查入口至少间隔 7 天再复查，不调用模型。入口可读且同站已有近 30 天、日期明确、原件哈希匹配的有效分析，才自动加入原有搜索额度内的轮转。</p>
    <details class="intel-direction-help"><summary>监测、暂停和移除如何生效？</summary><p>新增渠道先登记，再验证入口并启用。参考入口限量自动复查；自定义渠道仍由你决定启用。渠道在既有地区搜索额度内轮转，与开放搜索交替，不保证每天搜索每个渠道；关联方向按当天生效设置运行。固定入口沿用现有采集方式。</p><p>暂停或移除会阻止该网站或栏目范围内后续自动抓取；已经发出的请求可能完成，已有原文、情报和分析保留。恢复只参与后续计划，不重跑历史失败。移除可恢复。网站级暂停优先于其下栏目启用。</p><p>入口验证不调用模型，只说明本次能读取页面，不代表身份核实、正文分析成功或持续有新情报。新增、修改或恢复可能等待下一自然计划；预算、地区轮转与查询总量保持。</p></details>
    <div id="library-editor" class="intel-panel" hidden>
      <h2 id="library-editor-title">添加渠道</h2>
      <form id="library-form"><div class="intel-library-fields">
        <label>渠道名称<input name="name" required maxlength="120" placeholder="机构、媒体或作者专栏名称"></label>
        <label>公开入口网址<input name="url" type="url" required maxlength="2048" placeholder="https://…"></label>
        <label>监测范围<select name="scope"><option value="path">此栏目或作者路径</option><option value="site">整个网站</option></select><span class="intel-field-help">个人专栏建议选择路径，避免监测或移除整个平台；网址不含查询参数。</span></label>
        <label>来源类别<select name="type">${Object.entries(types).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>轮转优先级<select name="priority"><option value="normal">普通</option><option value="high">较高</option><option value="low">较低</option></select></label>
        <label>备注<textarea name="notes" rows="2" maxlength="600" placeholder="关注价值、身份线索、覆盖范围或移除原因"></textarea></label>
      </div><fieldset><legend>覆盖地区（至少一个）</legend><div class="intel-direction-choices">${regions.countries.map(c=>`<label><input name="countries" type="checkbox" value="${c.code}">${c.name}</label>`).join('')}</div></fieldset>
      <fieldset><legend>原文语言（可选）</legend><div class="intel-direction-choices">${Object.entries({ar:'阿语',en:'英语',zh:'中文',fr:'法语',tr:'土耳其语',fa:'波斯语',he:'希伯来语',other:'其他'}).map(([k,v])=>`<label><input name="languages" type="checkbox" value="${k}">${v}</label>`).join('')}</div></fieldset>
      <fieldset><legend>关联搜集方向（不选表示适用于所有方向）</legend><div id="library-directions" class="intel-direction-choices"></div></fieldset>
      <p class="intel-muted">先保存渠道，再验证入口和启用；新渠道不会仅因登记就自动付费分析。</p>
      <div class="intel-direction-buttons"><button id="library-save" class="intel-button intel-button-primary" type="submit">保存渠道</button><button id="library-cancel" class="intel-button" type="button">取消编辑</button></div><p id="library-save-status" class="intel-status" role="status" aria-live="polite"></p></form>
    </div>
    <div class="intel-library-filters"><label>查看<select id="library-view"><option value="current">当前渠道库</option><option value="candidate">待验证</option><option value="active">已启用</option><option value="paused">已暂停</option><option value="removed">已移除</option><option value="failed">入口读取失败</option></select></label><label>地区<select id="library-country"><option value="">全部地区</option>${regions.countries.map(c=>`<option value="${c.code}">${c.name}</option>`).join('')}</select></label><label>类别<select id="library-type"><option value="">全部类别</option>${Object.entries(types).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>方向<select id="library-direction"><option value="">全部方向</option></select></label><label>查找<input id="library-search" type="search" placeholder="名称或网址"></label></div>
    <div id="library-list" class="intel-direction-list"></div><div id="library-pagination" class="intel-direction-buttons"></div>
    <details class="intel-panel"><summary>覆盖缺口：地区 × 来源类别</summary><p class="intel-muted">统计已启用且未被网站暂停的渠道配置，不代表实际近期情报覆盖。可通过上方方向筛选查看；一个站点的转载不能代表独立证据。</p><div id="library-coverage" class="intel-library-table"></div></details>
    <details class="intel-panel"><summary>从已保存原文发现的其他渠道</summary><p class="intel-muted">最近500条保存记录中未登记的网站，最多展示50个。由网址归并，名称、身份、类别与范围待你确认；不会自动启用。</p><div id="library-suggestions"></div></details>
  `;
  let html = sourcesPage({email});
  html = html.replace('<h1>情报来源</h1><p><a href="/intelligence/library">管理持续关注的渠道 →</a></p>','<h1>情报渠道库</h1>').replace('查阅情报依据的原始发布，也可以搜索公开信息或补充已知网页。','管理持续关注的渠道，搜索新线索，保存原文资料。');
  const start = html.indexOf('    <section class="intel-guide"');
  const end = html.indexOf('    <form id="discovery-form"',start);
  html = html.slice(0,start)+management+'<details class="intel-panel" id="library-materials"><summary>搜索与保存单篇文章</summary>'+html.slice(end);
  html = html.replace('    <div class="intel-list-heading">','</details><details class="intel-panel"><summary>已保存原文资料</summary><div class="intel-list-heading">');
  html = html.replace('先使用 AI 搜索公开来源；也可以手动补充已知网址。</p>','先搜索或手动保存一篇文章。</p></details>');
  html = html.replace('</head>','<script src="/js/source-library.js?v=20260928-library-reasons" defer></script></head>');
  return html.replace('<title>情报来源','<title>情报渠道库');
}

module.exports = { enginePage, feishuPage, sourceLibraryPage, directionsPage, topicsPage, loginPage, resetPasswordPage, sourcesPage, overviewPage, settingsPage, workflowPage, followupsPage, workbenchPage };
