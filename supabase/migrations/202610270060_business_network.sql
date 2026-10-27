begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- User-maintained business contacts are separate from model-normalized organizations and source channels.
create table public.intelligence_business_relations (
  owner_id uuid not null references auth.users(id),
  id uuid not null,
  revision integer not null check (revision > 0),
  organization text not null check (length(organization) between 1 and 160),
  contact_name text not null default '' check (length(contact_name) <= 120),
  role text not null default '' check (length(role) <= 160),
  region text not null default '' check (length(region) <= 120),
  contact_details text not null default '' check (length(contact_details) <= 800),
  business_context text not null default '' check (length(business_context) <= 1000),
  source_note text not null default '' check (length(source_note) <= 800),
  communication_note text not null default '' check (length(communication_note) <= 1600),
  next_action text not null default '' check (length(next_action) <= 600),
  status text not null check (status in ('identified','contacted','communicating','paused')),
  followup_on date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index intelligence_business_relations_owner_updated
  on public.intelligence_business_relations(owner_id, archived, updated_at desc, id);
alter table public.intelligence_business_relations enable row level security;
revoke all on public.intelligence_business_relations from public, anon, authenticated;
grant select, insert, update on public.intelligence_business_relations to service_role;

create function public.save_intelligence_business_relation(
  p_owner_id uuid, p_id uuid, p_revision integer, p_value jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare current_row public.intelligence_business_relations%rowtype;
  desired public.intelligence_business_relations%rowtype;
  cleaned jsonb := '{}'; field text; field_value text; max_length integer;
begin
  if p_owner_id is null or p_id is null or p_revision is null or p_revision < 0 or p_revision > 2147483646
    or jsonb_typeof(p_value) is distinct from 'object' then return jsonb_build_object('error','invalid_request'); end if;
  foreach field in array array['organization','contact_name','role','region','contact_details','business_context','source_note','communication_note','next_action'] loop
    if jsonb_typeof(p_value->field) is distinct from 'string' then return jsonb_build_object('error','invalid_request'); end if;
    field_value := p_value->>field;
    if field_value ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F]' then return jsonb_build_object('error','invalid_request'); end if;
    field_value := btrim(field_value, E' \t\n\r');
    max_length := case field when 'organization' then 160 when 'contact_name' then 120 when 'role' then 160
      when 'region' then 120 when 'business_context' then 1000 when 'communication_note' then 1600 when 'next_action' then 600 else 800 end;
    if length(field_value) > max_length or (field = 'organization' and field_value = '') then return jsonb_build_object('error','invalid_request'); end if;
    cleaned := cleaned || jsonb_build_object(field, field_value);
  end loop;
  if coalesce(p_value->>'status','') not in ('identified','contacted','communicating','paused')
    or (p_value ? 'archived' and jsonb_typeof(p_value->'archived') is distinct from 'boolean')
    or not (p_value ? 'followup_on') then return jsonb_build_object('error','invalid_request'); end if;
  if p_value->'followup_on' <> 'null'::jsonb then
    if jsonb_typeof(p_value->'followup_on') <> 'string' or (p_value->>'followup_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return jsonb_build_object('error','invalid_request');
    end if;
    begin
      perform (p_value->>'followup_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('error','invalid_request'); end;
  end if;
  cleaned := cleaned || jsonb_build_object('status',p_value->>'status','followup_on',p_value->'followup_on',
    'archived',coalesce((p_value->>'archived')::boolean,false));
  desired := jsonb_populate_record(null::public.intelligence_business_relations, cleaned);

  -- Serialize creations as well as edits so a retry with the same client ID cannot duplicate a relation.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 60));
  select * into current_row from public.intelligence_business_relations where owner_id = p_owner_id and id = p_id for update;
  if found then
    if (to_jsonb(current_row) - array['owner_id','id','revision','created_at','updated_at']) = cleaned
      and p_revision in (current_row.revision,current_row.revision - 1) then return to_jsonb(current_row) - 'owner_id'; end if;
    if current_row.revision <> p_revision then return jsonb_build_object('error','business_relation_conflict'); end if;
    update public.intelligence_business_relations set organization=desired.organization,contact_name=desired.contact_name,
      role=desired.role,region=desired.region,contact_details=desired.contact_details,business_context=desired.business_context,
      source_note=desired.source_note,communication_note=desired.communication_note,next_action=desired.next_action,
      status=desired.status,followup_on=desired.followup_on,archived=desired.archived,revision=revision+1,updated_at=now()
      where owner_id=p_owner_id and id=p_id returning * into current_row;
  else
    if p_revision <> 0 then return jsonb_build_object('error','business_relation_conflict'); end if;
    insert into public.intelligence_business_relations(owner_id,id,revision,organization,contact_name,role,region,contact_details,
      business_context,source_note,communication_note,next_action,status,followup_on,archived)
      values(p_owner_id,p_id,1,desired.organization,desired.contact_name,desired.role,desired.region,desired.contact_details,
        desired.business_context,desired.source_note,desired.communication_note,desired.next_action,desired.status,desired.followup_on,desired.archived)
      returning * into current_row;
  end if;
  return to_jsonb(current_row) - 'owner_id';
end $$;
revoke all on function public.save_intelligence_business_relation(uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.save_intelligence_business_relation(uuid,uuid,integer,jsonb) to service_role;

create function public.intelligence_business_network(p_owner_id uuid, p_status text, p_q text, p_offset integer)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if p_owner_id is null or p_status is null or p_status not in ('all','identified','contacted','communicating','paused','archived')
    or p_q is null or length(p_q) > 200 or p_q ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F]'
    or p_offset is null or p_offset < 0 then return jsonb_build_object('error','invalid_request'); end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'owner_id' order by r.updated_at desc,r.id),'[]'::jsonb)
    from (select * from public.intelligence_business_relations
      where owner_id = p_owner_id and archived = (p_status = 'archived')
        and (p_status in ('all','archived') or status = p_status)
        and (btrim(p_q) = '' or strpos(lower(organization),lower(btrim(p_q))) > 0
          or strpos(lower(contact_name),lower(btrim(p_q))) > 0 or strpos(lower(region),lower(btrim(p_q))) > 0)
      order by updated_at desc,id limit 26 offset p_offset) r);
end $$;
revoke all on function public.intelligence_business_network(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.intelligence_business_network(uuid,text,text,integer) to service_role;

notify pgrst, 'reload schema';
commit;
