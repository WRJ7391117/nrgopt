/**
 * NrgOpt IRR Calculator — Pure JS Calculation Engine + UI
 */
(function () {
  'use strict';

  // ── IRR via Newton's method ──
  function npv(rate, cashflows) {
    let total = 0;
    for (let i = 0; i < cashflows.length; i++) {
      total += cashflows[i] / Math.pow(1 + rate, i);
    }
    return total;
  }

  function irr(cashflows, guess = 0.1) {
    let rate = guess;
    for (let iter = 0; iter < 100; iter++) {
      const f = npv(rate, cashflows);
      const df = (npv(rate + 1e-6, cashflows) - f) / 1e-6;
      if (Math.abs(df) < 1e-12) break;
      const delta = f / df;
      rate -= delta;
      if (Math.abs(delta) < 1e-8) return rate;
    }
    return rate;
  }

  function payback(cfs) {
    let cum = 0;
    for (let i = 0; i < cfs.length; i++) {
      cum += cfs[i];
      if (cum > 0) {
        const prev = cum - cfs[i];
        return (i - 1) + Math.abs(prev) / (Math.abs(prev) + Math.abs(cfs[i]));
      }
    }
    return null;
  }

  // ── Core calculation ──
  function calculate(params) {
    const cap = params.capacity || 0.4725;
    const uc = params.unitCost || 3.7;
    const lr = params.loanRatio || 0.7;
    const li = params.loanRate || 0.039;
    const ly = params.loanYears || 15;
    const gkw = params.genPerW || 1.182;
    const ry = params.runYears || 25;
    const deg = params.degrad || 0.007;
    const su = params.selfUse || 0.9;
    const dp = params.dayPrice || 0.664;
    const gp = params.gridPrice || 0.3545;
    const vr = 0.13;
    const mpw = 0.01;
    const me = 0.03;
    const mtw = 0.04;
    const mte = 0.01;
    const dy = params.deprYears || 10;
    const res = 0.05;
    const irpw = 0.2;
    const iry = 12;
    const disc = params.discount || 0.1;

    const totalInv = cap * uc * 100;
    const loan = totalInv * lr;
    const prin = ly > 0 ? loan / ly : 0;
    const vatDed = totalInv * vr / (1 + vr);
    const deprBase = totalInv - vatDed;
    const deprAnnual = deprBase * (1 - res) / dy;
    const invReplace = cap * irpw * 100;
    const genY1 = cap * gkw * 100;

    const cfsFull = [-totalInv];
    const cfsEq = [-(totalInv - loan)];
    const annualRows = [];
    let cumCash = -totalInv;

    for (let yr = 1; yr <= ry; yr++) {
      const gen = genY1 * Math.pow(1 - deg, yr - 1);
      const rev = gen * su * dp / (1 + vr) + gen * (1 - su) * gp / (1 + vr);
      const vat = Math.max(0, rev * vr * 0.5);
      const sur = vat * 0.1;
      const mgmt = cap * mpw * 100 * Math.pow(1 + me, yr - 1);
      const maint = cap * mtw * 100 * Math.pow(1 + mte, yr - 1);
      const ins = totalInv * 0.001 * Math.pow(1.03, yr - 1);
      const remLoan = Math.max(0, loan - prin * Math.min(yr, ly));
      const interest = remLoan * li;
      const depr = yr <= dy ? deprAnnual : 0;
      const totCost = depr + interest + mgmt + maint + ins;
      const pbt = rev - sur - totCost;

      let tax;
      if (yr <= 3) tax = 0;
      else if (yr <= 6) tax = Math.max(0, pbt * 0.125);
      else tax = Math.max(0, pbt * 0.25);

      const pat = pbt - tax;
      let cf = pat + depr;
      if (yr === iry) cf -= invReplace;
      cfsFull.push(cf);

      const prPaid = yr <= ly ? prin : 0;
      let eqCf = pat + depr - prPaid;
      if (yr === iry) eqCf -= invReplace;
      cfsEq.push(eqCf);

      cumCash += cf;
      annualRows.push({
        yr, gen, rev: rev.toFixed(1), totCost: totCost.toFixed(1),
        tax: tax.toFixed(1), pat: pat.toFixed(1), cf: cf.toFixed(1),
        cumCash: cumCash.toFixed(1)
      });
    }

    cfsFull[cfsFull.length - 1] += deprBase * res;
    cfsEq[cfsEq.length - 1] += deprBase * res;

    const irrFull = irr(cfsFull);
    const irrEq = irr(cfsEq);
    const npvFull = npv(disc, cfsFull);
    const pb = payback(cfsFull);

    return {
      totalInv: totalInv.toFixed(1),
      loan: loan.toFixed(1),
      equity: (totalInv - loan).toFixed(1),
      genY1: genY1.toFixed(1),
      avgRev: (npvFull / ry * 5).toFixed(1), // rough annual avg
      irrFull: irrFull,
      irrEq: irrEq,
      npvFull: npvFull.toFixed(1),
      payback: pb ? pb.toFixed(1) : '—',
      annualRows: annualRows,
    };
  }

  // ── Global refs ──
  let currentResults = null;

  // ── Slider update ──
  function bindSlider(sliderId, displayId, format, onChange) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', function () {
      const val = parseFloat(slider.value);
      display.textContent = typeof format === 'function' ? format(val) : val.toFixed(2);
      if (onChange) onChange();
    });
    // Init display
    const initVal = parseFloat(slider.value);
    display.textContent = typeof format === 'function' ? format(initVal) : initVal.toFixed(2);
  }

  function getParams() {
    return {
      capacity: parseFloat(document.getElementById('inpCapacity').value),
      unitCost: parseFloat(document.getElementById('inpUnitCost').value),
      loanRatio: parseFloat(document.getElementById('inpLoanRatio').value) / 100,
      loanRate: parseFloat(document.getElementById('inpLoanRate').value) / 100,
      loanYears: parseInt(document.getElementById('inpLoanYears').value),
      genPerW: parseFloat(document.getElementById('inpGenPerW').value),
      runYears: 25,
      degrad: parseFloat(document.getElementById('inpDegrad').value) / 100,
      selfUse: parseFloat(document.getElementById('inpSelfUse').value) / 100,
      dayPrice: parseFloat(document.getElementById('inpDayPrice').value),
      gridPrice: parseFloat(document.getElementById('inpGridPrice').value),
      deprYears: parseInt(document.getElementById('inpDeprYears').value),
      discount: parseFloat(document.getElementById('inpDiscount').value) / 100,
    };
  }

  function updateResults() {
    const params = getParams();
    currentResults = calculate(params);
    const r = currentResults;

    // Key metrics
    document.getElementById('resTotalInv').textContent = r.totalInv;
    document.getElementById('resIrrFull').textContent = (r.irrFull * 100).toFixed(2) + '%';
    document.getElementById('resIrrEq').textContent = (r.irrEq * 100).toFixed(2) + '%';
    document.getElementById('resNpv').textContent = r.npvFull;
    document.getElementById('resPayback').textContent = r.payback;
    document.getElementById('resGenY1').textContent = r.genY1;
    document.getElementById('resLoan').textContent = r.loan;

    // Color-code IRR
    const irrEl = document.getElementById('resIrrFull');
    irrEl.className = 'metric-value ' + (r.irrFull >= 0.1 ? 'good' : r.irrFull >= 0.06 ? 'ok' : 'bad');

    // Cash flow table (first 10 years + key year)
    const tbody = document.getElementById('cfTableBody');
    tbody.innerHTML = '';
    const showYears = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 25];
    let lastShown = 0;
    for (const row of r.annualRows) {
      if (showYears.includes(row.yr)) {
        tbody.innerHTML += `<tr>
          <td>${row.yr}</td><td>${row.gen.toFixed(1)}</td><td>${row.rev}</td>
          <td>${row.totCost}</td><td>${row.tax}</td><td>${row.pat}</td>
          <td>${row.cf}</td><td>${row.cumCash}</td>
        </tr>`;
        lastShown = row.yr;
      }
    }

    // Mini chart: cash flow over 25 years
    drawMiniChart(r.annualRows);
  }

  function drawMiniChart(rows) {
    const canvas = document.getElementById('cfChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.parentElement.clientWidth - 32;
    const H = canvas.height = 140;
    ctx.clearRect(0, 0, W, H);

    if (rows.length < 2) return;

    // Find data range
    let minVal = Infinity, maxVal = -Infinity;
    for (const r of rows) {
      const cf = parseFloat(r.cf);
      if (cf < minVal) minVal = cf;
      if (cf > maxVal) maxVal = cf;
    }
    minVal = Math.min(0, minVal);
    maxVal = Math.max(1, maxVal);
    const range = maxVal - minVal || 1;
    const padX = 20, padY = 12;
    const w = W - padX * 2, h = H - padY * 2;

    // Zero line
    const zeroY = H - padY - (0 - minVal) / range * h;
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath(); ctx.moveTo(padX, zeroY); ctx.lineTo(W - padX, zeroY); ctx.stroke();

    // Bars
    const barW = Math.max(2, w / rows.length - 2);
    for (let i = 0; i < rows.length; i++) {
      const cf = parseFloat(rows[i].cf);
      const x = padX + i / rows.length * w;
      const barH = Math.abs(cf) / range * h;
      const y = cf >= 0 ? zeroY - barH : zeroY;
      ctx.fillStyle = cf >= 0 ? '#34d399' : '#f87171';
      ctx.fillRect(x, y, barW, Math.max(1, barH));
    }

    // Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    for (let yr = 0; yr < rows.length; yr += 5) {
      const x = padX + yr / rows.length * w;
      ctx.fillText('Y' + (yr + 1), x - 4, H - 2);
    }
  }

  // ── Init ──
  function init() {
    // Bind sliders
    bindSlider('inpCapacity', 'dispCapacity', function(v) { return v.toFixed(3) + ' MW'; }, updateResults);
    bindSlider('inpUnitCost', 'dispUnitCost', function(v) { return v.toFixed(1) + ' 元/W'; }, updateResults);
    bindSlider('inpLoanRatio', 'dispLoanRatio', function(v) { return Math.round(v) + '%'; }, updateResults);
    bindSlider('inpLoanRate', 'dispLoanRate', function(v) { return v.toFixed(1) + '%'; }, updateResults);
    bindSlider('inpLoanYears', 'dispLoanYears', function(v) { return Math.round(v) + ' 年'; }, updateResults);
    bindSlider('inpGenPerW', 'dispGenPerW', function(v) { return v.toFixed(2) + ' kWh/W'; }, updateResults);
    bindSlider('inpSelfUse', 'dispSelfUse', function(v) { return Math.round(v) + '%'; }, updateResults);
    bindSlider('inpDayPrice', 'dispDayPrice', function(v) { return v.toFixed(3) + ' 元/kWh'; }, updateResults);
    bindSlider('inpGridPrice', 'dispGridPrice', function(v) { return v.toFixed(3) + ' 元/kWh'; }, updateResults);
    bindSlider('inpDegrad', 'dispDegrad', function(v) { return v.toFixed(1) + '%'; }, updateResults);
    bindSlider('inpDeprYears', 'dispDeprYears', function(v) { return Math.round(v) + ' 年'; }, updateResults);
    bindSlider('inpDiscount', 'dispDiscount', function(v) { return Math.round(v) + '%'; }, updateResults);

    // Initial calculation
    updateResults();

    // Window resize → redraw chart
    window.addEventListener('resize', function () {
      if (currentResults) drawMiniChart(currentResults.annualRows);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
