-- Equipment and service opportunities have their own evidence and participation state.
begin;
alter table public.intelligence_candidates add constraint intelligence_candidates_owner_id_unique unique(owner_id,id);
alter table public.intelligence_projects add constraint intelligence_projects_owner_id_candidate_unique unique(owner_id,id,candidate_id);
create table public.intelligence_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  candidate_id uuid not null references public.intelligence_candidates(id),
  project_id uuid not null references public.intelligence_projects(id),
  scope text not null check(scope in ('equipment','service')),
  package_name_zh text not null check(length(package_name_zh) between 1 and 240),
  participation_status text not null check(participation_status in ('unverified','public_tender_open','package_awarded','cancelled')),
  evidence_fact_number integer not null check(evidence_fact_number > 0),
  evidence_quote text not null check(length(evidence_quote) > 0),
  source_sha256 text not null check(length(source_sha256) = 64),
  current_in_analysis boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(owner_id,candidate_id,scope,package_name_zh),
  foreign key(owner_id,candidate_id) references public.intelligence_candidates(owner_id,id),
  foreign key(owner_id,project_id,candidate_id) references public.intelligence_projects(owner_id,id,candidate_id)
);
alter table public.intelligence_opportunities enable row level security;
revoke all on public.intelligence_opportunities from public,anon,authenticated;
grant select,insert,update on public.intelligence_opportunities to service_role;
create index intelligence_opportunities_owner_project on public.intelligence_opportunities(owner_id,project_id);
create table public.intelligence_opportunity_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  opportunity_id uuid not null references public.intelligence_opportunities(id),
  source_id uuid not null references public.intelligence_sources(id),
  source_sha256 text not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.intelligence_opportunity_history enable row level security;
revoke all on public.intelligence_opportunity_history from public,anon,authenticated;
grant select,insert on public.intelligence_opportunity_history to service_role;
grant usage on sequence public.intelligence_opportunity_history_id_seq to service_role;
create function public.record_intelligence_opportunity_history() returns trigger language plpgsql as $$
declare source uuid;
begin
  if tg_op='UPDATE' and to_jsonb(new)-'updated_at' is not distinct from to_jsonb(old)-'updated_at' then return new; end if;
  select source_id into source from public.intelligence_candidates
    where id=new.candidate_id and owner_id=new.owner_id;
  if source is null then raise exception 'opportunity_source_missing'; end if;
  insert into public.intelligence_opportunity_history(owner_id,opportunity_id,source_id,source_sha256,snapshot)
    values(new.owner_id,new.id,source,new.source_sha256,to_jsonb(new)-'owner_id');
  return new;
end $$;
create trigger intelligence_opportunity_history after insert or update on public.intelligence_opportunities
  for each row execute function public.record_intelligence_opportunity_history();
revoke all on function public.record_intelligence_opportunity_history() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
