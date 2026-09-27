-- Product-defined MENA scope; does not enable new collectors or rewrite historical analyses.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.intelligence_candidates drop constraint intelligence_candidates_occurrence_countries_check;
alter table public.intelligence_candidates add constraint intelligence_candidates_occurrence_countries_check check (occurrence_countries <@ array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR']::text[]);
alter table public.intelligence_candidates drop constraint intelligence_candidates_relevance_countries_check;
alter table public.intelligence_candidates add constraint intelligence_candidates_relevance_countries_check check (relevance_countries <@ array['SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR']::text[]);
alter table public.intelligence_organizations drop constraint intelligence_organizations_country_code_check;
alter table public.intelligence_organizations add constraint intelligence_organizations_country_code_check check (country_code in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR'));
alter table public.intelligence_projects drop constraint intelligence_projects_country_code_check;
alter table public.intelligence_projects add constraint intelligence_projects_country_code_check check (country_code in ('SA','AE','QA','KW','OM','BH','YE','IQ','IR','JO','LB','SY','IL','PS','TR','CY','EG','DZ','LY','MA','TN','SD','EH','MR'));
alter table public.intelligence_candidates add column topic_codes text[] not null default '{}'
  check (topic_codes <@ array['red-sea','hormuz','bab-el-mandeb','suez','east-mediterranean','mediterranean-interconnection','trans-saharan-gas']::text[]);
commit;
