-- Preserve independent package identity and audit changes instead of deleting old records.
begin;
alter table public.intelligence_projects add column current_in_analysis boolean not null default true;
alter table public.intelligence_procurements
  add column current_in_analysis boolean not null default true,
  add column scope text not null default 'unspecified' check(scope in ('unspecified','development_rights','ppa','epc','construction_contract','equipment','service')),
  add column stage_code text,
  add column evidence_fact_number integer,
  add column evidence_quote text,
  add column scope_text text,
  add column stage_text text;
drop index public.intelligence_procurements_owner_project_package;
create unique index intelligence_procurements_owner_project_scope_package
  on public.intelligence_procurements(owner_id,project_id,scope,package_name_zh);
create table public.intelligence_business_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  project_id uuid references public.intelligence_projects(id),
  procurement_id uuid references public.intelligence_procurements(id),
  source_id uuid not null references public.intelligence_sources(id),
  source_sha256 text not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  check ((project_id is not null)::int+(procurement_id is not null)::int=1)
);
alter table public.intelligence_business_history enable row level security;
revoke all on public.intelligence_business_history from public,anon,authenticated;
grant select,insert on public.intelligence_business_history to service_role;
grant usage on sequence public.intelligence_business_history_id_seq to service_role;
create function public.record_intelligence_business_history() returns trigger language plpgsql as $$
declare source uuid; source_hash text; project uuid;
begin
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return new; end if;
  if tg_table_name='intelligence_projects' then
    select c.source_id,c.source_sha256 into source,source_hash from public.intelligence_candidates c where c.id=new.candidate_id and c.owner_id=new.owner_id;
    project:=new.id;
  else
    select c.source_id,c.source_sha256 into source,source_hash from public.intelligence_projects p
      join public.intelligence_candidates c on c.id=p.candidate_id and c.owner_id=p.owner_id where p.id=new.project_id and p.owner_id=new.owner_id;
  end if;
  if source is null then raise exception 'business_source_missing';end if;
  insert into public.intelligence_business_history(owner_id,project_id,procurement_id,source_id,source_sha256,snapshot)
    values(new.owner_id,project,case when project is null then new.id end,source,source_hash,to_jsonb(new)-'owner_id');
  return new;
end $$;
create trigger intelligence_project_history after insert or update on public.intelligence_projects
for each row execute function public.record_intelligence_business_history();
create trigger intelligence_procurement_history after insert or update on public.intelligence_procurements
for each row execute function public.record_intelligence_business_history();
revoke all on function public.record_intelligence_business_history() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
