-- Isolated database only. HTTP requests are transactional and roll back before pg_net sends them.
begin;
do $$
declare v_owner uuid := gen_random_uuid(); v_run uuid; v_request bigint;
begin
  insert into auth.users(id) values (v_owner);
  perform public.configure_intelligence_scheduler(v_owner, 'https://scheduler.example.invalid', repeat('t', 40), false);
  perform public.configure_intelligence_scheduler(v_owner, 'https://scheduler.example.invalid', repeat('t', 40), false);
  if (select count(*) from cron.job where jobname = 'nrgopt-intelligence-consumer') <> 1
    or (select active from cron.job where jobname = 'nrgopt-intelligence-consumer') then
    raise exception 'configuration duplicated or enabled schedule';
  end if;
  if (select count(*) from vault.secrets where name like 'nrgopt_scan_%') <> 3 then
    raise exception 'secret configuration not idempotent';
  end if;
  perform public.configure_intelligence_automation_access(repeat('v', 40));
  perform public.configure_intelligence_automation_access(repeat('v', 40));
  v_request := public.dispatch_intelligence_scan();
  if v_request is null then raise exception 'missing daily scan not dispatched'; end if;
  if (select headers->>'x-vercel-protection-bypass' from net.http_request_queue where id = v_request) <> repeat('v', 40) then
    raise exception 'preview automation credential missing';
  end if;
  v_run := public.enqueue_intelligence_job(v_owner, 'daily_scan', to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD'), array['discover:SA']);
  update public.intelligence_job_items set status = 'succeeded' where job_run_id = v_run;
  update public.intelligence_job_runs set status = 'succeeded' where id = v_run;
  if public.dispatch_intelligence_scan() is not null then raise exception 'idle queue sent HTTP request'; end if;
  update public.intelligence_job_items set status = 'running', lease_until = now() + interval '5 minutes' where job_run_id = v_run;
  update public.intelligence_job_runs set status = 'running' where id = v_run;
  if public.dispatch_intelligence_scan() is not null then raise exception 'active lease sent HTTP request'; end if;
  update public.intelligence_job_items set lease_until = now() - interval '1 second' where job_run_id = v_run;
  if public.dispatch_intelligence_scan() is null then raise exception 'expired lease not dispatched'; end if;
  if has_function_privilege('authenticated', 'public.configure_intelligence_scheduler(uuid,text,text,boolean)', 'execute')
    or has_function_privilege('service_role', 'public.dispatch_intelligence_scan()', 'execute') then
    raise exception 'scheduler access too broad';
  end if;
end $$;
rollback;
