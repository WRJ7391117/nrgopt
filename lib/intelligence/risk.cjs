const { createHash } = require('node:crypto');
const regions = require('./regions.json');
const fail = kind => Object.assign(new Error(`extraction_invalid_risk_${kind}`), { code: `extraction_invalid_risk_${kind}`, status: 422 });
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const canonical = value => normalize(value).replace(/[\p{P}\p{Z}\s]/gu, '');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eventNames = { attack: '袭击', outage: '停电', accident: '事故', disaster: '灾害', supply_disruption: '供应中断', closure: '停运', recovery: '恢复运行', correction: '信息更正' };
const eventTerms = {
  attack: /attack|strike|struck|bomb|missile|drone|袭击|遭袭|轰炸|导弹|هجوم|هجمات|استهدف|قصف/i,
  outage: /outage|blackout|power (?:cut|loss)|停电|断电|انقطاع الكهرباء/i,
  accident: /accident|explosion|fire|collision|事故|爆炸|火灾|حادث|انفجار|حريق/i,
  disaster: /flood|earthquake|storm|cyclone|wildfire|洪水|地震|风暴|台风|山火|فيضانات|زلزال|عاصفة/i,
  supply_disruption: /supply.{0,30}(?:disrupt|interrupt|halt|stop)|供应.{0,12}(?:中断|停止)|توقف الإمداد|انقطاع الإمداد/i,
  closure: /clos(?:ed|ure)|shut down|suspend|halt|停运|关闭|暂停运行|إغلاق|اغلاق|تعليق/i,
  recovery: /restor|resum|reopen|恢复|重新开放|استئناف|استعادة|إعادة فتح/i,
  correction: /correct|retract|den(?:y|ied)|更正|撤回|否认|تصحيح|نفي/i,
};
const statementTerms = /condemn|denounc|solidarity|谴责|声援|团结|إدانة|دان(?:ت)?|تدين|التضامن/i;
const possibleEventTerms = /(?:may|might|could|would) (?:be )?(?:attack|strike|bomb|clos|disrupt)|(?:not|never) (?:been )?(?:attack|struck|bomb)|no (?:attack|outage|damage)|可能.{0,8}(?:袭击|停运|中断)|未遭袭|没有.{0,8}(?:袭击|停电|损坏)/i;
const facilityTerms = /\b(?:airport|port|refinery|pipeline|power (?:plant|station)|substation|grid|hospital|desalination|water (?:plant|works)|data cent(?:er|re)s?)\b|机场|港口|炼油|管道|电厂|电站|电网|医院|海水淡化|水厂|数据中心|مطار|ميناء|مصفاة|أنبوب|محطة|شبكة الكهرباء|مستشفى|تحلية/i;
const countryAliases = {
  SA: ['saudi', '沙特阿拉伯', 'السعودية', 'Riyadh', '利雅得', 'الرياض'], AE: ['UAE', 'الإمارات'], QA: ['قطر'], KW: ['الكويت'], OM: ['عمان'], BH: ['البحرين'],
  YE: ['اليمن'], IQ: ['العراق'], IR: ['إيران', 'ايران'], JO: ['الأردن'], LB: ['لبنان'], SY: ['سوريا'], IL: ['إسرائيل'], PS: ['فلسطين'], TR: ['Turkey', 'تركيا'],
  EG: ['مصر'], CY: ['قبرص'], DZ: ['الجزائر'], LY: ['ليبيا'], MA: ['المغرب'], TN: ['تونس'], SD: ['السودان'], EH: ['الصحراء الغربية', 'Laayoune', 'El Aaiún', '西撒哈拉'], MR: ['موريتانيا'],
  KZ: ['Казахстан', 'Қазақстан'], UZ: ['Узбекистан', 'Oʻzbekiston'], KG: ['Кыргызстан', 'Киргизия'], TJ: ['Таджикистан', 'Тоҷикистон'], TM: ['Туркменистан', 'Türkmenistan'],
};

function countryInQuote(code, quote) {
  const country = regions.countries.find(item => item.code === code);
  if (!country) return false;
  const text = normalize(quote);
  return [country.name, country.english, ...(countryAliases[code] || [])].some(name => {
    const term = normalize(name);
    if (/^[a-z ]+$/.test(term)) return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`).test(text);
    return text.includes(term);
  });
}

function explicitDate(quote, date) {
  const [year, month, day] = date.split('-').map(Number);
  const text = normalize(quote).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const arabicMonths = ['يناير', 'فبراير', 'مارس', 'أبريل|ابريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس|اغسطس', 'سبتمبر', 'أكتوبر|اكتوبر', 'نوفمبر', 'ديسمبر'];
  const namedMonth = `(?:${monthNames[month - 1]}|${monthNames[month - 1].slice(0, 3)}\\.?|${arabicMonths[month - 1]})`;
  return new RegExp(`(?<![0-9])(?:${year}[-/.年]0?${month}[-/.月]0?${day}(?:日)?|0?${day}\\s+${namedMonth}[,\\s]+${year}|${namedMonth}\\s+0?${day}(?:st|nd|rd|th)?[,\\s]+${year})(?![0-9])`, 'i').test(text);
}

function normalizeRisk(extraction, sourceText) {
  const input = extraction?.risk_signal;
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(eventNames, input.event_type)
    || !['reported_event', 'statement_only'].includes(input.event_status) || !['high', 'critical'].includes(input.severity)
    || !['unknown', 'interrupted', 'damaged', 'restored'].includes(input.impact_status)) throw fail('structure');
  const fields = {};
  for (const [name, limit] of [['facility_zh', 180], ['facility_name', 240]]) {
    if (typeof input[name] !== 'string' || !input[name].trim() || input[name].length > limit) throw fail('facility');
    fields[name] = input[name].trim();
  }
  if (!facilityTerms.test(fields.facility_name)) throw fail('facility');
  if (!regions.countries.some(item => item.code === input.country_code)) throw fail('country');
  if (!Array.isArray(input.fact_numbers) || !input.fact_numbers.length || input.fact_numbers.length > 8) throw fail('evidence');
  const facts = extraction.known_facts || [];
  const numbers = [...new Set(input.fact_numbers)];
  const selected = numbers.map(number => {
    const fact = Number.isInteger(number) && number >= 1 ? facts[number - 1] : null;
    if (!fact || !['disclosure', 'report'].includes(fact.statement_type) || !fact.evidence_quote
      || !normalize(sourceText).includes(normalize(fact.evidence_quote))) throw fail('evidence');
    return fact;
  });
  const occurrence = selected.filter(fact => normalize(fact.evidence_quote).includes(normalize(fields.facility_name))
    && facilityTerms.test(fact.evidence_quote) && eventTerms[input.event_type].test(fact.evidence_quote)
    && countryInQuote(input.country_code, fact.evidence_quote));
  if (!occurrence.length) throw fail('evidence');
  if (input.event_status === 'reported_event' && occurrence.every(fact => statementTerms.test(fact.evidence_quote)
    || (input.event_type !== 'correction' && possibleEventTerms.test(fact.evidence_quote)))) throw fail('statement');
  const impacts = { interrupted: /interrupt|disrupt|suspend|halt|clos(?:ed|ure)|outage|停运|停电|中断|关闭|暂停|انقطاع|إغلاق|تعليق/i,
    damaged: /damag|destroy|损坏|损毁|摧毁|تضرر|تدمير/i, restored: eventTerms.recovery };
  if (input.impact_status !== 'unknown' && !selected.some(fact => impacts[input.impact_status].test(fact.evidence_quote))) throw fail('impact');
  let date = null;
  let dateNumber = null;
  if (input.event_date != null) {
    date = input.event_date;
    dateNumber = input.date_fact_number;
    const dateFact = Number.isInteger(dateNumber) && numbers.includes(dateNumber) ? facts[dateNumber - 1] : null;
    const timestamp = typeof date === 'string' ? Date.parse(date + 'T00:00:00Z') : NaN;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date
      || !dateFact || !explicitDate(dateFact.evidence_quote, date) || !normalize(dateFact.evidence_quote).includes(normalize(fields.facility_name))
      || !eventTerms[input.event_type].test(dateFact.evidence_quote) || statementTerms.test(dateFact.evidence_quote)) throw fail('date');
  } else if (input.date_fact_number != null) throw fail('date');
  return { event_type: input.event_type, ...fields, country_code: input.country_code, event_date: date,
    event_status: input.event_status, severity: input.severity, impact_status: input.impact_status, fact_numbers: numbers, date_fact_number: dateNumber };
}

function riskFactFingerprint(risk, extraction) {
  const numeric = (extraction.numeric_facts || []).filter(item => risk.fact_numbers.includes(item.evidence_fact_number)).map(item =>
    [item.basis, normalize(item.value_text), normalize(item.unit), normalize(item.scale_text)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return hash([risk.event_type, risk.impact_status, numeric]);
}

function legacyRisk(extraction) {
  if (Object.hasOwn(extraction || {}, 'risk_signal')) return null;
  for (const [index, fact] of (extraction?.known_facts || []).entries()) {
    if (!['disclosure', 'report'].includes(fact.statement_type) || !fact.evidence_quote) continue;
    const quote = fact.evidence_quote;
    const facility = quote.match(/\b(?:[A-Z][\p{L}'’-]+\s+){1,6}(?:Airport|airport|Port|Refinery|Hospital|Power Plant|Power Station|Pipeline|Substation|Data Center|Data Centre)\b/u)
      || quote.match(/[\p{Script=Han}]{2,25}(?:机场|港口|炼油厂|电厂|医院|数据中心)/u);
    const type = Object.keys(eventTerms).find(kind => eventTerms[kind].test(quote));
    const country = (extraction.classification?.countries || []).find(item => item.relation === 'occurrence'
      && item.evidence_fact_number === index + 1 && countryInQuote(item.code, quote));
    if (!facility || !type || !country) continue;
    return { event_type: type, facility_zh: facility[0], facility_name: facility[0], country_code: country.code,
      event_date: null, event_status: 'statement_only', severity: 'high', impact_status: 'unknown', fact_numbers: [index + 1], date_fact_number: null, legacy: true };
  }
  return null;
}

function riskSnapshot(source, analysis, now = new Date()) {
  const extraction = analysis?.extraction || analysis?.extraction_zh || analysis || source?.extraction_zh;
  if (!extraction || typeof extraction !== 'object') return null;
  let risk;
  try { risk = Object.hasOwn(extraction, 'risk_signal') ? normalizeRisk(extraction, (extraction.known_facts || []).map(fact => fact.evidence_quote).join('\n')) : legacyRisk(extraction); }
  catch (error) { if (error.code?.startsWith('extraction_invalid_risk_')) return null; throw error; }
  if (!risk) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const age = date => date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? (Date.parse(today) - Date.parse(date)) / 86400000 : null;
  const publicationDate = source?.publication_date || null;
  const eventAge = age(risk.event_date);
  const publicationAge = age(publicationDate);
  const historical = eventAge != null && eventAge > 30;
  const reported = !historical && risk.event_status === 'reported_event' && eventAge != null && eventAge >= 0 && eventAge <= 30;
  const eligible = reported && eventAge <= 3 && publicationAge != null && publicationAge >= 0 && publicationAge <= 3;
  const unknowns = [...(extraction.unknowns_zh || [])];
  const energyAssociated = ['direct', 'demand_driver', 'resilience_driver'].includes(extraction.classification?.energy_scope);
  const energyImpact = energyAssociated ? extraction.why_it_matters_zh || '能源关联分析尚待补充。' : '现有原文未披露能源影响。';
  if (!risk.event_date) unknowns.unshift('事件发生时间尚待核实，来源发布日期不代表事件发生日。');
  if (risk.event_status === 'statement_only') unknowns.unshift('现有依据为声明或转述，事件经过与设施运行状态尚待独立核实。');
  if (risk.impact_status === 'unknown') unknowns.push('设施运行状态尚未披露。');
  if (!energyAssociated) unknowns.push('能源供应影响尚未披露。');
  return { ...risk, event_key: risk.event_date ? hash([risk.country_code, canonical(risk.facility_zh), risk.event_type, risk.event_date]) : null,
    fact_fingerprint: riskFactFingerprint(risk, extraction), title_zh: `${risk.facility_zh}｜${eventNames[risk.event_type]}${reported ? '' : '相关线索'}`,
    facts: risk.fact_numbers.slice(0,3).map(number => extraction.known_facts[number - 1].claim_zh),
    unknowns_zh: [...new Set(unknowns)].slice(0,3),
    next_signals_zh: [...new Set(['核对设施运营方或主管机关通报，确认事件时间、运行状态与能源影响。', ...(extraction.next_signals_zh || [])])].slice(0,3),
    topic_codes: [...new Set((extraction.classification?.topics || []).map(topic => topic.code).filter(Boolean))],
    energy_impact_zh: energyImpact,
    publication_date: publicationDate, fetched_at: source?.fetched_at || null, first_collected_at: source?.first_collected_at || source?.fetched_at || null,
    notification_eligible: Boolean(eligible), status: historical ? 'historical' : reported ? 'reported' : 'pending_verification' };
}

module.exports = { normalizeRisk, riskSnapshot, riskFactFingerprint };
