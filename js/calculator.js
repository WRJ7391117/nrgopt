/**
 * NrgOpt IRR Calculator v3 — simplified init, no IIFE
 */
'use strict';

// ── IRR via Newton ──
function npv(rate, cfs) { var t=0; for(var i=0;i<cfs.length;i++) t += cfs[i]/Math.pow(1+rate,i); return t; }
function irr(cfs, guess) { guess=guess||0.1; var r=guess; for(var i=0;i<120;i++){var f=npv(r,cfs);var df=(npv(r+1e-6,cfs)-f)/1e-6;if(Math.abs(df)<1e-14)break;var d=f/df;r-=d;if(Math.abs(d)<1e-8)return r;} return r; }
function payback(cfs){var cum=0;for(var i=0;i<cfs.length;i++){cum+=cfs[i];if(cum>0){var prev=cum-cfs[i];return(i-1)+Math.abs(prev)/(Math.abs(prev)+Math.abs(cfs[i]));}}return null;}

// ── Model ──
function calc(params){
  var cap=params.capacity, uc=params.unitCost, lr=params.loanRatio, li=params.loanRate, ly=params.loanYears;
  var gkw=params.genPerW, ry=params.runYears, su=params.selfUse, dp=params.dayPrice, gp=params.gridPrice;
  var degradY1=params.degradY1||0.01, degradA=params.degrad||0.0055;
  var vr=0.13, mpw=0.01, me=0.03, mtw=0.04, mte=0.01;
  var dy=params.deprYears, res=0.05, irpw=params.invReplace, iry=params.invYear, disc=params.discount;
  var TI=cap*uc*100, loan=TI*lr, prin=ly>0?loan/ly:0;
  var vatDed=TI*vr/(1+vr), deprBase=TI-vatDed, deprA=deprBase*(1-res)/dy, invRep=cap*irpw*100;
  var idealGen=cap*gkw*100, genY1=idealGen*(1-degradY1);
  var cfsF=[-TI], cfsE=[-(TI-loan)], rows=[], cum=-TI;
  for(var y=1;y<=ry;y++){
    var gen=y===1?genY1:genY1*Math.pow(1-degradA,y-1);
    var rev=gen*su*dp/(1+vr)+gen*(1-su)*gp/(1+vr);
    var vat=Math.max(0,rev*vr*0.5), sur=vat*0.1;
    var mgmt=cap*mpw*100*Math.pow(1+me,y-1);
    var maint=cap*mtw*100*Math.pow(1+mte,y-1);
    var ins=TI*0.001*Math.pow(1.03,y-1);
    var remLoan=Math.max(0,loan-prin*Math.min(y,ly));
    var interest=remLoan*li;
    var depr=y<=dy?deprA:0;
    var totCost=depr+interest+mgmt+maint+ins;
    var pbt=rev-sur-totCost;
    var tax; if(y<=3)tax=0;else if(y<=6)tax=Math.max(0,pbt*0.125);else tax=Math.max(0,pbt*0.25);
    var pat=pbt-tax;
    var cf=pat+depr; if(y===iry)cf-=invRep;
    cfsF.push(cf);
    var prPaid=y<=ly?prin:0;
    var ecf=pat+depr-prPaid; if(y===iry)ecf-=invRep;
    cfsE.push(ecf);
    cum+=cf;
    rows.push({yr:y,gen:gen.toFixed(1),rev:rev.toFixed(1),totCost:totCost.toFixed(1),tax:tax.toFixed(1),pat:pat.toFixed(1),cf:cf.toFixed(1),cumCash:cum.toFixed(1)});
  }
  cfsF[cfsF.length-1]+=deprBase*res; cfsE[cfsE.length-1]+=deprBase*res;
  return {totalInv:TI,loan:loan,equity:TI-loan,genY1:genY1,irrFull:irr(cfsF),irrEq:irr(cfsE),npvFull:npv(disc,cfsF),payback:payback(cfsF),rows:rows};
}

// ── Helpers ──
function el(id){ return document.getElementById(id); }
function val(id){ var e=el(id); return e?parseFloat(e.value)||0:0; }
function ival(id){ var e=el(id); return e?parseInt(e.value)||0:0; }

function getP(){
  return {
    capacity:val('inpCapacity')||1, unitCost:val('inpUnitCost')||3.7,
    loanRatio:(val('inpLoanRatio')||70)/100, loanRate:(val('inpLoanRate')||3.9)/100,
    loanYears:ival('inpLoanYears')||15, genPerW:computeGen(),
    runYears:ival('inpRunYears')||25,
    degradY1:(val('inpDegradY1')||1)/100, degrad:(val('inpDegrad')||0.55)/100,
    selfUse:(val('inpSelfUse')||90)/100, dayPrice:val('inpDayPrice')||0.664,
    gridPrice:val('inpGridPrice')||0.3, deprYears:ival('inpDeprYears')||10,
    invReplace:val('inpInvReplace')||0.2, invYear:ival('inpInvYear')||12,
    discount:(val('inpDiscount')||10)/100
  };
}

function computeGen(){
  var irr=val('inpIrradiance')||1350, tilt=val('inpTilt')||1.05, eff=(val('inpSysEff')||83.5)/100;
  return irr*tilt*eff/1000;
}

// ── UI ──
var R=null;

function update(){
  var gw=computeGen();
  var l=document.documentElement.lang||'en';
  var e=el('dispGenPerW'); if(e)e.textContent=gw.toFixed(3)+(l==='en'?' kWh/W':(l==='ja'?' kWh/W':' 千瓦时/瓦'));
  var irrad=val('inpIrradiance')||1350, tilt=val('inpTilt')||1.05, eff=(val('inpSysEff')||83.5)/100;
  e=el('dispSunHours'); if(e)e.textContent=Math.round(irrad*tilt*eff);

  R=calc(getP());
  var fm=function(v){return v<10?v.toFixed(2):v<100?v.toFixed(1):Math.round(v).toString();};
  setText('resTotalInv',fm(R.totalInv));
  setText('resIrrFull',(R.irrFull*100).toFixed(2)+'%');
  setText('resIrrEq',(R.irrEq*100).toFixed(2)+'%');
  setText('resNpv',R.npvFull<10?R.npvFull.toFixed(1):Math.round(R.npvFull).toString());
  setText('resPayback',R.payback?R.payback.toFixed(1):'—');
  setText('resGenY1',fm(R.genY1));
  setText('resLoan',fm(R.loan));
  e=el('resIrrFull'); if(e)e.className='metric-value '+(R.irrFull>=0.1?'good':R.irrFull>=0.06?'ok':'bad');

  var tbody=el('cfTableBody'); if(!tbody)return;
  var ry=R.rows.length;
  var showKeys=[1,2,3,4,5,6,10,12,15,20,25].filter(function(y){return y<=ry;});
  if(ry<25&&showKeys.indexOf(ry)===-1)showKeys.push(ry);
  var show={};for(var i=0;i<showKeys.length;i++)show[showKeys[i]]=true;
  tbody.innerHTML='';
  for(var i=0;i<R.rows.length;i++){
    var r=R.rows[i];
    if(show[r.yr]) tbody.innerHTML+='<tr><td>'+r.yr+'</td><td>'+r.gen+'</td><td>'+r.rev+'</td><td>'+r.totCost+'</td><td>'+r.tax+'</td><td>'+r.pat+'</td><td>'+r.cf+'</td><td>'+r.cumCash+'</td></tr>';
  }
  drawChart(R.rows);
}

function setText(id,txt){var e=el(id);if(e)e.textContent=txt;}

function drawChart(rows){
  var c=el('cfChart'); if(!c)return;
  var ctx=c.getContext('2d');
  var W=c.width=c.parentElement.clientWidth-32;
  var H=c.height=150;
  ctx.clearRect(0,0,W,H);
  if(rows.length<2)return;
  var lo=Infinity,hi=-Infinity;
  for(var i=0;i<rows.length;i++){var v=parseFloat(rows[i].cf);if(v<lo)lo=v;if(v>hi)hi=v;}
  lo=Math.min(0,lo);hi=Math.max(1,hi);var range=hi-lo||1;
  var px=24,py=14,w=W-px*2,h=H-py*2,zy=H-py-(0-lo)/range*h;
  ctx.strokeStyle='rgba(148,163,184,0.3)';ctx.beginPath();ctx.moveTo(px,zy);ctx.lineTo(W-px,zy);ctx.stroke();
  var bw=Math.max(2,w/rows.length-2);
  for(var i=0;i<rows.length;i++){
    var cf=parseFloat(rows[i].cf),x=px+i/rows.length*w,bh=Math.abs(cf)/range*h,y=cf>=0?zy-bh:zy;
    ctx.fillStyle=cf>=0?'#34d399':'#f87171';ctx.fillRect(x,y,bw,Math.max(1,bh));
  }
  ctx.fillStyle='#94a3b8';ctx.font='10px sans-serif';
  for(var y=0;y<rows.length;y+=5)ctx.fillText('Y'+(y+1),px+y/rows.length*w-4,H-2);
}

// ── Slider + Number sync ──
function bindDual(sliderId,numId,dispId,fmt){
  var slider=el(sliderId), num=el(numId), disp=el(dispId);
  if(!slider||!num)return;

  function sync(v){var vv=parseFloat(v);slider.value=vv;num.value=vv;if(disp)disp.textContent=typeof fmt==='function'?fmt(vv):vv.toFixed(2);}

  slider.addEventListener('input',function(){sync(slider.value);update();});
  num.addEventListener('input',function(){var raw=num.value;if(raw.endsWith('.')||raw===''||raw==='-')return;var vv=parseFloat(raw);if(!isNaN(vv)){sync(vv);update();}});
  num.addEventListener('change',function(){var raw=num.value,vv=parseFloat(raw);if(isNaN(vv))sync(parseFloat(slider.value));else sync(vv);update();});

  sync(parseFloat(slider.value));
}

// ── Language ──
window.switchLang=function(lang){
  document.documentElement.lang=lang;
  var els=document.querySelectorAll('[data-en],[data-zh],[data-ja]');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(lang==='en'&&el.hasAttribute('data-en'))el.textContent=el.getAttribute('data-en');
    else if(lang==='zh'&&el.hasAttribute('data-zh'))el.textContent=el.getAttribute('data-zh');
    else if(lang==='ja'&&el.hasAttribute('data-ja'))el.textContent=el.getAttribute('data-ja');
  }
  var h1=document.querySelector('.calc-hero h1');
  if(h1){var hl=h1.querySelector('.hl');if(hl){
    var t={en:['Distributed PV ','IRR Calculator'],zh:['分布式光伏 ','IRR 测算'],ja:['分散型太陽光 ','IRR試算']};
    var tt=t[lang]||t.zh;h1.childNodes[0]&&(h1.childNodes[0].textContent=tt[0]);hl.textContent=tt[1];
  }}
  var sel=el('langSelect');if(sel)sel.value=lang;
  try{localStorage.setItem('nrgopt-lang',lang);}catch(e){}
  var ths=document.querySelectorAll('th[data-en]');
  for(var i=0;i<ths.length;i++){
    var th=ths[i],txt=lang==='en'?th.getAttribute('data-en'):(lang==='zh'?th.getAttribute('data-zh'):th.getAttribute('data-ja'));
    if(txt)th.textContent=txt;
  }
  update();
};

// ── Region preset ──
var regionMap={tibet:1900,nw:1600,nc:1400,ec:1350,sc:1100,sw:1000};
window.setRegionPreset=function(val){
  if(val==='custom')return;
  var irr=regionMap[val];if(!irr)return;
  var s=el('inpIrradiance'),n=el('numIrradiance'),d=el('dispIrradiance');
  if(s)s.value=irr;if(n)n.value=irr;
  if(d){var l=document.documentElement.lang||'en';d.textContent=irr+(l==='en'?' kWh/m²':(l==='ja'?' kWh/m²':' 千瓦时/平方米'));}
  update();
};

// ── Back to top ──
function initBTT(){
  var btn=document.createElement('button');
  btn.className='back-to-top';btn.setAttribute('aria-label','Back to top');btn.innerHTML='&#8593;';
  btn.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
  document.body.appendChild(btn);
  window.addEventListener('scroll',function(){btn.classList.toggle('visible',window.scrollY>500);},{passive:true});
}

// ── Init ──
function init(){
  function L(){return document.documentElement.lang||'en';}
  function uYr(v){var l=L();return Math.round(v)+(l==='en'?' yr':(l==='ja'?' 年':' 年'));}
  function uPct(v){return Math.round(v)+'%';}
  function uPct1(v){return v.toFixed(1)+'%';}
  function uPrc(v){var l=L();return(v<1?v.toFixed(3):v.toFixed(2))+(l==='en'?' ¢/kWh':(l==='ja'?' 元/kWh':' 元/千瓦时'));}
  function uMW(v){var l=L();return(v<1?v.toFixed(3):v<10?v.toFixed(2):v.toFixed(1))+(l==='en'?' MW':(l==='ja'?' MW':' 兆瓦'));}
  function uCnY(v){var l=L();return v.toFixed(1)+(l==='en'?' ¢/W':(l==='ja'?' 元/W':' 元/瓦'));}
  function uIrr(v){var l=L();return Math.round(v)+(l==='en'?' kWh/m²':(l==='ja'?' kWh/m²':' 千瓦时/平方米'));}
  function uInv(v){var l=L();return v.toFixed(2)+(l==='en'?' ¢/W':(l==='ja'?' 元/W':' 元/瓦'));}
  function uInvYr(v){var l=L();return(l==='en'?'Yr ':'第')+Math.round(v)+(l==='en'?'':(l==='ja'?'年':'年'));}

  bindDual('inpCapacity','numCapacity','dispCapacity',uMW);
  bindDual('inpUnitCost','numUnitCost','dispUnitCost',uCnY);
  bindDual('inpIrradiance','numIrradiance','dispIrradiance',uIrr);
  bindDual('inpTilt','numTilt','dispTilt',function(v){return v.toFixed(2);});
  bindDual('inpSysEff','numSysEff','dispSysEff',function(v){return v.toFixed(1)+'%';});
  bindDual('inpDegradY1','numDegradY1','dispDegradY1',uPct1);
  bindDual('inpDegrad','numDegrad','dispDegrad',function(v){return v.toFixed(2)+'%';});
  bindDual('inpSelfUse','numSelfUse','dispSelfUse',uPct);
  bindDual('inpDayPrice','numDayPrice','dispDayPrice',uPrc);
  bindDual('inpGridPrice','numGridPrice','dispGridPrice',uPrc);
  bindDual('inpLoanRatio','numLoanRatio','dispLoanRatio',uPct);
  bindDual('inpLoanRate','numLoanRate','dispLoanRate',uPct1);
  bindDual('inpLoanYears','numLoanYears','dispLoanYears',uYr);
  bindDual('inpRunYears','numRunYears','dispRunYears',uYr);
  bindDual('inpDeprYears','numDeprYears','dispDeprYears',uYr);
  bindDual('inpDiscount','numDiscount','dispDiscount',uPct);
  bindDual('inpInvReplace','numInvReplace','dispInvReplace',uInv);
  bindDual('inpInvYear','numInvYear','dispInvYear',uInvYr);

  initBTT();
  update();

  window.addEventListener('resize',function(){if(R)drawChart(R.rows);});

  var saved='en';
  try{saved=localStorage.getItem('nrgopt-lang')||'en';}catch(e){}
  switchLang(saved);
}

// ── Start ──
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
