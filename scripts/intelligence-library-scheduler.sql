-- Install after migration 046. Uses the existing scan origin and Cron secret.
-- Applying this file leaves the schedule disabled until explicitly enabled.
begin;
create or replace function public.dispatch_intelligence_library_maintenance()
returns bigint language plpgsql security definer set search_path='' as $$
declare origin text; secret text; bypass text; headers jsonb;
begin
 select decrypted_secret into origin from vault.decrypted_secrets where name='nrgopt_scan_origin';
 select decrypted_secret into secret from vault.decrypted_secrets where name='nrgopt_scan_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='nrgopt_scan_vercel_secret';
 if origin is null or secret is null then return null; end if;
 headers:=jsonb_build_object('Authorization','Bearer '||secret);
 if bypass is not null then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',bypass); end if;
 return net.http_get(url:=origin||'/api/intelligence?action=library-maintenance',headers:=headers,timeout_milliseconds:=180000);
end $$;

create or replace function public.configure_intelligence_library_schedule(p_enabled boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare job bigint;
begin
 if p_enabled is null then raise exception 'invalid_library_schedule'; end if;
 if p_enabled and (not exists(select 1 from vault.secrets where name='nrgopt_scan_origin')
   or not exists(select 1 from vault.secrets where name='nrgopt_scan_secret')) then raise exception 'scheduler_not_configured'; end if;
 -- 14:00-14:50 UTC every ten minutes is 22:00-22:50 Asia/Shanghai.
 job:=cron.schedule('nrgopt-intelligence-library','*/10 14 * * *','select public.dispatch_intelligence_library_maintenance();');
 perform cron.alter_job(job,active:=p_enabled);
 return true;
end $$;
revoke all on function public.dispatch_intelligence_library_maintenance() from public,anon,authenticated,service_role;
revoke all on function public.configure_intelligence_library_schedule(boolean) from public,anon,authenticated;
grant execute on function public.configure_intelligence_library_schedule(boolean) to service_role;
commit;
