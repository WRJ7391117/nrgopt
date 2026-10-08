const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateDirection, selectDirection, selectSearchTopic, validateMatches } = require('../lib/intelligence/directions.cjs');
const { discoveryQuery } = require('../lib/intelligence/discovery.cjs');
const { watchSearchPlan } = require('../lib/intelligence/watch-search.cjs');
const { createStore } = require('../lib/intelligence/store.cjs');
const id='11111111-1111-4111-8111-111111111111';
const d={id,revision:1,config:structuredClone(defaults[0].config)};
test('direction inputs bound every user field and reject invalid or duplicate scopes',()=>{
  assert.equal(validateDirection({revision:0,config:d.config}).config.name,d.config.name);
  for(const change of [{countries:[]},{countries:['SA','SA']},{countries:['ZZ']},{targets:['order']},{enabled:'true'},{name:'x'.repeat(81)}])
    assert.throws(()=>validateDirection({revision:0,config:{...d.config,...change}}),{code:'invalid_request'});
  assert.throws(()=>validateDirection({id:'-'.repeat(36),revision:0,config:d.config}));
});

test('direction topic associations are optional for old settings, bounded and reusable across directions', () => {
  const old = { ...d.config }; delete old.topic_codes;
  assert.deepEqual(validateDirection({ revision: 0, config: old }).config.topic_codes, []);
  const custom = 'custom-11111111-1111-4111-8111-111111111111';
  const shared = ['red-sea', custom];
  const first = validateDirection({ revision: 0, config: { ...old, name: '航运与保供', topic_codes: shared } });
  const second = validateDirection({ revision: 0, config: { ...old, name: '跨境项目与投资', topic_codes: shared } });
  assert.deepEqual(first.config.topic_codes, shared);
  assert.deepEqual(second.config.topic_codes, shared, 'one topic can belong to several independent directions');
  assert.deepEqual(validateDirection({ revision: 0, config: { ...old, topic_codes: [] } }).config.topic_codes, []);
  for (const topic_codes of [null, 'red-sea', ['red-sea', 'red-sea'], ['SA'], ['unknown'], [4], Array(21).fill(custom)]) {
    assert.throws(() => validateDirection({ revision: 0, config: { ...old, topic_codes } }), { code: 'invalid_request' });
  }
});
test('weighted rotation visits all enabled directions without expanding the country search count',()=>{
  const plan=['high','normal','low'].map((priority,i)=>({...d,id:String(i),config:{...d.config,priority}}));
  const counts=[0,0,0];
  for(let i=1;i<=60;i++) counts[selectDirection(plan,'SA',new Date(Date.UTC(2026,8,i)).toISOString().slice(0,10)).id]++;
  assert.deepEqual(counts,[30,20,10]);
  assert.equal(selectDirection([{...d,config:{...d.config,enabled:false}}],'SA','2026-09-27'),null);
  assert.equal(selectDirection([{...d,config:{...d.config,countries:['QA']}}],'SA','2026-09-27'),null);
});

test('actual direction execution turns alternate ordinary search with each linked active topic', () => {
  const direction = { ...d, config: { ...d.config, topic_codes: ['red-sea', 'hormuz'] } };
  const topics = [
    { code: 'red-sea', name: '红海', description: '跨境航运与能源运输', revision: 2, active: true },
    { code: 'suez', name: '苏伊士', description: '未关联专题', revision: 1, active: true },
    { code: 'hormuz', name: '霍尔木兹', description: '跨境能源供应', revision: 3, active: true }
  ];
  const selected = Array.from({ length: 8 }, (_, count) => selectSearchTopic(direction, topics, count));
  assert.deepEqual(selected.map(topic => topic?.code || null), [null, 'hormuz', null, 'red-sea', null, 'hormuz', null, 'red-sea']);
  assert.deepEqual(selected[1], { code: 'hormuz', name: '霍尔木兹', description: '跨境能源供应', revision: 3 });
  assert.deepEqual(selectSearchTopic(direction, [...topics].reverse(), 3), selected[3], 'catalog display order must not alter search rotation');
  const sharedDirection = { ...direction, id: '22222222-2222-4222-8222-222222222222' };
  assert.deepEqual(selectSearchTopic(sharedDirection, topics, 1), selected[1], 'a topic is not consumed by use in another direction');
  for (const count of [0, 1, 9]) {
    assert.equal(selectSearchTopic({ ...direction, config: { ...direction.config, topic_codes: [] } }, topics, count), null);
    assert.equal(selectSearchTopic(direction, topics.filter(topic => topic.code === 'suez'), count), null);
    assert.equal(selectSearchTopic(direction, topics.map(topic => ({ ...topic, active: false })), count), null);
  }
  const oldConfig = { ...direction.config }; delete oldConfig.topic_codes;
  assert.equal(selectSearchTopic({ ...direction, config: oldConfig }, topics, 1), null);
});

test('frozen topic text guides search without supplying source evidence or raw operators', () => {
  const direction = { ...d, config: { ...d.config, topic_codes: ['red-sea'] }, search_topic: {
    code: 'red-sea', revision: 2, name: '红海 site:private.example "', description: '航运与能源运输 OR 延期',
  } };
  const query = discoveryQuery('SA', 1, direction);
  assert.match(query, /红海/);
  assert.match(query, /航运与能源运输/);
  assert.ok(!query.includes('site:private.example') && !query.includes('"'));
  const match = { id, revision: 1, relevant: true, reason_zh: '仅依据已关联专题。', evidence_fact_number: 1 };
  assert.throws(() => validateMatches([match], [direction], []), { code: 'extraction_invalid_direction_matches' }, 'association alone cannot establish a relevant evidence match');
});
test('direction queries broaden websites while preserving positive intent and sanitizing operators',()=>{
  const changed={...d,config:{...d.config,name:'关注储能 site:evil.test " OR ',targets:['procurement'],exclude:'一般评论'}};
  for(const attempt of [1,2,3]) {
    const q=discoveryQuery('QA',attempt,changed);
    assert.match(q,/关注储能/);assert.match(q,/采购机会/);assert.ok(!q.includes('一般评论'));
    assert.ok(!q.includes('site:evil.test'));assert.ok(!q.includes('site:'));
  }
});
test('direction relevance requires the frozen revision and an existing validated fact',()=>{
  const match={id,revision:1,relevant:true,reason_zh:'原文披露供能中断。',evidence_fact_number:1};
  assert.equal(validateMatches([match],[d],[{claim_zh:'停电',evidence_quote:'outage'}])[0].relevant,true);
  for(const value of [[{...match,revision:2}],[{...match,evidence_fact_number:2}],[],[match,match]])
    assert.throws(()=>validateMatches(value,[d],[{}]),{code:'extraction_invalid_direction_matches'});
  assert.equal(validateMatches([{...match,relevant:false,evidence_fact_number:99}],[d],[{}])[0].evidence_fact_number,null);
});
test('pausing the linked direction stops automatic evidence searches but respects explicit manual tracking',()=>{
  const h={id:'h',status:'open',created_at:'2026-09-25T00:00:00Z',source_url:'https://example.test/a',source_title:'Public project',direction_ids:[id],candidate:{source_id:'s',occurrence_countries:['SA']}};
  const paused=[{...d,config:{...d.config,enabled:false}}];
  assert.equal(watchSearchPlan([h],'2026-09-27',paused).length,0);
  assert.equal(watchSearchPlan([{...h,manual_followup:true}],'2026-09-27',paused).length,2);
  const plan=watchSearchPlan([h],'2026-09-27',[d]);
  assert.equal(plan.length,2);assert.match(plan[0].checkpoint.query,/地区冲突/);assert.match(plan[1].checkpoint.query,/cancelled/);
});
test('direction result verification is invalidated by source changes and reanalysis',async()=>{
  const at='2026-09-27T00:00:00Z';
  for(const change of [{},{content_sha256:'b'},{extracted_at:'2026-09-27T01:00:00Z'}]) {
    const store=createStore({url:'https://db.test',serviceKey:'test'},async url=>{
      const u=new URL(url);assert.equal(u.searchParams.get('owner_id'),'eq.owner');
      const data=u.pathname.endsWith('intelligence_collection_directions')?[{id}]:u.pathname.endsWith('intelligence_direction_sources')?[{source_id:'s',match:{relevant:true},analysis_sha256:'a',analysis_extracted_at:at}]:u.pathname.endsWith('intelligence_sources')?[{id:'s',content_sha256:'a',extraction_source_sha256:'a',extraction_status:'extracted',extracted_at:at,...change}]:[];
      return new Response(JSON.stringify(data));
    });
    assert.equal((await store.directionResults('owner',id)).items[0].verified,Object.keys(change).length===0);
  }
});

test('a later direction reuses an already completed source job without enqueueing or paying again',async()=>{
  const writes=[];
  const store=createStore({url:'https://db.test',serviceKey:'test'},async(input,init)=>{
    const url=new URL(input);
    if(init.method==='POST'){writes.push(JSON.parse(init.body));return new Response('');}
    assert.equal(url.searchParams.get('owner_id'),'eq.owner');
    if(init.method==='PATCH'){writes.push(JSON.parse(init.body));return new Response('');}
    assert.match(url.pathname,/intelligence_job_items$/);
    return new Response(JSON.stringify([{checkpoint:{url:'https://example.test/a',source_id:'saved-source'}}]));
  });
  await store.recordDirectionSources('owner','run',[d],['https://example.test/a']);
  assert.equal(writes[0][0].direction.revision,1);assert.deepEqual(writes[1],{source_id:'saved-source'});
});
