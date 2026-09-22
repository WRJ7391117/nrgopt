-- G3 private evidence archive queue. Completing an archive never deletes the cloud object.
begin;

alter table public.intelligence_sources
  add column archive_status text not null default 'not_queued'
    check (archive_status in ('not_queued','queued','claimed','archived','queue_failed','archive_failed')),
  add column archived_at timestamptz;

create table public.intelligence_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source_id uuid not null references public.intelligence_sources(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','claimed','archived','retry','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  archive_node_id text check (archive_node_id is null or length(archive_node_id) between 1 and 80),
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (owner_id, source_id)
);

create index intelligence_archive_jobs_claim on public.intelligence_archive_jobs(owner_id, status, created_at);
alter table public.intelligence_archive_jobs enable row level security;
revoke all on public.intelligence_archive_jobs from anon, authenticated;
grant select, insert, update, delete on public.intelligence_archive_jobs to service_role;

insert into public.intelligence_archive_jobs(owner_id, source_id)
select owner_id, id from public.intelligence_sources
where status = 'pending_extraction' and storage_path is not null and content_sha256 is not null and byte_size is not null
on conflict (owner_id, source_id) do nothing;
update public.intelligence_sources set archive_status = 'queued'
where status = 'pending_extraction' and storage_path is not null and content_sha256 is not null and byte_size is not null;

create or replace function public.enqueue_intelligence_archive(p_owner_id uuid, p_source_id uuid)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.intelligence_sources
    where id = p_source_id and owner_id = p_owner_id and status = 'pending_extraction'
      and storage_path is not null and content_sha256 is not null and byte_size is not null
  ) then return null; end if;
  insert into public.intelligence_archive_jobs(owner_id, source_id)
  values (p_owner_id, p_source_id)
  on conflict (owner_id, source_id) do nothing
  returning intelligence_archive_jobs.id into v_id;
  if v_id is null then
    select id into v_id from public.intelligence_archive_jobs
    where owner_id = p_owner_id and source_id = p_source_id;
  end if;
  update public.intelligence_sources set archive_status = case
    when archive_status = 'archived' then archive_status else 'queued' end
  where id = p_source_id and owner_id = p_owner_id;
  return v_id;
end $$;

create or replace function public.claim_intelligence_archive(
  p_owner_id uuid, p_archive_node_id text, p_lease_seconds integer default 300
) returns table(id uuid, source_id uuid, requested_url text, final_url text, fetched_at timestamptz,
  content_type text, byte_size integer, content_sha256 text) language plpgsql as $$
declare v_job public.intelligence_archive_jobs%rowtype;
begin
  if p_archive_node_id is null or length(p_archive_node_id) not between 1 and 80
     or p_lease_seconds not between 60 and 900 then return; end if;
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

create or replace function public.complete_intelligence_archive(
  p_owner_id uuid, p_archive_id uuid, p_archive_node_id text, p_byte_size integer, p_content_sha256 text
) returns boolean language plpgsql as $$
declare v_job public.intelligence_archive_jobs%rowtype;
begin
  select * into v_job from public.intelligence_archive_jobs
  where id = p_archive_id and owner_id = p_owner_id and status = 'claimed'
    and archive_node_id = p_archive_node_id for update;
  if v_job.id is null or not exists (
    select 1 from public.intelligence_sources where id = v_job.source_id and owner_id = p_owner_id
      and byte_size = p_byte_size and content_sha256 = p_content_sha256
  ) then return false; end if;
  update public.intelligence_archive_jobs set status = 'archived', lease_until = null,
    archived_at = now(), updated_at = now() where id = v_job.id;
  update public.intelligence_sources set archive_status = 'archived', archived_at = now()
  where id = v_job.source_id and owner_id = p_owner_id;
  return true;
end $$;

create or replace function public.fail_intelligence_archive(
  p_owner_id uuid, p_archive_id uuid, p_archive_node_id text, p_error_code text
) returns boolean language plpgsql as $$
declare v_job public.intelligence_archive_jobs%rowtype; v_status text;
begin
  if p_error_code is null or p_error_code !~ '^[a-z_]{1,64}$' then return false; end if;
  select * into v_job from public.intelligence_archive_jobs
  where id = p_archive_id and owner_id = p_owner_id and status = 'claimed'
    and archive_node_id = p_archive_node_id for update;
  if v_job.id is null then return false; end if;
  v_status := case when v_job.attempts >= 3 then 'failed' else 'retry' end;
  update public.intelligence_archive_jobs set status = v_status, lease_until = null,
    error_code = p_error_code, updated_at = now() where id = v_job.id;
  update public.intelligence_sources set archive_status = case when v_status = 'failed' then 'archive_failed' else 'queued' end
  where id = v_job.source_id and owner_id = p_owner_id;
  return true;
end $$;

revoke all on function public.enqueue_intelligence_archive(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_intelligence_archive(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.complete_intelligence_archive(uuid,uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.fail_intelligence_archive(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_intelligence_archive(uuid,uuid) to service_role;
grant execute on function public.claim_intelligence_archive(uuid,text,integer) to service_role;
grant execute on function public.complete_intelligence_archive(uuid,uuid,text,integer,text) to service_role;
grant execute on function public.fail_intelligence_archive(uuid,uuid,text,text) to service_role;

commit;
