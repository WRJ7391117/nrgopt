-- A saved link is historical; expose it only while both package facts and the cross-check remain current.
begin;
create function public.current_intelligence_opportunity_links(p_owner_id uuid)
returns table(left_opportunity_id uuid,right_opportunity_id uuid) language sql stable as $$
  select distinct l.left_opportunity_id,l.right_opportunity_id
  from public.intelligence_opportunity_links l
    join public.intelligence_opportunities a on a.id=l.left_opportunity_id and a.owner_id=l.owner_id
    join public.intelligence_opportunities b on b.id=l.right_opportunity_id and b.owner_id=l.owner_id
    join public.intelligence_projects pa on pa.id=a.project_id and pa.owner_id=a.owner_id
    join public.intelligence_projects pb on pb.id=b.project_id and pb.owner_id=b.owner_id
    join public.intelligence_candidates ca on ca.id=a.candidate_id and ca.owner_id=a.owner_id
    join public.intelligence_candidates cb on cb.id=b.candidate_id and cb.owner_id=b.owner_id
    join public.intelligence_sources sa on sa.id=ca.source_id and sa.owner_id=a.owner_id
    join public.intelligence_sources sb on sb.id=cb.source_id and sb.owner_id=b.owner_id
    join public.intelligence_candidate_relations r on r.owner_id=l.owner_id and r.checked_at=l.checked_at
      and ((r.candidate_id=ca.id and r.related_candidate_id=cb.id)
        or (r.candidate_id=cb.id and r.related_candidate_id=ca.id))
  where l.owner_id=p_owner_id and a.current_in_analysis and b.current_in_analysis
    and a.scope in ('equipment','service') and a.scope=b.scope
    and a.package_name_zh=b.package_name_zh
    and pa.current_in_analysis and pb.current_in_analysis
    and pa.identity_id is not null and pa.identity_id=pb.identity_id
    and ca.disposition='candidate' and cb.disposition='candidate'
    and ca.review_status=cb.review_status and ca.review_status<>'rejected'
    and sa.id<>sb.id and sa.content_sha256<>sb.content_sha256
    and sa.extraction_status='extracted' and sb.extraction_status='extracted'
    and a.source_sha256=sa.content_sha256 and b.source_sha256=sb.content_sha256
    and ca.source_sha256=sa.content_sha256 and cb.source_sha256=sb.content_sha256
    and sa.extraction_source_sha256=sa.content_sha256 and sb.extraction_source_sha256=sb.content_sha256
    and l.left_source_sha256=sa.content_sha256 and l.right_source_sha256=sb.content_sha256
    and l.left_extracted_at=sa.extracted_at and l.right_extracted_at=sb.extracted_at
    and r.relation='supports' and r.same_scope=true
    and ((r.candidate_id=ca.id and r.left_source_sha256=sa.content_sha256
      and r.right_source_sha256=sb.content_sha256 and r.left_extracted_at=sa.extracted_at
      and r.right_extracted_at=sb.extracted_at and exists (
        select 1 from jsonb_array_elements(r.matching_facts_zh) fact
        where (fact->>'left_fact_number')::integer=a.evidence_fact_number
          and (fact->>'right_fact_number')::integer=b.evidence_fact_number))
      or (r.candidate_id=cb.id and r.left_source_sha256=sb.content_sha256
        and r.right_source_sha256=sa.content_sha256 and r.left_extracted_at=sb.extracted_at
        and r.right_extracted_at=sa.extracted_at and exists (
          select 1 from jsonb_array_elements(r.matching_facts_zh) fact
          where (fact->>'left_fact_number')::integer=b.evidence_fact_number
            and (fact->>'right_fact_number')::integer=a.evidence_fact_number)))
$$;
revoke all on function public.current_intelligence_opportunity_links(uuid) from public,anon,authenticated;
grant execute on function public.current_intelligence_opportunity_links(uuid) to service_role;
notify pgrst,'reload schema';
commit;
