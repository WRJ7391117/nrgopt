const assert = require('node:assert/strict');
const { calcEnterpriseCarbon, calcCbamScenario } = require('../js/carbon-calculator.js');

const enterprise = calcEnterpriseCarbon({
  directEmissions: 2000,
  electricityWanKwh: 5000,
  gridFactor: 0.5366,
  greenShare: 0,
  internalPrice: 100,
  allowanceGap: 5,
  allowancePrice: 90,
  pvGenerationWanKwh: 120,
  pvSelfUse: 90,
});

assert.equal(enterprise.scope1, 2000);
assert.ok(Math.abs(enterprise.scope2 - 26830) < 1e-9, 'Scope 2 must convert 万kWh to MWh correctly');
assert.ok(Math.abs(enterprise.total - 28830) < 1e-9, 'enterprise baseline must reconcile');
assert.ok(Math.abs(enterprise.complianceCost - 0.9) < 1e-9, 'allowance scenario must only apply to Scope 1');
assert.ok(Math.abs(enterprise.avoided - 579.528) < 1e-9, 'PV reduction must be limited by self-used generation');
assert.ok(Math.abs(enterprise.afterTotal + enterprise.avoided - enterprise.total) < 1e-9, 'post-project emissions must reconcile');

const greenEnterprise = calcEnterpriseCarbon({ electricityWanKwh: 100, gridFactor: 0.5, greenShare: 100 });
assert.equal(greenEnterprise.scope2, 0, '100% qualified green electricity should make market-based Scope 2 zero in this scenario');

const cbam = calcCbamScenario({
  exportQty: 10000,
  directIntensity: 1.8,
  indirectIntensity: 0.35,
  liableShare: 2.5,
  euPrice: 80,
  exchangeRate: 7.8,
  paidCarbonPrice: 0,
  indirectReduction: 30,
});

assert.equal(cbam.scope1, 18000);
assert.equal(cbam.scope2, 3500);
assert.equal(cbam.embedded, 21500);
assert.equal(cbam.payable, 537.5);
assert.ok(Math.abs(cbam.annualCost - 33.54) < 1e-9, 'CBAM annual scenario cost must use payable emissions');
assert.equal(cbam.avoidedScope2, 1050, 'CBAM reduction scenario must affect indirect emissions only');
assert.ok(Math.abs(cbam.afterCost - 31.902) < 1e-9, 'CBAM post-reduction cost must reconcile');

const fullyDeducted = calcCbamScenario({ exportQty: 10, directIntensity: 1, liableShare: 100, euPrice: 10, exchangeRate: 7, paidCarbonPrice: 100 });
assert.equal(fullyDeducted.annualCost, 0, 'origin carbon price deduction must not create a negative CBAM cost');

console.log('carbon-regression: all assertions passed');
