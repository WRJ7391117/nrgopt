begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid(); job uuid; other_job uuid; claimed record;
begin
  insert into auth.users(id) values(a),(b);
  set local role service_role;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,byte_size)
    values(s,a,'https://fixture.invalid/a','https://fixture.invalid/a','pending_extraction',repeat('a',64),'fixture-a',1),
    (other_s,b,'https://fixture.invalid/b','https://fixture.invalid/b','pending_extraction',repeat('b',64),'fixture-b',1);
  job:=public.enqueue_intelligence_archive(a,s);
  other_job:=public.enqueue_intelligence_archive(b,other_s);
  select * into claimed from public.claim_intelligence_archive(a,'node-original',60);
  if claimed.id is distinct from job then raise exception 'first claim failed'; end if;
  if exists(select 1 from public.claim_intelligence_archive(a,'node-reconnected',60)) then raise exception 'live lease stolen'; end if;
  update public.intelligence_archive_jobs set lease_until=now()-interval '1 second' where id=job;
  select * into claimed from public.claim_intelligence_archive(a,'node-reconnected',60);
  if claimed.id is distinct from job then raise exception 'expired lease not resumed'; end if;
  if public.complete_intelligence_archive(a,job,'node-original',1,repeat('a',64)) then raise exception 'old node ack accepted'; end if;
  update public.intelligence_archive_jobs set attempts=3,lease_until=now()-interval '1 second' where id in (job,other_job);
  update public.intelligence_archive_jobs set status='claimed' where id=other_job;
  perform public.claim_intelligence_archive(a,'node-reconnected',60);
  if not exists(select 1 from public.intelligence_archive_jobs where id=job and status='failed' and error_code='archive_lease_exhausted' and lease_until is null) then raise exception 'third expired lease left claimed'; end if;
  if (select archive_status from public.intelligence_sources where id=s)<>'archive_failed' then raise exception 'source failure hidden'; end if;
  if (select status from public.intelligence_archive_jobs where id=other_job)<>'claimed' then raise exception 'changed another owner'; end if;
  if not exists(select 1 from public.intelligence_sources where id=s and storage_path='fixture-a' and content_sha256=repeat('a',64)) then raise exception 'evidence removed'; end if;
  reset role;
end $$;
rollback;
