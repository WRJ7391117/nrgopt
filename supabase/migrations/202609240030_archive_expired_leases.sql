-- A third interrupted archive attempt must become visibly failed, not remain claimed forever.
begin;
create or replace function public.claim_intelligence_archive(
  p_owner_id uuid, p_archive_node_id text, p_lease_seconds integer default 300
) returns table(id uuid, source_id uuid, requested_url text, final_url text, fetched_at timestamptz,
  content_type text, byte_size integer, content_sha256 text) language plpgsql as $$
declare v_job public.intelligence_archive_jobs%rowtype;
begin
  if p_archive_node_id is null or length(p_archive_node_id) not between 1 and 80
     or p_lease_seconds not between 60 and 900 then return; end if;
  with exhausted as (
    update public.intelligence_archive_jobs j0 set status='failed', lease_until=null,
      error_code='archive_lease_exhausted', updated_at=now()
    where owner_id=p_owner_id and status='claimed' and attempts>=3 and lease_until<now()
    returning j0.source_id
  ) update public.intelligence_sources s0 set archive_status='archive_failed'
    where s0.owner_id=p_owner_id and s0.id in (select exhausted.source_id from exhausted);
  select j.* into v_job from public.intelligence_archive_jobs j
  where j.owner_id = p_owner_id and j.attempts < 3
    and (j.status in ('queued','retry') or (j.status = 'claimed' and j.lease_until < now()))
  order by j.created_at for update skip locked limit 1;
  if v_job.id is null then return; end if;
  update public.intelligence_archive_jobs set status = 'claimed', attempts = intelligence_archive_jobs.attempts + 1,
    archive_node_id = p_archive_node_id, lease_until = now() + make_interval(secs => p_lease_seconds),
    error_code = null, updated_at = now() where intelligence_archive_jobs.id = v_job.id;
  update public.intelligence_sources set archive_status = 'claimed'
  where intelligence_sources.id = v_job.source_id and owner_id = p_owner_id;
  return query select j.id, s.id, s.requested_url, s.final_url, s.fetched_at, s.content_type, s.byte_size, s.content_sha256
    from public.intelligence_archive_jobs j join public.intelligence_sources s on s.id = j.source_id
    where j.id = v_job.id;
end $$;

notify pgrst,'reload schema';
commit;
