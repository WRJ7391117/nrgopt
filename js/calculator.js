/**
 * NrgOpt IRR Calculator — Engine + UI
 * Slider + number input sync, back-to-top, EN/ZH toggle
 */
(function () {
  'use strict';

  // ── IRR via Newton ──
  function npv(rate, cfs) {
    let t = 0;
    for (let i = 0; i < cfs.length; i++) t += cfs[i] / Math.pow(1 + rate, i);
    return t;
  }
  function irr(cfs, guess) {
    guess = guess || 0.1;
    let r = guess;
    for (let i = 0; i < 120; i++) {
      const f = npv(r, cfs);
      const df = (npv(r + 1e-6, cfs) - f) / 1e-6;
      if (Math.abs(df) < 1e-14) break;
      const d = f / df;
      r -= d;
      if (Math.abs(d) < 1e-8) return r;
    }
    return r;
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

  // ── Model ──
  function calc(params) {
    const cap = params.capacity, uc = params.unitCost;
    const lr = params.loanRatio, li = params.loanRate, ly = params.loanYears;
    const gkw = params.genPerW, ry = params.runYears;
    const su = params.selfUse, dp = params.dayPrice, gp = params.gridPrice;
    const vr = 0.13, mpw = 0.01, me = 0.03, mtw = 0.04, mte = 0.01;
    const dy = params.deprYears, res = 0.05, irpw = params.invReplace, iry = params.invYear;
    const disc = params.discount;
    const TI = cap * uc * 100;
    const loan = TI * lr;
    const prin = ly > 0 ? loan / ly : 0;
    const vatDed = TI * vr / (1 + vr);
    const deprBase = TI - vatDed;
    const deprA = deprBase * (1 - res) / dy;
    const invRep = cap * irpw * 100;
    const degradY1 = params.degradY1 || 0.01;
    const degradAnnual = params.degrad || 0.0055;
    const idealGen = cap * gkw * 100;
    const cfsF = [-TI], cfsE = [-(TI - loan)], rows = [];
    let cum = -TI;

    const genActualY1 = idealGen * (1 - degradY1);
    for (let y = 1; y <= ry; y++) {
      const gen = y === 1 ? genActualY1 : genActualY1 * Math.pow(1 - degradAnnual, y - 1);
      const rev = gen * su * dp / (1 + vr) + gen * (1 - su) * gp / (1 + vr);
      const vat = Math.max(0, rev * vr * 0.5);
      const sur = vat * 0.1;
      const mgmt = cap * mpw * 100 * Math.pow(1 + me, y - 1);
      const maint = cap * mtw * 100 * Math.pow(1 + mte, y - 1);
      const ins = TI * 0.001 * Math.pow(1.03, y - 1);
      const remLoan = Math.max(0, loan - prin * Math.min(y, ly));
      const int = remLoan * li;
      const depr = y <= dy ? deprA : 0;
      const totCost = depr + int + mgmt + maint + ins;
      const pbt = rev - sur - totCost;
      let tax;
      if (y <= 3) tax = 0;
      else if (y <= 6) tax = Math.max(0, pbt * 0.125);
      else tax = Math.max(0, pbt * 0.25);
      const pat = pbt - tax;
      let cf = pat + depr;
      if (y === iry) cf -= invRep;
      cfsF.push(cf);
      const prPaid = y <= ly ? prin : 0;
      let ecf = pat + depr - prPaid;
      if (y === iry) ecf -= invRep;
      cfsE.push(ecf);
      cum += cf;
      rows.push({ yr: y, gen: gen.toFixed(1), rev: rev.toFixed(1), totCost: totCost.toFixed(1), tax: tax.toFixed(1), pat: pat.toFixed(1), cf: cf.toFixed(1), cumCash: cum.toFixed(1) });
    }
    cfsF[cfsF.length - 1] += deprBase * res;
    cfsE[cfsE.length - 1] += deprBase * res;

    return {
      totalInv: TI, loan: loan, equity: TI - loan,
      genY1: genActualY1, irrFull: irr(cfsF), irrEq: irr(cfsE),
      npvFull: npv(disc, cfsF), payback: payback(cfsF), rows
    };
  }

  // ── Language ──
  function switchLang(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-en],[data-zh],[data-ja]').forEach(function (el) {
      if (lang === 'en' && el.hasAttribute('data-en')) el.textContent = el.getAttribute('data-en');
      else if (lang === 'zh' && el.hasAttribute('data-zh')) el.textContent = el.getAttribute('data-zh');
      else if (lang === 'ja' && el.hasAttribute('data-ja')) el.textContent = el.getAttribute('data-ja');
    });
    // Special: h1 slogan
    var h1 = document.querySelector('.calc-hero h1');
    if (!h1) return;
    var hl = h1.querySelector('.hl');
    if (hl) {
      var texts = { en: ['Distributed PV ', 'IRR Calculator'], zh: ['分布式光伏 ', 'IRR 测算'], ja: ['分散型太陽光 ', 'IRR試算'] };
      var t = texts[lang] || texts.zh;
      h1.childNodes[0] && (h1.childNodes[0].textContent = t[0]);
      hl.textContent = t[1];
    }
    var sel = document.getElementById('langSelect');
    if (sel) sel.value = lang;
    localStorage.setItem('nrgopt-lang', lang);
    // Table headers need innerHTML for data attributes
    document.querySelectorAll('th[data-en]').forEach(function(el) {
      var txt = lang === 'en' ? el.getAttribute('data-en') : (lang === 'zh' ? el.getAttribute('data-zh') : el.getAttribute('data-ja'));
      if (txt) el.textContent = txt;
    });
    update();
  }
  window.switchLang = switchLang;

  // ── Slider+Number binding ──
  function bindDual(sliderId, numId, dispId, fmt, onChange) {
    const slider = document.getElementById(sliderId);
    const numInput = document.getElementById(numId);
    const display = document.getElementById(dispId);
    if (!slider || !numInput) return;

    function sync(val) {
      const v = parseFloat(val);
      slider.value = v;
      numInput.value = v;
      if (display) display.textContent = typeof fmt === 'function' ? fmt(v) : v.toFixed(2);
    }

    slider.addEventListener('input', function () { sync(slider.value); if (onChange) onChange(); });
    numInput.addEventListener('input', function () {
      const raw = numInput.value;
      if (raw.endsWith('.') || raw === '' || raw === '-') return;
      const v = parseFloat(raw);
      if (!isNaN(v)) { sync(v); if (onChange) onChange(); }
    });
    numInput.addEventListener('change', function () {
      const raw = numInput.value;
      const v = parseFloat(raw);
      if (isNaN(v)) { sync(parseFloat(slider.value)); }
      else { sync(v); }
      if (onChange) onChange();
    });

    // Init
    sync(parseFloat(slider.value));
  }

  function computeGen() {
    var irr = parseFloat(document.getElementById('inpIrradiance').value) || 1350;
    var tilt = parseFloat(document.getElementById('inpTilt').value) || 1.05;
    var eff = (parseFloat(document.getElementById('inpSysEff').value) || 83.5) / 100;
    return irr * tilt * eff / 1000;
  }
  function getP() {
    return {
      capacity: parseFloat(document.getElementById('inpCapacity').value) || 0.4725,
      unitCost: parseFloat(document.getElementById('inpUnitCost').value) || 3.7,
      loanRatio: (parseFloat(document.getElementById('inpLoanRatio').value) || 70) / 100,
      loanRate: (parseFloat(document.getElementById('inpLoanRate').value) || 3.9) / 100,
      loanYears: parseInt(document.getElementById('inpLoanYears').value) || 15,
      genPerW: computeGen(),
      degradY1: (parseFloat(document.getElementById('inpDegradY1').value) || 1.0) / 100,
      degrad: (parseFloat(document.getElementById('inpDegrad').value) || 0.55) / 100,
      selfUse: (parseFloat(document.getElementById('inpSelfUse').value) || 90) / 100,
      dayPrice: parseFloat(document.getElementById('inpDayPrice').value) || 0.664,
      gridPrice: parseFloat(document.getElementById('inpGridPrice').value) || 0.3,
      runYears: parseInt(document.getElementById('inpRunYears').value) || 25,
      deprYears: parseInt(document.getElementById('inpDeprYears').value) || 10,
      invReplace: parseFloat(document.getElementById('inpInvReplace').value) || 0.2,
      invYear: parseInt(document.getElementById('inpInvYear').value) || 12,
      discount: (parseFloat(document.getElementById('inpDiscount').value) || 10) / 100
    };
  }

  let R = null;

  function update() {
    // Update derived displays
    var gw = computeGen();
    document.getElementById('dispGenPerW').textContent = gw.toFixed(3) + ' kWh/W';
    var irrad = parseFloat(document.getElementById('inpIrradiance').value) || 1350;
    var tilt = parseFloat(document.getElementById('inpTilt').value) || 1.05;
    var eff = (parseFloat(document.getElementById('inpSysEff').value) || 83.5) / 100;
    document.getElementById('dispSunHours').textContent = Math.round(irrad * tilt * eff);
    R = calc(getP());
    var fm = function(v) { return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString(); };
    document.getElementById('resTotalInv').textContent = fm(R.totalInv);
    document.getElementById('resIrrFull').textContent = (R.irrFull * 100).toFixed(2) + '%';
    document.getElementById('resIrrEq').textContent = (R.irrEq * 100).toFixed(2) + '%';
    document.getElementById('resNpv').textContent = (R.npvFull < 10 ? R.npvFull.toFixed(1) : Math.round(R.npvFull).toString());
    document.getElementById('resPayback').textContent = R.payback ? R.payback.toFixed(1) : '—';
    document.getElementById('resGenY1').textContent = fm(R.genY1);
    document.getElementById('resLoan').textContent = fm(R.loan);
    const irrEl = document.getElementById('resIrrFull');
    irrEl.className = 'metric-value ' + (R.irrFull >= 0.1 ? 'good' : R.irrFull >= 0.06 ? 'ok' : 'bad');

    // Table — dynamic years based on runYears
    const tbody = document.getElementById('cfTableBody');
    var ry = R.rows.length;
    var showKeys = [1,2,3,4,5,6,10,12,15,20,25].filter(function(y) { return y <= ry; });
    if (ry < 25 && showKeys.indexOf(ry) === -1) showKeys.push(ry);
    var show = new Set(showKeys);
    tbody.innerHTML = '';
    for (const r of R.rows) {
      if (show.has(r.yr)) {
        tbody.innerHTML += `<tr><td>${r.yr}</td><td>${r.gen}</td><td>${r.rev}</td><td>${r.totCost}</td><td>${r.tax}</td><td>${r.pat}</td><td>${r.cf}</td><td>${r.cumCash}</td></tr>`;
      }
    }
    drawChart(R.rows);
  }

  function drawChart(rows) {
    const c = document.getElementById('cfChart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width = c.parentElement.clientWidth - 32;
    const H = c.height = 150;
    ctx.clearRect(0, 0, W, H);
    if (rows.length < 2) return;

    let lo = Infinity, hi = -Infinity;
    for (const r of rows) { const v = parseFloat(r.cf); if (v < lo) lo = v; if (v > hi) hi = v; }
    lo = Math.min(0, lo); hi = Math.max(1, hi);
    const range = hi - lo || 1;
    const px = 24, py = 14;
    const w = W - px * 2, h = H - py * 2;
    const zy = H - py - (0 - lo) / range * h;

    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath(); ctx.moveTo(px, zy); ctx.lineTo(W - px, zy); ctx.stroke();

    const bw = Math.max(2, w / rows.length - 2);
    for (let i = 0; i < rows.length; i++) {
      const cf = parseFloat(rows[i].cf);
      const x = px + i / rows.length * w;
      const bh = Math.abs(cf) / range * h;
      const y = cf >= 0 ? zy - bh : zy;
      ctx.fillStyle = cf >= 0 ? '#34d399' : '#f87171';
      ctx.fillRect(x, y, bw, Math.max(1, bh));
    }
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
    for (let y = 0; y < rows.length; y += 5) ctx.fillText('Y' + (y + 1), px + y / rows.length * w - 4, H - 2);
  }

  // ── Back to top ──
  function initBTT() {
    const btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '&#8593;';
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.body.appendChild(btn);
    window.addEventListener('scroll', function () {
      btn.classList.toggle('visible', window.scrollY > 500);
    }, { passive: true });
  }

  // ── Region preset ──
  var regionMap = { tibet: 1900, nw: 1600, nc: 1400, ec: 1350, sc: 1100, sw: 1000 };
  window.setRegionPreset = function(val) {
    if (val === 'custom') return;
    var irr = regionMap[val];
    if (!irr) return;
    document.getElementById('inpIrradiance').value = irr;
    document.getElementById('numIrradiance').value = irr;
    document.getElementById('dispIrradiance').textContent = irr + ' kWh/m²';
    update();
  };

  // ── Init ──
  function init() {
    function uYr(v) { var l = document.documentElement.lang || 'zh'; return Math.round(v) + (l==='en'?' yr':(l==='ja'?' 年':' 年')); }
    function uMW(v) { return (v < 1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' MW'; }
    function uCnY(v) { var l = document.documentElement.lang || 'zh'; return v.toFixed(1) + (l==='en'?' CNY/W':' 元/W'); }
    function uKwh(v) { return v.toFixed(2) + ' kWh/W'; }
    function uPct(v) { return Math.round(v) + '%'; }
    function uPct1(v) { return v.toFixed(1) + '%'; }
    function uPrc(v) { var l = document.documentElement.lang || 'zh'; return (v < 1 ? v.toFixed(3) : v.toFixed(2)) + (l==='en'?' CNY/kWh':' 元/kWh'); }

    bindDual('inpCapacity', 'numCapacity', 'dispCapacity', uMW, update);
    bindDual('inpUnitCost', 'numUnitCost', 'dispUnitCost', uCnY, update);
    bindDual('inpLoanRatio', 'numLoanRatio', 'dispLoanRatio', uPct, update);
    bindDual('inpLoanRate', 'numLoanRate', 'dispLoanRate', uPct1, update);
    bindDual('inpLoanYears', 'numLoanYears', 'dispLoanYears', uYr, update);
    bindDual('inpIrradiance', 'numIrradiance', 'dispIrradiance', function(v) { return Math.round(v) + ' kWh/m²'; }, update);
    bindDual('inpTilt', 'numTilt', 'dispTilt', function(v) { return v.toFixed(2); }, update);
    bindDual('inpSysEff', 'numSysEff', 'dispSysEff', function(v) { return v.toFixed(1) + '%'; }, update);
    bindDual('inpSelfUse', 'numSelfUse', 'dispSelfUse', uPct, update);
    bindDual('inpDayPrice', 'numDayPrice', 'dispDayPrice', uPrc, update);
    bindDual('inpGridPrice', 'numGridPrice', 'dispGridPrice', uPrc, update);
    bindDual('inpDegradY1', 'numDegradY1', 'dispDegradY1', uPct1, update);
    bindDual('inpDegrad', 'numDegrad', 'dispDegrad', function(v) { return v.toFixed(2) + '%'; }, update);
    bindDual('inpRunYears', 'numRunYears', 'dispRunYears', uYr, update);
    bindDual('inpDeprYears', 'numDeprYears', 'dispDeprYears', uYr, update);
    bindDual('inpDiscount', 'numDiscount', 'dispDiscount', uPct, update);
    bindDual('inpInvReplace', 'numInvReplace', 'dispInvReplace', function(v) { return v.toFixed(2) + ' 元/W'; }, update);
    bindDual('inpInvYear', 'numInvYear', 'dispInvYear', function(v) { var l = document.documentElement.lang || 'en'; return (l==='en'?'Yr ':'第') + Math.round(v) + (l==='en'?'':(l==='ja'?'年':'年')); }, update);

    initBTT();
    update();

    window.addEventListener('resize', function () { if (R) drawChart(R.rows); });

    // Restore language
    const saved = localStorage.getItem('nrgopt-lang') || 'en';
    switchLang(saved);
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch (e) {
    // If init fails, retry on load
    window.addEventListener('load', init);
  }
})();
