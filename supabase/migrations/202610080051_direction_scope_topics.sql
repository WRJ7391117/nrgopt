begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.intelligence_collection_directions add column position integer not null default 1 check(position>0);
with ordered as (
 select id,row_number() over(partition by owner_id order by updated_at desc,id asc)::integer position
 from public.intelligence_collection_directions
)
update public.intelligence_collection_directions d set position=o.position from ordered o where d.id=o.id;
create index intelligence_direction_order on public.intelligence_collection_directions(owner_id,position,id);

alter table public.intelligence_job_runs add column collection_topics jsonb
 check(collection_topics is null or jsonb_typeof(collection_topics)='array');

create or replace function public.save_intelligence_collection_direction(p_owner_id uuid,p_id uuid,p_revision integer,p_config jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare d public.intelligence_collection_directions%rowtype; previous_topics jsonb:='[]'::jsonb;
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
 p_config:=p_config||jsonb_build_object('topic_codes',coalesce(p_config->'topic_codes','[]'::jsonb));
 if jsonb_typeof(p_config->'topic_codes') is distinct from 'array' then return jsonb_build_object('error','invalid_request');end if;
 if jsonb_array_length(p_config->'topic_codes')>20
 or exists(select 1 from jsonb_array_elements(p_config->'topic_codes') code where jsonb_typeof(code) is distinct from 'string')
 or exists(select 1 from jsonb_array_elements_text(p_config->'topic_codes') code group by code having count(*)>1)
 then return jsonb_build_object('error','invalid_request');end if;
 if p_id is not null then
   select * into d from public.intelligence_collection_directions where id=p_id and owner_id=p_owner_id for update;
   if not found then return jsonb_build_object('error','not_found');end if;
   previous_topics:=coalesce(d.config->'topic_codes','[]'::jsonb);
 end if;
 -- A paused topic already linked to this direction remains visible in its history.
 if exists(select 1 from jsonb_array_elements_text(p_config->'topic_codes') link(code)
   left join public.intelligence_topics t on t.owner_id=p_owner_id and t.code=link.code
   where (t.code is null and link.code not in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas'))
     or (t.active=false and not (previous_topics ? link.code))) then return jsonb_build_object('error','invalid_request');end if;
 if p_id is null then
   if p_revision<>0 then return jsonb_build_object('error','direction_conflict');end if;
   if (select count(*) from public.intelligence_collection_directions where owner_id=p_owner_id)>=20 then return jsonb_build_object('error','direction_limit');end if;
   insert into public.intelligence_collection_directions(owner_id,config,effective_on,position)
   values(p_owner_id,p_config,(now() at time zone 'Asia/Shanghai')::date+1,
     (select coalesce(max(position),0)+1 from public.intelligence_collection_directions where owner_id=p_owner_id)) returning * into d;
 else
   if (d.config||jsonb_build_object('topic_codes',previous_topics))=p_config and p_revision in(d.revision,d.revision-1) then return to_jsonb(d);end if;
   if d.revision<>p_revision then return jsonb_build_object('error','direction_conflict');end if;
   update public.intelligence_collection_directions set config=p_config,revision=revision+1,effective_on=(now() at time zone 'Asia/Shanghai')::date+1,updated_at=now() where id=p_id returning * into d;
 end if;
 insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on) values(d.id,d.owner_id,d.revision,d.config,d.effective_on);
 return to_jsonb(d);
end $$;

create or replace function public.snapshot_intelligence_collection_directions(p_owner_id uuid,p_run_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_job_runs%rowtype; plan jsonb; topics jsonb;
begin
 select * into r from public.intelligence_job_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'not_found';end if;
 if r.collection_directions is not null then return r.collection_directions;end if;
 -- Existing work keeps the plan it started with, including legacy runs without a snapshot.
 if exists(select 1 from public.intelligence_job_items where job_run_id=r.id) then return null;end if;
 plan:=public.intelligence_effective_collection_directions(p_owner_id,r.schedule_key::date);
 with built_in(code,name,description) as (values
   ('red-sea','红海','红海及沿岸跨境航运、能源运输与电力项目'),
   ('hormuz','霍尔木兹海峡','霍尔木兹海峡相关的跨境能源运输与供应'),
   ('bab-el-mandeb','曼德海峡','曼德海峡相关的跨境航运与能源运输'),
   ('suez','苏伊士运河','苏伊士运河相关的跨境航运与能源运输'),
   ('east-mediterranean','东地中海','东地中海跨境能源资源、管网与电力合作'),
   ('mediterranean-interconnection','地中海能源互联','地中海两岸跨境电力互联'),
   ('trans-saharan-gas','跨撒哈拉天然气管道','跨撒哈拉天然气管道及相关跨境建设')
 ), catalog as (
   select b.code,coalesce(t.name,b.name) name,coalesce(t.description,b.description) description,
     coalesce(t.revision,0) revision,coalesce(t.active,true) active
   from built_in b left join public.intelligence_topics t on t.owner_id=p_owner_id and t.code=b.code
   union all
   select t.code,t.name,t.description,t.revision,t.active from public.intelligence_topics t
   where t.owner_id=p_owner_id and not exists(select 1 from built_in b where b.code=t.code)
 )
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'description',description,'revision',revision) order by code),'[]'::jsonb)
 into topics from catalog where active;
 update public.intelligence_job_runs set collection_directions=plan,collection_topics=topics where id=r.id;
 return plan;
end $$;

create function public.intelligence_collection_search_plan(p_owner_id uuid,p_run_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare plan jsonb; topics jsonb;
begin
 plan:=public.snapshot_intelligence_collection_directions(p_owner_id,p_run_id);
 select collection_topics into topics from public.intelligence_job_runs where id=p_run_id and owner_id=p_owner_id;
 return jsonb_build_object('directions',plan,'topics',topics,'legacy',topics is null);
end $$;

-- Count executed query slots, not retries, queued plans or budget pauses, without returning checkpoint text.
create index intelligence_direction_search_calls on public.intelligence_budget_reservations(owner_id,job_run_id)
 where operation='discovery' and call_started_at is not null;
create function public.intelligence_direction_query_counts(p_owner_id uuid,p_before_day date)
returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('direction_id',direction_id,'query_count',query_count)),'[]'::jsonb)
 from (
   select i.checkpoint->'direction'->>'id' direction_id,count(*) query_count
   from public.intelligence_job_items i join public.intelligence_job_runs r on r.id=i.job_run_id and r.owner_id=i.owner_id
   where i.owner_id=p_owner_id and i.item_key like 'discover:%' and r.schedule_key<p_before_day::text
     and i.checkpoint->'direction'->>'id' is not null
     and exists(select 1 from public.intelligence_budget_reservations b
       where b.owner_id=p_owner_id and b.job_run_id=i.job_run_id and b.operation='discovery' and b.call_started_at is not null
         and b.idempotency_key like i.job_run_id::text||':'||i.item_key||':%')
   group by i.checkpoint->'direction'->>'id'
 ) counts;
$$;
revoke all on function public.intelligence_collection_search_plan(uuid,uuid),public.intelligence_direction_query_counts(uuid,date) from public,anon,authenticated;
grant execute on function public.intelligence_collection_search_plan(uuid,uuid),public.intelligence_direction_query_counts(uuid,date) to service_role;
revoke all on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb),public.snapshot_intelligence_collection_directions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb),public.snapshot_intelligence_collection_directions(uuid,uuid) to service_role;
commit;
