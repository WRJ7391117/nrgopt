-- Serial queue consumption across dates, fenced completion, and lease recovery.
begin;

create or replace function public.refresh_intelligence_job(p_owner_id uuid, p_job_run_id uuid)
returns void language plpgsql as $$
declare v_status text;
begin
  select case
    when count(*) filter (where status = 'budget_paused') > 0 then 'budget_paused'
    when count(*) filter (where status = 'manual_paused') > 0 then 'manual_paused'
    when count(*) filter (where status in ('queued','running','retry')) > 0 then 'running'
    when count(*) filter (where status = 'failed') > 0 then
      case when count(*) filter (where status = 'succeeded') > 0 then 'partial' else 'failed' end
    else 'succeeded' end into v_status
  from public.intelligence_job_items where owner_id = p_owner_id and job_run_id = p_job_run_id;
  update public.intelligence_job_runs set status = v_status, updated_at = now(),
    finished_at = case when v_status = 'running' then null else now() end
  where id = p_job_run_id and owner_id = p_owner_id and status <> 'manual_paused';
end $$;

create or replace function public.claim_intelligence_job_item_v2(
  p_owner_id uuid, p_job_run_id uuid default null, p_lease_seconds integer default 300
) returns table(id uuid, item_key text, attempts smallint, checkpoint jsonb, job_run_id uuid)
language plpgsql as $$
declare v_item public.intelligence_job_items%rowtype; v_run uuid;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 300 then raise exception 'invalid_lease'; end if;
  -- All scheduler invocations for this owner share one short transaction lock.
  if not pg_try_advisory_xact_lock(hashtextextended(p_owner_id::text, 731)) then return; end if;
  for v_run in
    update public.intelligence_job_items i set status = 'failed', lease_until = null,
      error_code = 'lease_exhausted', finished_at = now(), updated_at = now()
    where i.owner_id = p_owner_id and i.status = 'running' and i.lease_until <= now() and i.attempts >= 3
    returning i.job_run_id
  loop
    perform public.refresh_intelligence_job(p_owner_id, v_run);
  end loop;
  -- A second trigger must not start a concurrent model call, even for another day.
  if exists (select 1 from public.intelligence_job_items i
    where i.owner_id = p_owner_id and i.status = 'running' and i.lease_until > now()) then return; end if;
  select i.* into v_item from public.intelligence_job_items i
  join public.intelligence_job_runs r on r.id = i.job_run_id and r.owner_id = i.owner_id
  where i.owner_id = p_owner_id and (p_job_run_id is null or i.job_run_id = p_job_run_id)
    and r.status in ('queued','running','retry') and i.attempts < 3
    and ((i.status in ('queued','retry') and i.next_attempt_at <= now())
      or (i.status = 'running' and i.lease_until <= now()))
  order by r.created_at, r.id, i.item_key for update of i skip locked limit 1;
  if v_item.id is null then return; end if;
  update public.intelligence_job_items i set status = 'running', attempts = i.attempts + 1,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(i.started_at, now()), updated_at = now(), error_code = null
  where i.id = v_item.id
  returning i.id, i.item_key, i.attempts, i.checkpoint, i.job_run_id into id, item_key, attempts, checkpoint, job_run_id;
  update public.intelligence_job_runs r set status = 'running',
    started_at = coalesce(r.started_at, now()), finished_at = null, updated_at = now()
  where r.id = v_item.job_run_id and r.owner_id = p_owner_id;
  return next;
end $$;

create or replace function public.finish_intelligence_job_item_v2(
  p_owner_id uuid, p_item_id uuid, p_status text, p_checkpoint jsonb, p_error_code text, p_attempts integer
) returns boolean language plpgsql as $$
declare v_item public.intelligence_job_items%rowtype;
begin
  if p_status is null or p_status not in ('succeeded','retry','failed','budget_paused','manual_paused') then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 731));
  select * into v_item from public.intelligence_job_items
  where id = p_item_id and owner_id = p_owner_id and status = 'running'
    and attempts = p_attempts and lease_until > now() for update;
  if v_item.id is null then return false; end if;
  if p_status = 'retry' and v_item.attempts >= 3 then p_status := 'failed'; end if;
  update public.intelligence_job_items set status = p_status, checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
    error_code = p_error_code, lease_until = null,
    next_attempt_at = case when p_status = 'retry' then now() + make_interval(mins => v_item.attempts * 5) else next_attempt_at end,
    finished_at = case when p_status = 'retry' then null else now() end, updated_at = now()
  where id = p_item_id;
  perform public.refresh_intelligence_job(p_owner_id, v_item.job_run_id);
  return true;
end $$;

-- Adding a child must not resume a manually or financially paused parent.
create or replace function public.enqueue_intelligence_job_items(
  p_owner_id uuid, p_job_run_id uuid, p_items jsonb
) returns integer language plpgsql as $$
declare v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return null; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60
    or not exists (select 1 from public.intelligence_job_runs where id = p_job_run_id and owner_id = p_owner_id)
    or exists (select 1 from jsonb_array_elements(p_items) item
      where jsonb_typeof(item) <> 'object' or length(coalesce(item->>'item_key', '')) not between 1 and 160
        or jsonb_typeof(coalesce(item->'checkpoint', '{}'::jsonb)) <> 'object') then return null; end if;
  insert into public.intelligence_job_items(owner_id, job_run_id, item_key, checkpoint)
  select p_owner_id, p_job_run_id, item->>'item_key', coalesce(item->'checkpoint', '{}'::jsonb)
  from jsonb_array_elements(p_items) item on conflict (owner_id, job_run_id, item_key) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    update public.intelligence_job_runs set status = case when status = 'queued' then 'queued' else 'running' end,
      finished_at = null, updated_at = now()
    where id = p_job_run_id and owner_id = p_owner_id and status not in ('manual_paused','budget_paused');
  end if;
  return v_count;
end $$;

revoke all on function public.refresh_intelligence_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_intelligence_job_item_v2(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_intelligence_job_item_v2(uuid,uuid,text,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.refresh_intelligence_job(uuid,uuid) to service_role;
grant execute on function public.claim_intelligence_job_item_v2(uuid,uuid,integer) to service_role;
grant execute on function public.finish_intelligence_job_item_v2(uuid,uuid,text,jsonb,text,integer) to service_role;
commit;
