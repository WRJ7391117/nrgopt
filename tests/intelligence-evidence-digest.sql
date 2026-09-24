begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); s uuid; c uuid; first_source uuid; first_candidate uuid;
  i integer; raw_hash text; quote text; job uuid; notice uuid; other uuid; n integer; payload jsonb;
begin
  insert into auth.users(id) values(a),(b);
  for i in 1..4 loop
    s:=gen_random_uuid(); c:=gen_random_uuid();
    raw_hash:=repeat(case when i=2 then '1' else i::text end,64);
    quote:=case when i<=3 then 'Original agreement signed.' else 'Project cancelled by the owner.' end;
    insert into public.intelligence_sources(id,owner_id,requested_url,final_url,status,content_sha256,storage_path,
      extraction_status,extraction_source_sha256,extraction_zh,extracted_at,publication_date)
    values(s,a,'https://fixture.invalid/'||i,'https://fixture.invalid/'||(case when i=3 then 1 else i end),'pending_extraction',raw_hash,'fixture/'||i,
      'extracted',raw_hash,jsonb_build_object('known_facts',jsonb_build_array(jsonb_build_object('claim_zh','已保存事实','evidence_quote',quote))),now(),case when i=4 then current_date-60 else current_date end);
    insert into public.intelligence_candidates(id,owner_id,source_id,title_zh,summary_zh,disposition,radars,occurrence_countries,
      importance,evidence_status,maturity,urgency,source_sha256,review_status)
    values(c,a,s,'项目公告','来源摘要','candidate',array['project'],array['SA'],'critical','sourced','project','research',raw_hash,'auto_validated');
    if i=1 then first_source:=s;first_candidate:=c;end if;
  end loop;
  select count(*) into n from public.intelligence_evidence_changes where owner_id=a;
  if n<>3 then raise exception 'same original duplicated';end if;
  if (select count(*) from public.intelligence_evidence_changes where owner_id=a and digest_eligible)<>2 then raise exception 'identical quotations re-alerted';end if;
  if (select count(*) from public.intelligence_notification_outbox where owner_id=a and notification_type='flash')<>1 then raise exception 'flash count';end if;
  update public.intelligence_sources set extraction_zh='{"known_facts":[{"claim_zh":"模型改写","evidence_quote":"A different selected quote from the same original."}]}' where id=first_source;
  update public.intelligence_candidates set evidence_status='checked',summary_zh='模型改写摘要' where id=first_candidate;
  if (select count(*) from public.intelligence_evidence_changes where owner_id=a)<>3 then raise exception 'reanalysis became new source';end if;
  update public.intelligence_notification_outbox set status='accepted' where id=(select flash_notification_id from public.intelligence_evidence_changes where owner_id=a order by id limit 1);
  job:=public.enqueue_intelligence_job(a,'daily_scan','2000-01-01',array['fixture']);
  update public.intelligence_job_runs set status='partial' where id=job;
  notice:=public.enqueue_intelligence_daily_digest(a,job);
  if notice is null then raise exception 'digest missing';end if;
  select n.payload into payload from public.intelligence_notification_outbox n where id=notice;
  if jsonb_array_length(payload->'changes')<>2 or not (payload->'changes'->0->>'flash_accepted')::boolean then raise exception 'digest snapshots wrong';end if;
  if payload->'changes'->0->>'summary_zh'<>'来源摘要' then raise exception 'notification history rewritten';end if;
  if public.enqueue_intelligence_daily_digest(a,job)<>notice then raise exception 'same day duplicate';end if;
  if public.enqueue_intelligence_daily_digest(b,job) is not null then raise exception 'cross owner';end if;
  -- Late evidence is retained when the previous day's notification has already been queued.
  insert into public.intelligence_evidence_changes(owner_id,source_id,source_sha256,evidence_fingerprint,payload,digest_eligible)
    values(a,first_source,repeat('9',64),repeat('f',64),'{"title_zh":"迟到证据"}',true);
  perform public.enqueue_intelligence_daily_digest(a,job);
  if not exists(select 1 from public.intelligence_evidence_changes where owner_id=a and digest_eligible and digest_notification_id is null) then raise exception 'late evidence lost';end if;
  other:=public.enqueue_intelligence_job(a,'daily_scan','2000-01-02',array['fixture']);
  update public.intelligence_job_runs set status='succeeded' where id=other;
  notice:=public.enqueue_intelligence_daily_digest(a,other);
  select n.payload into payload from public.intelligence_notification_outbox n where id=notice;
  if jsonb_array_length(payload->'changes')<>1 then raise exception 'next digest missed late evidence';end if;
  if has_table_privilege('anon','public.intelligence_evidence_changes','select') or has_function_privilege('authenticated','public.enqueue_intelligence_daily_digest(uuid,uuid)','execute') then raise exception 'public access';end if;
end $$;
rollback;
