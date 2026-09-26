begin;
-- Date-only announcements must not acquire a fabricated midnight publication time.
alter table public.intelligence_sources
  add column publication_date date,
  add column publication_method text check (publication_method in ('metadata', 'spa_dateline', 'conflicting_metadata')),
  add column publication_evidence text check (length(publication_evidence) <= 2000);
commit;
