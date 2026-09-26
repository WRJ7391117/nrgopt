begin;

create table public.intelligence_candidate_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  candidate_id uuid not null references public.intelligence_candidates(id) on delete cascade,
  related_candidate_id uuid not null references public.intelligence_candidates(id) on delete cascade,
  relation text not null check (relation in ('supports','conflicts')),
  matching_facts_zh jsonb not null default '[]'::jsonb,
  conflicting_facts_zh jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  check (candidate_id <> related_candidate_id),
  unique (owner_id, candidate_id, related_candidate_id)
);

create index intelligence_candidate_relations_candidate on public.intelligence_candidate_relations(owner_id, candidate_id);
alter table public.intelligence_candidate_relations enable row level security;
revoke all on public.intelligence_candidate_relations from anon, authenticated;
grant select, insert, update, delete on public.intelligence_candidate_relations to service_role;

commit;
