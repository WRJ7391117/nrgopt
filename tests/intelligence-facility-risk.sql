-- Run only in an isolated test database after migration 054. Synthetic rows and queued notices roll back.
begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); fixture_source_id uuid; first_source uuid; risk_id uuid;
 event_day date; day date:=(now() at time zone 'Asia/Shanghai')::date;
 raw_hash text; event_key text; fingerprint text; risk_status text; source_status text; source_country text;
 extraction jsonb; payload jsonb; risk jsonb; expected_risks integer:=0; i integer; denied boolean:=false;
begin
 insert into auth.users(id) values(a),(b);
 set local role service_role;
 insert into public.intelligence_collection_directions(owner_id,config,effective_on)
 values(a,'{"name":"关键设施风险","why":"观察已披露设施事件","countries":["SA"],"targets":["signal"],"industries":"交通","exclude":"","priority":"high","enabled":true}',day);

 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
 select id,owner_id,revision,config,effective_on from public.intelligence_collection_directions where owner_id=a;

 for i in 1..13 loop
  fixture_source_id:=gen_random_uuid(); raw_hash:=lpad(to_hex(i),64,'0'); event_day:=day-1;
  event_key:=repeat('a',64); fingerprint:=repeat('b',64); risk_status:='reported'; source_status:='reported_event'; source_country:='SA';
  if i=3 then fingerprint:=repeat('c',64); end if; -- New source discloses material damage to the same incident.
  if i=4 then event_key:=repeat('d',64); event_day:=day; end if; -- A separate incident, not a reprint.
  if i=5 then event_key:=null; event_day:=null; risk_status:='pending_verification'; source_status:='statement_only'; end if;
  if i=6 then event_day:=day-60; risk_status:='historical'; end if; -- Recently published retrospective.
  if i=10 then source_country:='QA'; event_key:=repeat('e',64); end if;
  if i=12 then source_status:='statement_only'; end if; -- Payload cannot promote a statement to a reported event.
  risk:=jsonb_build_object('event_type','attack','facility_zh','测试国际机场','facility_name','Fixture International Airport',
   'country_code',source_country,'event_date',event_day,'event_status',source_status,'severity','high',
   'impact_status',case when i=3 then 'damaged' else 'unknown' end,'fact_numbers',jsonb_build_array(1),'date_fact_number',case when event_day is null then null else 1 end);
  extraction:=jsonb_build_object('classification',jsonb_build_object('disposition','source_only','energy_scope','none','radars','[]'::jsonb,'project',null,'procurement',null),
   'known_facts',jsonb_build_array(jsonb_build_object('claim_zh','测试媒体报道设施风险，能源影响未披露。','statement_type','report',
    'attribution_zh','合成新闻来源','evidence_quote',case when i=5 then 'Officials condemned an attack on Fixture International Airport in Saudi Arabia; its date was not disclosed.'
     else 'Fixture International Airport in '||case when source_country='QA' then 'Qatar' else 'Saudi Arabia' end||' was attacked'
      ||case when i=3 then ' and damaged' else '' end||' on '||event_day::text||'.' end)),
   'risk_signal',risk);
  if i=11 then extraction:=extraction-'risk_signal'; end if;
  if i=13 then extraction:=jsonb_set(extraction,'{risk_signal,event_date}',to_jsonb((day-2)::text)); end if;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
   extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
  values(fixture_source_id,case when i=9 then b else a end,'https://fixture-'||i||'.invalid/incident','https://fixture-'||i||'.invalid/incident',
   'pending_extraction',raw_hash,'fixture-risk/'||i,'extracted',case when i=8 then repeat('f',64) else raw_hash end,extraction,now(),day);
  payload:=risk||jsonb_build_object('status',risk_status,'notification_eligible',i<>5,'event_key',event_key,'fact_fingerprint',fingerprint,
   'event_date',event_day,'publication_date',day,'country_code',source_country,'facility_zh','测试国际机场',
   'facts',jsonb_build_array('测试媒体报道设施风险，能源影响未披露。'),'unknowns_zh',jsonb_build_array('能源影响待核实。'),'next_signals_zh',jsonb_build_array('核对运营方通报。'));
  risk_id:=public.save_intelligence_risk_signal(a,fixture_source_id,case when i=7 then repeat('f',64) else raw_hash end,payload);
  if i in(7,8,9) then
   if risk_id is not null or exists(select 1 from public.intelligence_risk_signals r where r.source_id=fixture_source_id)
    then raise exception 'foreign owner or mismatched original/extraction hash accepted: %',i; end if;
  else
   expected_risks:=expected_risks+1;
   if risk_id is null then raise exception 'valid risk evidence not retained: %',i; end if;
   if i=1 then first_source:=fixture_source_id; end if;
   if public.save_intelligence_risk_signal(a,fixture_source_id,raw_hash,payload) is distinct from risk_id then raise exception 'risk retry was not idempotent'; end if;
   if i in(5,6,10,11,12,13) and exists(select 1 from public.intelligence_risk_signals r where r.id=risk_id and r.flash_notification_id is not null)
    then raise exception 'pending/historical/outside-scope/unsupported source metadata queued a flash: %',i; end if;
  end if;
  if i=1 and (select count(*) from public.intelligence_notification_outbox n where n.owner_id=a and n.notification_type='flash')<>1
   then raise exception 'source-only risk was silently omitted from flash'; end if;
  if i=2 and (select count(*) from public.intelligence_notification_outbox n where n.owner_id=a and n.notification_type='flash')<>1
   then raise exception 'same event and same material facts across sites created a duplicate flash'; end if;
  if i=3 and (select count(*) from public.intelligence_notification_outbox n where n.owner_id=a and n.notification_type='flash')<>2
   then raise exception 'material damage update was suppressed'; end if;
  if i>=4 and (select count(*) from public.intelligence_notification_outbox n where n.owner_id=a and n.notification_type='flash')<>3
   then raise exception 'separate event or ineligible fixture changed expected flash count: %',i; end if;
 end loop;

 if (select count(*) from public.intelligence_risk_signals r where r.owner_id=a)<>expected_risks then raise exception 'retry duplicated risk evidence'; end if;
 if exists(select 1 from public.intelligence_candidates c where c.owner_id=a) then raise exception 'facility risk fabricated an energy candidate'; end if;
 if (select s.extraction_zh->'classification'->>'disposition' from public.intelligence_sources s where s.id=first_source)<>'source_only'
  then raise exception 'risk saving rewrote original energy classification'; end if;
 if public.save_intelligence_risk_signal(b,first_source,lpad(to_hex(1),64,'0'),payload) is not null then raise exception 'another owner accessed the original source'; end if;
 if exists(select 1 from public.intelligence_notification_outbox n where n.owner_id=a and (n.status<>'pending' or n.attempts<>0))
  then raise exception 'SQL acceptance attempted real notification delivery'; end if;

 if not has_table_privilege('service_role','public.intelligence_risk_signals','SELECT')
  or not has_function_privilege('service_role','public.save_intelligence_risk_signal(uuid,uuid,text,jsonb)','EXECUTE')
  or has_table_privilege('anon','public.intelligence_risk_signals','SELECT')
  or has_table_privilege('authenticated','public.intelligence_risk_signals','INSERT')
  or has_function_privilege('anon','public.save_intelligence_risk_signal(uuid,uuid,text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.save_intelligence_risk_signal(uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception 'risk table/RPC role permissions incorrect'; end if;
 if not (select relrowsecurity from pg_class where oid='public.intelligence_risk_signals'::regclass) then raise exception 'risk RLS disabled'; end if;
 reset role;
 set local role authenticated;
 begin
  perform 1 from public.intelligence_risk_signals;
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'authenticated role read private risk table directly'; end if;
 denied:=false;
 begin
  perform public.save_intelligence_risk_signal(a,first_source,lpad(to_hex(1),64,'0'),payload);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'authenticated role invoked risk RPC directly'; end if;
 reset role;
end $$;
rollback;
