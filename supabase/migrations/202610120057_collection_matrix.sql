-- Save one purpose-to-direction matrix with shared scope, without changing saved run plans.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.save_intelligence_collection_matrix(p_owner_id uuid,p_directions jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare
 item jsonb; cfg jsonb; shared jsonb; first_shared jsonb; saved jsonb:='[]'::jsonb;
 existing_ids jsonb; requested_ids jsonb; previous_topics jsonb; row_id uuid; row_revision integer;
 d public.intelligence_collection_directions%rowtype; ordinal integer:=0; existing_count integer;
begin
 if p_owner_id is null or jsonb_typeof(p_directions) is distinct from 'array' then
   return jsonb_build_object('error','invalid_request');
 end if;
 if jsonb_array_length(p_directions)=0 then return jsonb_build_object('error','invalid_request');end if;
 if jsonb_array_length(p_directions)>20 then return jsonb_build_object('error','direction_limit');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,43));
 perform 1 from public.intelligence_collection_directions where owner_id=p_owner_id order by position,id for update;
 select count(*),coalesce(jsonb_agg(id order by position,id),'[]'::jsonb) into existing_count,existing_ids
 from public.intelligence_collection_directions where owner_id=p_owner_id;
 select coalesce(jsonb_agg(distinct code),'[]'::jsonb) into previous_topics
 from public.intelligence_collection_directions old cross join lateral
 jsonb_array_elements_text(coalesce(old.config->'topic_codes','[]'::jsonb)) link(code)
 where old.owner_id=p_owner_id;

 -- Validate the complete payload before any write. Omission is not a removal operation.
 requested_ids:='[]'::jsonb;
 for item in select value from jsonb_array_elements(p_directions) loop
   ordinal:=ordinal+1;
   if jsonb_typeof(item) is distinct from 'object'
   or jsonb_typeof(item->'revision') is distinct from 'number'
   or (item->>'revision') !~ '^[0-9]{1,9}$'
   or (item->'id' is not null and jsonb_typeof(item->'id') not in ('null','string')) then
     return jsonb_build_object('error','invalid_request');
   end if;
   row_id:=(item->>'id')::uuid;
   row_revision:=(item->>'revision')::integer;
   cfg:=item->'config';
   if jsonb_typeof(cfg) is distinct from 'object'
   or jsonb_typeof(cfg->'name') is distinct from 'string'
   or jsonb_typeof(cfg->'why') is distinct from 'string'
   or jsonb_typeof(cfg->'industries') is distinct from 'string'
   or jsonb_typeof(cfg->'exclude') is distinct from 'string'
   or jsonb_typeof(cfg->'enabled') is distinct from 'boolean'
   or coalesce(cfg->>'priority','') not in ('high','normal','low')
   or coalesce(length(btrim(cfg->>'name')),0) not between 1 and 80
   or coalesce(length(btrim(cfg->>'why')),0) not between 1 and 400
   or coalesce(length(btrim(cfg->>'industries')),0) not between 1 and 200
   or length(cfg->>'exclude')>300
   or jsonb_typeof(cfg->'countries') is distinct from 'array'
   or jsonb_typeof(cfg->'targets') is distinct from 'array' then
     return jsonb_build_object('error','invalid_request');
   end if;
   cfg:=cfg||jsonb_build_object('topic_codes',coalesce(cfg->'topic_codes','[]'::jsonb));
   if jsonb_typeof(cfg->'topic_codes') is distinct from 'array' then return jsonb_build_object('error','invalid_request');end if;
   if jsonb_array_length(cfg->'countries') not between 1 and 29
   or jsonb_array_length(cfg->'targets') not between 1 and 3
   or jsonb_array_length(cfg->'topic_codes')>20
   or exists(select 1 from jsonb_array_elements(cfg->'countries') x where jsonb_typeof(x) is distinct from 'string')
   or exists(select 1 from jsonb_array_elements(cfg->'targets') x where jsonb_typeof(x) is distinct from 'string')
   or exists(select 1 from jsonb_array_elements(cfg->'topic_codes') x where jsonb_typeof(x) is distinct from 'string')
   or exists(select 1 from jsonb_array_elements_text(cfg->'countries') x where x not in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM'))
   or exists(select 1 from jsonb_array_elements_text(cfg->'targets') x where x not in ('signal','investment','procurement'))
   or exists(select 1 from jsonb_array_elements_text(cfg->'countries') x group by x having count(*)>1)
   or exists(select 1 from jsonb_array_elements_text(cfg->'targets') x group by x having count(*)>1)
   or exists(select 1 from jsonb_array_elements_text(cfg->'topic_codes') x group by x having count(*)>1) then
     return jsonb_build_object('error','invalid_request');
   end if;
   -- Preserve legacy links while merging shared scope; this never enables their catalog entries.
   if exists(select 1 from jsonb_array_elements_text(cfg->'topic_codes') link(code)
     left join public.intelligence_topics t on t.owner_id=p_owner_id and t.code=link.code
     where ((t.code is null and link.code not in ('red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas'))
       or t.active=false) and not (previous_topics ? link.code)) then
     return jsonb_build_object('error','invalid_request');
   end if;
   shared:=jsonb_build_object('why',cfg->'why','industries',cfg->'industries','countries',cfg->'countries',
     'topic_codes',cfg->'topic_codes','exclude',cfg->'exclude','priority',cfg->'priority');
   if first_shared is null then first_shared:=shared;
   elsif shared is distinct from first_shared then return jsonb_build_object('error','invalid_request');end if;
   if row_id is null then
     if ordinal<=existing_count or row_revision<>0 then return jsonb_build_object('error','direction_conflict');end if;
   else
     if requested_ids @> jsonb_build_array(row_id) then return jsonb_build_object('error','invalid_request');end if;
     select * into d from public.intelligence_collection_directions where id=row_id and owner_id=p_owner_id;
     if not found then return jsonb_build_object('error','not_found');end if;
     if d.revision<>row_revision and not (
       (d.config||jsonb_build_object('topic_codes',coalesce(d.config->'topic_codes','[]'::jsonb)))=cfg
       and row_revision=d.revision-1) then return jsonb_build_object('error','direction_conflict');end if;
     requested_ids:=requested_ids||jsonb_build_array(row_id);
   end if;
 end loop;
 if requested_ids is distinct from existing_ids then return jsonb_build_object('error','direction_conflict');end if;

 -- The function invocation is atomic: database errors roll back every row and version below.
 ordinal:=0;
 for item in select value from jsonb_array_elements(p_directions) loop
   ordinal:=ordinal+1;
   row_id:=(item->>'id')::uuid;
   cfg:=item->'config'||jsonb_build_object('topic_codes',coalesce(item->'config'->'topic_codes','[]'::jsonb));
   if row_id is null then
     insert into public.intelligence_collection_directions(owner_id,config,effective_on,position)
     values(p_owner_id,cfg,(now() at time zone 'Asia/Shanghai')::date+1,
       (select coalesce(max(position),0)+1 from public.intelligence_collection_directions where owner_id=p_owner_id)) returning * into d;
   else
     select * into d from public.intelligence_collection_directions where id=row_id and owner_id=p_owner_id;
     if (d.config||jsonb_build_object('topic_codes',coalesce(d.config->'topic_codes','[]'::jsonb)))=cfg then
       saved:=saved||jsonb_build_array(to_jsonb(d));
       continue;
     end if;
     update public.intelligence_collection_directions set config=cfg,revision=revision+1,
       effective_on=(now() at time zone 'Asia/Shanghai')::date+1,updated_at=now() where id=row_id returning * into d;
   end if;
   insert into public.intelligence_collection_direction_versions(direction_id,owner_id,revision,config,effective_on)
   values(d.id,d.owner_id,d.revision,d.config,d.effective_on);
   saved:=saved||jsonb_build_array(to_jsonb(d));
 end loop;
 return jsonb_build_object('directions',saved);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','invalid_request');
end $$;

revoke all on function public.save_intelligence_collection_matrix(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_collection_matrix(uuid,jsonb) to service_role;
commit;
