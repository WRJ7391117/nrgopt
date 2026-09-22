-- Human-authored Chinese context for a preserved source. This is not model output.
begin;

alter table public.intelligence_sources
  add column annotation_zh text check (char_length(annotation_zh) <= 2000),
  add column annotation_updated_at timestamptz;

commit;
