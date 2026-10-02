-- Local PostgreSQL validation only; fixtures roll back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); code text:='custom-11111111-1111-4111-8111-111111111111'; r jsonb;
begin
 insert into auth.users(id) values(a),(b);
 r:=public.save_intelligence_topic(a,'suez',0,'苏伊士航运','跨境能源航运',false);
 if r->>'active'<>'false' or (r->>'revision')::integer<>1 then raise exception 'default override failed';end if;
 r:=public.save_intelligence_topic(a,code,0,'跨境电网','跨国输电线路',true);
 if r->>'code'<>code then raise exception 'custom topic failed';end if;
 if public.save_intelligence_topic(a,code,0,'跨境电网','跨国输电线路',false)->>'error'<>'topic_conflict' then raise exception 'stale revision accepted';end if;
 if public.save_intelligence_topic(b,code,1,'跨境电网','跨国输电线路',false)->>'error'<>'topic_conflict' then raise exception 'cross-owner edit accepted';end if;
 r:=public.save_intelligence_topic(a,code,1,'跨境电网','跨国输电线路',false);
 if r->>'active'<>'false' then raise exception 'pause failed';end if;
 if not public.intelligence_valid_topic_codes(array[code,'suez']) or public.intelligence_valid_topic_codes(array['EG']) then raise exception 'candidate topic constraint failed';end if;
 if has_table_privilege('authenticated','public.intelligence_topics','SELECT') or has_function_privilege('authenticated','public.save_intelligence_topic(uuid,text,integer,text,text,boolean)','EXECUTE') then raise exception 'direct user access allowed';end if;
end $$;
rollback;
