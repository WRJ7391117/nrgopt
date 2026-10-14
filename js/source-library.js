(function () {
  'use strict';
  var $ = function(id){return document.getElementById(id);}, data, editing=null, busy=false, dirty=false, view='current', page=0, archivePage=0, selectedCell=null, selectedButton=null, feedback={};
  var states={candidate:'待处理',active:'已启用',paused:'已暂停',removed:'已移除'};
  var taskStates={queued:'排队中',running:'运行中',succeeded:'已完成',failed:'失败',retry:'等待重试',manual_paused:'人工暂停',budget_paused:'预算暂停'};
  var accessErrors={source_access_denied:'网站拒绝访问',source_tls_error:'网站证书校验失败',source_dns_error:'域名解析失败',source_timeout:'网站响应超时',source_connection_timeout:'连接超时',source_connection_reset:'连接被中断',source_empty_document:'页面没有可读取的正文',source_unsupported_encoding:'页面不是可验证的 UTF-8 编码',source_unsupported_type:'页面格式暂不支持',source_unsafe_address:'入口地址不安全',registry_redirect_host:'入口跳转到了其他网站'};
  var regions=JSON.parse($('intelligence-regions').textContent), names=Object.fromEntries(regions.countries.map(function(c){return[c.code,c.name];})), form=$('library-form');
  function node(tag,text,cls){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  function message(id,text,error){$(id).textContent=text;$(id).dataset.tone=error?'error':'';}
  function accessReason(code){return accessErrors[code]||'入口暂时无法读取'+(code?'（'+code+'）':'');}
  function time(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'暂无记录';}
  async function api(action,body,id){var r=await fetch('/api/intelligence?action='+action+(id?'&id='+encodeURIComponent(id):''),{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});var d=await r.json();if(!r.ok)throw Error(d.message||'操作未完成');return d;}
  function link(url,text){var e=node('a',text);e.href=url;e.target='_blank';e.rel='noopener noreferrer';return e;}
  function button(text,fn,write){var b=node('button',text,'intel-button intel-button-quiet');b.type='button';b.disabled=!!write&&(!data.writable||busy);b.addEventListener('click',fn);return b;}
  function selected(name){return Array.from(form.querySelectorAll('[name="'+name+'"]:checked')).map(function(e){return e.value;});}
  function directionNames(ids){return data.directions.filter(function(d){return ids.includes(d.id);}).map(function(d){return d.config.name;}).join('、');}
  function latest(e){return e.performance?.latest_task||e.execution;}
  function systemManaged(e){return e.access.managed_by==='automatic'||e.id.startsWith('reference:')&&e.access.managed_by!=='user';}
  function exception(e){return e.host_paused||e.access.status==='failed'||latest(e)?.status==='failed'||['outside_scope','scope_paused'].includes(e.usage?.reason);}
  function growthGroup(e){if(e.integration&&!exception(e))return 'history';if(exception(e))return 'exception';return systemManaged(e)?'system':'decision';}
  function needsAttention(e){return e.status==='active'&&(exception(e)||e.config.type==='unknown'||e.config.mode!=='fixed'&&e.access.status!=='readable'||['scope_unverified','scope_confirmation_needed'].includes(e.usage?.reason));}
  function directionMatch(e,id){return !id||!e.config.direction_ids.length||e.config.direction_ids.includes(id);}
  function matchesFilters(e){var query=$('library-search').value.trim().toLowerCase();return (!$('library-country').value||e.config.countries.includes($('library-country').value))&&(!$('library-type').value||e.config.type===$('library-type').value)&&directionMatch(e,$('library-direction').value)&&(!query||(e.config.name+' '+e.config.url).toLowerCase().includes(query));}
  function filtered(e){
    if(!(view==='current'?e.status==='active':(e.status==='candidate'||needsAttention(e))&&growthGroup(e)!=='history')||!matchesFilters(e))return false;
    var state=$('library-view').value;
    return state==='all'||['system','decision','exception'].includes(state)&&growthGroup(e)===state||state==='normal'&&e.usage?.eligible&&!needsAttention(e)||(state==='needs_attention'&&needsAttention(e))||(state==='unchecked'&&e.access.status==='unchecked')||(state==='readable'&&e.status==='candidate'&&e.access.status==='readable')||(state==='failed'&&(e.access.status==='failed'||latest(e)?.status==='failed'));
  }
  function update(entry){var at=data.entries.findIndex(function(e){return e.id===entry.id;});if(at<0)data.entries.push(entry);else data.entries[at]=Object.assign({},data.entries[at],entry);render();}
  async function refreshAfterSave(){try{data=await api('source-library');render();}catch{message('library-status','修改已保存；运行统计暂未刷新，请稍后重新打开页面。',true);}}
  function payload(e,state){return{id:e.id,revision:e.revision,config:e.config,status:state||e.status};}
  async function action(e,kind,target){
    if(busy||!data.writable)return;busy=true;feedback[e.id]={text:kind==='check'?'正在检查入口…':'正在保存…',error:false};render();message('library-status',kind==='check'?'正在检查入口，不调用模型…':'正在保存渠道状态…');
    try {var result=await api(kind==='check'?'check-library-entry':'save-library-entry',kind==='check'?{id:e.id,revision:e.revision}:payload(e,target));update(result.entry);
      if(kind!=='check'&&target==='active'&&e.config.scope==='site')data.entries.forEach(function(row){if(new URL(row.config.url).hostname.replace(/^www\./,'')===new URL(e.config.url).hostname.replace(/^www\./,''))row.host_paused=false;});
      var text=kind==='check'?(result.entry.access.status==='readable'?'入口本次可读取；仍需查看实际产出。':'入口读取失败：'+accessReason(result.entry.access.error_code)+'。'):'已保存「'+e.config.name+'」：'+states[result.entry.status]+'。';
      feedback[e.id]={text:text,error:false};message('library-status',text);await refreshAfterSave();
    }catch(err){feedback[e.id]={text:err.message,error:true};message('library-status',err.message,true);}finally{busy=false;render();}
  }
  function automaticStage(e){
    if(!systemManaged(e)||['paused','removed'].includes(e.status))return '';
    if(e.host_paused||e.usage?.reason==='scope_paused')return '受已暂停或移除范围影响';
    if(e.integration)return '已纳入已核验栏目，历史保留';
    if(e.access.status==='failed')return '入口失败，待修复';
    if(e.status==='candidate'&&e.usage?.reason==='reference_trial')return e.performance?.task_count?'预算内试采':'等待预算内试采';
    if(e.access.scope_confirmation_needed)return '系统继续积累样文';
    if(e.access.origin==='discovered_sources'&&!e.access.scope_verified)return '已纳入，待核验栏目';
    if(e.status==='active')return '已自动启用';
    if(e.usage?.reason==='reference_trial')return e.performance?.task_count?'预算内试采':'等待预算内试采';
    return e.access.status==='unchecked'?'已纳入，待检查入口':'已纳入候选';
  }
  function nextStep(e){
    if(e.status==='removed')return '需要时恢复到待处理，再检查入口。';
    if(e.status==='paused')return e.config.mode==='fixed'||e.access.status==='readable'?'需要时恢复；只参与后续搜集，不补跑历史。':'先检查入口，读取成功后再恢复启用。';
    if(e.usage?.reason==='scope_paused')return '受其他已暂停或移除范围影响，先核对并恢复对应范围。';
    if(e.host_paused)return e.config.scope==='site'?'先恢复网站抓取。':'请从同站整站渠道恢复网站抓取。';
    if(e.integration)return '已由「'+e.integration.name+'」已核验栏目覆盖；保留此样文历史，无需重复处理。';
    if(e.access.status==='failed')return '核对网址后重新检查入口：'+accessReason(e.access.error_code)+'。';
    if(systemManaged(e)){
      if(e.status==='candidate'&&e.access.status==='unchecked')return '等待系统免费检查入口；无需逐个手动启用。';
      if(e.status==='candidate'&&e.usage?.reason==='reference_trial')return '等待既有额度内的自然试采；有效样文满足条件后自动启用。';
      if(e.access.scope_confirmation_needed)return '系统继续积累样文并核对栏目；你也可提前确认入口。';
      if(e.access.origin==='discovered_sources'&&!e.access.scope_verified)return '等待免费核对栏目及原文链接；范围未确认前不试采。';
    }
    if(systemManaged(e)&&e.config.type==='unknown')return '来源类别尚未核实；系统可继续检查与试采，你可在编辑中补充。';
    if(e.config.type==='unknown')return '补充来源类别，再结合入口检查与原文样本决定使用。';
    if(e.status==='candidate')return e.access.status==='readable'?'入口可读；结合原文样本决定是否启用。':'先检查入口，再决定是否启用。';
    if(latest(e)?.status==='failed')return '查看最近失败原因；保留失败记录，不重复人工付费重试。';
    if(e.usage?.reason==='outside_scope')return '与当前搜集范围未匹配，先核对报道地区和适用方向。';
    if(e.config.mode!=='fixed'&&e.access.status!=='readable')return '先检查入口，确认轮转条件。';
    return '继续观察产出；新线索进入情报库。';
  }
  function taskText(e){
    var reasons={outside_scope:'与当前搜集范围未匹配',scope_confirmation_needed:'样文与栏目依据不足，等待系统继续积累',scope_unverified:'栏目范围待核验，暂不参与轮转',entry_unchecked:'尚未检查入口，暂不参与轮转',entry_failed:'入口异常，暂不参与轮转',host_paused:'网站抓取已暂停',scope_paused:'受其他暂停或移除范围影响',paused:'渠道已暂停',removed:'渠道已移除',candidate:'待决定是否启用',reference_trial:'等待既有限量试探'},reason=reasons[e.usage?.reason],task=latest(e);
    if(e.integration&&!e.host_paused&&!['scope_paused','paused','removed'].includes(e.usage?.reason))reason='已由已核验栏目接续搜集';
    if(!task)return reason||(e.config.mode==='fixed'?'今天暂无入口任务记录':'今天尚未轮到');
    var text=(task.day||data.day)+' · '+(taskStates[task.status]||task.status)+' · '+time(task.updated_at);
    if(task.day&&task.day!==data.day&&e.config.mode!=='fixed')text+='；'+(reason||'今天尚未轮到');
    return text;
  }
  function statistic(title,text){var box=node('div');box.append(node('dt',title),node('dd',text));return box;}
  function card(e){
    var c=e.config,p=e.performance,root=node('article',undefined,'intel-panel intel-library-card'),heading=node('div',undefined,'intel-section-heading');
    heading.append(node('h3',c.name),node('span',view==='pending'?(growthGroup(e)==='system'?'系统推进':growthGroup(e)==='exception'?'异常待修复':'需你决定'):needsAttention(e)?'需查看':states[e.status],'intel-badge'));root.append(heading);
    root.append(node('p',(data.types[c.type]||'待分类')+' · '+c.countries.map(function(v){return names[v]||v;}).join('、')+' · '+(c.mode==='fixed'?'固定监测':'轮转搜集'),'intel-muted'));
    var stage=automaticStage(e);if(stage)root.append(node('p','自动进展：'+stage,'intel-library-stage'));else if(e.access.managed_by==='user')root.append(node('p','由你管理','intel-library-stage'));
    root.append(node('p','适用方向：'+(c.direction_ids.length?directionNames(c.direction_ids)||'原关联方向已不存在':'所有已保存方向'),'intel-library-directions'));
    var stats=node('dl',undefined,'intel-library-stats');stats.append(statistic('最近执行 · 北京时间',taskText(e)),statistic('自然发现并核验原文',p?(p.natural_source_count?String(p.natural_source_count)+' 篇':p.sources_limited||p.tasks_limited?'窗口内未见':'近30天未确认'):'尚未读取统计'),statistic('近30天同站有效样文',p?(p.same_site_source_count?String(p.same_site_source_count)+' 篇（含自然原文）':p.sources_limited?'窗口内未见':'未确认近期样文'):'尚未读取统计'));root.append(stats);
    if(p?.sources_limited||p?.tasks_limited)root.append(node('p','统计限于已读取的记录窗口，不能据此断言全量为零。','intel-library-window'));
    root.append(node('p','下一步：'+nextStep(e),'intel-library-next'));
    var primary=node('div',undefined,'intel-direction-buttons');
    if(e.status!=='removed'&&e.host_paused&&c.scope==='site'&&(c.mode==='fixed'||e.access.status==='readable'))primary.append(button('恢复网站抓取',function(){action(e,'state','active');},true));
    else if(e.status==='candidate'&&!e.host_paused&&!e.integration&&growthGroup(e)!=='system'){
      if(e.access.status==='failed')primary.append(button('编辑入口',function(){open(e);},true),button('重新检查',function(){action(e,'check');},true));
      else if(e.access.status==='readable')primary.append(button('启用轮转',function(){action(e,'state','active');},true));
      else primary.append(button('检查入口',function(){action(e,'check');},true));
    }else if(e.status==='paused'&&(c.mode==='fixed'||e.access.status==='readable'))primary.append(button('恢复启用',function(){action(e,'state','active');},true));
    else if(e.status==='removed')primary.append(button('恢复到待处理',function(){action(e,'state','candidate');},true));
    else if(needsAttention(e)&&!e.host_paused)primary.append(button('检查入口',function(){action(e,'check');},true));
    if(primary.childElementCount)root.append(primary);
    var more=node('details');more.append(node('summary','原文、运行与管理'),link(c.url,c.url),node('p','监测范围：'+(c.scope==='site'?'整个网站':'此栏目或作者路径')+'；来源语言：'+(c.languages.join('、')||'未标注'),'intel-muted'));
    if(e.access.status==='readable'||e.access.status==='failed')more.append(node('p',(e.access.status==='readable'?'入口可读，尚不等于有效采集':'入口读取失败：'+accessReason(e.access.error_code))+' · '+time(e.access.checked_at)+' 北京时间','intel-library-access'));
    if(p)more.append(node('p','近30天入口任务：'+p.task_count+' 项，完成 '+p.succeeded_tasks+'、失败 '+p.failed_tasks+'、预算暂停 '+p.budget_paused_tasks+'、人工暂停 '+p.manual_paused_tasks+'、未结束 '+p.pending_tasks+'。','intel-muted'));
    if(latest(e)?.error_code)more.append(node('p','最近失败：'+latest(e).error_code,'intel-muted'));
    if(c.notes)more.append(node('p',c.notes,'intel-muted'));
    var samples=node('details');samples.append(node('summary','有效原文样本'));
    [['自然执行产生',p?.natural_sources||[]],['同站有效样文（含自然执行原文）',p?.same_site_sources||[]]].forEach(function(group){samples.append(node('h4',group[0]));if(!group[1].length)samples.append(node('p','当前记录窗口暂无样本。','intel-muted'));group[1].forEach(function(s){var row=node('p');row.append(link('/intelligence/sources/'+s.id,s.title||'查看原文'),node('span',' · 原文日期 '+(s.publication_date||'未知')+' · 收录 '+time(s.fetched_at)));samples.append(row);});});more.append(samples);
    var hist=node('div'),history=button('查看修改历史',async function(){history.disabled=true;try{var r=await api('library-history',null,e.id);hist.replaceChildren();r.history.forEach(function(h){hist.append(node('p','版本 '+h.revision+' · '+states[h.status]+' · '+time(h.recorded_at)+' 北京时间'));});if(!r.history.length)hist.append(node('p','暂无手动修改记录。'));}catch(err){hist.textContent=err.message;}finally{history.disabled=false;}});more.append(history,hist);
    var actions=node('div',undefined,'intel-direction-buttons'),confirmBox=node('div',undefined,'intel-watch-confirm');confirmBox.hidden=true;
    if(e.status!=='removed')actions.append(button('编辑',function(){open(e);},true));
    if(e.status==='candidate'&&growthGroup(e)==='system'&&e.access.status==='readable'&&!e.integration)actions.append(button('手动启用并接管',function(){action(e,'state','active');},true));
    if(e.status==='candidate'&&growthGroup(e)==='system'&&!e.integration)actions.append(button('检查入口',function(){action(e,'check');},true));
    if(e.status==='active'||e.status==='paused')actions.append(button('检查入口',function(){action(e,'check');},true));
    if(e.status==='active')actions.append(button('暂停',function(){action(e,'state','paused');},true));
    if(e.status!=='removed')actions.append(button('移除',function(){confirmBox.hidden=false;},true));
    confirmBox.append(node('p','移除「'+c.name+'」将停止此'+(c.scope==='site'?'网站':'路径')+'后续自动抓取；原文、情报和历史保留。'),button('确认移除',function(){action(e,'state','removed');},true),button('取消',function(){confirmBox.hidden=true;}));more.append(actions,confirmBox);root.append(more);
    if(feedback[e.id]){var result=node('p',feedback[e.id].text,'intel-status');result.setAttribute('role','status');result.dataset.tone=feedback[e.id].error?'error':'success';root.append(result);}return root;
  }
  function pagination(id,total,current,change){var pages=Math.max(1,Math.ceil(total/8)),previous=button('上一页',function(){change(current-1);}),next=button('下一页',function(){change(current+1);});previous.disabled=current===0;next.disabled=current>=pages-1;$(id).replaceChildren(previous,node('span','共 '+total+' 项 · '+(current+1)+' / '+pages),next);}
  function switchView(next){view=next;page=0;$('library-view').value='all';render();}
  function coverageRows(direction){return (data.coverage||[]).filter(function(row){return !direction||row.direction_ids.includes(direction);}).flatMap(function(row){return row.types.map(function(t){
      if(!direction)return Object.assign({country:row.country,direction_ids:row.direction_ids},t);
      var relevant=data.entries.filter(function(e){return e.config.type===t.type&&e.scope?.countries.includes(row.country)&&e.scope?.direction_ids.includes(direction);}),eligible=relevant.filter(function(e){return e.status==='active'&&e.usage?.eligible;}),natural=new Set(),samples=new Set();
      eligible.forEach(function(e){(e.performance?.natural_sources||[]).filter(function(s){return (s.countries||[]).includes(row.country);}).forEach(function(s){natural.add(s.id);});(e.performance?.same_site_sources||[]).filter(function(s){return (s.countries||[]).includes(row.country);}).forEach(function(s){samples.add(s.id);});});
      return Object.assign({},t,{country:row.country,direction_ids:[direction],eligible_channels:eligible.length,fixed_channels:eligible.filter(function(e){return e.config.mode==='fixed';}).length,search_channels:eligible.filter(function(e){return e.config.mode==='search';}).length,candidate_channels:relevant.filter(function(e){return e.status==='candidate'&&!e.host_paused;}).length,natural_source_count:natural.size,sample_source_count:samples.size,gap:!eligible.length?'no_channel':!natural.size?'no_natural_source':'none'});
    });});}
  function matchingGapEntries(row){return data.entries.filter(function(e){return !['paused','removed'].includes(e.status)&&e.config.countries.includes(row.country)&&e.config.type===row.type&&row.direction_ids.some(function(id){return directionMatch(e,id);});});}
  function showMatches(row){var matches=matchingGapEntries(row),current=matches.some(function(e){return e.status==='active'&&!needsAttention(e);});view=current?'current':'pending';page=0;$('library-view').value='all';$('library-country').value=row.country;$('library-type').value=row.type;$('library-direction').value=row.direction_ids.length===1?row.direction_ids[0]:'';$('library-search').value='';render();$('library-management').scrollIntoView({block:'start',behavior:'smooth'});}
  function renderCoverageDetail(selected){
    var detail=$('library-coverage-detail');detail.hidden=!selected;detail.replaceChildren();
    if(selected){var row=selected,actions=node('div',undefined,'intel-direction-buttons'),matching=matchingGapEntries(row),matchButton=button(matching.length?'查看匹配渠道':'暂无匹配渠道',function(){showMatches(row);});matchButton.disabled=!matching.length;detail.append(node('h3',(names[row.country]||row.country)+' · '+data.types[row.type]),node('p','适用方向：'+directionNames(row.direction_ids),'intel-muted'),node('p',row.eligible_channels+' 个可用渠道（固定 '+row.fixed_channels+'、轮转 '+row.search_channels+'）；'+row.natural_source_count+' 篇近30天自然发现并核验原文；'+row.candidate_channels+' 个候选。'));
      if(row.limited)detail.append(node('p','记录窗口受限，未见原文不代表全量为零。','intel-muted'));actions.append(matchButton,button('补充渠道',function(){open(null,null,{countries:[row.country],direction_ids:row.direction_ids,type:row.type});},true));detail.append(actions);}
  }
  function renderCoverage(){
    var cells=coverageRows($('library-gap-direction').value),types=Object.keys(data.types).filter(function(t){return t!=='unknown';}),kind=$('library-gap-kind').value;
    var countries=Array.from(new Set(cells.map(function(r){return r.country;}))).filter(function(country){return (!$('library-gap-country').value||country===$('library-gap-country').value)&&(!kind||cells.some(function(r){return r.country===country&&r.gap===kind&&(!$('library-gap-type').value||r.type===$('library-gap-type').value);}));});
    var columns=$('library-gap-type').value?[$('library-gap-type').value]:types,table=node('table'),thead=node('thead'),head=node('tr'),tbody=node('tbody');head.append(node('th','关注地区'));
    var titles={government:'政府监管',utility:'公用事业',owner:'业主开发',supply:'供应链',procurement:'采购披露',finance:'金融投资',media:'新闻媒体',research:'研究作者'};columns.forEach(function(type){var th=node('th',titles[type]||data.types[type]);th.setAttribute('scope','col');th.title=data.types[type];head.append(th);});thead.append(head);table.append(thead);if(columns.length===1)table.className='intel-library-matrix-focused';
    $('library-coverage').replaceChildren();selectedButton=null;
    if(!data.coverage?.length){var empty=node('p','先在搜集方向保存关注地区，再查看渠道覆盖。','intel-empty');empty.append(document.createTextNode(' '),link('/intelligence/directions','去设置搜集方向'));$('library-coverage').append(empty);}
    else if(!countries.length)$('library-coverage').append(node('p','当前筛选下没有这类地区。','intel-empty'));
    else{countries.forEach(function(country){var tr=node('tr'),th=node('th',names[country]||country);th.setAttribute('scope','row');var lacking=cells.filter(function(r){return r.country===country&&columns.includes(r.type)&&r.gap==='no_channel';}).length;th.append(node('small',lacking?'缺来源 '+lacking+' 类':'已有'+columns.length+'类渠道'));tr.append(th);
      columns.forEach(function(type){var r=cells.find(function(row){return row.country===country&&row.type===type;}),td=node('td'),cell=button('',function(){if(selectedButton)selectedButton.setAttribute('aria-pressed','false');selectedButton=cell;selectedCell={country:country,type:type};cell.setAttribute('aria-pressed','true');renderCoverageDetail(r);$('library-coverage-detail').scrollIntoView({block:'nearest',behavior:'smooth'});});cell.className='intel-library-matrix-cell';cell.dataset.gap=r.gap;cell.setAttribute('aria-pressed',String(selectedCell?.country===country&&selectedCell?.type===type));if(selectedCell?.country===country&&selectedCell?.type===type)selectedButton=cell;cell.setAttribute('aria-label',(names[country]||country)+' '+data.types[type]+'，'+r.eligible_channels+' 个可用渠道，'+r.natural_source_count+' 篇近30天自然原文');cell.append(node('strong',r.gap==='no_channel'?'无渠道':r.gap==='no_natural_source'?'等待产出':'已有产出'),node('span',r.eligible_channels+' 个渠道'),node('small',r.natural_source_count?r.natural_source_count+' 篇原文':r.limited?'窗口内未见原文':'0 篇原文'));td.append(cell);tr.append(td);});tbody.append(tr);});table.append(tbody);$('library-coverage').append(table);}
    var visible=cells.filter(function(r){return countries.includes(r.country)&&columns.includes(r.type);}),missing=new Set(visible.filter(function(r){return r.gap==='no_channel';}).map(function(r){return r.country;})),waiting=new Set(visible.filter(function(r){return r.gap==='no_natural_source';}).map(function(r){return r.country;}));$('library-coverage-note').textContent='当前 '+countries.length+' 个地区；'+missing.size+' 个地区需补充来源，'+waiting.size+' 个地区有渠道等待原文。点击格子查看详情。';
    renderCoverageDetail(selectedCell&&cells.find(function(r){return r.country===selectedCell.country&&r.type===selectedCell.type;}));
    var w=data.window;$('library-window-note').textContent=w?time(w.first_day+'T00:00:00+08:00')+' 至 '+w.last_day+'；已读取 '+w.sources_read+' 条原文、'+w.tasks_read+' 项渠道任务。'+(w.sources_limited||w.tasks_limited?'记录窗口受限，零条表示本窗口未发现。':'')+(w.suggestions_limited?'新渠道按有效样文排序，仅展示前50个域名。':''):'统计以当前已读取记录为准。';
    var suggestions=(data.suggestions||[]).filter(function(s){return (!$('library-gap-country').value||(s.countries||[]).includes($('library-gap-country').value))&&(!$('library-gap-direction').value||(s.direction_ids||[]).includes($('library-gap-direction').value));});$('library-suggestions').replaceChildren();
    if(!suggestions.length)$('library-suggestions').append(node('p','当前窗口暂无符合条件的新渠道样文。','intel-muted'));
    suggestions.forEach(function(s){var root=node('article',undefined,'intel-panel intel-library-card'),heading=node('div',undefined,'intel-section-heading');heading.append(node('h3',s.name),node('span','待登记','intel-badge'));root.append(heading,node('p','推荐依据：近30天有 '+s.sample_count+' 篇日期和原件分析可核对的有效原文。','intel-library-next'),node('p','报道地区线索：'+((s.countries||[]).map(function(v){return names[v]||v;}).join('、')||'待确认'),'intel-muted'));
      var sample=node('p');sample.append(link(s.sample_url,'查看真实样文'),node('span',' · 原文日期 '+s.sample_date+' · 收录 '+time(s.fetched_at)+' 北京时间'));root.append(sample,button('登记渠道',function(){open(null,s.sample_url,{name:s.name,countries:s.countries||[],direction_ids:s.direction_ids||[],scope:'path',sample:true});},true));$('library-suggestions').append(root);});
  }
  function renderGrowth(){
    var recent=function(field,automatic){var values=data.entries.filter(function(e){return !automatic||systemManaged(e);}).map(function(e){return e.access[field];}).filter(function(v){return Number.isFinite(Date.parse(v));}).sort(function(a,b){return Date.parse(b)-Date.parse(a);});return values[0]?time(values[0])+' 北京时间':'暂无时间记录';};
    var growth=data.growth,status=$('library-growth-status');status.replaceChildren();
    [['近30天检查','checked_channels','last_checked_at','checked_at'],['近30天自动新增','registered_channels','last_registered_at','discovered_at'],['近30天自动启用','activated_channels','last_activated_at','activated_at']].forEach(function(item){var box=node('div'),value=node('dd'),partial=item[1]==='activated_channels'&&growth?.activation_dates_complete===false,count=growth?.[item[1]];box.append(node('dt',item[0]));value.append(node('strong',typeof count==='number'?(partial&&!count?'历史时间未完整记录':count+' 个渠道'+(partial?'（已有记录）':'')):'暂无计数记录'),node('small',growth?(growth[item[2]]?'最近 '+time(growth[item[2]])+' 北京时间':'暂无时间记录'):recent(item[3],item[3]!=='checked_at')));box.append(value);status.append(box);});
    var panel=$('library-growth-groups');panel.hidden=view!=='pending';panel.replaceChildren();[['system','系统自动推进'],['decision','需你决定'],['exception','异常与暂停影响']].forEach(function(group){var count=data.entries.filter(function(e){return (e.status==='candidate'||needsAttention(e))&&growthGroup(e)===group[0];}).length,b=button(group[1]+' '+count,function(){$('library-view').value=group[0];page=0;render();});b.setAttribute('aria-pressed',String($('library-view').value===group[0]));panel.append(b);});
  }
  function render(){
    $('library-add').disabled=!data.writable||busy;
    document.querySelectorAll('[data-library-view]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.libraryView===view));});
    $('library-management').hidden=view==='gaps';$('library-panel-gaps').hidden=view!=='gaps';$('library-growth-panel').hidden=view!=='pending';
    $('library-section-title').textContent=view==='pending'?'自动拓展':'正在使用';$('library-section-note').textContent=view==='pending'?'系统检查、试采与核验；只有明确需要决定或修复的渠道才需你介入。':'查看已启用渠道的实际执行和近期产出。';
    $('library-current-count').textContent=data.entries.filter(function(e){return e.status==='active';}).length+' 个';$('library-pending-count').textContent=data.entries.filter(function(e){return (e.status==='candidate'||needsAttention(e))&&growthGroup(e)!=='history';}).length+' 个';$('library-gaps-count').textContent=new Set(coverageRows().map(function(r){return r.country;})).size+' 地区';renderGrowth();
    Array.from($('library-view').options).forEach(function(opt){opt.hidden=view==='current'?['unchecked','readable','system','decision','exception'].includes(opt.value):opt.value==='normal';});
    var groups={system:0,decision:1,exception:2,history:3},entries=data.entries.filter(filtered).sort(function(a,b){return (view==='pending'?groups[growthGroup(a)]-groups[growthGroup(b)]:Number(needsAttention(b))-Number(needsAttention(a)))||(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0);});page=Math.min(page,Math.max(0,Math.ceil(entries.length/8)-1));$('library-list').replaceChildren();
    if(!entries.length)$('library-list').append(node('p',view==='current'?'当前筛选下没有启用渠道，可查看自动拓展进度。':'当前筛选下没有拓展中的渠道。','intel-empty'));var lastGroup='';entries.slice(page*8,page*8+8).forEach(function(e){var group=growthGroup(e);if(view==='pending'&&group!==lastGroup){$('library-list').append(node('h3',{system:'系统自动推进',decision:'需你决定',exception:'异常与暂停影响'}[group],'intel-library-group-heading'));lastGroup=group;}$('library-list').append(card(e));});pagination('library-pagination',entries.length,page,function(value){page=value;render();});
    var archived=data.entries.filter(function(e){return ['paused','removed'].includes(e.status)&&matchesFilters(e);});archivePage=Math.min(archivePage,Math.max(0,Math.ceil(archived.length/8)-1));$('library-archive-count').textContent='（'+archived.length+'）';$('library-archived-list').replaceChildren();if(!archived.length)$('library-archived-list').append(node('p','当前筛选下暂无暂停或移除渠道。','intel-muted'));archived.slice(archivePage*8,archivePage*8+8).forEach(function(e){$('library-archived-list').append(card(e));});pagination('library-archive-pagination',archived.length,archivePage,function(value){archivePage=value;render();});
    var integrated=data.entries.filter(function(e){return growthGroup(e)==='history'&&matchesFilters(e);});$('library-integrated-history').hidden=view!=='pending'||!integrated.length;$('library-integrated-count').textContent='（'+integrated.length+'）';$('library-integrated-list').replaceChildren();integrated.forEach(function(e){$('library-integrated-list').append(card(e));});
    renderCoverage();
  }
  function open(entry,url,draft){
    if(busy||!data.writable||dirty&&!confirm('放弃尚未保存的编辑？'))return;editing=entry;form.reset();var c=entry?entry.config:Object.assign({name:'',url:url||'',scope:'path',type:'unknown',priority:'normal',notes:'',countries:[],languages:[],direction_ids:[]},draft||{});
    ['name','url','scope','type','priority','notes'].forEach(function(k){form.elements[k].value=c[k];});['countries','languages','direction_ids'].forEach(function(k){form.querySelectorAll('[name="'+k+'"]').forEach(function(n){n.checked=c[k].includes(n.value);});});
    form.querySelector('.intel-library-optional').open=!!entry&&(c.priority!=='normal'||!!c.notes||!!c.languages.length);form.elements.url.disabled=entry?.config.mode==='fixed';form.elements.scope.disabled=entry?.config.mode==='fixed';$('library-editor').hidden=false;$('library-editor-title').textContent=entry?'编辑渠道':'添加渠道';message('library-save-status',entry?.access.managed_by==='automatic'?'保存后由你管理，系统不再自动修改此渠道。':draft?.sample?'已带入真实样文网址和地区线索，请确认名称、报道范围与栏目入口；保存后由你管理。':'');dirty=false;form.elements.name.focus();$('library-editor').scrollIntoView({block:'start',behavior:'smooth'});
  }
  form.addEventListener('input',function(){dirty=true;});form.addEventListener('change',function(){dirty=true;});
  $('library-add').addEventListener('click',function(){open(null);});$('library-cancel').addEventListener('click',function(){if(busy||dirty&&!confirm('放弃尚未保存的编辑？'))return;$('library-editor').hidden=true;dirty=false;});
  window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
  form.addEventListener('submit',async function(event){
    event.preventDefault();if(busy||!data.writable)return;var config={};['name','url','scope','type','priority','notes'].forEach(function(k){config[k]=form.elements[k].value;});['countries','languages','direction_ids'].forEach(function(k){config[k]=selected(k);});if(!config.countries.length){message('library-save-status','请至少选择一个来源报道地区。',true);return;}
    try{if(config.scope==='path'&&new URL(config.url).pathname==='/'){message('library-save-status','根网址表示整个网站：请选择“整个网站”，或填写具体栏目、作者路径。',true);return;}}catch{message('library-save-status','请填写有效的公开入口网址。',true);return;}
    var status=editing?editing.status:'candidate';if(editing&&(config.url!==editing.config.url||config.scope!==editing.config.scope))status='candidate';busy=true;Array.from(form.elements).forEach(function(e){e.disabled=true;});message('library-save-status','正在保存…');
    try {var result=await api('save-library-entry',{id:editing?.id||null,revision:editing?.revision||0,config:config,status:status});editing=result.entry;dirty=false;page=0;view=result.entry.status==='active'?'current':'pending';$('library-view').value='all';['library-country','library-type','library-direction'].forEach(function(id){$(id).value='';});$('library-search').value=config.name;update(result.entry);message('library-save-status','已保存渠道。'+(result.entry.status==='candidate'?'请检查入口，再决定是否启用。':'状态：'+states[result.entry.status]));message('library-status','已保存「'+config.name+'」。');$('library-editor').hidden=true;await refreshAfterSave();}
    catch(err){message('library-save-status',err.message+' 输入已保留。',true);}finally{busy=false;Array.from(form.elements).forEach(function(e){e.disabled=false;});form.elements.url.disabled=editing?.config.mode==='fixed';form.elements.scope.disabled=editing?.config.mode==='fixed';render();}
  });
  document.querySelectorAll('[data-library-view]').forEach(function(b){b.addEventListener('click',function(){if(data)switchView(b.dataset.libraryView);});});
  ['library-view','library-country','library-type','library-direction','library-search'].forEach(function(id){$(id).addEventListener('input',function(){page=0;archivePage=0;if(data)render();});});
  ['library-gap-country','library-gap-type','library-gap-direction','library-gap-kind'].forEach(function(id){$(id).addEventListener('input',function(){selectedCell=null;if(data)renderCoverage();});});
  (async function(){try{
    data=await api('source-library');data.directions.forEach(function(d){var label=node('label'),input=node('input');input.type='checkbox';input.name='direction_ids';input.value=d.id;label.append(input,node('span',d.config.name));$('library-directions').append(label);['library-direction','library-gap-direction'].forEach(function(id){var opt=node('option',d.config.name);opt.value=d.id;$(id).append(opt);});});
    var countries=new Set((data.coverage||[]).map(function(r){return r.country;}));regions.countries.filter(function(c){return countries.has(c.code);}).forEach(function(c){var opt=node('option',c.name);opt.value=c.code;$('library-gap-country').append(opt);});render();message('library-status',data.writable?'':'当前为只读模式，仍可筛选和查看历史。');var channel=new URL(location.href).searchParams.get('channel');if(channel&&data.writable){try{var u=new URL(channel);if(u.protocol==='https:')open(null,u.href);}catch{}}
  }catch(err){message('library-status',err.message,true);}})();
})();
