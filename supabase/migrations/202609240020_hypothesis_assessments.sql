begin;
create table public.intelligence_hypothesis_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  hypothesis_id uuid not null references public.intelligence_hypotheses(id) on delete cascade,
  source_id uuid not null references public.intelligence_sources(id),
  source_sha256 text not null,
  publication_date date,
  previous_status text not null,
  recommendation text not null check (recommendation in ('unchanged','strengthened','weakened','rejected')),
  resulting_status text not null,
  applied boolean not null,
  decision_code text not null,
  reason_zh text not null check (length(reason_zh) between 1 and 600),
  evidence_facts jsonb not null,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (owner_id,hypothesis_id,source_id,source_sha256)
);
create index intelligence_hypothesis_assessment_history on public.intelligence_hypothesis_assessments(hypothesis_id,created_at desc);
alter table public.intelligence_hypothesis_assessments enable row level security;
revoke all on public.intelligence_hypothesis_assessments from anon,authenticated;
grant select,insert on public.intelligence_hypothesis_assessments to service_role;

create function public.save_intelligence_hypothesis_assessment(
  p_owner_id uuid, p_hypothesis_id uuid, p_source_id uuid, p_source_sha256 text,
  p_expected_status text, p_recommendation text, p_reason_zh text, p_fact_numbers jsonb,
  p_provider text, p_model text
) returns uuid language plpgsql as $$
declare
  h public.intelligence_hypotheses%rowtype;
  s public.intelligence_sources%rowtype;
  original public.intelligence_sources%rowtype;
  result_id uuid; effective_date date; evidence jsonb; decision text; next_status text;
begin
  select * into h from public.intelligence_hypotheses where id=p_hypothesis_id and owner_id=p_owner_id for update;
  if not found then return null; end if;
  select id into result_id from public.intelligence_hypothesis_assessments
    where owner_id=p_owner_id and hypothesis_id=h.id and source_id=p_source_id and source_sha256=p_source_sha256;
  if found then return result_id; end if;
  select * into s from public.intelligence_sources where id=p_source_id and owner_id=p_owner_id for share;
  if not found or s.content_sha256 is distinct from p_source_sha256
    or s.extraction_source_sha256 is distinct from p_source_sha256 or s.extraction_status <> 'extracted' then return null; end if;
  select src.* into original from public.intelligence_candidates c
    join public.intelligence_sources src on src.id=c.source_id and src.owner_id=c.owner_id
    where c.id=h.candidate_id and c.owner_id=p_owner_id;
  if not found or original.id=s.id then return null; end if;
  if p_recommendation is null or p_recommendation not in ('unchanged','strengthened','weakened','rejected')
    or length(coalesce(p_reason_zh,'')) not between 1 and 600
    or nullif(p_provider,'') is null or nullif(p_model,'') is null
    or p_fact_numbers is null or jsonb_typeof(p_fact_numbers) <> 'array' then return null; end if;
  if jsonb_array_length(p_fact_numbers)>8 or (p_recommendation<>'unchanged' and jsonb_array_length(p_fact_numbers)=0)
    or jsonb_typeof(s.extraction_zh->'known_facts') is distinct from 'array' then return null; end if;
  if exists(select 1 from jsonb_array_elements(p_fact_numbers) n
    where jsonb_typeof(n)<>'number' or (n #>> '{}') !~ '^[1-9][0-9]{0,2}$') then return null; end if;
  if exists(select 1 from jsonb_array_elements_text(p_fact_numbers) n
    where n::int>jsonb_array_length(s.extraction_zh->'known_facts')) then return null; end if;
  select coalesce(jsonb_agg(s.extraction_zh->'known_facts'->(n::int-1)), '[]') into evidence
    from (select distinct value as n from jsonb_array_elements_text(p_fact_numbers)) numbers;
  select greatest(original.publication_date,max(publication_date)) into effective_date
    from public.intelligence_hypothesis_assessments where hypothesis_id=h.id and decision_code in ('applied','unchanged');
  decision := case
    when h.status is distinct from p_expected_status then 'stale_state'
    when h.status in ('confirmed','rejected','dormant') then 'terminal_state'
    when original.publication_date is null or s.publication_date is null
      or original.publication_method='conflicting_metadata' or s.publication_method='conflicting_metadata' then 'date_unverified'
    when s.publication_date<=effective_date then 'not_newer'
    when s.content_sha256=original.content_sha256 then 'duplicate_evidence'
    when p_recommendation='unchanged' or p_recommendation=h.status then 'unchanged'
    else 'applied' end;
  next_status := case when decision='applied' then p_recommendation else h.status end;
  insert into public.intelligence_hypothesis_assessments(owner_id,hypothesis_id,source_id,source_sha256,
    publication_date,previous_status,recommendation,resulting_status,applied,decision_code,reason_zh,evidence_facts,provider,model)
    values(p_owner_id,h.id,s.id,s.content_sha256,s.publication_date,h.status,p_recommendation,next_status,
      decision='applied',decision,p_reason_zh,evidence,p_provider,p_model) returning id into result_id;
  if decision='applied' then update public.intelligence_hypotheses set status=next_status where id=h.id; end if;
  return result_id;
end $$;
revoke all on function public.save_intelligence_hypothesis_assessment(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.save_intelligence_hypothesis_assessment(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) to service_role;
commit;
