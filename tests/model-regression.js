const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../js/calculator.js', `file://${__filename}`), 'utf8');
const modelSource = source.slice(0, source.indexOf('function el('));
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(modelSource, ctx);

function base() {
  return {
    capacity: 1, unitCost: 3.7, loanRatio: 0.7, loanRate: 0.03, loanYears: 10,
    repayMethod: 'equal-principal', genPerW: 1.1836125, runYears: 25,
    degradY1: 0.01, degrad: 0.0055, selfUse: 0.9, dayPrice: 0.664,
    gridPrice: 0.3, deprYears: 10, residual: 0.05, mgmtFee: 0.01,
    mgmtEscal: 0.03, maintFee: 0.04, maintEscal: 0.01, insRate: 0.1,
    vatRate: 0.13, vatRefundRate: 0, taxFreeYr: 3, taxHalfYr: 3,
    taxRate: 0.25, invReplace: 0.2, invYear: 12, discount: 0.1,
  };
}

function storage() {
  return {
    capacity: 0.2, duration: 2, unitCost: 0.8, dod: 85, priceEscal: 2.5,
    demandMode: 'demand', demandCharge: 40, demandReduction: 30,
    transCapacity: 30, spPrice: 1.2, spHours: 2, peakPrice: 1.05,
    peakHours: 4, flatPrice: 0.6, flatHours: 10, valleyPrice: 0.35,
    valleyHours: 8, cycles: 2, opDays: 330, rte: 88, runYears: 20,
    loanRatio: 0.7, loanRate: 0.03, loanYears: 10, repayMethod: 'equal-principal',
    degradY1: 0.025, degrad: 0.015, deprYears: 8, residual: 0.05,
    mgmtFee: 0.01, mgmtEscal: 0.03, maintFee: 0.015, maintEscal: 0.01,
    insRate: 0.15, vatRate: 0.13, vatRefundRate: 0, taxFreeYr: 3,
    taxHalfYr: 3, taxRate: 0.25, invReplace: 0.3, invYear: 10, discount: 0.08,
  };
}

const pv = ctx.calc(base());
assert.equal(pv.rows.length, 25);
assert.ok(Math.abs(pv.rows.at(-1).cumCash - pv.totalProfit) < 1e-8, 'PV summary must reconcile to table cash flow');
assert.ok(pv.rows[11].replacement > 0, 'inverter replacement must enter cash flow');
assert.ok(pv.rows[11].totCost > pv.rows[10].totCost, 'replacement must enter total cost');

const ci = ctx.calcCI(storage());
assert.ok(ci.genY1 > 15 && ci.genY1 < 25, `CI annual discharge should be about 19.3 万kWh, got ${ci.genY1}`);
assert.ok(ci.rows[10].gen > ci.rows[9].gen, 'battery replacement should reset degradation after year 10');
assert.ok(Math.abs(ci.rows.at(-1).cumCash - ci.totalProfit) < 1e-8, 'CI summary must reconcile');

const capacityBilling = { ...storage(), demandMode: 'capacity' };
const capacityBillingResult = ctx.calcCI(capacityBilling);
const changedCapacityPrice = ctx.calcCI({ ...capacityBilling, transCapacity: 999 });
assert.ok(capacityBillingResult.totalRev < ci.totalRev, 'capacity billing must not include maximum-demand savings');
assert.equal(changedCapacityPrice.totalRev, capacityBillingResult.totalRev, 'unsupported transformer-capacity savings must not silently affect results');

const noReplacement = { ...storage(), invReplace: 0 };
const ciNoReplacement = ctx.calcCI(noReplacement);
assert.ok(ciNoReplacement.rows[10].gen < ciNoReplacement.rows[9].gen, 'zero replacement cost must not reset battery degradation');
assert.equal(ctx.batteryHealth(20, 0, 0, 0, 330, 6000, 0), 1, 'zero configured degradation must remain zero');

const longLoan = base();
longLoan.runYears = 5;
longLoan.loanYears = 15;
longLoan.repayMethod = 'bullet';
const longLoanResult = ctx.calc(longLoan);
assert.ok(longLoanResult.irrEq == null || longLoanResult.irrEq < longLoanResult.irrFull, 'terminal debt must reduce equity return');

const isParams = { ...storage(), capacity: 50, duration: 2, unitCost: 0.9, leasePrice: 300,
  leaseRate: 85, spread: 0.5, freqReg: 50, cycles: 1.5, rte: 88, deprYears: 10 };
const independent = ctx.calcIS(isParams);
assert.ok(independent.genY1 > 4000 && independent.genY1 < 5000, `IS discharge unit must be 万kWh, got ${independent.genY1}`);

const hybridParams = { ...base(), duration: 2, spPrice: 1.2, spHours: 2,
  peakPrice: 1.05, peakHours: 4, valleyPrice: 0.35, cycles: 2, opDays: 330,
  stUC: 0.8, stLife: 15, stDepr: 8, hyStCap: 0.2, rte: 88, dod: 85,
  storageDegrad: 0.015, batReplace: 0.3, batYear: 10 };
const hybrid = ctx.calcHybrid(hybridParams);
assert.equal(hybrid.totalInv, 402, 'DOD must not reduce nominal storage CAPEX');
assert.equal(hybrid.rows.length, 25, 'PV should continue after storage life ends');
assert.ok(hybrid.rows[15].rev < hybrid.rows[14].rev, 'storage revenue must stop after storage life');
assert.ok(Math.abs(hybrid.rows.at(-1).cumCash - hybrid.totalProfit) < 1e-8, 'Hybrid summary must reconcile');

console.log('model-regression: all assertions passed');
