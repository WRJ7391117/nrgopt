-- Evidence-linked project and procurement records do not require a separate human approval step.
begin;

alter table public.intelligence_candidates drop constraint intelligence_candidates_review_status_check;
update public.intelligence_candidates
set review_status = 'auto_validated'
where review_status = 'pending_review';
alter table public.intelligence_candidates add constraint intelligence_candidates_review_status_check
  check (review_status in ('source_only','auto_validated','approved','rejected'));

create unique index intelligence_procurements_owner_project_package
  on public.intelligence_procurements(owner_id, project_id, package_name_zh);

commit;
