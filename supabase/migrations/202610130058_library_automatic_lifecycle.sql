-- Automatic source accumulation preserves user pause, removal and manual ownership.
begin;
set local lock_timeout='5s';
create or replace function public.save_intelligence_source_library(p_owner_id uuid,p_id text,p_revision integer,p_config jsonb,p_status text,p_access jsonb default null)
returns jsonb language plpgsql set search_path=public as $$
declare r public.intelligence_source_library%rowtype; a jsonb; automatic boolean:=coalesce(p_access->>'managed_by','')='automatic' and coalesce(p_access->>'check_only','false')<>'true'; v_hostname text; v_pathname text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,44));
 -- Host controls use this same lock, including insertion of a previously absent pause.
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,731));
 if p_id is null or length(p_id)>255 or p_revision is null or p_revision<0
 or p_status is null or p_status not in ('candidate','active','paused','removed')
 or jsonb_typeof(p_config) is distinct from 'object' or coalesce(length(p_config->>'url'),0) not between 1 and 2048
 or coalesce(p_config->>'mode','') not in ('fixed','search') or coalesce(p_config->>'scope','') not in ('site','path')
 or coalesce(length(btrim(p_config->>'name')),0) not between 1 and 120 then return jsonb_build_object('error','invalid_request');end if;
 select * into r from public.intelligence_source_library where owner_id=p_owner_id and id=p_id for update;
 if coalesce(r.revision,0)<>p_revision then return jsonb_build_object('error','library_conflict');end if;
 if r.id is null and (select count(*) from public.intelligence_source_library where owner_id=p_owner_id)>=500 then return jsonb_build_object('error','library_limit');end if;
 v_hostname:=regexp_replace(split_part(split_part(p_config->>'url','://',2),'/',1),'^www\.','');
 v_pathname:=regexp_replace(regexp_replace(p_config->>'url','^https://[^/]+',''),'/$','');
 if automatic then
   if r.status in ('paused','removed') then return jsonb_build_object('error','library_paused');end if;
   if r.access->>'managed_by'='user' then return jsonb_build_object('error','library_user_managed');end if;
   if r.id is not null and r.config is distinct from p_config then return jsonb_build_object('error','library_conflict');end if;
   if exists(select 1 from public.intelligence_source_controls where owner_id=p_owner_id and intelligence_source_controls.hostname=v_hostname and paused)
     or exists(select 1 from public.intelligence_source_library other where other.owner_id=p_owner_id and other.id<>p_id and other.status in ('paused','removed')
       and regexp_replace(split_part(split_part(other.config->>'url','://',2),'/',1),'^www\.','')=v_hostname
       and (other.config->>'scope'='site' or v_pathname=regexp_replace(regexp_replace(other.config->>'url','^https://[^/]+',''),'/$','')
         or starts_with(v_pathname,regexp_replace(regexp_replace(other.config->>'url','^https://[^/]+',''),'/$','')||'/')))
     then return jsonb_build_object('error','library_paused');end if;
   if p_id like 'reference:auto:%' and (p_id !~ '^reference:auto:[a-f0-9]{64}$' or p_config->>'scope'<>'path' or p_config->>'mode'<>'search'
     or p_access->>'auto_scope_key' is distinct from p_config->>'scope_key'
     or p_status='active' and (p_access->>'scope_verified' is distinct from 'true' or p_access->>'scope_confirmation_needed'='true'))
     then return jsonb_build_object('error','invalid_request');end if;
 end if;
 a:=coalesce(r.access,'{"status":"unchecked"}'::jsonb);
 if r.config->>'url' is distinct from p_config->>'url' then a:='{"status":"unchecked"}'::jsonb;end if;
 if p_access is not null then a:=p_access;end if;
 if p_status='active' and p_config->>'mode'<>'fixed' and a->>'status' is distinct from 'readable'
   and not coalesce((automatic and p_id ~ '^reference:auto:[a-f0-9]{64}$' and r.status='active'
     and a->>'status'='failed' and a->>'consecutive_failures'='1' and r.access->>'scope_verified'='true'),false)
   then return jsonb_build_object('error','library_unchecked');end if;
 insert into public.intelligence_source_library(owner_id,id,revision,config,status,access)
 values(p_owner_id,p_id,p_revision+1,p_config,p_status,a)
 on conflict(owner_id,id) do update set revision=excluded.revision,config=excluded.config,status=excluded.status,access=excluded.access,updated_at=now() returning * into r;
 if p_status='active' and p_config->>'scope'='site' and not automatic and coalesce(p_access->>'check_only','false')<>'true' then
   update public.intelligence_source_controls set paused=false,updated_at=now() where owner_id=p_owner_id and intelligence_source_controls.hostname=v_hostname;
 end if;
 insert into public.intelligence_source_library_history(owner_id,entry_id,revision,config,status,access) values(r.owner_id,r.id,r.revision,r.config,r.status,r.access);
 return to_jsonb(r);
exception when unique_violation then return jsonb_build_object('error','library_duplicate');
end $$;
revoke all on function public.save_intelligence_source_library(uuid,text,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_source_library(uuid,text,integer,jsonb,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
