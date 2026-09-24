-- Preserve tracking identities and decisions when extraction is retried.
begin;
create or replace function public.sync_intelligence_tracking(
  p_owner_id uuid, p_candidate_id uuid, p_hypotheses jsonb, p_signals jsonb
) returns boolean language plpgsql as $$
begin
  perform 1 from public.intelligence_candidates
    where id = p_candidate_id and owner_id = p_owner_id for update;
  if not found then return false; end if;
  if p_hypotheses is null or jsonb_typeof(p_hypotheses) <> 'array'
    or p_signals is null or jsonb_typeof(p_signals) <> 'array' then return false; end if;
  if jsonb_array_length(p_hypotheses) > 4 or jsonb_array_length(p_signals) > 6 then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_hypotheses) h
    where jsonb_typeof(h) <> 'object' or length(coalesce(h->>'hypothesis_zh', '')) not between 1 and 300
      or length(coalesce(h->>'counter_evidence_zh', '')) > 300)
    or exists (select 1 from jsonb_array_elements(p_signals) s
      where jsonb_typeof(s) <> 'string' or length(s #>> '{}') not between 1 and 240) then return false; end if;

  insert into public.intelligence_hypotheses(owner_id, candidate_id, claim_zh, counter_evidence_zh)
    select distinct p_owner_id, p_candidate_id, h->>'hypothesis_zh', nullif(h->>'counter_evidence_zh', '')
    from jsonb_array_elements(p_hypotheses) h
    where not exists (select 1 from public.intelligence_hypotheses old
      where old.owner_id = p_owner_id and old.candidate_id = p_candidate_id
        and old.claim_zh = h->>'hypothesis_zh'
        and coalesce(old.counter_evidence_zh, '') = coalesce(h->>'counter_evidence_zh', ''));
  insert into public.intelligence_watch_targets(owner_id, candidate_id, signal_zh)
    select distinct p_owner_id, p_candidate_id, s #>> '{}'
    from jsonb_array_elements(p_signals) s
    where not exists (select 1 from public.intelligence_watch_targets old
      where old.owner_id = p_owner_id and old.candidate_id = p_candidate_id and old.signal_zh = s #>> '{}');
  return true;
end $$;

create or replace function public.intelligence_watched_sources(p_owner_id uuid)
returns table(url text) language sql stable as $$
  select distinct s.final_url from public.intelligence_watch_targets w
    join public.intelligence_candidates c on c.id = w.candidate_id and c.owner_id = w.owner_id
    join public.intelligence_sources s on s.id = c.source_id and s.owner_id = w.owner_id
    where w.owner_id = p_owner_id and w.status = 'active' and c.disposition = 'candidate'
      and s.status = 'pending_extraction' and s.final_url is not null
    order by s.final_url;
$$;
revoke all on function public.sync_intelligence_tracking(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.intelligence_watched_sources(uuid) from public, anon, authenticated;
grant execute on function public.sync_intelligence_tracking(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.intelligence_watched_sources(uuid) to service_role;
commit;
