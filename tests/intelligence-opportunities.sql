begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
  source_id uuid:=gen_random_uuid(); candidate_id uuid:=gen_random_uuid(); project_id uuid:=gen_random_uuid();
  early_hypothesis_id uuid:=gen_random_uuid(); rejected boolean;
begin
  insert into auth.users(id) values(owner_id),(other_owner);
  set local role service_role;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(source_id,owner_id,'https://fixture.invalid/opportunity','https://fixture.invalid/opportunity',
      'pending_extraction',repeat('a',64),'fixture/opportunity');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,
    evidence_status,maturity,urgency,source_sha256,review_status,occurrence_countries)
    values(candidate_id,owner_id,source_id,'项目','摘要','candidate','low','sourced','procurement','research',
      repeat('a',64),'auto_validated',array['SA']);
  insert into public.intelligence_projects(id,owner_id,candidate_id,country_code,canonical_name)
    values(project_id,owner_id,candidate_id,'SA','项目');
  insert into public.intelligence_opportunities(owner_id,candidate_id,project_id,scope,package_name_zh,
    participation_status,evidence_fact_number,evidence_quote,source_sha256)
    values(owner_id,candidate_id,project_id,'equipment','电池设备包','public_tender_open',1,'Battery tender is open.',repeat('a',64));
  if not exists(select 1 from public.intelligence_opportunities where package_name_zh='电池设备包') then
    raise exception 'opportunity not saved'; end if;
  if (select count(*) from public.intelligence_opportunity_history)<>1 then
    raise exception 'initial opportunity history missing'; end if;
  update public.intelligence_opportunities set updated_at=now() where package_name_zh='电池设备包';
  if (select count(*) from public.intelligence_opportunity_history)<>1 then
    raise exception 'timestamp-only update created false history'; end if;
  update public.intelligence_opportunities set current_in_analysis=false where package_name_zh='电池设备包';
  if (select count(*) from public.intelligence_opportunity_history)<>2 then
    raise exception 'opportunity reanalysis history missing'; end if;
  insert into public.intelligence_hypotheses(id,owner_id,candidate_id,claim_zh)
    values(early_hypothesis_id,owner_id,candidate_id,'未来可能需要备用电源');
  insert into public.intelligence_opportunities(owner_id,candidate_id,hypothesis_id,scope,package_name_zh,
    participation_status,evidence_fact_number,evidence_quote,source_sha256)
    values(owner_id,candidate_id,early_hypothesis_id,'early','备用电源需求待验证','unverified',1,'New data center announced.',repeat('a',64));
  if not exists(select 1 from public.intelligence_opportunities o where o.scope='early' and o.project_id is null
    and o.hypothesis_id=early_hypothesis_id) then raise exception 'early hypothesis opportunity missing'; end if;
  if (select count(*) from public.intelligence_opportunity_history)<>3 then
    raise exception 'early opportunity history missing'; end if;
  rejected:=false;
  begin
    insert into public.intelligence_opportunities(owner_id,candidate_id,hypothesis_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
      values(owner_id,candidate_id,early_hypothesis_id,'early','虚构已开放','public_tender_open',1,'New data center announced.',repeat('a',64));
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'unverified early opportunity claimed open tender'; end if;
  rejected:=false;
  begin
    insert into public.intelligence_opportunities(owner_id,candidate_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
      values(owner_id,candidate_id,'early','缺少假设','unverified',1,'New data center announced.',repeat('a',64));
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'early opportunity without hypothesis accepted'; end if;
  rejected:=false;
  begin
    insert into public.intelligence_opportunities(owner_id,candidate_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
      values(owner_id,candidate_id,'equipment','缺少项目','unverified',1,'Equipment tender is open.',repeat('a',64));
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'equipment opportunity without project accepted'; end if;
  rejected:=false;
  begin
    insert into public.intelligence_opportunities(owner_id,candidate_id,project_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
      values(other_owner,candidate_id,project_id,'equipment','错误归属','unverified',1,'Text',repeat('a',64));
  exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'cross-owner opportunity accepted'; end if;
  rejected:=false;
  begin
    insert into public.intelligence_opportunities(owner_id,candidate_id,project_id,scope,package_name_zh,
      participation_status,evidence_fact_number,evidence_quote,source_sha256)
      values(owner_id,candidate_id,project_id,'epc','总包','package_awarded',1,'EPC awarded.',repeat('a',64));
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'EPC became an equipment opportunity'; end if;
  if has_table_privilege('anon','public.intelligence_opportunities','select')
    or has_table_privilege('authenticated','public.intelligence_opportunities','select')
    or has_table_privilege('anon','public.intelligence_opportunity_history','select') then
    raise exception 'public opportunity access'; end if;
  reset role;
end $$;
rollback;
