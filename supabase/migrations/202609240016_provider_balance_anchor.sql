-- Track only provider-reported balance changes. A provider may round its balance,
-- so one call can remain unpriced until later calls move the reported balance.
begin;

alter table public.intelligence_provider_configs
  add column provider_balance_anchor_micro bigint check (provider_balance_anchor_micro >= 0),
  add column provider_balance_anchor_spent_micro bigint check (provider_balance_anchor_spent_micro >= 0),
  add column provider_balance_last_micro bigint check (provider_balance_last_micro >= 0),
  add column provider_balance_synced_at timestamptz;

-- Actual provider spend can cross a configured cap between two balance reads.
-- The reserve function remains the enforcement point for future calls.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.intelligence_provider_configs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%budget_reserved_micro%budget_spent_micro%budget_limit_micro%'
  loop
    execute format('alter table public.intelligence_provider_configs drop constraint %I', v_constraint.conname);
  end loop;
end $$;

create or replace function public.sync_intelligence_provider_balance(
  p_owner_id uuid, p_capability text, p_currency text, p_balance_micro bigint
) returns boolean language plpgsql as $$
declare
  v_config public.intelligence_provider_configs%rowtype;
  v_confirmed_spent bigint;
  v_period_start date := date_trunc('month', current_date)::date;
  v_period_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  if p_capability not in ('discovery','analysis') or p_currency not in ('CNY','USD')
     or p_balance_micro < 0 then return false; end if;

  select * into v_config from public.intelligence_provider_configs
  where owner_id = p_owner_id and capability = p_capability for update;
  if v_config.owner_id is null or v_config.currency <> p_currency or v_config.billing_mode <> 'balance' then
    return false;
  end if;

  if current_date not between v_config.budget_period_start and v_config.budget_period_end then
    update public.intelligence_budget_reservations set cost_status = 'released', settled_at = now()
    where owner_id = p_owner_id and cost_status = 'reserved'
      and (case when operation = 'discovery' then 'discovery' else 'analysis' end) = p_capability;
    update public.intelligence_provider_configs set
      budget_reserved_micro = 0, budget_spent_micro = 0,
      budget_period_start = v_period_start, budget_period_end = v_period_end,
      provider_balance_anchor_micro = null, provider_balance_anchor_spent_micro = null,
      provider_balance_last_micro = null, provider_balance_synced_at = null, updated_at = now()
    where owner_id = p_owner_id and capability = p_capability
    returning * into v_config;
  end if;

  if v_config.provider_balance_anchor_micro is null
     or v_config.provider_balance_anchor_spent_micro is null
     or v_config.provider_balance_last_micro is null
     or p_balance_micro > v_config.provider_balance_last_micro then
    update public.intelligence_provider_configs set
      provider_balance_anchor_micro = p_balance_micro,
      provider_balance_anchor_spent_micro = budget_spent_micro,
      provider_balance_last_micro = p_balance_micro,
      provider_balance_synced_at = now(), updated_at = now()
    where owner_id = p_owner_id and capability = p_capability;
    return true;
  end if;

  v_confirmed_spent := v_config.provider_balance_anchor_spent_micro
    + greatest(v_config.provider_balance_anchor_micro - p_balance_micro, 0);
  update public.intelligence_provider_configs set
    budget_spent_micro = greatest(budget_spent_micro, v_confirmed_spent),
    provider_balance_last_micro = p_balance_micro,
    provider_balance_synced_at = now(), updated_at = now()
  where owner_id = p_owner_id and capability = p_capability;
  return true;
end $$;

revoke all on function public.sync_intelligence_provider_balance(uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.sync_intelligence_provider_balance(uuid,text,text,bigint) to service_role;

-- Reset the provider anchor with the monthly service budget.
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
      budget_period_start = v_period_start, budget_period_end = v_period_end,
      provider_balance_anchor_micro = null, provider_balance_anchor_spent_micro = null,
      provider_balance_last_micro = null, provider_balance_synced_at = null, updated_at = now()
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

commit;
