-- Isolated database only. Every fixture and deliberate failure is rolled back.
begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); first jsonb; second jsonb; foreign_row jsonb;
 cfg jsonb:='{"name":"能源保供","why":"判断供能需求","industries":"医院","exclude":"","countries":["SA"],"targets":["signal"],"priority":"normal","enabled":true,"topic_codes":[]}';
 matrix jsonb; result jsonb; current_plan jsonb; future_plan jsonb; frozen_plan jsonb; before_rows jsonb;
 before_versions integer; run_id uuid; today date:=(now() at time zone 'Asia/Shanghai')::date;
 item jsonb; bad jsonb; failed boolean:=false;
begin
 insert into auth.users(id) values(a),(b);
 first:=public.save_intelligence_collection_direction(a,null,0,cfg);
 second:=public.save_intelligence_collection_direction(a,null,0,cfg||'{"name":"能源投资","why":"判断投资计划","industries":"工业","countries":["KZ","UZ"],"targets":["investment"],"enabled":false}');
 foreign_row:=public.save_intelligence_collection_direction(b,null,0,cfg);
 update public.intelligence_collection_directions set effective_on=today-1 where owner_id=a;
 update public.intelligence_collection_direction_versions set effective_on=today-1 where owner_id=a;
 current_plan:=public.intelligence_effective_collection_directions(a,today);
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',today::text) returning id into run_id;
 frozen_plan:=public.intelligence_collection_search_plan(a,run_id);
 cfg:=cfg||'{"why":"统一判断供能与投资需求","industries":"医院、工业","countries":["SA","KZ","UZ"]}';
 matrix:=jsonb_build_array(
   jsonb_build_object('id',first->'id','revision',1,'config',cfg),
   jsonb_build_object('id',second->'id','revision',1,'config',cfg||'{"name":"能源投资","targets":["investment"],"enabled":false}'));
 select jsonb_agg(to_jsonb(d) order by position,id) into before_rows from public.intelligence_collection_directions d where owner_id=a;
 select count(*) into before_versions from public.intelligence_collection_direction_versions where owner_id=a;

 -- Reject malformed JSON and shared-scope differences before any row can be changed.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
   'null'::jsonb,'{}'::jsonb,'[]'::jsonb,
   jsonb_set(matrix,'{1,config,countries}','["SA"]'),
   jsonb_set(matrix,'{1,config,why}','"不同目的说明"'),
   jsonb_set(matrix,'{1,config,industries}','"不同范围"'),
   jsonb_set(matrix,'{1,config,exclude}','"不同排除"'),
   jsonb_set(matrix,'{1,config,priority}','"high"'),
   jsonb_set(matrix,'{1,config,topic_codes}','["suez"]'),
   jsonb_set(matrix,'{1,config,name}','7'),
   jsonb_set(matrix,'{1,config,targets}','[]'),
   jsonb_set(matrix,'{1,config,countries}','["SA",7]'),
   jsonb_set(matrix,'{1,config,targets}','["signal","signal"]'),
   jsonb_set(matrix,'{1,revision}','"1"'),
   jsonb_set(matrix,'{1,revision}','1.5'),
   jsonb_set(matrix,'{1,id}','7'),
   jsonb_set(matrix,'{1,id}','"invalid-uuid"'),
   jsonb_set(matrix,'{1,id}',first->'id'))) loop
   result:=public.save_intelligence_collection_matrix(a,bad);
   if result->>'error' is distinct from 'invalid_request' then raise exception 'malformed/shared matrix accepted: % => %',bad,result;end if;
 end loop;
 if public.save_intelligence_collection_matrix(a,jsonb_build_array(matrix->0))->>'error' is distinct from 'direction_conflict'
 then raise exception 'omission of a disabled direction accepted';end if;
 if public.save_intelligence_collection_matrix(a,jsonb_build_array(matrix->1,matrix->0))->>'error' is distinct from 'direction_conflict'
 then raise exception 'existing ordinals silently changed';end if;
 if public.save_intelligence_collection_matrix(a,jsonb_set(matrix,'{1,id}',foreign_row->'id'))->>'error' is distinct from 'not_found'
 then raise exception 'foreign owner direction accepted';end if;
 if public.save_intelligence_collection_matrix(a,jsonb_set(matrix,'{1,id}',to_jsonb(gen_random_uuid())))->>'error' is distinct from 'not_found'
 then raise exception 'missing supplied direction accepted';end if;
 if public.save_intelligence_collection_matrix(a,jsonb_set(matrix,'{1,revision}','0'))->>'error' is distinct from 'direction_conflict'
 then raise exception 'stale last row accepted';end if;
 if (select jsonb_agg(to_jsonb(d) order by position,id) from public.intelligence_collection_directions d where owner_id=a) is distinct from before_rows
 or (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>before_versions
 then raise exception 'invalid last row partially saved the first row';end if;

 -- Even a database failure after the first write rolls back the entire invocation.
 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
 values((second->>'id')::uuid,a,2,second->'config',today+1);
 begin
   perform public.save_intelligence_collection_matrix(a,matrix);
 exception when unique_violation then failed:=true;
 end;
 if not failed or (select jsonb_agg(to_jsonb(d) order by position,id) from public.intelligence_collection_directions d where owner_id=a) is distinct from before_rows
 or exists(select 1 from public.intelligence_collection_direction_versions where direction_id=(first->>'id')::uuid and revision=2)
 then raise exception 'database error left a partial matrix';end if;
 delete from public.intelligence_collection_direction_versions where direction_id=(second->>'id')::uuid and revision=2;

 result:=public.save_intelligence_collection_matrix(a,matrix);
 if result->'directions'->0->'id' is distinct from first->'id' or result->'directions'->1->'id' is distinct from second->'id'
 or result->'directions'->0->>'position' is distinct from '1' or result->'directions'->1->>'position' is distinct from '2'
 or result->'directions'->1->'config'->>'enabled' is distinct from 'false'
 or result->'directions'->0->>'revision' is distinct from '2' or result->'directions'->1->>'revision' is distinct from '2'
 then raise exception 'matrix did not preserve IDs, order, associations, paused row: %',result;end if;
 if (result->'directions'->0->>'effective_on')::date<>today+1
 or public.intelligence_effective_collection_directions(a,today) is distinct from current_plan
 or public.intelligence_collection_search_plan(a,run_id) is distinct from frozen_plan
 then raise exception 'matrix changed current or frozen plan';end if;
 future_plan:=public.intelligence_effective_collection_directions(a,today+1);
 if exists(select 1 from jsonb_array_elements(future_plan) d where d->'config'->'countries' is distinct from cfg->'countries')
 or jsonb_array_length(future_plan)<>2 then raise exception 'shared scope absent from future plan';end if;
 if (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>before_versions+2
 then raise exception 'matrix revisions missing';end if;

 -- A retry with original revisions, and a save of the returned rows, both remain idempotent.
 result:=public.save_intelligence_collection_matrix(a,matrix);
 if result->'directions'->0->>'revision' is distinct from '2'
 or (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>before_versions+2
 then raise exception 'same request retry duplicated revisions';end if;
 select jsonb_agg(jsonb_build_object('id',d->'id','revision',d->'revision','config',d->'config') order by n)
 into matrix from jsonb_array_elements(result->'directions') with ordinality rows(d,n);
 result:=public.save_intelligence_collection_matrix(a,matrix);
 if result->'directions'->1->>'revision' is distinct from '2'
 or (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>before_versions+2
 then raise exception 'returned matrix save created revisions';end if;
 result:=public.save_intelligence_collection_matrix(a,jsonb_set(matrix,'{1,revision}','0'));
 if result->>'error' is distinct from 'direction_conflict' then raise exception 'two-revision stale payload accepted';end if;

 -- New rows append; existing paused rows are never omitted, replaced or renumbered.
 item:=jsonb_build_object('id',null,'revision',0,'config',cfg||'{"name":"新增采购方向","targets":["procurement"]}');
 result:=public.save_intelligence_collection_matrix(a,matrix||jsonb_build_array(item));
 if result->'directions'->2->>'position' is distinct from '3'
 or result->'directions'->2->>'revision' is distinct from '1'
 or result->'directions'->2->'config'->'targets' is distinct from '["procurement"]'::jsonb
 then raise exception 'new matrix direction did not append: %',result;end if;
 if public.save_intelligence_collection_matrix(a,matrix||jsonb_build_array(item))->>'error' is distinct from 'direction_conflict'
 or (select count(*) from public.intelligence_collection_directions where owner_id=a)<>3
 then raise exception 'retry with unassigned ID duplicated a new direction';end if;
 if has_function_privilege('authenticated','public.save_intelligence_collection_matrix(uuid,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.save_intelligence_collection_matrix(uuid,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.save_intelligence_collection_matrix(uuid,jsonb)','EXECUTE')
 then raise exception 'matrix RPC permissions incorrect';end if;
end $$;

-- Merging a legacy paused/unknown link retains it without activating or searching it.
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); paused_code text:='custom-'||gen_random_uuid()::text;
 foreign_code text:='custom-'||gen_random_uuid()::text; unknown_code text:='custom-'||gen_random_uuid()::text;
 first jsonb; second jsonb; result jsonb; matrix jsonb; plan jsonb; run_id uuid;
 cfg jsonb:='{"name":"运输","why":"观察跨境变化","industries":"能源运输","exclude":"","countries":["SA"],"targets":["signal"],"priority":"normal","enabled":true,"topic_codes":[]}';
 today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 insert into auth.users(id) values(a),(b);
 perform public.save_intelligence_topic(a,paused_code,0,'跨境能源','旧方向关联范围',true);
 perform public.save_intelligence_topic(b,foreign_code,0,'他人专题','不能串用',true);
 first:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{topic_codes}',jsonb_build_array(paused_code)));
 second:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{name}','"另一方向"'));
 perform public.save_intelligence_topic(a,paused_code,1,'跨境能源','暂停但保留关联',false);
 -- A catalog entry may have been removed historically; retain its existing link only.
 update public.intelligence_collection_directions set config=jsonb_set(config,'{topic_codes}',jsonb_build_array(paused_code,unknown_code)) where id=(first->>'id')::uuid;
 update public.intelligence_collection_direction_versions set config=jsonb_set(config,'{topic_codes}',jsonb_build_array(paused_code,unknown_code)) where direction_id=(first->>'id')::uuid;
 cfg:=jsonb_set(cfg,'{topic_codes}',jsonb_build_array(paused_code,unknown_code));
 matrix:=jsonb_build_array(
   jsonb_build_object('id',first->'id','revision',1,'config',cfg),
   jsonb_build_object('id',second->'id','revision',1,'config',jsonb_set(cfg,'{name}','"另一方向"')),
   jsonb_build_object('id',null,'revision',0,'config',jsonb_set(cfg,'{name}','"新增方向"')));
 result:=public.save_intelligence_collection_matrix(a,matrix);
 if result->'directions'->2->'config'->'topic_codes' is distinct from cfg->'topic_codes'
 or (select active from public.intelligence_topics where owner_id=a and intelligence_topics.code=paused_code) is distinct from false
 then raise exception 'paused/unknown union rejected or activated catalog: %',result;end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+1)::text) returning id into run_id;
 plan:=public.intelligence_collection_search_plan(a,run_id);
 if exists(select 1 from jsonb_array_elements(plan->'topics') t where t->>'code' in(paused_code,unknown_code))
 then raise exception 'paused or unknown link entered natural topic definitions';end if;
 select jsonb_agg(jsonb_build_object('id',d->'id','revision',d->'revision','config',jsonb_set(d->'config','{topic_codes}',jsonb_build_array(foreign_code))) order by n)
 into matrix from jsonb_array_elements(result->'directions') with ordinality rows(d,n);
 if public.save_intelligence_collection_matrix(a,matrix)->>'error' is distinct from 'invalid_request'
 then raise exception 'unlinked foreign catalog code accepted';end if;
end $$;

-- The whole-list bound also covers first-time creation; over-limit saves create nothing.
do $$
declare
 a uuid:=gen_random_uuid(); matrix jsonb; result jsonb; cfg jsonb;
begin
 insert into auth.users(id) values(a);
 cfg:='{"name":"搜集方向","why":"识别供能变化","industries":"能源","exclude":"","countries":["SA"],"targets":["signal"],"priority":"normal","enabled":true,"topic_codes":[]}';
 select jsonb_agg(jsonb_build_object('id',null,'revision',0,'config',jsonb_set(cfg,'{name}',to_jsonb('方向'||n::text))) order by n)
 into matrix from generate_series(1,21) n;
 if public.save_intelligence_collection_matrix(a,matrix)->>'error' is distinct from 'direction_limit'
 or exists(select 1 from public.intelligence_collection_directions where owner_id=a)
 then raise exception 'oversized first matrix partially created rows';end if;
 if public.save_intelligence_collection_matrix(null,matrix)->>'error' is distinct from 'invalid_request'
 then raise exception 'missing owner accepted';end if;
 result:=public.save_intelligence_collection_matrix(a,matrix-20);
 if jsonb_array_length(result->'directions') is distinct from 20
 or (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>20
 then raise exception 'valid maximum-size first matrix failed';end if;
end $$;
rollback;
