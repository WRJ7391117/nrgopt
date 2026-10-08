const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function researchPage(email) {
  return `<!doctype html><html lang="zh-CN"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow"><title>市场调研 · NRGOPT</title>
  <link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/intelligence.css?v=20261004-library-triage">
  <link rel="stylesheet" href="/css/research.css?v=20261008">
  <script src="/js/theme.js" defer></script><script src="/js/research.js?v=20261008" defer></script>
  </head><body class="intelligence-app research-app">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="intel-header"><a class="nav-logo" href="/">NRG<span class="primary">OPT</span></a>
    <nav class="intel-nav" aria-label="工作区"><a href="/intelligence/overview">能源情报</a><a href="/research" aria-current="page">市场调研</a></nav>
    <div class="intel-tools"><button id="research-logout" class="intel-button intel-button-quiet" type="button" title="当前账号：${escape(email)}">退出</button>
    <button id="themeBtn" class="theme-toggle" type="button" aria-label="切换主题"><svg id="themeIcon" viewBox="0 0 24 24" aria-hidden="true"></svg></button></div>
  </header>
  <main id="main" class="intel-main research-main" tabindex="-1">
    <div class="research-heading"><div><p class="intel-eyebrow">NRGOPT · MARKET RESEARCH</p><h1>市场调研</h1><p class="intel-muted">按项目整理行动计划、访谈与证据，把调研推进到下一步。</p></div><button id="new-project" class="intel-button" type="button" disabled>新建调研项目</button></div>
    <p id="research-status" class="intel-status" role="status" aria-live="polite">正在读取调研项目…</p>
    <form id="project-form" class="research-form" hidden>
      <h2 id="project-form-title">新建调研项目</h2>
      <div class="research-fields"><label>项目名称<input id="project-title" maxlength="200" required placeholder="例如：乌兹别克斯坦新能源市场开发"></label><label>国家 / 地区<input id="project-region" maxlength="100" placeholder="例如：乌兹别克斯坦"></label></div>
      <label>调研目标<textarea id="project-summary" maxlength="2000" rows="3" placeholder="希望验证什么，以及要带回哪些结果"></textarea></label>
      <div class="research-actions"><button class="intel-button" type="submit">保存项目</button><button id="cancel-project" class="intel-button intel-button-quiet" type="button">取消</button></div>
    </form>
    <div class="research-layout">
      <aside class="research-sidebar" aria-label="调研项目"><h2>调研项目 <span id="project-count"></span></h2><div id="project-list"></div></aside>
      <section id="project-workspace" hidden>
        <div class="research-project-heading"><div><p id="active-region" class="intel-eyebrow"></p><h2 id="active-title"></h2></div><button id="edit-project" class="intel-button intel-button-quiet" type="button">编辑项目</button></div>
        <p id="active-summary" class="research-summary"></p>
        <div class="research-toolbar"><label class="research-search">查找资料<input id="entry-search" type="search" placeholder="按标题查找"></label><label>资料类型<select id="entry-kind-filter"><option value="">全部类型</option><option value="plan">行动计划</option><option value="note">调研记录</option><option value="interview">客户与伙伴访谈</option><option value="evidence">证据与参考资料</option></select></label><button id="new-entry" class="intel-button" type="button">添加资料</button></div>
        <form id="entry-form" class="research-form" hidden>
          <h3 id="entry-form-title">添加资料</h3>
          <div class="research-fields"><label>标题<input id="entry-title" maxlength="200" required></label><label>资料类型<select id="entry-kind"><option value="plan">行动计划</option><option value="note">调研记录</option><option value="interview">客户与伙伴访谈</option><option value="evidence">证据与参考资料</option></select></label></div>
          <label>正文 / 说明<textarea id="entry-content" maxlength="100000" rows="10" placeholder="写下计划、调研信息，或说明附件的用途与待核实事项"></textarea></label>
          <label>来源链接（可选）<input id="entry-source" type="url" maxlength="2000" placeholder="https://"></label>
          <label id="file-field">附件（可选，每份不超过2MB）<input id="entry-file" type="file" accept=".html,.htm,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.zip"><small>支持手册、文档、图片与压缩包。新版附件请新增一条资料，保留原件。</small></label>
          <div class="research-actions"><button class="intel-button" type="submit">保存资料</button><button id="cancel-entry" class="intel-button intel-button-quiet" type="button">取消</button></div>
        </form>
        <div id="entry-list" class="research-entries"></div>
        <article id="entry-detail" class="research-detail" hidden>
          <div class="research-project-heading"><div><p id="detail-meta" class="intel-muted"></p><h3 id="detail-title"></h3></div><div class="research-actions"><button id="edit-entry" class="intel-button intel-button-quiet" type="button">编辑文字</button><button id="close-entry" class="intel-button intel-button-quiet" type="button">收起</button></div></div>
          <p id="detail-content" class="research-content"></p><div id="detail-links" class="research-actions"></div><div id="detail-preview"></div>
        </article>
      </section>
      <section id="research-empty" class="research-empty" hidden><h2>从一次具体调研开始</h2><p>新建项目，把行动计划、现场记录和参考资料放在一起。</p><p class="intel-muted">例如“乌兹别克斯坦新能源市场开发”，工商业与户用分别记录。</p></section>
    </div>
    <p class="research-footer intel-muted">内部调研资料 · 仅当前授权账号可访问 · 保存后可跨设备读取</p>
    <noscript><p>请启用 JavaScript 后管理调研资料。</p></noscript>
  </main></body></html>`;
}
module.exports = { researchPage };
