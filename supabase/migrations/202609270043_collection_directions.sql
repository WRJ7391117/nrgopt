begin;
set local lock_timeout='5s';
create table public.intelligence_collection_directions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 revision integer not null default 1, config jsonb not null, effective_on date not null,
 updated_at timestamptz not null default now(), check(revision>0 and jsonb_typeof(config)='object')
);
create table public.intelligence_collection_direction_versions (
 direction_id uuid not null references public.intelligence_collection_directions(id), owner_id uuid not null references auth.users(id),
 revision integer not null, config jsonb not null, effective_on date not null, recorded_at timestamptz not null default now(),
 primary key(direction_id,revision)
);
alter table public.intelligence_job_runs add column collection_directions jsonb;
create table public.intelligence_direction_sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 job_run_id uuid not null references public.intelligence_job_runs(id), direction_id uuid not null references public.intelligence_collection_directions(id),
 direction jsonb not null, url text not null, source_id uuid references public.intelligence_sources(id),
 match jsonb, analysis_sha256 text, analysis_extracted_at timestamptz, created_at timestamptz not null default now(),
 unique(job_run_id,direction_id,url)
);
create index intelligence_direction_sources_lookup on public.intelligence_direction_sources(owner_id,source_id);
create index intelligence_direction_versions_effective on public.intelligence_collection_direction_versions(owner_id,effective_on);
alter table public.intelligence_collection_directions enable row level security;
alter table public.intelligence_collection_direction_versions enable row level security;
alter table public.intelligence_direction_sources enable row level security;
revoke all on public.intelligence_collection_directions,public.intelligence_collection_direction_versions,public.intelligence_direction_sources from anon,authenticated;
grant all on public.intelligence_collection_directions,public.intelligence_collection_direction_versions,public.intelligence_direction_sources to service_role;

create function public.save_intelligence_collection_direction(p_owner_id uuid,p_id uuid,p_revision integer,p_config jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare d public.intelligence_collection_directions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,43));
 if p_revision is null or p_revision<0 or jsonb_typeof(p_config) is distinct from 'object'
 or jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
 or coalesce(p_config->>'priority','') not in ('high','normal','low')
 or coalesce(length(btrim(p_config->>'name')),0) not between 1 and 80
 or coalesce(length(btrim(p_config->>'why')),0) not between 1 and 400
 or coalesce(length(btrim(p_config->>'industries')),0) not between 1 and 200
 or coalesce(length(p_config->>'exclude'),301)>300
 or jsonb_typeof(p_config->'countries') is distinct from 'array'
 or jsonb_typeof(p_config->'targets') is distinct from 'array' then return jsonb_build_object('error','invalid_request');end if;
 if jsonb_array_length(p_config->'countries') not between 1 and 24 or jsonb_array_length(p_config->'targets') not between 1 and 3
 or exists(select 1 from jsonb_array_elements_text(p_config->'countries') x where x not in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR'))
 or exists(select 1 from jsonb_array_elements_text(p_config->'targets') x where x not in ('signal','investment','procurement')) then return jsonb_build_object('error','invalid_request');end if;
 if p_id is null then
   if p_revision<>0 then return jsonb_build_object('error','direction_conflict');end if;
   if (select count(*) from public.intelligence_collection_directions where owner_id=p_owner_id)>=20 then return jsonb_build_object('error','direction_limit');end if;
   insert into public.intelligence_collection_directions(owner_id,config,effective_on) values(p_owner_id,p_config,(now() at time zone 'Asia/Shanghai')::date+1) returning * into d;
 else
   select * into d from public.intelligence_collection_directions where id=p_id and owner_id=p_owner_id for update;
   if not found then return jsonb_build_object('error','not_found');end if;
   if d.config=p_config and p_revision in(d.revision,d.revision-1) then return to_jsonb(d);end if;
   if d.revision<>p_revision then return jsonb_build_object('error','direction_conflict');end if;
   update public.intelligence_collection_directions set config=p_config,revision=revision+1,effective_on=(now() at time zone 'Asia/Shanghai')::date+1,updated_at=now() where id=p_id returning * into d;
 end if;
 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on) values(d.id,d.owner_id,d.revision,d.config,d.effective_on);
 return to_jsonb(d);
end $$;
create function public.intelligence_effective_collection_directions(p_owner_id uuid,p_day date)
returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.direction_id,'revision',v.revision,'config',v.config)),'[]'::jsonb)
 from (select distinct on(direction_id) * from public.intelligence_collection_direction_versions
 where owner_id=p_owner_id and effective_on<=p_day order by direction_id,revision desc) v;
$$;
revoke all on function public.intelligence_effective_collection_directions(uuid,date) from public,anon,authenticated;
grant execute on function public.intelligence_effective_collection_directions(uuid,date) to service_role;
create function public.snapshot_intelligence_collection_directions(p_owner_id uuid,p_run_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_job_runs%rowtype; plan jsonb;
begin
 select * into r from public.intelligence_job_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'not_found';end if;
 if r.collection_directions is not null then return r.collection_directions;end if;
 -- Never retrofit a plan onto a run that already has work.
 if exists(select 1 from public.intelligence_job_items where job_run_id=r.id) then return null;end if;
 plan:=public.intelligence_effective_collection_directions(p_owner_id,r.schedule_key::date);
 update public.intelligence_job_runs set collection_directions=plan where id=r.id;
 return plan;
end $$;
revoke all on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb),public.snapshot_intelligence_collection_directions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb),public.snapshot_intelligence_collection_directions(uuid,uuid) to service_role;
-- Initial templates start tomorrow; existing runs retain their original settings.
insert into public.intelligence_collection_directions(id,owner_id,config,effective_on)
select md5(o.owner_id::text||':direction:'||t.key)::uuid,o.owner_id,t.config,(now() at time zone 'Asia/Shanghai')::date+1
from (select distinct owner_id from public.intelligence_candidates) o cross join (values
('conflict','{"name":"地区冲突与能源保供","why":"关注供电或燃料中断是否推动关键设施增加备用能力。","industries":"医院、水务、通信、工业设施","countries":["SA","AE","QA","KW","OM","BH","YE","IQ","IR","JO","LB","SY","IL","PS","TR","CY","EG","DZ","LY","MA","TN","SD","EH","MR"],"targets":["signal","investment","procurement"],"exclude":"","priority":"normal","enabled":true}'::jsonb),
('load','{"name":"关键设施用电增长","why":"关注设施新建、扩建带来的新增负荷和供电需求。","industries":"数据中心、工业、水务、交通","countries":["SA","AE","QA","KW","OM","BH","YE","IQ","IR","JO","LB","SY","IL","PS","TR","CY","EG","DZ","LY","MA","TN","SD","EH","MR"],"targets":["signal","investment","procurement"],"exclude":"","priority":"normal","enabled":true}'::jsonb),
('grid','{"name":"电网可靠性与灾害应对","why":"关注停电、极端天气和灾害恢复带来的电网及备用供电需求。","industries":"电网、公共服务、关键基础设施","countries":["SA","AE","QA","KW","OM","BH","YE","IQ","IR","JO","LB","SY","IL","PS","TR","CY","EG","DZ","LY","MA","TN","SD","EH","MR"],"targets":["signal","investment","procurement"],"exclude":"","priority":"normal","enabled":true}'::jsonb),
('policy','{"name":"能源政策与投资计划","why":"关注政策、预算、融资和改造计划是否落实为能源投资。","industries":"政府、能源机构、项目业主","countries":["SA","AE","QA","KW","OM","BH","YE","IQ","IR","JO","LB","SY","IL","PS","TR","CY","EG","DZ","LY","MA","TN","SD","EH","MR"],"targets":["signal","investment","procurement"],"exclude":"","priority":"normal","enabled":true}'::jsonb),
('project','{"name":"能源项目与采购进展","why":"关注明确的光伏、储能和电力基础设施项目及采购变化。","industries":"光伏、储能、电网、工程与服务","countries":["SA","AE","QA","KW","OM","BH","YE","IQ","IR","JO","LB","SY","IL","PS","TR","CY","EG","DZ","LY","MA","TN","SD","EH","MR"],"targets":["signal","investment","procurement"],"exclude":"","priority":"normal","enabled":true}'::jsonb)
) t(key,config);
insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
select id,owner_id,revision,config,effective_on from public.intelligence_collection_directions;
commit;
