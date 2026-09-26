-- G2 keeps model classifications in review before creating business objects.
begin;

create table public.intelligence_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source_id uuid not null references public.intelligence_sources(id) on delete cascade,
  title_zh text not null check (length(title_zh) between 1 and 240),
  summary_zh text not null check (length(summary_zh) between 1 and 500),
  disposition text not null check (disposition in ('source_only', 'candidate')),
  radars text[] not null default '{}' check (radars <@ array['trigger','demand','project']::text[]),
  occurrence_countries text[] not null default '{}' check (occurrence_countries <@ array['SA','AE','QA','KW','OM','BH']::text[]),
  relevance_countries text[] not null default '{}' check (relevance_countries <@ array['SA','AE','QA','KW','OM','BH']::text[]),
  importance text not null check (importance in ('low','medium','high','critical')),
  evidence_status text not null check (evidence_status in ('unverified','sourced','checked','conflict','corrected')),
  maturity text not null check (maturity in ('background','signal','demand','project','opportunity','procurement','contract')),
  urgency text not null check (urgency in ('none','research','prepare','deadline')),
  countries_zh jsonb not null default '[]'::jsonb,
  organizations_zh jsonb not null default '[]'::jsonb,
  project_zh jsonb,
  procurement_zh jsonb,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  review_status text not null check (review_status in ('source_only','pending_review','approved','rejected')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_id)
);

create table public.intelligence_hypotheses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  candidate_id uuid not null references public.intelligence_candidates(id) on delete cascade,
  claim_zh text not null check (length(claim_zh) between 1 and 300),
  counter_evidence_zh text,
  status text not null default 'open' check (status in ('open','strengthened','weakened','confirmed','rejected','dormant')),
  created_at timestamptz not null default now()
);

create table public.intelligence_watch_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  candidate_id uuid not null references public.intelligence_candidates(id) on delete cascade,
  signal_zh text not null check (length(signal_zh) between 1 and 240),
  status text not null default 'active' check (status in ('active','completed','expired')),
  created_at timestamptz not null default now()
);

create table public.intelligence_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  canonical_name text not null check (length(canonical_name) between 1 and 180),
  country_code text check (country_code in ('SA','AE','QA','KW','OM','BH')),
  created_at timestamptz not null default now(),
  unique (owner_id, canonical_name)
);

create table public.intelligence_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  organization_id uuid not null references public.intelligence_organizations(id) on delete cascade,
  alias text not null check (length(alias) between 1 and 180),
  language_code text,
  unique (owner_id, alias)
);

create table public.intelligence_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  candidate_id uuid not null references public.intelligence_candidates(id),
  organization_id uuid references public.intelligence_organizations(id),
  parent_project_id uuid references public.intelligence_projects(id),
  country_code text not null check (country_code in ('SA','AE','QA','KW','OM','BH')),
  canonical_name text not null check (length(canonical_name) between 1 and 240),
  stage_zh text,
  created_at timestamptz not null default now(),
  unique (owner_id, candidate_id)
);

create table public.intelligence_procurements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  project_id uuid not null references public.intelligence_projects(id) on delete cascade,
  package_name_zh text not null check (length(package_name_zh) between 1 and 240),
  stage_zh text,
  deadline_text text,
  created_at timestamptz not null default now()
);

create index intelligence_candidates_owner_time on public.intelligence_candidates(owner_id, updated_at desc);
create index intelligence_candidates_country on public.intelligence_candidates using gin(occurrence_countries);
create index intelligence_hypotheses_candidate on public.intelligence_hypotheses(candidate_id);
create index intelligence_watch_targets_candidate on public.intelligence_watch_targets(candidate_id);

alter table public.intelligence_candidates enable row level security;
alter table public.intelligence_hypotheses enable row level security;
alter table public.intelligence_watch_targets enable row level security;
alter table public.intelligence_organizations enable row level security;
alter table public.intelligence_entity_aliases enable row level security;
alter table public.intelligence_projects enable row level security;
alter table public.intelligence_procurements enable row level security;

revoke all on public.intelligence_candidates, public.intelligence_hypotheses, public.intelligence_watch_targets,
  public.intelligence_organizations, public.intelligence_entity_aliases, public.intelligence_projects,
  public.intelligence_procurements from anon, authenticated;
grant select, insert, update, delete on public.intelligence_candidates, public.intelligence_hypotheses,
  public.intelligence_watch_targets, public.intelligence_organizations, public.intelligence_entity_aliases,
  public.intelligence_projects, public.intelligence_procurements to service_role;

commit;
