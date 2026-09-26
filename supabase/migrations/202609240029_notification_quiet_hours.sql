-- Defer queued notifications during owner-configured quiet hours without spending an attempt.
begin;
create table public.intelligence_notification_settings (
  owner_id uuid primary key references auth.users(id),
  quiet_enabled boolean not null default true,
  quiet_start_hour smallint not null default 23 check (quiet_start_hour between 0 and 23),
  quiet_end_hour smallint not null default 7 check (quiet_end_hour between 0 and 23),
  timezone text not null default 'Asia/Shanghai' check (timezone in ('Asia/Shanghai','Asia/Riyadh','Asia/Dubai','UTC')),
  flash_breaks_quiet boolean not null default false,
  check (quiet_start_hour <> quiet_end_hour)
);
alter table public.intelligence_notification_settings enable row level security;
revoke all on public.intelligence_notification_settings from public,anon,authenticated;
grant select,insert,update on public.intelligence_notification_settings to service_role;

create function public.intelligence_notifications_quiet(p_owner_id uuid,p_at timestamptz default now())
returns boolean language plpgsql stable as $$
declare enabled boolean; start_hour integer; end_hour integer; zone text; local_hour integer;
begin
  select quiet_enabled,quiet_start_hour,quiet_end_hour,timezone into enabled,start_hour,end_hour,zone
    from public.intelligence_notification_settings where owner_id=p_owner_id;
  if not found then enabled:=true; start_hour:=23; end_hour:=7; zone:='Asia/Shanghai'; end if;
  if not enabled then return false; end if;
  local_hour:=extract(hour from p_at at time zone zone);
  return case when start_hour>end_hour then local_hour>=start_hour or local_hour<end_hour
    else local_hour>=start_hour and local_hour<end_hour end;
end $$;

create or replace function public.claim_intelligence_notification(
  p_owner_id uuid,p_lease_seconds integer default 120
) returns table(id uuid,notification_type text,notification_key text,payload jsonb,attempts smallint) language plpgsql as $$
declare v_item public.intelligence_notification_outbox%rowtype; quiet boolean; allow_flash boolean;
begin
  if p_lease_seconds not between 30 and 300 then return; end if;
  quiet:=public.intelligence_notifications_quiet(p_owner_id);
  select flash_breaks_quiet into allow_flash from public.intelligence_notification_settings where owner_id=p_owner_id;
  update public.intelligence_notification_outbox set status='unknown',lease_until=null,
    error_code='delivery_result_unknown',updated_at=now()
  where owner_id=p_owner_id and status='sending' and lease_until<now();
  select n.* into v_item from public.intelligence_notification_outbox n
  where n.owner_id=p_owner_id and n.status in ('pending','retry') and n.attempts<3
    and (not quiet or (coalesce(allow_flash,false) and n.notification_type='flash'))
  order by n.created_at for update skip locked limit 1;
  if v_item.id is null then return; end if;
  update public.intelligence_notification_outbox set status='sending',
    attempts=intelligence_notification_outbox.attempts+1,
    lease_until=now()+make_interval(secs=>p_lease_seconds),error_code=null,updated_at=now()
  where intelligence_notification_outbox.id=v_item.id
  returning intelligence_notification_outbox.id,intelligence_notification_outbox.notification_type,
    intelligence_notification_outbox.notification_key,intelligence_notification_outbox.payload,
    intelligence_notification_outbox.attempts into id,notification_type,notification_key,payload,attempts;
  return next;
end $$;
revoke all on function public.intelligence_notifications_quiet(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.intelligence_notifications_quiet(uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
