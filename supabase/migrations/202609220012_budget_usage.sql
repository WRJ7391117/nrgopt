-- Keep provider usage and the applied price version with each settled reservation.
begin;

alter table public.intelligence_budget_reservations
  add column provider text check (provider is null or length(provider) between 1 and 80),
  add column model text check (model is null or length(model) between 1 and 120),
  add column usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  add column pricing_version text check (pricing_version is null or length(pricing_version) between 1 and 160);

drop function public.settle_intelligence_budget(uuid,uuid,bigint,text);

create function public.settle_intelligence_budget(
  p_owner_id uuid, p_reservation_id uuid, p_charged_micro bigint, p_cost_status text,
  p_provider text, p_model text, p_usage jsonb, p_pricing_version text
) returns boolean language plpgsql as $$
declare v_reservation public.intelligence_budget_reservations%rowtype;
begin
  if p_cost_status not in ('estimated','actual') or p_charged_micro <= 0
     or (p_provider is not null and length(p_provider) not between 1 and 80)
     or (p_model is not null and length(p_model) not between 1 and 120)
     or (p_usage is not null and jsonb_typeof(p_usage) <> 'object')
     or (p_pricing_version is not null and length(p_pricing_version) not between 1 and 160) then return false; end if;
  select * into v_reservation from public.intelligence_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id and cost_status = 'reserved' for update;
  if v_reservation.id is null or p_charged_micro > v_reservation.reserved_micro then return false; end if;
  update public.intelligence_budget_accounts set
    reserved_micro = reserved_micro - v_reservation.reserved_micro,
    spent_micro = spent_micro + p_charged_micro, updated_at = now()
  where owner_id = p_owner_id and currency = v_reservation.currency;
  update public.intelligence_budget_reservations set charged_micro = p_charged_micro,
    cost_status = p_cost_status, provider = p_provider, model = p_model, usage = p_usage,
    pricing_version = p_pricing_version, settled_at = now() where id = p_reservation_id;
  return true;
end $$;

revoke all on function public.settle_intelligence_budget(uuid,uuid,bigint,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.settle_intelligence_budget(uuid,uuid,bigint,text,text,text,jsonb,text) to service_role;

commit;
