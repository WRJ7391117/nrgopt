-- Isolated database; fixture rows roll back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); v1 uuid; v2 uuid; r uuid; r2 uuid;
begin
  insert into auth.users(id) values(a),(b);
  insert into public.intelligence_provider_configs(owner_id,capability,provider,endpoint,model,currency,billing_mode,budget_limit_micro,api_key_ciphertext)
    values(a,'analysis','deepseek','https://api.deepseek.com/chat/completions','model-a','CNY','balance',10000000,repeat('fixture',5));
  select config_version_id into v1 from public.intelligence_provider_configs where owner_id=a;
  r := public.reserve_intelligence_budget(a,null,'extraction','CNY','call-a',1000);
  if (select config_version_id from public.intelligence_provider_configs where owner_id=a) <> v1 then raise exception 'budget counter changed version'; end if;
  if public.start_intelligence_provider_call(b,r,v1) then raise exception 'cross owner'; end if;
  if not public.start_intelligence_provider_call(a,r,v1) then raise exception 'start failed'; end if;
  if public.start_intelligence_provider_call(a,r,v1) then raise exception 'duplicate dispatch'; end if;
  update public.intelligence_provider_configs set model='model-b' where owner_id=a;
  select config_version_id into v2 from public.intelligence_provider_configs where owner_id=a;
  if v1=v2 then raise exception 'model change lost'; end if;
  if (select model from public.intelligence_provider_versions where id=v1) <> 'model-a' then raise exception 'history overwritten'; end if;
  if not public.finish_intelligence_provider_call(a,r,null,'{"prompt_tokens":12}') then raise exception 'finish in-flight after switch'; end if;
  if (select config_version_id from public.intelligence_budget_reservations where id=r) <> v1 then raise exception 'in-flight version rewritten'; end if;
  perform public.release_intelligence_budget(a,r);
  r2 := public.reserve_intelligence_budget(a,null,'extraction','CNY','call-b',1000);
  if public.start_intelligence_provider_call(a,r2,v1) then raise exception 'stale profile dispatched'; end if;
  if (select cost_status from public.intelligence_budget_reservations where id=r2) <> 'released' then raise exception 'stale reserve leaked'; end if;
  r2 := public.reserve_intelligence_budget(a,null,'extraction','CNY','call-c',1000);
  if not public.start_intelligence_provider_call(a,r2,v2) then raise exception 'new profile not usable'; end if;
  if not public.finish_intelligence_provider_call(a,r2,'model_unavailable',null) then raise exception 'failure lost'; end if;
  update public.intelligence_provider_configs set api_key_ciphertext=repeat('newfixture',5) where owner_id=a;
  if not (select key_changed from public.intelligence_provider_versions where id=(select config_version_id from public.intelligence_provider_configs where owner_id=a)) then raise exception 'rotation lost'; end if;
  if exists(select 1 from public.intelligence_provider_versions where to_jsonb(intelligence_provider_versions)::text like '%fixture%') then raise exception 'secret in history'; end if;
  if (select count(*) from public.intelligence_provider_versions where owner_id=a) <> 3 then raise exception 'unexpected versions'; end if;
  if has_table_privilege('anon','public.intelligence_provider_versions','select')
    or has_table_privilege('authenticated','public.intelligence_provider_versions','select')
    or has_function_privilege('anon','public.start_intelligence_provider_call(uuid,uuid,uuid)','execute') then raise exception 'public access'; end if;
end $$;
rollback;
