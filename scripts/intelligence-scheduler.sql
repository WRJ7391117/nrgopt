-- Optional cloud setup, after migration 017 and a verified Preview deployment.
-- Installing this file does not start a schedule. Configure through the service role.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dispatch_intelligence_scan()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_origin text; v_secret text; v_today text;
begin
  select decrypted_secret::uuid into v_owner from vault.decrypted_secrets where name = 'nrgopt_scan_owner';
  select decrypted_secret into v_origin from vault.decrypted_secrets where name = 'nrgopt_scan_origin';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'nrgopt_scan_secret';
  if v_owner is null or v_origin is null or v_secret is null then return null; end if;
  v_today := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD');
  if exists (select 1 from public.intelligence_job_runs where owner_id = v_owner
      and job_type = 'daily_scan' and schedule_key = v_today)
    and not exists (
      select 1 from public.intelligence_job_items i join public.intelligence_job_runs r on r.id = i.job_run_id
      where i.owner_id = v_owner and r.owner_id = v_owner and r.status in ('queued','running','retry')
        and ((i.status in ('queued','retry') and i.next_attempt_at <= now())
          or (i.status = 'running' and i.lease_until <= now()))
    ) then return null; end if;
  if exists (select 1 from public.intelligence_job_items where owner_id = v_owner
      and status = 'running' and lease_until > now()) then return null; end if;
  return net.http_get(url := v_origin || '/api/intelligence?action=scheduled-scan',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret), timeout_milliseconds := 250000);
end $$;

create or replace function public.configure_intelligence_scheduler(
  p_owner_id uuid, p_origin text, p_secret text, p_enabled boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_name text; v_value text; v_id uuid; v_job bigint;
begin
  if p_origin is null or p_origin !~ '^https://[a-zA-Z0-9.-]+$'
    or p_secret is null or length(p_secret) not between 32 and 512
    or p_enabled is null or not exists (select 1 from auth.users where id = p_owner_id) then
    raise exception 'invalid_scheduler_config';
  end if;
  for v_name, v_value in select * from (values
    ('nrgopt_scan_owner', p_owner_id::text), ('nrgopt_scan_origin', p_origin), ('nrgopt_scan_secret', p_secret)
  ) config(name, value) loop
    select id into v_id from vault.secrets where name = v_name;
    if v_id is null then perform vault.create_secret(v_value, v_name);
    else perform vault.update_secret(v_id, v_value); end if;
  end loop;
  v_job := cron.schedule('nrgopt-intelligence-consumer', '* * * * *', 'select public.dispatch_intelligence_scan();');
  perform cron.alter_job(v_job, active := p_enabled);
  return true;
end $$;

revoke all on function public.dispatch_intelligence_scan() from public, anon, authenticated, service_role;
revoke all on function public.configure_intelligence_scheduler(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.configure_intelligence_scheduler(uuid,text,text,boolean) to service_role;
commit;
