-- Revisit existing support pairs through the same current-evidence gate used online.
-- Stale, different-scope and incomplete pairs keep their separate identities.
begin;
do $$
declare pair record;
begin
  for pair in
    select distinct owner_id,
      least(candidate_id, related_candidate_id) as left_candidate_id,
      greatest(candidate_id, related_candidate_id) as right_candidate_id
    from public.intelligence_candidate_relations
    where relation='supports' and same_scope=true
  loop
    perform public.try_link_intelligence_project_identity(
      pair.owner_id, pair.left_candidate_id, pair.right_candidate_id);
  end loop;
end $$;
commit;
