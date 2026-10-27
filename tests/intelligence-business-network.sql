-- Real PostgreSQL lifecycle, literal search, permissions and owner isolation; fixtures always roll back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); entry_id uuid := gen_random_uuid();
  r jsonb; first_page jsonb; second_page jsonb; same_page jsonb; changed jsonb; field text; bad jsonb; i integer;
  value jsonb := '{"organization":"  能源机构  ","contact_name":"公开联系人","role":"","region":"中亚","contact_details":"","business_context":"","source_note":"公开来源，尚未联系","communication_note":"","next_action":"核实负责范围","status":"identified","followup_on":null}';
begin
  insert into auth.users(id) values(a),(b);
  set local role service_role;
  r := public.save_intelligence_business_relation(a,entry_id,0,value);
  if r->>'revision' is distinct from '1' or r->>'organization' is distinct from '能源机构'
    or r->>'archived' is distinct from 'false' or r ? 'owner_id' then raise exception 'create/readback shape'; end if;
  if public.save_intelligence_business_relation(a,entry_id,0,value) is distinct from r then raise exception 'create retry changed record'; end if;
  if public.save_intelligence_business_relation(a,entry_id,1,value) is distinct from r then raise exception 'identical save changed record'; end if;
  if public.save_intelligence_business_relation(a,entry_id,0,value||'{"organization":"stale"}')->>'error' is distinct from 'business_relation_conflict' then raise exception 'stale edit accepted'; end if;
  if public.save_intelligence_business_relation(a,gen_random_uuid(),1,value)->>'error' is distinct from 'business_relation_conflict' then raise exception 'missing row accepted old revision'; end if;

  changed := value || jsonb_build_object('status','communicating','communication_note',E'已核实负责范围\n下周沟通','followup_on','2028-02-29');
  r := public.save_intelligence_business_relation(a,entry_id,1,changed);
  if r->>'revision' is distinct from '2' or r->>'followup_on' is distinct from '2028-02-29' then raise exception 'edit failed'; end if;
  if public.save_intelligence_business_relation(a,entry_id,1,changed) is distinct from r then raise exception 'edit retry changed record'; end if;
  if public.save_intelligence_business_relation(a,entry_id,0,changed)->>'error' is distinct from 'business_relation_conflict' then raise exception 'older revision accepted'; end if;

  perform public.save_intelligence_business_relation(b,entry_id,0,value||'{"organization":"other owner"}');
  if (select organization from public.intelligence_business_relations where owner_id=a and id=entry_id) is distinct from '能源机构'
    or jsonb_array_length(public.intelligence_business_network(b,'all','',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all','other owner',0)) <> 0 then raise exception 'owner isolation'; end if;
  if public.save_intelligence_business_relation(b,entry_id,0,changed)->>'error' is distinct from 'business_relation_conflict' then raise exception 'cross-owner revision isolation'; end if;

  r := public.save_intelligence_business_relation(a,entry_id,2,changed||'{"archived":true}');
  if r->>'revision' is distinct from '3' or jsonb_array_length(public.intelligence_business_network(a,'all','',0)) <> 0
    or jsonb_array_length(public.intelligence_business_network(a,'communicating','',0)) <> 0
    or jsonb_array_length(public.intelligence_business_network(a,'archived','',0)) <> 1 then raise exception 'archive filtering'; end if;
  if public.save_intelligence_business_relation(a,entry_id,2,changed||'{"archived":true}') is distinct from r then raise exception 'archive retry'; end if;
  r := public.save_intelligence_business_relation(a,entry_id,3,changed||'{"archived":false}');
  if r->>'revision' is distinct from '4' or r->>'communication_note' is distinct from changed->>'communication_note'
    or jsonb_array_length(public.intelligence_business_network(a,'archived','',0)) <> 0
    or jsonb_array_length(public.intelligence_business_network(a,'communicating','',0)) <> 1 then raise exception 'restore lost content'; end if;

  foreach bad in array array['{"status":"active"}'::jsonb,'{"archived":"false"}'::jsonb,'{"archived":null}'::jsonb,
    '{"followup_on":"2026-02-30"}'::jsonb,'{"followup_on":"0000-01-01"}'::jsonb,'{"followup_on":"2026-1-01"}'::jsonb,
    '{"followup_on":1}'::jsonb,'{"organization":"   "}'::jsonb,'{"organization":null}'::jsonb,
    jsonb_build_object('source_note','control'||chr(1)),jsonb_build_object('source_note',chr(127)),
    jsonb_build_object('source_note',chr(133))] loop
    if public.save_intelligence_business_relation(a,gen_random_uuid(),0,value||bad)->>'error' is distinct from 'invalid_request' then raise exception 'invalid data accepted: %',bad; end if;
  end loop;
  foreach field in array array['organization','contact_name','role','region','contact_details','business_context','source_note','communication_note','next_action'] loop
    if public.save_intelligence_business_relation(a,gen_random_uuid(),0,value||jsonb_build_object(field,repeat('中',1601)))->>'error' is distinct from 'invalid_request'
      or public.save_intelligence_business_relation(a,gen_random_uuid(),0,value-field)->>'error' is distinct from 'invalid_request' then raise exception 'invalid field accepted: %',field; end if;
  end loop;
  if public.save_intelligence_business_relation(a,gen_random_uuid(),0,value-'followup_on')->>'error' is distinct from 'invalid_request'
    or public.save_intelligence_business_relation(a,gen_random_uuid(),-1,value)->>'error' is distinct from 'invalid_request'
    or public.save_intelligence_business_relation(a,gen_random_uuid(),0,null)->>'error' is distinct from 'invalid_request'
    or public.save_intelligence_business_relation(null,gen_random_uuid(),0,value)->>'error' is distinct from 'invalid_request'
    or public.save_intelligence_business_relation(a,null,0,value)->>'error' is distinct from 'invalid_request' then raise exception 'invalid structure accepted'; end if;

  perform public.save_intelligence_business_relation(a,gen_random_uuid(),0,value||jsonb_build_object('organization','Literal 100%_ supplier''s','contact_name','Alice','region','SA'));
  if jsonb_array_length(public.intelligence_business_network(a,'all','%',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all','_',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all','supplier''s',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all','alice',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all','中亚',0)) <> 1
    or jsonb_array_length(public.intelligence_business_network(a,'all',''' OR true; --',0)) <> 0 then raise exception 'search was not literal or missed fields'; end if;

  for i in 1..29 loop
    perform public.save_intelligence_business_relation(a,gen_random_uuid(),0,value||jsonb_build_object('organization','分页机构'||i));
  end loop;
  first_page := public.intelligence_business_network(a,'all','',0);
  same_page := public.intelligence_business_network(a,'all','',0);
  second_page := public.intelligence_business_network(a,'all','',25);
  if jsonb_array_length(first_page) <> 26 or jsonb_array_length(second_page) <> 6 or first_page is distinct from same_page
    or (select count(distinct item->>'id') from jsonb_array_elements((first_page - 25)||second_page) item) <> 31
    or exists(select 1 from jsonb_array_elements(first_page||second_page) item where item ? 'owner_id') then raise exception 'pagination/order/owner response'; end if;
  if jsonb_array_length(public.intelligence_business_network(a,'identified','',0)) <> 26
    or jsonb_array_length(public.intelligence_business_network(a,'communicating','',0)) <> 1 then raise exception 'status filter'; end if;
  if public.intelligence_business_network(a,'invalid','',0)->>'error' is distinct from 'invalid_request'
    or public.intelligence_business_network(a,'all','',-1)->>'error' is distinct from 'invalid_request'
    or public.intelligence_business_network(a,'all',repeat('x',201),0)->>'error' is distinct from 'invalid_request' then raise exception 'invalid filter accepted'; end if;

  if not (select relrowsecurity from pg_class where oid='public.intelligence_business_relations'::regclass)
    or has_table_privilege('anon','public.intelligence_business_relations','select,insert,update,delete')
    or has_table_privilege('authenticated','public.intelligence_business_relations','select,insert,update,delete')
    or has_function_privilege('anon','public.save_intelligence_business_relation(uuid,uuid,integer,jsonb)','execute')
    or has_function_privilege('authenticated','public.save_intelligence_business_relation(uuid,uuid,integer,jsonb)','execute')
    or has_function_privilege('anon','public.intelligence_business_network(uuid,text,text,integer)','execute')
    or has_function_privilege('authenticated','public.intelligence_business_network(uuid,text,text,integer)','execute') then raise exception 'public access'; end if;
end $$;
rollback;
