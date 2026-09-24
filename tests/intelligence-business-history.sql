begin;
do $$
declare a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); p uuid; epc uuid; equipment uuid;
begin
  insert into auth.users(id) values(a);
  set local role service_role;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(s,a,'https://fixture.invalid/project','https://fixture.invalid/project','pending_extraction',repeat('a',64),'fixture');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,s,'项目','摘要','candidate','low','unverified','project','research',repeat('a',64),'auto_validated');
  insert into public.intelligence_projects(owner_id,candidate_id,country_code,canonical_name,stage_zh)
    values(a,c,'SA','项目','规划') returning id into p;
  insert into public.intelligence_procurements(owner_id,project_id,package_name_zh,scope,stage_code)
    values(a,p,'同名包件','epc','signed') returning id into epc;
  insert into public.intelligence_procurements(owner_id,project_id,package_name_zh,scope,stage_code)
    values(a,p,'同名包件','equipment','open') returning id into equipment;
  update public.intelligence_procurements set current_in_analysis=false where id=equipment;
  if (select stage_code from public.intelligence_procurements where id=epc)<>'signed' then raise exception 'sibling changed';end if;
  if (select stage_code from public.intelligence_procurements where id=equipment)<>'open' then raise exception 'absence became cancellation';end if;
  update public.intelligence_procurements set current_in_analysis=false where id=equipment;
  if (select count(*) from public.intelligence_business_history where procurement_id=equipment)<>2 then raise exception 'no-op made duplicate history';end if;
  if not exists(select 1 from public.intelligence_business_history where procurement_id=equipment and (snapshot->>'current_in_analysis')::boolean and source_id=s and source_sha256=repeat('a',64)) then raise exception 'original evidence lost';end if;
  if has_table_privilege('anon','public.intelligence_business_history','select') or has_table_privilege('authenticated','public.intelligence_business_history','insert') then raise exception 'public access';end if;
  reset role;
end $$;
rollback;
