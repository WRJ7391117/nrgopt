-- Isolated database only. Fixture rows roll back.
begin;
do $$
declare owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  run_id uuid; old_run uuid; work record; n integer;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  old_run := public.enqueue_intelligence_job(owner_a,'daily_scan','2000-01-01',array['registry:old']);
  update public.intelligence_job_runs set created_at = now() - interval '1 day' where id = old_run;
  update public.intelligence_job_items set status = 'manual_paused', error_code = 'source_paused',
    checkpoint = '{"source_host":"acwapower.com"}' where job_run_id = old_run;
  perform public.refresh_intelligence_job(owner_a,old_run);
  run_id := public.enqueue_intelligence_job(owner_a,'daily_scan','2000-01-02',array['registry:a','registry:b']);
  perform public.set_intelligence_source_control(owner_a,'acwapower.com',true);
  if exists(select 1 from public.intelligence_source_controls where owner_id = owner_b) then raise exception 'owner leak'; end if;
  select * into work from public.claim_intelligence_job_item_v2(owner_a,run_id);
  if not public.finish_intelligence_job_item_v2(owner_a,work.id,'manual_paused','{"source_host":"acwapower.com"}','source_paused',work.attempts) then raise exception 'pause failed'; end if;
  if (select status from public.intelligence_job_runs where id = run_id) <> 'running' then raise exception 'publisher pause blocked other work'; end if;
  select * into work from public.claim_intelligence_job_item_v2(owner_a,run_id);
  if work.item_key <> 'registry:b' then raise exception 'other publisher not claimable'; end if;
  perform public.finish_intelligence_job_item_v2(owner_a,work.id,'succeeded','{}',null,work.attempts);
  if (select status from public.intelligence_job_runs where id = run_id) <> 'partial' then raise exception 'paused coverage reported complete'; end if;
  n := public.set_intelligence_source_control(owner_b,'acwapower.com',false);
  if n <> 0 then raise exception 'cross owner resume'; end if;
  n := public.set_intelligence_source_control(owner_a,'acwapower.com',false);
  if n <> 1 then raise exception 'current pause not resumed'; end if;
  if (select status from public.intelligence_job_runs where id = old_run) <> 'partial' then raise exception 'historical run reopened'; end if;
  if public.set_intelligence_source_control(owner_a,'acwapower.com',false) <> 0 then raise exception 'duplicate resume'; end if;
  select * into work from public.claim_intelligence_job_item_v2(owner_a,run_id);
  if work.attempts <> 1 or work.item_key <> 'registry:a' then raise exception 'pause consumed retry budget'; end if;
  perform public.finish_intelligence_job_item_v2(owner_a,work.id,'manual_paused','{"source_host":"acwapower.com"}','source_paused',work.attempts);
  update public.intelligence_job_runs set status = 'manual_paused' where id = run_id;
  perform public.set_intelligence_source_control(owner_a,'acwapower.com',false);
  if (select status from public.intelligence_job_runs where id = run_id) <> 'manual_paused' then raise exception 'global manual pause overridden'; end if;
  if has_table_privilege('anon','public.intelligence_source_controls','select')
    or has_table_privilege('authenticated','public.intelligence_source_controls','insert')
    or has_function_privilege('anon','public.set_intelligence_source_control(uuid,text,boolean)','execute')
    or has_function_privilege('authenticated','public.set_intelligence_source_control(uuid,text,boolean)','execute') then raise exception 'public access'; end if;
end $$;
rollback;
