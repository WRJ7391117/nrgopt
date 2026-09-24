-- Isolated database only. Provider balances below are synthetic, not billing evidence.
begin;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); reservation uuid;
begin
  insert into auth.users(id) values (owner_a), (owner_b);
  insert into public.intelligence_provider_configs(owner_id,capability,provider,endpoint,model,currency,budget_limit_micro,api_key_ciphertext)
  values (owner_a,'analysis','deepseek','https://api.deepseek.com','fixture','CNY',10000000,repeat('x',24));
  if public.sync_intelligence_provider_balance(owner_b,'analysis','CNY',50000000)
    or public.sync_intelligence_provider_balance(owner_a,'analysis','USD',50000000) then
    raise exception 'wrong owner or currency accepted';
  end if;
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',50000000);
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',50000000);
  if (select budget_spent_micro from public.intelligence_provider_configs where owner_id=owner_a) <> 0 then
    raise exception 'unchanged balance invented spend';
  end if;
  -- Later provider posting: two cents appear only when the official balance moves.
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',49980000);
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',49980000);
  if (select budget_spent_micro from public.intelligence_provider_configs where owner_id=owner_a) <> 20000 then
    raise exception 'delayed balance decrease not recorded exactly once';
  end if;
  -- A visible top-up resets the anchor without erasing previously observed decreases.
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',59980000);
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',59950000);
  if (select budget_spent_micro from public.intelligence_provider_configs where owner_id=owner_a) <> 50000 then
    raise exception 'top-up erased or duplicated previous decreases';
  end if;
  reservation := public.reserve_intelligence_budget(owner_a,null,'extraction','CNY','fixture-reserve',1000000);
  if reservation is null then raise exception 'reservation missing'; end if;
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',48000000);
  if public.reserve_intelligence_budget(owner_a,null,'extraction','CNY','fixture-after-cap',1) is not null then
    raise exception 'post-cap call allowed';
  end if;
  perform public.release_intelligence_budget(owner_a,reservation);
  if (select budget_reserved_micro from public.intelligence_provider_configs where owner_id=owner_a) <> 0 then
    raise exception 'release lost after provider exceeds cap';
  end if;
  -- The next month starts a fresh anchor, not a fabricated cross-month charge.
  update public.intelligence_provider_configs set budget_period_start=date '2000-01-01',budget_period_end=date '2000-01-31' where owner_id=owner_a;
  perform public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',47000000);
  if (select budget_spent_micro from public.intelligence_provider_configs where owner_id=owner_a) <> 0 then
    raise exception 'month rollover retained prior spend';
  end if;
  update public.intelligence_provider_configs set billing_mode='included' where owner_id=owner_a;
  if public.sync_intelligence_provider_balance(owner_a,'analysis','CNY',46000000) then
    raise exception 'included plan accepted monetary sync';
  end if;
  if has_function_privilege('authenticated','public.sync_intelligence_provider_balance(uuid,text,text,bigint)','execute') then
    raise exception 'client may alter billing balances';
  end if;
end $$;
rollback;
