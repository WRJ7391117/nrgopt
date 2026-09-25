-- An unverified early opportunity may be linked to a hypothesis before a project exists.
begin;
alter table public.intelligence_hypotheses
  add constraint intelligence_hypotheses_owner_candidate_id_unique unique(owner_id,candidate_id,id);
alter table public.intelligence_opportunities alter column project_id drop not null;
alter table public.intelligence_opportunities add column hypothesis_id uuid;
alter table public.intelligence_opportunities drop constraint intelligence_opportunities_scope_check;
alter table public.intelligence_opportunities
  add constraint intelligence_opportunities_scope_check check(scope in ('early','equipment','service'));
alter table public.intelligence_opportunities
  add constraint intelligence_opportunities_hypothesis_owner_fkey
  foreign key(owner_id,candidate_id,hypothesis_id)
  references public.intelligence_hypotheses(owner_id,candidate_id,id);
alter table public.intelligence_opportunities
  add constraint intelligence_opportunities_stage_link_check check(
    (scope='early' and project_id is null and hypothesis_id is not null and participation_status='unverified')
    or (scope in ('equipment','service') and project_id is not null and hypothesis_id is null)
  );
create index intelligence_opportunities_owner_hypothesis
  on public.intelligence_opportunities(owner_id,hypothesis_id) where hypothesis_id is not null;
notify pgrst,'reload schema';
commit;
