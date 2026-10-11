-- Isolated local transaction only. pg_net sends after commit; this test always rolls back.
begin;
do $$
declare
 owner uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); request bigint; notice uuid; item uuid;
 day date:=(now() at time zone 'Asia/Shanghai')::date; snapshot jsonb; before_http bigint; denied boolean:=false;
 report_due boolean:=extract(hour from now() at time zone 'Asia/Shanghai')>=8;
begin
 insert into auth.users(id) values(owner),(other_owner);
 select count(*) into before_http from net.http_request_queue;
 -- Missing Vault configuration must remain a no-op, including report creation.
 delete from vault.secrets where name in('nrgopt_notify_owner','nrgopt_notify_origin','nrgopt_notify_secret');
 if public.dispatch_intelligence_notifications() is not null
  or (select count(*) from net.http_request_queue)<>before_http
  or exists(select 1 from public.intelligence_notification_outbox where owner_id=owner)
  then raise exception 'unconfigured dispatch created a report or HTTP request'; end if;
 perform public.configure_intelligence_notification_schedule(owner,'https://dispatch.example.invalid',repeat('t',40),false);
 perform public.configure_intelligence_notification_schedule(owner,'https://dispatch.example.invalid',repeat('t',40),false);
 if (select count(*) from cron.job where jobname='nrgopt-intelligence-notifications')<>1
  or (select schedule from cron.job where jobname='nrgopt-intelligence-notifications')<>'* * * * *'
  or (select active from cron.job where jobname='nrgopt-intelligence-notifications')
  then raise exception 'notification Cron was duplicated, rescheduled or enabled'; end if;

 request:=public.dispatch_intelligence_notifications();
 select id,payload into notice,snapshot from public.intelligence_notification_outbox
  where owner_id=owner and notification_key='daily:report:'||day::text;
 if report_due then
  if request is null or notice is null or snapshot->>'report_kind'<>'snapshot'
   or snapshot->>'report_date'<>day::text or snapshot->>'status'<>'missing'
   then raise exception 'empty-queue dispatcher failed to create and dispatch the due daily snapshot'; end if;
  raise notice 'after-08 empty-queue dispatch created today snapshot and transactional HTTP request';
 else
  if request is not null or notice is not null then raise exception 'dispatcher bypassed the 08:00 reporting gate'; end if;
  -- Before the natural reporting time, preserve the gate and seed one future-time fixture for remaining queue checks.
  notice:=public.enqueue_intelligence_daily_snapshot(owner,day,(day::text||' 08:00:00+08')::timestamptz,8);
  select payload into snapshot from public.intelligence_notification_outbox where id=notice;
  request:=public.dispatch_intelligence_notifications();
 end if;
 if not exists(select 1 from net.http_request_queue where id=request and method='GET'
  and url='https://dispatch.example.invalid/api/intelligence?action=notification-worker'
  and headers=jsonb_build_object('Authorization','Bearer '||repeat('t',40)) and timeout_milliseconds=120000)
  then raise exception 'dispatch method, endpoint, Authorization or 120-second timeout changed'; end if;
 if public.dispatch_intelligence_notifications() is null
  or (select count(*) from public.intelligence_notification_outbox where owner_id=owner and notification_type='daily')<>1
  or (select payload from public.intelligence_notification_outbox where id=notice) is distinct from snapshot
  or not exists(select 1 from public.intelligence_notification_outbox where id=notice and status='pending' and attempts=0)
  then raise exception 'repeated dispatcher duplicated, rewrote or attempted the same-day report'; end if;

 -- Dispatcher does not claim messages or bypass quiet hours; the worker's original lease/quiet gate remains authoritative.
 insert into public.intelligence_notification_settings(owner_id,quiet_enabled,quiet_start_hour,quiet_end_hour,timezone,flash_breaks_quiet)
  values(owner,true,extract(hour from now() at time zone 'Asia/Shanghai')::integer,
   mod(extract(hour from now() at time zone 'Asia/Shanghai')::integer+1,24),'Asia/Shanghai',false);
 if not public.intelligence_notifications_quiet(owner)
  or exists(select 1 from public.claim_intelligence_notification(owner))
  or not exists(select 1 from public.intelligence_notification_outbox where id=notice and status='pending' and attempts=0)
  then raise exception 'quiet report was claimed or spent an attempt'; end if;
 update public.intelligence_notification_outbox set status='accepted',accepted_at=now(),attempts=1 where id=notice;
 insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,payload)
  values(other_owner,'system','other-owner-dispatch-fixture','{}');
 select count(*) into before_http from net.http_request_queue;
 if public.dispatch_intelligence_notifications() is not null
  or (select count(*) from net.http_request_queue)<>before_http
  or (select count(*) from public.intelligence_notification_outbox where owner_id=owner and notification_type='daily')<>1
  then raise exception 'accepted daily or foreign-owner queue triggered another request'; end if;

 insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,payload,status,attempts)
  values(owner,'system','same-owner-dispatch-fixture','{}','retry',2) returning id into item;
 if public.dispatch_intelligence_notifications() is null then raise exception 'eligible retry was not dispatched'; end if;
 update public.intelligence_notification_outbox set attempts=3 where id=item;
 if public.dispatch_intelligence_notifications() is not null then raise exception 'exhausted retry dispatched'; end if;
 update public.intelligence_notification_outbox set status='sending',lease_until=now()+interval '1 minute' where id=item;
 if public.dispatch_intelligence_notifications() is not null then raise exception 'active sending lease dispatched'; end if;
 update public.intelligence_notification_outbox set lease_until=now()-interval '1 minute' where id=item;
 if public.dispatch_intelligence_notifications() is null then raise exception 'expired sending lease was not reconciled'; end if;
 update public.intelligence_notification_outbox set status='unknown',lease_until=null where id=item;
 if public.dispatch_intelligence_notifications() is not null then raise exception 'unknown delivery was blindly redispatched'; end if;

 if has_function_privilege('anon','public.dispatch_intelligence_notifications()','execute')
  or has_function_privilege('authenticated','public.dispatch_intelligence_notifications()','execute')
  or has_function_privilege('service_role','public.dispatch_intelligence_notifications()','execute')
  or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
   where p.oid='public.dispatch_intelligence_notifications()'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE')
  or not exists(select 1 from pg_proc where oid='public.dispatch_intelligence_notifications()'::regprocedure
   and prosecdef and proconfig=array['search_path=""'])
  then raise exception 'dispatch permission or security-definer search path widened'; end if;
 set local role service_role;
 begin
  perform public.dispatch_intelligence_notifications();
 exception when insufficient_privilege then denied:=true; end;
 reset role;
 if not denied then raise exception 'service role directly invoked the Cron-only dispatcher'; end if;
 raise notice 'daily idempotency, GET endpoint/header/timeout, owner queue, lease, quiet, unknown and private dispatcher permissions passed';
end $$;
rollback;
