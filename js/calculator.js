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
  var vr=params.vatRate||0.13, omCost=params.omCost||0.05, omEscal=params.omEscal||0.02;
  var taxModel=params.taxModel||'holiday', taxFlat=params.taxFlat||0.25;
  var dy=params.deprYears, res=0.05, irpw=params.invReplace, iry=params.invYear, disc=params.discount;
  var TI=cap*uc*100, loan=TI*lr, prin=ly>0?loan/ly:0;
  var vatDed=TI*vr/(1+vr), deprBase=TI-vatDed, deprA=deprBase*(1-res)/dy, invRep=cap*irpw*100;
  var idealGen=cap*gkw*100, genY1=idealGen*(1-degradY1);
  var cfsF=[-TI], cfsE=[-(TI-loan)], rows=[], cum=-TI;
  for(var y=1;y<=ry;y++){
    var gen=y===1?genY1:genY1*Math.pow(1-degradA,y-1);
    var rev=gen*su*dp/(1+vr)+gen*(1-su)*gp/(1+vr);
    var vat=Math.max(0,rev*vr*0.5), sur=vat*0.1;
    var opex=cap*omCost*100*Math.pow(1+omEscal,y-1);
    var ins=TI*0.001*Math.pow(1.03,y-1);
    var remLoan=Math.max(0,loan-prin*Math.min(y,ly));
    var interest=remLoan*li;
    var depr=y<=dy?deprA:0;
    var totCost=depr+interest+opex+ins;
    var pbt=rev-sur-totCost;
    var tax;
    if(taxModel==='flat'){tax=Math.max(0,pbt*taxFlat);}
    else{if(y<=3)tax=0;else if(y<=6)tax=Math.max(0,pbt*0.125);else tax=Math.max(0,pbt*0.25);}
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
    discount:(val('inpDiscount')||10)/100,
    omCost:val('inpOmCost')||0.05, omEscal:(val('inpOmEscal')||2)/100,
    vatRate:(ival('inpVatRate')||13)/100,
    taxModel:el('inpTaxModel')?el('inpTaxModel').value:'holiday',
    taxFlat:(val('inpTaxFlat')||25)/100
  };
}

function computeGen(){
  var irr=val('inpIrradiance')||1350, tilt=val('inpTilt')||1.05, eff=(val('inpSysEff')||83.5)/100;
  return irr*tilt*eff/1000;
}

// ── UI ──
var R=null;

function update(){
  refreshDisplays();
  var gw=computeGen();
  var l=document.documentElement.lang||'en';
  var e=el('dispGenPerW'); if(e)e.textContent=gw.toFixed(3)+(l==='en'?' kWh/W':(l==='ja'?' kWh/W':' 千瓦时/瓦'));
  var irrad=val('inpIrradiance')||1350, tilt=val('inpTilt')||1.05, eff=(val('inpSysEff')||83.5)/100;
  e=el('dispSunHours'); if(e)e.textContent=Math.round(irrad*tilt*eff);

  R=calc(getP());
  var fm=function(v){return v<10?v.toFixed(2):v<100?v.toFixed(1):Math.round(v).toString();};
  var fullIrr=(R.irrFull*100).toFixed(2);
  setText('resIrrFull',fullIrr+'%');
  el('resIrrFull').style.color=R.irrFull>=0.1?'#34d399':R.irrFull>=0.06?'#f59e0b':'#f87171';
  setText('resIrrEq',(R.irrEq*100).toFixed(2)+'%');
  setText('resNpv',R.npvFull<10?R.npvFull.toFixed(1):Math.round(R.npvFull).toString());
  setText('resPayback',R.payback?R.payback.toFixed(1):'—');
  setText('resTotalInv',fm(R.totalInv));
  setText('resLoan',fm(R.loan));
  var genUnit=l==='en'?' 10k kWh':(l==='ja'?' 万kWh':' 万度电');
  setText('resGenY1',fm(R.genY1));
  setText('dispGenY1Total',fm(R.genY1)+genUnit);

  var tbody=el('cfTableBody'); if(!tbody)return;
  tbody.innerHTML='';
  for(var i=0;i<R.rows.length;i++){
    var r=R.rows[i];
    tbody.innerHTML+='<tr><td>'+r.yr+'</td><td>'+r.gen+'</td><td>'+r.rev+'</td><td>'+r.totCost+'</td><td>'+r.tax+'</td><td>'+r.pat+'</td><td>'+r.cf+'</td><td>'+r.cumCash+'</td></tr>';
  }
  drawChart(R.rows);
}

function setText(id,txt){var e=el(id);if(e)e.textContent=txt;}

function drawChart(rows){
  var c=el('cfChart'); if(!c)return;
  var ctx=c.getContext('2d');
  var L=48,R=20,T=16,B=26;
  var W=c.width=c.parentElement.clientWidth-32;
  var H=c.height=240;
  c.width=W;c.height=H;
  ctx.clearRect(0,0,W,H);
  if(rows.length<2)return;
  var lo=Infinity,hi=-Infinity;
  for(var i=0;i<rows.length;i++){var v=parseFloat(rows[i].cf);if(v<lo)lo=v;if(v>hi)hi=v;}
  lo=Math.min(0,lo);hi=Math.max(1,hi);var range=hi-lo||1;
  var w=W-L-R,h=H-T-B,zy=H-B-(0-lo)/range*h;
  // Grid lines
  ctx.strokeStyle='rgba(148,163,184,0.12)';ctx.lineWidth=0.5;
  var steps=5,step=range/steps;
  ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='right';
  for(var s=0;s<=steps;s++){
    var val=lo+step*s;
    var gy=H-B-(val-lo)/range*h;
    ctx.beginPath();ctx.moveTo(L,gy);ctx.lineTo(W-R,gy);ctx.stroke();
    ctx.fillText(Math.round(val),L-4,gy+3);
  }
  // Zero line
  ctx.strokeStyle='rgba(148,163,184,0.3)';ctx.beginPath();ctx.moveTo(L,zy);ctx.lineTo(W-R,zy);ctx.stroke();
  // Bars — thin with gaps
  var n=rows.length, barW=Math.max(4,w/n*0.58), gap=w/n*0.42;
  var bars=[];
  for(var i=0;i<n;i++){
    var cf=parseFloat(rows[i].cf),x=L+i/n*w+gap/2,bh=Math.abs(cf)/range*h,y=cf>=0?zy-bh:zy;
    var grad=ctx.createLinearGradient(x,y,x,y+bh);
    if(cf>=0){grad.addColorStop(0,'rgba(52,211,153,0.9)');grad.addColorStop(1,'rgba(16,185,129,0.6)');}
    else{grad.addColorStop(0,'rgba(248,113,113,0.6)');grad.addColorStop(1,'rgba(239,68,68,0.9)');}
    ctx.fillStyle=grad;ctx.fillRect(x,y,barW,Math.max(1,bh));
    bars.push({x:x,y:y,w:barW,h:Math.max(1,bh),cf:cf,yr:rows[i].yr});
  }
  // X labels
  ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='center';
  for(var y=0;y<rows.length;y+=5)ctx.fillText((y+1),L+y/rows.length*w,H-B+13);
  // Y title
  ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='center';
  ctx.save();ctx.translate(10,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('万',0,0);ctx.restore();
  // Tooltip handler
  var tip=el('chartTooltip');
  c.onmousemove=function(e){
    var rect=c.getBoundingClientRect();
    var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var found=null;
    for(var i=0;i<bars.length;i++){
      var b=bars[i];
      if(mx>=b.x&&mx<=b.x+b.w&&my>=b.y&&my<=b.y+b.h){found=b;break;}
    }
    if(found){
      tip.style.display='block';
      tip.style.left=(found.x+found.w/2)+'px';
      tip.style.top=(found.y-28)+'px';
      tip.style.transform='translate(-50%,0)';
      tip.textContent='第'+found.yr+'年: '+found.cf.toFixed(1)+' 万';
    }else{tip.style.display='none';}
  };
  c.onmouseleave=function(){tip.style.display='none';};
}

// ── Slider + Number sync ──
var _bindings=[];
function bindDual(sliderId,numId,dispId,fmt){
  var slider=el(sliderId), num=el(numId), disp=el(dispId);
  if(!slider||!num)return;

  _bindings.push({slider:slider,disp:disp,fmt:fmt});

  function sync(v){var vv=parseFloat(v);slider.value=vv;num.value=vv;if(disp)disp.textContent=typeof fmt==='function'?fmt(vv):vv.toFixed(2);}

  slider.addEventListener('input',function(){sync(slider.value);update();});
  num.addEventListener('input',function(){var raw=num.value;if(raw.endsWith('.')||raw===''||raw==='-')return;var vv=parseFloat(raw);if(!isNaN(vv)){sync(vv);update();}});
  num.addEventListener('change',function(){var raw=num.value,vv=parseFloat(raw);if(isNaN(vv))sync(parseFloat(slider.value));else sync(vv);update();});

  sync(parseFloat(slider.value));
}

function refreshDisplays(){
  for(var i=0;i<_bindings.length;i++){
    var b=_bindings[i],v=parseFloat(b.slider.value);
    if(b.disp)b.disp.textContent=typeof b.fmt==='function'?b.fmt(v):v.toFixed(2);
  }
}

// ── Language ──
window.switchLang=function(lang){
  document.documentElement.lang=lang;
  var els=document.querySelectorAll('[data-en],[data-zh],[data-ja]');
  for(var i=0;i<els.length;i++){
    var elem=els[i];
    if(lang==='en'&&elem.hasAttribute('data-en'))elem.textContent=elem.getAttribute('data-en');
    else if(lang==='zh'&&elem.hasAttribute('data-zh'))elem.textContent=elem.getAttribute('data-zh');
    else if(lang==='ja'&&elem.hasAttribute('data-ja'))elem.textContent=elem.getAttribute('data-ja');
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
  refreshDisplays();
  update();
};

// ── Region preset ──
var regionMap={tibet:1900,nw:1600,nc:1400,ec:1350,sc:1100,sw:1000};
window.setRegionPreset=function(val){
  if(val==='custom')return;
  var irr=regionMap[val];if(!irr)return;
  var s=el('inpIrradiance'),n=el('numIrradiance'),d=el('dispIrradiance');
  if(s)s.value=irr;if(n)n.value=irr;
  refreshDisplays();
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
  bindDual('inpInvReplace','numInvReplace','dispInvReplace',function(v){return v.toFixed(3)+' 元/W';});
  bindDual('inpInvYear','numInvYear','dispInvYear',uInvYr);
  bindDual('inpOmCost','numOmCost','dispOmCost',function(v){return v.toFixed(3)+' 元/W';});
  bindDual('inpOmEscal','numOmEscal','dispOmEscal',function(v){return v.toFixed(1)+'%';});
  bindDual('inpVatRate','numVatRate','dispVatRate',function(v){return Math.round(v)+'%';});
  bindDual('inpTaxFlat','numTaxFlat','dispTaxFlat',function(v){return Math.round(v)+'%';});

  var ts=el('inpTaxModel'); if(ts){ts.addEventListener('change',function(){el('rowTaxFlat').style.display=ts.value==='holiday'?'none':'block';setText('dispTaxModel',ts.value==='holiday'?'三免三减半':'固定税率');update();});el('rowTaxFlat').style.display=ts.value==='holiday'?'none':'block';setText('dispTaxModel','三免三减半');}

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
