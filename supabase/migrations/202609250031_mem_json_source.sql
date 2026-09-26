-- MEM's public CMS article response is saved verbatim as its official evidence.
begin;

alter table public.intelligence_sources
  drop constraint intelligence_sources_content_type_check;

alter table public.intelligence_sources
  add constraint intelligence_sources_content_type_check
  check (content_type in ('text/html', 'text/plain', 'application/json'));

update storage.buckets
set allowed_mime_types = array['text/html', 'text/plain', 'application/json']
where id = 'nrgopt-intelligence';

commit;
