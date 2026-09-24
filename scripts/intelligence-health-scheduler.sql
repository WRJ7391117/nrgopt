-- Independent daily health check. Installation alone does not enable a schedule.
-- Requires intelligence-scheduler.sql and its existing Vault configuration.
begin;
create or replace function public.dispatch_intelligence_health_check()
returns bigint language plpgsql security definer set search_path = '' as $$
declare origin text; secret text; automation_secret text; headers jsonb;
begin
  select decrypted_secret into origin from vault.decrypted_secrets where name='nrgopt_scan_origin';
  select decrypted_secret into secret from vault.decrypted_secrets where name='nrgopt_scan_secret';
  select decrypted_secret into automation_secret from vault.decrypted_secrets where name='nrgopt_scan_vercel_secret';
  if origin is null or secret is null then return null; end if;
  headers:=jsonb_build_object('Authorization','Bearer '||secret);
  if automation_secret is not null then
    headers:=headers||jsonb_build_object('x-vercel-protection-bypass',automation_secret);
  end if;
  return net.http_get(url:=origin||'/api/intelligence?action=health-check',headers:=headers,timeout_milliseconds:=30000);
end $$;

create or replace function public.configure_intelligence_health_schedule(p_enabled boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job bigint;
begin
  if p_enabled is null then raise exception 'invalid_health_schedule'; end if;
  if p_enabled and (not exists(select 1 from vault.secrets where name='nrgopt_scan_origin')
    or not exists(select 1 from vault.secrets where name='nrgopt_scan_secret')) then raise exception 'scheduler_not_configured'; end if;
  -- pg_cron uses UTC: 12:00 UTC is 20:00 Asia/Shanghai.
  job:=cron.schedule('nrgopt-intelligence-health','0 12 * * *','select public.dispatch_intelligence_health_check();');
  perform cron.alter_job(job,active:=p_enabled);
  return true;
end $$;
revoke all on function public.dispatch_intelligence_health_check() from public,anon,authenticated,service_role;
revoke all on function public.configure_intelligence_health_schedule(boolean) from public,anon,authenticated;
grant execute on function public.configure_intelligence_health_schedule(boolean) to service_role;
notify pgrst,'reload schema';
commit;
