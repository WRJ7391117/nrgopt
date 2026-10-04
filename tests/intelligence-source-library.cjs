const test=require('node:test'), assert=require('node:assert/strict');
const {defaults,validateEntry,matches,checkEntry,selectChannel}=require('../lib/intelligence/source-library.cjs');
const {discoveryQuery}=require('../lib/intelligence/discovery.cjs');
const {createStore}=require('../lib/intelligence/store.cjs');
const entry=()=>validateEntry({revision:0,status:'candidate',config:{name:'Public author',url:'https://example.org/authors/alice/',scope:'path',type:'research',countries:['SA'],languages:['en'],direction_ids:[],notes:'公开能源专栏',priority:'normal'}});
test('channel validation preserves author path, does not accept tracking queries or caller adapters',()=>{
 const e=entry();assert.equal(e.config.mode,'search');
 for(const url of ['http://example.org/','https://127.0.0.1/','https://user:pass@example.org/','https://example.org/?token=private']) assert.throws(()=>validateEntry({...e,config:{...e.config,url}}));
 assert.throws(()=>validateEntry({...e,config:{...e.config,countries:['ZZ']}}));
 assert.throws(()=>validateEntry({...e,id:'fixed:invented'}));
 const fixed=defaults()[0];assert.throws(()=>validateEntry({...fixed,config:{...fixed.config,url:'https://different.org/'}}));
 assert.equal(validateEntry({...e,config:{...e.config,scope:'site'}}).config.url,'https://example.org/');
});
test('channel removal matches only chosen host and path boundary, not other authors or similar hosts',()=>{
 const e=entry();assert.equal(matches(e,'https://www.example.org/authors/alice/post'),true);
 for(const url of ['https://example.org/authors/bob/post','https://example.org/authors/alice-other/post','https://example.org.evil.test/authors/alice/post'])assert.equal(matches(e,url),false);
 assert.equal(matches({...e,config:{...e.config,scope:'site'}},'https://example.org/other'),true);
});
test('channel selection alternates open discovery, honors direction and status, and stays in original query slot',()=>{
 const e={...entry(),status:'active',access:{status:'readable'}};
 const dates=Array.from({length:8},(_,i)=>'2026-09-'+String(21+i));
 const selections=dates.map(day=>selectChannel([e],'SA',null,day));assert.equal(selections.filter(Boolean).length,4);
 assert.equal(selectChannel([e],'OM',null,dates.find((_,i)=>selections[i])),null);
 for(const status of ['paused','removed','candidate'])assert.equal(selectChannel([{...e,status}],'SA',null,dates.find((_,i)=>selections[i])),null);
 const bound={...e,config:{...e.config,direction_ids:['11111111-1111-4111-8111-111111111111']}};
 assert.equal(selectChannel([bound],'SA',{id:'other'},dates.find((_,i)=>selections[i])),null);
 assert.equal(selectChannel([{...e,host_paused:true}],'SA',null,dates.find((_,i)=>selections[i])),null);
 assert.match(discoveryQuery('SA',1,null,selections.find(Boolean)),/site:example.org\/authors\/alice\//);
 assert.doesNotMatch(discoveryQuery('SA'),/site:/);
});
test('readable reference candidates get a bounded trial in an existing targeted slot',()=>{
 const active={...entry(),status:'active',access:{status:'readable'}};
 const reference={...entry(),id:'reference:example.org',status:'candidate',access:{status:'readable',review:'recent_source_missing'}};
 const trial=selectChannel([active,reference],'SA',null,'2026-09-21');
 assert.equal(trial.id,reference.id);assert.equal(trial.trial,true);
 assert.equal(selectChannel([active,reference],'SA',null,'2026-09-22'),null);
 assert.equal(selectChannel([active,reference],'SA',null,'2026-09-23').id,active.id);
 assert.equal(selectChannel([{...reference,access:{status:'failed'}}],'SA',null,'2026-09-21'),null);
 assert.equal(selectChannel([{...reference,host_paused:true}],'SA',null,'2026-09-21'),null);
 assert.equal(selectChannel([{...reference,id:active.id}],'SA',null,'2026-09-21'),null);
 assert.match(discoveryQuery('SA',1,null,trial),/site:example.org\/authors\/alice\//);
});
test('store combines fixed references without promoting unknown identity and persists owner-scoped revisions',async()=>{
 const e=entry(),requests=[];const store=createStore({url:'https://db.test',serviceKey:'x'},async(url,init)=>{requests.push({url,init});if(url.includes('/rpc/'))return new Response(JSON.stringify({error:'library_conflict'}));if(url.includes('intelligence_source_library?'))return new Response(JSON.stringify([{...e,status:'removed',revision:2,access:{status:'unchecked'}}]));return new Response('[]');});
 assert.equal(await store.sourcePaused('owner','https://example.org/authors/alice/new'),true);
 assert.equal(await store.sourcePaused('owner','https://example.org/authors/bob/new'),false);
 assert.ok((await store.sourceLibrary('owner')).some(e=>e.id.startsWith('reference:')&&e.status==='candidate'));
 await assert.rejects(store.saveLibraryEntry('owner',e),err=>err.code==='library_conflict'&&err.status===409);
 const rpc=requests.find(r=>r.url.includes('/rpc/'));assert.equal(JSON.parse(rpc.init.body).p_owner_id,'owner');
 for(const r of requests.filter(r=>!r.url.includes('/rpc/')))assert.equal(new URL(r.url).searchParams.get('owner_id'),'eq.owner');
});

test('extra-country channel rotation advances by country cycle, avoiding a fixed modulo starvation',()=>{
 const entries=Array.from({length:9},()=>({...entry(),status:'active',access:{status:'readable'}}));entries.forEach(e=>{e.config.countries=['OM','JO'];e.config.priority='low';});
 const used=new Set();for(let n=0;n<9;n++){const day=new Date(Date.UTC(2026,8,21)+n*18*86400000).toISOString().slice(0,10);const selected=selectChannel(entries,'JO',null,day);if(selected)used.add(selected.id);}
 // Sept 21 is an eligible odd day in this selection policy; each cycle advances one source.
 assert.equal(used.size,9);
});
test('candidate check requires readable entry and recent same-host analysis of the current source hash',async()=>{
 const e={...entry(),config:{...entry().config,url:'https://example.org/',scope:'site'}};
 const fetch=async()=>({finalUrl:'https://www.example.org/',excerpt:'Public page',bytes:Buffer.from('public page'),title:'Example'});
 const sample={id:'sample',final_url:'https://example.org/article',publication_date:'2026-09-01',publication_method:'metadata',extraction_status:'extracted',content_sha256:'a'.repeat(64),extraction_source_sha256:'a'.repeat(64)};
 assert.equal((await checkEntry(e,fetch,[sample],'2026-09-28')).review,'recent_validated_source');
 for(const changed of [{final_url:'https://example.org.evil.test/article'},{publication_date:'2026-08-29'},{publication_date:null},{publication_method:'conflicting_metadata'},{extraction_source_sha256:'b'.repeat(64)},{extraction_status:'failed'}])
  assert.equal((await checkEntry(e,fetch,[{...sample,...changed}],'2026-09-28')).review,'recent_source_missing');
 assert.equal((await checkEntry(e,fetch,[{...sample,extraction_status:'failed'},sample],'2026-09-28')).review,'recent_source_missing');
 assert.equal((await checkEntry(e,async()=>({...await fetch(),finalUrl:'https://evil.test/'}),[sample],'2026-09-28')).error_code,'registry_redirect_host');
});
