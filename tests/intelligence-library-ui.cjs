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
  return { ids, form, requests, all: selector => root.querySelectorAll(selector), discard: value => { allowDiscard = value; }, tab: async name => { await root.querySelectorAll('[data-library-view]').find(b => b.dataset.libraryView === name).fire('click'); }, button: (element, name) => element.querySelectorAll('*').find(e => e.tagName === 'button' && e.textContent === name) };
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
  assert.match(ui.ids.get('library-list').textContent, /与当前搜集范围未匹配/);
  assert.match(ui.ids.get('library-list').textContent, /近30天未确认/);
  ui.ids.get('library-view').value = 'normal'; await ui.ids.get('library-view').fire('input');
  assert.match(ui.ids.get('library-list').textContent, /active/); assert.doesNotMatch(ui.ids.get('library-list').textContent, /outside/);
  await ui.tab('pending'); assert.match(ui.ids.get('library-list').textContent, /candidate/); assert.match(ui.ids.get('library-list').textContent, /outside/);
});

test('coverage follows saved regions and single-direction filtering cannot borrow another direction coverage', async () => {
  const ui = await app(); await ui.tab('gaps');
  assert.equal(ui.ids.get('library-management').hidden, true);
  assert.doesNotMatch(ui.ids.get('library-coverage').textContent, /阿联酋/);
  ui.ids.get('library-gap-direction').value = 'direction-b'; await ui.ids.get('library-gap-direction').fire('input');
  const government = ui.ids.get('library-coverage').children.find(e => e.textContent.includes('政府与监管'));
  assert.match(government.textContent, /缺少可用渠道/);
  assert.equal(ui.button(government, '暂无匹配渠道').disabled, true);
  const media = ui.ids.get('library-coverage').children.find(e => e.textContent.includes('新闻与行业媒体'));
  await ui.button(media, '查看匹配渠道').fire('click');
  assert.equal(ui.ids.get('library-country').value, 'SA'); assert.equal(ui.ids.get('library-direction').value, 'direction-b');
  assert.equal(ui.ids.get('library-panel-gaps').hidden, true); assert.match(ui.ids.get('library-list').textContent, /candidate/);
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
  await ui.tab('gaps'); assert.equal(ui.button(ui.ids.get('library-suggestions'), '登记渠道').disabled, true); assert.equal(ui.button(ui.ids.get('library-coverage'), '补充渠道').disabled, true);
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
  await ui.tab('pending'); assert.match(ui.ids.get('library-list').textContent, /需确认栏目范围/); assert.match(ui.ids.get('library-list').textContent, /等待预算内试采/);
  assert.match(ui.ids.get('library-list').textContent, /栏目范围待确认，暂不参与轮转/);
  const confirmationCard = ui.ids.get('library-list').children.find(e => e.textContent.includes('auto-a'));
  await ui.button(confirmationCard, '编辑').fire('click');
  assert.match(ui.ids.get('library-save-status').textContent, /保存后由你管理/);
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 0);
});

test('automatically managed entry failures are repair states and manual channels never receive automatic labels', async () => {
  const data = fixture(); data.entries[0].access.managed_by = 'automatic'; data.entries[0].access.origin = 'reference'; data.entries[0].access.status = 'failed';
  const ui = await app(data); assert.match(ui.ids.get('library-list').textContent, /入口失败，待修复/);
  assert.doesNotMatch(ui.ids.get('library-list').textContent, /已自动启用/);
  await ui.tab('gaps'); assert.match(ui.ids.get('library-panel-gaps').textContent, /自动更新机制/);
  assert.match(ui.ids.get('library-panel-gaps').textContent, /暂停或移除不会被自动加回/);
});

test('verified parent integration keeps single-article history without asking for repeated scope confirmation, while pauses take precedence', async () => {
  const data = fixture(), entry = data.entries.find(e => e.id === 'candidate');
  entry.access.managed_by = 'automatic'; entry.access.origin = 'discovered_sources'; entry.access.scope_confirmation_needed = true;
  entry.integration = { entry_id: 'verified-parent', name: '已核验能源栏目' }; entry.usage.reason = 'scope_confirmation_needed';
  const ui = await app(data); await ui.tab('pending');
  const card = ui.ids.get('library-list').children.find(e => e.textContent.includes('candidate'));
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
