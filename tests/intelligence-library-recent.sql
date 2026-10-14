begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); day date:=(now() at time zone 'Asia/Shanghai')::date; result jsonb;
begin
 insert into auth.users(id) values(a),(b);
 -- Recent evidence predates over 500 subsequent historical revisits.
 insert into public.intelligence_sources(owner_id,requested_url,final_url,title,fetched_at,status,storage_path,content_sha256,extraction_source_sha256,extraction_status,publication_date,publication_method,extraction_zh)
 values(a,'https://recent.example/news/one/','https://recent.example/news/one/','eligible one',now()-interval '2 day','pending_extraction','local-synthetic',repeat('a',64),repeat('a',64),'extracted',day-2,'metadata','{"classification":{"countries":[{"code":"SA","relation":"occurrence"}]}}'),
 (a,'https://recent.example/news/two/','https://recent.example/news/two/','eligible two',now()-interval '2 day','pending_extraction','local-synthetic',repeat('b',64),repeat('b',64),'extracted',day-1,'metadata','{"classification":{"countries":[{"code":"SA","relation":"occurrence"}]}}');
 insert into public.intelligence_sources(owner_id,requested_url,final_url,title,fetched_at,status,storage_path,content_sha256,extraction_source_sha256,extraction_status,publication_date,publication_method)
 select a,'https://historical.example/'||n,'https://historical.example/'||n,'historical revisit',now(),'pending_extraction','local-synthetic',repeat('c',64),repeat('c',64),'extracted',day-90,'metadata' from generate_series(1,510) n;
 result:=public.intelligence_library_recent_sources(a,day);
 if jsonb_array_length(result) is distinct from 2 then raise exception 'historical revisits crowded recent growth inputs';end if;
 -- A new failed fetch with unknown date suppresses the old successful original.
 insert into public.intelligence_sources(owner_id,requested_url,title,fetched_at,status)
 values(a,'https://recent.example/news/one/','new failed version',now(),'fetch_failed');
 result:=public.intelligence_library_recent_sources(a,day);
 if jsonb_array_length(result) is distinct from 1 or result->0->>'title' is distinct from 'eligible two' then raise exception 'new failure revived old successful original';end if;
 -- Shared requested/final URLs and hash fragments are checked against all newer versions.
 insert into public.intelligence_sources(owner_id,requested_url,final_url,title,fetched_at,status,storage_path,content_sha256,extraction_source_sha256,extraction_status,publication_date,publication_method)
 values(a,'https://alias.example/new','https://recent.example/news/two/#canonical','new invalid version',now(),'pending_extraction','local-synthetic',repeat('d',64),repeat('e',64),'extracted',day,'metadata');
 if jsonb_array_length(public.intelligence_library_recent_sources(a,day)) is distinct from 0 then raise exception 'invalid aliased newer version revived old original';end if;
 -- Unknown, future, stale-hash and next Beijing day originals are ineligible.
 insert into public.intelligence_sources(owner_id,requested_url,final_url,title,fetched_at,status,storage_path,content_sha256,extraction_source_sha256,extraction_status,publication_date,published_at,publication_method)
 values(a,'https://rules.example/unknown','https://rules.example/unknown','unknown date',now(),'pending_extraction','local-synthetic',repeat('f',64),repeat('f',64),'extracted',day,null,'conflicting_metadata'),
 (a,'https://rules.example/future','https://rules.example/future','future date',now(),'pending_extraction','local-synthetic',repeat('f',64),repeat('f',64),'extracted',day+1,null,'metadata'),
 (a,'https://rules.example/hash','https://rules.example/hash','stale hash',now(),'pending_extraction','local-synthetic',repeat('f',64),repeat('a',64),'extracted',day,null,'metadata'),
 (a,'https://rules.example/timestamp','https://rules.example/timestamp','future Beijing day',now(),'pending_extraction','local-synthetic',repeat('f',64),repeat('f',64),'extracted',day,(day+1)::timestamp at time zone 'Asia/Shanghai','metadata'),
 (b,'https://other.example/valid','https://other.example/valid','other owner',now(),'pending_extraction','local-synthetic',repeat('f',64),repeat('f',64),'extracted',day,null,'metadata');
 if jsonb_array_length(public.intelligence_library_recent_sources(a,day)) is distinct from 0 then raise exception 'date/hash/owner boundary failed';end if;
 if jsonb_array_length(public.intelligence_library_recent_sources(b,day)) is distinct from 1 then raise exception 'owner isolation lost valid original';end if;
 -- Failed tie beats a same-time success even with the lower ID.
 insert into public.intelligence_sources(id,owner_id,requested_url,final_url,title,fetched_at,status,storage_path,content_sha256,extraction_source_sha256,extraction_status,publication_date,publication_method)
 values('eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',a,'https://tie.example/one','https://tie.example/one','same time success',now(),'pending_extraction','local-synthetic',repeat('a',64),repeat('a',64),'extracted',day,'metadata');
 insert into public.intelligence_sources(id,owner_id,requested_url,fetched_at,status)
 values('11111111-1111-4111-a111-111111111111',a,'https://tie.example/one',now(),'fetch_failed');
 if jsonb_array_length(public.intelligence_library_recent_sources(a,day)) is distinct from 0 then raise exception 'failure tie revived old success';end if;
 if has_function_privilege('anon','public.intelligence_library_recent_sources(uuid,date)','EXECUTE') or has_function_privilege('authenticated','public.intelligence_library_recent_sources(uuid,date)','EXECUTE') or not has_function_privilege('service_role','public.intelligence_library_recent_sources(uuid,date)','EXECUTE') then raise exception 'RPC privilege boundary changed';end if;
end $$;
rollback;
