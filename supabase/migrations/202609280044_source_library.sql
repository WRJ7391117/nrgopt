begin;
set local lock_timeout='5s';
create table public.intelligence_source_library (
 owner_id uuid not null references auth.users(id), id text not null, revision integer not null,
 config jsonb not null, status text not null check(status in ('candidate','active','paused','removed')),
 access jsonb not null default '{"status":"unchecked"}', updated_at timestamptz not null default now(),
 primary key(owner_id,id), check(revision>0 and jsonb_typeof(config)='object' and jsonb_typeof(access)='object')
);
create unique index intelligence_library_unique_scope on public.intelligence_source_library(owner_id,(config->>'scope_key'));
create table public.intelligence_source_library_history (
 owner_id uuid not null references auth.users(id), entry_id text not null, revision integer not null,
 config jsonb not null, status text not null, access jsonb not null, recorded_at timestamptz not null default now(),
 primary key(owner_id,entry_id,revision), foreign key(owner_id,entry_id) references public.intelligence_source_library(owner_id,id)
);
alter table public.intelligence_source_library enable row level security;
alter table public.intelligence_source_library_history enable row level security;
revoke all on public.intelligence_source_library,public.intelligence_source_library_history from public,anon,authenticated;
grant all on public.intelligence_source_library,public.intelligence_source_library_history to service_role;
create function public.save_intelligence_source_library(p_owner_id uuid,p_id text,p_revision integer,p_config jsonb,p_status text,p_access jsonb default null)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_source_library%rowtype; a jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,44));
 if p_id is null or length(p_id)>255 or p_revision is null or p_revision<0
 or p_status is null or p_status not in ('candidate','active','paused','removed')
 or jsonb_typeof(p_config) is distinct from 'object' or coalesce(length(p_config->>'url'),0) not between 1 and 2048
 or coalesce(p_config->>'mode','') not in ('fixed','search') or coalesce(p_config->>'scope','') not in ('site','path')
 or coalesce(length(btrim(p_config->>'name')),0) not between 1 and 120 then return jsonb_build_object('error','invalid_request');end if;
 select * into r from public.intelligence_source_library where owner_id=p_owner_id and id=p_id for update;
 if coalesce(r.revision,0)<>p_revision then return jsonb_build_object('error','library_conflict');end if;
 if r.id is null and (select count(*) from public.intelligence_source_library where owner_id=p_owner_id)>=500 then return jsonb_build_object('error','library_limit');end if;
 a:=coalesce(r.access,'{"status":"unchecked"}'::jsonb);
 if r.config->>'url' is distinct from p_config->>'url' then a:='{"status":"unchecked"}'::jsonb;end if;
 if p_access is not null then a:=p_access;end if;
 if p_status='active' and p_config->>'mode'<>'fixed' and a->>'status' is distinct from 'readable' then return jsonb_build_object('error','library_unchecked');end if;
 insert into public.intelligence_source_library(owner_id,id,revision,config,status,access)
 values(p_owner_id,p_id,p_revision+1,p_config,p_status,a)
 on conflict(owner_id,id) do update set revision=excluded.revision,config=excluded.config,status=excluded.status,access=excluded.access,updated_at=now() returning * into r;
 if p_status='active' and p_config->>'scope'='site' then
   update public.intelligence_source_controls set paused=false,updated_at=now() where owner_id=p_owner_id and hostname=regexp_replace(split_part(split_part(p_config->>'url','://',2),'/',1),'^www\.','');
 end if;
 insert into public.intelligence_source_library_history(owner_id,entry_id,revision,config,status,access) values(r.owner_id,r.id,r.revision,r.config,r.status,r.access);
 return to_jsonb(r);
exception when unique_violation then return jsonb_build_object('error','library_duplicate');
end $$;
revoke all on function public.save_intelligence_source_library(uuid,text,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_source_library(uuid,text,integer,jsonb,text,jsonb) to service_role;
commit;
