-- Isolated database only. No fixture or clock changes survive this transaction.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); d jsonb; revised jsonb; plan jsonb; run_id uuid; legacy_id uuid;
 cfg jsonb:='{"name":"地区冲突与能源保供","why":"关注供电是否中断","industries":"医院","exclude":"一般评论","countries":["SA"],"targets":["signal"],"priority":"high","enabled":true}';
 today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 insert into auth.users(id) values(a),(b);
 d:=public.save_intelligence_collection_direction(a,null,0,cfg);
 if d->>'id' is null or (d->>'effective_on')::date<>today+1 then raise exception 'save or next Beijing date failed'; end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(a,today))<>0 then raise exception 'applied too early';end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(a,today+1))<>1 then raise exception 'missing tomorrow config';end if;
 if public.save_intelligence_collection_direction(b,(d->>'id')::uuid,1,cfg)->>'error'<>'not_found' then raise exception 'owner isolation';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+1)::text) returning id into run_id;
 plan:=public.snapshot_intelligence_collection_directions(a,run_id);
 revised:=public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,jsonb_set(cfg,'{enabled}','false'));
 if (revised->>'revision')::integer<>2 then raise exception 'version did not advance';end if;
 if public.snapshot_intelligence_collection_directions(a,run_id)<>plan then raise exception 'inflight plan changed';end if;
 if public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,cfg)->>'error'<>'direction_conflict' then raise exception 'stale update accepted';end if;
 if (public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,jsonb_set(cfg,'{enabled}','false'))->>'revision')::integer<>2 then raise exception 'retry not idempotent';end if;
 if (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>2 then raise exception 'history missing or duplicated';end if;
 legacy_id:=public.enqueue_intelligence_job(a,'daily_scan',today::text,array['discover:SA']);
 if public.snapshot_intelligence_collection_directions(a,legacy_id) is not null then raise exception 'legacy run retrofitted';end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(b,today+1))<>0 then raise exception 'cross-owner read';end if;
 if has_function_privilege('authenticated','public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb)','EXECUTE') then raise exception 'direct authenticated write allowed';end if;
 if has_table_privilege('anon','public.intelligence_collection_directions','SELECT') then raise exception 'anonymous table exposed';end if;
end $$;

-- Saving one direction must not renumber the existing five; additions follow them.
do $$
declare a uuid:=gen_random_uuid(); cfg jsonb; saved jsonb; before_order jsonb; after_order jsonb; second_id uuid; n integer;
begin
 insert into auth.users(id) values(a);
 cfg:='{"name":"方向","why":"关注明确供能变化","industries":"能源","exclude":"","countries":["SA"],"targets":["signal"],"priority":"normal","enabled":true,"topic_codes":[]}'::jsonb;
 for n in 1..5 loop
   saved:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{name}',to_jsonb(n::text||'号方向')));
   if (saved->>'position')::integer is distinct from n then raise exception 'direction did not append stable ordinal';end if;
   if n=2 then second_id:=(saved->>'id')::uuid;end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',id,'position',position) order by position,id) into before_order
 from public.intelligence_collection_directions where owner_id=a;
 saved:=public.save_intelligence_collection_direction(a,second_id,1,jsonb_set(cfg,'{name}','"2号方向已修改"'));
 if saved->>'revision' is distinct from '2' or saved->>'position' is distinct from '2' then raise exception 'save changed ordinal or failed';end if;
 select jsonb_agg(jsonb_build_object('id',id,'position',position) order by position,id) into after_order
 from public.intelligence_collection_directions where owner_id=a;
 if after_order is distinct from before_order then raise exception 'saving the second direction renumbered the original five';end if;
 saved:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{name}','"新增第六方向"'));
 if saved->>'position' is distinct from '6' then raise exception 'new direction did not append after existing five';end if;
end $$;

-- Topic links reuse one owner catalog; a natural plan freezes both settings and definitions.
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); linked jsonb; second jsonb; legacy jsonb;
 code_a text:='custom-'||gen_random_uuid()::text; code_b text:='custom-'||gen_random_uuid()::text;
 code_missing text:='custom-'||gen_random_uuid()::text; result jsonb; snapshot jsonb; after_change jsonb; item jsonb;
 run_id uuid; next_run uuid; old_run uuid; old_work uuid; denied boolean:=false;
 today date:=(now() at time zone 'Asia/Shanghai')::date;
 cfg jsonb:='{"name":"跨境能源运输","why":"关注跨境供能变化","industries":"能源运输","exclude":"","countries":["SA","QA"],"targets":["signal"],"priority":"normal","enabled":true}';
begin
 insert into auth.users(id) values(a),(b);
 perform public.save_intelligence_topic(a,code_a,0,'跨境电网','本轮冻结的跨国输电范围',true);
 perform public.save_intelligence_topic(b,code_b,0,'其他用户专题','不能被当前用户关联',true);
 legacy:=public.save_intelligence_collection_direction(a,null,0,cfg);
 if legacy->'config'->'topic_codes' is distinct from '[]'::jsonb then raise exception 'old direction config not normalized';end if;
 cfg:=cfg||jsonb_build_object('topic_codes',jsonb_build_array('red-sea',code_a));
 linked:=public.save_intelligence_collection_direction(a,null,0,cfg);
 second:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{name}','"第二个搜集方向"'));
 if linked->>'id' is null or second->>'id' is null or linked->'config'->'topic_codes' is distinct from second->'config'->'topic_codes'
 then raise exception 'one topic cannot be reused across directions';end if;
 if public.save_intelligence_collection_direction(b,(linked->>'id')::uuid,1,cfg)->>'error' is distinct from 'not_found' then raise exception 'direction owner bypass';end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(
   jsonb_build_array(code_b),jsonb_build_array(code_missing),jsonb_build_array('SA'),jsonb_build_array('red-sea','red-sea'),
   'null'::jsonb,'"red-sea"'::jsonb,jsonb_build_array(4))) loop
   result:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{topic_codes}',item));
   if result->>'error' is distinct from 'invalid_request' then raise exception 'invalid or cross-owner topic accepted: %',item;end if;
 end loop;
 perform public.save_intelligence_topic(a,'suez',0,'苏伊士','停用的航运专题',false);
 if public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{topic_codes}','["suez"]'))->>'error' is distinct from 'invalid_request'
 then raise exception 'new inactive topic association accepted';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+1)::text) returning id into run_id;
 snapshot:=public.intelligence_collection_search_plan(a,run_id);
 if snapshot->>'legacy' is distinct from 'false' or jsonb_array_length(snapshot->'directions')<>3 then raise exception 'new direction snapshot missing';end if;
 if not exists(select 1 from jsonb_array_elements(snapshot->'topics') t where t->>'code'=code_a and t->>'name'='跨境电网' and t->>'revision'='1')
 or exists(select 1 from jsonb_array_elements(snapshot->'topics') t where t->>'code' in(code_b,'suez'))
 then raise exception 'snapshot lost owned active definition or included foreign/stopped topic';end if;
 perform public.save_intelligence_topic(a,code_a,1,'后续轮次新名称','后续轮次的新范围',false);
 result:=public.save_intelligence_collection_direction(a,(linked->>'id')::uuid,1,jsonb_set(cfg,'{why}','"保留已关联的停用专题并修改关注理由"'));
 if result->>'revision' is distinct from '2' then raise exception 'existing stopped association cannot be retained';end if;
 if public.save_intelligence_collection_direction(a,null,0,cfg)->>'error' is distinct from 'invalid_request' then raise exception 'stopped topic added to new direction';end if;
 if public.save_intelligence_collection_direction(a,(linked->>'id')::uuid,1,cfg)->>'error' is distinct from 'direction_conflict' then raise exception 'stale linked direction overwrote changes';end if;
 after_change:=public.intelligence_collection_search_plan(a,run_id);
 if after_change is distinct from snapshot then raise exception 'inflight direction or definition snapshot drifted';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+2)::text) returning id into next_run;
 after_change:=public.intelligence_collection_search_plan(a,next_run);
 if exists(select 1 from jsonb_array_elements(after_change->'topics') t where t->>'code'=code_a) then raise exception 'next run searched stopped topic';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key,collection_directions)
 values(a,'daily_scan',(today+3)::text,snapshot->'directions') returning id into old_run;
 result:=public.intelligence_collection_search_plan(a,old_run);
 if result->>'legacy' is distinct from 'true' or result->'topics' is distinct from 'null'::jsonb
 or result->'directions' is distinct from snapshot->'directions' then raise exception 'preupgrade frozen run was retrofitted';end if;
 old_work:=public.enqueue_intelligence_job(a,'daily_scan',(today+4)::text,array['discover:SA']);
 result:=public.intelligence_collection_search_plan(a,old_work);
 if result->'directions' is distinct from 'null'::jsonb or result->'topics' is distinct from 'null'::jsonb or result->>'legacy' is distinct from 'true'
 then raise exception 'preupgrade existing work was retrofitted';end if;
 begin
   perform public.intelligence_collection_search_plan(b,run_id);
 exception when raise_exception then
   if sqlerrm<>'not_found' then raise;end if;
   denied:=true;
 end;
 if not denied then raise exception 'another owner read private frozen definitions';end if;
 if has_function_privilege('authenticated','public.intelligence_collection_search_plan(uuid,uuid)','EXECUTE')
 or has_function_privilege('anon','public.intelligence_direction_query_counts(uuid,date)','EXECUTE') then raise exception 'new private RPC exposed directly';end if;
end $$;

-- Rotation counts actual query slots: retries count once; queued, budget paused and today do not advance it.
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); direction_id uuid:=gen_random_uuid(); prior_run uuid; current_run uuid; foreign_run uuid;
 today date:=(now() at time zone 'Asia/Shanghai')::date; checkpoint jsonb; result jsonb;
begin
 insert into auth.users(id) values(a),(b);
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today-1)::text) returning id into prior_run;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',today::text) returning id into current_run;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(b,'daily_scan',(today-1)::text) returning id into foreign_run;
 checkpoint:=jsonb_build_object('direction',jsonb_build_object('id',direction_id::text,'revision',1));
 insert into public.intelligence_job_items(owner_id,job_run_id,item_key,status,checkpoint) values
 (a,prior_run,'discover:SA','retry',checkpoint),(a,prior_run,'discover:QA','queued',checkpoint),
 (a,prior_run,'discover:KW','budget_paused',checkpoint),(a,prior_run,'discover:BH','failed',checkpoint),
 (a,prior_run,'source:other','succeeded',checkpoint),(a,current_run,'discover:AE','succeeded',checkpoint),
 (b,foreign_run,'discover:SA','succeeded',checkpoint);
 insert into public.intelligence_budget_reservations(owner_id,job_run_id,operation,currency,idempotency_key,reserved_micro,call_started_at) values
 (a,prior_run,'discovery','CNY',prior_run::text||':discover:SA:1',1,now()),
 (a,prior_run,'discovery','CNY',prior_run::text||':discover:SA:2',1,now()),
 (a,prior_run,'discovery','CNY',prior_run::text||':discover:KW:1',1,null),
 (a,prior_run,'extraction','CNY',prior_run::text||':discover:BH:1',1,now()),
 (a,prior_run,'discovery','CNY',prior_run::text||':source:other:1',1,now()),
 (a,current_run,'discovery','CNY',current_run::text||':discover:AE:1',1,now()),
 (b,foreign_run,'discovery','CNY',foreign_run::text||':discover:SA:1',1,now());
 result:=public.intelligence_direction_query_counts(a,today);
 if result is distinct from jsonb_build_array(jsonb_build_object('direction_id',direction_id::text,'query_count',1))
 then raise exception 'queued/budget/retry/owner/day isolation changed actual query count: %',result;end if;
end $$;
rollback;
