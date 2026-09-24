-- A publisher pause stops new automatic fetches without stopping other publishers.
begin;
create table public.intelligence_source_controls (
  owner_id uuid not null references auth.users(id) on delete cascade,
  hostname text not null check (hostname ~ '^[a-z0-9][a-z0-9.-]+[a-z0-9]$' and length(hostname) <= 253),
  paused boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, hostname)
);
alter table public.intelligence_source_controls enable row level security;
revoke all on public.intelligence_source_controls from anon, authenticated;
grant all on public.intelligence_source_controls to service_role;

create or replace function public.refresh_intelligence_job(p_owner_id uuid, p_job_run_id uuid)
returns void language plpgsql as $$
declare v_status text;
begin
  select case
    when count(*) filter (where status = 'budget_paused') > 0 then 'budget_paused'
    when count(*) filter (where status = 'manual_paused' and error_code is distinct from 'source_paused') > 0 then 'manual_paused'
    when count(*) filter (where status in ('queued','running','retry')) > 0 then 'running'
    when count(*) filter (where status = 'manual_paused' and error_code = 'source_paused') > 0 then 'partial'
    when count(*) filter (where status = 'failed') > 0 then
      case when count(*) filter (where status = 'succeeded') > 0 then 'partial' else 'failed' end
    else 'succeeded' end into v_status
  from public.intelligence_job_items where owner_id = p_owner_id and job_run_id = p_job_run_id;
  update public.intelligence_job_runs set status = v_status, updated_at = now(),
    finished_at = case when v_status = 'running' then null else now() end
  where id = p_job_run_id and owner_id = p_owner_id and status <> 'manual_paused';
end $$;

create function public.set_intelligence_source_control(p_owner_id uuid, p_hostname text, p_paused boolean)
returns integer language plpgsql as $$
declare v_run uuid; v_count integer := 0;
begin
  if p_hostname is null or p_hostname !~ '^[a-z0-9][a-z0-9.-]+[a-z0-9]$' or length(p_hostname) > 253 or p_paused is null then
    raise exception 'invalid_source_control';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 731));
  insert into public.intelligence_source_controls(owner_id, hostname, paused)
    values(p_owner_id, p_hostname, p_paused)
    on conflict(owner_id, hostname) do update set paused = excluded.paused, updated_at = now();
  if not p_paused then
    -- Resume only the latest planned day; historical coverage gaps remain visible.
    select id into v_run from public.intelligence_job_runs
      where owner_id = p_owner_id and job_type = 'daily_scan' order by created_at desc, id desc limit 1;
    update public.intelligence_job_items set status = 'queued', attempts = 0, lease_until = null,
      next_attempt_at = now(), finished_at = null, error_code = null, updated_at = now()
      where owner_id = p_owner_id and job_run_id = v_run and status = 'manual_paused'
        and error_code = 'source_paused' and checkpoint->>'source_host' = p_hostname;
    get diagnostics v_count = row_count;
    if v_count > 0 then perform public.refresh_intelligence_job(p_owner_id, v_run); end if;
  end if;
  return v_count;
end $$;
revoke all on function public.set_intelligence_source_control(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.set_intelligence_source_control(uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
