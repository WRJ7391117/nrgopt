-- Synthetic records only, in the isolated local database; always roll back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  stale uuid := gen_random_uuid(); recent uuid := gen_random_uuid(); unrelated uuid := gen_random_uuid(); unknown_date uuid := gen_random_uuid();
  finished uuid := gen_random_uuid(); fresh uuid := gen_random_uuid(); other uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  result jsonb; h uuid;
begin
  insert into auth.users(id) values(a),(b);
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(s,a,'https://fixture.invalid/review','https://fixture.invalid/review','pending_extraction',repeat('a',64),'test/review');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,
    occurrence_countries,importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,s,'测试','测试','candidate',array['project'],array['SA'],'low','sourced','project','research',repeat('a',64),'auto_validated');
  foreach h in array array[stale,recent,unrelated,unknown_date,finished] loop
    insert into public.intelligence_hypotheses(id,owner_id,candidate_id,claim_zh,created_at,review_due_at)
      values(h,a,c,h::text,now()-interval '91 days',now()-interval '1 day');
  end loop;
  update public.intelligence_hypotheses set status='confirmed' where id=finished;
  insert into public.intelligence_hypotheses(id,owner_id,candidate_id,claim_zh) values(fresh,a,c,'新的假设');
  insert into public.intelligence_hypotheses(id,owner_id,candidate_id,claim_zh,review_due_at) values(other,b,c,'另一个账号',now()-interval '1 day');
  insert into public.intelligence_watch_targets(id,owner_id,candidate_id,signal_zh,created_at) values(w,a,c,'观察进展',now()-interval '91 days');
  foreach h in array array[recent,unrelated,unknown_date] loop
    insert into public.intelligence_hypothesis_assessments(owner_id,hypothesis_id,source_id,source_sha256,
      previous_status,recommendation,resulting_status,applied,decision_code,reason_zh,evidence_facts,provider,model,created_at)
      values(a,h,s,repeat('a',64),'open',case when h=unrelated then 'unchanged' else 'strengthened' end,'open',false,
        case when h=unknown_date then 'date_unverified' else 'unchanged' end,'测试',
        '[{"claim_zh":"新证据","evidence_quote":"Evidence"}]','fixture','fixture',now()-interval '1 day');
  end loop;
  result := public.review_intelligence_tracking(a);
  if result <> '{"dormant":3,"renewed":1,"expired_watches":0}'::jsonb then raise exception 'wrong counts: %',result; end if;
  if exists(select 1 from public.intelligence_hypotheses where id in(stale,unrelated,unknown_date)
    and (status<>'dormant' or dormant_at is null or last_reviewed_at is null)) then raise exception 'silence review failed'; end if;
  if (select review_due_at from public.intelligence_hypotheses where id=recent) <> now()+interval '89 days'
    or (select status from public.intelligence_hypotheses where id=recent)<>'open' then raise exception 'relevant evidence did not extend'; end if;
  if (select status from public.intelligence_hypotheses where id=finished)<>'confirmed'
    or (select last_reviewed_at from public.intelligence_hypotheses where id=fresh) is not null
    or (select last_reviewed_at from public.intelligence_hypotheses where id=other) is not null then raise exception 'unrelated status changed'; end if;
  if public.review_intelligence_tracking(a) <> '{"dormant":0,"renewed":0,"expired_watches":0}'::jsonb then raise exception 'review is not idempotent'; end if;
  update public.intelligence_hypotheses set status='rejected' where id in(recent,fresh);
  result := public.review_intelligence_tracking(a);
  if result->>'expired_watches'<>'1' or (select status from public.intelligence_watch_targets where id=w)<>'expired' then raise exception 'old inactive watch not expired'; end if;
  if exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'expired watch still revisited'; end if;
  perform public.sync_intelligence_tracking(a,c,jsonb_build_array(jsonb_build_object('hypothesis_zh',stale::text)),'["观察进展"]');
  if (select status from public.intelligence_hypotheses where id=stale)<>'dormant'
    or (select status from public.intelligence_watch_targets where id=w)<>'expired' then raise exception 're-extraction reopened tracking'; end if;
  if has_function_privilege('anon','public.review_intelligence_tracking(uuid)','execute')
    or has_function_privilege('authenticated','public.review_intelligence_tracking(uuid)','execute') then raise exception 'review exposed publicly'; end if;
end $$;
rollback;
