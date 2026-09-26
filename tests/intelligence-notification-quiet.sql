begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); current_hour integer; picked uuid; flash uuid; daily uuid;
begin
  insert into auth.users(id) values(a),(b);
  set local role service_role;
  if not public.intelligence_notifications_quiet(a,'2026-09-24 15:00:00Z') then raise exception '23:00 must be quiet'; end if;
  if not public.intelligence_notifications_quiet(a,'2026-09-24 22:59:59Z') then raise exception '06:59 must be quiet'; end if;
  if public.intelligence_notifications_quiet(a,'2026-09-24 23:00:00Z') then raise exception '07:00 must resume'; end if;
  if public.intelligence_notifications_quiet(a,'2026-09-24 14:59:59Z') then raise exception '22:59 must deliver'; end if;
  insert into public.intelligence_notification_settings(owner_id,quiet_start_hour,quiet_end_hour,timezone)
    values(a,9,17,'Asia/Riyadh');
  if not public.intelligence_notifications_quiet(a,'2026-09-24 06:00:00Z') or public.intelligence_notifications_quiet(a,'2026-09-24 14:00:00Z') then raise exception 'daytime timezone boundary'; end if;
  current_hour:=extract(hour from now() at time zone 'UTC');
  update public.intelligence_notification_settings set timezone='UTC',quiet_start_hour=current_hour,quiet_end_hour=(current_hour+1)%24 where owner_id=a;
  daily:=public.enqueue_intelligence_notification(a,'daily','quiet-daily','{}');
  flash:=public.enqueue_intelligence_notification(a,'flash','quiet-flash','{}');
  perform public.enqueue_intelligence_notification(b,'flash','other-owner','{}');
  if exists(select 1 from public.claim_intelligence_notification(a)) then raise exception 'claimed during quiet'; end if;
  if exists(select 1 from public.intelligence_notification_outbox where owner_id=a and (status<>'pending' or attempts<>0)) then raise exception 'quiet consumed attempt'; end if;
  update public.intelligence_notification_settings set flash_breaks_quiet=true where owner_id=a;
  select id into picked from public.claim_intelligence_notification(a);
  if picked is distinct from flash then raise exception 'flash bypass failed'; end if;
  if exists(select 1 from public.claim_intelligence_notification(a)) then raise exception 'daily bypassed quiet'; end if;
  update public.intelligence_notification_settings set quiet_enabled=false where owner_id=a;
  select id into picked from public.claim_intelligence_notification(a);
  if picked is distinct from daily then raise exception 'deferred daily lost'; end if;
  if exists(select 1 from public.intelligence_notification_outbox where owner_id=b and attempts<>0) then raise exception 'other owner claimed'; end if;
  if has_table_privilege('anon','public.intelligence_notification_settings','select') or has_function_privilege('authenticated','public.intelligence_notifications_quiet(uuid,timestamptz)','execute') then raise exception 'public access'; end if;
  reset role;
end $$;
rollback;
