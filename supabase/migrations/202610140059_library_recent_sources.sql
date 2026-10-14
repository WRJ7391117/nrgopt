-- Keep recent channel growth inputs independent of historical revisit volume.
begin;
set local lock_timeout='5s';
create index intelligence_sources_library_requested on public.intelligence_sources
 (owner_id,split_part(requested_url,'#',1),fetched_at desc);
create index intelligence_sources_library_final on public.intelligence_sources
 (owner_id,split_part(final_url,'#',1),fetched_at desc);
create function public.intelligence_library_recent_sources(p_owner_id uuid,p_day date)
returns jsonb language sql stable set search_path=public as $$
 with eligible as (
  select s.* from public.intelligence_sources s
  where s.owner_id=p_owner_id and p_day is not null
   and s.status='pending_extraction' and s.extraction_status='extracted'
   and s.content_sha256 ~ '^[a-f0-9]{64}$' and s.extraction_source_sha256=s.content_sha256
   and s.publication_method in ('metadata','publisher_dateline','spa_dateline') and s.publication_date is not null
   and coalesce((s.published_at at time zone 'Asia/Shanghai')::date,s.publication_date) between p_day-29 and p_day
   and not exists (
    select 1 from public.intelligence_sources n
    where n.owner_id=s.owner_id and n.fetched_at>=s.fetched_at
     and (split_part(n.requested_url,'#',1) in (split_part(s.requested_url,'#',1),split_part(s.final_url,'#',1))
       or split_part(n.final_url,'#',1) in (split_part(s.requested_url,'#',1),split_part(s.final_url,'#',1)))
     and row(n.fetched_at,case when n.status in ('fetch_failed','evidence_failed') or n.extraction_status in ('failed','extraction_failed') then 1 else 0 end,n.id)
       > row(s.fetched_at,0,s.id)
   )
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'title',title,'requested_url',requested_url,'final_url',final_url,'fetched_at',fetched_at,'status',status,
  'publication_date',publication_date,'published_at',published_at,'publication_method',publication_method,
  'extraction_status',extraction_status,'extraction_error_code',extraction_error_code,
  'content_sha256',content_sha256,'extraction_source_sha256',extraction_source_sha256,
  'countries',extraction_zh#>'{classification,countries}') order by fetched_at desc,id desc),'[]'::jsonb) from eligible;
$$;
revoke all on function public.intelligence_library_recent_sources(uuid,date) from public,anon,authenticated;
grant execute on function public.intelligence_library_recent_sources(uuid,date) to service_role;
notify pgrst,'reload schema';
commit;
