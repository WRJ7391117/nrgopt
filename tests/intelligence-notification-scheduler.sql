-- Local transaction only: pg_net sends after commit; rollback sends nothing.
begin;
do $$
declare owner uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); request bigint; item uuid; daily uuid;
  day date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  insert into auth.users(id) values(owner),(other_owner);
  perform public.configure_intelligence_notification_schedule(owner,'https://production.example.invalid',repeat('t',40),false);
  perform public.configure_intelligence_notification_schedule(owner,'https://production.example.invalid',repeat('t',40),false);
  if (select count(*) from cron.job where jobname='nrgopt-intelligence-notifications')<>1
    or (select active from cron.job where jobname='nrgopt-intelligence-notifications') then raise exception 'unexpected schedule'; end if;
  -- Today's due report is already accepted, so the remaining assertions isolate pending-message filtering.
  daily:=public.enqueue_intelligence_daily_snapshot(owner,day,(day::text||' 08:00:00+08')::timestamptz,8);
  if daily is null then raise exception 'daily scheduler fixture missing'; end if;
  update public.intelligence_notification_outbox set status='accepted',accepted_at=now(),attempts=1 where id=daily;
  if public.dispatch_intelligence_notifications() is not null then raise exception 'empty queue dispatched'; end if;
  insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,payload)
    values(other_owner,'system','other-owner','{}');
  if public.dispatch_intelligence_notifications() is not null then raise exception 'wrong owner dispatched'; end if;
  insert into public.intelligence_notification_outbox(owner_id,notification_type,notification_key,payload)
    values(owner,'system','connection-check','{}') returning id into item;
  request:=public.dispatch_intelligence_notifications();
  if not exists(select 1 from net.http_request_queue where id=request
    and url='https://production.example.invalid/api/intelligence?action=notification-worker'
    and headers->>'Authorization'='Bearer '||repeat('t',40)) then raise exception 'wrong notification endpoint'; end if;
  update public.intelligence_notification_outbox set status='accepted' where id=item;
  if public.dispatch_intelligence_notifications() is not null then raise exception 'accepted notification dispatched'; end if;
  update public.intelligence_notification_outbox set status='sending',lease_until=now()-interval '1 minute' where id=item;
  if public.dispatch_intelligence_notifications() is null then raise exception 'expired lease not reconciled'; end if;
  perform public.configure_intelligence_notification_schedule(owner,'https://production.example.invalid',repeat('t',40),true);
  if not (select active from cron.job where jobname='nrgopt-intelligence-notifications') then raise exception 'not enabled'; end if;
  if has_function_privilege('authenticated','public.configure_intelligence_notification_schedule(uuid,text,text,boolean)','execute')
    or has_function_privilege('service_role','public.dispatch_intelligence_notifications()','execute') then raise exception 'broad notification permission'; end if;
end $$;
rollback;
