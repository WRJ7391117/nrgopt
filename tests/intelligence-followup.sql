-- Real PostgreSQL lifecycle and owner isolation; fixtures always roll back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  w uuid; r jsonb; f jsonb := '{"reason":"需要验证需求","next_action":"核对公告","exit_condition":"该包件被明确取消","review_on":"2026-09-28","priority":"high","outcome":"","exit_reason":""}';
begin
  insert into auth.users(id) values(a),(b);
  set local role service_role;
  insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path)
    values(s,a,'https://fixture.invalid/followup','https://fixture.invalid/followup','pending_extraction',repeat('a',64),'fixture/followup');
  insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,occurrence_countries,importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,s,'测试','测试','candidate',array['project'],array['SA'],'low','sourced','project','research',repeat('a',64),'auto_validated');
  insert into public.intelligence_watch_targets(owner_id,candidate_id,signal_zh) values(a,c,'AI旧关注');
  if public.save_intelligence_followup(b,s,0,'active',f)->>'error' <> 'not_found' then raise exception 'wrong owner'; end if;
  if public.save_intelligence_followup(a,s,0,'active',f||'{"review_on":"2026-02-30"}')->>'error' <> 'invalid_request' then raise exception 'bad date'; end if;
  if public.save_intelligence_followup(a,s,0,'active',f||'{"next_action":""}')->>'error' <> 'invalid_request' then raise exception 'missing action'; end if;
  r := public.save_intelligence_followup(a,s,0,'active',f); w := (r->>'id')::uuid;
  if r->>'revision' <> '1' then raise exception 'create'; end if;
  perform public.save_intelligence_followup(a,s,0,'active',f);
  if (select count(*) from public.intelligence_followup_history where watch_id=w) <> 1 then raise exception 'duplicate history'; end if;
  if public.save_intelligence_followup(a,s,0,'active',f||'{"reason":"过期页面修改"}')->>'error' <> 'followup_conflict' then raise exception 'stale overwrite'; end if;
  update public.intelligence_watch_targets set followup = f || jsonb_build_object('priority','normal','review_on',((now() at time zone 'Asia/Shanghai')::date + 30)::text), updated_at=now()-interval '1 day' where id=w;
  if exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'normal cadence ignored'; end if;
  update public.intelligence_watch_targets set updated_at=now()-interval '7 days' where id=w;
  if not exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'normal cadence did not resume'; end if;
  update public.intelligence_watch_targets set followup=f, updated_at=now() where id=w;
  f := f||'{"outcome":"已阅读原文并确认该包件取消","exit_reason":"官方取消该包件，项目其他阶段仍保留"}';
  r := public.save_intelligence_followup(a,s,1,'completed',f);
  if r->>'revision' <> '2' or exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'exit ignored'; end if;
  perform public.sync_intelligence_tracking(a,c,'[]','["另一个AI信号"]');
  if exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'AI reopened user exit'; end if;
  f := f||'{"exit_reason":"新阶段值得重新核查"}';
  r := public.save_intelligence_followup(a,s,2,'active',f);
  if not exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'restore failed'; end if;
  update public.intelligence_watch_targets set created_at=now()-interval '100 days' where id=w;
  perform public.review_intelligence_tracking(a);
  if (select status from public.intelligence_watch_targets where id=w) <> 'active' then raise exception 'silence erased user decision'; end if;
  r := public.save_intelligence_followup(a,s,3,'expired',f||'{"exit_reason":"暂无新证据，暂缓而非无价值"}');
  if exists(select 1 from public.intelligence_watched_sources(a)) then raise exception 'pause ignored'; end if;
  if (select count(*) from public.intelligence_followup_history where watch_id=w) <> 4 then raise exception 'lost history'; end if;
  if not exists(select 1 from public.intelligence_sources where id=s) then raise exception 'original lost'; end if;
  if has_function_privilege('authenticated','public.save_intelligence_followup(uuid,uuid,integer,text,jsonb)','execute')
    or has_table_privilege('anon','public.intelligence_followup_history','select') then raise exception 'public access'; end if;
end $$;
rollback;
