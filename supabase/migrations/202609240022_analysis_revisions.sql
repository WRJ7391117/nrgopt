-- Preserve validated analysis revisions separately from immutable source versions.
begin;
create table public.intelligence_analysis_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source_id uuid not null references public.intelligence_sources(id) on delete cascade,
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  extraction_zh jsonb not null,
  provider text,
  model text,
  extracted_at timestamptz,
  recorded_at timestamptz not null default now()
);
create index intelligence_analysis_revisions_source on public.intelligence_analysis_revisions(owner_id,source_id,recorded_at desc);
alter table public.intelligence_analysis_revisions enable row level security;
revoke all on public.intelligence_analysis_revisions from anon, authenticated, service_role;
grant select on public.intelligence_analysis_revisions to service_role;

insert into public.intelligence_analysis_revisions(owner_id,source_id,source_sha256,extraction_zh,provider,model,extracted_at)
  select owner_id,id,content_sha256,extraction_zh,extraction_provider,extraction_model,extracted_at
  from public.intelligence_sources where extraction_status='extracted' and extraction_zh is not null
    and extraction_source_sha256=content_sha256;

create function public.record_intelligence_analysis_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.extraction_status <> 'extracted' or new.extraction_zh is null
    or new.extraction_source_sha256 is distinct from new.content_sha256 then return new; end if;
  if tg_op='UPDATE' then
    if new.extraction_zh is not distinct from old.extraction_zh
      and new.extraction_source_sha256 is not distinct from old.extraction_source_sha256
      and new.extraction_provider is not distinct from old.extraction_provider
      and new.extraction_model is not distinct from old.extraction_model then return new; end if;
  end if;
  insert into public.intelligence_analysis_revisions(owner_id,source_id,source_sha256,extraction_zh,provider,model,extracted_at)
    values(new.owner_id,new.id,new.content_sha256,new.extraction_zh,new.extraction_provider,new.extraction_model,new.extracted_at);
  return new;
end $$;
revoke all on function public.record_intelligence_analysis_revision() from public,anon,authenticated,service_role;
create trigger intelligence_analysis_revision after insert or update on public.intelligence_sources
  for each row execute function public.record_intelligence_analysis_revision();
commit;
