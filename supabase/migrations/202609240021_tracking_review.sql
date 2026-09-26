-- Review inactive hypotheses without treating silence as counterevidence.
begin;
alter table public.intelligence_hypotheses
  add column review_due_at timestamptz,
  add column last_reviewed_at timestamptz,
  add column dormant_at timestamptz;
update public.intelligence_hypotheses set review_due_at = created_at + interval '90 days';
alter table public.intelligence_hypotheses
  alter column review_due_at set default (now() + interval '90 days'),
  alter column review_due_at set not null;

create or replace function public.review_intelligence_tracking(p_owner_id uuid)
returns jsonb language plpgsql as $$
declare h public.intelligence_hypotheses%rowtype; latest_evidence timestamptz; next_review timestamptz;
  dormant_count integer := 0; renewed_count integer := 0; expired_count integer := 0;
begin
  for h in select * from public.intelligence_hypotheses
    where owner_id = p_owner_id and status in ('open','strengthened','weakened') and review_due_at <= now()
    order by id for update skip locked
  loop
    -- An unrelated result, old article or unknown date must not keep a watch alive forever.
    select max(created_at) into latest_evidence from public.intelligence_hypothesis_assessments
      where owner_id = p_owner_id and hypothesis_id = h.id
        and decision_code in ('applied','unchanged') and recommendation in ('strengthened','weakened')
        and jsonb_array_length(evidence_facts) > 0;
    next_review := greatest(h.created_at, latest_evidence) + interval '90 days';
    if next_review > now() then
      update public.intelligence_hypotheses set review_due_at = next_review, last_reviewed_at = now() where id = h.id;
      renewed_count := renewed_count + 1;
    else
      update public.intelligence_hypotheses set status = 'dormant', dormant_at = now(), last_reviewed_at = now() where id = h.id;
      dormant_count := dormant_count + 1;
    end if;
  end loop;
  update public.intelligence_watch_targets w set status = 'expired'
    where w.owner_id = p_owner_id and w.status = 'active' and w.created_at <= now() - interval '90 days'
      and not exists (select 1 from public.intelligence_hypotheses remaining
        where remaining.owner_id = p_owner_id and remaining.candidate_id = w.candidate_id and remaining.status in ('open','strengthened','weakened'));
  get diagnostics expired_count = row_count;
  return jsonb_build_object('dormant', dormant_count, 'renewed', renewed_count, 'expired_watches', expired_count);
end $$;
revoke all on function public.review_intelligence_tracking(uuid) from public, anon, authenticated;
grant execute on function public.review_intelligence_tracking(uuid) to service_role;
commit;
