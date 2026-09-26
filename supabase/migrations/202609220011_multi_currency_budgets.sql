-- Separate model budgets by billing currency. Chinese providers use CNY; future US providers may use USD.
begin;

alter table public.intelligence_budget_accounts drop constraint intelligence_budget_accounts_pkey;
alter table public.intelligence_budget_accounts drop constraint intelligence_budget_accounts_currency_check;
alter table public.intelligence_budget_accounts alter column currency set default 'CNY';
alter table public.intelligence_budget_accounts add check (currency in ('CNY','USD'));
alter table public.intelligence_budget_accounts rename column limit_microusd to limit_micro;
alter table public.intelligence_budget_accounts rename column reserved_microusd to reserved_micro;
alter table public.intelligence_budget_accounts rename column spent_microusd to spent_micro;
alter table public.intelligence_budget_accounts add primary key (owner_id, currency);

alter table public.intelligence_budget_reservations add column currency text;
update public.intelligence_budget_reservations r set currency = a.currency
from public.intelligence_budget_accounts a where a.owner_id = r.owner_id;
alter table public.intelligence_budget_reservations alter column currency set not null;
alter table public.intelligence_budget_reservations add check (currency in ('CNY','USD'));
alter table public.intelligence_budget_reservations rename column reserved_microusd to reserved_micro;
alter table public.intelligence_budget_reservations rename column charged_microusd to charged_micro;

drop function public.reserve_intelligence_budget(uuid,uuid,text,text,bigint);
drop function public.settle_intelligence_budget(uuid,uuid,bigint,text);

create function public.reserve_intelligence_budget(
  p_owner_id uuid, p_job_run_id uuid, p_operation text, p_currency text,
  p_idempotency_key text, p_reserve_micro bigint
) returns uuid language plpgsql as $$
declare v_account public.intelligence_budget_accounts%rowtype; v_id uuid;
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
  select * into v_account from public.intelligence_budget_accounts
  where owner_id = p_owner_id and currency = p_currency for update;
  if v_account.owner_id is null or not v_account.enabled
     or current_date not between v_account.period_start and v_account.period_end
     or v_account.reserved_micro + v_account.spent_micro + p_reserve_micro > v_account.limit_micro then return null; end if;
  insert into public.intelligence_budget_reservations(
    owner_id, job_run_id, operation, currency, idempotency_key, reserved_micro
  ) values (
    p_owner_id, p_job_run_id, p_operation, p_currency, p_idempotency_key, p_reserve_micro
  ) returning intelligence_budget_reservations.id into v_id;
  update public.intelligence_budget_accounts
  set reserved_micro = reserved_micro + p_reserve_micro, updated_at = now()
  where owner_id = p_owner_id and currency = p_currency;
  return v_id;
end $$;

create or replace function public.release_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid
) returns boolean language plpgsql as $$
declare v_reservation public.intelligence_budget_reservations%rowtype;
begin
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null then return false; end if;
  update public.intelligence_budget_accounts
  set reserved_micro = reserved_micro - v_reservation.reserved_micro, updated_at = now()
  where owner_id = p_owner_id and currency = v_reservation.currency;
  update public.intelligence_budget_reservations set cost_status = 'released', settled_at = now()
  where id = p_reservation_id;
  return true;
end $$;

create function public.settle_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid, p_charged_micro bigint, p_cost_status text
) returns boolean language plpgsql as $$
declare v_reservation public.intelligence_budget_reservations%rowtype;
begin
  if p_cost_status not in ('estimated','actual') or p_charged_micro <= 0 then return false; end if;
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null or p_charged_micro > v_reservation.reserved_micro then return false; end if;
  update public.intelligence_budget_accounts set
    reserved_micro = reserved_micro - v_reservation.reserved_micro,
    spent_micro = spent_micro + p_charged_micro, updated_at = now()
  where owner_id = p_owner_id and currency = v_reservation.currency;
  update public.intelligence_budget_reservations set charged_micro = p_charged_micro,
    cost_status = p_cost_status, settled_at = now() where id = p_reservation_id;
  return true;
end $$;

revoke all on function public.reserve_intelligence_budget(uuid,uuid,text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.settle_intelligence_budget(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_intelligence_budget(uuid,uuid,text,text,text,bigint) to service_role;
grant execute on function public.settle_intelligence_budget(uuid,uuid,bigint,text) to service_role;

commit;
