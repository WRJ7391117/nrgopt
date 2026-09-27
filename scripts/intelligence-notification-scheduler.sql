-- Notification delivery is independent of the scan deployment and uses its own Vault origin.
-- Installation alone does not create or enable a schedule.
begin;
create or replace function public.dispatch_intelligence_notifications()
returns bigint language plpgsql security definer set search_path = '' as $$
declare owner uuid; origin text; secret text;
begin
  select decrypted_secret::uuid into owner from vault.decrypted_secrets where name='nrgopt_notify_owner';
  select decrypted_secret into origin from vault.decrypted_secrets where name='nrgopt_notify_origin';
  select decrypted_secret into secret from vault.decrypted_secrets where name='nrgopt_notify_secret';
  if owner is null or origin is null or secret is null then return null; end if;
  if not exists(select 1 from public.intelligence_notification_outbox n where n.owner_id=owner
    and ((n.status in ('pending','retry') and n.attempts<3) or (n.status='sending' and n.lease_until<now()))) then return null; end if;
  return net.http_get(url:=origin||'/api/intelligence?action=notification-worker',
    headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=120000);
end $$;

create or replace function public.configure_intelligence_notification_schedule(
  p_owner_id uuid,p_origin text,p_secret text,p_enabled boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_name text; v_value text; v_id uuid; v_job bigint;
begin
  if p_origin is null or p_origin !~ '^https://[a-zA-Z0-9.-]+$'
    or p_secret is null or length(p_secret) not between 32 and 512 or p_enabled is null
    or not exists(select 1 from auth.users where auth.users.id=p_owner_id) then raise exception 'invalid_notification_schedule'; end if;
  for v_name,v_value in select * from (values ('nrgopt_notify_owner',p_owner_id::text),
    ('nrgopt_notify_origin',p_origin),('nrgopt_notify_secret',p_secret)) config(name,value) loop
    select s.id into v_id from vault.secrets s where s.name=v_name;
    if v_id is null then perform vault.create_secret(v_value,v_name);
    else perform vault.update_secret(v_id,v_value); end if;
  end loop;
  v_job:=cron.schedule('nrgopt-intelligence-notifications','* * * * *','select public.dispatch_intelligence_notifications();');
  perform cron.alter_job(v_job,active:=p_enabled);
  return true;
end $$;
revoke all on function public.dispatch_intelligence_notifications() from public,anon,authenticated,service_role;
revoke all on function public.configure_intelligence_notification_schedule(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.configure_intelligence_notification_schedule(uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
