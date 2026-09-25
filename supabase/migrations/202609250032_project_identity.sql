-- A project identity is assigned only after every member has a current,
-- same-scope supporting cross-check. Names alone never merge projects.
begin;

create table public.intelligence_project_identities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(owner_id,id)
);
alter table public.intelligence_project_identities enable row level security;
revoke all on public.intelligence_project_identities from public,anon,authenticated;
grant select,insert on public.intelligence_project_identities to service_role;

alter table public.intelligence_projects
  add column identity_id uuid,
  add constraint intelligence_projects_identity_owner
    foreign key(owner_id,identity_id) references public.intelligence_project_identities(owner_id,id);
create index intelligence_projects_identity on public.intelligence_projects(owner_id,identity_id)
  where identity_id is not null;

create function public.link_intelligence_project_identity(p_owner_id uuid, p_left_project_id uuid, p_right_project_id uuid)
returns uuid language plpgsql as $$
declare target_id uuid; left_id uuid; right_id uuid; member_count integer;
begin
  if p_left_project_id=p_right_project_id then raise exception 'distinct_projects_required'; end if;
  -- Serialize identity assignments for this owner; concurrent checks cannot form incompatible groups.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select identity_id into left_id from public.intelligence_projects
    where id=p_left_project_id and owner_id=p_owner_id and current_in_analysis for update;
  if not found then raise exception 'project_missing'; end if;
  select identity_id into right_id from public.intelligence_projects
    where id=p_right_project_id and owner_id=p_owner_id and current_in_analysis for update;
  if not found then raise exception 'project_missing'; end if;
  if left_id is not null and right_id is not null and left_id<>right_id then
    raise exception 'identity_conflict';
  end if;

  with members as (
    select p.id,p.owner_id,p.country_code,p.candidate_id,c.disposition,c.review_status,
      c.source_sha256,c.occurrence_countries,s.content_sha256,s.extraction_source_sha256,
      s.extraction_status,s.extracted_at
    from public.intelligence_projects p
      join public.intelligence_candidates c on c.id=p.candidate_id and c.owner_id=p.owner_id
      join public.intelligence_sources s on s.id=c.source_id and s.owner_id=p.owner_id
    where p.owner_id=p_owner_id and p.current_in_analysis and
      (p.id in (p_left_project_id,p_right_project_id)
        or (coalesce(left_id,right_id) is not null and p.identity_id=coalesce(left_id,right_id)))
  )
  select count(*) into member_count from members;
  if member_count<2 then raise exception 'project_missing'; end if;

  if exists (
    with members as (
      select p.id,p.country_code,p.candidate_id,c.disposition,c.review_status,c.source_sha256,
        c.occurrence_countries,s.content_sha256,s.extraction_source_sha256,s.extraction_status,s.extracted_at
      from public.intelligence_projects p
        join public.intelligence_candidates c on c.id=p.candidate_id and c.owner_id=p.owner_id
        join public.intelligence_sources s on s.id=c.source_id and s.owner_id=p.owner_id
      where p.owner_id=p_owner_id and p.current_in_analysis and
        (p.id in (p_left_project_id,p_right_project_id)
          or (coalesce(left_id,right_id) is not null and p.identity_id=coalesce(left_id,right_id)))
    )
    select 1 from members l join members r on l.id<r.id
    where l.country_code<>r.country_code or not (l.occurrence_countries && r.occurrence_countries)
      or l.disposition<>'candidate' or r.disposition<>'candidate'
      or l.review_status<>r.review_status
      or l.extraction_status<>'extracted' or r.extraction_status<>'extracted'
      or l.source_sha256<>l.content_sha256 or r.source_sha256<>r.content_sha256
      or l.extraction_source_sha256<>l.content_sha256 or r.extraction_source_sha256<>r.content_sha256
      or not exists (
        select 1 from public.intelligence_candidate_relations relation
        where relation.owner_id=p_owner_id and relation.relation='supports' and relation.same_scope=true
          and ((relation.candidate_id=l.candidate_id and relation.related_candidate_id=r.candidate_id
            and relation.left_source_sha256=l.content_sha256 and relation.right_source_sha256=r.content_sha256
            and relation.left_extracted_at=l.extracted_at and relation.right_extracted_at=r.extracted_at)
          or (relation.candidate_id=r.candidate_id and relation.related_candidate_id=l.candidate_id
            and relation.left_source_sha256=r.content_sha256 and relation.right_source_sha256=l.content_sha256
            and relation.left_extracted_at=r.extracted_at and relation.right_extracted_at=l.extracted_at))
      )
  ) then raise exception 'project_identity_evidence_missing'; end if;

  target_id:=coalesce(left_id,right_id);
  if target_id is null then
    insert into public.intelligence_project_identities(owner_id) values(p_owner_id) returning id into target_id;
  end if;
  update public.intelligence_projects set identity_id=target_id
    where owner_id=p_owner_id and id in (p_left_project_id,p_right_project_id) and identity_id is distinct from target_id;
  return target_id;
end $$;
revoke all on function public.link_intelligence_project_identity(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_intelligence_project_identity(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
