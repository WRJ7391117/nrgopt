-- Validated model extraction remains separate from source evidence and human annotation.
begin;

alter table public.intelligence_sources
  add column extraction_status text not null default 'not_requested'
    check (extraction_status in ('not_requested', 'processing', 'extracted', 'extraction_failed')),
  add column extraction_zh jsonb,
  add column extraction_provider text,
  add column extraction_model text,
  add column extraction_source_sha256 text,
  add column extraction_usage jsonb,
  add column extraction_error_code text,
  add column extracted_at timestamptz;

commit;
