begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.intelligence_topics (
 owner_id uuid not null references auth.users(id), code text not null,
 name text not null, description text not null, active boolean not null default true,
 revision integer not null default 1, updated_at timestamptz not null default now(),
 primary key(owner_id,code),
 check(revision>0 and length(btrim(name)) between 1 and 60 and length(btrim(description)) between 1 and 240),
 check(code in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas')
   or code ~ '^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
alter table public.intelligence_topics enable row level security;
revoke all on public.intelligence_topics from public,anon,authenticated;
grant all on public.intelligence_topics to service_role;

create function public.save_intelligence_topic(p_owner_id uuid,p_code text,p_revision integer,p_name text,p_description text,p_active boolean)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_topics%rowtype; built_in boolean; active_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,48));
 built_in:=p_code in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas');
 if p_revision is null or p_revision<0 or p_active is null or p_code is null
 or (not built_in and p_code !~ '^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 or coalesce(length(btrim(p_name)),0) not between 1 and 60 or coalesce(length(btrim(p_description)),0) not between 1 and 240
 then return jsonb_build_object('error','invalid_request');end if;
 select * into r from public.intelligence_topics where owner_id=p_owner_id and code=p_code for update;
 select 7 - count(*) filter(where code in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas') and not active)
   + count(*) filter(where code like 'custom-%' and active) into active_count
 from public.intelligence_topics where owner_id=p_owner_id;
 if p_active and (r.code is null or not r.active) and active_count>=20 then return jsonb_build_object('error','topic_limit');end if;
 if r.code is null then
   if p_revision<>0 then return jsonb_build_object('error','topic_conflict');end if;
   insert into public.intelligence_topics(owner_id,code,name,description,active) values(p_owner_id,p_code,btrim(p_name),btrim(p_description),p_active) returning * into r;
 else
   if r.revision<>p_revision then return jsonb_build_object('error','topic_conflict');end if;
   update public.intelligence_topics set name=btrim(p_name),description=btrim(p_description),active=p_active,revision=revision+1,updated_at=now()
   where owner_id=p_owner_id and code=p_code returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.save_intelligence_topic(uuid,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_intelligence_topic(uuid,text,integer,text,text,boolean) to service_role;

create function public.intelligence_valid_topic_codes(codes text[])
returns boolean language sql immutable strict set search_path=public as $$
 select cardinality(codes)<=20 and not exists(select 1 from unnest(codes) code where code is null or
   (code not in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas')
    and code !~ '^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
alter table public.intelligence_candidates drop constraint intelligence_candidates_topic_codes_check;
alter table public.intelligence_candidates add constraint intelligence_candidates_topic_codes_check
 check(public.intelligence_valid_topic_codes(topic_codes));
commit;
