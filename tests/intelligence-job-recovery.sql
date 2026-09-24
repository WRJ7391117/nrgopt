-- Run against an isolated Supabase test database after migrations. All fixture rows roll back.
begin;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  old_job uuid; new_job uuid; other_job uuid; claimed record; resumed record; n integer;
begin
  insert into auth.users(id) values (owner_a), (owner_b);
  old_job := public.enqueue_intelligence_job(owner_a, 'daily_scan', '2000-01-01', array['discover:SA']);
  new_job := public.enqueue_intelligence_job(owner_a, 'daily_scan', '2000-01-02', array['discover:AE']);
  other_job := public.enqueue_intelligence_job(owner_b, 'daily_scan', '2000-01-01', array['discover:SA']);
  update public.intelligence_job_runs set created_at = now() - interval '1 day' where id = old_job;
  if public.enqueue_intelligence_job(owner_a, 'daily_scan', '2000-01-01', array['discover:SA']) <> old_job then
    raise exception 'duplicate daily run';
  end if;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_a);
  if claimed.job_run_id is distinct from old_job or claimed.attempts <> 1 then raise exception 'old run not resumed first'; end if;
  select count(*) into n from public.claim_intelligence_job_item_v2(owner_a, new_job);
  if n <> 0 then raise exception 'overlapping owner claims'; end if;
  select count(*) into n from public.claim_intelligence_job_item_v2(owner_b, old_job);
  if n <> 0 then raise exception 'cross-owner access'; end if;
  if public.finish_intelligence_job_item_v2(owner_b, claimed.id, 'succeeded', '{}', null, 1) then
    raise exception 'cross-owner finish';
  end if;
  update public.intelligence_job_items set lease_until = now() - interval '1 second' where id = claimed.id;
  if public.finish_intelligence_job_item_v2(owner_a, claimed.id, 'succeeded', '{}', null, 1) then
    raise exception 'expired worker accepted';
  end if;
  select * into resumed from public.claim_intelligence_job_item_v2(owner_a);
  if resumed.id is distinct from claimed.id or resumed.attempts <> 2 then raise exception 'lease not recovered'; end if;
  if public.finish_intelligence_job_item_v2(owner_a, claimed.id, 'succeeded', '{}', null, 1) then
    raise exception 'stale attempt accepted';
  end if;
  if not public.finish_intelligence_job_item_v2(owner_a, resumed.id, 'retry', '{}', 'test_retry', 2) then
    raise exception 'retry rejected';
  end if;
  select count(*) into n from public.claim_intelligence_job_item_v2(owner_a, old_job);
  if n <> 0 then raise exception 'backoff ignored'; end if;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_a);
  if claimed.job_run_id is distinct from new_job then raise exception 'not-due old run blocks ready work'; end if;
  if not public.finish_intelligence_job_item_v2(owner_a, claimed.id, 'succeeded', '{}', null, claimed.attempts) then
    raise exception 'finish rejected';
  end if;
  update public.intelligence_job_items set next_attempt_at = now() - interval '1 second' where id = resumed.id;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_a);
  if claimed.attempts <> 3 then raise exception 'third attempt not claimed'; end if;
  update public.intelligence_job_items set lease_until = now() - interval '1 second' where id = claimed.id;
  perform public.claim_intelligence_job_item_v2(owner_a);
  if (select status from public.intelligence_job_items where id = claimed.id) <> 'failed'
    or (select status from public.intelligence_job_runs where id = old_job) <> 'failed' then
    raise exception 'exhausted lease left running';
  end if;
  update public.intelligence_job_runs set status = 'manual_paused' where id = other_job;
  select count(*) into n from public.claim_intelligence_job_item_v2(owner_b);
  if n <> 0 then raise exception 'paused run claimed'; end if;
  perform public.enqueue_intelligence_job_items(owner_b, other_job, '[{"item_key":"source:test","checkpoint":{}}]');
  if (select status from public.intelligence_job_runs where id = other_job) <> 'manual_paused' then
    raise exception 'enqueue unpaused parent';
  end if;
  update public.intelligence_job_runs set status = 'running' where id = other_job;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_b);
  update public.intelligence_job_runs set status = 'manual_paused' where id = other_job;
  perform public.finish_intelligence_job_item_v2(owner_b, claimed.id, 'succeeded', '{}', null, claimed.attempts);
  if (select status from public.intelligence_job_runs where id = other_job) <> 'manual_paused' then
    raise exception 'completion unpaused parent';
  end if;
  update public.intelligence_job_runs set status = 'running' where id = other_job;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_b);
  perform public.finish_intelligence_job_item_v2(owner_b, claimed.id, 'budget_paused', '{}', 'budget_exhausted', claimed.attempts);
  if (select status from public.intelligence_job_runs where id = other_job) <> 'budget_paused' then
    raise exception 'budget pause not propagated';
  end if;
  -- Deployment adds a registry after today's scan finished: reopen only for new work.
  update public.intelligence_job_runs set status = 'partial' where id = new_job;
  n := public.enqueue_intelligence_job_items(owner_a, new_job, '[{"item_key":"registry:test","checkpoint":{}}]');
  if n <> 1 or (select status from public.intelligence_job_runs where id = new_job) <> 'running' then
    raise exception 'new entry point stranded in completed run';
  end if;
  select * into claimed from public.claim_intelligence_job_item_v2(owner_a, new_job);
  if claimed.item_key is distinct from 'registry:test' then raise exception 'new entry point not claimable'; end if;
  perform public.finish_intelligence_job_item_v2(owner_a, claimed.id, 'succeeded', '{}', null, claimed.attempts);
  n := public.enqueue_intelligence_job_items(owner_a, new_job, '[{"item_key":"registry:test","checkpoint":{}}]');
  if n <> 0 or (select status from public.intelligence_job_runs where id = new_job) <> 'succeeded' then
    raise exception 'duplicate entry point reopened completed run';
  end if;
  perform public.enqueue_intelligence_job_items(owner_b, other_job, '[{"item_key":"registry:paused","checkpoint":{}}]');
  if (select status from public.intelligence_job_runs where id = other_job) <> 'budget_paused' then
    raise exception 'new entry point unpaused budget';
  end if;
  if has_function_privilege('anon', 'public.claim_intelligence_job_item_v2(uuid,uuid,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.finish_intelligence_job_item_v2(uuid,uuid,text,jsonb,text,integer)', 'execute') then
    raise exception 'queue RPC exposed to browser roles';
  end if;
end $$;
rollback;
