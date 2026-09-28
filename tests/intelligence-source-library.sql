begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); e jsonb; c jsonb:='{"name":"author","url":"https://example.org/author/","scope":"path","mode":"search","scope_key":"example.org/author"}'; key text:=gen_random_uuid()::text;
begin
 insert into auth.users(id) values(a),(b);
 e:=public.save_intelligence_source_library(a,key,0,c,'candidate');
 if (e->>'revision')::int<>1 then raise exception 'save';end if;
 if public.save_intelligence_source_library(a,key,1,c,'active')->>'error'<>'library_unchecked' then raise exception 'unchecked activated';end if;
 if public.save_intelligence_source_library(a,gen_random_uuid()::text,0,c,'candidate')->>'error'<>'library_duplicate' then raise exception 'duplicate accepted';end if;
 e:=public.save_intelligence_source_library(a,key,1,c,'candidate','{"status":"readable"}');
 e:=public.save_intelligence_source_library(a,key,2,c,'active');
 e:=public.save_intelligence_source_library(a,key,3,c,'removed');
 if public.save_intelligence_source_library(a,key,3,c,'active')->>'error'<>'library_conflict' then raise exception 'stale restore';end if;
 if public.save_intelligence_source_library(b,key,4,c,'removed')->>'error'<>'library_conflict' then raise exception 'owner isolation';end if;
 e:=public.save_intelligence_source_library(a,key,4,c,'candidate');
 if (select count(*) from public.intelligence_source_library_history where owner_id=a)<>5 then raise exception 'history lost';end if;
 if public.save_intelligence_source_library(a,key,5,jsonb_set(c,'{url}','"https://different.org/"'),'active')->>'error'<>'library_unchecked' then raise exception 'URL changed without recheck';end if;
 if has_function_privilege('authenticated','public.save_intelligence_source_library(uuid,text,integer,jsonb,text,jsonb)','EXECUTE') or has_table_privilege('anon','public.intelligence_source_library','SELECT') then raise exception 'public permissions';end if;
end $$;
rollback;
