/* NrgOpt IRR Calculator v4 */
'use strict';

function npv(r,c){var t=0;for(var i=0;i<c.length;i++)t+=c[i]/Math.pow(1+r,i);return t;}
function irr(c,g){g=g||0.1;var r=g;for(var i=0;i<120;i++){var f=npv(r,c),d=(npv(r+1e-6,c)-f)/1e-6;if(Math.abs(d)<1e-14)break;var x=f/d;r-=x;if(Math.abs(x)<1e-8)return r;}return r;}
function payback(c){var s=0;for(var i=0;i<c.length;i++){s+=c[i];if(s>0){var p=s-c[i];return(i-1)+Math.abs(p)/(Math.abs(p)+Math.abs(c[i]));}}return null;}

function calc(p){
  var cap=p.capacity,uc=p.unitCost,lr=p.loanRatio,li=p.loanRate,ly=p.loanYears;
  var gkw=p.genPerW,ry=p.runYears,su=p.selfUse,dp=p.dayPrice,gp=p.gridPrice;
  var d1=p.degradY1||0.01,da=p.degrad||0.0055;
  var vr=p.vatRate,mgmt=p.mgmtFee,me=p.mgmtEscal,maint=p.maintFee,mte=p.maintEscal;
  var insR=p.insRate,res=p.residual;
  var dy=p.deprYears,irpw=p.invReplace,iry=p.invYear,disc=p.discount;
  var taxFree=p.taxFreeYr,taxHalf=p.taxHalfYr,taxRate=p.taxRate;
  var TI=cap*uc*100,loan=TI*lr;
  // Repayment method
  var repayMethod=p.repayMethod||'equal-principal';
  var installment=0;
  if(ly>0&&repayMethod==='equal-installment'){
    var mr=li/12,n=ly*12;
    if(mr>0){installment=loan*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1)*12;}
    else{installment=loan/ly;}
  }
  var vatDed=TI*vr/(1+vr),deprBase=TI-vatDed,deprA=deprBase*(1-res)/dy,invRep=cap*irpw*100;
  var idealGen=cap*gkw*100,genY1=idealGen*(1-d1);
  var cfsF=[-TI],cfsE=[-(TI-loan)],rows=[],cum=-TI;
  var vatCredit=vatDed,remLoan=loan;
  for(var y=1;y<=ry;y++){
    var gen=y===1?genY1:genY1*Math.pow(1-da,y-1);
    var rev=gen*su*dp/(1+vr)+gen*(1-su)*gp/(1+vr);
    var outputVat=rev*vr;
    var inputVat=0;
    if(vatCredit>0){inputVat=Math.min(vatCredit,outputVat);vatCredit-=inputVat;}
    var vat=Math.max(0,(outputVat-inputVat)*0.5),sur=vat*0.1;
    var opex=cap*mgmt*100*Math.pow(1+me,y-1)+cap*maint*100*Math.pow(1+mte,y-1);
    var ins=TI*insR/100*Math.pow(1.02,y-1);
    var interest=remLoan*li;
    var prPaid=0;
    if(y<=ly){
      if(repayMethod==='equal-principal'){prPaid=loan/ly;}
      else if(repayMethod==='equal-installment'){prPaid=installment-interest;}
      else if(repayMethod==='bullet'){prPaid=0;if(y===ly)prPaid=loan;}
    }
    remLoan=Math.max(0,remLoan-prPaid);
    var depr=y<=dy?deprA:0;
    var totCost=depr+interest+opex+ins;
    var pbt=rev-sur-totCost;
    var tax;
    if(y<=taxFree)tax=0;
    else if(y<=taxFree+taxHalf)tax=Math.max(0,pbt*taxRate*0.5);
    else tax=Math.max(0,pbt*taxRate);
    var pat=pbt-tax;
    var cf=pat+depr;if(y===iry)cf-=invRep;
    cfsF.push(cf);
    var ecf=pat+depr-prPaid;if(y===iry)ecf-=invRep;
    cfsE.push(ecf);
    cum+=cf;
    rows.push({yr:y,gen:gen,rev:rev,totCost:totCost,tax:tax,pat:pat,cf:cf,cumCash:cum,vat:vat,sur:sur});
  }
  cfsF[cfsF.length-1]+=deprBase*res;cfsE[cfsE.length-1]+=deprBase*res;
  var totalRev=0,totalCost=0,totalProfit=0,totalVat=0,totalGen=0;for(var i=0;i<rows.length;i++){totalRev+=rows[i].rev;totalCost+=rows[i].totCost;totalProfit+=rows[i].pat;totalVat+=rows[i].vat+rows[i].sur;totalGen+=rows[i].gen;}
  return {totalInv:TI,loan:loan,equity:TI-loan,genY1:genY1,totalGen:totalGen,totalRev:totalRev,totalCost:totalCost,totalProfit:totalProfit,totalVat:totalVat,irrFull:irr(cfsF),irrEq:irr(cfsE),npvFull:npv(disc,cfsF),payback:payback(cfsF),rows:rows};
}

function el(id){return document.getElementById(id);}
function val(id){var e=el(id);return e?parseFloat(e.value)||0:0;}
function ival(id){var e=el(id);return e?parseInt(e.value)||0:0;}
function setText(id,t){var e=el(id);if(e)e.textContent=t;}
function syncInfoCard(){
  var irr=el('dispIrradiance');if(irr&&irr.textContent)el('locIrr').textContent=irr.textContent;
  var tilt=val('inpTilt')||1.05;
  if(tilt<0.5)tilt=1.05;
  el('locAngle').textContent=Math.round((tilt-1)*300)+'°';
}

function getP(){
  return {
    capacity:val('inpCapacity')||1, unitCost:val('inpUnitCost')||3.7,
    loanRatio:(val('inpLoanRatio')||70)/100, loanRate:(val('inpLoanRate')||3.9)/100,
    loanYears:ival('inpLoanYears')||15, repayMethod:el('inpRepayMethod')?el('inpRepayMethod').value:'equal-principal', genPerW:computeGen(),
    runYears:ival('inpRunYears')||25,
    degradY1:(val('inpDegradY1')||1)/100, degrad:(val('inpDegrad')||0.55)/100,
    selfUse:(val('inpSelfUse')||90)/100, dayPrice:val('inpDayPrice')||0.664,
    gridPrice:val('inpGridPrice')||0.3, deprYears:ival('inpDeprYears')||10,
    residual:(val('inpResidual')||5)/100,
    mgmtFee:val('inpMgmtFee')||0.01, mgmtEscal:(val('inpMgmtEscal')||3)/100,
    maintFee:val('inpMaintFee')||0.04, maintEscal:(val('inpMaintEscal')||1)/100,
    insRate:val('inpInsRate')||0.1,
    vatRate:(ival('inpVatRate')||13)/100,
    taxFreeYr:ival('inpTaxFreeYr')||3, taxHalfYr:ival('inpTaxHalfYr')||3,
    taxRate:(val('inpTaxRate')||25)/100,
    invReplace:val('inpInvReplace')||0.2, invYear:ival('inpInvYear')||12,
    discount:(val('inpDiscount')||10)/100
  };
}

function computeGen(){
  return(val('inpIrradiance')||1350)*(val('inpTilt')||1.05)*(val('inpSysEff')||83.5)/100/1000;
}

var R=null;
function update(){
  refreshDisplays();
  syncInfoCard();
  var gw=computeGen(),l=document.documentElement.lang||'en';
  setText('dispGenPerW',gw.toFixed(3)+' kWh/W');
  var ir=val('inpIrradiance')||1350,ti=val('inpTilt')||1.05,ef=(val('inpSysEff')||83.5)/100;
  setText('dispSunHours',Math.round(ir*ti*ef));
  var omT=(val('inpMgmtFee')||0.01)+(val('inpMaintFee')||0.04);
  setText('dispOmTotal',omT.toFixed(3)+' 元/W');
  var tilt=val('inpTilt')||1.05;
  setText('dispBestAngle',Math.round((tilt-1)*300));

  R=calc(getP());
  var fm=function(v){return v<10?v.toFixed(2):v<100?v.toFixed(1):Math.round(v).toString();};
  setText('resIrrFull',(R.irrFull*100).toFixed(2)+'%');
  el('resIrrFull').style.color='#f59e0b';
  setText('resIrrEq',(R.irrEq*100).toFixed(2)+'%');
  el('resIrrEq').style.color='#38bdf8';
  var npvTxt=R.npvFull<10?R.npvFull.toFixed(1):Math.round(R.npvFull).toString();
  setText('resNpv',npvTxt);
  el('resNpv').style.color=R.npvFull>=0?'':'#f87171';
  setText('resPayback',R.payback?R.payback.toFixed(1):'—');
  setText('resTotalInv',fm(R.totalInv));
  setText('resLoan',fm(R.loan));
  setText('resTotalRev',fm(R.totalRev));
  setText('resTotalCost',fm(R.totalCost));
  setText('resTotalProfit',fm(R.totalProfit));
  setText('resTotalVat',fm(R.totalVat));
  setText('resGenY1',fm(R.genY1));
  setText('resGenTotal',fm(R.totalGen));
  setText('dispGenY1Total',fm(R.genY1)+' 万度电');

  var tb=el('cfTableBody');if(!tb)return;
  tb.innerHTML='';
  var tGen=0,tRev=0,tCost=0,tTax=0,tPat=0,tCf=0;
  for(var i=0;i<R.rows.length;i++){
    var r=R.rows[i];
    tGen+=r.gen;tRev+=r.rev;tCost+=r.totCost;tTax+=r.tax;tPat+=r.pat;tCf+=r.cf;
    tb.innerHTML+='<tr><td>'+r.yr+'</td><td>'+r.gen.toFixed(1)+'</td><td>'+r.rev.toFixed(1)+'</td><td>'+r.totCost.toFixed(1)+'</td><td>'+r.tax.toFixed(1)+'</td><td>'+r.pat.toFixed(1)+'</td><td>'+r.cf.toFixed(1)+'</td><td>'+r.cumCash.toFixed(1)+'</td></tr>';
  }
  tb.innerHTML+='<tr style="font-weight:700;border-top:2px solid var(--accent)"><td>合计</td><td>'+tGen.toFixed(1)+'</td><td>'+tRev.toFixed(1)+'</td><td>'+tCost.toFixed(1)+'</td><td>'+tTax.toFixed(1)+'</td><td>'+tPat.toFixed(1)+'</td><td>'+tCf.toFixed(1)+'</td><td></td></tr>';
  drawChart(R.rows);
}

var _bindings=[];
function bindDual(sliderId,numId,dispId,fmt){
  var s=el(sliderId),n=el(numId),d=el(dispId);
  if(!s||!n)return;
  _bindings.push({slider:s,disp:d,fmt:fmt});
  function sync(v){var vv=parseFloat(v);s.value=vv;n.value=vv;if(d)d.textContent=typeof fmt==='function'?fmt(vv):vv.toFixed(2);}
  s.addEventListener('input',function(){sync(s.value);update();});
  n.addEventListener('input',function(){var raw=n.value;if(raw===''||raw==='-')return;var vv=parseFloat(raw);if(!isNaN(vv)&&(String(vv)===raw||raw==='.'+vv)){sync(vv);update();}});
  n.addEventListener('change',function(){var raw=n.value,vv=parseFloat(raw);if(isNaN(vv))sync(parseFloat(s.value));else sync(vv);update();});
  sync(parseFloat(s.value));
}
function refreshDisplays(){
  for(var i=0;i<_bindings.length;i++){var b=_bindings[i],v=parseFloat(b.slider.value);if(b.disp)b.disp.textContent=typeof b.fmt==='function'?b.fmt(v):v.toFixed(2);}
}

function drawChart(rows){
  var c=el('cfChart');if(!c)return;
  var ctx=c.getContext('2d');
  var L=48,R=28,T=16,B=32;
  var pw=Math.min(c.parentElement.clientWidth-32,1100);
  var W=c.width=pw;c.style.width=pw+'px';
  var H=c.height=240;c.style.height=H+'px';
  ctx.clearRect(0,0,W,H);
  if(rows.length<2)return;
  var lo=Infinity,hi=-Infinity;
  for(var i=0;i<rows.length;i++){var v=rows[i].cf;if(v<lo)lo=v;if(v>hi)hi=v;}
  lo=Math.min(0,lo);hi=Math.max(1,hi);var range=hi-lo||1;
  var n=rows.length,w=W-L-R,h=H-T-B,zy=H-B-(0-lo)/range*h;
  // Grid
  ctx.strokeStyle='rgba(148,163,184,0.1)';ctx.lineWidth=0.5;
  var steps=5,step=range/steps;ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='right';
  for(var s=0;s<=steps;s++){var val=lo+step*s,gy=H-B-(val-lo)/range*h;ctx.beginPath();ctx.moveTo(L,gy);ctx.lineTo(W-R,gy);ctx.stroke();ctx.fillText(Math.round(val),L-4,gy+3);}
  ctx.strokeStyle='rgba(148,163,184,0.25)';ctx.beginPath();ctx.moveTo(L,zy);ctx.lineTo(W-R,zy);ctx.stroke();
  // Bars with gaps
  var barW=Math.max(3,w/n*0.55),gap=(w-n*barW)/(n+1);
  var bars=[];
  for(var i=0;i<n;i++){
    var cf=rows[i].cf,x=L+gap+i*(barW+gap),bh=Math.abs(cf)/range*h,y=cf>=0?zy-bh:zy;
    var grad=ctx.createLinearGradient(x,y,x,y+bh);
    if(cf>=0){grad.addColorStop(0,'#7dd3fc');grad.addColorStop(1,'#0369a1');}
    else{grad.addColorStop(0,'#fca5a5');grad.addColorStop(1,'#b91c1c');}
    ctx.fillStyle=grad;ctx.fillRect(x,y,barW,Math.max(1,bh));
    bars.push({x:x,w:barW,y:y,h:Math.max(1,bh),cf:cf,yr:rows[i].yr});
  }
  // X labels — aligned to bar centers
  ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='center';
  for(var i=0;i<n;i+=5){var bx=L+gap+i*(barW+gap)+barW/2;ctx.fillText(rows[i].yr,bx,H-B+14);}
  // Last year always labeled
  if((n-1)%5!==0){var lx=L+gap+(n-1)*(barW+gap)+barW/2;ctx.fillText(rows[n-1].yr,lx,H-B+14);}
  // Y title
  ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.save();ctx.translate(10,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('万元',0,0);ctx.restore();
  // Tooltip
  var tip=el('chartTooltip');
  c.onmousemove=function(e){var rect=c.getBoundingClientRect(),sx=c.width/rect.width,sy=c.height/rect.height,mx=(e.clientX-rect.left)*sx,my=(e.clientY-rect.top)*sy,found=null;for(var i=0;i<bars.length;i++){var b=bars[i];if(mx>=b.x&&mx<=b.x+b.w&&my>=b.y&&my<=b.y+b.h){found=b;break;}}if(found){tip.style.display='block';tip.style.left=rect.left+found.x/sx+found.w/sx/2+'px';tip.style.top=rect.top+found.y/sy-26+'px';tip.style.position='fixed';tip.style.transform='translate(-50%,0)';tip.textContent='第'+found.yr+'年: '+found.cf.toFixed(1)+' 万';}else{tip.style.display='none';}};
  c.onmouseleave=function(){tip.style.display='none';};
}

function initBTT(){
  var btn=document.createElement('button');btn.className='back-to-top';btn.setAttribute('aria-label','Back to top');btn.innerHTML='&#8593;';
  btn.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});document.body.appendChild(btn);
  window.addEventListener('scroll',function(){btn.classList.toggle('visible',window.scrollY>500);},{passive:true});
}

window.switchLang=function(lang){
  document.documentElement.lang=lang;
  var els=document.querySelectorAll('[data-en],[data-zh],[data-ja]');
  for(var i=0;i<els.length;i++){var e=els[i];if(lang==='en'&&e.hasAttribute('data-en'))e.textContent=e.getAttribute('data-en');else if(lang==='zh'&&e.hasAttribute('data-zh'))e.textContent=e.getAttribute('data-zh');else if(lang==='ja'&&e.hasAttribute('data-ja'))e.textContent=e.getAttribute('data-ja');}
  var h1=document.querySelector('.calc-hero h1');if(h1){var hl=h1.querySelector('.hl');if(hl){var t={en:['Distributed PV ','IRR Calculator'],zh:['分布式光伏 ','IRR 测算'],ja:['分散型太陽光 ','IRR試算']},tt=t[lang]||t.zh;h1.childNodes[0]&&(h1.childNodes[0].textContent=tt[0]);hl.textContent=tt[1];}}
  var sel=el('langSelect');if(sel)sel.value=lang;try{localStorage.setItem('nrgopt-lang',lang);}catch(e){}
  var ths=document.querySelectorAll('th[data-en]');for(var i=0;i<ths.length;i++){var th=ths[i],txt=lang==='en'?th.getAttribute('data-en'):(lang==='zh'?th.getAttribute('data-zh'):th.getAttribute('data-ja'));if(txt)th.textContent=txt;}
  refreshDisplays();update();
};

var regionMap={tibet:1900,nw:1600,nc:1400,ec:1350,sc:1100,sw:1000};
window.setRegionPreset=function(val){if(val==='custom')return;var irr=regionMap[val];if(!irr)return;var s=el('inpIrradiance'),n=el('numIrradiance');if(s)s.value=irr;if(n)n.value=irr;refreshDisplays();update();};

function init(){
  function L(){return document.documentElement.lang||'en';}
  function uYr(v){var l=L();return Math.round(v)+(l==='en'?' yr':(l==='ja'?' 年':' 年'));}
  function uPct(v){return Math.round(v)+'%';}function uPct1(v){return v.toFixed(1)+'%';}
  function uMW(v){var l=L();return(v<1?v.toFixed(3):v<10?v.toFixed(2):v.toFixed(1))+(l==='en'?' MW':(l==='ja'?' MW':' 兆瓦'));}
  function uPrc(v){var l=L();return(v<1?v.toFixed(3):v.toFixed(2))+(l==='en'?' ¢/kWh':(l==='ja'?' 元/kWh':' 元/千瓦时'));}

  bindDual('inpCapacity','numCapacity','dispCapacity',uMW);
  bindDual('inpUnitCost','numUnitCost','dispUnitCost',function(v){var l=L();return v.toFixed(2)+(l==='en'?' ¢/W':(l==='ja'?' 元/W':' 元/瓦'));});
  bindDual('inpRunYears','numRunYears','dispRunYears',uYr);
  bindDual('inpDeprYears','numDeprYears','dispDeprYears',uYr);
  bindDual('inpResidual','numResidual','dispResidual',function(v){return Math.round(v)+'%';});
  bindDual('inpIrradiance','numIrradiance','dispIrradiance',function(v){var l=L();return Math.round(v)+(l==='en'?' kWh/m²':(l==='ja'?' kWh/m²':' 千瓦时/平方米'));});
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
  bindDual('inpMgmtFee','numMgmtFee','dispMgmtFee',function(v){return v.toFixed(3)+' 元/W';});
  bindDual('inpMgmtEscal','numMgmtEscal','dispMgmtEscal',function(v){return v.toFixed(1)+'%';});
  bindDual('inpMaintFee','numMaintFee','dispMaintFee',function(v){return v.toFixed(3)+' 元/W';});
  bindDual('inpMaintEscal','numMaintEscal','dispMaintEscal',function(v){return v.toFixed(1)+'%';});
  bindDual('inpInsRate','numInsRate','dispInsRate',function(v){return v.toFixed(2)+'%';});
  bindDual('inpVatRate','numVatRate','dispVatRate',function(v){return Math.round(v)+'%';});
  bindDual('inpTaxFreeYr','numTaxFreeYr','dispTaxFreeYr',uYr);
  bindDual('inpTaxHalfYr','numTaxHalfYr','dispTaxHalfYr',uYr);
  bindDual('inpTaxRate','numTaxRate','dispTaxRate',function(v){return Math.round(v)+'%';});
  bindDual('inpInvReplace','numInvReplace','dispInvReplace',function(v){return v.toFixed(3)+' 元/W';});
  bindDual('inpInvYear','numInvYear','dispInvYear',function(v){var l=L();return(l==='en'?'Yr ':'第')+Math.round(v)+(l==='en'?'':(l==='ja'?'年':'年'));});
  bindDual('inpDiscount','numDiscount','dispDiscount',uPct);

  var rs=el('inpRepayMethod');if(rs){rs.addEventListener('change',update);setText('dispRepayMethod',rs.options[rs.selectedIndex].textContent);}

  initBTT();update();
  window.addEventListener('resize',function(){if(R)drawChart(R.rows);});
  var saved='en';try{saved=localStorage.getItem('nrgopt-lang')||'en';}catch(e){}
  switchLang(saved);
}

window.downloadPDF=function(){
  var name=el('locProjectName').value.trim();
  var titleEl=document.querySelector('.print-title');
  titleEl.innerHTML=(name?name+'<br>':'')+'NrgOpt 分布式光伏 IRR 测算报告';
  document.title=(name||'NrgOpt')+'-IRR测算';
  window.print();
};

// ── Auto-fill from address ──
window.autoFillFromAddress=function(){
  var addr=el('locAddress').value.trim(),st=el('locStatus');
  if(!addr){st.textContent='请先输入地址';return;}
  // Direct lat,lon input
  var m=addr.match(/(-?\d+\.?\d*)\s*[,，\s]\s*(-?\d+\.?\d*)/);
  if(m){
    var lat=parseFloat(m[1]),lon=parseFloat(m[2]);
    el('locCoord').textContent=fmtCoord(lat,lon);
  }
  var url=m?'/api/solar-data?lat='+parseFloat(m[1])+'&lon='+parseFloat(m[2]):'/api/solar-data?address='+encodeURIComponent(addr);
  st.textContent='查询中...';
  fetch(url).then(function(r){return r.json();}).then(function(d){
    if(!d.ok){st.textContent=d.error||'查询失败';if(m)solarFallback(parseFloat(m[1]),parseFloat(m[2]));return;}
    applySolarParams(d);
  }).catch(function(){
    if(m){solarFallback(parseFloat(m[1]),parseFloat(m[2]));}
    else{st.textContent='网络错误, 请重试';}
  });
};
window.autoFillFromGPS=function(){
  var st=el('locStatus');
  if(!navigator.geolocation){st.textContent='浏览器不支持定位';return;}
  st.textContent='定位中...';
  navigator.geolocation.getCurrentPosition(
    function(p){
      fillFromLatLon(p.coords.latitude,p.coords.longitude);
    },
    function(e){st.textContent='定位失败: 请手动输入经纬度 如 31.23, 121.47';},
    {enableHighAccuracy:false,timeout:10000}
  );
};
function fillFromLatLon(lat,lon){
  var st=el('locStatus');st.textContent='查询中... ('+lat.toFixed(2)+', '+lon.toFixed(2)+')';
  fetch('/api/solar-data?lat='+lat+'&lon='+lon)
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.ok){solarFallback(lat,lon);return;}
      applySolarParams(d);st.textContent='✓ 辐照='+d.irradiance+' 倾角='+d.tilt+' 效率='+d.efficiency+'%';
    })
    .catch(function(){solarFallback(lat,lon);});
}
function solarFallback(lat,lon){
  var al=Math.abs(lat),irr=al<22?1450:al<27?1350:al<32?1300:al<38?1450:al<44?1600:1800;
  var tilt=al<10?1.0:al>40?(1.1+Math.min(0.15,(al-40)/100)):1.05;
  var se=Math.round(100-14-(al>35?0:3)-(al<25?2:0));
  if(lon>115)irr-=50;else if(lon<100)irr+=100;
  if(lat<30&&lon>110)irr-=50;if(lat>40&&lon<90)irr+=100;
  el('inpIrradiance').value=irr;el('numIrradiance').value=irr;
  el('inpTilt').value=tilt;el('numTilt').value=tilt;
  el('inpSysEff').value=se;el('numSysEff').value=se;
  el('locCoord').textContent=fmtCoord(lat,lon);
  el('locIrr').textContent=irr+' kWh/m²';
  el('locAngle').textContent=Math.round((tilt-1)*300)+'°';
  el('locStatus').textContent='(离线估算)';
  refreshDisplays();
  update();
}
function fmtCoord(lat,lon){
  return (lat>=0?lat.toFixed(4)+'°N':(-lat).toFixed(4)+'°S')+', '+(lon>=0?lon.toFixed(4)+'°E':(-lon).toFixed(4)+'°W');
}
function applySolarParams(d){
  el('inpIrradiance').value=d.irradiance;el('numIrradiance').value=d.irradiance;
  el('inpTilt').value=d.tilt;el('numTilt').value=d.tilt;
  el('inpSysEff').value=d.efficiency;el('numSysEff').value=d.efficiency;
  if(d.lat!=null)el('locCoord').textContent=fmtCoord(d.lat,d.lon);
  // locIrr and locAngle will be set by syncInfoCard() called from update()
  refreshDisplays();
  update();
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
