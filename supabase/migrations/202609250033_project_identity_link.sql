-- A cross-check can be useful even when there is not enough current evidence
-- to give its projects one persistent identity.
begin;
create function public.try_link_intelligence_project_identity(p_owner_id uuid, p_left_candidate_id uuid, p_right_candidate_id uuid)
returns uuid language plpgsql as $$
declare left_project uuid; right_project uuid;
begin
  select id into left_project from public.intelligence_projects
    where owner_id=p_owner_id and candidate_id=p_left_candidate_id and current_in_analysis;
  select id into right_project from public.intelligence_projects
    where owner_id=p_owner_id and candidate_id=p_right_candidate_id and current_in_analysis;
  if left_project is null or right_project is null then return null; end if;
  begin
    return public.link_intelligence_project_identity(p_owner_id,left_project,right_project);
  exception when raise_exception then
    if sqlerrm in ('project_missing','identity_conflict','project_identity_evidence_missing') then return null; end if;
    raise;
  end;
end $$;
revoke all on function public.try_link_intelligence_project_identity(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.try_link_intelligence_project_identity(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
