begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Human follow-up reuses the existing watch identity without changing AI claims.
alter table public.intelligence_watch_targets
  add column followup jsonb,
  add column revision integer not null default 0,
  add column updated_at timestamptz not null default now();
create unique index intelligence_user_followup_candidate
  on public.intelligence_watch_targets(owner_id, candidate_id) where followup is not null;

create table public.intelligence_followup_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  watch_id uuid not null references public.intelligence_watch_targets(id),
  revision integer not null,
  before_state jsonb,
  after_state jsonb not null,
  recorded_at timestamptz not null default now(),
  unique(watch_id, revision)
);
alter table public.intelligence_followup_history enable row level security;
revoke all on public.intelligence_followup_history from anon, authenticated;
grant all on public.intelligence_followup_history to service_role;
grant usage, select on sequence public.intelligence_followup_history_id_seq to service_role;

create function public.save_intelligence_followup(
  p_owner_id uuid, p_source_id uuid, p_revision integer, p_status text, p_followup jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare c public.intelligence_candidates%rowtype; w public.intelligence_watch_targets%rowtype;
  previous jsonb; field text; max_length integer;
begin
  if p_revision is null or p_revision < 0 or p_status is null or p_status not in ('active','completed','expired')
    or p_followup is null or jsonb_typeof(p_followup) <> 'object' then
    return jsonb_build_object('error','invalid_request');
  end if;
  foreach field in array array['reason','next_action','exit_condition','outcome','exit_reason'] loop
    max_length := case field when 'next_action' then 240 when 'outcome' then 2000 else 600 end;
    if jsonb_typeof(p_followup->field) is distinct from 'string' or length(p_followup->>field) > max_length
      or ((field in ('reason','next_action','exit_condition') or (field = 'exit_reason' and p_status <> 'active'))
        and length(btrim(p_followup->>field)) = 0) then return jsonb_build_object('error','invalid_request'); end if;
  end loop;
  if coalesce(p_followup->>'priority','') not in ('high','normal','low')
    or coalesce(p_followup->>'review_on','') !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('error','invalid_request'); end if;
  begin
    perform (p_followup->>'review_on')::date;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('error','invalid_request'); end;

  select * into c from public.intelligence_candidates where owner_id = p_owner_id and source_id = p_source_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into w from public.intelligence_watch_targets
    where owner_id = p_owner_id and candidate_id = c.id and followup is not null for update;
  if found then
    -- A repeated identical save is harmless; a stale, different edit must not overwrite history.
    if w.status = p_status and w.followup = p_followup and p_revision in (w.revision, w.revision - 1) then return to_jsonb(w); end if;
    if w.revision <> p_revision then return jsonb_build_object('error','followup_conflict'); end if;
    previous := to_jsonb(w);
    update public.intelligence_watch_targets set status = p_status, followup = p_followup,
      signal_zh = p_followup->>'next_action', revision = revision + 1, updated_at = now()
      where id = w.id returning * into w;
  else
    if p_revision <> 0 then return jsonb_build_object('error','followup_conflict'); end if;
    if c.disposition <> 'candidate' or p_status <> 'active' then return jsonb_build_object('error','invalid_request'); end if;
    insert into public.intelligence_watch_targets(owner_id,candidate_id,signal_zh,status,followup,revision)
      values(p_owner_id,c.id,p_followup->>'next_action',p_status,p_followup,1) returning * into w;
  end if;
  insert into public.intelligence_followup_history(owner_id,watch_id,revision,before_state,after_state)
    values(p_owner_id,w.id,w.revision,previous,to_jsonb(w));
  return to_jsonb(w);
end $$;
revoke all on function public.save_intelligence_followup(uuid,uuid,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_intelligence_followup(uuid,uuid,integer,text,jsonb) to service_role;

-- Human decisions survive AI extraction and silence; only the user exits or restores this list.
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
    where w.owner_id = p_owner_id and w.followup is null and w.status = 'active' and w.created_at <= now() - interval '90 days'
      and not exists (select 1 from public.intelligence_hypotheses remaining
        where remaining.owner_id = p_owner_id and remaining.candidate_id = w.candidate_id and remaining.status in ('open','strengthened','weakened'));
  get diagnostics expired_count = row_count;
  return jsonb_build_object('dormant', dormant_count, 'renewed', renewed_count, 'expired_watches', expired_count);
end $$;

-- A user's pause/exit takes precedence over older automatically-created watch targets.
create or replace function public.intelligence_watched_sources(p_owner_id uuid)
returns table(url text) language sql stable as $$
  select distinct s.final_url from public.intelligence_watch_targets w
    join public.intelligence_candidates c on c.id = w.candidate_id and c.owner_id = w.owner_id
    join public.intelligence_sources s on s.id = c.source_id and s.owner_id = w.owner_id
    where w.owner_id = p_owner_id and w.status = 'active' and c.disposition = 'candidate'
      and s.status = 'pending_extraction' and s.final_url is not null
      and not exists (select 1 from public.intelligence_watch_targets decision where decision.owner_id = w.owner_id
        and decision.candidate_id = w.candidate_id and decision.followup is not null
        and (decision.status <> 'active' or (
          (decision.followup->>'review_on')::date > (now() at time zone 'Asia/Shanghai')::date
          and mod((now() at time zone 'Asia/Shanghai')::date - (decision.updated_at at time zone 'Asia/Shanghai')::date,
            case decision.followup->>'priority' when 'high' then 1 when 'low' then 30 else 7 end) <> 0)))
    order by s.final_url;
$$;
commit;
