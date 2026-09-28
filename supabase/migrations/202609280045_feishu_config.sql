begin;
set local lock_timeout='5s';
create table public.intelligence_feishu_config (
 owner_id uuid primary key references auth.users(id), revision integer not null check(revision>0),
 app_id text not null default '', secret_ciphertext text, chat_id text not null default '', user_open_id text not null default '',
 enabled boolean not null default false, send_chat boolean not null default true, send_user boolean not null default true,
 daily_enabled boolean not null default true, flash_enabled boolean not null default true, system_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.intelligence_feishu_config enable row level security;
revoke all on public.intelligence_feishu_config from public,anon,authenticated;
grant select,insert,update,delete on public.intelligence_feishu_config to service_role;
create function public.save_intelligence_feishu_config(p_owner_id uuid,p_revision integer,p_config jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_feishu_config%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,45));
 select * into r from public.intelligence_feishu_config where owner_id=p_owner_id for update;
 if p_revision is null or p_revision<0 then return jsonb_build_object('error','invalid_request');end if;
 if coalesce(r.revision,0)<>p_revision then return jsonb_build_object('error','feishu_config_conflict');end if;
 insert into public.intelligence_feishu_config(owner_id,revision,app_id,secret_ciphertext,chat_id,user_open_id,enabled,send_chat,send_user,daily_enabled,flash_enabled,system_enabled)
 values(p_owner_id,p_revision+1,p_config->>'app_id',p_config->>'secret_ciphertext',p_config->>'chat_id',p_config->>'user_open_id',
 (p_config->>'enabled')::boolean,(p_config->>'send_chat')::boolean,(p_config->>'send_user')::boolean,
 (p_config->>'daily_enabled')::boolean,(p_config->>'flash_enabled')::boolean,(p_config->>'system_enabled')::boolean)
 on conflict(owner_id) do update set revision=excluded.revision,app_id=excluded.app_id,secret_ciphertext=excluded.secret_ciphertext,
 chat_id=excluded.chat_id,user_open_id=excluded.user_open_id,enabled=excluded.enabled,send_chat=excluded.send_chat,send_user=excluded.send_user,
 daily_enabled=excluded.daily_enabled,flash_enabled=excluded.flash_enabled,system_enabled=excluded.system_enabled,updated_at=now() returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.save_intelligence_feishu_config(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_feishu_config(uuid,integer,jsonb) to service_role;

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
    and not exists(select 1 from public.intelligence_feishu_config c where c.owner_id=p_owner_id
      and (not c.enabled or not case n.notification_type when 'daily' then c.daily_enabled when 'flash' then c.flash_enabled else c.system_enabled end))
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

notify pgrst,'reload schema';
commit;
