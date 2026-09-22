-- G3 staged daily pipeline: discovery can add bounded source and extraction items idempotently.
begin;

create or replace function public.enqueue_intelligence_job_items(
  p_owner_id uuid, p_job_run_id uuid, p_items jsonb
) returns integer language plpgsql as $$
declare v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return null; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60
     or not exists (select 1 from public.intelligence_job_runs where id = p_job_run_id and owner_id = p_owner_id)
     or exists (
       select 1 from jsonb_array_elements(p_items) item
       where jsonb_typeof(item) <> 'object'
          or length(coalesce(item->>'item_key', '')) not between 1 and 160
          or jsonb_typeof(coalesce(item->'checkpoint', '{}'::jsonb)) <> 'object'
     ) then return null; end if;
  insert into public.intelligence_job_items(owner_id, job_run_id, item_key, checkpoint)
  select p_owner_id, p_job_run_id, item->>'item_key', coalesce(item->'checkpoint', '{}'::jsonb)
  from jsonb_array_elements(p_items) item
  on conflict (owner_id, job_run_id, item_key) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    update public.intelligence_job_runs set status = case when status = 'queued' then 'queued' else 'running' end,
      finished_at = null, updated_at = now() where id = p_job_run_id and owner_id = p_owner_id;
  end if;
  return v_count;
end $$;

revoke all on function public.enqueue_intelligence_job_items(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_intelligence_job_items(uuid,uuid,jsonb) to service_role;

commit;
