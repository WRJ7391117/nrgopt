-- Isolated PostgreSQL fixtures; no provider calls and all rows roll back.
begin;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); owner_c uuid := gen_random_uuid(); owner_d uuid := gen_random_uuid();
  source_id uuid; candidate_id uuid; source_url text; importance text; age integer;
  old_job uuid; today_job uuid; cap_job uuid; claimed record; n integer; first_url text;
  today text := (now() at time zone 'Asia/Shanghai')::date::text;
begin
  insert into auth.users(id) values(owner_a),(owner_b),(owner_c),(owner_d);
  for n in 1..7 loop
    source_id := gen_random_uuid(); candidate_id := gen_random_uuid(); source_url := 'https://timeliness.invalid/cadence-' || n;
    importance := case n when 1 then 'high' when 2 then 'medium' when 3 then 'low' when 4 then 'medium' when 5 then 'low' else 'low' end;
    age := case n when 1 then 1 when 2 then 7 when 3 then 30 when 4 then 6 when 5 then 29 else 1 end;
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
      values(source_id,owner_a,source_url,source_url,'pending_extraction',repeat('a',64),'fixture/timeliness');
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,evidence_status,maturity,urgency,source_sha256,review_status)
      values(candidate_id,owner_a,source_id,'测试','测试','candidate',importance,'sourced','project','research',repeat('a',64),'auto_validated');
    insert into public.intelligence_watch_targets(owner_id,candidate_id,signal_zh,created_at)
      values(owner_a,candidate_id,'等待新证据',now() - make_interval(days => age));
    if n in (6,7) then
      insert into public.intelligence_watch_targets(owner_id,candidate_id,signal_zh,status,followup,updated_at)
        values(owner_a,candidate_id,'人工复核',case n when 7 then 'expired' else 'active' end,
          jsonb_build_object('priority','low','review_on',today),now());
    end if;
  end loop;
  select count(*), (array_agg(url))[1] into n, first_url from public.intelligence_watched_sources(owner_a);
  if n <> 4 or first_url <> 'https://timeliness.invalid/cadence-6' then raise exception 'cadence or manual due priority failed'; end if;
  old_job := public.enqueue_intelligence_job(owner_a,'daily_scan',((today::date - 1)::text),array['source:pending']);
  update public.intelligence_job_items set checkpoint='{"url":"https://timeliness.invalid/cadence-1","watch":true}' where job_run_id=old_job;
  if exists(select 1 from public.intelligence_watched_sources(owner_a) where url='https://timeliness.invalid/cadence-1') then
    raise exception 'same URL duplicated while its prior revisit is waiting';
  end if;
  if (select count(*) from public.intelligence_watch_targets where owner_id=owner_a and status='active') <> 8 then
    raise exception 'scheduling rewrote human or AI watch status';
  end if;
  today_job := public.enqueue_intelligence_job(owner_a,'daily_scan',today,array['discover:SA']);
  perform public.enqueue_intelligence_job_items(owner_a,today_job,'[{"item_key":"source:human","checkpoint":{"url":"https://timeliness.invalid/cadence-6","watch":true}}]');
  select * into claimed from public.claim_intelligence_job_item_v2(owner_a);
  if claimed.item_key <> 'source:human' then raise exception 'manual due revisit did not precede routine work'; end if;
  perform public.finish_intelligence_job_item_v2(owner_a,claimed.id,'succeeded',claimed.checkpoint,null,claimed.attempts);

  for n in 1..45 loop
    source_id := gen_random_uuid(); candidate_id := gen_random_uuid(); source_url := 'https://timeliness.invalid/cap-' || lpad(n::text,2,'0');
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
      values(source_id,owner_b,source_url,source_url,'pending_extraction',repeat('b',64),'fixture/timeliness');
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,evidence_status,maturity,urgency,source_sha256,review_status)
      values(candidate_id,owner_b,source_id,'测试','测试','candidate','high','sourced','project','research',repeat('b',64),'auto_validated');
    insert into public.intelligence_watch_targets(owner_id,candidate_id,signal_zh,created_at)
      values(owner_b,candidate_id,'等待新证据',now()-interval '2 days');
  end loop;
  if (select count(*) from public.intelligence_watched_sources(owner_b)) <> 40 then raise exception 'daily revisit cap failed'; end if;
  cap_job := public.enqueue_intelligence_job(owner_b,'daily_scan',today,array['discover:SA']);
  perform public.enqueue_intelligence_job_items(owner_b,cap_job,(select jsonb_agg(jsonb_build_object('item_key','source:'||md5(url),'checkpoint',jsonb_build_object('url',url,'watch',true))) from public.intelligence_watched_sources(owner_b)));
  if exists(select 1 from public.intelligence_watched_sources(owner_b)) then raise exception 'repeated scheduler exceeds daily cap'; end if;
  update public.intelligence_job_items set status='succeeded' where job_run_id=cap_job;
  if exists(select 1 from public.intelligence_watched_sources(owner_b)) then raise exception 'completed revisits reset same-day quota'; end if;
  update public.intelligence_job_runs set schedule_key=(today::date - 1)::text,status='succeeded' where id=cap_job;
  select url into first_url from public.intelligence_watched_sources(owner_b) limit 1;
  if first_url <> 'https://timeliness.invalid/cap-41' then raise exception 'untouched due URLs did not rotate first'; end if;

  old_job := public.enqueue_intelligence_job(owner_c,'daily_scan',(today::date - 2)::text,array['extract:old']);
  update public.intelligence_job_runs set created_at=now()-interval '2 days' where id=old_job;
  update public.intelligence_job_items set checkpoint='{"fresh":true}',created_at=now()-interval '1 day' where job_run_id=old_job;
  today_job := public.enqueue_intelligence_job(owner_c,'daily_scan',today,array['discover:SA','registry:new','source:new','extract:new']);
  update public.intelligence_job_items set checkpoint='{"fresh":true}' where job_run_id=today_job and item_key in ('source:new','extract:new');
  for n in 1..3 loop
    select * into claimed from public.claim_intelligence_job_item_v2(owner_c);
    if claimed.job_run_id <> today_job then raise exception 'today new work blocked by old routine queue'; end if;
    perform public.finish_intelligence_job_item_v2(owner_c,claimed.id,'succeeded','{}',null,claimed.attempts);
  end loop;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_c);
  if claimed.job_run_id <> old_job then raise exception 'old work starved beyond fair fourth slot'; end if;
  perform public.finish_intelligence_job_item_v2(owner_c,claimed.id,'succeeded','{}',null,claimed.attempts);
  perform public.enqueue_intelligence_job_items(owner_c,old_job,'[{"item_key":"extract:changed","checkpoint":{"fresh":true,"watch":true}}]');
  select * into claimed from public.claim_intelligence_job_item_v2(owner_c);
  if claimed.item_key <> 'extract:changed' then raise exception 'new content evidence in old run not prioritized'; end if;
  perform public.finish_intelligence_job_item_v2(owner_c,claimed.id,'succeeded','{}',null,claimed.attempts);
  old_job := public.enqueue_intelligence_job(owner_d,'daily_scan',(today::date - 2)::text,array['source:old-retry']);
  update public.intelligence_job_runs set created_at=now()-interval '2 days' where id=old_job;
  update public.intelligence_job_items set status='retry',attempts=1,next_attempt_at=now()-interval '1 second',
    created_at=now()-interval '2 days',updated_at=now()-interval '1 day' where job_run_id=old_job;
  today_job := public.enqueue_intelligence_job(owner_d,'daily_scan',today,array['discover:SA','discover:AE','discover:QA','discover:BH']);
  for n in 1..3 loop
    select * into claimed from public.claim_intelligence_job_item_v2(owner_d);
    if claimed.job_run_id <> today_job then raise exception 'old due retry bypassed current-day fair slots'; end if;
    perform public.finish_intelligence_job_item_v2(owner_d,claimed.id,'succeeded','{}',null,claimed.attempts);
  end loop;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_d);
  if claimed.job_run_id <> old_job or claimed.attempts <> 2 then raise exception 'due old retry lost its fair slot or attempt fencing'; end if;
  perform public.finish_intelligence_job_item_v2(owner_d,claimed.id,'succeeded','{}',null,claimed.attempts);
  if has_function_privilege('authenticated','public.claim_intelligence_job_item_v2(uuid,uuid,integer)','execute')
    or has_function_privilege('anon','public.intelligence_watched_sources(uuid)','execute') then raise exception 'private queue RPC exposed'; end if;
end $$;
rollback;
