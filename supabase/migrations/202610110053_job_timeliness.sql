begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index intelligence_job_watch_url on public.intelligence_job_items(owner_id, (checkpoint->>'url'))
  where checkpoint @> '{"watch":true}'::jsonb and item_key like 'source:%';
create index intelligence_job_owner_progress on public.intelligence_job_items(owner_id, updated_at)
  where attempts > 0;

-- Keep human decisions; only bound newly scheduled URL revisits, never delete old work.
create or replace function public.intelligence_watched_sources(p_owner_id uuid)
returns table(url text) language sql stable as $$
  with day as (select (now() at time zone 'Asia/Shanghai')::date as today),
  history as (
    select i.checkpoint->>'url' as url, max(r.schedule_key::date) as last_day,
      bool_or(i.status in ('queued','running','retry') and r.status in ('queued','running','retry')) as pending,
      count(*) filter (where r.schedule_key = day.today::text) as today_count
    from public.intelligence_job_items i join public.intelligence_job_runs r on r.id = i.job_run_id and r.owner_id = i.owner_id
    cross join day where i.owner_id = p_owner_id and r.job_type = 'daily_scan'
      and r.schedule_key ~ '^\d{4}-\d{2}-\d{2}$'
      and i.checkpoint @> '{"watch":true}'::jsonb and i.item_key like 'source:%'
    group by i.checkpoint->>'url'
  ), eligible as (
    select s.final_url as url,
      case when w.followup->>'priority' = 'high' then 0
        when (w.followup->>'review_on')::date <= day.today then 1
        when w.followup is not null then 2 else 3 end as priority,
      coalesce(h.last_day, (case when w.followup is not null then w.updated_at else w.created_at end at time zone 'Asia/Shanghai')::date) as last_day
    from public.intelligence_watch_targets w
    join public.intelligence_candidates c on c.id = w.candidate_id and c.owner_id = w.owner_id
    join public.intelligence_sources s on s.id = c.source_id and s.owner_id = w.owner_id
    cross join day left join history h on h.url = s.final_url
    where w.owner_id = p_owner_id and w.status = 'active' and c.disposition = 'candidate'
      and s.status = 'pending_extraction' and s.final_url is not null and not coalesce(h.pending, false)
      and coalesce(h.last_day, day.today - 1) < day.today
      and not exists (select 1 from public.intelligence_watch_targets decision
        where decision.owner_id = w.owner_id and decision.candidate_id = w.candidate_id
          and decision.followup is not null and (decision.status <> 'active' or w.followup is null))
      and ((w.followup is not null and (w.followup->>'review_on')::date <= day.today)
        or day.today - coalesce(h.last_day, (case when w.followup is not null then w.updated_at else w.created_at end at time zone 'Asia/Shanghai')::date)
          >= case when w.followup is not null then case w.followup->>'priority' when 'high' then 1 when 'low' then 30 else 7 end
            else case c.importance when 'critical' then 1 when 'high' then 1 when 'low' then 30 else 7 end end)
  )
  select e.url from eligible e group by e.url
  order by min(e.priority), min(e.last_day), e.url
  limit (select greatest(0, 40 - coalesce(sum(today_count), 0)) from history);
$$;

-- Lease recovery and due retries retain their existing fencing and owner serialization.
create or replace function public.claim_intelligence_job_item_v2(
  p_owner_id uuid, p_job_run_id uuid default null, p_lease_seconds integer default 300
) returns table(id uuid, item_key text, attempts smallint, checkpoint jsonb, job_run_id uuid)
language plpgsql as $$
declare v_item public.intelligence_job_items%rowtype; v_run uuid;
  v_today text := (now() at time zone 'Asia/Shanghai')::date::text; v_old_turn boolean;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 300 then raise exception 'invalid_lease'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(p_owner_id::text, 731)) then return; end if;
  for v_run in
    update public.intelligence_job_items i set status = 'failed', lease_until = null,
      error_code = 'lease_exhausted', finished_at = now(), updated_at = now()
    where i.owner_id = p_owner_id and i.status = 'running' and i.lease_until <= now() and i.attempts >= 3
    returning i.job_run_id
  loop
    perform public.refresh_intelligence_job(p_owner_id, v_run);
  end loop;
  if exists (select 1 from public.intelligence_job_items i
    where i.owner_id = p_owner_id and i.status = 'running' and i.lease_until > now()) then return; end if;
  -- Three recent/new slots followed by one oldest-work slot, without a global history scan.
  select mod(coalesce(sum(i.attempts), 0), 4) = 3 into v_old_turn
    from public.intelligence_job_items i where i.owner_id = p_owner_id
      and i.attempts > 0 and i.updated_at >= (v_today::date::timestamp at time zone 'Asia/Shanghai');
  select i.* into v_item from public.intelligence_job_items i
  join public.intelligence_job_runs r on r.id = i.job_run_id and r.owner_id = i.owner_id
  where i.owner_id = p_owner_id and (p_job_run_id is null or i.job_run_id = p_job_run_id)
    and r.status in ('queued','running','retry') and i.attempts < 3
    and ((i.status in ('queued','retry') and i.next_attempt_at <= now())
      or (i.status = 'running' and i.lease_until <= now()))
  order by
    case when p_job_run_id is not null then 0
      when i.status = 'running' then 0
      when i.checkpoint->>'watch' = 'true' and exists (
        select 1 from public.intelligence_watch_targets w
        join public.intelligence_candidates c on c.id = w.candidate_id and c.owner_id = w.owner_id
        join public.intelligence_sources s on s.id = c.source_id and s.owner_id = w.owner_id
        where w.owner_id = p_owner_id and w.status = 'active' and w.followup is not null
          and (w.followup->>'priority' = 'high' or (w.followup->>'review_on')::date <= v_today::date)
          and (s.final_url = i.checkpoint->>'url' or s.id::text = i.checkpoint->>'source_id')) then 2
      when v_old_turn then 3
      when (i.status = 'retry' and i.created_at >= (v_today::date::timestamp at time zone 'Asia/Shanghai'))
        or (i.checkpoint->>'fresh' = 'true' and i.created_at >= (v_today::date::timestamp at time zone 'Asia/Shanghai')) or (r.schedule_key = v_today
        and (i.item_key like 'discover:%' or i.item_key like 'registry:%'
          or ((i.item_key like 'source:%' or i.item_key like 'extract:%') and coalesce(i.checkpoint->>'watch', 'false') <> 'true')))
        then 3 else 4 end,
    case when not v_old_turn and p_job_run_id is null and i.checkpoint->>'fresh' = 'true'
      and i.created_at >= (v_today::date::timestamp at time zone 'Asia/Shanghai') then 0 else 1 end,
    r.created_at, r.id, i.item_key for update of i skip locked limit 1;
  if v_item.id is null then return; end if;
  update public.intelligence_job_items i set status = 'running', attempts = i.attempts + 1,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(i.started_at, now()), updated_at = now(), error_code = null
  where i.id = v_item.id
  returning i.id, i.item_key, i.attempts, i.checkpoint, i.job_run_id into id, item_key, attempts, checkpoint, job_run_id;
  update public.intelligence_job_runs r set status = 'running',
    started_at = coalesce(r.started_at, now()), finished_at = null, updated_at = now()
  where r.id = v_item.job_run_id and r.owner_id = p_owner_id;
  return next;
end $$;

revoke all on function public.intelligence_watched_sources(uuid) from public, anon, authenticated;
revoke all on function public.claim_intelligence_job_item_v2(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.intelligence_watched_sources(uuid) to service_role;
grant execute on function public.claim_intelligence_job_item_v2(uuid,uuid,integer) to service_role;
commit;
