begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
  candidates uuid[]:=array[gen_random_uuid(),gen_random_uuid()];
  sources uuid[]:=array[gen_random_uuid(),gen_random_uuid()];
  projects uuid[]:=array[gen_random_uuid(),gen_random_uuid()];
  opportunities uuid[]:=array[gen_random_uuid(),gen_random_uuid()];
  identity_id uuid:=gen_random_uuid(); extracted timestamptz:=now(); i integer; first_sync integer; second_sync integer; link_count integer;
begin
  insert into auth.users(id) values(owner_id),(other_owner);
  set local role service_role;
  insert into public.intelligence_project_identities(id,owner_id) values(identity_id,owner_id);
  for i in 1..2 loop
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,
      storage_path,extraction_status,extraction_source_sha256,extraction_zh,extracted_at)
    values(sources[i],owner_id,'https://publisher'||i||'.invalid/a','https://publisher'||i||'.invalid/a',
      'pending_extraction',repeat(i::text,64),'fixture/'||i,'extracted',repeat(i::text,64),'{}',extracted);
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,
      importance,evidence_status,maturity,urgency,source_sha256,review_status,occurrence_countries)
    values(candidates[i],owner_id,sources[i],'项目','摘要','candidate','low','sourced','procurement',
      'research',repeat(i::text,64),'auto_validated',array['SA']);
    insert into public.intelligence_projects(id,owner_id,candidate_id,country_code,canonical_name,identity_id)
    values(projects[i],owner_id,candidates[i],'SA','同一项目',identity_id);
    insert into public.intelligence_opportunities(id,owner_id,candidate_id,project_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
    values(opportunities[i],owner_id,candidates[i],projects[i],'equipment','电池设备包',
      'unverified',2,'官方披露同一设备采购包',repeat(i::text,64));
  end loop;
  if public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2])<>0 then
    raise exception 'project identity alone linked packages'; end if;
  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,
    same_scope,matching_facts_zh,left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(owner_id,candidates[1],candidates[2],'supports',true,
    '[{"left_fact_number":1,"right_fact_number":1,"reason_zh":"仅项目相同"}]'::jsonb,
    repeat('1',64),repeat('2',64),extracted,extracted);
  if public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2])<>0 then
    raise exception 'project-only fact linked packages'; end if;
  update public.intelligence_candidate_relations set matching_facts_zh=
    '[{"left_fact_number":2,"right_fact_number":2,"reason_zh":"同一包件"}]'::jsonb
    where candidate_id=candidates[1];
  update public.intelligence_sources set extracted_at=extracted+interval '1 second' where id=sources[2];
  if public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2])<>0 then
    raise exception 'stale extraction linked packages'; end if;
  update public.intelligence_sources set extracted_at=extracted where id=sources[2];
  first_sync:=public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2]);
  second_sync:=public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2]);
  select count(*) into link_count from public.intelligence_opportunity_links
    where left_opportunity_id=least(opportunities[1],opportunities[2]);
  if first_sync<>1 or second_sync<>1 or link_count<>1 then
    raise exception 'explicit package fact was not linked idempotently: %, %, %',first_sync,second_sync,link_count; end if;
  if (select count(*) from public.current_intelligence_opportunity_links(owner_id))<>1 then
    raise exception 'current package link not readable'; end if;
  update public.intelligence_sources set extracted_at=extracted+interval '1 second' where id=sources[2];
  if (select count(*) from public.current_intelligence_opportunity_links(owner_id))<>0 then
    raise exception 'stale package link still current'; end if;
  update public.intelligence_sources set extracted_at=extracted where id=sources[2];
  if public.sync_intelligence_opportunity_links(other_owner,candidates[1],candidates[2])<>0 then
    raise exception 'cross-owner package link accepted'; end if;
  update public.intelligence_opportunities set package_name_zh='另一批电池设备包' where id=opportunities[2];
  if public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2])<>0 then
    raise exception 'different package name accepted'; end if;
  if (select count(*) from public.current_intelligence_opportunity_links(owner_id))<>0 then
    raise exception 'historical link claimed current after package rename'; end if;
  update public.intelligence_opportunities set package_name_zh='电池设备包',scope='service'
    where id=opportunities[2];
  if public.sync_intelligence_opportunity_links(owner_id,candidates[1],candidates[2])<>0 then
    raise exception 'equipment and service packages merged'; end if;
  if has_table_privilege('anon','public.intelligence_opportunity_links','select')
    or has_table_privilege('authenticated','public.intelligence_opportunity_links','select')
    or has_function_privilege('authenticated','public.sync_intelligence_opportunity_links(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.current_intelligence_opportunity_links(uuid)','execute') then
    raise exception 'public package link access'; end if;
  reset role;
end $$;
rollback;
