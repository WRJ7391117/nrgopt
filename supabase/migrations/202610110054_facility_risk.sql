begin;
set local lock_timeout='5s';

-- Risk evidence stays separate from energy projects, procurement and user decisions.
create table public.intelligence_risk_signals (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 source_id uuid not null references public.intelligence_sources(id),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 event_key text check(event_key ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('reported','pending_verification','historical')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=18000),
 flash_notification_id uuid references public.intelligence_notification_outbox(id),
 digest_notification_id uuid references public.intelligence_notification_outbox(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,source_id,source_sha256)
);
create index intelligence_risk_owner_time on public.intelligence_risk_signals(owner_id,updated_at desc);
create index intelligence_risk_event on public.intelligence_risk_signals(owner_id,event_key);
alter table public.intelligence_risk_signals enable row level security;
revoke all on public.intelligence_risk_signals from anon,authenticated;
grant select,insert,update,delete on public.intelligence_risk_signals to service_role;

create function public.save_intelligence_risk_signal(p_owner_id uuid,p_source_id uuid,p_source_sha256 text,p_payload jsonb)
returns uuid language plpgsql set search_path=public as $$
declare s public.intelligence_sources%rowtype; r public.intelligence_risk_signals%rowtype;
 event_day date; published date; day date:=(now() at time zone 'Asia/Shanghai')::date;
 notice uuid; eligible boolean; scoped boolean; event_key text; fingerprint text;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>18000
  or coalesce(p_payload->>'status','') not in ('reported','pending_verification','historical')
  or jsonb_typeof(p_payload->'facts') is distinct from 'array' or jsonb_array_length(p_payload->'facts')=0
  or coalesce(p_payload->>'country_code','') not in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM')
  or coalesce(p_payload->>'fact_fingerprint','') !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into s from public.intelligence_sources where id=p_source_id and owner_id=p_owner_id;
 if s.id is null or s.extraction_status<>'extracted' or s.content_sha256 is distinct from p_source_sha256
  or s.extraction_source_sha256 is distinct from p_source_sha256 then return null; end if;
 event_key:=nullif(p_payload->>'event_key',''); fingerprint:=p_payload->>'fact_fingerprint';
 if event_key is not null and event_key !~ '^[a-f0-9]{64}$' then return null; end if;
 begin
  event_day:=nullif(p_payload->>'event_date','')::date;
  published:=s.publication_date;
 exception when invalid_datetime_format or datetime_field_overflow then return null; end;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,54));
 insert into public.intelligence_risk_signals(owner_id,source_id,source_sha256,event_key,status,payload)
 values(p_owner_id,p_source_id,p_source_sha256,event_key,p_payload->>'status',p_payload||jsonb_build_object('source_id',p_source_id,'source_sha256',p_source_sha256))
 on conflict(owner_id,source_id,source_sha256) do nothing returning * into r;
 if r.id is null then
  select * into r from public.intelligence_risk_signals where owner_id=p_owner_id and source_id=p_source_id and source_sha256=p_source_sha256;
  return r.id;
 end if;
 -- A declaration of solidarity or an unknown event date is a lead, not a new verified incident.
 eligible:=p_payload->>'notification_eligible'='true' and r.status='reported' and event_key is not null
  and event_day between day-3 and day and published between day-3 and day
  and s.extraction_zh->'risk_signal'->>'event_status'='reported_event'
  and s.extraction_zh->'risk_signal'->>'event_date'=event_day::text;
 scoped:=not exists(select 1 from public.intelligence_collection_directions where owner_id=p_owner_id)
  or exists(select 1 from jsonb_array_elements(public.intelligence_effective_collection_directions(p_owner_id,day)) d
   where d->'config'->>'enabled'='true' and d->'config'->'countries' ? (p_payload->>'country_code'));
 if eligible and scoped then
  notice:=public.enqueue_intelligence_notification(p_owner_id,'flash','flash:risk:'||event_key||':'||fingerprint,
   r.payload||jsonb_build_object('kind','risk','risk_id',r.id,'countries',jsonb_build_array(p_payload->>'country_code')));
  update public.intelligence_risk_signals set flash_notification_id=notice where id=r.id;
 end if;
 return r.id;
end $$;
revoke all on function public.save_intelligence_risk_signal(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_risk_signal(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
