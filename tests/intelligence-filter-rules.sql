-- Run only on the existing isolated validation database. All fixtures roll back.
-- API validation owns filter_rules shape and shared-scope validation; RPC057
-- preserves the complete JSONB configuration, revisions and frozen plans.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare
 owner uuid:=gen_random_uuid(); today date:=(now() at time zone 'Asia/Shanghai')::date;
 cfg jsonb:='{"name":"搜集方向","why":"判断能源供货与合作需求","industries":"光伏、储能、电网","countries":["SA","UZ"],"targets":["signal","investment","procurement"],"topic_codes":[],"exclude":"奖项与一般公司宣传","priority":"normal","enabled":true}';
 rules jsonb:='{"include":["change","investment","participation"],"include_note":"设施扩建与供能需求的具体变化","focus":["equipment","partner"]}';
 matrix jsonb; response jsonb; saved_rows jsonb; saved_versions jsonb;
 initial_versions integer; current_plan jsonb; frozen_plan jsonb; future_plan jsonb;
 run_id uuid; tomorrow_run uuid; changed_matrix jsonb;
begin
 insert into auth.users(id) values(owner);
 select jsonb_agg(jsonb_build_object('id',null,'revision',0,'config',
   jsonb_set(cfg,'{name}',to_jsonb('方向'||n::text))) order by n)
 into matrix from generate_series(1,5) n;
 response:=public.save_intelligence_collection_matrix(owner,matrix);
 if jsonb_array_length(response->'directions') is distinct from 5 then
   raise exception 'initial five-direction matrix failed: %',response;
 end if;
 -- A legacy day's five settings exist before adding the new common rules.
 update public.intelligence_collection_directions set effective_on=today-1 where owner_id=owner;
 update public.intelligence_collection_direction_versions set effective_on=today-1 where owner_id=owner;
 current_plan:=public.intelligence_effective_collection_directions(owner,today);
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key)
 values(owner,'daily_scan',today::text) returning id into run_id;
 frozen_plan:=public.intelligence_collection_search_plan(owner,run_id);
 select count(*) into initial_versions from public.intelligence_collection_direction_versions where owner_id=owner;

 select jsonb_agg(jsonb_build_object('id',d->'id','revision',d->'revision',
   'config',jsonb_set(d->'config','{filter_rules}',rules)) order by ordinal)
 into matrix from jsonb_array_elements(response->'directions') with ordinality row(d,ordinal);
 response:=public.save_intelligence_collection_matrix(owner,matrix);
 if response ? 'error' or jsonb_array_length(response->'directions') is distinct from 5
   or exists(select 1 from jsonb_array_elements(response->'directions') d
     where d->'config'->'filter_rules' is distinct from rules or d->>'revision' is distinct from '2'
       or d->'config'->>'exclude' is distinct from cfg->>'exclude'
       or (d->>'effective_on')::date is distinct from today+1) then
   raise exception 'RPC lost rules, exclusions, revision or next-day boundary: %',response;
 end if;
 if (select count(*) from public.intelligence_collection_direction_versions where owner_id=owner)<>initial_versions+5
   or exists(select 1 from public.intelligence_collection_direction_versions where owner_id=owner and revision=2
     and config->'filter_rules' is distinct from rules) then
   raise exception 'complete filter rules absent from one of five version records';
 end if;
 if public.intelligence_effective_collection_directions(owner,today) is distinct from current_plan
   or public.intelligence_collection_search_plan(owner,run_id) is distinct from frozen_plan then
   raise exception 'new filter rules retrofitted the current day or frozen search plan';
 end if;
 future_plan:=public.intelligence_effective_collection_directions(owner,today+1);
 if jsonb_array_length(future_plan) is distinct from 5
   or exists(select 1 from jsonb_array_elements(future_plan) d where d->'config'->'filter_rules' is distinct from rules) then
   raise exception 'next-day effective plan lacks common filter rules';
 end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key)
 values(owner,'daily_scan',(today+1)::text) returning id into tomorrow_run;
 if public.intelligence_collection_search_plan(owner,tomorrow_run)->'directions' is distinct from future_plan then
   raise exception 'next-day natural-plan snapshot lost the saved rules';
 end if;

 -- A repeat of the original save and then the returned revisions create nothing.
 response:=public.save_intelligence_collection_matrix(owner,matrix);
 if response ? 'error' or exists(select 1 from jsonb_array_elements(response->'directions') d where d->>'revision' is distinct from '2')
   or (select count(*) from public.intelligence_collection_direction_versions where owner_id=owner)<>initial_versions+5 then
   raise exception 'same filter-rule request duplicated revisions: %',response;
 end if;
 select jsonb_agg(jsonb_build_object('id',d->'id','revision',d->'revision','config',d->'config') order by ordinal)
 into matrix from jsonb_array_elements(response->'directions') with ordinality row(d,ordinal);
 response:=public.save_intelligence_collection_matrix(owner,matrix);
 if response ? 'error' or (select count(*) from public.intelligence_collection_direction_versions where owner_id=owner)<>initial_versions+5 then
   raise exception 'returned filter-rule matrix created redundant versions';
 end if;

 -- A conflict in the last row must not partially save new rules into earlier rows.
 select jsonb_agg(to_jsonb(d) order by position,id) into saved_rows
 from public.intelligence_collection_directions d where owner_id=owner;
 select jsonb_agg(to_jsonb(v) order by direction_id,revision) into saved_versions
 from public.intelligence_collection_direction_versions v where owner_id=owner;
 select jsonb_agg(jsonb_set(d,'{config,filter_rules,include_note}','"只关注新公开需求"') order by ordinal)
 into changed_matrix from jsonb_array_elements(matrix) with ordinality row(d,ordinal);
 response:=public.save_intelligence_collection_matrix(owner,jsonb_set(changed_matrix,'{4,revision}','1'));
 if response->>'error' is distinct from 'direction_conflict' then
   raise exception 'stale final row accepted changed filter rules: %',response;
 end if;
 if (select jsonb_agg(to_jsonb(d) order by position,id) from public.intelligence_collection_directions d where owner_id=owner) is distinct from saved_rows
   or (select jsonb_agg(to_jsonb(v) order by direction_id,revision) from public.intelligence_collection_direction_versions v where owner_id=owner) is distinct from saved_versions
   or public.intelligence_collection_search_plan(owner,run_id) is distinct from frozen_plan
   or public.intelligence_collection_search_plan(owner,tomorrow_run)->'directions' is distinct from future_plan then
   raise exception 'conflict partially changed rules, versions or frozen plans';
 end if;
end $$;
rollback;
