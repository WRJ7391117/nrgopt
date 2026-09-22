-- G3 persistent daily jobs and atomic paid-call budget reservations.
begin;

create table public.intelligence_job_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  job_type text not null check (job_type in ('daily_scan')),
  schedule_key text not null check (length(schedule_key) between 1 and 120),
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','retry','failed','budget_paused','manual_paused')),
  checkpoint jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, job_type, schedule_key)
);

create table public.intelligence_job_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  job_run_id uuid not null references public.intelligence_job_runs(id) on delete cascade,
  item_key text not null check (length(item_key) between 1 and 160),
  status text not null default 'queued' check (status in ('queued','running','succeeded','retry','failed','budget_paused','manual_paused')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  checkpoint jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, job_run_id, item_key)
);

create table public.intelligence_budget_accounts (
  owner_id uuid primary key references auth.users(id),
  currency text not null default 'USD' check (currency = 'USD'),
  limit_microusd bigint not null check (limit_microusd > 0),
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0),
  period_start date not null,
  period_end date not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (reserved_microusd + spent_microusd <= limit_microusd)
);

create table public.intelligence_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  job_run_id uuid references public.intelligence_job_runs(id) on delete cascade,
  operation text not null check (operation in ('discovery','extraction','cross_check')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  charged_microusd bigint check (charged_microusd > 0 and charged_microusd <= reserved_microusd),
  cost_status text not null default 'reserved' check (cost_status in ('reserved','estimated','actual','released')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create index intelligence_job_items_claim on public.intelligence_job_items(owner_id, job_run_id, status, next_attempt_at);
create index intelligence_budget_reservations_job on public.intelligence_budget_reservations(owner_id, job_run_id);

alter table public.intelligence_job_runs enable row level security;
alter table public.intelligence_job_items enable row level security;
alter table public.intelligence_budget_accounts enable row level security;
alter table public.intelligence_budget_reservations enable row level security;

revoke all on public.intelligence_job_runs, public.intelligence_job_items,
  public.intelligence_budget_accounts, public.intelligence_budget_reservations from anon, authenticated;
grant select, insert, update, delete on public.intelligence_job_runs, public.intelligence_job_items,
  public.intelligence_budget_accounts, public.intelligence_budget_reservations to service_role;

create or replace function public.enqueue_intelligence_job(
  p_owner_id uuid, p_job_type text, p_schedule_key text, p_item_keys text[]
) returns uuid language plpgsql as $$
declare v_job_id uuid;
begin
  if p_job_type <> 'daily_scan' or p_schedule_key is null or length(p_schedule_key) not between 1 and 120
     or coalesce(array_length(p_item_keys, 1), 0) = 0 then
    raise exception 'invalid_job';
  end if;
  insert into public.intelligence_job_runs(owner_id, job_type, schedule_key)
  values (p_owner_id, p_job_type, p_schedule_key)
  on conflict (owner_id, job_type, schedule_key) do nothing
  returning id into v_job_id;
  if v_job_id is null then
    select id into v_job_id from public.intelligence_job_runs
    where owner_id = p_owner_id and job_type = p_job_type and schedule_key = p_schedule_key;
  end if;
  insert into public.intelligence_job_items(owner_id, job_run_id, item_key)
  select p_owner_id, v_job_id, item_key from unnest(p_item_keys) item_key
  where length(item_key) between 1 and 160
  on conflict (owner_id, job_run_id, item_key) do nothing;
  return v_job_id;
end $$;

create or replace function public.claim_intelligence_job_item(
  p_owner_id uuid, p_job_run_id uuid, p_lease_seconds integer default 240
) returns table(id uuid, item_key text, attempts smallint, checkpoint jsonb) language plpgsql as $$
declare v_item public.intelligence_job_items%rowtype;
begin
  if p_lease_seconds not between 30 and 300 then raise exception 'invalid_lease'; end if;
  select i.* into v_item from public.intelligence_job_items i
  where i.owner_id = p_owner_id and i.job_run_id = p_job_run_id and i.attempts < 3
    and ((i.status in ('queued','retry') and i.next_attempt_at <= now())
      or (i.status = 'running' and i.lease_until < now()))
  order by i.item_key for update skip locked limit 1;
  if v_item.id is null then return; end if;
  update public.intelligence_job_items set status = 'running', attempts = intelligence_job_items.attempts + 1,
    lease_until = now() + make_interval(secs => p_lease_seconds), started_at = coalesce(intelligence_job_items.started_at, now()),
    updated_at = now(), error_code = null where intelligence_job_items.id = v_item.id
  returning intelligence_job_items.id, intelligence_job_items.item_key, intelligence_job_items.attempts,
    intelligence_job_items.checkpoint into id, item_key, attempts, checkpoint;
  update public.intelligence_job_runs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where intelligence_job_runs.id = p_job_run_id and owner_id = p_owner_id and status not in ('manual_paused','succeeded');
  return next;
end $$;

create or replace function public.finish_intelligence_job_item(
  p_owner_id uuid, p_item_id uuid, p_status text, p_checkpoint jsonb default '{}'::jsonb, p_error_code text default null
) returns boolean language plpgsql as $$
declare v_job_id uuid; v_attempts smallint; v_run_status text;
begin
  if p_status not in ('succeeded','retry','failed','budget_paused','manual_paused') then return false; end if;
  select job_run_id, attempts into v_job_id, v_attempts from public.intelligence_job_items
  where id = p_item_id and owner_id = p_owner_id and status = 'running' for update;
  if v_job_id is null then return false; end if;
  if p_status = 'retry' and v_attempts >= 3 then p_status := 'failed'; end if;
  update public.intelligence_job_items set status = p_status, checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
    error_code = p_error_code, lease_until = null,
    next_attempt_at = case when p_status = 'retry' then now() + make_interval(mins => greatest(v_attempts, 1) * 5) else next_attempt_at end,
    finished_at = case when p_status in ('succeeded','failed','budget_paused','manual_paused') then now() else null end,
    updated_at = now() where id = p_item_id;
  if exists (select 1 from public.intelligence_job_items where job_run_id = v_job_id and status in ('queued','running','retry')) then
    v_run_status := 'running';
  elsif exists (select 1 from public.intelligence_job_items where job_run_id = v_job_id and status = 'failed') then
    v_run_status := case when exists (select 1 from public.intelligence_job_items where job_run_id = v_job_id and status = 'succeeded') then 'partial' else 'failed' end;
  elsif exists (select 1 from public.intelligence_job_items where job_run_id = v_job_id and status = 'budget_paused') then
    v_run_status := 'budget_paused';
  elsif exists (select 1 from public.intelligence_job_items where job_run_id = v_job_id and status = 'manual_paused') then
    v_run_status := 'manual_paused';
  else v_run_status := 'succeeded'; end if;
  update public.intelligence_job_runs set status = v_run_status, error_code = p_error_code,
    finished_at = case when v_run_status in ('succeeded','partial','failed','budget_paused','manual_paused') then now() else null end,
    updated_at = now() where id = v_job_id and owner_id = p_owner_id;
  return true;
end $$;

create or replace function public.reserve_intelligence_budget(
  p_owner_id uuid, p_job_run_id uuid, p_operation text, p_idempotency_key text, p_reserve_microusd bigint
) returns uuid language plpgsql as $$
declare v_account public.intelligence_budget_accounts%rowtype; v_id uuid;
begin
  if p_operation not in ('discovery','extraction','cross_check') or p_reserve_microusd <= 0
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 then return null; end if;
  if p_job_run_id is not null and not exists (
    select 1 from public.intelligence_job_runs where id = p_job_run_id and owner_id = p_owner_id
  ) then return null; end if;
  select id into v_id from public.intelligence_budget_reservations
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;
  select * into v_account from public.intelligence_budget_accounts where owner_id = p_owner_id for update;
  if v_account.owner_id is null or not v_account.enabled or current_date not between v_account.period_start and v_account.period_end
     or v_account.reserved_microusd + v_account.spent_microusd + p_reserve_microusd > v_account.limit_microusd then return null; end if;
  insert into public.intelligence_budget_reservations(owner_id, job_run_id, operation, idempotency_key, reserved_microusd)
  values (p_owner_id, p_job_run_id, p_operation, p_idempotency_key, p_reserve_microusd) returning intelligence_budget_reservations.id into v_id;
  update public.intelligence_budget_accounts set reserved_microusd = reserved_microusd + p_reserve_microusd, updated_at = now()
  where owner_id = p_owner_id;
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
  update public.intelligence_budget_accounts set
    reserved_microusd = reserved_microusd - v_reservation.reserved_microusd, updated_at = now()
  where owner_id = p_owner_id;
  update public.intelligence_budget_reservations set cost_status = 'released', settled_at = now()
  where id = p_reservation_id;
  return true;
end $$;

create or replace function public.settle_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid, p_charged_microusd bigint, p_cost_status text
) returns boolean language plpgsql as $$
declare v_reservation public.intelligence_budget_reservations%rowtype;
begin
  if p_cost_status not in ('estimated','actual') or p_charged_microusd <= 0 then return false; end if;
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null or p_charged_microusd > v_reservation.reserved_microusd then return false; end if;
  update public.intelligence_budget_accounts set
    reserved_microusd = reserved_microusd - v_reservation.reserved_microusd,
    spent_microusd = spent_microusd + p_charged_microusd, updated_at = now()
  where owner_id = p_owner_id;
  update public.intelligence_budget_reservations set charged_microusd = p_charged_microusd,
    cost_status = p_cost_status, settled_at = now() where id = p_reservation_id;
  return true;
end $$;

revoke all on function public.enqueue_intelligence_job(uuid,text,text,text[]) from public, anon, authenticated;
revoke all on function public.claim_intelligence_job_item(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_intelligence_job_item(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.reserve_intelligence_budget(uuid,uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function public.settle_intelligence_budget(uuid,uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.release_intelligence_budget(uuid,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_intelligence_job(uuid,text,text,text[]) to service_role;
grant execute on function public.claim_intelligence_job_item(uuid,uuid,integer) to service_role;
grant execute on function public.finish_intelligence_job_item(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.reserve_intelligence_budget(uuid,uuid,text,text,bigint) to service_role;
grant execute on function public.settle_intelligence_budget(uuid,uuid,bigint,text) to service_role;
grant execute on function public.release_intelligence_budget(uuid,uuid) to service_role;

commit;
