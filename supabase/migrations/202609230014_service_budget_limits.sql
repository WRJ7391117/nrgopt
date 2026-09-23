-- Replace user-facing per-call reserves with one monthly limit per configured service.
begin;

alter table public.intelligence_provider_configs
  rename column reserve_micro to budget_limit_micro;

alter table public.intelligence_provider_configs
  drop constraint if exists intelligence_provider_configs_cross_check_reserve_micro_check,
  add column budget_reserved_micro bigint not null default 0 check (budget_reserved_micro >= 0),
  add column budget_spent_micro bigint not null default 0 check (budget_spent_micro >= 0),
  add column budget_period_start date not null default date_trunc('month', current_date)::date,
  add column budget_period_end date not null default (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  add column budget_enabled boolean not null default true,
  add check (budget_period_end >= budget_period_start),
  add check (budget_reserved_micro + budget_spent_micro <= budget_limit_micro);

create or replace function public.reserve_intelligence_budget(
  p_owner_id uuid, p_job_run_id uuid, p_operation text, p_currency text,
  p_idempotency_key text, p_reserve_micro bigint
) returns uuid language plpgsql as $$
declare
  v_capability text;
  v_config public.intelligence_provider_configs%rowtype;
  v_id uuid;
  v_period_start date := date_trunc('month', current_date)::date;
  v_period_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  if p_operation not in ('discovery','extraction','cross_check') or p_currency not in ('CNY','USD')
     or p_reserve_micro <= 0 or p_idempotency_key is null
     or length(p_idempotency_key) not between 1 and 200 then return null; end if;
  if p_job_run_id is not null and not exists (
    select 1 from public.intelligence_job_runs where id = p_job_run_id and owner_id = p_owner_id
  ) then return null; end if;

  select id into v_id from public.intelligence_budget_reservations
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  v_capability := case when p_operation = 'discovery' then 'discovery' else 'analysis' end;
  select * into v_config from public.intelligence_provider_configs
  where owner_id = p_owner_id and capability = v_capability for update;
  if v_config.owner_id is null or not v_config.budget_enabled or v_config.currency <> p_currency then return null; end if;

  if current_date not between v_config.budget_period_start and v_config.budget_period_end then
    update public.intelligence_budget_reservations set cost_status = 'released', settled_at = now()
    where owner_id = p_owner_id and cost_status = 'reserved'
      and (case when operation = 'discovery' then 'discovery' else 'analysis' end) = v_capability;
    update public.intelligence_provider_configs set
      budget_reserved_micro = 0, budget_spent_micro = 0,
      budget_period_start = v_period_start, budget_period_end = v_period_end, updated_at = now()
    where owner_id = p_owner_id and capability = v_capability;
    v_config.budget_reserved_micro := 0;
    v_config.budget_spent_micro := 0;
  end if;

  if v_config.budget_reserved_micro + v_config.budget_spent_micro + p_reserve_micro > v_config.budget_limit_micro then
    return null;
  end if;
  insert into public.intelligence_budget_reservations(
    owner_id, job_run_id, operation, currency, idempotency_key, reserved_micro
  ) values (
    p_owner_id, p_job_run_id, p_operation, p_currency, p_idempotency_key, p_reserve_micro
  ) returning intelligence_budget_reservations.id into v_id;
  update public.intelligence_provider_configs
  set budget_reserved_micro = budget_reserved_micro + p_reserve_micro, updated_at = now()
  where owner_id = p_owner_id and capability = v_capability;
  return v_id;
end $$;

create or replace function public.release_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid
) returns boolean language plpgsql as $$
declare
  v_reservation public.intelligence_budget_reservations%rowtype;
  v_capability text;
begin
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null then return false; end if;
  v_capability := case when v_reservation.operation = 'discovery' then 'discovery' else 'analysis' end;
  update public.intelligence_provider_configs
  set budget_reserved_micro = budget_reserved_micro - v_reservation.reserved_micro, updated_at = now()
  where owner_id = p_owner_id and capability = v_capability
    and budget_reserved_micro >= v_reservation.reserved_micro;
  if not found then return false; end if;
  update public.intelligence_budget_reservations set cost_status = 'released', settled_at = now()
  where id = p_reservation_id;
  return true;
end $$;

create or replace function public.settle_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid, p_charged_micro bigint, p_cost_status text,
  p_provider text, p_model text, p_usage jsonb, p_pricing_version text
) returns boolean language plpgsql as $$
declare
  v_reservation public.intelligence_budget_reservations%rowtype;
  v_capability text;
begin
  if p_cost_status not in ('estimated','actual') or p_charged_micro <= 0
     or (p_provider is not null and length(p_provider) not between 1 and 80)
     or (p_model is not null and length(p_model) not between 1 and 120)
     or (p_usage is not null and jsonb_typeof(p_usage) <> 'object')
     or (p_pricing_version is not null and length(p_pricing_version) not between 1 and 160) then return false; end if;
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null or p_charged_micro > v_reservation.reserved_micro then return false; end if;
  v_capability := case when v_reservation.operation = 'discovery' then 'discovery' else 'analysis' end;
  update public.intelligence_provider_configs set
    budget_reserved_micro = budget_reserved_micro - v_reservation.reserved_micro,
    budget_spent_micro = budget_spent_micro + p_charged_micro, updated_at = now()
  where owner_id = p_owner_id and capability = v_capability
    and budget_reserved_micro >= v_reservation.reserved_micro;
  if not found then return false; end if;
  update public.intelligence_budget_reservations set charged_micro = p_charged_micro,
    cost_status = p_cost_status, provider = p_provider, model = p_model, usage = p_usage,
    pricing_version = p_pricing_version, settled_at = now() where id = p_reservation_id;
  return true;
end $$;

commit;
