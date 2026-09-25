-- A timeline is a persistent, fully supported identity, not a transitive relation chain.
begin;
create or replace function public.intelligence_project_timeline(p_owner_id uuid, p_source_id uuid)
returns jsonb language sql stable as $$
  with eligible as (
    select c.*, p.identity_id, p.country_code as project_country_code,
      s.final_url, s.content_sha256, s.extracted_at, s.extraction_zh,
      s.publication_date, s.fetched_at
    from public.intelligence_candidates c
      join public.intelligence_sources s on s.id=c.source_id and s.owner_id=c.owner_id
      join public.intelligence_projects p on p.candidate_id=c.id and p.owner_id=c.owner_id and p.current_in_analysis
    where c.owner_id=p_owner_id and c.disposition='candidate' and c.project_zh is not null
      and s.extraction_status='extracted' and s.extraction_source_sha256=s.content_sha256
      and c.source_sha256=s.content_sha256
  ), seed as (
    select id,identity_id from eligible where source_id=p_source_id order by created_at,id limit 1
  ), group_members as (
    select e.* from eligible e join seed s on e.identity_id=s.identity_id where s.identity_id is not null
  ), group_valid as (
    select (select count(*) from group_members)>=2 and not exists (
      select 1 from group_members l join group_members r on l.id<r.id
      where l.project_country_code<>r.project_country_code
        or (l.occurrence_countries && r.occurrence_countries) is not true
        or l.review_status<>r.review_status
        or not exists (
          select 1 from public.intelligence_candidate_relations relation
          where relation.owner_id=p_owner_id and relation.relation='supports' and relation.same_scope=true
            and ((relation.candidate_id=l.id and relation.related_candidate_id=r.id
              and relation.left_source_sha256=l.content_sha256 and relation.right_source_sha256=r.content_sha256
              and relation.left_extracted_at=l.extracted_at and relation.right_extracted_at=r.extracted_at)
            or (relation.candidate_id=r.id and relation.related_candidate_id=l.id
              and relation.left_source_sha256=r.content_sha256 and relation.right_source_sha256=l.content_sha256
              and relation.left_extracted_at=r.extracted_at and relation.right_extracted_at=l.extracted_at))
        )
    ) as valid
  ), members as (
    select e.* from eligible e join seed s on e.id=s.id
    union
    select e.* from group_members e where (select valid from group_valid)
  ), entries as (
    select jsonb_build_object('candidate_id',id,'source_id',source_id,'title_zh',title_zh,'url',final_url,
      'publication_date',publication_date,'fetched_at',fetched_at,'maturity',maturity,'project',project_zh,
      'procurement',procurement_zh,
      'project_evidence',extraction_zh->'known_facts'->((project_zh->>'evidence_fact_number')::int-1),
      'procurement_evidence',extraction_zh->'known_facts'->((procurement_zh->>'evidence_fact_number')::int-1)) as entry,
      publication_date,fetched_at,id
    from members order by publication_date nulls last,fetched_at,id limit 100
  ) select jsonb_build_object('identity_id',case when (select valid from group_valid)
        then (select identity_id from seed) end,
      'anchor_source_id',(select source_id from members order by created_at,id limit 1),
      'total',(select count(*) from members),
      'entries',coalesce((select jsonb_agg(entry order by publication_date nulls last,fetched_at,id) from entries),'[]'::jsonb));
$$;
revoke all on function public.intelligence_project_timeline(uuid,uuid) from public,anon,authenticated;
grant execute on function public.intelligence_project_timeline(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
