(function () {
  'use strict';
  var projects = [], entries = [], activeProject = null, activeEntry = null, writable = false;
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
    document.querySelectorAll('.research-form button, .research-form input, .research-form textarea, .research-form select, .research-project, .research-entry').forEach(function (e) { e.disabled = busy || loading; });
  }
  function discard() {
    if (busy || loading) return false;
    if (dirty && !confirm('当前输入尚未保存，是否放弃？')) return false;
    byId('project-form').hidden = true; byId('entry-form').hidden = true; dirty = false; return true;
  }
  function renderProjects() {
    byId('project-count').textContent = projects.length;
    var list = byId('project-list'); list.replaceChildren();
    projects.forEach(function (project) {
      var button = node('button', undefined, 'research-project'); button.type = 'button';
      button.setAttribute('aria-current', String(project.id === activeProject?.id));
      button.append(node('strong', project.title), node('small', project.region || '地区待填'));
      button.addEventListener('click', function () { if (discard()) selectProject(project).catch(function (e) { status(e.message, true); }); }); list.append(button);
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
  async function selectProject(project) {
    loading = true; controls(); status('正在读取项目资料…');
    try {
      var data = await api('entries', null, project.id);
      activeProject = project; entries = data.entries; activeEntry = null;
      byId('entry-detail').hidden = true; byId('detail-preview').replaceChildren(); byId('entry-search').value = ''; byId('entry-kind-filter').value = '';
      byId('active-title').textContent = project.title; byId('active-region').textContent = project.region || '地区待填'; byId('active-summary').textContent = project.summary;
      byId('project-workspace').hidden = false; byId('research-empty').hidden = true; renderProjects(); renderEntries();
      status(writable ? '资料已同步 · ' + entries.length + '份资料' : '当前环境只读，暂不能保存。');
    } finally { loading = false; controls(); }
  }
  async function openEntry(id) {
    loading = true; controls(); status('正在读取资料…');
    try {
      activeEntry = (await api('entry', null, id)).entry;
      byId('detail-title').textContent = activeEntry.title;
      byId('detail-meta').textContent = kinds[activeEntry.kind] + ' · 更新于 ' + date(activeEntry.updated_at);
      byId('detail-content').textContent = activeEntry.content || '';
      var links = byId('detail-links'); links.replaceChildren(); byId('detail-preview').replaceChildren();
      if (activeEntry.source_url) { var source = node('a', '打开来源 ↗'); source.href = activeEntry.source_url; source.target = '_blank'; source.rel = 'noopener noreferrer'; links.append(source); }
      if (activeEntry.file_name) {
        var url = '/api/research?action=file&id=' + encodeURIComponent(activeEntry.id);
        var link = node('a', '下载原件 · ' + activeEntry.file_name); link.href = url; links.append(link);
        if (['text/html', 'text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(activeEntry.file_type)) {
          var preview = node('iframe'); preview.title = activeEntry.file_name;
          preview.setAttribute('sandbox', 'allow-scripts allow-downloads'); preview.src = url + '&preview=1'; byId('detail-preview').append(preview);
          if (activeEntry.file_type === 'text/html') links.append(node('p', '手册中的填写记录需导出备份；如需更新云端附件，请保存副本后添加新版。', 'intel-muted'));
        }
      }
      byId('entry-detail').hidden = false; renderEntries(); status('已打开资料。');
      byId('entry-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  byId('entry-search').addEventListener('input', renderEntries); byId('entry-kind-filter').addEventListener('change', renderEntries);
  byId('close-entry').addEventListener('click', function () { if (discard()) { activeEntry = null; byId('entry-detail').hidden = true; byId('detail-preview').replaceChildren(); renderEntries(); } });
  byId('research-logout').addEventListener('click', async function () {
    if (!discard()) return;
    try { var response = await fetch('/api/intelligence?action=logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('退出失败，请重试。'); location.assign(login); }
    catch (error) { status(error.message, true); }
  });
  window.addEventListener('beforeunload', function (event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  (async function () {
    try {
      var data = await api('projects'); projects = data.projects; writable = data.writable; renderProjects();
      if (projects.length) await selectProject(projects[0]);
      else { byId('research-empty').hidden = false; status(writable ? '还没有调研项目。新建项目后即可添加资料。' : '当前环境只读。'); }
    } catch (error) { status(error.message, true); }
  })();
})();
