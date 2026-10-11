-- Isolated PostgreSQL acceptance after migrations 054/055. All synthetic rows and notices roll back.
begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); large_owner uuid:=gen_random_uuid(); accepted_owner uuid:=gen_random_uuid(); mixed_owner uuid:=gen_random_uuid();
 day date:=(now() at time zone 'Asia/Shanghai')::date; report_at timestamptz;
 fixture_source uuid; fixture_candidate uuid; raw_hash text; risk_payload jsonb; risk_signal jsonb; extraction jsonb;
 job uuid; notice uuid; previous_notice uuid; accepted_flash uuid; risk_id uuid; first_known_risk uuid; cross_site_risk uuid; pending_risk uuid; pending_copy uuid; outside_risk uuid;
 historical_source uuid; other_source uuid; low_source uuid; critical_source uuid; outside_commercial uuid; historical_risk uuid;
 snapshot jsonb; original_payload jsonb; i integer; denied boolean:=false; before_count integer;
begin
 report_at:=(day::text||' 08:00:00+08')::timestamptz;
 insert into auth.users(id) values(a),(b),(large_owner),(accepted_owner),(mixed_owner);
 set local role service_role;
 insert into public.intelligence_collection_directions(owner_id,config,effective_on)
 values(a,'{"name":"设施风险观察","why":"关注设施运行","countries":["SA"],"targets":["signal"],"industries":"交通","exclude":"","priority":"high","enabled":true}',day),
  (large_owner,'{"name":"设施风险观察","why":"关注设施运行","countries":["SA"],"targets":["signal"],"industries":"交通","exclude":"","priority":"high","enabled":true}',day);
 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
 select id,owner_id,revision,config,effective_on from public.intelligence_collection_directions where owner_id in(a,large_owner);
 -- A saved expansion is effective tomorrow; QA cannot enter today's report.
 update public.intelligence_collection_directions set config=jsonb_set(config,'{countries}','["SA","QA"]'),revision=2,effective_on=day+1 where owner_id=a;
 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
 select id,owner_id,revision,config,effective_on from public.intelligence_collection_directions where owner_id=a;
 job:=public.enqueue_intelligence_job(a,'daily_scan',day::text,array['fixture:ok','fixture:failed','fixture:paused','fixture:queued','fixture:running']);
 update public.intelligence_job_runs set status='running' where id=job;
 update public.intelligence_job_items set status=case item_key when 'fixture:ok' then 'succeeded' when 'fixture:failed' then 'failed'
  when 'fixture:paused' then 'budget_paused' when 'fixture:running' then 'running' else 'queued' end where job_run_id=job;

 -- Old high-importance evidence, recent priorities, and a foreign-owner candidate.
 for i in 1..7 loop
  fixture_source:=gen_random_uuid(); fixture_candidate:=gen_random_uuid(); raw_hash:=lpad(to_hex(i),64,'0');
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
   extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
  values(fixture_source,case when i=6 then b else a end,'https://snapshot-'||i||'.invalid/news','https://snapshot-'||i||'.invalid/news',
   'pending_extraction',raw_hash,'fixture-snapshot/'||i,'extracted',raw_hash,
   jsonb_build_object('known_facts',jsonb_build_array(jsonb_build_object('claim_zh','合成已保存事实'||i,'evidence_quote','Fixture original evidence '||i))),
   now(),case when i=1 then day-60 when i=4 then day-20 else day-1 end);
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,occurrence_countries,
   importance,evidence_status,maturity,urgency,source_sha256,review_status)
  values(fixture_candidate,case when i=6 then b else a end,fixture_source,'合成情报'||i,'合成来源摘要'||i,'candidate',array['project'],case when i=7 then array['QA'] else array['SA'] end,
   case when i in(1,2,6,7) then 'critical' when i=3 then 'high' when i=4 then 'medium' else 'low' end,
   'sourced','project','research',raw_hash,'auto_validated');
  if i=1 then historical_source:=fixture_source; end if;
  if i=2 then critical_source:=fixture_source; end if;
  if i=5 then low_source:=fixture_source; end if;
  if i=6 then other_source:=fixture_source; end if;
  if i=7 then outside_commercial:=fixture_source; end if;
 end loop;

 -- Two sites repeat one event; an unknown-date statement remains a digest lead; QA is outside selected countries.
 for i in 1..6 loop
  fixture_source:=gen_random_uuid(); raw_hash:=lpad(to_hex(i+20),64,'0');
  risk_signal:=jsonb_build_object('event_type','attack','facility_zh',case when i in(3,6) then '合成待核实机场' else '合成国际机场' end,
   'facility_name','Fixture Airport','country_code',case when i=4 then 'QA' else 'SA' end,
   'event_date',case when i in(3,6) then null when i=5 then day-60 else day-1 end,
   'event_status',case when i in(3,6) then 'statement_only' else 'reported_event' end,'severity','high','impact_status','unknown',
   'fact_numbers',jsonb_build_array(1),'date_fact_number',case when i in(3,6) then null else 1 end);
  extraction:=jsonb_build_object('classification',jsonb_build_object('disposition','source_only','energy_scope','none','radars','[]'::jsonb),
   'known_facts',jsonb_build_array(jsonb_build_object('claim_zh','合成媒体报道设施风险，能源影响尚未披露。',
    'statement_type','report','attribution_zh','合成媒体','evidence_quote','Fixture Airport was attacked; its operation remains unconfirmed.')),
   'risk_signal',risk_signal);
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
   extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
  values(fixture_source,a,'https://snapshot-risk-'||i||'.invalid/news','https://snapshot-risk-'||i||'.invalid/news',
   'pending_extraction',raw_hash,'fixture-snapshot-risk/'||i,'extracted',raw_hash,extraction,now(),day-1);
  risk_payload:=risk_signal||jsonb_build_object('status',case when i in(3,6) then 'pending_verification' when i=5 then 'historical' else 'reported' end,
   'notification_eligible',false,'event_key',case when i in(1,2) then repeat('a',64) when i in(3,6) then null else lpad(to_hex(i),64,'d') end,
   'fact_fingerprint',case when i in(1,2) then repeat('b',64) when i in(3,6) then lpad(to_hex(3),64,'e') else lpad(to_hex(i),64,'e') end,'title_zh','合成机场风险'||i,
   'publication_date',day-1,'facts',jsonb_build_array('合成媒体报道设施风险。'),
   'unknowns_zh',jsonb_build_array('事件经过与能源影响待核实。'),'next_signals_zh',jsonb_build_array('核对运营方通报。'));
  risk_id:=public.save_intelligence_risk_signal(a,fixture_source,raw_hash,risk_payload);
  if risk_id is null then raise exception 'valid synthetic risk rejected: %',i; end if;
  if i=1 then first_known_risk:=risk_id; end if;
  if i=2 then cross_site_risk:=risk_id; update public.intelligence_risk_signals set updated_at=now()+interval '1 second' where id=risk_id; end if;
  if i=3 then pending_risk:=risk_id; end if;
  if i=4 then outside_risk:=risk_id; end if;
  if i=5 then historical_risk:=risk_id; end if;
  if i=6 then pending_copy:=risk_id; end if;
 end loop;
 insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,status,payload,accepted_at,attempts)
 values(a,'flash','flash:fixture-risk-accepted','accepted','{"kind":"risk","title_zh":"合成已发送风险"}',report_at-interval '1 hour',1) returning id into accepted_flash;
 update public.intelligence_risk_signals set flash_notification_id=accepted_flash where id=cross_site_risk;
 if (select flash_notification_id from public.intelligence_risk_signals where id=pending_risk) is not null
  then raise exception 'unknown-date statement became a flash'; end if;
 if public.enqueue_intelligence_daily_snapshot(a,day,report_at-interval '1 second',8) is not null
  or exists(select 1 from public.intelligence_notification_outbox where owner_id=a and notification_type='daily')
  then raise exception 'daily snapshot queued before 08:00'; end if;
 notice:=public.enqueue_intelligence_daily_snapshot(a,day,report_at,8);
 if notice is null then raise exception '08:00 snapshot waited for unfinished run'; end if;
 select payload into snapshot from public.intelligence_notification_outbox where id=notice;
 if snapshot->>'status'<>'running' or (snapshot->'coverage'->>'total')::integer<>5
  or (snapshot->'coverage'->>'succeeded')::integer<>1 or (snapshot->'coverage'->>'failed')::integer<>1
  or (snapshot->'coverage'->>'paused')::integer<>1 or (snapshot->'coverage'->>'unfinished')::integer<>2
  then raise exception 'unfinished task coverage misreported: %',snapshot->'coverage'; end if;
 if snapshot->>'report_date'<>day::text or snapshot->>'active_plan_day'<>day::text
  or (snapshot->>'snapshot_at')::timestamptz is distinct from report_at
  then raise exception 'report date, active plan date or captured snapshot time changed'; end if;
 if jsonb_array_length(snapshot->'changes')<>5 or (snapshot->>'remaining_changes')::integer<>1
  then raise exception 'digest selection/remaining counts incorrect: %',snapshot; end if;
 if snapshot->'changes'->0->>'kind'<>'risk' or (snapshot->'changes'->0->>'flash_accepted')::boolean is distinct from true
  or snapshot->'changes'->1->>'source_id'<>critical_source::text
  then raise exception 'recent important risk/evidence did not lead'; end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'changes') c where c->>'source_id' in(historical_source::text,other_source::text,low_source::text,outside_commercial::text))
  then raise exception 'historical, foreign-owner or lower-priority evidence displaced top five'; end if;
 if (select count(*) from jsonb_array_elements(snapshot->'changes') c where c->>'kind'='risk')<>2
  or (select digest_notification_id from public.intelligence_risk_signals where id=cross_site_risk) is distinct from notice
  or (select digest_notification_id from public.intelligence_risk_signals where id=first_known_risk) is distinct from notice
  or (select digest_notification_id from public.intelligence_risk_signals where id=pending_risk) is distinct from notice
  or (select digest_notification_id from public.intelligence_risk_signals where id=pending_copy) is distinct from notice
  then raise exception 'cross-site incident was duplicated or pending lead omitted'; end if;
 if exists(select 1 from public.intelligence_risk_signals where id in(outside_risk,historical_risk) and digest_notification_id is not null)
  then raise exception 'outside selected country or historical risk entered digest'; end if;
 if public.enqueue_intelligence_daily_snapshot(a,day,report_at+interval '1 hour',8) is distinct from notice
  or (select count(*) from public.intelligence_notification_outbox where owner_id=a and notification_type='daily')<>1
  then raise exception 'same reporting day created another snapshot'; end if;
 if exists(select 1 from public.intelligence_evidence_changes where source_id in(historical_source,low_source,outside_commercial) and digest_notification_id is not null)
  then raise exception 'unselected evidence was consumed'; end if;

 -- A next-day reprint with the same event and material fingerprint stays unconsumed and is not re-announced.
 fixture_source:=gen_random_uuid(); raw_hash:=repeat('f',64);
 select s.extraction_zh into extraction from public.intelligence_sources s join public.intelligence_risk_signals r on r.source_id=s.id where r.id=first_known_risk;
 insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
  extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
 values(fixture_source,a,'https://next-day-reprint.invalid/news','https://next-day-reprint.invalid/news',
  'pending_extraction',raw_hash,'fixture-next-day-reprint','extracted',raw_hash,extraction,now(),day);
 select payload-'source_id'-'source_sha256' into risk_payload from public.intelligence_risk_signals where id=first_known_risk;
 risk_id:=public.save_intelligence_risk_signal(a,fixture_source,raw_hash,risk_payload);
 notice:=public.enqueue_intelligence_daily_snapshot(a,day+1,report_at+interval '1 day',8);
 select payload into snapshot from public.intelligence_notification_outbox where id=notice;
 if risk_id is null or (select digest_notification_id from public.intelligence_risk_signals where id=risk_id) is not null
  or exists(select 1 from jsonb_array_elements(snapshot->'changes') c where c->>'source_id'=fixture_source::text)
  then raise exception 'next-day identical event/fingerprint was re-announced'; end if;

 notice:=public.enqueue_intelligence_daily_snapshot(b,day,report_at,8);
 select payload into snapshot from public.intelligence_notification_outbox where id=notice;
 if jsonb_array_length(snapshot->'changes')<>1 or snapshot->'changes'->0->>'source_id'<>other_source::text
  or exists(select 1 from public.intelligence_risk_signals where owner_id=b)
  then raise exception 'owner isolation failed'; end if;

 original_payload:='{"schedule_key":"2000-01-01","status":"completed","changes":[{"title_zh":"历史已发送摘要"}]}'::jsonb;
 insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,status,payload,accepted_at,attempts)
 values(accepted_owner,'daily','daily:2000-01-01','accepted',original_payload,report_at-interval '1 hour',1)
 returning id into previous_notice;
 if public.enqueue_intelligence_daily_snapshot(accepted_owner,day,report_at,8) is distinct from previous_notice
  or (select count(*) from public.intelligence_notification_outbox where owner_id=accepted_owner and notification_type='daily')<>1
  or (select payload from public.intelligence_notification_outbox where id=previous_notice) is distinct from original_payload
  then raise exception 'today accepted historical digest was duplicated or rewritten'; end if;

 if not has_function_privilege('service_role','public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer)','EXECUTE')
  or has_function_privilege('anon','public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer)','EXECUTE')
  or has_function_privilege('authenticated','public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer)','EXECUTE')
  or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
   where p.oid='public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE')
  then raise exception 'daily snapshot RPC exposes public execution'; end if;
 reset role;
 set local role authenticated;
 begin
  perform public.enqueue_intelligence_daily_snapshot(a,day,report_at,8);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'authenticated user directly invoked snapshot RPC'; end if;
 reset role;
 set local role service_role;
 raise notice 'snapshot timing, ranking, scope, owner, idempotency, accepted-history and permission checks passed';

 -- One original may support a commercial classification and a risk without appearing twice in the same report.
 fixture_source:=gen_random_uuid(); fixture_candidate:=gen_random_uuid(); raw_hash:=repeat('d',64);
 insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
  extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
 values(fixture_source,mixed_owner,'https://mixed-risk.invalid/news','https://mixed-risk.invalid/news',
  'pending_extraction',raw_hash,'fixture-mixed-risk','extracted',raw_hash,
  '{"known_facts":[{"claim_zh":"设施风险与电网变化","evidence_quote":"Fixture facility damage and grid change."}],"risk_signal":{"event_status":"statement_only"}}',now(),day-1);
 insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,occurrence_countries,
  importance,evidence_status,maturity,urgency,source_sha256,review_status)
 values(fixture_candidate,mixed_owner,fixture_source,'合成风险与电网变化','来源同时披露设施与能源线索','candidate',array['trigger'],array['SA'],
  'critical','sourced','signal','research',raw_hash,'auto_validated');
 risk_payload:=jsonb_build_object('status','pending_verification','notification_eligible',false,'event_key',null,'fact_fingerprint',repeat('c',64),
  'event_type','attack','facility_zh','合成混合设施','country_code','SA','event_date',null,'publication_date',day-1,
  'title_zh','合成设施风险','facts',jsonb_build_array('设施风险与电网变化'),'unknowns_zh',jsonb_build_array('日期与影响待核'),
  'next_signals_zh',jsonb_build_array('核对运营方通报'));
 risk_id:=public.save_intelligence_risk_signal(mixed_owner,fixture_source,raw_hash,risk_payload);
 notice:=public.enqueue_intelligence_daily_snapshot(mixed_owner,day,report_at,8);
 select payload into snapshot from public.intelligence_notification_outbox where id=notice;
 if risk_id is null or jsonb_array_length(snapshot->'changes')<>1 or snapshot->'changes'->0->>'kind'<>'risk'
  or (select digest_notification_id from public.intelligence_risk_signals where id=risk_id) is distinct from notice
  or not exists(select 1 from public.intelligence_evidence_changes where owner_id=mixed_owner and source_id=fixture_source and digest_notification_id=notice)
  then raise exception 'same original risk/business duplicated or one cursor stayed unconsumed'; end if;
 raise notice 'same-original risk/commercial summary and both cursors passed';

 -- Five long four-byte Unicode risk entries fit one 20KB notification; a sixth remains unconsumed.
 for i in 1..6 loop
  fixture_source:=gen_random_uuid(); raw_hash:=lpad(to_hex(i+60),64,'0');
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
   extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
  values(fixture_source,large_owner,'https://long-risk-'||i||'.invalid/news','https://long-risk-'||i||'.invalid/news',
   'pending_extraction',raw_hash,'fixture-long-risk/'||i,'extracted',raw_hash,
   '{"known_facts":[{"claim_zh":"合成设施线索","evidence_quote":"Fixture report only."}],"risk_signal":{"event_status":"statement_only"}}',now(),day-1);
  risk_payload:=jsonb_build_object('status','pending_verification','notification_eligible',false,'event_key',lpad(to_hex(i+60),64,'c'),
   'fact_fingerprint',lpad(to_hex(i+60),64,'b'),'event_type','attack','facility_zh',repeat('𠮷',150),'country_code','SA',
   'event_date',null,'publication_date',day-1,'title_zh',repeat('🚨',150),'energy_impact_zh',repeat('🚨',1200),
   'facts',jsonb_build_array(repeat('𠮷',650)),'unknowns_zh',jsonb_build_array(repeat('🚨',550)),
   'next_signals_zh',jsonb_build_array(repeat('𠮷',550)));
  risk_id:=public.save_intelligence_risk_signal(large_owner,fixture_source,raw_hash,risk_payload);
  if risk_id is null then raise exception 'long valid risk fixture rejected: % (% bytes)',i,octet_length(risk_payload::text); end if;
 end loop;
 select count(*) into before_count from public.intelligence_notification_outbox where owner_id=large_owner;
 notice:=public.enqueue_intelligence_daily_snapshot(large_owner,day,report_at,8);
 select payload into snapshot from public.intelligence_notification_outbox where id=notice;
 if notice is null or octet_length(snapshot::text)>20000 or jsonb_array_length(snapshot->'changes')<>5
  or (snapshot->>'remaining_changes')::integer<>1 then raise exception 'long risk snapshot exceeds queue limit or loses count'; end if;
 if (select count(*) from public.intelligence_notification_outbox where owner_id=large_owner)<>before_count+1
  or exists(select 1 from public.intelligence_notification_outbox where owner_id in(a,b,large_owner,mixed_owner) and id<>accepted_flash and (status<>'pending' or attempts<>0))
  then raise exception 'SQL acceptance unexpectedly claimed or delivered a notification'; end if;
 raise notice 'five long four-byte Unicode risk entries fit % bytes; one extra remains pending',octet_length(snapshot::text);
 reset role;
end $$;
rollback;
