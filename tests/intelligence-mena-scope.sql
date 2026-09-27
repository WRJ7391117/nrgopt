-- Real PostgreSQL constraints; all fixture data rolls back.
begin;
do $$
declare v_owner uuid := gen_random_uuid(); v_source uuid := gen_random_uuid(); v_candidate uuid := gen_random_uuid();
  v_codes text[] := array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR'];
  v_code text; v_rejected boolean;
begin
  insert into auth.users(id) values(v_owner);
  set local role service_role;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
  values(v_source,v_owner,'https://fixture.invalid/mena','https://fixture.invalid/mena','pending_extraction',repeat('a',64),'fixture/mena');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,evidence_status,maturity,urgency,source_sha256,review_status,occurrence_countries,relevance_countries,topic_codes)
  values(v_candidate,v_owner,v_source,'MENA约束测试','测试','source_only','low','sourced','background','none',repeat('a',64),'source_only',v_codes,v_codes,array['suez','red-sea']);
  foreach v_code in array v_codes loop
    insert into public.intelligence_organizations(owner_id,canonical_name,country_code) values(v_owner,'fixture-'||v_code,v_code);
    insert into public.intelligence_projects(owner_id,candidate_id,country_code,canonical_name) values(v_owner,v_candidate,v_code,'fixture')
    on conflict(owner_id,candidate_id) do update set country_code=excluded.country_code;
  end loop;
  v_rejected := false;
  begin update public.intelligence_candidates set occurrence_countries=array['US'] where id=v_candidate;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'out of scope occurrence accepted'; end if;
  v_rejected := false;
  begin update public.intelligence_candidates set relevance_countries=array['XX'] where id=v_candidate;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'invalid relevance accepted'; end if;
  v_rejected := false;
  begin update public.intelligence_candidates set topic_codes=array['EG'] where id=v_candidate;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'country accepted as topic'; end if;
end $$;
rollback;
