-- Add selectable Central Asian countries without rewriting existing directions or run snapshots.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.intelligence_candidates drop constraint intelligence_candidates_occurrence_countries_check;
alter table public.intelligence_candidates add constraint intelligence_candidates_occurrence_countries_check check (occurrence_countries <@ array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM']::text[]);
alter table public.intelligence_candidates drop constraint intelligence_candidates_relevance_countries_check;
alter table public.intelligence_candidates add constraint intelligence_candidates_relevance_countries_check check (relevance_countries <@ array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM']::text[]);
alter table public.intelligence_organizations drop constraint intelligence_organizations_country_code_check;
alter table public.intelligence_organizations add constraint intelligence_organizations_country_code_check check (country_code in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM'));
alter table public.intelligence_projects drop constraint intelligence_projects_country_code_check;
alter table public.intelligence_projects add constraint intelligence_projects_country_code_check check (country_code in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM'));

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
 if jsonb_array_length(p_config->'countries') not between 1 and 29 or jsonb_array_length(p_config->'targets') not between 1 and 3
 or exists(select 1 from jsonb_array_elements_text(p_config->'countries') x where x not in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM'))
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

revoke all on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb) to service_role;
commit;
