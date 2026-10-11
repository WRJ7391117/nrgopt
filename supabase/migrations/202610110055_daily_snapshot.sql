begin;
set local lock_timeout='5s';

-- One Beijing-date report contains the completed evidence available at its reporting time.
create function public.enqueue_intelligence_daily_snapshot(p_owner_id uuid,p_day date,p_now timestamptz default now(),p_report_hour integer default 8)
returns uuid language plpgsql set search_path=public as $$
declare run public.intelligence_job_runs%rowtype; existing uuid; notice uuid; evidence_ids bigint[]; risk_ids uuid[];
 changes jsonb; coverage jsonb; remaining integer; active_day text;
begin
 if p_day is null or p_report_hour not between 0 and 23 or p_now is null
  or p_day is distinct from (p_now at time zone 'Asia/Shanghai')::date
  or extract(hour from p_now at time zone 'Asia/Shanghai') < p_report_hour then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,27));
 select id into existing from public.intelligence_notification_outbox where owner_id=p_owner_id and notification_type='daily'
  and (notification_key='daily:report:'||p_day::text or (accepted_at at time zone 'Asia/Shanghai')::date=p_day)
  order by created_at desc limit 1;
 if existing is not null then return existing; end if;
 select * into run from public.intelligence_job_runs where owner_id=p_owner_id and job_type='daily_scan' and schedule_key=p_day::text;
 select min(schedule_key) into active_day from public.intelligence_job_runs where owner_id=p_owner_id
  and job_type='daily_scan' and status in ('queued','running','retry');

 with recursive pending as (
  select e.*,c.id candidate_id,s.extracted_at,s.publication_date,c.importance
  from public.intelligence_evidence_changes e
  join public.intelligence_candidates c on c.owner_id=e.owner_id and c.source_id=e.source_id and c.source_sha256=e.source_sha256
   and c.disposition='candidate' and c.review_status<>'rejected'
  join public.intelligence_sources s on s.id=e.source_id and s.owner_id=e.owner_id
   and s.content_sha256=e.source_sha256 and s.extraction_source_sha256=e.source_sha256 and s.extraction_status='extracted'
  where e.owner_id=p_owner_id and e.digest_eligible and e.digest_notification_id is null
   and s.publication_date between p_day-30 and p_day
   and (not exists(select 1 from public.intelligence_collection_directions where owner_id=p_owner_id)
    or exists(select 1 from jsonb_array_elements(public.intelligence_effective_collection_directions(p_owner_id,p_day)) d
     where d->'config'->>'enabled'='true' and d->'config'->'countries' ?| c.occurrence_countries))
 ), edges as (
  select l.id left_id,r.id right_id from pending l
  join public.intelligence_candidate_relations rel on rel.owner_id=p_owner_id and rel.candidate_id=l.candidate_id
   and rel.relation='supports' and rel.same_scope=true and rel.left_source_sha256=l.source_sha256 and rel.left_extracted_at=l.extracted_at
  join pending r on r.candidate_id=rel.related_candidate_id and rel.right_source_sha256=r.source_sha256 and rel.right_extracted_at=r.extracted_at
 ), reach(root_id,id) as (
  select id,id from pending union select reach.root_id,case when edges.left_id=reach.id then edges.right_id else edges.left_id end
  from reach join edges on edges.left_id=reach.id or edges.right_id=reach.id
 ), components as (select id,min(root_id) component_id from reach group by id), ambiguous as (
  select distinct lc.component_id from components lc join pending l on l.id=lc.id
  join public.intelligence_candidate_relations rel on rel.owner_id=p_owner_id and rel.candidate_id=l.candidate_id
   and (rel.relation<>'supports' or rel.same_scope is distinct from true)
   and rel.left_source_sha256=l.source_sha256 and rel.left_extracted_at=l.extracted_at
  join pending r on r.candidate_id=rel.related_candidate_id and rel.right_source_sha256=r.source_sha256 and rel.right_extracted_at=r.extracted_at
  join components rc on rc.id=r.id and rc.component_id=lc.component_id
 ), grouped as (
  select case when a.component_id is null then c.component_id else c.id end component_id,
   array_agg(p.id order by p.id) ids,array_agg(p.source_id) source_ids,(array_agg(p.payload order by p.publication_date desc,p.id desc))[1] payload,
   max(p.publication_date) published,
   max(case p.importance when 'critical' then 350 when 'high' then 250 when 'medium' then 150 else 100 end) priority,
   bool_or(exists(select 1 from public.intelligence_notification_outbox n where n.owner_id=p_owner_id and n.status='accepted'
    and n.notification_type='flash' and (n.id=p.flash_notification_id or (n.payload->>'source_id'=p.source_id::text
     and (n.payload->>'source_sha256' is null or n.payload->>'source_sha256'=p.source_sha256))))) flash_accepted
  from pending p join components c using(id) left join ambiguous a on a.component_id=c.component_id group by 1
 ), risk_pending as (
  select distinct on(coalesce(r.event_key,jsonb_build_array(r.payload->>'country_code',r.payload->>'facility_zh',r.payload->>'fact_fingerprint')::text)) r.*,
   array_agg(r.id) over(partition by coalesce(r.event_key,jsonb_build_array(r.payload->>'country_code',r.payload->>'facility_zh',r.payload->>'fact_fingerprint')::text)) grouped_risk_ids,
   array_agg(r.source_id) over(partition by coalesce(r.event_key,jsonb_build_array(r.payload->>'country_code',r.payload->>'facility_zh',r.payload->>'fact_fingerprint')::text)) grouped_source_ids
  from public.intelligence_risk_signals r join public.intelligence_sources s on s.id=r.source_id and s.owner_id=r.owner_id
   and s.content_sha256=r.source_sha256 and s.extraction_source_sha256=r.source_sha256 and s.extraction_status='extracted'
  where r.owner_id=p_owner_id and r.digest_notification_id is null and r.status<>'historical'
   and coalesce((r.payload->>'event_date')::date,s.publication_date) between p_day-30 and p_day
   and (not exists(select 1 from public.intelligence_collection_directions where owner_id=p_owner_id)
    or exists(select 1 from jsonb_array_elements(public.intelligence_effective_collection_directions(p_owner_id,p_day)) d
     where d->'config'->>'enabled'='true' and d->'config'->'countries' ? (r.payload->>'country_code')))
   and not exists(select 1 from public.intelligence_risk_signals previous where previous.owner_id=r.owner_id
    and previous.digest_notification_id is not null and previous.payload->>'fact_fingerprint'=r.payload->>'fact_fingerprint'
    and ((r.event_key is not null and previous.event_key=r.event_key)
     or (r.event_key is null and previous.payload->>'facility_zh'=r.payload->>'facility_zh'
      and previous.payload->>'country_code'=r.payload->>'country_code' and previous.created_at>=p_now-interval '3 days')))
  order by coalesce(r.event_key,jsonb_build_array(r.payload->>'country_code',r.payload->>'facility_zh',r.payload->>'fact_fingerprint')::text),r.updated_at desc
 ), combined as (
  select ids evidence_ids,'{}'::uuid[] risk_ids,priority,published,
   payload||jsonb_build_object('flash_accepted',flash_accepted,'grouped_source_count',cardinality(ids)) payload from grouped g
  where not exists(select 1 from risk_pending r where r.grouped_source_ids && g.source_ids)
  union all
  -- Five summaries fit the UTF-8 queue limit, including four-byte characters. Full evidence stays in the risk row.
  select coalesce((select array_agg(ids.value) from grouped g cross join lateral unnest(g.ids) ids(value)
    where g.source_ids && r.grouped_source_ids),'{}'::bigint[]),r.grouped_risk_ids,case when r.status='reported' then case when r.payload->>'severity'='critical' then 500 else 400 end else 200 end,
   coalesce((r.payload->>'event_date')::date,(r.payload->>'publication_date')::date),
   jsonb_build_object('source_id',r.source_id,'title_zh',left(r.payload->>'title_zh',60),'facility_zh',left(r.payload->>'facility_zh',80),'country_code',r.payload->>'country_code','event_date',r.payload->'event_date','publication_date',r.payload->'publication_date','energy_impact_zh',left(r.payload->>'energy_impact_zh',180),'facts',jsonb_build_array(left(r.payload->'facts'->>0,160)),'unknowns_zh',jsonb_build_array(left(r.payload->'unknowns_zh'->>0,100)),'next_signals_zh',jsonb_build_array(left(r.payload->'next_signals_zh'->>0,100)),'kind','risk','risk_status',r.status,'countries',jsonb_build_array(r.payload->>'country_code'),
    'flash_accepted',exists(select 1 from public.intelligence_notification_outbox n where n.id=r.flash_notification_id and n.status='accepted'))
  from risk_pending r
 ), selected as (select * from combined order by priority desc,published desc nulls last,payload->>'source_id' limit 5)
 select (select array_agg(ids.value) from selected cross join lateral unnest(selected.evidence_ids) as ids(value)),
  (select array_agg(ids.value) from selected cross join lateral unnest(selected.risk_ids) as ids(value)),
  coalesce(jsonb_agg(payload order by priority desc,published desc),'[]'::jsonb),
  greatest((select count(*) from combined)-5,0)
 into evidence_ids,risk_ids,changes,remaining from selected;

 select jsonb_build_object('total',count(*),'succeeded',count(*) filter(where status='succeeded'),
  'paused',count(*) filter(where status in ('budget_paused','manual_paused')),'failed',count(*) filter(where status='failed'),
  'unfinished',count(*) filter(where status in ('queued','running','retry')))
 into coverage from public.intelligence_job_items where job_run_id=run.id and owner_id=p_owner_id;
 notice:=public.enqueue_intelligence_notification(p_owner_id,'daily','daily:report:'||p_day::text,
  jsonb_build_object('report_date',p_day,'snapshot_at',p_now,'schedule_key',p_day,'job_id',run.id,'status',coalesce(run.status,'missing'),
   'report_kind','snapshot','active_plan_day',active_day,'coverage',coverage,'changes',changes,'remaining_changes',remaining));
 if notice is null then raise exception 'digest_payload_invalid'; end if;
 update public.intelligence_evidence_changes set digest_notification_id=notice where owner_id=p_owner_id and id=any(coalesce(evidence_ids,'{}'::bigint[]));
 update public.intelligence_risk_signals set digest_notification_id=notice where owner_id=p_owner_id and id=any(coalesce(risk_ids,'{}'::uuid[]));
 return notice;
end $$;
revoke all on function public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.enqueue_intelligence_daily_snapshot(uuid,date,timestamptz,integer) to service_role;
notify pgrst,'reload schema';
commit;
