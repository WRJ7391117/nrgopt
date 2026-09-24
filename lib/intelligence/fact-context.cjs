const fail = kind => Object.assign(new Error(`extraction_invalid_${kind}`), { code: `extraction_invalid_${kind}`, status: 422 });
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const powerUnits = new Set(['W', 'kW', 'MW', 'GW', 'MWp', 'MWac', 'GWp', 'GWac', '兆瓦', '千瓦', '吉瓦', 'megawatts', 'gigawatts']);
const energyUnits = new Set(['Wh', 'kWh', 'MWh', 'GWh', '兆瓦时', '千瓦时', '吉瓦时']);
const bases = ['unspecified', 'it_load', 'facility_load', 'pv_peak', 'pv_ac', 'storage_power', 'nameplate_energy', 'usable_energy', 'project_investment', 'contract_value', 'financing', 'equipment_value'];

function text(value, max, required, kind) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(kind);
  return value.trim();
}

function factFor(item, facts, kind) {
  const number = item?.evidence_fact_number;
  if (!Number.isInteger(number) || number < 1 || number > facts.length) throw fail(kind);
  return facts[number - 1];
}

function quotePart(value, quote, max, required, kind) {
  const result = text(value, max, required, kind);
  if (result && !normalize(quote).includes(normalize(result))) throw fail(kind);
  return result;
}

function validateNumericFacts(input, facts) {
  if (input == null) return null; // Historical analyses have no structured numerical contract.
  if (!Array.isArray(input) || input.length > 16) throw fail('numeric_fact');
  return input.map(item => {
    const kind = 'numeric_fact';
    const fact = factFor(item, facts, kind);
    const raw = quotePart(item.raw_text, fact.evidence_quote, 1000, true, kind);
    const valueText = quotePart(item.value_text, raw, 80, true, kind);
    if (!new RegExp(`(?<![0-9.,])${escape(normalize(valueText))}(?![0-9.,])`).test(normalize(raw))) throw fail(kind);
    const unit = quotePart(item.unit, raw, 40, false, kind);
    if (unit && !new RegExp(`(?<![A-Za-z])${escape(normalize(unit))}(?![A-Za-z])`).test(normalize(raw))) throw fail(kind);
    const basis = item.basis || 'unspecified';
    if (!bases.includes(basis)) throw fail(kind);
    const basisText = quotePart(item.basis_text, fact.evidence_quote, 180, basis !== 'unspecified', kind);
    if (['it_load', 'facility_load', 'pv_peak', 'pv_ac', 'storage_power'].includes(basis) && !powerUnits.has(unit)) throw fail(kind);
    if (['nameplate_energy', 'usable_energy'].includes(basis) && !energyUnits.has(unit)) throw fail(kind);
    if (/^(M|G)Wp$/.test(unit || '') && !['pv_peak', 'unspecified'].includes(basis)) throw fail(kind);
    if (/^(M|G)Wac$/.test(unit || '') && !['pv_ac', 'unspecified'].includes(basis)) throw fail(kind);
    if (basis === 'nameplate_energy' && !/nameplate|nominal|额定|名义/i.test(basisText)) throw fail(kind);
    if (basis === 'usable_energy' && !/usable|useable|可用/i.test(basisText)) throw fail(kind);
    if (basis === 'facility_load' && /\bIT\b|information technology|IT负荷|IT容量/i.test(basisText)) throw fail(kind);
    if (basis === 'project_investment' && !/total investment|project investment|总投资|项目投资|استثمار/i.test(basisText)) throw fail(kind);
    if (item.fact_type && item.fact_type !== 'disclosed') throw fail(kind);
    const literal = normalize(valueText);
    const decimal = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?';
    const scalar = new RegExp(`^${decimal}$`).test(literal) ? Number(literal.replaceAll(',', '')) : null;
    const range = new RegExp(`^(${decimal})\\s*[-–—]\\s*(${decimal})$`).exec(literal);
    const bounds = range ? [Number(range[1].replaceAll(',', '')), Number(range[2].replaceAll(',', ''))] : null;
    if (bounds && bounds[0] > bounds[1]) throw fail(kind);
    return { object_zh: text(item.object_zh, 240, true, kind), field_zh: text(item.field_zh, 120, true, kind),
      value_text: valueText, value: scalar, value_min: bounds?.[0] ?? null, value_max: bounds?.[1] ?? null,
      unit, scale_text: quotePart(item.scale_text, raw, 40, false, kind), basis, basis_text: basisText,
      qualifier_text: quotePart(item.qualifier_text, raw, 80, false, kind),
      scope_text: quotePart(item.scope_text, fact.evidence_quote, 240, false, kind),
      stage_text: quotePart(item.stage_text, fact.evidence_quote, 180, false, kind),
      effective_date_text: quotePart(item.effective_date_text, fact.evidence_quote, 120, false, kind),
      currency: item.currency === 'USD' && raw.includes('US$') ? 'USD' : quotePart(item.currency, raw, 12, false, kind),
      tax_text: quotePart(item.tax_text, fact.evidence_quote, 100, false, kind),
      fact_type: 'disclosed', check_status: 'quote_bound', raw_text: raw, evidence_fact_number: item.evidence_fact_number };
  });
}

function validateCommercialEvents(input, facts) {
  if (input == null) return null;
  if (!Array.isArray(input) || input.length > 12) throw fail('commercial_event');
  return input.map(item => {
    const kind = 'commercial_event';
    const fact = factFor(item, facts, kind);
    if (!['project', 'development_rights', 'ppa', 'epc', 'construction_contract', 'equipment', 'service'].includes(item.scope)
      || !['planned', 'open', 'shortlisted', 'awarded', 'signed', 'construction', 'delivered', 'operating', 'cancelled'].includes(item.stage)) throw fail(kind);
    if (item.scope === 'epc' && !/\bEPC\b|engineering[\s,]+procurement|工程总承包/i.test(item.scope_text || '')) throw fail(kind);
    return { object_zh: text(item.object_zh, 240, true, kind), scope: item.scope, stage: item.stage,
      scope_text: quotePart(item.scope_text, fact.evidence_quote, 300, true, kind),
      stage_text: quotePart(item.stage_text, fact.evidence_quote, 200, true, kind),
      evidence_fact_number: item.evidence_fact_number, check_status: 'quote_bound' };
  });
}

function validateFactContext(value, facts) {
  const result = { numeric_facts: null, commercial_events: null, context_issues: [] };
  for (const [field, validate, limit] of [['numeric_facts', validateNumericFacts, 16], ['commercial_events', validateCommercialEvents, 12]]) {
    if (value[field] == null) continue;
    if (!Array.isArray(value[field]) || value[field].length > limit) throw fail('fact_context');
    result[field] = [];
    value[field].forEach((item, index) => {
      try { result[field].push(...validate([item], facts)); }
      catch (error) {
        if (!error.code?.startsWith('extraction_invalid_')) throw error;
        result.context_issues.push({ field, item_number: index + 1, code: error.code,
          object_zh: typeof item?.object_zh === 'string' ? item.object_zh.slice(0, 240) : '未明确对象',
          evidence_fact_number: Number.isInteger(item?.evidence_fact_number) && facts[item.evidence_fact_number - 1] ? item.evidence_fact_number : null });
      }
    });
  }
  // Preserve earlier validation warnings when replaying a saved, sanitized analysis.
  if (Array.isArray(value.context_issues)) result.context_issues.push(...value.context_issues.slice(0, 28).filter(item =>
    ['numeric_facts', 'commercial_events'].includes(item?.field) && /^extraction_invalid_[a-z_]+$/.test(item?.code || '')).map(item => ({
      field: item.field, code: item.code, item_number: Number.isInteger(item.item_number) ? item.item_number : null,
      object_zh: typeof item.object_zh === 'string' ? item.object_zh.slice(0, 240) : '未明确对象',
      evidence_fact_number: Number.isInteger(item.evidence_fact_number) && facts[item.evidence_fact_number - 1] ? item.evidence_fact_number : null
    })));
  return result;
}

const CONTEXT_PROMPT = `另输出 numeric_facts 和 commercial_events 两个数组，无明确证据时为空数组。
numeric_facts 最多16项，只列关键容量、负荷、储能、项目投资和具体合同金额，不列安全工时、碳排放、一般公司业绩或债券发行。仅记录披露值，不计算、不估算、不合计、不换算币种或单位。每项包含 object_zh、field_zh、value_text（只复制数值或范围，不包含单位和million/billion等倍率）、unit（原文单位或货币符号，如MWac、MWh、QAR、US$，不把billion当单位，未披露为null）、scale_text（million/billion/亿等原文倍率，否则null）、qualifier_text（approximately/over/up to等原文限定词，否则null）、raw_text（包含数值、限定词与单位的原文连续短句）、evidence_fact_number。
每项另含 basis（unspecified/it_load/facility_load/pv_peak/pv_ac/storage_power/nameplate_energy/usable_energy/project_investment/contract_value/financing/equipment_value）、basis_text（支持口径的原文短语，否则null）、scope_text（本期/全园区/组合等原文范围，否则null）、stage_text（规划/在建/投运等原文阶段，否则null）、effective_date_text（原文有效日期，否则null）、currency（原文明确货币代码，否则null，不能根据$猜USD）、tax_text（原文含税说明，否则null）、fact_type=disclosed。以上原文字段必须连续出现在所引用known_facts的引文内。
MW与MWh、MWp与MWac必须分别保留；MW未注明AC/DC时basis=unspecified。IT容量不是设施总负荷，缺PUE不得推算总负荷，缺备用时长/冗余/关键负荷证据不得推算BESS；未披露写unknowns_zh，不写0。名义与可用能量、单期与全园区、规划与投运、总投资、融资、本合同金额与设备采购额分别保留；施工合同金额用contract_value，融资用financing，未明确总投资不得用project_investment，无法确定口径则unspecified；不得取最大值或平均冲突值。不要以外部常识填写单位或日期。
commercial_events 最多12项。每项 object_zh（具名项目或采购包）、scope（project/development_rights/ppa/epc/construction_contract/equipment/service）、stage（planned/open/shortlisted/awarded/signed/construction/delivered/operating/cancelled）、scope_text（支持合同/包件类型的原文短语）、stage_text（支持该对象阶段的原文短语）、evidence_fact_number。只写construction contract的用construction_contract，不得扩大为EPC；只有明确EPC或engineering procurement construction才用epc。不要把同一条公告的阶段应用到所有采购包：开发权授标不等于EPC已定，EPC授标不等于设备采购，PPA不等于设备合同；设备合同未披露时不要创建equipment事件，在unknowns_zh注明未知。项目、每个包件、合同分别记录；不自动推断其他机会已关闭。
最后逐项检查：numeric_facts和commercial_events的所有原文字段都必须在它自己的evidence_fact_number对应引文中逐字存在，不能借用文章其他段落或其他事实的文字。可选字段若该引文中没有就填null；没有明确nameplate/nominal/usable字样的MWh容量，basis为unspecified，不默认名义或可用能量。只有US$可明确为USD；孤立$不推币种。`;

module.exports = { validateNumericFacts, validateCommercialEvents, validateFactContext, CONTEXT_PROMPT };
