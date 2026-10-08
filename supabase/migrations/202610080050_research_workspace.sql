-- Add an independent private research workspace; no intelligence rows are changed.
begin;
create table public.research_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check (length(title) between 1 and 200),
  region text not null default '' check (length(region) <= 100),
  summary text not null default '' check (length(summary) <= 2000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);
create table public.research_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  project_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  kind text not null check (kind in ('plan','note','interview','evidence')),
  content text not null default '' check (length(content) <= 100000),
  source_url text not null default '' check (length(source_url) <= 2000),
  file_name text,
  file_type text,
  byte_size integer check (byte_size between 1 and 2097152),
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id,project_id) references public.research_projects(owner_id,id),
  check ((storage_path is null and file_name is null and file_type is null and byte_size is null and content_sha256 is null)
    or (storage_path is not null and file_name is not null and file_type is not null and byte_size is not null and content_sha256 is not null))
);
create index research_projects_owner_time on public.research_projects(owner_id,updated_at desc);
create index research_entries_project_time on public.research_entries(owner_id,project_id,updated_at desc);
alter table public.research_projects enable row level security;
alter table public.research_entries enable row level security;
revoke all on public.research_projects, public.research_entries from anon,authenticated;
grant select,insert,update on public.research_projects, public.research_entries to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('nrgopt-research','nrgopt-research',false,2097152,array['application/octet-stream']);
commit;
