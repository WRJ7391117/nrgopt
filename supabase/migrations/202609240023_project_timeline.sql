-- A partial portfolio overlap does not establish one project identity.
begin;
alter table public.intelligence_analysis_revisions add column revision_no bigint generated always as identity;
alter table public.intelligence_candidate_relations
  add column same_scope boolean,
  add column left_source_sha256 text,
  add column right_source_sha256 text,
  add column left_extracted_at timestamptz,
  add column right_extracted_at timestamptz;

create function public.intelligence_project_timeline(p_owner_id uuid, p_source_id uuid)
returns jsonb language sql stable as $$
  with recursive eligible as (
    select c.*, s.final_url, s.content_sha256, s.extracted_at, s.extraction_zh, s.publication_date, s.fetched_at
    from public.intelligence_candidates c join public.intelligence_sources s on s.id=c.source_id and s.owner_id=c.owner_id
    where c.owner_id=p_owner_id and c.disposition='candidate' and c.project_zh is not null
      and s.extraction_status='extracted' and s.extraction_source_sha256=s.content_sha256 and c.source_sha256=s.content_sha256
  ), edges as (
    select r.candidate_id, r.related_candidate_id from public.intelligence_candidate_relations r
      join eligible l on l.id=r.candidate_id join eligible rr on rr.id=r.related_candidate_id
    where r.owner_id=p_owner_id and r.same_scope=true and l.occurrence_countries && rr.occurrence_countries
      and r.left_source_sha256=l.content_sha256 and r.right_source_sha256=rr.content_sha256
      and r.left_extracted_at=l.extracted_at and r.right_extracted_at=rr.extracted_at
  ), connected(id) as (
    select id from eligible where source_id=p_source_id
    union
    select e.related_candidate_id from edges e join connected n on n.id=e.candidate_id
  ), members as (
    select e.* from eligible e join connected n on n.id=e.id
  ), anchor as (
    select id,source_id from members order by created_at,id limit 1
  ), entries as (
    select jsonb_build_object('candidate_id',id,'source_id',source_id,'title_zh',title_zh,'url',final_url,
      'publication_date',publication_date,'fetched_at',fetched_at,'maturity',maturity,'project',project_zh,
      'procurement',procurement_zh,
      'project_evidence',extraction_zh->'known_facts'->((project_zh->>'evidence_fact_number')::int-1),
      'procurement_evidence',extraction_zh->'known_facts'->((procurement_zh->>'evidence_fact_number')::int-1)) as entry,
      publication_date,fetched_at,id
    from members order by publication_date nulls last,fetched_at,id limit 100
  ) select jsonb_build_object('identity_id',(select id from anchor),'anchor_source_id',(select source_id from anchor),
      'total',(select count(*) from members),'entries',coalesce((select jsonb_agg(entry order by publication_date nulls last,fetched_at,id) from entries),'[]'::jsonb));
$$;
revoke all on function public.intelligence_project_timeline(uuid,uuid) from public,anon,authenticated;
grant execute on function public.intelligence_project_timeline(uuid,uuid) to service_role;
commit;
