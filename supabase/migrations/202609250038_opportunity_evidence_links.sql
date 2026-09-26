-- Cross-source package links require current, paired package facts; project identity alone is insufficient.
begin;
alter table public.intelligence_opportunities
  add constraint intelligence_opportunities_owner_id_unique unique(owner_id,id);
create table public.intelligence_opportunity_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  left_opportunity_id uuid not null,
  right_opportunity_id uuid not null,
  left_source_sha256 text not null,
  right_source_sha256 text not null,
  left_extracted_at timestamptz not null,
  right_extracted_at timestamptz not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(left_opportunity_id < right_opportunity_id),
  unique(owner_id,left_opportunity_id,right_opportunity_id),
  foreign key(owner_id,left_opportunity_id) references public.intelligence_opportunities(owner_id,id),
  foreign key(owner_id,right_opportunity_id) references public.intelligence_opportunities(owner_id,id)
);
alter table public.intelligence_opportunity_links enable row level security;
revoke all on public.intelligence_opportunity_links from public,anon,authenticated;
grant select,insert,update on public.intelligence_opportunity_links to service_role;

create function public.sync_intelligence_opportunity_links(p_owner_id uuid, p_left_candidate_id uuid, p_right_candidate_id uuid)
returns integer language plpgsql as $$
declare linked integer;
begin
  insert into public.intelligence_opportunity_links(owner_id,left_opportunity_id,right_opportunity_id,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at,checked_at)
  select p_owner_id, least(a.id,b.id), greatest(a.id,b.id),
    case when a.id<b.id then sa.content_sha256 else sb.content_sha256 end,
    case when a.id<b.id then sb.content_sha256 else sa.content_sha256 end,
    case when a.id<b.id then sa.extracted_at else sb.extracted_at end,
    case when a.id<b.id then sb.extracted_at else sa.extracted_at end,
    r.checked_at
  from public.intelligence_opportunities a
    join public.intelligence_opportunities b on b.owner_id=a.owner_id and b.candidate_id=p_right_candidate_id
    join public.intelligence_projects pa on pa.id=a.project_id and pa.owner_id=a.owner_id
    join public.intelligence_projects pb on pb.id=b.project_id and pb.owner_id=b.owner_id
    join public.intelligence_candidates ca on ca.id=a.candidate_id and ca.owner_id=a.owner_id
    join public.intelligence_candidates cb on cb.id=b.candidate_id and cb.owner_id=b.owner_id
    join public.intelligence_sources sa on sa.id=ca.source_id and sa.owner_id=a.owner_id
    join public.intelligence_sources sb on sb.id=cb.source_id and sb.owner_id=b.owner_id
    join public.intelligence_candidate_relations r on r.owner_id=a.owner_id
      and r.candidate_id=a.candidate_id and r.related_candidate_id=b.candidate_id
  where a.owner_id=p_owner_id and a.candidate_id=p_left_candidate_id
    and a.id<>b.id and a.current_in_analysis and b.current_in_analysis
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
    and r.relation='supports' and r.same_scope=true
    and r.left_source_sha256=sa.content_sha256 and r.right_source_sha256=sb.content_sha256
    and r.left_extracted_at=sa.extracted_at and r.right_extracted_at=sb.extracted_at
    and exists(select 1 from jsonb_array_elements(r.matching_facts_zh) fact
      where (fact->>'left_fact_number')::integer=a.evidence_fact_number
        and (fact->>'right_fact_number')::integer=b.evidence_fact_number)
  on conflict(owner_id,left_opportunity_id,right_opportunity_id) do update set
    left_source_sha256=excluded.left_source_sha256,
    right_source_sha256=excluded.right_source_sha256,
    left_extracted_at=excluded.left_extracted_at,
    right_extracted_at=excluded.right_extracted_at,
    checked_at=excluded.checked_at;
  get diagnostics linked=row_count;
  return linked;
end $$;
revoke all on function public.sync_intelligence_opportunity_links(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sync_intelligence_opportunity_links(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
