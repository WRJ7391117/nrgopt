-- Local isolated database only; synthetic fixtures always roll back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); old uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); h uuid; first_id uuid; next_id uuid; other uuid;
  facts jsonb := '{"known_facts":[{"claim_zh":"采购公告已撤回。","evidence_quote":"The tender was withdrawn."}]}';
  case_name text; expected text;
begin
  insert into auth.users(id) values(a),(b);
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
    publication_date,publication_method,extraction_status,extraction_source_sha256,extraction_zh)
    values(old,a,'https://example.test/old','https://example.test/old','pending_extraction',repeat('a',64),'test/old',
      '2026-09-01','metadata','extracted',repeat('a',64),facts),
    (s,a,'https://example.test/new','https://example.test/new','pending_extraction',repeat('b',64),'test/new',
      '2026-09-02','metadata','extracted',repeat('b',64),facts);
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,
    occurrence_countries,importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,old,'测试','测试','candidate',array['project'],array['SA'],'low','sourced','project','research',repeat('a',64),'auto_validated');
  insert into public.intelligence_hypotheses(owner_id,candidate_id,claim_zh) values(a,c,'采购可能推进。') returning id into h;
  if public.save_intelligence_hypothesis_assessment(b,h,s,repeat('b',64),'open','weakened','撤回公告','[1]','test','test') is not null then raise exception 'cross owner accepted'; end if;
  if public.save_intelligence_hypothesis_assessment(a,h,s,repeat('c',64),'open','weakened','撤回公告','[1]','test','test') is not null then raise exception 'wrong hash accepted'; end if;
  if public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'open','weakened','撤回公告','[]','test','test') is not null then raise exception 'no evidence accepted'; end if;
  if public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'open','weakened','撤回公告','[2]','test','test') is not null then raise exception 'invented fact accepted'; end if;
  if public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'open','confirmed','撤回公告','[1]','test','test') is not null then raise exception 'auto confirmation accepted'; end if;
  first_id := public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'open','weakened','撤回公告削弱推进假设','[1]','test','test');
  if first_id is null or (select status from public.intelligence_hypotheses where id=h)<>'weakened' then raise exception 'counterevidence not applied'; end if;
  next_id := public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'open','rejected','重试不应覆盖','[1]','test','test');
  if next_id<>first_id or (select count(*) from public.intelligence_hypothesis_assessments where hypothesis_id=h)<>1 then raise exception 'replay duplicated history'; end if;
  update public.intelligence_sources set extraction_zh='{"known_facts":[]}' where id=s;
  if (select evidence_facts->0->>'evidence_quote' from public.intelligence_hypothesis_assessments where id=first_id) is distinct from 'The tender was withdrawn.' then raise exception 'evidence snapshot lost'; end if;

  foreach case_name in array array['older','unknown','conflicting','stale','reject','terminal'] loop
    other := gen_random_uuid();
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
      publication_date,publication_method,extraction_status,extraction_source_sha256,extraction_zh)
      values(other,a,'https://example.test/'||case_name,'https://example.test/'||case_name,'pending_extraction',repeat('c',64),'test/'||case_name,
        case when case_name='older' then '2026-09-01'::date when case_name='unknown' then null else '2026-09-03'::date end,
        case when case_name='conflicting' then 'conflicting_metadata' else 'metadata' end,'extracted',repeat('c',64),facts);
    next_id := public.save_intelligence_hypothesis_assessment(a,h,other,repeat('c',64),
      case when case_name='stale' then 'open' when case_name='terminal' then 'rejected' else 'weakened' end,
      'rejected','明确取消对应采购','[1]','test','test');
    expected := case case_name when 'older' then 'not_newer' when 'unknown' then 'date_unverified' when 'conflicting' then 'date_unverified'
      when 'stale' then 'stale_state' when 'reject' then 'applied' when 'terminal' then 'terminal_state' end;
    if next_id is null or (select decision_code from public.intelligence_hypothesis_assessments where id=next_id)<>expected then
      raise exception 'wrong assessment decision for %',case_name;
    end if;
  end loop;
  if (select status from public.intelligence_hypotheses where id=h)<>'rejected' then raise exception 'rejection missing'; end if;
  -- A newer assessment that retains the state still advances the evidence chronology.
  insert into public.intelligence_hypotheses(owner_id,candidate_id,claim_zh,status) values(a,c,'较新判断应保留。','weakened') returning id into h;
  update public.intelligence_sources set publication_date='2026-09-10' where id=other;
  next_id := public.save_intelligence_hypothesis_assessment(a,h,other,repeat('c',64),'weakened','weakened','新证据仍支持减弱','[1]','test','test');
  if (select decision_code from public.intelligence_hypothesis_assessments where id=next_id)<>'unchanged' then raise exception 'reaffirmation failed'; end if;
  update public.intelligence_sources set extraction_zh=facts where id=s;
  next_id := public.save_intelligence_hypothesis_assessment(a,h,s,repeat('b',64),'weakened','rejected','较旧证据不能覆盖','[1]','test','test');
  if (select decision_code from public.intelligence_hypothesis_assessments where id=next_id)<>'not_newer' then raise exception 'older evidence overwrote reaffirmation'; end if;
  if has_function_privilege('authenticated','public.save_intelligence_hypothesis_assessment(uuid,uuid,uuid,text,text,text,text,jsonb,text,text)','execute')
    or has_table_privilege('anon','public.intelligence_hypothesis_assessments','select') then raise exception 'history is public'; end if;
end $$;
rollback;
