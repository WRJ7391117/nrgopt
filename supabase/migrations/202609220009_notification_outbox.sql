-- G3 notification outbox. Delivery is separate from candidate/job transactions.
begin;

create table public.intelligence_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  notification_type text not null check (notification_type in ('flash','daily','system')),
  notification_key text not null check (length(notification_key) between 1 and 200),
  status text not null default 'pending' check (status in ('pending','sending','accepted','retry','failed','unknown')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  lease_until timestamptz,
  response_code integer,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (owner_id, notification_key)
);

create index intelligence_notification_outbox_claim on public.intelligence_notification_outbox(owner_id, status, created_at);
alter table public.intelligence_notification_outbox enable row level security;
revoke all on public.intelligence_notification_outbox from anon, authenticated;
grant select, insert, update, delete on public.intelligence_notification_outbox to service_role;

create or replace function public.enqueue_intelligence_notification(
  p_owner_id uuid, p_notification_type text, p_notification_key text, p_payload jsonb
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_notification_type not in ('flash','daily','system') or p_notification_key is null
     or length(p_notification_key) not between 1 and 200 or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 20000 then return null; end if;
  insert into public.intelligence_notification_outbox(owner_id, notification_type, notification_key, payload)
  values (p_owner_id, p_notification_type, p_notification_key, p_payload)
  on conflict (owner_id, notification_key) do nothing
  returning intelligence_notification_outbox.id into v_id;
  if v_id is null then
    select id into v_id from public.intelligence_notification_outbox
    where owner_id = p_owner_id and notification_key = p_notification_key;
  end if;
  return v_id;
end $$;

create or replace function public.claim_intelligence_notification(
  p_owner_id uuid, p_lease_seconds integer default 120
) returns table(id uuid, notification_type text, notification_key text, payload jsonb, attempts smallint) language plpgsql as $$
declare v_item public.intelligence_notification_outbox%rowtype;
begin
  if p_lease_seconds not between 30 and 300 then return; end if;
  update public.intelligence_notification_outbox set status = 'unknown', lease_until = null,
    error_code = 'delivery_result_unknown', updated_at = now()
  where owner_id = p_owner_id and status = 'sending' and lease_until < now();
  select n.* into v_item from public.intelligence_notification_outbox n
  where n.owner_id = p_owner_id and n.status in ('pending','retry') and n.attempts < 3
  order by n.created_at for update skip locked limit 1;
  if v_item.id is null then return; end if;
  update public.intelligence_notification_outbox set status = 'sending',
    attempts = intelligence_notification_outbox.attempts + 1,
    lease_until = now() + make_interval(secs => p_lease_seconds), error_code = null, updated_at = now()
  where intelligence_notification_outbox.id = v_item.id
  returning intelligence_notification_outbox.id, intelligence_notification_outbox.notification_type,
    intelligence_notification_outbox.notification_key, intelligence_notification_outbox.payload,
    intelligence_notification_outbox.attempts into id, notification_type, notification_key, payload, attempts;
  return next;
end $$;

create or replace function public.finish_intelligence_notification(
  p_owner_id uuid, p_id uuid, p_status text, p_response_code integer default null, p_error_code text default null
) returns boolean language plpgsql as $$
declare v_attempts smallint; v_status text;
begin
  if p_status not in ('accepted','retry','failed','unknown') then return false; end if;
  select attempts into v_attempts from public.intelligence_notification_outbox
  where id = p_id and owner_id = p_owner_id and status = 'sending' for update;
  if v_attempts is null then return false; end if;
  v_status := case when p_status = 'retry' and v_attempts >= 3 then 'failed' else p_status end;
  update public.intelligence_notification_outbox set status = v_status, response_code = p_response_code,
    error_code = p_error_code, lease_until = null, updated_at = now(),
    accepted_at = case when v_status = 'accepted' then now() else accepted_at end
  where id = p_id;
  return true;
end $$;

create or replace function public.enqueue_candidate_flash_notification()
returns trigger language plpgsql as $$
declare v_key text;
begin
  if new.disposition = 'candidate' and (new.importance = 'critical' or (new.importance = 'high' and new.urgency in ('prepare','deadline'))) then
    v_key := left(format('flash:%s:%s:%s:%s:%s', new.id, new.source_sha256, new.importance, new.urgency, new.evidence_status), 200);
    insert into public.intelligence_notification_outbox(owner_id, notification_type, notification_key, payload)
    values (new.owner_id, 'flash', v_key, jsonb_build_object('candidate_id', new.id, 'source_id', new.source_id,
      'title_zh', new.title_zh, 'summary_zh', new.summary_zh, 'countries', new.occurrence_countries,
      'importance', new.importance, 'urgency', new.urgency, 'evidence_status', new.evidence_status))
    on conflict (owner_id, notification_key) do nothing;
  end if;
  return new;
end $$;

create trigger intelligence_candidate_flash_outbox
after insert or update of source_sha256, importance, urgency, evidence_status on public.intelligence_candidates
for each row execute function public.enqueue_candidate_flash_notification();

revoke all on function public.enqueue_intelligence_notification(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.claim_intelligence_notification(uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_intelligence_notification(uuid,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.enqueue_intelligence_notification(uuid,text,text,jsonb) to service_role;
grant execute on function public.claim_intelligence_notification(uuid,integer) to service_role;
grant execute on function public.finish_intelligence_notification(uuid,uuid,text,integer,text) to service_role;

commit;
