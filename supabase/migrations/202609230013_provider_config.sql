-- Store administrator-managed provider profiles without exposing API keys to the browser.
begin;

create table public.intelligence_provider_configs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('discovery','analysis')),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  endpoint text not null check (endpoint ~ '^https://[^[:space:]]+$' and length(endpoint) <= 500),
  model text not null check (length(model) between 1 and 160),
  currency text not null check (currency in ('CNY','USD')),
  reserve_micro bigint not null check (reserve_micro > 0),
  cross_check_reserve_micro bigint check (
    (capability = 'analysis' and cross_check_reserve_micro > 0)
    or (capability = 'discovery' and cross_check_reserve_micro is null)
  ),
  api_key_ciphertext text not null check (length(api_key_ciphertext) between 20 and 12000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, capability)
);

alter table public.intelligence_provider_configs enable row level security;
revoke all on table public.intelligence_provider_configs from public, anon, authenticated;
grant select, insert, update on table public.intelligence_provider_configs to service_role;

commit;
