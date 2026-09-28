begin;
set local lock_timeout='5s';
create table public.intelligence_library_checks (
 owner_id uuid not null references auth.users(id),
 check_day date not null,
 entry_id text not null,
 reserved_at timestamptz not null default now(),
 primary key(owner_id,check_day,entry_id)
);
alter table public.intelligence_library_checks enable row level security;
revoke all on public.intelligence_library_checks from public,anon,authenticated;
grant all on public.intelligence_library_checks to service_role;

create function public.reserve_intelligence_library_check(p_owner_id uuid,p_entry_id text,p_day date)
returns text language plpgsql security definer set search_path=public as $$
begin
 if p_owner_id is null or p_entry_id is null or length(p_entry_id)>255
    or p_entry_id not like 'reference:%' or p_day is distinct from (now() at time zone 'Asia/Shanghai')::date
 then return 'invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || p_day::text,46));
 if exists(select 1 from public.intelligence_library_checks
   where owner_id=p_owner_id and check_day=p_day and entry_id=p_entry_id) then return 'duplicate'; end if;
 if (select count(*) from public.intelligence_library_checks where owner_id=p_owner_id and check_day=p_day)>=3
 then return 'limit'; end if;
 insert into public.intelligence_library_checks(owner_id,check_day,entry_id) values(p_owner_id,p_day,p_entry_id);
 return 'reserved';
end $$;
revoke all on function public.reserve_intelligence_library_check(uuid,text,date) from public,anon,authenticated;
grant execute on function public.reserve_intelligence_library_check(uuid,text,date) to service_role;
commit;
