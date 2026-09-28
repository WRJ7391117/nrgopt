begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c jsonb; saved jsonb; n uuid; f uuid; picked uuid;
begin
 insert into auth.users(id) values(a),(b);
 insert into public.intelligence_notification_settings(owner_id,quiet_enabled) values(a,false);
 c:='{"app_id":"cli_example","secret_ciphertext":"encrypted-fixture","chat_id":"oc_example_chat","user_open_id":"","enabled":false,"send_chat":true,"send_user":false,"daily_enabled":false,"flash_enabled":true,"system_enabled":true}';
 saved:=public.save_intelligence_feishu_config(a,0,c);
 if (saved->>'revision')::integer<>1 then raise exception 'save failed';end if;
 if public.save_intelligence_feishu_config(a,0,c)->>'error'<>'feishu_config_conflict' then raise exception 'stale saved';end if;
 if exists(select 1 from public.intelligence_feishu_config where owner_id=b) then raise exception 'owner leak';end if;
 n:=public.enqueue_intelligence_notification(a,'daily','daily','{}');
 f:=public.enqueue_intelligence_notification(a,'flash','flash','{}');
 if exists(select 1 from public.claim_intelligence_notification(a)) then raise exception 'master pause ignored';end if;
 if exists(select 1 from public.intelligence_notification_outbox where owner_id=a and attempts<>0) then raise exception 'pause used attempt';end if;
 perform public.save_intelligence_feishu_config(a,1,jsonb_set(c,'{enabled}','true'));
 select id into picked from public.claim_intelligence_notification(a);
 if picked is distinct from f then raise exception 'type selection wrong';end if;
 if (select attempts from public.intelligence_notification_outbox where id=n)<>0 then raise exception 'disabled type consumed attempt';end if;
 update public.intelligence_notification_outbox set status='unknown',lease_until=null where id=f;
 perform public.save_intelligence_feishu_config(a,2,jsonb_set(jsonb_set(c,'{enabled}','true'),'{daily_enabled}','true'));
 select id into picked from public.claim_intelligence_notification(a);
 if picked is distinct from n then raise exception 'resume pending failed';end if;
 update public.intelligence_notification_outbox set status='accepted',lease_until=null where id=n;
 if exists(select 1 from public.claim_intelligence_notification(a)) then raise exception 'resent historical/unknown';end if;
 if has_table_privilege('anon','public.intelligence_feishu_config','SELECT') or has_table_privilege('authenticated','public.intelligence_feishu_config','SELECT')
 or has_function_privilege('authenticated','public.save_intelligence_feishu_config(uuid,integer,jsonb)','EXECUTE') then raise exception 'secret permission exposed';end if;
end $$;
rollback;
