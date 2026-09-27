-- Isolated database only. No fixture or clock changes survive this transaction.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); d jsonb; revised jsonb; plan jsonb; run_id uuid; legacy_id uuid;
 cfg jsonb:='{"name":"地区冲突与能源保供","why":"关注供电是否中断","industries":"医院","exclude":"一般评论","countries":["SA"],"targets":["signal"],"priority":"high","enabled":true}';
 today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 insert into auth.users(id) values(a),(b);
 d:=public.save_intelligence_collection_direction(a,null,0,cfg);
 if d->>'id' is null or (d->>'effective_on')::date<>today+1 then raise exception 'save or next Beijing date failed'; end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(a,today))<>0 then raise exception 'applied too early';end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(a,today+1))<>1 then raise exception 'missing tomorrow config';end if;
 if public.save_intelligence_collection_direction(b,(d->>'id')::uuid,1,cfg)->>'error'<>'not_found' then raise exception 'owner isolation';end if;
 insert into public.intelligence_job_runs(owner_id,job_type,schedule_key) values(a,'daily_scan',(today+1)::text) returning id into run_id;
 plan:=public.snapshot_intelligence_collection_directions(a,run_id);
 revised:=public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,jsonb_set(cfg,'{enabled}','false'));
 if (revised->>'revision')::integer<>2 then raise exception 'version did not advance';end if;
 if public.snapshot_intelligence_collection_directions(a,run_id)<>plan then raise exception 'inflight plan changed';end if;
 if public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,cfg)->>'error'<>'direction_conflict' then raise exception 'stale update accepted';end if;
 if (public.save_intelligence_collection_direction(a,(d->>'id')::uuid,1,jsonb_set(cfg,'{enabled}','false'))->>'revision')::integer<>2 then raise exception 'retry not idempotent';end if;
 if (select count(*) from public.intelligence_collection_direction_versions where owner_id=a)<>2 then raise exception 'history missing or duplicated';end if;
 legacy_id:=public.enqueue_intelligence_job(a,'daily_scan',today::text,array['discover:SA']);
 if public.snapshot_intelligence_collection_directions(a,legacy_id) is not null then raise exception 'legacy run retrofitted';end if;
 if jsonb_array_length(public.intelligence_effective_collection_directions(b,today+1))<>0 then raise exception 'cross-owner read';end if;
 if has_function_privilege('authenticated','public.save_intelligence_collection_direction(uuid,uuid,integer,jsonb)','EXECUTE') then raise exception 'direct authenticated write allowed';end if;
 if has_table_privilege('anon','public.intelligence_collection_directions','SELECT') then raise exception 'anonymous table exposed';end if;
end $$;
rollback;
