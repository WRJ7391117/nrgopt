begin;

create table public.intelligence_archive_node_settings (
  owner_id uuid not null references auth.users(id),
  node_id text not null check (node_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  requested_directory text,
  revision integer not null default 0 check (revision >= 0),
  active_directory text,
  active_revision integer not null default 0 check (active_revision >= 0),
  previous_directories jsonb not null default '[]'::jsonb,
  last_seen_at timestamptz,
  error_code text,
  primary key (owner_id, node_id),
  check (requested_directory is null or length(requested_directory) between 1 and 1024),
  check (active_directory is null or length(active_directory) between 1 and 1024),
  check (jsonb_typeof(previous_directories) = 'array')
);

alter table public.intelligence_archive_node_settings enable row level security;
revoke all on public.intelligence_archive_node_settings from anon, authenticated;
grant select, insert, update on public.intelligence_archive_node_settings to service_role;

create function public.report_intelligence_archive_node(
  p_owner_id uuid, p_node_id text, p_active_directory text,
  p_active_revision integer, p_previous_directories jsonb, p_error_code text
) returns public.intelligence_archive_node_settings language plpgsql as $$
declare v_row public.intelligence_archive_node_settings;
begin
  insert into public.intelligence_archive_node_settings(owner_id,node_id,active_directory,active_revision,previous_directories,last_seen_at,error_code)
  values(p_owner_id,p_node_id,p_active_directory,p_active_revision,p_previous_directories,now(),p_error_code)
  on conflict(owner_id,node_id) do update set
    active_directory=excluded.active_directory, active_revision=excluded.active_revision,
    previous_directories=excluded.previous_directories, last_seen_at=excluded.last_seen_at,
    error_code=excluded.error_code
  where public.intelligence_archive_node_settings.active_revision <= excluded.active_revision
    and public.intelligence_archive_node_settings.revision >= excluded.active_revision
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.report_intelligence_archive_node(uuid,text,text,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.report_intelligence_archive_node(uuid,text,text,integer,jsonb,text) to service_role;

commit;
