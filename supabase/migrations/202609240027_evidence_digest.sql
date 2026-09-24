-- Source-backed notification versions. Reanalysis of identical bytes is not new evidence.
begin;
create function public.intelligence_quote_fingerprint(p_extraction jsonb)
returns text language sql immutable as $$
  select case when count(*) > 0 then encode(extensions.digest(string_agg(quote,E'\n' order by quote),'sha256'),'hex') end
  from (select distinct lower(regexp_replace(trim(f->>'evidence_quote'),'[[:space:]]+',' ','g')) quote
    from jsonb_array_elements(coalesce(p_extraction->'known_facts','[]'::jsonb)) f
    where length(trim(f->>'evidence_quote')) > 0) q;
$$;
create table public.intelligence_evidence_changes (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  source_id uuid not null references public.intelligence_sources(id),
  source_sha256 text not null, evidence_fingerprint text not null,
  payload jsonb not null, digest_eligible boolean not null,
  digest_notification_id uuid references public.intelligence_notification_outbox(id),
  flash_notification_id uuid references public.intelligence_notification_outbox(id),
  created_at timestamptz not null default now(),
  unique(owner_id,source_sha256)
);
create index intelligence_evidence_changes_pending on public.intelligence_evidence_changes(owner_id,id)
  where digest_eligible and digest_notification_id is null;
create index intelligence_evidence_changes_fingerprint on public.intelligence_evidence_changes(owner_id,evidence_fingerprint);
alter table public.intelligence_evidence_changes enable row level security;
revoke all on public.intelligence_evidence_changes from public,anon,authenticated;
grant select,insert,update on public.intelligence_evidence_changes to service_role;
grant usage on sequence public.intelligence_evidence_changes_id_seq to service_role;
-- Establish a quiet baseline; historical analysis does not become a new alert on migration.
insert into public.intelligence_evidence_changes(owner_id,source_id,source_sha256,evidence_fingerprint,payload,digest_eligible)
select s.owner_id,s.id,s.content_sha256,encode(extensions.digest(s.final_url||E'\n'||public.intelligence_quote_fingerprint(s.extraction_zh),'sha256'),'hex'),'{}',false
from public.intelligence_sources s where s.extraction_status='extracted' and s.extraction_source_sha256=s.content_sha256
  and public.intelligence_quote_fingerprint(s.extraction_zh) is not null
on conflict(owner_id,source_sha256) do nothing;

create or replace function public.enqueue_candidate_flash_notification()
returns trigger language plpgsql as $$
declare s public.intelligence_sources%rowtype; fingerprint text; fresh boolean; change_id bigint;
  snapshot jsonb; notification_id uuid;
begin
  if new.disposition <> 'candidate' then return new; end if;
  select * into s from public.intelligence_sources where id=new.source_id and owner_id=new.owner_id;
  if s.extraction_status <> 'extracted' or s.extraction_source_sha256 is distinct from s.content_sha256
    or new.source_sha256 is distinct from s.content_sha256 then return new; end if;
  fingerprint := public.intelligence_quote_fingerprint(s.extraction_zh);
  if fingerprint is null then return new; end if;
  fingerprint := encode(extensions.digest(s.final_url||E'\n'||fingerprint,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,27));
  if exists(select 1 from public.intelligence_evidence_changes where owner_id=new.owner_id and source_sha256=s.content_sha256) then return new; end if;
  fresh := not exists(select 1 from public.intelligence_evidence_changes where owner_id=new.owner_id and evidence_fingerprint=fingerprint);
  snapshot := jsonb_build_object('source_id',s.id,'title_zh',left(new.title_zh,80),'summary_zh',left(new.summary_zh,120),
    'countries',new.occurrence_countries,'evidence_status',new.evidence_status,'publication_date',s.publication_date,
    'facts',jsonb_build_array(left(s.extraction_zh->'known_facts'->0->>'claim_zh',120)),
    'judgment_zh',left(s.extraction_zh->>'why_it_matters_zh',80),
    'unknown_zh',left(s.extraction_zh->'unknowns_zh'->>0,80),'next_signal_zh',left(s.extraction_zh->'next_signals_zh'->>0,80));
  insert into public.intelligence_evidence_changes(owner_id,source_id,source_sha256,evidence_fingerprint,payload,digest_eligible)
    values(new.owner_id,s.id,s.content_sha256,fingerprint,snapshot,fresh) returning id into change_id;
  if fresh and s.publication_date between current_date-30 and current_date and (new.importance='critical' or (new.importance='high' and new.urgency in ('prepare','deadline'))) then
    notification_id := public.enqueue_intelligence_notification(new.owner_id,'flash','flash:evidence:'||fingerprint,
      snapshot||jsonb_build_object('candidate_id',new.id,'source_sha256',s.content_sha256,'evidence_change_id',change_id));
    update public.intelligence_evidence_changes set flash_notification_id=notification_id where id=change_id;
  end if;
  return new;
end $$;

create function public.enqueue_intelligence_daily_digest(p_owner_id uuid,p_job_run_id uuid)
returns uuid language plpgsql as $$
declare run public.intelligence_job_runs%rowtype; existing uuid; selected_ids bigint[]; changes jsonb;
  coverage jsonb; remaining bigint; notification_id uuid;
begin
  select * into run from public.intelligence_job_runs where id=p_job_run_id and owner_id=p_owner_id for update;
  if run.id is null or run.status not in ('succeeded','partial','failed','budget_paused','manual_paused') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,27));
  select id into existing from public.intelligence_notification_outbox where owner_id=p_owner_id and notification_key='daily:'||run.schedule_key;
  if existing is not null then return existing; end if;
  select array_agg(id order by id),coalesce(jsonb_agg(payload||jsonb_build_object('flash_accepted',flash_accepted) order by id),'[]')
  into selected_ids,changes from (
    select c.id,c.payload,coalesce(n.status='accepted',false) flash_accepted from public.intelligence_evidence_changes c
      left join public.intelligence_notification_outbox n on n.id=c.flash_notification_id
    where c.owner_id=p_owner_id and c.digest_eligible and c.digest_notification_id is null order by c.id limit 5
  ) picked;
  select count(*) into remaining from public.intelligence_evidence_changes
    where owner_id=p_owner_id and digest_eligible and digest_notification_id is null;
  select jsonb_build_object('total',count(*),'succeeded',count(*) filter(where status='succeeded'),
    'paused',count(*) filter(where status in ('budget_paused','manual_paused')),
    'failed',count(*) filter(where status in ('failed','retry')),'unfinished',count(*) filter(where status in ('queued','running')))
    into coverage from public.intelligence_job_items where job_run_id=p_job_run_id and owner_id=p_owner_id;
  notification_id := public.enqueue_intelligence_notification(p_owner_id,'daily','daily:'||run.schedule_key,
    jsonb_build_object('job_id',p_job_run_id,'schedule_key',run.schedule_key,'status',run.status,'coverage',coverage,
      'changes',changes,'remaining_changes',greatest(remaining-coalesce(array_length(selected_ids,1),0),0)));
  if notification_id is null then raise exception 'digest_payload_invalid'; end if;
  update public.intelligence_evidence_changes set digest_notification_id=notification_id where owner_id=p_owner_id and id=any(selected_ids);
  return notification_id;
end $$;
revoke all on function public.intelligence_quote_fingerprint(jsonb),public.enqueue_intelligence_daily_digest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.intelligence_quote_fingerprint(jsonb),public.enqueue_intelligence_daily_digest(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
