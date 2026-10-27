(function () {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var form = byId('network-form');
  if (!form) return;
  var filters = byId('network-filter'), offset = 0, writable = false, loading = false, saving = false;
  var editing = null, cleanDraft = '', requestNumber = 0;
  var labels = { identified: '尚未联系', contacted: '已尝试联系', communicating: '已有沟通', paused: '暂缓跟进' };
  var fields = ['organization', 'contact_name', 'role', 'region', 'contact_details', 'business_context', 'source_note', 'communication_note', 'next_action', 'status', 'followup_on'];
  function message(id, value, tone) { var el = byId(id); el.textContent = value; el.dataset.tone = tone || ''; }
  function node(parent, tag, text, className) {
    var el = document.createElement(tag); el.textContent = text || '';
    if (className) el.className = className;
    parent.append(el); return el;
  }
  async function api(action, body) {
    var response = await fetch('/api/intelligence?action=' + action, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    var data = await response.json();
    if (!response.ok) {
      if (response.status === 401) location.replace('/intelligence/login?returnTo=%2Fintelligence%2Fnetwork');
      var error = new Error(data.message || '读取或保存未完成，请重试。');
      error.code = data.error; error.status = response.status; throw error;
    }
    return data;
  }
  function draft() { return JSON.stringify(Object.fromEntries(new FormData(form))); }
  function dirty() { return editing !== null && draft() !== cleanDraft; }
  function closeEditor() {
    editing = null; byId('network-editor').hidden = true; byId('network-list-view').hidden = false;
    byId('network-add').hidden = false; byId('network-add').focus();
  }
  function cancelEditor() {
    if (saving) return;
    if (dirty()) { byId('network-discard').hidden = false; byId('network-discard-confirm').focus(); return; }
    closeEditor();
  }
  function edit(record) {
    editing = record || { id: crypto.randomUUID(), revision: 0, status: 'identified', archived: false };
    form.reset(); byId('network-discard').hidden = true;
    fields.forEach(function (key) { form.elements[key].value = editing[key] || ''; });
    form.querySelector('details').open = Boolean(editing.source_note || editing.communication_note);
    cleanDraft = draft();
    byId('network-editor-title').textContent = record ? '编辑商务关系' : '新增商务关系';
    byId('network-save').textContent = record && record.archived ? '保存归档记录' : '保存关系';
    byId('network-list-view').hidden = true; byId('network-add').hidden = true;
    byId('network-editor').hidden = false; byId('network-reload').hidden = true;
    message('network-form-status', ''); message('network-status', '');
    form.elements.organization.focus();
  }
  function payload(record) {
    var value = { id: record.id, revision: record.revision, archived: record.archived };
    fields.forEach(function (key) { value[key] = record[key] || (key === 'followup_on' ? null : ''); });
    return value;
  }
  function showDetails(item, record) {
    var data = [['联系方式', record.contact_details], ['资料来源', record.source_note], ['实际沟通记录', record.communication_note]].filter(function (pair) { return pair[1]; });
    if (!data.length) return;
    var details = node(item, 'details', '', 'intel-network-card-details'); node(details, 'summary', '联系方式与记录');
    var dl = node(details, 'dl');
    data.forEach(function (pair) { node(dl, 'dt', pair[0]); node(dl, 'dd', pair[1]); });
  }
  function renderRecord(record) {
    var item = node(byId('network-list'), 'li', '', 'intel-network-card');
    var heading = node(item, 'div', '', 'intel-network-card-heading');
    var who = node(heading, 'div'); node(who, 'h3', record.organization);
    node(who, 'p', [record.contact_name || '对接人待补充', record.role, record.region].filter(Boolean).join(' · '), 'intel-network-person');
    node(heading, 'span', record.archived ? '已归档' : labels[record.status], 'intel-network-badge');
    if (record.business_context) node(item, 'p', record.business_context, 'intel-network-context');
    var next = node(item, 'div', '', 'intel-network-next');
    node(next, 'p', '下一步：' + (record.next_action || '尚未安排'));
    if (record.followup_on) node(next, 'p', '计划跟进：' + record.followup_on + ' · 北京时间', 'intel-network-date');
    showDetails(item, record);
    var footer = node(item, 'div', '', 'intel-network-card-footer');
    node(footer, 'span', '更新于 ' + new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(record.updated_at)), 'intel-muted');
    var actions = node(footer, 'div', '', 'intel-network-actions');
    var editButton = node(actions, 'button', '编辑', 'intel-button'); editButton.type = 'button'; editButton.disabled = !writable;
    editButton.addEventListener('click', function () { edit(record); });
    var archiveButton = node(actions, 'button', record.archived ? '恢复到名单' : '归档', 'intel-button intel-button-quiet');
    archiveButton.type = 'button'; archiveButton.disabled = !writable;
    archiveButton.addEventListener('click', async function () {
      if (saving) return;
      saving = true; setListBusy(true);
      var value = payload(record); value.archived = !record.archived;
      try {
        await api('save-business-relation', value);
        await load(record.archived ? '已恢复到关系名单。' : '已归档，可在“已归档”中恢复。');
      } catch (error) { message('network-status', error.message, 'error'); }
      finally { saving = false; setListBusy(false); }
    });
  }
  function setListBusy(busy) {
    byId('network-add').disabled = busy || !writable;
    byId('network-list').querySelectorAll('button').forEach(function (button) { button.disabled = busy || !writable; });
    filters.querySelectorAll('input,select,button').forEach(function (el) { el.disabled = busy; });
  }
  async function load(successMessage) {
    var sequence = ++requestNumber; loading = true; setListBusy(true);
    byId('network-prev').disabled = true; byId('network-next').disabled = true;
    message('network-status', '正在读取关系名单…');
    var state = filters.elements.status.value, q = filters.elements.q.value.trim();
    try {
      var data = await api('business-network&state=' + encodeURIComponent(state) + '&q=' + encodeURIComponent(q) + '&offset=' + offset);
      if (sequence !== requestNumber) return;
      writable = data.writable;
      if (!data.items.length && offset > 0) { offset = Math.max(0, offset - 25); return await load(successMessage); }
      byId('network-list').replaceChildren(); data.items.forEach(renderRecord);
      byId('network-empty').hidden = data.items.length > 0;
      byId('network-empty-title').textContent = q || state !== 'all' ? '没有符合条件的记录' : '从一位值得对接的机构或人员开始';
      byId('network-empty-note').textContent = q || state !== 'all' ? '可以调整查找条件，或切换回全部未归档。' : '点击“新增商务关系”，保存第一个对接对象。';
      byId('network-count').textContent = data.items.length ? '本页 ' + data.items.length + ' 条' : '';
      byId('network-pagination').hidden = offset === 0 && !data.has_more;
      byId('network-page').textContent = '第 ' + (offset / 25 + 1) + ' 页';
      byId('network-prev').disabled = offset === 0; byId('network-next').disabled = !data.has_more;
      message('network-status', writable ? successMessage || '' : '当前环境为只读，暂不能新增或修改关系。', successMessage && writable ? 'success' : '');
    } catch (error) {
      message('network-status', error.message + ' 已有名单如仍显示，则为上次读取结果。', 'error');
    } finally { if (sequence === requestNumber) { loading = false; setListBusy(false); } }
  }
  byId('network-add').addEventListener('click', function () { if (writable && !saving) edit(); });
  byId('network-back').addEventListener('click', cancelEditor);
  byId('network-cancel').addEventListener('click', cancelEditor);
  byId('network-reload').textContent = '放弃草稿，刷新名单';
  byId('network-reload').addEventListener('click', function () {
    if (!saving) { closeEditor(); load(); }
  });
  byId('network-discard-confirm').addEventListener('click', function () { if (!saving) closeEditor(); });
  byId('network-keep-editing').addEventListener('click', function () { byId('network-discard').hidden = true; form.elements.organization.focus(); });
  filters.addEventListener('submit', function (event) { event.preventDefault(); if (!loading && !saving) { offset = 0; load(); } });
  filters.elements.status.addEventListener('change', function () { offset = 0; load(); });
  byId('network-refresh').addEventListener('click', function () { if (!loading && !saving) load(); });
  byId('network-prev').addEventListener('click', function () { if (!loading && !saving) { offset = Math.max(0, offset - 25); load(); } });
  byId('network-next').addEventListener('click', function () { if (!loading && !saving) { offset += 25; load(); } });
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); if (saving || !editing || !writable) return;
    var value = payload(editing);
    fields.forEach(function (key) { value[key] = form.elements[key].value.trim() || (key === 'followup_on' ? null : ''); });
    saving = true;
    var controls = Array.from(form.querySelectorAll('input,textarea,select,button'));
    controls.forEach(function (el) { el.disabled = true; }); byId('network-back').disabled = true;
    message('network-form-status', '正在保存…');
    try {
      var result = await api('save-business-relation', value);
      editing = null; closeEditor();
      filters.elements.q.value = ''; filters.elements.status.value = result.record.archived ? 'archived' : 'all'; offset = 0;
      await load('已保存商务关系。');
    } catch (error) {
      message('network-form-status', error.message + (error.status === 409 ? '' : ' 当前输入已保留。'), 'error');
      byId('network-reload').hidden = error.status !== 409;
    } finally {
      controls.forEach(function (el) { el.disabled = false; }); byId('network-back').disabled = false; saving = false;
    }
  });
  window.addEventListener('beforeunload', function (event) { if (dirty() || saving) { event.preventDefault(); event.returnValue = ''; } });
  load();
})();
