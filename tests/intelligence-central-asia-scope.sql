-- Isolated PostgreSQL only. Fixture users, settings and candidates all roll back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid(); fixture_candidate_id uuid:=gen_random_uuid();
 codes text[]:=array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','EG','CY','DZ','LY','MA','TN','SD','EH','MR','KZ','UZ','KG','TJ','TM'];
 central text[]:=array['KZ','UZ','KG','TJ','TM']; code text; rejected boolean; saved jsonb; revised jsonb; old jsonb; snapshot jsonb; run_id uuid;
 today date:=(now() at time zone 'Asia/Shanghai')::date;
 cfg jsonb:='{"name":"中亚能源方向","why":"关注有原文依据的能源变化","industries":"能源","exclude":"","countries":["SA"],"targets":["signal"],"priority":"normal","enabled":true,"topic_codes":[]}'::jsonb;
begin
 insert into auth.users(id) values(a),(b);
 set local role service_role;
 old:=public.save_intelligence_collection_direction(a,null,0,cfg);
 foreach code in array central loop
   saved:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{countries}',jsonb_build_array(code)));
   if saved->>'id' is null or saved->'config'->'countries' is distinct from jsonb_build_array(code)
   or (saved->>'effective_on')::date is distinct from today+1 then raise exception 'Central Asian country not saved for next Beijing day: %',code;end if;
 end loop;
 saved:=public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{countries}',to_jsonb(codes)));
 if saved->>'id' is null or jsonb_array_length(saved->'config'->'countries')<>29 then raise exception '29-country direction rejected';end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(a,today))<>0 then raise exception 'new settings applied today';end if;
 if (select to_jsonb(d) from public.intelligence_collection_directions d where d.id=(old->>'id')::uuid) is distinct from old
 then raise exception 'saving Central Asian directions changed old settings, revision or position';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+1)::text) returning id into run_id;
 snapshot:=public.snapshot_intelligence_collection_directions(a,run_id);
 revised:=public.save_intelligence_collection_direction(a,(saved->>'id')::uuid,1,jsonb_set(cfg,'{countries}',to_jsonb(central)));
 if revised->>'revision' is distinct from '2' or revised->>'position' is distinct from saved->>'position'
 then raise exception 'updated Central Asian config changed revision or order semantics';end if;
 if public.snapshot_intelligence_collection_directions(a,run_id) is distinct from snapshot then raise exception 'existing run snapshot changed';end if;
 if public.save_intelligence_collection_direction(b,(saved->>'id')::uuid,2,cfg)->>'error' is distinct from 'not_found'
 then raise exception 'cross-owner update accepted';end if;
 if public.save_intelligence_collection_direction(a,(saved->>'id')::uuid,1,cfg)->>'error' is distinct from 'direction_conflict'
 then raise exception 'stale revision accepted';end if;
 if public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{countries}','["US"]'))->>'error' is distinct from 'invalid_request'
 or public.save_intelligence_collection_direction(a,null,0,jsonb_set(cfg,'{countries}',to_jsonb(codes||array['SA'])))->>'error' is distinct from 'invalid_request'
 then raise exception 'invalid country or >29-country direction accepted';end if;
 insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
 values(source_id,a,'https://fixture.invalid/central-asia','https://fixture.invalid/central-asia','pending_extraction',repeat('a',64),'fixture/central-asia');
 insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,importance,evidence_status,maturity,urgency,source_sha256,review_status,occurrence_countries,relevance_countries)
 values(fixture_candidate_id,a,source_id,'范围约束测试','仅用于SQL验证','source_only','low','sourced','background','none',repeat('a',64),'source_only',codes,codes);
 foreach code in array central loop
   insert into public.intelligence_organizations(owner_id,canonical_name,country_code) values(a,'fixture-'||code,code);
   insert into public.intelligence_projects(owner_id,candidate_id,country_code,canonical_name) values(a,fixture_candidate_id,code,'fixture')
   on conflict(owner_id,candidate_id) do update set country_code=excluded.country_code;
 end loop;
 rejected:=false;
 begin update public.intelligence_candidates set occurrence_countries=array['US'] where id=fixture_candidate_id;
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'invalid occurrence country accepted';end if;
 rejected:=false;
 begin update public.intelligence_candidates set relevance_countries=array['XX'] where id=fixture_candidate_id;
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'invalid relevance country accepted';end if;
 rejected:=false;
 begin insert into public.intelligence_organizations(owner_id,canonical_name,country_code) values(a,'invalid','US');
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'invalid organization country accepted';end if;
 rejected:=false;
 begin update public.intelligence_projects set country_code='US' where candidate_id=fixture_candidate_id;
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'invalid project country accepted';end if;
 if has_function_privilege('authenticated','public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb)','EXECUTE')
 then raise exception 'private direction RPC exposed';end if;
end $$;
rollback;
