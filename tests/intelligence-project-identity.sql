begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
  sources uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  candidates uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  projects uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  hashes text[]:=array[repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64)];
  extracted timestamptz:=now(); stable uuid; i integer; rejected boolean;
begin
  insert into auth.users(id) values(owner_id),(other_owner);
  set local role service_role;
  for i in 1..4 loop
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
      extraction_status,extraction_source_sha256,extraction_zh,extracted_at)
    values(sources[i],owner_id,'https://fixture.invalid/'||i,'https://fixture.invalid/'||i,'pending_extraction',hashes[i],
      'fixture/'||i,'extracted',hashes[i],'{}',extracted);
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,
      evidence_status,maturity,urgency,source_sha256,review_status,occurrence_countries)
    values(candidates[i],owner_id,sources[i],'同名项目','摘要','candidate','low','sourced','project','research',
      hashes[i],'auto_validated',array['SA']);
    insert into public.intelligence_projects(id,owner_id,candidate_id,country_code,canonical_name)
    values(projects[i],owner_id,candidates[i],'SA','同名项目');
  end loop;

  rejected:=false;
  begin perform public.link_intelligence_project_identity(owner_id,projects[1],projects[2]);
  exception when others then rejected:=sqlerrm='project_identity_evidence_missing'; end;
  if not rejected then raise exception 'same name merged without evidence'; end if;

  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,same_scope,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(owner_id,candidates[1],candidates[2],'supports',false,hashes[1],hashes[2],extracted,extracted);
  rejected:=false;
  begin perform public.link_intelligence_project_identity(owner_id,projects[1],projects[2]);
  exception when others then rejected:=sqlerrm='project_identity_evidence_missing'; end;
  if not rejected then raise exception 'different project scope merged'; end if;
  update public.intelligence_candidate_relations set same_scope=true
    where candidate_id=candidates[1] and related_candidate_id=candidates[2];
  stable:=public.link_intelligence_project_identity(owner_id,projects[1],projects[2]);
  if stable is null or (select count(*) from public.intelligence_projects where identity_id=stable)<>2 then
    raise exception 'supported pair lacks persistent identity'; end if;

  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,same_scope,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(owner_id,candidates[1],candidates[3],'supports',true,hashes[1],hashes[3],extracted,extracted);
  rejected:=false;
  begin perform public.link_intelligence_project_identity(owner_id,projects[1],projects[3]);
  exception when others then rejected:=sqlerrm='project_identity_evidence_missing'; end;
  if not rejected then raise exception 'transitive project merge accepted'; end if;

  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,same_scope,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(owner_id,candidates[2],candidates[3],'supports',true,hashes[2],hashes[3],extracted,extracted);
  if public.link_intelligence_project_identity(owner_id,projects[2],projects[3])<>stable then
    raise exception 'stable identity changed while adding member'; end if;
  if (select count(*) from public.intelligence_projects where identity_id=stable)<>3 then
    raise exception 'third member missing'; end if;

  rejected:=false;
  begin perform public.link_intelligence_project_identity(other_owner,projects[1],projects[4]);
  exception when others then rejected:=sqlerrm='project_missing'; end;
  if not rejected then raise exception 'cross-owner identity accepted'; end if;
  update public.intelligence_sources set extracted_at=extracted+interval '1 second' where id=sources[4];
  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,same_scope,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(owner_id,candidates[1],candidates[4],'supports',true,hashes[1],hashes[4],extracted,extracted),
    (owner_id,candidates[2],candidates[4],'supports',true,hashes[2],hashes[4],extracted,extracted),
    (owner_id,candidates[3],candidates[4],'supports',true,hashes[3],hashes[4],extracted,extracted);
  rejected:=false;
  begin perform public.link_intelligence_project_identity(owner_id,projects[1],projects[4]);
  exception when others then rejected:=sqlerrm='project_identity_evidence_missing'; end;
  if not rejected then raise exception 'stale extraction merged'; end if;
  if has_table_privilege('anon','public.intelligence_project_identities','select')
    or has_function_privilege('authenticated','public.link_intelligence_project_identity(uuid,uuid,uuid)','execute') then
    raise exception 'public identity access'; end if;
  reset role;
end $$;
rollback;
