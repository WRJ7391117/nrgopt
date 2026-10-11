const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const pages = require('../lib/intelligence/pages.cjs');

function ui() {
  const code = fs.readFileSync(require.resolve('../js/intelligence.js'), 'utf8');
  const elements = new Map();
  function element(tag = 'div') {
    return { tag, children: [], dataset: {}, hidden: false, textContent: '',
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }
    };
  }
  const context = { document: { createElement: element }, Date, Intl, Number,
    regionNames: { SA: '沙特阿拉伯' }, byId(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    directionText(parent, tag, value, className) {
      const child = element(tag); child.textContent = value; child.className = className; parent.append(child); return child;
    },
    paragraph(parent, value, className) {
      const child = element('p'); child.textContent = value; child.className = className; parent.append(child); return child;
    },
    setSourceLink(element, id) { element.href = '/intelligence/sources/' + id; },
    renderTextList(id, items) { context.byId(id).replaceChildren(...items.map(value => ({ tag: 'li', textContent: value }))); }
  };
  vm.createContext(context);
  vm.runInContext(code.slice(code.indexOf('  function publicationLabel('), code.indexOf('  function status(')), context);
  vm.runInContext(code.slice(code.indexOf('  function dateLabel('), code.indexOf('  function webUrl(')), context);
  vm.runInContext(code.slice(code.indexOf('  var riskStatusLabels ='), code.indexOf('  function overviewDiscovery(')), context);
  return context;
}
function day(age) {
  return new Date((Math.floor((Date.now() + 8 * 3600000) / 86400000) - age) * 86400000).toISOString().slice(0, 10);
}
function risk(patch = {}, status = 'reported') {
  return { id: 'risk-1', source_id: '11111111-1111-4111-8111-111111111111', status,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    payload: { event_date: day(1), publication_date: day(0), event_type: 'facility_attack',
      country_code: 'SA', facility_zh: '示例机场', severity: 'critical', title_zh: '设施遭袭相关报道',
      impact_status: 'unknown', facts: ['发布方报道设施事件。'], unknowns_zh: ['运行状态未知'],
      next_signals_zh: ['核对民航运行通报'], ...patch } };
}
function allText(node) { return [node.textContent, ...node.children.map(allText)].join(' '); }

test('risk recency uses event date before reporting and never uses record timestamps', () => {
  const uiCode = ui();
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: day(31), publication_date: day(0) }), '30'), false);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: day(1), publication_date: day(31) }), '30'), true);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: null, publication_date: day(2) }, 'pending_verification'), '30'), true);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: null, publication_date: null }, 'pending_verification'), '30'), false);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: null, publication_date: null }, 'pending_verification'), 'unknown'), true);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: null, publication_date: day(0) }, 'pending_verification'), 'unknown'), true);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: day(-1) }), '30'), false);
  assert.equal(uiCode.inRiskPeriod(risk({ event_date: '2026-02-30' }), '30'), false);
});

test('explicit historical risks stay out of recent views even with a new report', () => {
  const uiCode = ui(), old = risk({ event_date: day(1), publication_date: day(0) }, 'historical');
  assert.equal(uiCode.inRiskPeriod(old, '30'), false);
  assert.equal(uiCode.inRiskPeriod(old, '90'), false);
  assert.equal(uiCode.inRiskPeriod(old, 'all'), true);
});

test('risk cards preserve attributed facts, unknown event date and literal source text', () => {
  const uiCode = ui();
  const current = risk({ event_date: null, title_zh: '<img src=x onerror=alert(1)>',
    facts: [{ claim_zh: '发布方称出现设施损坏。', attribution_zh: '某公开报道' }] }, 'pending_verification');
  const card = uiCode.riskCard(current), content = allText(card);
  assert.match(content, /事件发生：未知，待核实/);
  assert.match(content, /报道发布：/);
  assert.match(content, /能源影响尚未明确/);
  assert.match(content, /某公开报道：发布方称出现设施损坏/);
  assert.ok(content.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!card.children.some(child => child.tag === 'img'));
  assert.doesNotMatch(content, /首次收录|项目成立|采购开放/);
});

test('risk details keep event, report and collection time separate without treating damage as energy proof', () => {
  const uiCode = ui();
  uiCode.byId('detail-fetched-at').textContent = '2026-10-11 本次原文抓取';
  uiCode.renderRiskDetail(risk({ event_date: null, impact_status: 'damaged' }, 'pending_verification'));
  assert.equal(uiCode.byId('detail-risk').hidden, false);
  assert.equal(uiCode.byId('detail-publication-label').textContent, '报道发布时间');
  assert.match(uiCode.byId('detail-event-date').textContent, /不能用报道或抓取日期代替/);
  assert.equal(uiCode.byId('detail-fetched-at').textContent, '2026-10-11 本次原文抓取');
  assert.match(uiCode.byId('detail-risk-impact').textContent, /设施损坏，能源影响仍需核对/);
  uiCode.renderRiskDetail(null);
  assert.equal(uiCode.byId('detail-risk').hidden, true);
  assert.equal(uiCode.byId('detail-event-time').hidden, true);
  assert.equal(uiCode.byId('detail-publication-label').textContent, '原文发布时间');
});

test('risk entry and readable modules use existing navigation and notification settings', () => {
  const discover = cheerio.load(pages.overviewPage()), workbench = cheerio.load(pages.workbenchPage());
  const detail = cheerio.load(pages.sourcesPage({ detailId: '11111111-1111-4111-8111-111111111111' }));
  const feishu = cheerio.load(pages.feishuPage());
  assert.equal(discover('.intel-discover-views a[data-view="risk"]').attr('href'), '/intelligence/discover?view=risk');
  assert.equal(discover('.intel-discover-views a').length, 6);
  assert.equal(workbench('#workbench-risk-section[hidden]').length, 1);
  assert.equal(workbench('#workbench-risk-section a').attr('href'), '/intelligence/discover?view=risk');
  assert.equal(detail('#detail-risk-facts').length, 1);
  assert.equal(detail('#detail-risk-unknowns').length, 1);
  assert.equal(detail('#detail-risk-next').length, 1);
  assert.match(feishu('input[name="daily_enabled"]').parent().text(), /08:00.*未完成.*缺口/);
  assert.match(feishu('input[name="flash_enabled"]').parent().text(), /重大设施风险.*能源影响未知/);
  assert.equal(feishu('input[name="daily_hour"]').length, 0);
});
