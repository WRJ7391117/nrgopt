begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); sources uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  candidates uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; i integer; result jsonb;
  fact jsonb:='{"known_facts":[{"claim_zh":"签约公告。","evidence_quote":"Cedar signed the agreement."}]}';
begin
  insert into auth.users(id) values(a),(b);
  for i in 1..3 loop
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
      extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
    values(sources[i],a,'https://fixture.invalid/'||i,'https://fixture.invalid/'||i,'pending_extraction',repeat(i::text,64),'test/'||i,
      'extracted',repeat(i::text,64),fact,now(),case when i=1 then '2026-01-01'::date when i=2 then '2026-02-01'::date end);
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,
      occurrence_countries,importance,evidence_status,maturity,urgency,source_sha256,review_status,project_zh,created_at)
    values(candidates[i],a,sources[i],'Cedar '||i,'测试','candidate',array['project'],array['SA'],'low','sourced','contract','research',repeat(i::text,64),'auto_validated',
      '{"name_zh":"Cedar","stage_zh":"签约","evidence_fact_number":1}',now()+i*interval '1 second');
  end loop;
  insert into public.intelligence_candidate_relations(owner_id,candidate_id,related_candidate_id,relation,same_scope,
    left_source_sha256,right_source_sha256,left_extracted_at,right_extracted_at)
  values(a,candidates[1],candidates[2],'supports',true,repeat('1',64),repeat('2',64),now(),now()),
    (a,candidates[2],candidates[1],'supports',true,repeat('2',64),repeat('1',64),now(),now()),
    (a,candidates[2],candidates[3],'supports',false,repeat('2',64),repeat('3',64),now(),now());
  result:=public.intelligence_project_timeline(a,sources[2]);
  if result->>'total'<>'2' or result->>'identity_id'<>candidates[1]::text
    or result->'entries'->0->>'source_id'<>sources[1]::text
    or result->'entries'->1->'project_evidence'->>'evidence_quote'<>'Cedar signed the agreement.' then raise exception 'timeline incorrect: %',result; end if;
  if (public.intelligence_project_timeline(b,sources[1])->>'total')<>'0' then raise exception 'cross owner leak'; end if;
  -- A changed analysis invalidates the old identity edges even if raw bytes are unchanged.
  update public.intelligence_sources set extracted_at=now()+interval '1 second' where id=sources[2];
  if (public.intelligence_project_timeline(a,sources[1])->>'total')<>'1' then raise exception 'stale analysis retained'; end if;
  update public.intelligence_sources set extracted_at=now() where id=sources[2];
  update public.intelligence_candidates set occurrence_countries=array['AE'] where id=candidates[2];
  if (public.intelligence_project_timeline(a,sources[1])->>'total')<>'1' then raise exception 'different countries merged'; end if;
  if has_function_privilege('authenticated','public.intelligence_project_timeline(uuid,uuid)','execute')
    or has_function_privilege('anon','public.intelligence_project_timeline(uuid,uuid)','execute') then raise exception 'timeline public'; end if;
end $$;
rollback;
