begin;
set local lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.dispatch_intelligence_notifications()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner uuid; origin text; secret text;
begin
  select decrypted_secret::uuid into owner from vault.decrypted_secrets where name='nrgopt_notify_owner';
  select decrypted_secret into origin from vault.decrypted_secrets where name='nrgopt_notify_origin';
  select decrypted_secret into secret from vault.decrypted_secrets where name='nrgopt_notify_secret';
  if owner is null or origin is null or secret is null then return null; end if;
  -- Build today's report even when there is no message waiting yet.
  perform public.enqueue_intelligence_daily_snapshot(owner,(now() at time zone 'Asia/Shanghai')::date);
  if not exists(select 1 from public.intelligence_notification_outbox n where n.owner_id=owner
    and ((n.status in ('pending','retry') and n.attempts<3) or (n.status='sending' and n.lease_until<now()))) then return null; end if;
  return net.http_get(url:=origin||'/api/intelligence?action=notification-worker',
    headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=120000);
end $function$;


revoke all on function public.dispatch_intelligence_notifications() from public,anon,authenticated,service_role;
commit;
