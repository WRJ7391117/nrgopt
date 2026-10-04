(function () {
  'use strict';
  var $ = function(id){return document.getElementById(id);}, data, editing=null, busy=false, dirty=false, page=0, feedback={};
  var states={candidate:'待处理',active:'已启用',paused:'已暂停',removed:'已移除'};
  var accessErrors={source_access_denied:'网站拒绝访问',source_tls_error:'网站证书校验失败',source_dns_error:'域名解析失败',source_timeout:'网站响应超时',source_connection_timeout:'连接超时',source_connection_reset:'连接被中断',source_empty_document:'页面没有可读取的正文',source_unsupported_encoding:'页面不是可验证的 UTF-8 编码',source_unsupported_type:'页面格式暂不支持',source_unsafe_address:'入口地址不安全',registry_redirect_host:'入口跳转到了其他网站'};
  function accessReason(code){return accessErrors[code]||'入口暂时无法读取'+(code?'（'+code+'）':'');}
  var regions=JSON.parse($('intelligence-regions').textContent), names=Object.fromEntries(regions.countries.map(function(c){return[c.code,c.name];}));
  var form=$('library-form');
  function node(tag,text,cls){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  function message(id,text,error){$(id).textContent=text;$(id).dataset.tone=error?'error':'';}
  async function api(action,body,id){var r=await fetch('/api/intelligence?action='+action+(id?'&id='+encodeURIComponent(id):''),{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});var d=await r.json();if(!r.ok)throw Error(d.message||'操作未完成');return d;}
  function link(url,text){var e=node('a',text);e.href=url;e.target='_blank';e.rel='noopener noreferrer';return e;}
  function selected(name){return Array.from(form.querySelectorAll('[name="'+name+'"]:checked')).map(function(e){return e.value;});}
  function filtered(e){var view=$('library-view').value,query=$('library-search').value.trim().toLowerCase();return (view==='current'?e.status!=='removed':view==='readable'?e.status==='candidate'&&e.access.status==='readable':view==='failed'?e.status==='candidate'&&e.access.status==='failed':e.status===view)&&(!$('library-country').value||e.config.countries.includes($('library-country').value))&&(!$('library-type').value||e.config.type===$('library-type').value)&&directionMatch(e)&&(!query||(e.config.name+' '+e.config.url).toLowerCase().includes(query));}
  function directionMatch(e){return !$('library-direction').value||!e.config.direction_ids.length||e.config.direction_ids.includes($('library-direction').value);}
  function update(entry){var at=data.entries.findIndex(function(e){return e.id===entry.id;});if(at<0)data.entries.push(entry);else data.entries[at]=Object.assign({},data.entries[at],entry);render();}
  function button(text,fn){var b=node('button',text,'intel-button intel-button-quiet');b.type='button';b.disabled=!data.writable||busy;b.addEventListener('click',fn);return b;}
  function payload(e,state){return{id:e.id,revision:e.revision,config:e.config,status:state||e.status};}
  async function action(e,kind,target){
    if(busy)return;busy=true;feedback[e.id]={text:kind==='check'?'正在验证入口…':'正在保存…',error:false};render();message('library-status',kind==='check'?'正在验证入口，不调用模型…':'正在保存渠道状态…');
    try {var result=await api(kind==='check'?'check-library-entry':'save-library-entry',kind==='check'?{id:e.id,revision:e.revision}:payload(e,target));update(result.entry);
      if(kind!=='check'&&target==='active'&&e.config.scope==='site')data.entries.forEach(function(row){if(new URL(row.config.url).hostname.replace(/^www\./,'')===new URL(e.config.url).hostname.replace(/^www\./,''))row.host_paused=false;});
      message('library-status',kind==='check'?(result.entry.access.status==='readable'?'入口本次可读取。尚不代表身份、文章或情报已核实。':'入口读取失败：'+accessReason(result.entry.access.error_code)+'。已记录，不会自动启用。'):'已保存「'+e.config.name+'」：'+states[result.entry.status]+'。已保存原文与情报保留；恢复不补跑历史任务。');
    feedback[e.id]={text:$('library-status').textContent,error:false};
    }catch(err){feedback[e.id]={text:err.message,error:true};message('library-status',err.message,true);}finally{busy=false;render();}
  }
  function nextStep(e){
    if(e.status==='removed')return '已移除；历史原文和情报仍保留。';
    if(e.host_paused)return e.config.scope==='site'?'该网站已暂停自动抓取；先恢复网站抓取。':'该网站已暂停自动抓取；请从同站固定渠道恢复网站抓取。';
    if(e.status==='candidate')return e.access.status==='failed'?'入口读取失败：'+accessReason(e.access.error_code)+'。请核对网址后重新验证。':e.access.status==='readable'?(e.id.startsWith('reference:')&&e.access.review==='recent_source_missing'?'入口可读，但还没有近30天通过分析的原文；系统会复查，你也可决定启用轮转。':'入口可读；尚未证明近期产出，你可决定是否启用轮转。'):'尚未检查入口；请先验证。';
    if(e.status==='paused')return '已暂停；恢复后只参与后续搜集。';
    if(e.execution)return data.day+' 入口任务'+({queued:'排队中',running:'运行中',succeeded:'已完成',failed:'失败',retry:'等待重试',manual_paused:'已暂停',budget_paused:'预算暂停'}[e.execution.status]||e.execution.status)+' · 返回链接 '+(e.execution.result_urls||[]).length+' 条';
    return e.config.mode==='fixed'?'固定监测中；今天暂无入口任务记录。':'已启用轮转；今天尚未轮到。';
  }
  function render(){
    $('library-add').disabled=!data.writable||busy;
    var live=data.entries.filter(function(e){return e.status!=='removed';});
    $('library-overview').replaceChildren();
    [['待处理',live.filter(function(e){return e.status==='candidate';}).length,'candidate'],['其中入口可读',live.filter(function(e){return e.status==='candidate'&&e.access.status==='readable';}).length,'readable'],['其中入口异常',live.filter(function(e){return e.status==='candidate'&&e.access.status==='failed';}).length,'failed'],['已启用配置',live.filter(function(e){return e.status==='active';}).length,'active']].forEach(function(x){var p=node('button');p.type='button';p.className='intel-library-metric';p.setAttribute('aria-pressed',String($('library-view').value===x[2]));p.append(node('strong',String(x[1])),node('span',x[0]));p.addEventListener('click',function(){$('library-view').value=x[2];page=0;render();});$('library-overview').append(p);});
    $('library-list').replaceChildren();var entries=data.entries.filter(filtered).sort(function(a,b){var rank=function(e){return e.status==='candidate'?(e.access.status==='readable'?0:e.access.status==='failed'?1:2):3;};return rank(a)-rank(b)||(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0);});
    if(!entries.length)$('library-list').append(node('p','当前筛选下没有渠道。','intel-muted'));
    var pages=Math.max(1,Math.ceil(entries.length/8));page=Math.min(page,pages-1);
    entries.slice(page*8,page*8+8).forEach(function(e){var c=e.config,card=node('article',undefined,'intel-panel intel-library-card'),heading=node('div',undefined,'intel-section-heading'),more=node('details');heading.append(node('h3',c.name),node('span',states[e.status],'intel-badge'));card.append(heading,node('p',(data.types[c.type]||'待分类')+' · '+c.countries.map(function(v){return names[v]||v;}).join('、')+' · '+(c.mode==='fixed'?'固定监测':'轮转搜集'),'intel-muted'),node('p',nextStep(e),'intel-library-next'));
      var primary=node('div',undefined,'intel-direction-buttons');
      if(e.status!=='removed'&&e.host_paused&&c.scope==='site'&&(c.mode==='fixed'||e.access.status==='readable'))primary.append(button('恢复网站抓取',function(){action(e,'state','active');}));
      else if(e.status==='candidate'&&!e.host_paused){
        if(e.access.status==='failed')primary.append(button('编辑入口',function(){open(e);}),button('重新验证',function(){action(e,'check');}));
        else if(e.access.status==='readable')primary.append(button('启用轮转',function(){action(e,'state','active');}));
        else primary.append(button('验证入口',function(){action(e,'check');}));
      }else if(e.status==='paused'&&(c.mode==='fixed'||e.access.status==='readable'))primary.append(button('恢复启用',function(){action(e,'state','active');}));
      else if(e.status==='removed')primary.append(button('恢复到待处理',function(){action(e,'state','candidate');}));
      if(primary.childElementCount)card.append(primary);
      more.append(node('summary','查看入口、原文与管理操作'),link(c.url,c.url),node('p','监测范围：'+(c.scope==='site'?'整个网站':'此栏目路径')+'；覆盖：'+c.countries.map(function(v){return names[v]||v;}).join('、'),'intel-muted'));
      if(e.access.status==='readable'||e.access.status==='failed')more.append(node('p',(e.access.status==='readable'?'入口读取成功':'入口读取失败：'+accessReason(e.access.error_code))+' · '+new Date(e.access.checked_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' 北京时间','intel-library-access'));
      if(e.execution)more.append(node('p',data.day+' 自然入口任务：'+({queued:'排队中',running:'运行中',succeeded:'入口任务已完成',failed:'失败',retry:'等待重试',manual_paused:'已暂停',budget_paused:'预算暂停'}[e.execution.status]||e.execution.status)+' · 返回链接 '+(e.execution.result_urls||[]).length+' 条'+(e.execution.error_code?' · '+e.execution.error_code:''),'intel-muted'));
      var seen=new Set(),rows=(e.recent_sources||[]).filter(function(s){var key=s.final_url||s.requested_url||s.id;if(seen.has(key))return false;seen.add(key);return true;}),details=node('details'),summary=node('summary','原文样本（'+rows.length+'）');details.append(summary,node('p','最近500条已保存记录中的同站样本；不等于本渠道自然执行成果。','intel-muted'));
      if(c.notes)details.append(node('p',c.notes));
      details.append(node('p','语言：'+(c.languages.join('、')||'待补充')+'；关联方向：'+(c.direction_ids.length?data.directions.filter(function(d){return c.direction_ids.includes(d.id);}).map(function(d){return d.config.name;}).join('、'):'全部方向')));
      rows.forEach(function(s){var p=node('p');p.append(link('/intelligence/sources/'+s.id,s.title||'查看原文'),node('span',' · '+(s.publication_date||'发布日期未知')+' · '+(s.extraction_status==='extracted'&&s.extraction_source_sha256===s.content_sha256?'已有分析':s.extraction_error_code?'分析未通过':'未完成分析')));details.append(p);});
      var history=button('查看最近修改记录',async function(){history.disabled=true;try{var r=await api('library-history',null,e.id);hist.replaceChildren();r.history.forEach(function(h){hist.append(node('p','版本'+h.revision+' · '+states[h.status]+' · '+new Date(h.recorded_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' 北京时间'));});if(!r.history.length)hist.append(node('p','内置入口尚无手动修改记录。'));}catch(err){hist.textContent=err.message;}finally{history.disabled=false;}}),hist=node('div');history.disabled=false;details.append(history,hist);more.append(details);
      var actions=node('div',undefined,'intel-direction-buttons');if(e.status!=='removed')actions.append(button('编辑',function(){open(e);}));
      if(e.status==='active'||e.status==='paused')actions.append(button('验证入口',function(){action(e,'check');}));
      if(e.status==='active')actions.append(button('暂停',function(){action(e,'state','paused');}));
      if(e.status!=='removed')actions.append(button('移除',function(){confirmBox.hidden=false;}));
      var confirmBox=node('div',undefined,'intel-watch-confirm');confirmBox.hidden=true;confirmBox.append(node('p','移除「'+c.name+'」后，将停止此'+(c.scope==='site'?'网站':'栏目路径')+'后续自动抓取；原文、情报和历史保留。'),button('确认移除',function(){action(e,'state','removed');}),button('取消',function(){confirmBox.hidden=true;}));more.append(actions,confirmBox);card.append(more);if(feedback[e.id]){var result=node('p',feedback[e.id].text,'intel-status');result.setAttribute('role','status');result.dataset.tone=feedback[e.id].error?'error':'success';card.append(result);}$('library-list').append(card);
    });
    var previous=button('上一页',function(){page--;render();}),next=button('下一页',function(){page++;render();});previous.disabled=page===0;next.disabled=page>=pages-1;$('library-pagination').replaceChildren(previous,node('span','共 '+entries.length+' 个渠道 · '+(page+1)+' / '+pages),next);
    var table=node('table'),head=node('tr');head.append(node('th','地区'));var types=Object.keys(data.types).filter(function(t){return t!=='unknown';});types.forEach(function(t){head.append(node('th',data.types[t]));});table.append(head);
    regions.countries.forEach(function(c){var row=node('tr');row.append(node('th',c.name));types.forEach(function(t){var n=data.entries.filter(function(e){return e.status==='active'&&!e.host_paused&&e.config.countries.includes(c.code)&&e.config.type===t&&directionMatch(e);}).length;row.append(node('td',n?String(n):'缺口',n?'':'intel-muted'));});table.append(row);});$('library-coverage').replaceChildren(table);
    $('library-suggestions').replaceChildren();data.suggestions.forEach(function(s){var p=node('p');p.append(link(s.sample_url,s.name+' · 查看样文'),button('登记此渠道',function(){open(null,s.url);}));$('library-suggestions').append(p);});
  }
  function open(entry,url){if(busy||dirty&&!confirm('放弃尚未保存的编辑？'))return;editing=entry;form.reset();var c=entry?entry.config:{name:'',url:url||'',scope:'path',type:'unknown',priority:'normal',notes:'',countries:[],languages:[],direction_ids:[]};['name','url','scope','type','priority','notes'].forEach(function(k){form.elements[k].value=c[k];});['countries','languages','direction_ids'].forEach(function(k){form.querySelectorAll('[name="'+k+'"]').forEach(function(n){n.checked=c[k].includes(n.value);});});form.querySelector('.intel-library-optional').open=!!entry&&(c.priority!=='normal'||!!c.notes||!!c.languages.length||!!c.direction_ids.length);form.elements.url.disabled=entry?.config.mode==='fixed';form.elements.scope.disabled=entry?.config.mode==='fixed';$('library-editor').hidden=false;$('library-editor-title').textContent=entry?'编辑渠道':'添加渠道';message('library-save-status','');dirty=false;form.elements.name.focus();}
  form.addEventListener('input',function(){dirty=true;});form.addEventListener('change',function(){dirty=true;});
  $('library-add').addEventListener('click',function(){open(null);});$('library-cancel').addEventListener('click',function(){if(busy||dirty&&!confirm('放弃尚未保存的编辑？'))return;$('library-editor').hidden=true;dirty=false;});
  window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
  form.addEventListener('submit',async function(event){event.preventDefault();if(busy)return;var config={};['name','url','scope','type','priority','notes'].forEach(function(k){config[k]=form.elements[k].value;});['countries','languages','direction_ids'].forEach(function(k){config[k]=selected(k);});if(!config.countries.length){message('library-save-status','请至少选择一个覆盖地区。',true);return;}var status=editing?editing.status:'candidate';if(editing&&(config.url!==editing.config.url||config.scope!==editing.config.scope))status='candidate';busy=true;Array.from(form.elements).forEach(function(e){e.disabled=true;});message('library-save-status','正在保存…');
    try {var result=await api('save-library-entry',{id:editing?.id||null,revision:editing?.revision||0,config:config,status:status});editing=result.entry;dirty=false;page=0;$('library-view').value=result.entry.status;['library-country','library-type','library-direction'].forEach(function(id){$(id).value='';});$('library-search').value=config.name;update(result.entry);message('library-save-status','已保存渠道。'+(result.entry.status==='candidate'?'请在列表验证入口后启用。':'状态：'+states[result.entry.status]));message('library-status','已保存「'+config.name+'」，列表已更新。');$('library-editor').hidden=true;}
    catch(err){message('library-save-status',err.message+' 输入已保留。',true);}finally{busy=false;Array.from(form.elements).forEach(function(e){e.disabled=false;});form.elements.url.disabled=editing?.config.mode==='fixed';form.elements.scope.disabled=editing?.config.mode==='fixed';render();}
  });
  ['library-view','library-country','library-type','library-direction','library-search'].forEach(function(id){$(id).addEventListener('input',function(){page=0;if(data)render();});});
  document.querySelectorAll('.intel-library-shortcuts a').forEach(function(a){a.addEventListener('click',function(){document.querySelector(a.hash).open=true;});});
  (async function(){try{data=await api('source-library');data.directions.forEach(function(d){var label=node('label'),input=node('input');input.type='checkbox';input.name='direction_ids';input.value=d.id;label.append(input,node('span',d.config.name));$('library-directions').append(label);var opt=node('option',d.config.name);opt.value=d.id;$('library-direction').append(opt);});render();message('library-status',data.writable?'':'当前为只读模式。');var channel=new URL(location.href).searchParams.get('channel');if(channel&&data.writable){try{var u=new URL(channel);if(u.protocol==='https:')open(null,u.href);}catch{}}}catch(err){message('library-status',err.message,true);}})();
})();
