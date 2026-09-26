-- Local-only fixture. pg_net dispatches after commit, so rollback sends no HTTP request.
begin;
do $$
declare owner uuid:=gen_random_uuid(); request bigint;
begin
  insert into auth.users(id) values(owner);
  perform public.configure_intelligence_scheduler(owner,'https://scheduler.example.invalid',repeat('t',40),false);
  perform public.configure_intelligence_automation_access(repeat('v',40));
  perform public.configure_intelligence_health_schedule(false);
  perform public.configure_intelligence_health_schedule(false);
  if (select count(*) from cron.job where jobname='nrgopt-intelligence-health')<>1 then raise exception 'duplicate health schedule'; end if;
  if (select active from cron.job where jobname='nrgopt-intelligence-health') then raise exception 'unexpected activation'; end if;
  if (select schedule from cron.job where jobname='nrgopt-intelligence-health')<>'0 12 * * *' then raise exception 'wrong timezone'; end if;
  -- No scan run exists. The monitor must still dispatch independently.
  request:=public.dispatch_intelligence_health_check();
  if not exists(select 1 from net.http_request_queue where id=request and url='https://scheduler.example.invalid/api/intelligence?action=health-check'
    and headers->>'Authorization'='Bearer '||repeat('t',40) and headers->>'x-vercel-protection-bypass'=repeat('v',40)) then raise exception 'health dispatch not wired'; end if;
  if has_function_privilege('authenticated','public.configure_intelligence_health_schedule(boolean)','execute')
    or has_function_privilege('service_role','public.dispatch_intelligence_health_check()','execute') then raise exception 'broad monitor permission'; end if;
end $$;
rollback;
