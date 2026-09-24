-- Non-secret configuration history and call provenance. Historical calls remain unknown.
begin;
create table public.intelligence_provider_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('discovery','analysis')),
  provider text not null, endpoint text not null, model text not null,
  currency text not null, billing_mode text not null,
  budget_limit_micro bigint not null, budget_enabled boolean not null,
  key_changed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id,id)
);
alter table public.intelligence_provider_versions enable row level security;
revoke all on public.intelligence_provider_versions from public, anon, authenticated;
grant select, insert on public.intelligence_provider_versions to service_role;
alter table public.intelligence_provider_configs add column config_version_id uuid;

create function public.version_intelligence_provider_config() returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    if row(new.provider,new.endpoint,new.model,new.currency,new.billing_mode,new.budget_limit_micro,new.budget_enabled,new.api_key_ciphertext)
       is not distinct from row(old.provider,old.endpoint,old.model,old.currency,old.billing_mode,old.budget_limit_micro,old.budget_enabled,old.api_key_ciphertext)
       and old.config_version_id is not null then
      new.config_version_id := old.config_version_id;
      return new;
    end if;
  end if;
  insert into public.intelligence_provider_versions(owner_id,capability,provider,endpoint,model,currency,billing_mode,budget_limit_micro,budget_enabled,key_changed)
  values(new.owner_id,new.capability,new.provider,new.endpoint,new.model,new.currency,new.billing_mode,new.budget_limit_micro,new.budget_enabled,
    case when TG_OP = 'INSERT' then true else old.api_key_ciphertext is distinct from new.api_key_ciphertext end)
  returning id into new.config_version_id;
  return new;
end $$;
revoke all on function public.version_intelligence_provider_config() from public, anon, authenticated;
create trigger intelligence_provider_config_version before insert or update on public.intelligence_provider_configs
for each row execute function public.version_intelligence_provider_config();
update public.intelligence_provider_configs set config_version_id = null;
alter table public.intelligence_provider_configs alter column config_version_id set not null;
alter table public.intelligence_provider_configs add foreign key(owner_id,config_version_id)
  references public.intelligence_provider_versions(owner_id,id);

alter table public.intelligence_budget_reservations
  add column config_version_id uuid,
  add column call_status text check(call_status in ('started','succeeded','failed')),
  add column call_error_code text,
  add column call_started_at timestamptz,
  add column call_finished_at timestamptz,
  add foreign key(owner_id,config_version_id) references public.intelligence_provider_versions(owner_id,id);

create function public.start_intelligence_provider_call(p_owner_id uuid,p_reservation_id uuid,p_config_version_id uuid)
returns boolean language plpgsql as $$
declare v_reservation public.intelligence_budget_reservations%rowtype;
begin
  select * into v_reservation from public.intelligence_budget_reservations
    where id = p_reservation_id and owner_id = p_owner_id for update;
  if v_reservation.id is null or v_reservation.cost_status <> 'reserved' or v_reservation.call_status is not null then return false; end if;
  if not exists(select 1 from public.intelligence_provider_configs c
    where c.owner_id = p_owner_id and c.config_version_id = p_config_version_id
    and c.capability = case when v_reservation.operation = 'discovery' then 'discovery' else 'analysis' end) then
    perform public.release_intelligence_budget(p_owner_id,p_reservation_id);
    return false;
  end if;
  update public.intelligence_budget_reservations r set config_version_id = p_config_version_id,
    call_status = 'started', call_started_at = now(), provider = v.provider, model = v.model
  from public.intelligence_provider_versions v, public.intelligence_provider_configs c
  where r.id = p_reservation_id and r.owner_id = p_owner_id and r.cost_status = 'reserved' and r.call_status is null
    and v.id = p_config_version_id and v.owner_id = p_owner_id
    and v.capability = case when r.operation = 'discovery' then 'discovery' else 'analysis' end
    and c.owner_id = p_owner_id and c.capability = v.capability and c.config_version_id = v.id;
  return found;
end $$;
create function public.finish_intelligence_provider_call(p_owner_id uuid,p_reservation_id uuid,p_error_code text,p_usage jsonb)
returns boolean language plpgsql as $$
begin
  if (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,79}$')
    or (p_usage is not null and jsonb_typeof(p_usage) <> 'object') then return false; end if;
  update public.intelligence_budget_reservations set call_status = case when p_error_code is null then 'succeeded' else 'failed' end,
    call_error_code = p_error_code, usage = p_usage, call_finished_at = now()
  where owner_id = p_owner_id and id = p_reservation_id and call_status = 'started';
  return found;
end $$;
revoke all on function public.start_intelligence_provider_call(uuid,uuid,uuid),
  public.finish_intelligence_provider_call(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.start_intelligence_provider_call(uuid,uuid,uuid),
  public.finish_intelligence_provider_call(uuid,uuid,text,jsonb) to service_role;
alter table public.intelligence_sources add column extraction_config_version_id uuid,
  add foreign key(owner_id,extraction_config_version_id) references public.intelligence_provider_versions(owner_id,id);
alter table public.intelligence_analysis_revisions add column config_version_id uuid,
  add foreign key(owner_id,config_version_id) references public.intelligence_provider_versions(owner_id,id);
create or replace function public.record_intelligence_analysis_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.extraction_status <> 'extracted' or new.extraction_zh is null
    or new.extraction_source_sha256 is distinct from new.content_sha256 then return new; end if;
  if tg_op='UPDATE' then
    if new.extraction_zh is not distinct from old.extraction_zh
      and new.extraction_source_sha256 is not distinct from old.extraction_source_sha256
      and new.extraction_provider is not distinct from old.extraction_provider
      and new.extraction_model is not distinct from old.extraction_model
      and new.extraction_config_version_id is not distinct from old.extraction_config_version_id then return new; end if;
  end if;
  insert into public.intelligence_analysis_revisions(owner_id,source_id,source_sha256,extraction_zh,provider,model,extracted_at,config_version_id)
    values(new.owner_id,new.id,new.content_sha256,new.extraction_zh,new.extraction_provider,new.extraction_model,new.extracted_at,new.extraction_config_version_id);
  return new;
end $$;
notify pgrst, 'reload schema';
commit;
