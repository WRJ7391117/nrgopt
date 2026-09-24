-- Monetary spend is provider-reported. Subscription plans do not create per-call spend.
begin;

alter table public.intelligence_provider_configs
  add column if not exists billing_mode text not null default 'balance'
  check (billing_mode in ('balance','included'));

update public.intelligence_provider_configs
set billing_mode = 'included'
where provider = 'minimax';

commit;
