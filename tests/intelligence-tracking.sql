-- Isolated database only. All test records roll back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  h uuid; w uuid; n integer;
  hs jsonb := '[{"hypothesis_zh":"采购可能推进","counter_evidence_zh":"取消采购即为反证"}]';
  ws jsonb := '["观察采购公告"]';
begin
  insert into auth.users(id) values (a), (b);
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(s,a,'https://official.example/news','https://official.example/news','pending_extraction',repeat('a',64),'test/source');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,
    occurrence_countries,importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,s,'测试项目','测试摘要','candidate',array['project'],array['SA'],'low','sourced','project','research',repeat('a',64),'auto_validated');
  if public.sync_intelligence_tracking(b,c,hs,ws) then raise exception 'cross owner tracking accepted'; end if;
  if not public.sync_intelligence_tracking(a,c,hs,ws) then raise exception 'tracking rejected'; end if;
  select id into h from public.intelligence_hypotheses where candidate_id=c;
  select id into w from public.intelligence_watch_targets where candidate_id=c;
  update public.intelligence_hypotheses set status='weakened' where id=h;
  update public.intelligence_watch_targets set status='completed' where id=w;
  perform public.sync_intelligence_tracking(a,c,hs,ws);
  perform public.sync_intelligence_tracking(a,c,'[]','[]');
  if (select count(*) from public.intelligence_hypotheses where candidate_id=c) <> 1
    or (select status from public.intelligence_hypotheses where id=h) is distinct from 'weakened'
    or (select count(*) from public.intelligence_watch_targets where candidate_id=c) <> 1
    or (select status from public.intelligence_watch_targets where id=w) is distinct from 'completed' then
    raise exception 'retry reset or deleted tracking state';
  end if;
  select count(*) into n from public.intelligence_watched_sources(a);
  if n <> 0 then raise exception 'completed watch revisited'; end if;
  update public.intelligence_watch_targets set status='active' where id=w;
  perform public.sync_intelligence_tracking(a,c,hs,'["观察采购公告", "观察取消公告"]');
  select count(*) into n from public.intelligence_watched_sources(a);
  if n <> 1 then raise exception 'active watches must deduplicate source'; end if;
  select count(*) into n from public.intelligence_watched_sources(b);
  if n <> 0 then raise exception 'watch leaked across owner'; end if;
  if has_function_privilege('anon','public.sync_intelligence_tracking(uuid,uuid,jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','public.intelligence_watched_sources(uuid)','execute') then
    raise exception 'tracking RPC publicly executable';
  end if;
end $$;
rollback;
