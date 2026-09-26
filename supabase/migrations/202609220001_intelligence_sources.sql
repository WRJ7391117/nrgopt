-- Apply only to the isolated NRGOPT development Supabase project.
begin;

create table public.intelligence_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  requested_url text not null,
  final_url text,
  title text,
  fetched_at timestamptz not null default now(),
  published_at timestamptz,
  status text not null check (status in ('saving_evidence', 'pending_extraction', 'evidence_failed', 'fetch_failed')),
  error_code text,
  excerpt text check (length(excerpt) <= 2000),
  content_type text check (content_type in ('text/html', 'text/plain')),
  byte_size integer check (byte_size between 0 and 2097152),
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text,
  unique (owner_id, final_url, content_sha256),
  check (status = 'fetch_failed' or (final_url is not null and content_sha256 is not null and storage_path is not null))
);

create index intelligence_sources_owner_time on public.intelligence_sources(owner_id, fetched_at desc);
alter table public.intelligence_sources enable row level security;
revoke all on public.intelligence_sources from anon, authenticated;
grant select, insert, update, delete on public.intelligence_sources to service_role;

-- No public/user storage policies: evidence is accessed only by the authenticated server API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nrgopt-intelligence', 'nrgopt-intelligence', false, 2097152, array['text/html', 'text/plain']);

commit;
