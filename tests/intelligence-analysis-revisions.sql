begin;
do $$
declare a uuid := gen_random_uuid(); s uuid := gen_random_uuid(); v1 jsonb := '{"summary_zh":"初始判断","known_facts":[]}';
begin
  insert into auth.users(id) values(a);
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(s,a,'https://fixture.invalid/revision','https://fixture.invalid/revision','pending_extraction',repeat('a',64),'test/revision');
  update public.intelligence_sources set extraction_status='extracted',extraction_zh=v1,
    extraction_source_sha256=repeat('a',64),extraction_provider='fixture',extraction_model='v1',extracted_at=now() where id=s;
  if (select count(*) from public.intelligence_analysis_revisions where source_id=s)<>1 then raise exception 'first revision absent'; end if;
  update public.intelligence_sources set annotation_zh='private note', extracted_at=now() where id=s;
  update public.intelligence_sources set extraction_status='processing' where id=s;
  update public.intelligence_sources set extraction_status='extracted' where id=s;
  if (select count(*) from public.intelligence_analysis_revisions where source_id=s)<>1 then raise exception 'replay or note added revision'; end if;
  update public.intelligence_sources set extraction_zh='{"summary_zh":"更正判断","known_facts":[]}' where id=s;
  if (select count(*) from public.intelligence_analysis_revisions where source_id=s)<>2
    or not exists(select 1 from public.intelligence_analysis_revisions where source_id=s and extraction_zh=v1) then raise exception 'previous analysis lost'; end if;
  update public.intelligence_sources set extraction_source_sha256=repeat('b',64),extraction_zh='{"summary_zh":"wrong hash"}' where id=s;
  if (select count(*) from public.intelligence_analysis_revisions where source_id=s)<>2 then raise exception 'unbound analysis recorded'; end if;
  if exists(select 1 from public.intelligence_analysis_revisions where source_id=s and extraction_zh::text like '%private note%') then raise exception 'annotation captured'; end if;
  if has_table_privilege('anon','public.intelligence_analysis_revisions','select')
    or has_table_privilege('authenticated','public.intelligence_analysis_revisions','select')
    or has_table_privilege('service_role','public.intelligence_analysis_revisions','insert')
    or has_table_privilege('service_role','public.intelligence_analysis_revisions','update')
    or has_table_privilege('service_role','public.intelligence_analysis_revisions','delete') then raise exception 'revision permissions unsafe'; end if;
end $$;
rollback;
