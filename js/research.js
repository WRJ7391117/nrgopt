(function () {
  'use strict';
  var projects = [], entries = [], activeProject = null, activeEntry = null, writable = false;
  var currentView = 'overview', returnView = 'overview';
  var editingProject = null, editingEntry = null, dirty = false, busy = false, loading = false;
  var kinds = { plan: '行动计划', note: '调研记录', interview: '客户与伙伴访谈', evidence: '证据与参考资料' };
  var byId = function (id) { return document.getElementById(id); };
  var login = '/intelligence/login?returnTo=%2Fresearch';
  function status(message, error) { byId('research-status').textContent = message; byId('research-status').dataset.tone = error ? 'error' : ''; }
  function node(tag, text, className) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function date(value) { return new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }); }
  async function api(action, body, id) {
    var response = await fetch('/api/research?action=' + action + (id ? '&id=' + encodeURIComponent(id) : ''), {
      credentials: 'same-origin', method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
    var data = await response.json();
    if (response.status === 401) { if (!dirty) location.assign(login); throw new Error('登录已过期。请在另一个窗口重新登录，再保存当前输入。'); }
    if (!response.ok) throw new Error(data.message || '读取失败，请重试。');
    return data;
  }
  function controls() {
    ['new-project', 'edit-project', 'new-entry', 'edit-entry'].forEach(function (id) { byId(id).disabled = !writable || busy || loading; });
    document.querySelectorAll('.research-form button, .research-form input, .research-form textarea, .research-form select, .research-project, .research-project-card, .research-reading-link, .research-group-more, .research-section-nav button, .research-reading-nav button, .research-entry').forEach(function (e) { e.disabled = busy || loading; });
  }
  function discard() {
    if (busy || loading) return false;
    if (dirty && !confirm('当前输入尚未保存，是否放弃？')) return false;
    byId('project-form').hidden = true; byId('entry-form').hidden = true; dirty = false; return true;
  }
  function readingNavigation() {
    byId('breadcrumb-project').textContent = activeProject.title;
    byId('breadcrumb-entry').textContent = activeEntry.title;
    byId('close-entry').textContent = returnView === 'library' ? '← 返回资料库' : '← 返回项目概览';
  }
  function showView(view) {
    currentView = view;
    if (view === 'detail') readingNavigation();
    byId('project-overview').hidden = view !== 'overview';
    byId('library-panel').hidden = view !== 'library';
    byId('entry-detail').hidden = view !== 'detail';
    ['overview', 'library'].forEach(function (name) {
      byId('show-' + name).setAttribute('aria-current', view === name ? 'page' : 'false');
    });
  }
  function remember(replace) {
    var state = { research: true,
      projectId: activeProject?.id || null, view: currentView, entryId: currentView === 'detail' ? activeEntry?.id : null,
      returnView: returnView, kind: byId('entry-kind-filter').value, query: byId('entry-search').value };
    history[replace ? 'replaceState' : 'pushState'](state, '', '/research');
  }
  function showProjects() {
    activeEntry = null; activeProject = null; byId('detail-preview').replaceChildren();
    document.querySelector('.research-layout').hidden = true; byId('project-directory').hidden = false; renderProjects();
    status('选择一个市场项目开始阅读。');
  }
  async function restore(state) {
    var project = projects.find(function (item) { return item.id === state?.projectId; });
    if (!project) { showProjects(); return; }
    if (activeProject?.id !== project.id) await selectProject(project, false);
    byId('entry-kind-filter').value = state.kind || ''; byId('entry-search').value = state.query || '';
    activeEntry = null; byId('detail-preview').replaceChildren();
    showView(state.view === 'library' ? 'library' : 'overview'); renderEntries();
    status(currentView === 'library' ? '已返回资料库。' : '已返回项目概览。');
    if (state.view === 'detail' && entries.some(function (item) { return item.id === state.entryId; })) {
      await openEntry(state.entryId, false, false); returnView = state.returnView || 'overview'; readingNavigation();
    }
  }
  function entryButton(entry) {
    var button = node('button', undefined, 'research-reading-link'); button.type = 'button';
    button.append(node('strong', entry.title), node('small', '更新于 ' + date(entry.updated_at)));
    button.addEventListener('click', function () { if (discard()) openEntry(entry.id).catch(function (e) { status(e.message, true); }); });
    return button;
  }
  function renderOverview() {
    byId('entry-count').textContent = entries.length;
    var groups = byId('overview-groups'); groups.replaceChildren();
    var descriptions = { plan: '先明确验证方向与执行步骤', interview: '了解客户需求与伙伴反馈', note: '整理现场观察与调研发现', evidence: '核对政策、数据与原始来源' };
    ['plan', 'interview', 'note', 'evidence'].forEach(function (kind, index) {
      var section = node('section', undefined, 'research-reading-group');
      var items = entries.filter(function (entry) { return entry.kind === kind; });
      section.append(node('p', '0' + (index + 1), 'intel-eyebrow'), node('h4', kinds[kind]), node('p', descriptions[kind], 'intel-muted'));
      items.slice(0, 3).forEach(function (entry) { section.append(entryButton(entry)); });
      if (!items.length) section.append(node('p', '暂无资料', 'research-group-empty'));
      if (items.length) {
        var direct = items.length === 1 && items[0].file_type === 'text/html';
        var more = node('button', direct ? (kind === 'plan' ? '阅读手册 →' : '阅读报告 →') : '查看全部 · ' + items.length + '份', 'research-group-more'); more.type = 'button';
        more.addEventListener('click', function () {
          if (!discard()) return;
          if (direct) { openEntry(items[0].id).catch(function (e) { status(e.message, true); }); return; }
          byId('entry-kind-filter').value = kind; byId('entry-search').value = ''; showView('library'); renderEntries(); remember();
        });
        section.append(more);
      }
      groups.append(section);
    });
  }
  function renderProjects() {
    byId('project-count').textContent = projects.length;
    var list = byId('project-list'), home = byId('home-project-list'); list.replaceChildren(); home.replaceChildren();
    projects.forEach(function (project) {
      var button = node('button', undefined, 'research-project'); button.type = 'button';
      button.setAttribute('aria-current', String(project.id === activeProject?.id));
      button.append(node('strong', project.title), node('small', project.region || '地区待填'));
      button.addEventListener('click', function () { if (discard()) selectProject(project).catch(function (e) { status(e.message, true); }); }); list.append(button);
      var card = node('button', undefined, 'research-project-card'); card.type = 'button';
      card.append(node('small', project.region || '地区待填', 'intel-eyebrow'), node('h3', project.title), node('p', project.summary || '尚未填写调研目标。', 'research-card-summary'), node('small', '更新于 ' + date(project.updated_at)), node('span', '进入项目 →', 'research-card-action'));
      card.addEventListener('click', function () { if (discard()) selectProject(project).catch(function (e) { status(e.message, true); }); }); home.append(card);
    });
    controls();
  }
  function renderEntries() {
    var list = byId('entry-list'), q = byId('entry-search').value.trim().toLowerCase(), kind = byId('entry-kind-filter').value;
    list.replaceChildren();
    var filtered = entries.filter(function (entry) { return (!kind || entry.kind === kind) && entry.title.toLowerCase().includes(q); });
    if (!filtered.length) list.append(node('p', entries.length ? '没有匹配的资料。' : '还没有资料。添加行动计划、调研记录或附件。', 'intel-muted'));
    filtered.forEach(function (entry) {
      var button = node('button', undefined, 'research-entry'); button.type = 'button'; button.setAttribute('aria-expanded', String(entry.id === activeEntry?.id));
      var title = node('span'); title.append(node('strong', entry.title), node('small', kinds[entry.kind] + (entry.file_name ? ' · ' + entry.file_name : '')));
      button.append(title, node('time', date(entry.updated_at)));
      button.addEventListener('click', function () { if (discard()) openEntry(entry.id).catch(function (e) { status(e.message, true); }); }); list.append(button);

    }); controls();
  }
  async function selectProject(project, record) {
    loading = true; controls(); status('正在读取项目资料…');
    try {
      var data = await api('entries', null, project.id);
      activeProject = project; entries = data.entries; activeEntry = null;
      document.querySelector('.research-layout').hidden = false; byId('project-directory').hidden = true;
      byId('entry-detail').hidden = true; byId('detail-preview').replaceChildren(); byId('entry-search').value = ''; byId('entry-kind-filter').value = '';
      byId('active-title').textContent = project.title; byId('active-region').textContent = project.region || '地区待填'; byId('active-summary').textContent = project.summary || '尚未填写调研目标，可通过编辑项目补充。';
      byId('project-workspace').hidden = false; byId('research-empty').hidden = true; renderProjects(); renderEntries(); renderOverview(); showView('overview');
      status(writable ? '资料已同步 · ' + entries.length + '份资料' : '当前环境只读，暂不能保存。');
    } finally { loading = false; controls(); }
    if (record !== false) remember();
  }
  async function openEntry(id, scroll, record) {
    loading = true; controls(); status('正在读取资料…');
    try {
      activeEntry = (await api('entry', null, id)).entry;
      if (currentView !== 'detail') returnView = currentView;
      showView('detail');
      byId('entry-detail').dataset.format = activeEntry.file_type === 'text/html' ? 'html' : '';
      byId('detail-title').textContent = activeEntry.title;
      byId('detail-meta').textContent = kinds[activeEntry.kind] + ' · 更新于 ' + date(activeEntry.updated_at);
      byId('detail-content').textContent = activeEntry.content || '';
      byId('detail-description').hidden = !activeEntry.content;
      byId('detail-description').open = !activeEntry.file_name;
      var links = byId('detail-links'); links.replaceChildren(); byId('detail-preview').replaceChildren();
      if (activeEntry.source_url) { var source = node('a', '打开来源 ↗'); source.href = activeEntry.source_url; source.target = '_blank'; source.rel = 'noopener noreferrer'; links.append(source); }
      if (activeEntry.file_name) {
        var url = '/api/research?action=file&id=' + encodeURIComponent(activeEntry.id);
        var link = node('a', '下载原件 · ' + activeEntry.file_name); link.href = url; links.append(link);
        if (['text/html', 'text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(activeEntry.file_type)) {
          var preview = node('iframe'); preview.title = activeEntry.file_name;
          if (activeEntry.file_type === 'text/html') preview.dataset.expanded = 'true';
          preview.setAttribute('sandbox', 'allow-scripts allow-downloads allow-modals'); preview.src = url + '&preview=1'; byId('detail-preview').append(preview);
          if (activeEntry.file_type === 'text/html') links.append(node('p', '手册中的填写记录需导出备份；如需更新云端附件，请保存副本后添加新版。', 'intel-muted'));
        }
      }
      byId('entry-detail').hidden = false; renderEntries(); status('已打开资料。');
      if (record !== false) remember();
      if (scroll !== false) byId('entry-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally { loading = false; controls(); }
  }
  function projectForm(project) {
    if (!discard()) return;
    editingProject = project; byId('project-form-title').textContent = project ? '编辑项目' : '新建调研项目';
    byId('project-title').value = project?.title || ''; byId('project-region').value = project?.region || ''; byId('project-summary').value = project?.summary || '';
    byId('project-form').hidden = false; byId('project-title').focus();
  }
  function entryForm(entry) {
    if (!discard()) return;
    showView('library');
    editingEntry = entry; byId('entry-form-title').textContent = entry ? '编辑资料文字' : '添加资料';
    byId('entry-title').value = entry?.title || ''; byId('entry-kind').value = entry?.kind || 'note'; byId('entry-content').value = entry?.content || ''; byId('entry-source').value = entry?.source_url || '';
    byId('entry-file').value = ''; byId('file-field').hidden = !!entry;
    byId('entry-form').hidden = false; byId('entry-title').focus();
  }
  async function encodedFile(file) {
    if (file.size > 2097152 || !file.size) throw new Error('附件应为1字节至2MB。');
    return new Promise(function (resolve, reject) {
      var reader = new FileReader(); reader.onerror = function () { reject(new Error('附件读取失败。')); };
      reader.onload = function () { resolve({ name: file.name, base64: String(reader.result).split(',')[1] }); }; reader.readAsDataURL(file);
    });
  }
  async function save(form, action, body, done) {
    if (busy) return;
    busy = true; controls(); status('正在保存…');
    try { var result = await api(action, body); dirty = false; form.hidden = true; await done(result); status('已保存到调研工作区。'); }
    catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
  }
  byId('new-project').addEventListener('click', function () { projectForm(null); });
  byId('edit-project').addEventListener('click', function () { projectForm(activeProject); });
  byId('new-entry').addEventListener('click', function () { entryForm(null); });
  byId('edit-entry').addEventListener('click', function () { entryForm(activeEntry); });
  ['project', 'entry'].forEach(function (name) {
    byId(name + '-form').addEventListener('input', function () { dirty = true; });
    byId('cancel-' + name).addEventListener('click', discard);
  });
  byId('project-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var body = { title: byId('project-title').value, region: byId('project-region').value, summary: byId('project-summary').value };
    if (editingProject) { body.id = editingProject.id; body.revision = editingProject.revision; }
    save(this, 'save-project', body, async function (result) {
      var index = projects.findIndex(function (p) { return p.id === result.project.id; });
      if (index < 0) projects.unshift(result.project); else projects[index] = result.project;
      await selectProject(result.project);
    });
  });
  byId('entry-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (busy) return;
    var body = { project_id: activeProject.id, title: byId('entry-title').value, kind: byId('entry-kind').value, content: byId('entry-content').value, source_url: byId('entry-source').value };
    if (editingEntry) { body.id = editingEntry.id; body.revision = editingEntry.revision; }
    var file = byId('entry-file').files[0];
    try { if (file) body.attachment = await encodedFile(file); } catch (error) { status(error.message, true); return; }
    save(this, 'save-entry', body, async function (result) { await selectProject(activeProject); await openEntry(result.entry.id); });
  });
  byId('entry-search').addEventListener('input', function () { renderEntries(); remember(true); }); byId('entry-kind-filter').addEventListener('change', function () { renderEntries(); remember(true); });
  function leaveDetail(view) {
    if (!discard()) return;
    activeEntry = null; byId('detail-preview').replaceChildren(); showView(view); renderEntries(); remember();
    byId('project-workspace').scrollIntoView({ block: 'start' });
  }
  byId('close-entry').addEventListener('click', function () {
    leaveDetail(returnView);
  });
  byId('show-overview').addEventListener('click', function () { leaveDetail('overview'); });
  byId('show-library').addEventListener('click', function () { leaveDetail('library'); });
  byId('back-projects').addEventListener('click', function () {
    if (!discard()) return;
    showProjects(); remember();
  });
  byId('breadcrumb-project').addEventListener('click', function () { leaveDetail('overview'); });
  byId('breadcrumb-projects').addEventListener('click', function () { if (discard()) { showProjects(); remember(); } });
  window.addEventListener('popstate', function (event) {
    if (discard()) restore(event.state).catch(function (e) { status(e.message, true); });
    else remember();
  });
  window.addEventListener('message', function (event) {
    var preview = byId('detail-preview').querySelector('iframe[data-expanded]'), data = event.data;
    if (!preview || event.source !== preview.contentWindow || !data) return;
    if (data.type === 'nrgopt-research-open') {
      var linkedEntry = entries.find(function (entry) { return entry.file_name === data.file; });
      if (linkedEntry && discard()) openEntry(linkedEntry.id).catch(function (e) { status(e.message, true); });
    }
    if (data.type === 'nrgopt-research-height' && Number.isFinite(data.height) && data.height > 0) {
      preview.style.height = Math.ceil(data.height) + 'px';
    }
    if (data.type === 'nrgopt-research-scroll' && Number.isFinite(data.top) && data.top >= 0) {
      window.scrollTo({ top:preview.getBoundingClientRect().top + window.scrollY + data.top, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
  byId('research-logout').addEventListener('click', async function () {
    if (!discard()) return;
    try { var response = await fetch('/api/intelligence?action=logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('退出失败，请重试。'); location.assign(login); }
    catch (error) { status(error.message, true); }
  });
  window.addEventListener('beforeunload', function (event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  (async function () {
    try {
      var data = await api('projects'); projects = data.projects; writable = data.writable; renderProjects();
      if (projects.length) {
        var linked = new URLSearchParams(location.search);
        if (linked.has('project') && linked.has('file')) {
          await restore({ projectId: linked.get('project'), view: 'overview' }); remember(true);
          var report = entries.find(function (entry) { return entry.file_name === linked.get('file'); });
          if (report) await openEntry(report.id);
        }
        else if (history.state?.research) await restore(history.state);
        else { showProjects(); remember(true); }
      }
      else { document.querySelector('.research-layout').hidden = false; byId('project-directory').hidden = true; byId('research-empty').hidden = false; status(writable ? '还没有调研项目。新建项目后即可添加资料。' : '当前环境只读。'); }
    } catch (error) { status(error.message, true); }
  })();
})();
