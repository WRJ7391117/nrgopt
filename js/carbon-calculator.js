/* NRGOpt carbon decision calculator v1 */
'use strict';

function finite(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : (fallback || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function calcEnterpriseCarbon(p) {
  p = p || {};
  var direct = Math.max(0, finite(p.directEmissions));
  var electricityMWh = Math.max(0, finite(p.electricityWanKwh)) * 10;
  var gridFactor = Math.max(0, finite(p.gridFactor, 0.5366));
  var greenShare = clamp(p.greenShare, 0, 100) / 100;
  var scope2 = electricityMWh * gridFactor * (1 - greenShare);
  var total = direct + scope2;
  var internalPrice = Math.max(0, finite(p.internalPrice, 100));
  var allowanceGap = clamp(p.allowanceGap, 0, 100) / 100;
  var allowancePrice = Math.max(0, finite(p.allowancePrice, 90));
  var complianceCost = direct * allowanceGap * allowancePrice / 10000;
  var internalCost = total * internalPrice / 10000;

  var pvGenerationMWh = Math.max(0, finite(p.pvGenerationWanKwh)) * 10;
  var pvSelfUse = clamp(p.pvSelfUse, 0, 100) / 100;
  var reducibleMWh = Math.min(electricityMWh * (1 - greenShare), pvGenerationMWh * pvSelfUse);
  var avoided = reducibleMWh * gridFactor;
  var afterScope2 = Math.max(0, scope2 - avoided);
  var afterTotal = direct + afterScope2;
  var internalSaving = avoided * internalPrice / 10000;

  return {
    scope1: direct,
    scope2: scope2,
    total: total,
    intensityPerMWh: electricityMWh > 0 ? total / electricityMWh : null,
    complianceCost: complianceCost,
    internalCost: internalCost,
    avoided: avoided,
    afterScope2: afterScope2,
    afterTotal: afterTotal,
    internalSaving: internalSaving,
    reductionRate: total > 0 ? avoided / total * 100 : 0
  };
}

function calcCbamScenario(p) {
  p = p || {};
  var exportQty = Math.max(0, finite(p.exportQty));
  var directIntensity = Math.max(0, finite(p.directIntensity));
  var indirectIntensity = Math.max(0, finite(p.indirectIntensity));
  var liableShare = clamp(p.liableShare, 0, 100) / 100;
  var euPrice = Math.max(0, finite(p.euPrice, 80));
  var exchangeRate = Math.max(0, finite(p.exchangeRate, 7.8));
  var paidCarbonPrice = Math.max(0, finite(p.paidCarbonPrice));
  var indirectReduction = clamp(p.indirectReduction, 0, 100) / 100;

  var scope1 = exportQty * directIntensity;
  var scope2 = exportQty * indirectIntensity;
  var embedded = scope1 + scope2;
  var payable = embedded * liableShare;
  var grossUnitCost = euPrice * exchangeRate;
  var netUnitCost = Math.max(0, grossUnitCost - paidCarbonPrice);
  var annualCost = payable * netUnitCost / 10000;

  var avoidedScope2 = scope2 * indirectReduction;
  var afterEmbedded = embedded - avoidedScope2;
  var afterPayable = afterEmbedded * liableShare;
  var afterCost = afterPayable * netUnitCost / 10000;

  return {
    scope1: scope1,
    scope2: scope2,
    embedded: embedded,
    payable: payable,
    grossUnitCost: grossUnitCost,
    netUnitCost: netUnitCost,
    annualCost: annualCost,
    avoidedScope2: avoidedScope2,
    afterEmbedded: afterEmbedded,
    afterPayable: afterPayable,
    afterCost: afterCost,
    annualSaving: annualCost - afterCost
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcEnterpriseCarbon: calcEnterpriseCarbon, calcCbamScenario: calcCbamScenario };
}

(function initCarbonPage() {
  if (typeof document === 'undefined') return;

  function byId(id) { return document.getElementById(id); }
  function value(id) { var node = byId(id); return node ? node.value : 0; }
  function set(id, text) { var node = byId(id); if (node) node.textContent = text; }
  function number(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits == null ? 1 : digits });
  }
  function tonnes(value) { return number(value, 1); }
  function money(value) { return number(value, 2); }

  var enterpriseIds = [
    'entDirect', 'entElectricity', 'entGridFactor', 'entGreenShare', 'entAllowanceGap',
    'entAllowancePrice', 'entInternalPrice', 'entPvGeneration', 'entPvSelfUse'
  ];
  var cbamIds = [
    'cbamProduct', 'cbamExportQty', 'cbamDirectIntensity', 'cbamIndirectIntensity',
    'cbamLiableShare', 'cbamEuPrice', 'cbamExchangeRate', 'cbamPaidPrice', 'cbamIndirectReduction'
  ];

  function updateEnterprise() {
    var result = calcEnterpriseCarbon({
      directEmissions: value('entDirect'),
      electricityWanKwh: value('entElectricity'),
      gridFactor: value('entGridFactor'),
      greenShare: value('entGreenShare'),
      allowanceGap: value('entAllowanceGap'),
      allowancePrice: value('entAllowancePrice'),
      internalPrice: value('entInternalPrice'),
      pvGenerationWanKwh: value('entPvGeneration'),
      pvSelfUse: value('entPvSelfUse')
    });
    set('entScope1', tonnes(result.scope1));
    set('entScope2', tonnes(result.scope2));
    set('entTotal', tonnes(result.total));
    set('entComplianceCost', money(result.complianceCost));
    set('entInternalCost', money(result.internalCost));
    set('entAvoided', tonnes(result.avoided));
    set('entAfterTotal', tonnes(result.afterTotal));
    set('entSaving', money(result.internalSaving));
    set('entReductionRate', number(result.reductionRate, 1) + '%');
    set('entGreenShareValue', number(Number(value('entGreenShare')), 0) + '%');
    set('entAllowanceGapValue', number(Number(value('entAllowanceGap')), 0) + '%');
    set('entPvSelfUseValue', number(Number(value('entPvSelfUse')), 0) + '%');
  }

  function updateCbam() {
    var result = calcCbamScenario({
      exportQty: value('cbamExportQty'),
      directIntensity: value('cbamDirectIntensity'),
      indirectIntensity: value('cbamIndirectIntensity'),
      liableShare: value('cbamLiableShare'),
      euPrice: value('cbamEuPrice'),
      exchangeRate: value('cbamExchangeRate'),
      paidCarbonPrice: value('cbamPaidPrice'),
      indirectReduction: value('cbamIndirectReduction')
    });
    set('cbamScope1', tonnes(result.scope1));
    set('cbamScope2', tonnes(result.scope2));
    set('cbamEmbedded', tonnes(result.embedded));
    set('cbamPayable', tonnes(result.payable));
    set('cbamAnnualCost', money(result.annualCost));
    set('cbamNetUnitCost', number(result.netUnitCost, 1));
    set('cbamAvoided', tonnes(result.avoidedScope2));
    set('cbamAfterCost', money(result.afterCost));
    set('cbamSaving', money(result.annualSaving));
    set('cbamLiableShareValue', number(Number(value('cbamLiableShare')), 1) + '%');
    set('cbamIndirectReductionValue', number(Number(value('cbamIndirectReduction')), 0) + '%');
  }

  window.switchCarbonMode = function (mode) {
    var buttons = document.querySelectorAll('.carbon-mode-btn');
    var panels = document.querySelectorAll('[data-carbon-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-mode') === mode;
      buttons[i].classList.toggle('active', active);
      buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute('data-carbon-mode') !== mode;
    }
    var activePanel = document.querySelector('[data-carbon-mode="' + mode + '"]');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].setAttribute('tabindex', buttons[k].getAttribute('data-mode') === mode ? '0' : '-1');
    }
    if (activePanel) activePanel.setAttribute('aria-hidden', 'false');
    var inactiveMode = mode === 'enterprise' ? 'cbam' : 'enterprise';
    var inactivePanel = document.querySelector('[data-carbon-mode="' + inactiveMode + '"]');
    if (inactivePanel) inactivePanel.setAttribute('aria-hidden', 'true');
    var query = new URLSearchParams(window.location.search);
    query.set('mode', mode);
    history.replaceState(null, '', window.location.pathname + '?' + query.toString());
  };

  enterpriseIds.forEach(function (id) { var node = byId(id); if (node) node.addEventListener('input', updateEnterprise); });
  cbamIds.forEach(function (id) { var node = byId(id); if (node) node.addEventListener('input', updateCbam); });
  document.querySelector('.carbon-mode-bar').addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    var nextMode = document.querySelector('.carbon-mode-btn.active').getAttribute('data-mode') === 'enterprise' ? 'cbam' : 'enterprise';
    window.switchCarbonMode(nextMode);
    document.querySelector('.carbon-mode-btn[data-mode="' + nextMode + '"]').focus();
  });
  updateEnterprise();
  updateCbam();
  var initialMode = new URLSearchParams(window.location.search).get('mode') === 'cbam' ? 'cbam' : 'enterprise';
  window.switchCarbonMode(initialMode);
})();
