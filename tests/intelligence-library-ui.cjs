const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { sourceLibraryPage } = require('../lib/intelligence/pages.cjs');
const { summarizeLibrary } = require('../lib/intelligence/library-summary.cjs');

// Run the real page script with event-capable DOM nodes; no browser or API contract is replaced in production.
class Element {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this._text = text;
    this.id = attrs.id; this.name = attrs.name; this.value = attrs.value || ''; this.type = attrs.type;
    this.className = attrs.class || ''; this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = Object.hasOwn(attrs, 'disabled');
    this.checked = false; this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(text) { this._text = String(text); this.children = []; }
  get childElementCount() { return this.children.length; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return descendants.filter(e => selector === '*' || selector.startsWith('.') && e.className.split(' ').includes(selector.slice(1))
      || selector === '[data-library-view]' && e.dataset.libraryView
      || /^\[name="([^"]+)"\](:checked)?$/.test(selector) && e.name === selector.match(/^\[name="([^"]+)"\]/)[1] && (!selector.endsWith(':checked') || e.checked));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  get options() { return this.children.filter(e => e.tagName === 'option'); }
  reset() { this.elements.forEach(e => { e.value = e.initialValue; e.checked = false; }); }
  focus() {}
  scrollIntoView() {}
  async fire(event) { if (event === 'click' && this.disabled) return; for (const fn of this.listeners[event] || []) await fn({ preventDefault() {} }); }
}
function fixture(writable = true) {
  const directions = [{ id: 'direction-a', config: { name: '设备与项目', enabled: true, countries: ['SA'] } }, { id: 'direction-b', config: { name: '渠道合作', enabled: true, countries: ['SA'] } }];
  function entry(id, status, type, direction_ids = []) { return { id, revision: 1, status, access: { status: 'readable', checked_at: '2026-10-13T01:00:00Z' }, config: { name: id, url: 'https://' + id + '.example/news', scope: 'path', type, countries: ['SA'], direction_ids, languages: [], notes: '', priority: 'normal', mode: 'search' } }; }
  const entries = [entry('active', 'active', 'government', ['direction-a']), entry('candidate', 'candidate', 'media'), entry('outside', 'active', 'research')];
  entries[2].config.countries = ['AE'];
  const source = { id: 'source', title: 'Official report', requested_url: 'https://new.example/author/alice/post', final_url: 'https://new.example/author/alice/post', fetched_at: '2026-10-13T02:00:00Z', publication_date: '2026-10-12', publication_method: 'metadata', status: 'pending_extraction', extraction_status: 'extracted', content_sha256: 'a'.repeat(64), extraction_source_sha256: 'a'.repeat(64), countries: [{ code: 'SA', relation: 'occurrence' }] };
  return { ...summarizeLibrary({ entries, directions, sources: [source], tasks: [], day: '2026-10-13' }), directions, writable, types: require('../lib/intelligence/source-library.cjs').types };
}
async function app(data = fixture(), handler) {
  const parsed = cheerio.load(sourceLibraryPage()), ids = new Map();
  function convert(source) {
    const e = new Element(source.type === 'text' ? '#text' : source.name || 'root', source.attribs || {}, source.type === 'text' ? source.data : '');
    for (const child of source.children || []) e.append(convert(child));
    if (e.id) ids.set(e.id, e);
    if (e.tagName === 'select') e.value = e.options[0]?.value || '';
    e.initialValue = e.value; return e;
  }
  const root = convert(parsed.root()[0]), form = ids.get('library-form');
  form.elements = form.querySelectorAll('*').filter(e => ['input', 'select', 'textarea', 'button'].includes(e.tagName));
  for (const e of form.elements.filter(e => e.name)) if (!form.elements[e.name]) form.elements[e.name] = e;
  const requests = [], document = { getElementById: id => ids.get(id), createElement: tag => new Element(tag), createTextNode: text => new Element('#text', {}, text), querySelectorAll: selector => root.querySelectorAll(selector) };
  let allowDiscard = true;
  const context = { document, window: { addEventListener() {} }, location: { href: 'https://local.test/intelligence/library' }, URL, Date, Set, Map,
    confirm: () => allowDiscard, fetch: async (url, init) => {
      const action = new URL(url, 'https://local.test').searchParams.get('action'); requests.push({ action, ...init });
      return handler?.(action, init) || { ok: true, json: async () => action === 'source-library' ? data : { history: [{ revision: 1, status: 'candidate', recorded_at: '2026-10-13T02:00:00Z' }] } };
    } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/source-library.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { ids, form, requests, all: selector => root.querySelectorAll(selector), discard: value => { allowDiscard = value; }, tab: async name => { await root.querySelectorAll('[data-library-view]').find(b => b.dataset.libraryView === name).fire('click'); }, cell: type => ids.get('library-coverage').querySelectorAll('*').find(e => e.tagName === 'button' && e.attrs['aria-label']?.includes(type)), button: (element, name) => element.querySelectorAll('*').find(e => e.tagName === 'button' && e.textContent === name) };
}

test('channel library has its own three modules and never loads article forms or lists', () => {
  const html = sourceLibraryPage();
  for (const id of ['library-view-tabs', 'library-list', 'library-panel-gaps', 'library-form']) assert.match(html, new RegExp('id="' + id + '"'));
  for (const id of ['discovery-form', 'import-form', 'source-list']) assert.doesNotMatch(html, new RegExp('id="' + id + '"'));
  assert.match(html, /\/intelligence\/discover#library-materials/);
  assert.match(html, /来源报道地区/); assert.match(html, /适用方向/);
});

test('use and pending modules show actual conditions without claiming a rotation for an ineligible source', async () => {
  const ui = await app();
  assert.equal(ui.ids.get('library-panel-gaps').hidden, true);
  assert.equal(ui.ids.get('library-growth-panel').hidden, true);
  assert.match(ui.ids.get('library-list').textContent, /与当前搜集范围未匹配/);
  assert.match(ui.ids.get('library-list').textContent, /近30天未确认/);
  ui.ids.get('library-view').value = 'normal'; await ui.ids.get('library-view').fire('change');
  assert.match(ui.ids.get('library-list').textContent, /active/); assert.doesNotMatch(ui.ids.get('library-list').textContent, /outside/);
  await ui.tab('pending'); assert.equal(ui.ids.get('library-growth-panel').hidden, false); assert.match(ui.ids.get('library-list').textContent, /candidate/); assert.match(ui.ids.get('library-list').textContent, /outside/);
});

test('coverage follows saved regions and single-direction filtering cannot borrow another direction coverage', async () => {
  const ui = await app(); await ui.tab('gaps');
  assert.equal(ui.ids.get('library-management').hidden, true);
  assert.equal(ui.ids.get('library-growth-panel').hidden, true);
  assert.doesNotMatch(ui.ids.get('library-coverage').textContent, /阿联酋/);
  ui.ids.get('library-gap-direction').value = 'direction-b'; await ui.ids.get('library-gap-direction').fire('input');
  const government = ui.cell('政府与监管');
  assert.match(government.textContent, /无渠道/); await government.fire('click');
  assert.equal(ui.button(ui.ids.get('library-coverage-detail'), '暂无匹配渠道').disabled, true);
  await ui.cell('新闻与行业媒体').fire('click');
  await ui.button(ui.ids.get('library-coverage-detail'), '查看匹配渠道').fire('click');
  assert.equal(ui.ids.get('library-country').value, 'SA'); assert.equal(ui.ids.get('library-direction').value, 'direction-b');
  assert.equal(ui.ids.get('library-panel-gaps').hidden, true); assert.match(ui.ids.get('library-list').textContent, /candidate/);
});

test('list filters honor change events, effective direction scope and combined country selection', async () => {
  const data = fixture(), common = structuredClone(data.entries[0]);
  common.id = 'common'; common.config = { ...common.config, name: 'Common channel', url: 'https://common.example/news', countries: ['SA', 'AE'], direction_ids: [] };
  data.directions[1].config.countries = ['AE'];
  const ui = await app({ ...data, ...summarizeLibrary({ entries: [...data.entries, common], directions: data.directions, sources: [], tasks: [], day: data.day }) });
  ui.ids.get('library-direction').value = 'direction-a'; await ui.ids.get('library-direction').fire('change');
  assert.match(ui.ids.get('library-list').textContent, /Common channel/);
  assert.doesNotMatch(ui.ids.get('library-list').textContent, /outside/);
  assert.match(ui.ids.get('library-filter-result').textContent, /2 \/ 3 个渠道/);
  assert.match(ui.ids.get('library-list').textContent, /通用渠道.*设备与项目/);
  ui.ids.get('library-country').value = 'AE'; await ui.ids.get('library-country').fire('change');
  assert.match(ui.ids.get('library-filter-result').textContent, /0 \/ 3 个渠道/);
  assert.match(ui.ids.get('library-list').textContent, /没有启用渠道/);
  await ui.ids.get('library-filter-clear').fire('click');
  assert.equal(ui.ids.get('library-direction').value, ''); assert.equal(ui.ids.get('library-country').value, '');
  assert.match(ui.ids.get('library-filter-result').textContent, /3 \/ 3 个渠道/);
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].method, 'GET');
});

test('state category and live text filters combine, and clear restores the unfiltered list', async () => {
  const data = fixture(); data.entries[0].access.status = 'failed';
  const ui = await app(data);
  ui.ids.get('library-view').value = 'failed'; await ui.ids.get('library-view').fire('change');
  ui.ids.get('library-country').value = 'SA'; await ui.ids.get('library-country').fire('change');
  ui.ids.get('library-type').value = 'government'; await ui.ids.get('library-type').fire('change');
  ui.ids.get('library-search').value = 'ACTIVE.EXAMPLE'; await ui.ids.get('library-search').fire('input');
  assert.match(ui.ids.get('library-filter-result').textContent, /1 \/ 2 个渠道/);
  assert.match(ui.ids.get('library-list').textContent, /active/); assert.doesNotMatch(ui.ids.get('library-list').textContent, /outside/);
  ui.ids.get('library-search').value = 'no match'; await ui.ids.get('library-search').fire('input');
  assert.match(ui.ids.get('library-filter-result').textContent, /0 \/ 2 个渠道/);
  await ui.ids.get('library-filter-clear').fire('click');
  assert.equal(ui.ids.get('library-view').value, 'all'); assert.equal(ui.ids.get('library-type').value, ''); assert.equal(ui.ids.get('library-search').value, '');
  assert.match(ui.ids.get('library-filter-result').textContent, /2 \/ 2 个渠道/);
  assert.equal(ui.ids.get('library-filter-clear').hidden, true); assert.equal(ui.requests.length, 1);
});

test('new-source and gap actions only prepare a draft, preserving sample path and dirty edits', async () => {
  const ui = await app(); await ui.tab('gaps');
  await ui.button(ui.ids.get('library-suggestions'), '登记渠道').fire('click');
  assert.equal(ui.form.elements.url.value, 'https://new.example/author/alice/post'); assert.equal(ui.form.elements.scope.value, 'path');
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0);
  ui.form.elements.name.value = 'My edited name'; await ui.form.fire('input'); ui.discard(false);
  await ui.ids.get('library-cancel').fire('click'); assert.equal(ui.ids.get('library-editor').hidden, false); assert.equal(ui.form.elements.name.value, 'My edited name');
});

test('revision conflicts preserve the editor; root-path scope requires an explicit site choice', async () => {
  const ui = await app(fixture(), (action) => action === 'save-library-entry' ? { ok: false, json: async () => ({ message: '版本冲突，请重新读取。' }) } : null);
  await ui.tab('gaps'); await ui.button(ui.ids.get('library-suggestions'), '登记渠道').fire('click');
  ui.form.elements.url.value = 'https://new.example/'; await ui.form.fire('submit');
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0); assert.match(ui.ids.get('library-save-status').textContent, /请选择“整个网站”/);
  ui.form.elements.scope.value = 'site'; await ui.form.fire('submit');
  assert.match(ui.ids.get('library-save-status').textContent, /版本冲突.*输入已保留/); assert.equal(ui.form.elements.url.value, 'https://new.example/'); assert.equal(ui.ids.get('library-editor').hidden, false);
});

test('read-only users can filter, inspect coverage and read history while all writes remain disabled', async () => {
  const ui = await app(fixture(false));
  assert.equal(ui.ids.get('library-add').disabled, true);
  const history = ui.button(ui.ids.get('library-list'), '查看修改历史'); assert.equal(history.disabled, false); await history.fire('click');
  assert.ok(ui.requests.some(r => r.action === 'library-history'));
  await ui.tab('pending'); assert.equal(ui.button(ui.ids.get('library-list'), '启用轮转').disabled, true);
  await ui.tab('gaps'); assert.equal(ui.button(ui.ids.get('library-suggestions'), '登记渠道').disabled, true); await ui.cell('政府与监管').fire('click'); assert.equal(ui.button(ui.ids.get('library-coverage-detail'), '补充渠道').disabled, true);
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0);
});

test('automatic stages distinguish unconfirmed scopes from verified trials and actual saved activation', async () => {
  const data = fixture(), base = data.entries.find(e => e.id === 'candidate');
  const entry = (suffix, changes) => {
    const row = structuredClone(base); row.id = 'reference:auto:' + suffix.repeat(64); row.config.name = 'auto-' + suffix; row.config.url = 'https://auto-' + suffix + '.example/news/';
    row.access = { ...row.access, managed_by: 'automatic', origin: 'discovered_sources', auto_scope_key: 'auto-' + suffix + '.example/news', ...changes };
    return row;
  };
  const confirm = entry('a', { scope_verified: false, scope_confirmation_needed: true }), trial = entry('b', { scope_verified: true, scope_confirmation_needed: false }), enabled = entry('c', { scope_verified: true, scope_confirmation_needed: false }); enabled.status = 'active';
  const projected = summarizeLibrary({ entries: [confirm, trial, enabled], directions: data.directions, sources: [], tasks: [], day: data.day });
  const ui = await app({ ...data, ...projected });
  assert.match(ui.ids.get('library-list').textContent, /已自动启用/);
  await ui.tab('pending'); assert.match(ui.ids.get('library-list').textContent, /系统继续积累样文/); assert.match(ui.ids.get('library-list').textContent, /等待预算内试采/);
  assert.match(ui.ids.get('library-list').textContent, /样文与栏目依据不足，等待系统继续积累/);
  const confirmationCard = ui.ids.get('library-list').children.find(e => e.textContent.includes('auto-a'));
  await ui.button(confirmationCard, '编辑').fire('click');
  assert.match(ui.ids.get('library-save-status').textContent, /保存后由你管理/);
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0);
});

test('automatically managed entry failures are repair states and manual channels never receive automatic labels', async () => {
  const data = fixture(); data.entries[0].access.managed_by = 'automatic'; data.entries[0].access.origin = 'reference'; data.entries[0].access.status = 'failed';
  const ui = await app(data); assert.match(ui.ids.get('library-list').textContent, /需你决定.*当前没有自动复查安排/s);
  assert.doesNotMatch(ui.ids.get('library-list').textContent, /已自动启用/);
  await ui.tab('gaps'); assert.match(ui.ids.get('library-panel-gaps').textContent, /自动更新机制/);
  assert.match(ui.ids.get('library-panel-gaps').textContent, /暂停或移除不会被自动加回/);
});

test('verified parent integration keeps single-article history without asking for repeated scope confirmation, while pauses take precedence', async () => {
  const data = fixture(), entry = data.entries.find(e => e.id === 'candidate');
  entry.access.managed_by = 'automatic'; entry.access.origin = 'discovered_sources'; entry.access.scope_confirmation_needed = true;
  entry.integration = { entry_id: 'verified-parent', name: '已核验能源栏目' }; entry.usage.reason = 'scope_confirmation_needed';
  const ui = await app(data); await ui.tab('pending');
  const card = ui.ids.get('library-integrated-list').children.find(e => e.textContent.includes('candidate'));
  assert.match(card.textContent, /已纳入已核验栏目，历史保留/); assert.match(card.textContent, /无需重复处理/);
  assert.doesNotMatch(card.textContent, /需确认栏目范围|栏目范围待确认/); assert.equal(ui.button(card, '启用轮转'), undefined);
  assert.ok(ui.button(card, '查看修改历史'));
  entry.usage.reason = 'scope_paused';
  const paused = await app(data); await paused.tab('pending');
  const blocked = paused.ids.get('library-list').children.find(e => e.textContent.includes('candidate'));
  assert.match(blocked.textContent, /受其他已暂停或移除范围影响/);
  assert.doesNotMatch(blocked.textContent, /已纳入已核验栏目|无需重复处理/);
  assert.equal(paused.requests.filter(r => r.method === 'POST').length, 0);
});

test('coverage restores all eight category columns and separates configured channels from verified natural output', async () => {
  const data = fixture(), base = data.entries.find(e => e.id === 'active');
  const source = { id: 'natural', title: 'Government project', requested_url: 'https://active.example/news/project', final_url: 'https://active.example/news/project', fetched_at: '2026-10-13T02:00:00Z', publication_date: '2026-10-12', publication_method: 'metadata', status: 'pending_extraction', extraction_status: 'extracted', content_sha256: 'a'.repeat(64), extraction_source_sha256: 'a'.repeat(64), countries: [{ code: 'SA', relation: 'occurrence' }] };
  const task = { id: 'task', item_key: 'discover:SA', status: 'succeeded', updated_at: '2026-10-13T02:00:00Z', channel: { id: base.id, url: base.config.url, scope: base.config.scope }, result_urls: [source.final_url], run: { job_type: 'daily_scan', schedule_key: '2026-10-13' } };
  const ui = await app({ ...data, ...summarizeLibrary({ entries: data.entries, directions: data.directions, sources: [source], tasks: [task], day: data.day }) });
  await ui.tab('gaps');
  const table = ui.ids.get('library-coverage').children[0];
  assert.equal(table.children[0].children[0].children.length, 9);
  assert.equal(table.children[1].children.length, 1);
  assert.match(ui.cell('政府与监管').textContent, /已有产出1 个渠道1 篇原文/);
  assert.match(ui.cell('公用事业与系统运营').textContent, /无渠道0 个渠道0 篇原文/);
  assert.equal(ui.ids.get('library-gaps-count').textContent, '1 地区');
  assert.doesNotMatch(ui.ids.get('library-gaps-count').textContent, /项/);
  const clicked = ui.cell('政府与监管'); await clicked.fire('click');
  assert.equal(ui.ids.get('library-coverage').children[0], table); assert.equal(ui.cell('政府与监管'), clicked);
  assert.match(ui.ids.get('library-coverage-detail').textContent, /1 个可用渠道.*1 篇近30天自然发现并核验原文/);
  ui.ids.get('library-gap-direction').value = 'direction-b'; await ui.ids.get('library-gap-direction').fire('input');
  assert.match(ui.cell('政府与监管').textContent, /无渠道0 个渠道0 篇原文/);
});

test('unreviewed references stay in the system group without demanding manual activation or classification', async () => {
  const data = fixture(), entry = data.entries.find(e => e.id === 'candidate');
  entry.id = 'reference:unreviewed.example'; entry.config.type = 'unknown'; entry.access = { status: 'unchecked' }; entry.usage.reason = 'entry_unchecked';
  const ui = await app(data); await ui.tab('pending');
  assert.match(ui.ids.get('library-section-title').textContent, /自动拓展/);
  const card = ui.ids.get('library-list').children.find(e => e.tagName === 'article' && e.textContent.includes('candidate'));
  assert.match(card.textContent, /系统推进/); assert.doesNotMatch(card.textContent, /补充来源类别，再|系统继续核对来源类别/);
  assert.ok(ui.button(card, '检查入口')); assert.equal(ui.button(card, '启用轮转'), undefined);
  ui.ids.get('library-view').value = 'decision'; await ui.ids.get('library-view').fire('change');
  assert.doesNotMatch(ui.ids.get('library-list').textContent, /candidate/);
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0);
  entry.status = 'active'; entry.access = { status: 'readable', managed_by: 'automatic', origin: 'reference' };
  const unclassified = await app(data);
  assert.match(unclassified.ids.get('library-list').textContent, /来源类别尚未核实；系统可继续检查与试采，你可在编辑中补充/);
  assert.doesNotMatch(unclassified.ids.get('library-list').textContent, /系统继续核对来源类别/);
});

test('limited scoped trials remain automatic progress and do not claim verified activation', async () => {
  const data = fixture(), entry = structuredClone(data.entries.find(e => e.id === 'candidate'));
  entry.id = 'reference:auto:' + 'd'.repeat(64); entry.config.url = 'https://trial.example/news/';
  entry.access = { status: 'readable', managed_by: 'automatic', origin: 'discovered_sources', scope_verified: false, trial_scope_verified: true, auto_scope_key: 'trial.example/news', reason: 'trial_ready', trial_ready_at: '2026-10-13T01:00:00Z' };
  const ui = await app({ ...data, ...summarizeLibrary({ entries: [entry], directions: data.directions, sources: [], tasks: [], day: data.day }) });
  await ui.tab('pending'); assert.match(ui.ids.get('library-list').textContent, /等待预算内试采/);
  assert.doesNotMatch(ui.ids.get('library-list').textContent, /已自动启用|下一步：.*需你决定/);
});

test('growth reports recorded channel counts and does not fabricate historical activation times', async () => {
  const data = fixture(); data.growth = { last_checked_at: '2026-10-13T02:00:00Z', checked_channels: 3, last_registered_at: null, registered_channels: 0, last_activated_at: null, activated_channels: 0, activation_dates_complete: false };
  const ui = await app(data), status = ui.ids.get('library-growth-status');
  assert.match(status.textContent, /近30天检查3 个渠道/);
  assert.match(status.textContent, /历史时间未完整记录暂无时间记录/);
  assert.doesNotMatch(status.children[2].textContent, /0 个渠道|2026/);
});

test('failed fixed monitoring explains the problem and responsibility without presenting a technical check as a task', async () => {
  const data = fixture(), entry = data.entries[0]; entry.config.mode = 'fixed';
  entry.performance.latest_task = { status: 'failed', error_code: 'source_timeout', day: data.day };
  const ui = await app(data), card = ui.ids.get('library-list').children.find(e => e.tagName === 'article' && e.textContent.includes('active'));
  assert.match(card.textContent, /搜集异常.*原因：网站响应超时。.*后续处理：后续按日计划继续监测.*你的操作：暂无需操作/s);
  assert.doesNotMatch(card.textContent, /需查看|人工付费重试|下一步：/);
  assert.equal(card.children.filter(e => e.tagName === 'div').some(e => ui.button(e, '检查入口')), false);
  const details = card.children.find(e => e.tagName === 'details');
  assert.ok(ui.button(details, '检查入口')); assert.match(details.textContent, /不重新搜集或运行 AI 分析/);
  assert.equal(ui.requests.length, 1);
  entry.performance.latest_task.error_code = 'registry_no_links';
  const readable = await app(data);
  assert.match(readable.ids.get('library-list').textContent, /页面未找到可识别的文章链接/);
  assert.match(readable.ids.get('library-list').textContent, /网址可读不代表此前任务已恢复/);
  assert.doesNotMatch(readable.ids.get('library-list').textContent, /已修复/);
});

test('failure guidance distinguishes automatic review from user management and honors pause and scope controls', async () => {
  const data = fixture(), entry = data.entries[1];
  entry.id = 'reference:example'; entry.access = { status: 'failed', error_code: 'source_tls_error' }; entry.usage = { eligible:false, reason:'entry_failed' };
  const automatic = await app(data); await automatic.tab('pending');
  assert.match(automatic.ids.get('library-list').textContent, /网站证书校验失败.*系统按巡检规则复查/s);
  entry.access.managed_by = 'user';
  const manual = await app(data); await manual.tab('pending');
  assert.match(manual.ids.get('library-list').textContent, /当前没有自动复查安排.*如需继续使用，请核对网址/s);
  assert.ok(manual.button(manual.ids.get('library-list'), '核对网址'));
  assert.doesNotMatch(manual.ids.get('library-list').textContent, /系统按巡检规则复查/);
  entry.status = 'paused';
  const paused = await app(data);
  assert.doesNotMatch(paused.ids.get('library-archived-list').textContent, /暂无需操作|系统按巡检规则复查/);
  entry.status = 'active'; entry.host_paused = true;
  const blocked = await app(data);
  assert.match(blocked.ids.get('library-list').textContent, /恢复网站抓取/);
  assert.doesNotMatch(blocked.ids.get('library-list').textContent, /暂无需操作|系统按巡检规则复查/);
});

test('queued retry and unexplained failure do not claim a repair or a known technical cause', async () => {
  const data = fixture(), entry = data.entries[0];
  entry.performance.latest_task = { status:'retry', error_code:'source_connection_reset', day:data.day };
  const retry = await app(data);
  assert.match(retry.ids.get('library-list').textContent, /等待自动重试.*连接被中断.*已进入自动重试队列/s);
  entry.performance.latest_task = { status:'failed', error_code:'unexpected_provider_code', day:data.day };
  const unknown = await app(data);
  assert.match(unknown.ids.get('library-list').textContent, /具体原因尚未明确/);
  assert.doesNotMatch(unknown.ids.get('library-list').textContent, /已进入自动重试队列|已修复/);
});

test('taking over a trial candidate suppresses stale automatic retry guidance', async () => {
  const data = fixture(), entry = data.entries[1];
  entry.id='reference:example'; entry.access={status:'readable',managed_by:'user'};
  entry.usage={eligible:false,reason:'candidate'};
  entry.performance.latest_task={status:'retry',error_code:'discovery_failed',day:data.day};
  const ui=await app(data); await ui.tab('pending');
  assert.match(ui.ids.get('library-list').textContent,/需你决定/);
  assert.doesNotMatch(ui.ids.get('library-list').textContent,/等待自动重试|已进入自动重试队列|暂无需操作/);
});
