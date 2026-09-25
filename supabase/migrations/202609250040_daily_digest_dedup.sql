-- Daily summaries recognize accepted FLASH records created outside the evidence trigger
-- and collapse current same-scope supporting sources into one event entry.
begin;

create or replace function public.enqueue_intelligence_daily_digest(p_owner_id uuid,p_job_run_id uuid)
returns uuid language plpgsql as $$
declare run public.intelligence_job_runs%rowtype; existing uuid; selected_ids bigint[]; changes jsonb;
  coverage jsonb; remaining bigint; notification_id uuid;
begin
  select * into run from public.intelligence_job_runs where id=p_job_run_id and owner_id=p_owner_id for update;
  if run.id is null or run.status not in ('succeeded','partial','failed','budget_paused','manual_paused') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,27));
  select id into existing from public.intelligence_notification_outbox where owner_id=p_owner_id and notification_key='daily:'||run.schedule_key;
  if existing is not null then return existing; end if;

  with recursive pending as (
    select e.*,c.id candidate_id,s.extracted_at
    from public.intelligence_evidence_changes e
      left join public.intelligence_candidates c on c.owner_id=e.owner_id and c.source_id=e.source_id
        and c.source_sha256=e.source_sha256 and c.disposition='candidate'
      left join public.intelligence_sources s on s.id=e.source_id and s.owner_id=e.owner_id
        and s.content_sha256=e.source_sha256 and s.extraction_source_sha256=e.source_sha256
        and s.extraction_status='extracted'
    where e.owner_id=p_owner_id and e.digest_eligible and e.digest_notification_id is null
  ), edges as (
    select l.id left_id,rp.id right_id
    from pending l
      join public.intelligence_candidate_relations relation on relation.owner_id=p_owner_id
        and relation.candidate_id=l.candidate_id and relation.relation='supports' and relation.same_scope=true
        and relation.left_source_sha256=l.source_sha256 and relation.left_extracted_at=l.extracted_at
      join pending rp on rp.candidate_id=relation.related_candidate_id
        and relation.right_source_sha256=rp.source_sha256 and relation.right_extracted_at=rp.extracted_at
  ), reach(root_id,id) as (
    select id,id from pending
    union
    select reach.root_id,case when edges.left_id=reach.id then edges.right_id else edges.left_id end
    from reach join edges on edges.left_id=reach.id or edges.right_id=reach.id
  ), raw_components as (
    select id,min(root_id) component_id from reach group by id
  ), ambiguous as (
    select distinct l_component.component_id
    from raw_components l_component
      join pending l on l.id=l_component.id
      join public.intelligence_candidate_relations relation on relation.owner_id=p_owner_id
        and relation.candidate_id=l.candidate_id
        and (relation.relation<>'supports' or relation.same_scope is distinct from true)
        and relation.left_source_sha256=l.source_sha256 and relation.left_extracted_at=l.extracted_at
      join pending rp on rp.candidate_id=relation.related_candidate_id
        and relation.right_source_sha256=rp.source_sha256 and relation.right_extracted_at=rp.extracted_at
      join raw_components r_component on r_component.id=rp.id and r_component.component_id=l_component.component_id
  ), components as (
    select raw_components.id,case when ambiguous.component_id is null then raw_components.component_id else raw_components.id end component_id
    from raw_components left join ambiguous using(component_id)
  ), annotated as (
    select p.*,components.component_id,exists(
      select 1 from public.intelligence_notification_outbox flash
      where flash.owner_id=p.owner_id and flash.notification_type='flash' and flash.status='accepted'
        and (flash.id=p.flash_notification_id or (
          flash.created_at>=p.created_at and flash.payload->>'source_id'=p.source_id::text
          and (nullif(flash.payload->>'source_sha256','') is null or flash.payload->>'source_sha256'=p.source_sha256)
        ))
    ) flash_accepted
    from pending p join components using(id)
  ), grouped as (
    select component_id,max(id) representative_id,min(id) first_id,count(*) source_count,
      bool_or(flash_accepted) flash_accepted,jsonb_agg(source_id order by id) source_ids
    from annotated group by component_id
  ), chosen as (
    select * from grouped order by first_id limit 5
  ), selected as (
    select array_agg(a.id order by a.id) ids
    from annotated a join chosen c using(component_id)
  ), payloads as (
    select c.first_id,a.payload||jsonb_build_object('flash_accepted',c.flash_accepted,
      'grouped_source_count',c.source_count,'grouped_source_ids',c.source_ids) payload
    from chosen c join annotated a on a.id=c.representative_id
  )
  select (select ids from selected),coalesce(jsonb_agg(payload order by first_id),'[]'::jsonb)
  into selected_ids,changes from payloads;

  with recursive pending as (
    select e.id,e.source_id,e.source_sha256,c.id candidate_id,s.extracted_at
    from public.intelligence_evidence_changes e
      left join public.intelligence_candidates c on c.owner_id=e.owner_id and c.source_id=e.source_id
        and c.source_sha256=e.source_sha256 and c.disposition='candidate'
      left join public.intelligence_sources s on s.id=e.source_id and s.owner_id=e.owner_id
        and s.content_sha256=e.source_sha256 and s.extraction_source_sha256=e.source_sha256
        and s.extraction_status='extracted'
    where e.owner_id=p_owner_id and e.digest_eligible and e.digest_notification_id is null
  ), edges as (
    select l.id left_id,rp.id right_id
    from pending l
      join public.intelligence_candidate_relations relation on relation.owner_id=p_owner_id
        and relation.candidate_id=l.candidate_id and relation.relation='supports' and relation.same_scope=true
        and relation.left_source_sha256=l.source_sha256 and relation.left_extracted_at=l.extracted_at
      join pending rp on rp.candidate_id=relation.related_candidate_id
        and relation.right_source_sha256=rp.source_sha256 and relation.right_extracted_at=rp.extracted_at
  ), reach(root_id,id) as (
    select id,id from pending
    union
    select reach.root_id,case when edges.left_id=reach.id then edges.right_id else edges.left_id end
    from reach join edges on edges.left_id=reach.id or edges.right_id=reach.id
  ), raw_components as (
    select id,min(root_id) component_id from reach group by id
  ), ambiguous as (
    select distinct l_component.component_id
    from raw_components l_component
      join pending l on l.id=l_component.id
      join public.intelligence_candidate_relations relation on relation.owner_id=p_owner_id
        and relation.candidate_id=l.candidate_id
        and (relation.relation<>'supports' or relation.same_scope is distinct from true)
        and relation.left_source_sha256=l.source_sha256 and relation.left_extracted_at=l.extracted_at
      join pending rp on rp.candidate_id=relation.related_candidate_id
        and relation.right_source_sha256=rp.source_sha256 and relation.right_extracted_at=rp.extracted_at
      join raw_components r_component on r_component.id=rp.id and r_component.component_id=l_component.component_id
  ), components as (
    select raw_components.id,case when ambiguous.component_id is null then raw_components.component_id else raw_components.id end component_id
    from raw_components left join ambiguous using(component_id)
  )
  select greatest(count(distinct component_id)-5,0) into remaining
  from components;

  select jsonb_build_object('total',count(*),'succeeded',count(*) filter(where status='succeeded'),
    'paused',count(*) filter(where status in ('budget_paused','manual_paused')),
    'failed',count(*) filter(where status in ('failed','retry')),'unfinished',count(*) filter(where status in ('queued','running')))
    into coverage from public.intelligence_job_items where job_run_id=p_job_run_id and owner_id=p_owner_id;
  notification_id := public.enqueue_intelligence_notification(p_owner_id,'daily','daily:'||run.schedule_key,
    jsonb_build_object('job_id',p_job_run_id,'schedule_key',run.schedule_key,'status',run.status,'coverage',coverage,
      'changes',changes,'remaining_changes',remaining));
  if notification_id is null then raise exception 'digest_payload_invalid'; end if;
  update public.intelligence_evidence_changes set digest_notification_id=notification_id
    where owner_id=p_owner_id and id=any(coalesce(selected_ids,'{}'::bigint[]));
  return notification_id;
end $$;

revoke all on function public.enqueue_intelligence_daily_digest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_intelligence_daily_digest(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
