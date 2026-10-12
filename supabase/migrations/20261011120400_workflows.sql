-- =============================================================================
-- Workflow functions. Every change to estate data goes through one of these.
-- They are called only via public.api() (next migration), which adds
-- idempotency so a request replayed by an offline device is harmless.
--
-- Conventions: each private.api_<name>(p jsonb) returns jsonb, validates its
-- own input and permissions, and raises private.fail() codes on refusal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- JSON input helpers (blank strings are treated as null)
-- ---------------------------------------------------------------------------
create or replace function private.jt(p jsonb, k text) returns text
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '') $$;

create or replace function private.ju(p jsonb, k text) returns uuid
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::uuid $$;

create or replace function private.ji(p jsonb, k text) returns integer
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::integer $$;

create or replace function private.jn(p jsonb, k text) returns numeric
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::numeric $$;

create or replace function private.jb(p jsonb, k text) returns boolean
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::boolean $$;

create or replace function private.jts(p jsonb, k text) returns timestamptz
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::timestamptz $$;

create or replace function private.jd(p jsonb, k text) returns date
language sql immutable set search_path = '' as $$ select nullif(btrim(p ->> k), '')::date $$;

-- Text array from a JSON array (anything else yields an empty array).
create or replace function private.jarr(p jsonb, k text) returns text[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p -> k) = 'array'
              then array(select jsonb_array_elements_text(p -> k))
              else '{}'::text[] end
$$;

-- ---------------------------------------------------------------------------
-- Domain helpers
-- ---------------------------------------------------------------------------
create or replace function private.row_json(r anyelement) returns jsonb
language sql immutable set search_path = '' as $$ select to_jsonb(r) - 'sync_xid' $$;

create or replace function private.terminal_statuses() returns public.item_status[]
language sql immutable set search_path = '' as $$
  select array['SOLD', 'DONATED', 'DISTRIBUTED', 'DISPOSED', 'MERGED']::public.item_status[]
$$;

create or replace function private.manual_statuses() returns public.item_status[]
language sql immutable set search_path = '' as $$
  select array['DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION', 'ON_HOLD']::public.item_status[]
$$;

-- ---------------------------------------------------------------------------
-- Codes (format and check digit: see the foundation migration)
-- ---------------------------------------------------------------------------
create or replace function private.location_prefix(k public.location_kind) returns text
language sql immutable set search_path = '' as $$
  select case k
    when 'PROPERTY' then 'PRP' when 'AREA' then 'RM' when 'CONTAINER' then 'BOX'
    when 'STAGING' then 'STG' when 'HOLDING' then 'HLD' when 'PERSON' then 'PER'
    else 'EXT' end
$$;

-- BOX-9Q4TR: check digit is the 3rd character after the dash.
create or replace function private.valid_location_code(p_code text, k public.location_kind) returns boolean
language sql immutable set search_path = '' as $$
  select p_code ~ '^(PRP|RM|BOX|STG|HLD|PER|EXT)-[0-9A-HJKMNP-TV-Z]{2}[0-9][0-9A-HJKMNP-TV-Z]{2}$'
     and split_part(p_code, '-', 1) = private.location_prefix(k)
     and substr(split_part(p_code, '-', 2), 3, 1)::integer = private.code_check_digit(
           split_part(p_code, '-', 1) || left(split_part(p_code, '-', 2), 2) || right(split_part(p_code, '-', 2), 2))
$$;

create or replace function private.new_location_code(p_estate_id uuid, k public.location_kind) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rand text;
  v_check integer;
  v_code text;
begin
  loop
    v_rand := private.random_code(4);
    v_check := private.code_check_digit(private.location_prefix(k) || v_rand);
    continue when v_check = 10;
    v_code := private.location_prefix(k) || '-' || left(v_rand, 2) || v_check::text || right(v_rand, 2);
    exit when not exists (select 1 from public.locations l where l.estate_id = p_estate_id and l.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- 0428KB-LR7FUR-Q3X: number+member, found tag + check + category, random.
create or replace function private.valid_item_code(p_code text) returns boolean
language sql immutable set search_path = '' as $$
  select p_code ~ '^[0-9]{4,}[A-Z]{2}-[A-Z0-9]{2}[0-9][A-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$'
     and substr(split_part(p_code, '-', 2), 3, 1)::integer = private.code_check_digit(
           split_part(p_code, '-', 1) || left(split_part(p_code, '-', 2), 2)
           || right(split_part(p_code, '-', 2), 3) || split_part(p_code, '-', 3))
$$;

create or replace function private.new_item_code(p_number integer, p_member text, p_found_tag text, p_category text)
returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_num text := case when length(p_number::text) >= 4 then p_number::text else lpad(p_number::text, 4, '0') end;
  v_rand text;
  v_check integer;
begin
  loop
    v_rand := private.random_code(3);
    v_check := private.code_check_digit(v_num || p_member || p_found_tag || p_category || v_rand);
    exit when v_check < 10;
  end loop;
  return v_num || p_member || '-' || p_found_tag || v_check::text || p_category || '-' || v_rand;
end;
$$;

-- Two-character room tag from a name ("Living room" -> LR, "Bedroom 2" -> B2,
-- "Kitchen" -> KT), avoiding tags already used in the estate where possible.
-- Mirrors deriveLocationTag() in supabase/functions/_shared/codes.ts.
create or replace function private.derive_location_tag(p_estate_id uuid, p_name text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_words text[];
  v_first text;
  v_last text;
  v_cand text;
  v_cands text[] := '{}';
  v_cons text;
  i integer;
begin
  select coalesce(array_agg(w order by ord), '{}') into v_words
    from regexp_split_to_table(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', ' ', 'g')), ' ') with ordinality as t(w, ord)
   where w <> '' and w not in ('THE', 'A', 'AN', 'OF', 'AND', 'S');
  if cardinality(v_words) = 0 then
    v_words := array['XX'];
  end if;
  v_first := v_words[1];
  v_last := v_words[cardinality(v_words)];
  v_cons := regexp_replace(substr(v_first, 2), '[AEIOU]', '', 'g');
  if cardinality(v_words) >= 2 then
    v_cands := v_cands || (left(v_first, 1) || left(v_last, 1));
  end if;
  if v_cons <> '' then
    v_cands := v_cands || (left(v_first, 1) || left(v_cons, 1));
  end if;
  v_cands := v_cands || left(v_first || 'X', 2);
  for i in 2 .. least(length(v_cons), 6) loop
    v_cands := v_cands || (left(v_first, 1) || substr(v_cons, i, 1));
  end loop;
  for i in 2 .. 9 loop
    v_cands := v_cands || (left(v_first, 1) || i::text);
  end loop;
  foreach v_cand in array v_cands loop
    if v_cand ~ '^[A-Z0-9]{2}$' and v_cand <> 'XX' and not exists (
      select 1 from public.locations l where l.estate_id = p_estate_id and l.tag = v_cand and l.archived_at is null
    ) then
      return v_cand;
    end if;
  end loop;
  return left(v_first || 'X', 2);
end;
$$;

-- The tag used for "where found": the room (AREA or PROPERTY) containing the
-- location, so an item found in "Box 3" in the attic is tagged with the attic.
create or replace function private.found_tag(p_location_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select l.id, l.parent_id, l.kind, l.tag, 0 as depth from public.locations l where l.id = p_location_id
    union all
    select l.id, l.parent_id, l.kind, l.tag, c.depth + 1
      from public.locations l join chain c on l.id = c.parent_id
     where c.depth < 25
  )
  select coalesce(
    (select tag from chain where kind in ('AREA', 'PROPERTY') order by depth limit 1),
    (select tag from chain where depth = 0),
    'XX'
  )
$$;

create or replace function private.approved_status(a public.proposal_action) returns public.item_status
language sql immutable set search_path = '' as $$
  select case a
    when 'ASSIGN' then 'ASSIGNED'
    when 'SELL' then 'APPROVED_FOR_SALE'
    when 'DONATE' then 'APPROVED_FOR_DONATION'
    else 'APPROVED_FOR_DISPOSAL'
  end::public.item_status
$$;

create or replace function private.completed_status(a public.proposal_action) returns public.item_status
language sql immutable set search_path = '' as $$
  select case a
    when 'ASSIGN' then 'DISTRIBUTED'
    when 'SELL' then 'SOLD'
    when 'DONATE' then 'DONATED'
    else 'DISPOSED'
  end::public.item_status
$$;

create or replace function private.set_item_status(p_item_id uuid, p_status public.item_status)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.items
     set status = p_status, version = version + 1, updated_by = auth.uid()
   where id = p_item_id and status <> p_status;
$$;

create or replace function private.manager_count(p_estate_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.estate_members
   where estate_id = p_estate_id and is_active and role in ('ADMINISTRATOR', 'EXECUTOR')
$$;

-- True unless the location (or an ancestor) is a person or an outside place.
create or replace function private.location_on_property(p_location_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select l.id, l.parent_id, l.kind, 0 as depth from public.locations l where l.id = p_location_id
    union all
    select l.id, l.parent_id, l.kind, c.depth + 1
      from public.locations l join chain c on l.id = c.parent_id
     where c.depth < 25
  )
  select p_location_id is null or not exists (select 1 from chain where kind in ('PERSON', 'EXTERNAL'))
$$;

-- The value used for approval thresholds: the most authoritative current
-- valuation. Asking prices and sale proceeds are deliberately excluded.
create or replace function private.item_reference_value(p_item_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select v.amount
    from public.valuations v
   where v.item_id = p_item_id
     and v.valuation_type in ('FORMAL_APPRAISAL', 'DATE_OF_DEATH', 'THIRD_PARTY_ESTIMATE', 'INSURANCE', 'FAMILY_ESTIMATE')
     and not exists (select 1 from public.valuations s where s.supersedes_id = v.id)
   order by case v.valuation_type
              when 'FORMAL_APPRAISAL' then 1
              when 'DATE_OF_DEATH' then 2
              when 'THIRD_PARTY_ESTIMATE' then 3
              when 'INSURANCE' then 4
              else 5
            end,
            v.valuation_date desc, v.created_at desc
   limit 1
$$;

-- A proposal is open until it is rejected/withdrawn, or approved and then
-- completed or cancelled.
create or replace function private.open_proposal_id(p_item_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
    from public.proposals p
    left join public.proposal_outcomes o on o.proposal_id = p.id
   where p.item_id = p_item_id
     and (o.proposal_id is null
          or (o.outcome = 'APPROVED'
              and not exists (select 1 from public.proposal_completions c where c.proposal_id = p.id)
              and not exists (select 1 from public.proposal_cancellations x where x.proposal_id = p.id)))
   order by p.created_at desc
   limit 1
$$;

create or replace function private.open_round(p_item_id uuid) returns public.grab_rounds
language sql stable security definer set search_path = '' as $$
  select r.*
    from public.grab_rounds r
   where r.item_id = p_item_id
     and not exists (select 1 from public.grab_resolutions g where g.round_id = r.id)
   order by r.created_at desc
   limit 1
$$;

-- Active members whose latest choice in the round is INTERESTED, sorted by id
-- (the order matters for verifiable random draws).
create or replace function private.round_interested(p_round_id uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.user_id order by x.user_id), '{}')
    from (
      select distinct on (c.user_id) c.user_id, c.interest
        from public.claims c
        join public.grab_rounds r on r.id = c.round_id
        join public.estate_members m on m.estate_id = r.estate_id and m.user_id = c.user_id and m.is_active
       where c.round_id = p_round_id
       order by c.user_id, c.created_at desc, c.id desc
    ) x
   where x.interest = 'INTERESTED'
$$;

create or replace function private.person_location(p_estate_id uuid, p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
begin
  select id into v_id from public.locations
   where estate_id = p_estate_id and kind = 'PERSON' and person_id = p_user_id and archived_at is null
   order by created_at limit 1;
  if v_id is null then
    select coalesce(nullif(display_name, ''), 'Family member') into v_name from public.profiles where id = p_user_id;
    insert into public.locations (estate_id, name, kind, code, tag, person_id, created_by)
    values (p_estate_id, left(v_name || '''s possession', 120), 'PERSON',
            private.new_location_code(p_estate_id, 'PERSON'), private.derive_location_tag(p_estate_id, v_name),
            p_user_id, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.external_location(p_estate_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.locations
   where estate_id = p_estate_id and kind = 'EXTERNAL' and lower(name) = lower(p_name) and archived_at is null
   order by created_at limit 1;
  if v_id is null then
    insert into public.locations (estate_id, name, kind, code, tag, created_by)
    values (p_estate_id, left(p_name, 120), 'EXTERNAL', private.new_location_code(p_estate_id, 'EXTERNAL'),
            private.derive_location_tag(p_estate_id, p_name), auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.proposal_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(p) - 'sync_xid')
         || jsonb_build_object(
              'outcome', (select to_jsonb(o) - 'sync_xid' from public.proposal_outcomes o where o.proposal_id = p.id),
              'completion', (select to_jsonb(c) - 'sync_xid' from public.proposal_completions c where c.proposal_id = p.id),
              'cancellation', (select to_jsonb(x) - 'sync_xid' from public.proposal_cancellations x where x.proposal_id = p.id),
              'decisions', coalesce((select jsonb_agg(to_jsonb(d) - 'sync_xid' order by d.created_at)
                                       from public.proposal_decisions d where d.proposal_id = p.id), '[]'::jsonb)
            )
    from public.proposals p
   where p.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Approval evaluation
--   EXECUTOR / UNANIMOUS: approved when every eligible approver has approved
--     or abstained (at least one approval); rejected on any rejection.
--   MAJORITY: approved when more than half approve; rejected once that is
--     no longer possible.
-- Only the latest, non-invalidated decision of each still-active eligible
-- approver counts.
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.proposals;
  v_n integer;
  v_app integer;
  v_rej integer;
  v_abs integer;
  v_outcome public.proposal_outcome;
begin
  select * into v_p from public.proposals where id = p_id;
  if exists (select 1 from public.proposal_outcomes where proposal_id = p_id) then
    return;
  end if;

  select count(*) into v_n
    from public.estate_members m
   where m.estate_id = v_p.estate_id and m.is_active and m.user_id = any (v_p.eligible_approvers);

  with eff as (
    select distinct on (d.user_id) d.user_id, d.decision
      from public.proposal_decisions d
     where d.proposal_id = p_id
       and d.user_id = any (v_p.eligible_approvers)
       and not exists (select 1 from public.decision_invalidations i where i.decision_id = d.id)
       and exists (select 1 from public.estate_members m
                    where m.estate_id = v_p.estate_id and m.user_id = d.user_id and m.is_active)
     order by d.user_id, d.created_at desc, d.id desc
  )
  select count(*) filter (where decision = 'APPROVE'),
         count(*) filter (where decision = 'REJECT'),
         count(*) filter (where decision = 'ABSTAIN')
    into v_app, v_rej, v_abs
    from eff;

  if v_n = 0 then
    return;
  end if;

  if v_p.rule in ('EXECUTOR', 'UNANIMOUS') then
    if v_rej > 0 then
      v_outcome := 'REJECTED';
    elsif v_app >= 1 and v_app + v_abs = v_n then
      v_outcome := 'APPROVED';
    end if;
  else
    if v_app * 2 > v_n then
      v_outcome := 'APPROVED';
    elsif (v_n - v_rej - v_abs) * 2 <= v_n then
      v_outcome := 'REJECTED';
    end if;
  end if;

  if v_outcome is null then
    return;
  end if;

  insert into public.proposal_outcomes (proposal_id, estate_id, item_id, outcome, note)
  values (
    p_id, v_p.estate_id, v_p.item_id, v_outcome,
    format('Decided under the %s rule: %s approved, %s rejected, %s abstained, of %s approvers.',
           lower(v_p.rule::text), v_app, v_rej, v_abs, v_n)
  );

  perform private.set_item_status(
    v_p.item_id,
    case when v_outcome = 'APPROVED' then private.approved_status(v_p.action) else 'NEEDS_DECISION'::public.item_status end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Proposal creation (shared by direct proposals and up-for-grabs results).
-- A person never approves a proposal that gives an item to themselves.
-- ---------------------------------------------------------------------------
create or replace function private.create_proposal_internal(
  p_id uuid,
  p_estate_id uuid,
  p_item_id uuid,
  p_action public.proposal_action,
  p_recipient_user_id uuid,
  p_recipient_name text,
  p_amount numeric,
  p_organization text,
  p_reason text,
  p_from_round boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_e public.estates;
  v_item public.items;
  v_ref numeric;
  v_rule public.approval_rule;
  v_auto boolean;
  v_eligible uuid[];
begin
  select * into v_e from public.estates where id = p_estate_id;
  select * into v_item from public.items where id = p_item_id and estate_id = p_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Item not found.');
  end if;
  if v_item.status = any (private.terminal_statuses()) or v_item.status = 'MISSING' then
    perform private.fail('EI409', 'This item has already left the estate or is marked missing.');
  end if;
  if private.open_proposal_id(p_item_id) is not null then
    perform private.fail('EI409', 'This item already has a decision in progress.');
  end if;
  if not p_from_round and (private.open_round(p_item_id)).id is not null then
    perform private.fail('EI409', 'This item is up for grabs. Settle that round first.');
  end if;
  if p_action in ('SELL', 'DONATE', 'RECYCLE', 'DISPOSE') and v_item.do_not_move then
    perform private.fail('EI409', 'This item is marked "Hold in place". An administrator or executor must release the hold first.');
  end if;
  if p_action = 'ASSIGN' and p_recipient_user_id is null and p_recipient_name is null then
    perform private.fail('EI422', 'Choose who receives the item.');
  end if;
  if p_recipient_user_id is not null and not exists (
    select 1 from public.estate_members m
     where m.estate_id = p_estate_id and m.user_id = p_recipient_user_id and m.is_active
  ) then
    perform private.fail('EI422', 'The recipient must be a current member of the estate.');
  end if;

  v_ref := private.item_reference_value(p_item_id);
  v_rule := v_e.approval_rule;
  if v_e.unanimous_above is not null and greatest(v_ref, p_amount) >= v_e.unanimous_above then
    v_rule := 'UNANIMOUS';
  end if;
  -- Auto-approval needs a recorded valuation (never just the proposer's
  -- number) and never applies to items flagged as potentially valuable.
  v_auto := v_e.auto_approve_below is not null
            and v_ref is not null
            and v_ref < v_e.auto_approve_below
            and greatest(v_ref, coalesce(p_amount, 0)) < v_e.auto_approve_below
            and not v_item.potentially_valuable;

  if v_rule = 'EXECUTOR' then
    select coalesce(array_agg(m.user_id order by m.user_id), '{}') into v_eligible
      from public.estate_members m
     where m.estate_id = p_estate_id and m.is_active and m.can_approve and m.role = 'EXECUTOR'
       and m.user_id is distinct from p_recipient_user_id;
    if cardinality(v_eligible) = 0 then
      select coalesce(array_agg(m.user_id order by m.user_id), '{}') into v_eligible
        from public.estate_members m
       where m.estate_id = p_estate_id and m.is_active and m.can_approve and m.role = 'ADMINISTRATOR'
         and m.user_id is distinct from p_recipient_user_id;
    end if;
    if cardinality(v_eligible) = 0 then
      -- Every executor/administrator is the recipient: everyone else decides by majority.
      v_rule := 'MAJORITY';
      select coalesce(array_agg(m.user_id order by m.user_id), '{}') into v_eligible
        from public.estate_members m
       where m.estate_id = p_estate_id and m.is_active and m.can_approve
         and m.user_id is distinct from p_recipient_user_id;
    end if;
  else
    select coalesce(array_agg(m.user_id order by m.user_id), '{}') into v_eligible
      from public.estate_members m
     where m.estate_id = p_estate_id and m.is_active and m.can_approve
       and m.user_id is distinct from p_recipient_user_id;
  end if;

  if cardinality(v_eligible) = 0 and not v_auto then
    perform private.fail('EI422', 'No one else in this estate can approve this. An administrator needs to give someone approval rights.');
  end if;

  insert into public.proposals (
    id, estate_id, item_id, action, recipient_user_id, recipient_name, amount, organization,
    reason, rule, eligible_approvers, auto_approved, requested_by
  ) values (
    p_id, p_estate_id, p_item_id, p_action, p_recipient_user_id, p_recipient_name, p_amount, p_organization,
    p_reason, v_rule, v_eligible, v_auto, v_uid
  );

  if v_auto then
    insert into public.proposal_outcomes (proposal_id, estate_id, item_id, outcome, note)
    values (p_id, p_estate_id, p_item_id, 'APPROVED',
            'Approved automatically: the recorded value is below the estate''s approval threshold.');
    perform private.set_item_status(p_item_id, private.approved_status(p_action));
  else
    perform private.set_item_status(p_item_id, 'APPROVAL_PENDING');
    if v_uid = any (v_eligible) then
      insert into public.proposal_decisions (estate_id, proposal_id, user_id, decision, comment)
      values (p_estate_id, p_id, v_uid, 'APPROVE', 'Proposed this decision.');
    end if;
    perform private.evaluate_proposal(p_id);
  end if;

  return p_id;
end;
$$;

-- =============================================================================
-- API operations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Estates
-- ---------------------------------------------------------------------------
create or replace function private.api_create_estate(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
  v_role public.member_role := coalesce(private.jt(p, 'creator_role'), 'ADMINISTRATOR')::public.member_role;
  v_def jsonb := private.role_defaults(v_role);
  v_existing public.estates;
  v_house uuid;
  v_holding uuid;
begin
  if v_uid is null then
    perform private.fail('EI401', 'Please sign in.');
  end if;
  if v_role not in ('ADMINISTRATOR', 'EXECUTOR') then
    perform private.fail('EI422', 'The person creating an estate must be its administrator or executor.');
  end if;
  if private.jt(p, 'name') is null then
    perform private.fail('EI422', 'Give the estate a name.');
  end if;

  select * into v_existing from public.estates where id = v_id;
  if found then
    if v_existing.created_by <> v_uid then
      perform private.fail('EI409', 'That estate ID is already in use.');
    end if;
    return private.row_json(v_existing);
  end if;

  insert into public.estates (
    id, name, decedent_name, date_of_death, case_reference, approval_rule, auto_approve_below,
    unanimous_above, claim_mode, sealed_window_hours, help_contact_name, help_contact_phone,
    retention_years, created_by
  ) values (
    v_id, private.jt(p, 'name'), private.jt(p, 'decedent_name'), private.jd(p, 'date_of_death'),
    private.jt(p, 'case_reference'),
    coalesce(private.jt(p, 'approval_rule'), 'EXECUTOR')::public.approval_rule,
    private.jn(p, 'auto_approve_below'), private.jn(p, 'unanimous_above'),
    coalesce(private.jt(p, 'claim_mode'), 'SEALED')::public.claim_mode,
    coalesce(private.ji(p, 'sealed_window_hours'), 72),
    private.jt(p, 'help_contact_name'), private.jt(p, 'help_contact_phone'),
    coalesce(private.ji(p, 'retention_years'), 7), v_uid
  );

  insert into public.estate_members (
    estate_id, user_id, role, can_add_items, can_edit_items, can_propose, can_approve, can_export, invited_by
  ) values (
    v_id, v_uid, v_role, (v_def ->> 'can_add_items')::boolean, (v_def ->> 'can_edit_items')::boolean,
    (v_def ->> 'can_propose')::boolean, (v_def ->> 'can_approve')::boolean, (v_def ->> 'can_export')::boolean, v_uid
  );

  insert into public.locations (estate_id, name, kind, code, tag, created_by)
  values (v_id, coalesce(private.jt(p, 'property_name'), 'The house'), 'PROPERTY',
          private.new_location_code(v_id, 'PROPERTY'),
          private.derive_location_tag(v_id, coalesce(private.jt(p, 'property_name'), 'House')), v_uid)
  returning id into v_house;

  -- Scanned items land here until someone puts them away.
  insert into public.locations (estate_id, parent_id, name, kind, code, tag, purpose, created_by)
  values (v_id, v_house, 'Holding area', 'HOLDING', private.new_location_code(v_id, 'HOLDING'),
          private.derive_location_tag(v_id, 'Holding area'), 'Items wait here until they are put away.', v_uid)
  returning id into v_holding;

  update public.estates set default_location_id = v_holding where id = v_id;

  return (select private.row_json(e) from public.estates e where e.id = v_id);
end;
$$;

create or replace function private.api_update_estate(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  c jsonb := coalesce(p -> 'changes', '{}'::jsonb);
  v_e public.estates;
begin
  perform private.require_member(v_estate_id, 'manage');
  if private.ji(p, 'version') is null then
    perform private.fail('EI422', 'version is required.');
  end if;
  select * into v_e from public.estates where id = v_estate_id for update;
  if private.ji(p, 'version') <> v_e.version then
    perform private.fail('EI409', 'Someone else changed these settings. Review the latest version and try again.',
                         jsonb_build_object('current', private.row_json(v_e)));
  end if;

  update public.estates set
    name = case when c ? 'name' then coalesce(private.jt(c, 'name'), name) else name end,
    decedent_name = case when c ? 'decedent_name' then private.jt(c, 'decedent_name') else decedent_name end,
    date_of_death = case when c ? 'date_of_death' then private.jd(c, 'date_of_death') else date_of_death end,
    case_reference = case when c ? 'case_reference' then private.jt(c, 'case_reference') else case_reference end,
    approval_rule = case when c ? 'approval_rule' then coalesce(private.jt(c, 'approval_rule')::public.approval_rule, approval_rule) else approval_rule end,
    auto_approve_below = case when c ? 'auto_approve_below' then private.jn(c, 'auto_approve_below') else auto_approve_below end,
    unanimous_above = case when c ? 'unanimous_above' then private.jn(c, 'unanimous_above') else unanimous_above end,
    claim_mode = case when c ? 'claim_mode' then coalesce(private.jt(c, 'claim_mode')::public.claim_mode, claim_mode) else claim_mode end,
    sealed_window_hours = case when c ? 'sealed_window_hours' then coalesce(private.ji(c, 'sealed_window_hours'), sealed_window_hours) else sealed_window_hours end,
    help_contact_name = case when c ? 'help_contact_name' then private.jt(c, 'help_contact_name') else help_contact_name end,
    help_contact_phone = case when c ? 'help_contact_phone' then private.jt(c, 'help_contact_phone') else help_contact_phone end,
    retention_years = case when c ? 'retention_years' then coalesce(private.ji(c, 'retention_years'), retention_years) else retention_years end,
    default_location_id = case when c ? 'default_location_id' then private.ju(c, 'default_location_id') else default_location_id end,
    version = version + 1
  where id = v_estate_id
  returning * into v_e;

  return private.row_json(v_e);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations and membership
-- ---------------------------------------------------------------------------
create or replace function private.api_create_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_email text := lower(private.jt(p, 'email'));
  v_role public.member_role := coalesce(private.jt(p, 'role'), 'FAMILY_MEMBER')::public.member_role;
  v_code text;
  v_invite public.estate_invites;
begin
  perform private.require_member(v_estate_id, 'manage');
  if v_role = 'ADMINISTRATOR' then
    perform private.require_member(v_estate_id, 'admin');
  end if;
  if v_email is null or position('@' in v_email) < 2 then
    perform private.fail('EI422', 'Enter the person''s email address.');
  end if;
  v_code := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  insert into public.estate_invites (estate_id, email, role, code_hash, invited_by)
  values (v_estate_id, v_email, v_role,
          encode(extensions.digest(convert_to(v_code, 'UTF8'), 'sha256'), 'hex'), auth.uid())
  returning * into v_invite;
  return jsonb_build_object('invite', private.row_json(v_invite) - 'code_hash', 'code', v_code);
end;
$$;

create or replace function private.api_revoke_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_invite public.estate_invites;
begin
  perform private.require_member(v_estate_id, 'manage');
  select * into v_invite from public.estate_invites
   where id = private.ju(p, 'invite_id') and estate_id = v_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Invitation not found.');
  end if;
  if v_invite.accepted_at is not null then
    perform private.fail('EI409', 'This invitation was already accepted. Remove the member instead.');
  end if;
  if v_invite.revoked_at is null then
    update public.estate_invites set revoked_at = now(), revoked_by = auth.uid()
     where id = v_invite.id returning * into v_invite;
  end if;
  return private.row_json(v_invite) - 'code_hash';
end;
$$;

create or replace function private.api_accept_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := regexp_replace(upper(coalesce(p ->> 'code', '')), '[^0-9A-F]', '', 'g');
  v_inv public.estate_invites;
  v_email text;
  v_def jsonb;
  v_member public.estate_members;
begin
  if v_uid is null then
    perform private.fail('EI401', 'Please sign in.');
  end if;
  select * into v_inv from public.estate_invites
   where code_hash = encode(extensions.digest(convert_to(v_code, 'UTF8'), 'sha256'), 'hex')
   for update;
  if not found then
    perform private.fail('EI404', 'That invitation code was not found. Check it and try again.');
  end if;
  if v_inv.revoked_at is not null then
    perform private.fail('EI409', 'This invitation was cancelled. Ask for a new one.');
  end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_uid then
      return (select private.row_json(e) from public.estates e where e.id = v_inv.estate_id);
    end if;
    perform private.fail('EI409', 'This invitation has already been used.');
  end if;
  if v_inv.expires_at < now() then
    perform private.fail('EI409', 'This invitation has expired. Ask for a new one.');
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from lower(v_inv.email) then
    perform private.fail('EI403', 'This invitation was sent to a different email address. Sign in with the address it was sent to.');
  end if;

  v_def := private.role_defaults(v_inv.role);
  select * into v_member from public.estate_members
   where estate_id = v_inv.estate_id and user_id = v_uid for update;
  if not found then
    insert into public.estate_members (
      estate_id, user_id, role, can_add_items, can_edit_items, can_propose, can_approve, can_export, invited_by
    ) values (
      v_inv.estate_id, v_uid, v_inv.role, (v_def ->> 'can_add_items')::boolean, (v_def ->> 'can_edit_items')::boolean,
      (v_def ->> 'can_propose')::boolean, (v_def ->> 'can_approve')::boolean, (v_def ->> 'can_export')::boolean,
      v_inv.invited_by
    );
  elsif not v_member.is_active then
    update public.estate_members set
      is_active = true, role = v_inv.role,
      can_add_items = (v_def ->> 'can_add_items')::boolean, can_edit_items = (v_def ->> 'can_edit_items')::boolean,
      can_propose = (v_def ->> 'can_propose')::boolean, can_approve = (v_def ->> 'can_approve')::boolean,
      can_export = (v_def ->> 'can_export')::boolean,
      removed_at = null, removed_by = null, removal_reason = null, invited_by = v_inv.invited_by
    where estate_id = v_inv.estate_id and user_id = v_uid;
  end if;

  update public.estate_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return (select private.row_json(e) from public.estates e where e.id = v_inv.estate_id);
end;
$$;

create or replace function private.api_update_member(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_user_id uuid := private.ju(p, 'user_id');
  c jsonb := coalesce(p -> 'changes', '{}'::jsonb);
  v_target public.estate_members;
  v_role public.member_role;
  v_def jsonb;
  v_code text;
begin
  -- Members may change their own code; everything else needs a manager.
  if v_user_id = auth.uid() and (c - 'member_code') = '{}'::jsonb then
    perform private.require_member(v_estate_id);
  else
    perform private.require_member(v_estate_id, 'manage');
  end if;
  select * into v_target from public.estate_members
   where estate_id = v_estate_id and user_id = v_user_id for update;
  if not found then
    perform private.fail('EI404', 'Member not found.');
  end if;
  v_role := coalesce(private.jt(c, 'role')::public.member_role, v_target.role);
  if v_target.role in ('ADMINISTRATOR', 'EXECUTOR') and v_role not in ('ADMINISTRATOR', 'EXECUTOR')
     and v_target.is_active and private.manager_count(v_estate_id) <= 1 then
    perform private.fail('EI409', 'Every estate needs at least one administrator or executor.');
  end if;
  if v_role = 'ADMINISTRATOR' and v_target.role <> 'ADMINISTRATOR' then
    perform private.require_member(v_estate_id, 'admin');
  end if;
  v_def := case when c ? 'role' then private.role_defaults(v_role) else '{}'::jsonb end;
  if c ? 'member_code' then
    v_code := upper(private.jt(c, 'member_code'));
    if v_code is null or v_code !~ '^[A-Z]{2}$' then
      perform private.fail('EI422', 'A member code is exactly 2 letters.');
    end if;
    if exists (select 1 from public.estate_members m
                where m.estate_id = v_estate_id and m.member_code = v_code and m.user_id <> v_user_id) then
      perform private.fail('EI409', format('The code %s is already used by another member.', v_code));
    end if;
  end if;

  update public.estate_members set
    role = v_role,
    member_code = coalesce(v_code, member_code),
    can_add_items  = coalesce(private.jb(c, 'can_add_items'),  (v_def ->> 'can_add_items')::boolean,  can_add_items),
    can_edit_items = coalesce(private.jb(c, 'can_edit_items'), (v_def ->> 'can_edit_items')::boolean, can_edit_items),
    can_propose    = coalesce(private.jb(c, 'can_propose'),    (v_def ->> 'can_propose')::boolean,    can_propose),
    can_approve    = coalesce(private.jb(c, 'can_approve'),    (v_def ->> 'can_approve')::boolean,    can_approve),
    can_export     = coalesce(private.jb(c, 'can_export'),     (v_def ->> 'can_export')::boolean,     can_export)
  where estate_id = v_estate_id and user_id = v_user_id
  returning * into v_target;
  return private.row_json(v_target);
end;
$$;

create or replace function private.api_remove_member(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_user_id uuid := private.ju(p, 'user_id');
  v_reason text := private.jt(p, 'reason');
  v_target public.estate_members;
begin
  if v_user_id = auth.uid() then
    perform private.require_member(v_estate_id);
  else
    perform private.require_member(v_estate_id, 'manage');
  end if;
  if v_reason is null then
    perform private.fail('EI422', 'Record a reason for the removal.');
  end if;
  select * into v_target from public.estate_members
   where estate_id = v_estate_id and user_id = v_user_id for update;
  if not found or not v_target.is_active then
    perform private.fail('EI404', 'Active member not found.');
  end if;
  if v_target.role in ('ADMINISTRATOR', 'EXECUTOR') and private.manager_count(v_estate_id) <= 1 then
    perform private.fail('EI409', 'Every estate needs at least one administrator or executor.');
  end if;
  update public.estate_members set
    is_active = false, removed_at = now(), removed_by = auth.uid(), removal_reason = v_reason
  where estate_id = v_estate_id and user_id = v_user_id
  returning * into v_target;
  return private.row_json(v_target);
end;
$$;

create or replace function private.api_update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.fail('EI401', 'Please sign in.');
  end if;
  update public.profiles set
    display_name = case when p ? 'display_name' then coalesce(private.jt(p, 'display_name'), display_name) else display_name end,
    phone = case when p ? 'phone' then private.jt(p, 'phone') else phone end,
    large_text = coalesce(private.jb(p, 'large_text'), large_text),
    simplified_mode = coalesce(private.jb(p, 'simplified_mode'), simplified_mode)
  where id = auth.uid()
  returning * into v_profile;
  return private.row_json(v_profile);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory numbers
-- ---------------------------------------------------------------------------
create or replace function private.api_reserve_numbers(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_device text := private.jt(p, 'device_id');
  v_count integer := least(greatest(coalesce(private.ji(p, 'count'), 20), 1), 50);
  v_first integer;
  v_res public.number_reservations;
begin
  perform private.require_member(v_estate_id, 'add');
  if v_device is null then
    perform private.fail('EI422', 'device_id is required.');
  end if;
  update public.estates
     set next_inventory_number = next_inventory_number + v_count
   where id = v_estate_id
  returning next_inventory_number - v_count into v_first;
  insert into public.number_reservations (estate_id, user_id, device_id, first_number, last_number)
  values (v_estate_id, auth.uid(), v_device, v_first, v_first + v_count - 1)
  returning * into v_res;
  return private.row_json(v_res);
end;
$$;

create or replace function private.api_void_numbers(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_reason text := coalesce(private.jt(p, 'reason'), 'Reserved by a device but not used.');
  v_res public.number_reservations;
  v_n integer;
  v_voided integer[] := '{}';
begin
  perform private.require_member(v_estate_id);
  select * into v_res from public.number_reservations
   where id = private.ju(p, 'reservation_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Reservation not found.');
  end if;
  if v_res.user_id <> auth.uid() and not private.is_manager(v_estate_id) then
    perform private.fail('EI403', 'Only the person who reserved these numbers can void them.');
  end if;
  for v_n in select unnest(private.jarr(p, 'numbers'))::integer loop
    if v_n < v_res.first_number or v_n > v_res.last_number then
      perform private.fail('EI422', format('Number %s is not part of this reservation.', v_n));
    end if;
    if exists (select 1 from public.items i where i.estate_id = v_estate_id and i.inventory_number = v_n) then
      continue;
    end if;
    insert into public.number_voids (estate_id, inventory_number, reservation_id, voided_by, reason)
    values (v_estate_id, v_n, v_res.id, auth.uid(), v_reason)
    on conflict (estate_id, inventory_number) do nothing;
    v_voided := v_voided || v_n;
  end loop;
  return jsonb_build_object('voided', to_jsonb(v_voided));
end;
$$;

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create or replace function private.api_create_location(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
  v_loc public.locations;
  v_kind public.location_kind;
  v_code text;
  v_tag text;
begin
  perform private.require_member(v_estate_id, 'add');
  select * into v_loc from public.locations where id = v_id;
  if found then
    if v_loc.estate_id <> v_estate_id then
      perform private.fail('EI409', 'That location ID is already in use.');
    end if;
    return private.row_json(v_loc);
  end if;
  if private.jt(p, 'name') is null then
    perform private.fail('EI422', 'Give the location a name.');
  end if;
  v_kind := coalesce(private.jt(p, 'kind'), 'AREA')::public.location_kind;
  v_code := upper(private.jt(p, 'code'));
  v_tag := upper(private.jt(p, 'tag'));
  if v_code is null then
    v_code := private.new_location_code(v_estate_id, v_kind);
  elsif not private.valid_location_code(v_code, v_kind) then
    perform private.fail('EI422', format('Location code %s is not valid for this kind of place.', v_code));
  elsif exists (select 1 from public.locations l where l.estate_id = v_estate_id and l.code = v_code) then
    -- Two offline devices drew the same random code: issue a fresh one.
    v_code := private.new_location_code(v_estate_id, v_kind);
  end if;
  if v_tag is null then
    v_tag := private.derive_location_tag(v_estate_id, private.jt(p, 'name'));
  elsif v_tag !~ '^[A-Z0-9]{2}$' then
    perform private.fail('EI422', 'A room tag is 2 letters or digits.');
  end if;
  insert into public.locations (id, estate_id, parent_id, name, kind, code, tag, purpose, person_id, created_by)
  values (v_id, v_estate_id, private.ju(p, 'parent_id'), private.jt(p, 'name'), v_kind, v_code, v_tag,
          private.jt(p, 'purpose'), private.ju(p, 'person_id'), auth.uid())
  returning * into v_loc;
  return private.row_json(v_loc);
end;
$$;

create or replace function private.api_update_location(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_loc public.locations;
begin
  perform private.require_member(v_estate_id, 'edit');
  select * into v_loc from public.locations
   where id = private.ju(p, 'location_id') and estate_id = v_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Location not found.');
  end if;
  update public.locations set
    name = case when p ? 'name' then coalesce(private.jt(p, 'name'), name) else name end,
    parent_id = case when p ? 'parent_id' then private.ju(p, 'parent_id') else parent_id end,
    purpose = case when p ? 'purpose' then private.jt(p, 'purpose') else purpose end,
    tag = case when p ? 'tag' and upper(private.jt(p, 'tag')) ~ '^[A-Z0-9]{2}$' then upper(private.jt(p, 'tag')) else tag end,
    archived_at = case
      when p ? 'archived' and private.jb(p, 'archived') then coalesce(archived_at, now())
      when p ? 'archived' then null
      else archived_at end
  where id = v_loc.id
  returning * into v_loc;
  return private.row_json(v_loc);
end;
$$;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
create or replace function private.api_create_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := private.ju(p, 'id');
  v_num integer := private.ji(p, 'inventory_number');
  v_status public.item_status := coalesce(private.jt(p, 'status'), 'DISCOVERED')::public.item_status;
  -- found_location_id: the room where it was found (in the code).
  -- location_id: where it is being put now (box, staging area, holding area).
  v_found uuid := coalesce(private.ju(p, 'found_location_id'), private.ju(p, 'location_id'));
  v_loc uuid := coalesce(private.ju(p, 'location_id'), private.ju(p, 'found_location_id'));
  v_category text := upper(coalesce(private.jt(p, 'category'), 'MSC'));
  v_code text := upper(private.jt(p, 'item_code'));
  v_member_code text;
  v_num_text text;
  v_check jsonb;
  v_item public.items;
begin
  perform private.require_member(v_estate_id, 'add');
  if v_id is null then
    perform private.fail('EI422', 'id is required (the device generates it).');
  end if;

  select * into v_item from public.items where id = v_id;
  if found then
    if v_item.estate_id = v_estate_id and v_item.created_by = v_uid then
      return private.row_json(v_item);
    end if;
    perform private.fail('EI409', 'An item with this ID already exists.');
  end if;

  if private.jt(p, 'title') is null then
    perform private.fail('EI422', 'Add a short description.');
  end if;
  if v_num is null then
    perform private.fail('EI422', 'inventory_number is required.');
  end if;
  if not exists (
    select 1 from public.number_reservations r
     where r.estate_id = v_estate_id and r.user_id = v_uid and v_num between r.first_number and r.last_number
  ) then
    perform private.fail('EI422', format('Inventory number %s is not reserved by you. Sync to get new numbers.', v_num));
  end if;
  if exists (select 1 from public.number_voids nv where nv.estate_id = v_estate_id and nv.inventory_number = v_num) then
    perform private.fail('EI409', format('Inventory number %s was voided and cannot be used.', v_num));
  end if;
  if exists (select 1 from public.items i where i.estate_id = v_estate_id and i.inventory_number = v_num) then
    perform private.fail('EI409', format('Inventory number %s is already used by another item.', v_num));
  end if;
  if not (v_status = any (private.manual_statuses())) then
    perform private.fail('EI422', 'A new item can only start as Discovered, Needs identification, Needs valuation, Needs a decision, or On hold.');
  end if;

  if v_category is null or not (v_category = any (private.category_codes())) then
    perform private.fail('EI422', 'Choose a category from the list (MSC if unsure).');
  end if;
  select member_code into v_member_code from public.estate_members
   where estate_id = v_estate_id and user_id = v_uid;
  v_num_text := case when length(v_num::text) >= 4 then v_num::text else lpad(v_num::text, 4, '0') end;
  if v_code is null then
    v_code := private.new_item_code(v_num, v_member_code, private.found_tag(v_found), v_category);
  elsif not private.valid_item_code(v_code) then
    perform private.fail('EI422', format('Item code %s has an invalid format or check digit.', v_code));
  elsif left(split_part(v_code, '-', 1), -2) <> v_num_text
        or right(split_part(v_code, '-', 1), 2) <> v_member_code
        or right(split_part(v_code, '-', 2), 3) <> v_category then
    perform private.fail('EI422', format('Item code %s does not match the item number, its creator, or its category.', v_code));
  end if;

  if v_loc is null then
    select default_location_id into v_loc from public.estates where id = v_estate_id;
  end if;

  insert into public.items (
    id, estate_id, inventory_number, item_code, title, description, category, quantity, condition, barcode,
    barcode_format, brand, model, serial_number, dimensions, weight, markings, provenance, notes,
    original_location_id, current_location_id, status, potentially_valuable, do_not_move,
    do_not_move_reason, device_id, captured_at, created_by, updated_by
  ) values (
    v_id, v_estate_id, v_num, v_code, private.jt(p, 'title'), private.jt(p, 'description'), v_category,
    coalesce(private.ji(p, 'quantity'), 1), private.jt(p, 'condition'), private.jt(p, 'barcode'),
    private.jt(p, 'barcode_format'), private.jt(p, 'brand'), private.jt(p, 'model'), private.jt(p, 'serial_number'),
    private.jt(p, 'dimensions'), private.jt(p, 'weight'), private.jt(p, 'markings'), private.jt(p, 'provenance'),
    private.jt(p, 'notes'), v_found, v_loc, v_status, coalesce(private.jb(p, 'potentially_valuable'), false),
    coalesce(private.jb(p, 'do_not_move'), false), private.jt(p, 'do_not_move_reason'),
    private.jt(p, 'device_id'), private.jts(p, 'captured_at'), v_uid, v_uid
  )
  returning * into v_item;

  -- Duplicate checks the person answered on the device ("another one" or "not sure").
  for v_check in select * from jsonb_array_elements(coalesce(p -> 'duplicate_checks', '[]'::jsonb)) loop
    if private.jt(v_check, 'verdict') not in ('DIFFERENT_ITEMS', 'UNSURE') then
      perform private.fail('EI422', 'At creation a duplicate check can only be "different items" or "not sure".');
    end if;
    insert into public.duplicate_reviews (id, estate_id, item_id, other_item_id, verdict, reasons, note, decided_by)
    values (
      coalesce(private.ju(v_check, 'id'), gen_random_uuid()), v_estate_id, v_id, private.ju(v_check, 'other_item_id'),
      private.jt(v_check, 'verdict')::public.duplicate_verdict,
      private.jarr(v_check, 'reasons'),
      private.jt(v_check, 'note'), v_uid
    );
  end loop;

  return private.row_json(v_item);
end;
$$;

create or replace function private.api_update_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  c jsonb := coalesce(p -> 'changes', '{}'::jsonb);
  v_m public.estate_members;
  v_item public.items;
  v_status public.item_status;
  v_release boolean := c ? 'do_not_move' and not coalesce(private.jb(c, 'do_not_move'), false);
  v_hold boolean := coalesce(private.jb(c, 'do_not_move'), false);
  v_verify boolean := coalesce(private.jb(c, 'mark_verified'), false);
  v_moved boolean;
begin
  v_m := private.require_member(v_estate_id, 'edit');
  select * into v_item from public.items
   where id = private.ju(p, 'item_id') and estate_id = v_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Item not found.');
  end if;
  if v_item.status = 'MERGED' then
    perform private.fail('EI409', 'This record was merged into another item. Edit that item instead.');
  end if;
  if private.ji(p, 'version') is null then
    perform private.fail('EI422', 'version is required.');
  end if;
  if private.ji(p, 'version') <> v_item.version then
    perform private.fail('EI409', 'Someone else updated this item while you were editing it. Review their changes and try again.',
                         jsonb_build_object('current', private.row_json(v_item)));
  end if;

  if c ? 'status' then
    v_status := private.jt(c, 'status')::public.item_status;
    if not (v_status = any (private.manual_statuses())) or not (v_item.status = any (private.manual_statuses())) then
      perform private.fail('EI409', 'This item is part of a decision or handoff, so its status changes through that process.');
    end if;
  end if;
  if v_release and v_item.do_not_move and v_m.role not in ('ADMINISTRATOR', 'EXECUTOR') then
    perform private.fail('EI403', 'Only an administrator or executor can release a hold.');
  end if;
  if v_hold and coalesce(private.jt(c, 'do_not_move_reason'), v_item.do_not_move_reason) is null then
    perform private.fail('EI422', 'Say why this item should be held in place.');
  end if;

  v_moved := exists (select 1 from public.custody_events ce where ce.item_id = v_item.id);

  update public.items set
    title = case when c ? 'title' then coalesce(private.jt(c, 'title'), title) else title end,
    description = case when c ? 'description' then private.jt(c, 'description') else description end,
    category = case when c ? 'category' and upper(private.jt(c, 'category')) = any (private.category_codes())
                    then upper(private.jt(c, 'category')) else category end,
    quantity = case when c ? 'quantity' then coalesce(private.ji(c, 'quantity'), quantity) else quantity end,
    condition = case when c ? 'condition' then private.jt(c, 'condition') else condition end,
    barcode = case when c ? 'barcode' then private.jt(c, 'barcode') else barcode end,
    barcode_format = case when c ? 'barcode_format' then private.jt(c, 'barcode_format') else barcode_format end,
    brand = case when c ? 'brand' then private.jt(c, 'brand') else brand end,
    model = case when c ? 'model' then private.jt(c, 'model') else model end,
    serial_number = case when c ? 'serial_number' then private.jt(c, 'serial_number') else serial_number end,
    dimensions = case when c ? 'dimensions' then private.jt(c, 'dimensions') else dimensions end,
    weight = case when c ? 'weight' then private.jt(c, 'weight') else weight end,
    markings = case when c ? 'markings' then private.jt(c, 'markings') else markings end,
    provenance = case when c ? 'provenance' then private.jt(c, 'provenance') else provenance end,
    notes = case when c ? 'notes' then private.jt(c, 'notes') else notes end,
    original_location_id = case when c ? 'original_location_id' then private.ju(c, 'original_location_id') else original_location_id end,
    -- Correcting where an item was found also corrects where it is, as long as it has never been moved.
    current_location_id = case when c ? 'original_location_id' and not v_moved then private.ju(c, 'original_location_id') else current_location_id end,
    status = coalesce(v_status, status),
    potentially_valuable = case when c ? 'potentially_valuable' then coalesce(private.jb(c, 'potentially_valuable'), false) else potentially_valuable end,
    do_not_move = case when c ? 'do_not_move' then v_hold else do_not_move end,
    do_not_move_reason = case
      when v_release then null
      when c ? 'do_not_move_reason' then private.jt(c, 'do_not_move_reason')
      else do_not_move_reason end,
    physically_verified_at = case when v_verify then now() else physically_verified_at end,
    physically_verified_by = case when v_verify then auth.uid() else physically_verified_by end,
    version = version + 1,
    updated_by = auth.uid()
  where id = v_item.id
  returning * into v_item;

  return private.row_json(v_item);
end;
$$;

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------
create or replace function private.media_ext(p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case p_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'application/pdf' then 'pdf'
  end
$$;

create or replace function private.api_register_media(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := private.ju(p, 'id');
  v_sha text := lower(private.jt(p, 'sha256'));
  v_mime text := private.jt(p, 'mime_type');
  v_thumb text := lower(private.jt(p, 'thumb_sha256'));
  v_ext text := private.media_ext(private.jt(p, 'mime_type'));
  v_path text;
  v_thumb_path text;
  v_m public.estate_members;
  v_media public.media;
begin
  v_m := private.require_member(v_estate_id);
  if not (v_m.can_add_items or v_m.can_edit_items) then
    perform private.fail('EI403', 'Your role in this estate does not allow adding photos.');
  end if;
  if v_id is null then
    perform private.fail('EI422', 'id is required.');
  end if;
  select * into v_media from public.media where id = v_id;
  if found then
    if v_media.estate_id = v_estate_id and v_media.uploaded_by = auth.uid() then
      return private.row_json(v_media);
    end if;
    perform private.fail('EI409', 'A file with this ID already exists.');
  end if;
  if v_ext is null then
    perform private.fail('EI422', 'Unsupported file type.');
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    perform private.fail('EI422', 'sha256 must be 64 hex characters.');
  end if;

  v_path := v_estate_id::text || '/' || v_sha || '.' || v_ext;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'estate-media' and o.name = v_path) then
    perform private.fail('EI422', 'Upload the file before registering it.', jsonb_build_object('path', v_path));
  end if;
  if v_thumb is not null then
    if v_thumb !~ '^[0-9a-f]{64}$' then
      perform private.fail('EI422', 'thumb_sha256 must be 64 hex characters.');
    end if;
    v_thumb_path := v_estate_id::text || '/' || v_thumb || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'estate-media' and o.name = v_thumb_path) then
      perform private.fail('EI422', 'Upload the thumbnail before registering it.', jsonb_build_object('path', v_thumb_path));
    end if;
  end if;

  insert into public.media (
    id, estate_id, item_id, kind, sha256, storage_path, thumb_sha256, thumb_path, mime_type,
    byte_size, width, height, caption, captured_at, uploaded_by
  ) values (
    v_id, v_estate_id, private.ju(p, 'item_id'), coalesce(private.jt(p, 'kind'), 'FULL_ITEM')::public.media_kind,
    v_sha, v_path, v_thumb, v_thumb_path, v_mime, private.ji(p, 'byte_size'), private.ji(p, 'width'),
    private.ji(p, 'height'), private.jt(p, 'caption'), private.jts(p, 'captured_at'), auth.uid()
  )
  returning * into v_media;
  return private.row_json(v_media);
end;
$$;

create or replace function private.api_redact_media(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_m public.estate_members;
  v_media public.media;
  v_red public.redactions;
begin
  v_m := private.require_member(v_estate_id);
  select * into v_media from public.media where id = private.ju(p, 'media_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'File not found.');
  end if;
  if v_media.uploaded_by <> auth.uid() and v_m.role not in ('ADMINISTRATOR', 'EXECUTOR') then
    perform private.fail('EI403', 'Only the person who added this file, or an administrator, can hide it.');
  end if;
  select * into v_red from public.redactions where media_id = v_media.id;
  if found then
    return private.row_json(v_red);
  end if;
  if private.jt(p, 'reason') is null then
    perform private.fail('EI422', 'Record why this file is being hidden.');
  end if;
  insert into public.redactions (estate_id, media_id, reason, redacted_by)
  values (v_estate_id, v_media.id, private.jt(p, 'reason'), auth.uid())
  returning * into v_red;
  return private.row_json(v_red);
end;
$$;

-- ---------------------------------------------------------------------------
-- Valuations
-- ---------------------------------------------------------------------------
create or replace function private.api_add_valuation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
  v_item_id uuid := private.ju(p, 'item_id');
  v_sup uuid := private.ju(p, 'supersedes_id');
  v_m public.estate_members;
  v_val public.valuations;
begin
  v_m := private.require_member(v_estate_id);
  if not (v_m.can_edit_items or v_m.role = 'APPRAISER') then
    perform private.fail('EI403', 'Your role in this estate does not allow adding values.');
  end if;
  select * into v_val from public.valuations where id = v_id;
  if found then
    if v_val.estate_id = v_estate_id and v_val.entered_by = auth.uid() then
      return private.row_json(v_val);
    end if;
    perform private.fail('EI409', 'A valuation with this ID already exists.');
  end if;
  if private.jt(p, 'valuation_type') is null or private.jn(p, 'amount') is null then
    perform private.fail('EI422', 'Choose the kind of value and enter an amount.');
  end if;
  if v_sup is not null and not exists (select 1 from public.valuations s where s.id = v_sup and s.item_id = v_item_id) then
    perform private.fail('EI422', 'The value being corrected belongs to a different item.');
  end if;
  insert into public.valuations (
    id, estate_id, item_id, valuation_type, amount, currency, valuation_date, source, appraiser_name,
    comparable_url, notes, attachment_media_id, supersedes_id, entered_by
  ) values (
    v_id, v_estate_id, v_item_id, private.jt(p, 'valuation_type')::public.valuation_type, private.jn(p, 'amount'),
    coalesce(private.jt(p, 'currency'), 'USD'), coalesce(private.jd(p, 'valuation_date'), current_date),
    private.jt(p, 'source'), private.jt(p, 'appraiser_name'), private.jt(p, 'comparable_url'), private.jt(p, 'notes'),
    private.ju(p, 'attachment_media_id'), v_sup, auth.uid()
  )
  returning * into v_val;
  return private.row_json(v_val);
end;
$$;

-- ---------------------------------------------------------------------------
-- Up for grabs
-- ---------------------------------------------------------------------------
create or replace function private.api_open_round(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
  v_e public.estates;
  v_item public.items;
  v_round public.grab_rounds;
begin
  perform private.require_member(v_estate_id, 'propose');
  select * into v_round from public.grab_rounds where id = v_id;
  if found then
    return private.row_json(v_round);
  end if;
  select * into v_item from public.items
   where id = private.ju(p, 'item_id') and estate_id = v_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Item not found.');
  end if;
  if v_item.status = any (private.terminal_statuses()) or v_item.status = 'MISSING' then
    perform private.fail('EI409', 'This item has already left the estate or is marked missing.');
  end if;
  if (private.open_round(v_item.id)).id is not null then
    perform private.fail('EI409', 'This item is already up for grabs.');
  end if;
  if private.open_proposal_id(v_item.id) is not null then
    perform private.fail('EI409', 'This item has a decision in progress.');
  end if;
  select * into v_e from public.estates where id = v_estate_id;
  insert into public.grab_rounds (id, estate_id, item_id, mode, reveal_at, note, opened_by)
  values (
    v_id, v_estate_id, v_item.id, v_e.claim_mode,
    case when v_e.claim_mode = 'SEALED' then now() + make_interval(hours => v_e.sealed_window_hours) end,
    private.jt(p, 'note'), auth.uid()
  )
  returning * into v_round;
  perform private.set_item_status(v_item.id, 'UP_FOR_GRABS');
  return private.row_json(v_round);
end;
$$;

create or replace function private.api_set_claim(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_item_id uuid := private.ju(p, 'item_id');
  v_id uuid := private.ju(p, 'id');
  v_interest public.interest := private.jt(p, 'interest')::public.interest;
  v_m public.estate_members;
  v_round public.grab_rounds;
  v_claim public.claims;
begin
  v_m := private.require_member(v_estate_id);
  if v_m.role in ('VIEW_ONLY', 'APPRAISER') then
    perform private.fail('EI403', 'Your role in this estate does not include claiming items.');
  end if;
  if v_id is null or v_interest is null then
    perform private.fail('EI422', 'id and interest are required.');
  end if;
  select * into v_claim from public.claims where id = v_id;
  if found then
    if v_claim.user_id = auth.uid() then
      return private.row_json(v_claim);
    end if;
    perform private.fail('EI409', 'A claim with this ID already exists.');
  end if;

  v_round := private.open_round(v_item_id);
  if v_round.id is null or v_round.estate_id <> v_estate_id then
    perform private.fail('EI409', 'This item is not up for grabs right now.');
  end if;
  if v_round.mode = 'SEALED' and now() >= v_round.reveal_at then
    perform private.fail('EI409', format('Choices for this item closed at %s UTC. Choices count when they reach the server.',
                                         to_char(v_round.reveal_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')));
  end if;

  insert into public.claims (id, estate_id, round_id, item_id, user_id, interest, note)
  values (v_id, v_estate_id, v_round.id, v_item_id, auth.uid(), v_interest, private.jt(p, 'note'))
  returning * into v_claim;

  -- In sealed rounds the item status must not hint that someone is interested.
  if v_round.mode = 'OPEN' and v_interest = 'INTERESTED' then
    update public.items set status = 'CLAIM_REQUESTED', version = version + 1, updated_by = auth.uid()
     where id = v_item_id and status = 'UP_FOR_GRABS';
  end if;
  return private.row_json(v_claim);
end;
$$;

create or replace function private.api_resolve_round(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_method public.resolution_method := private.jt(p, 'method')::public.resolution_method;
  v_reason text := private.jt(p, 'reason');
  v_m public.estate_members;
  v_round public.grab_rounds;
  v_interested uuid[];
  v_n integer;
  v_winner uuid;
  v_seed text;
  v_idx integer;
  v_prop uuid;
  v_res public.grab_resolutions;
begin
  v_m := private.require_member(v_estate_id, 'propose');
  select * into v_round from public.grab_rounds
   where id = private.ju(p, 'round_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Round not found.');
  end if;
  perform 1 from public.items where id = v_round.item_id for update;
  if exists (select 1 from public.grab_resolutions g where g.round_id = v_round.id) then
    perform private.fail('EI409', 'This round has already been settled.');
  end if;
  if v_method is null then
    perform private.fail('EI422', 'Choose how the round is settled.');
  end if;
  if v_round.mode = 'SEALED' and now() < v_round.reveal_at and v_method <> 'CANCELLED' then
    perform private.fail('EI409', format('Choices are sealed until %s UTC.',
                                         to_char(v_round.reveal_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')));
  end if;
  if v_method in ('DISCUSSION', 'ROTATION', 'INHERITANCE_CREDIT', 'PURCHASE', 'CANCELLED')
     and v_m.role not in ('ADMINISTRATOR', 'EXECUTOR') then
    perform private.fail('EI403', 'Only an administrator or executor can settle a round this way.');
  end if;

  v_interested := private.round_interested(v_round.id);
  v_n := coalesce(cardinality(v_interested), 0);

  case v_method
    when 'SOLE_INTEREST' then
      if v_n <> 1 then
        perform private.fail('EI409', format('Exactly one person must be interested; %s are.', v_n));
      end if;
      v_winner := v_interested[1];
    when 'NO_INTEREST' then
      if v_n <> 0 then
        perform private.fail('EI409', 'Someone is interested in this item.');
      end if;
    when 'RANDOM_DRAW' then
      if v_n < 2 then
        perform private.fail('EI409', 'A draw needs at least two interested people.');
      end if;
      -- Verifiable: winner = candidates[(first 8 hex of sha256(seed)) mod n]
      v_seed := encode(extensions.gen_random_bytes(16), 'hex');
      v_idx := ((('x' || lpad(substr(encode(extensions.digest(convert_to(v_seed, 'UTF8'), 'sha256'), 'hex'), 1, 8), 16, '0'))::bit(64)::bigint) % v_n)::integer + 1;
      v_winner := v_interested[v_idx];
    when 'CANCELLED' then
      if v_reason is null then
        perform private.fail('EI422', 'Record why the round is cancelled.');
      end if;
    else
      v_winner := private.ju(p, 'winner_user_id');
      if v_winner is null or not (v_winner = any (v_interested)) then
        perform private.fail('EI422', 'Choose one of the interested people.');
      end if;
      if v_reason is null then
        perform private.fail('EI422', 'Record how the family decided.');
      end if;
  end case;

  if v_winner is not null then
    v_prop := private.create_proposal_internal(
      gen_random_uuid(), v_estate_id, v_round.item_id, 'ASSIGN', v_winner, null, private.jn(p, 'amount'), null,
      coalesce(v_reason, case v_method when 'SOLE_INTEREST' then 'The only interested person.'
                                       when 'RANDOM_DRAW' then 'Won the random draw.' end),
      true
    );
  end if;

  insert into public.grab_resolutions (
    round_id, estate_id, item_id, method, winner_user_id, reason, draw_seed, draw_candidates, proposal_id, resolved_by
  ) values (
    v_round.id, v_estate_id, v_round.item_id, v_method, v_winner, v_reason, v_seed,
    case when v_method = 'RANDOM_DRAW' then v_interested end, v_prop, auth.uid()
  )
  returning * into v_res;

  if v_winner is null then
    perform private.set_item_status(v_round.item_id, 'NEEDS_DECISION');
  end if;

  return jsonb_build_object(
    'resolution', private.row_json(v_res),
    'proposal', case when v_prop is not null then private.proposal_json(v_prop) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Proposals and decisions
-- ---------------------------------------------------------------------------
create or replace function private.api_create_proposal(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
begin
  perform private.require_member(v_estate_id, 'propose');
  if exists (select 1 from public.proposals where id = v_id) then
    return private.proposal_json(v_id);
  end if;
  if private.jt(p, 'action') is null then
    perform private.fail('EI422', 'Choose what should happen to the item.');
  end if;
  perform private.create_proposal_internal(
    v_id, v_estate_id, private.ju(p, 'item_id'), private.jt(p, 'action')::public.proposal_action,
    private.ju(p, 'recipient_user_id'), private.jt(p, 'recipient_name'), private.jn(p, 'amount'),
    private.jt(p, 'organization'), private.jt(p, 'reason'), false
  );
  return private.proposal_json(v_id);
end;
$$;

create or replace function private.api_decide(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_p public.proposals;
begin
  perform private.require_member(v_estate_id, 'approve');
  select * into v_p from public.proposals where id = private.ju(p, 'proposal_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Decision not found.');
  end if;
  perform 1 from public.items where id = v_p.item_id for update;
  if exists (select 1 from public.proposal_outcomes o where o.proposal_id = v_p.id) then
    perform private.fail('EI409', 'This decision has already been settled.');
  end if;
  if not (auth.uid() = any (v_p.eligible_approvers)) then
    perform private.fail('EI403', 'You are not one of the approvers for this decision.');
  end if;
  if private.jt(p, 'decision') is null then
    perform private.fail('EI422', 'Choose approve, reject, or abstain.');
  end if;
  insert into public.proposal_decisions (estate_id, proposal_id, user_id, decision, comment)
  values (v_estate_id, v_p.id, auth.uid(), private.jt(p, 'decision')::public.decision, private.jt(p, 'comment'));
  perform private.evaluate_proposal(v_p.id);
  return private.proposal_json(v_p.id);
end;
$$;

create or replace function private.api_invalidate_decision(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_d public.proposal_decisions;
begin
  perform private.require_member(v_estate_id, 'admin');
  select * into v_d from public.proposal_decisions where id = private.ju(p, 'decision_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Decision record not found.');
  end if;
  if exists (select 1 from public.proposal_outcomes o where o.proposal_id = v_d.proposal_id) then
    perform private.fail('EI409', 'This decision is already final and cannot be reopened.');
  end if;
  if exists (select 1 from public.decision_invalidations i where i.decision_id = v_d.id) then
    return private.proposal_json(v_d.proposal_id);
  end if;
  if private.jt(p, 'reason') is null then
    perform private.fail('EI422', 'Record why this decision is being set aside.');
  end if;
  insert into public.decision_invalidations (decision_id, estate_id, proposal_id, reason, invalidated_by)
  values (v_d.id, v_estate_id, v_d.proposal_id, private.jt(p, 'reason'), auth.uid());
  perform private.evaluate_proposal(v_d.proposal_id);
  return private.proposal_json(v_d.proposal_id);
end;
$$;

create or replace function private.api_withdraw_proposal(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_reason text := private.jt(p, 'reason');
  v_m public.estate_members;
  v_p public.proposals;
  v_o public.proposal_outcomes;
begin
  v_m := private.require_member(v_estate_id);
  select * into v_p from public.proposals where id = private.ju(p, 'proposal_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Decision not found.');
  end if;
  if v_p.requested_by <> auth.uid() and v_m.role not in ('ADMINISTRATOR', 'EXECUTOR') then
    perform private.fail('EI403', 'Only the person who proposed this, or an administrator, can withdraw it.');
  end if;
  if v_reason is null then
    perform private.fail('EI422', 'Record a reason.');
  end if;
  perform 1 from public.items where id = v_p.item_id for update;
  select * into v_o from public.proposal_outcomes where proposal_id = v_p.id;
  if not found then
    insert into public.proposal_outcomes (proposal_id, estate_id, item_id, outcome, note, recorded_by)
    values (v_p.id, v_estate_id, v_p.item_id, 'WITHDRAWN', v_reason, auth.uid());
  elsif v_o.outcome = 'APPROVED'
        and not exists (select 1 from public.proposal_completions c where c.proposal_id = v_p.id)
        and not exists (select 1 from public.proposal_cancellations x where x.proposal_id = v_p.id) then
    insert into public.proposal_cancellations (proposal_id, estate_id, item_id, reason, cancelled_by)
    values (v_p.id, v_estate_id, v_p.item_id, v_reason, auth.uid());
  else
    perform private.fail('EI409', 'This decision is already final.');
  end if;
  perform private.set_item_status(v_p.item_id, 'NEEDS_DECISION');
  return private.proposal_json(v_p.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion and custody
-- ---------------------------------------------------------------------------
create or replace function private.api_complete_proposal(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_cid uuid := coalesce(private.ju(p, 'custody_event_id'), gen_random_uuid());
  v_to uuid := private.ju(p, 'to_location_id');
  v_final numeric := private.jn(p, 'final_amount');
  v_m public.estate_members;
  v_p public.proposals;
  v_item public.items;
  v_type public.custody_event_type;
  v_recv_user uuid;
  v_recv_name text;
begin
  v_m := private.require_member(v_estate_id);
  select * into v_p from public.proposals where id = private.ju(p, 'proposal_id') and estate_id = v_estate_id;
  if not found then
    perform private.fail('EI404', 'Decision not found.');
  end if;
  if not (v_p.requested_by = v_uid or v_p.recipient_user_id = v_uid or v_m.can_propose
          or v_m.role in ('ADMINISTRATOR', 'EXECUTOR')) then
    perform private.fail('EI403', 'Your role in this estate does not allow completing decisions.');
  end if;
  select * into v_item from public.items where id = v_p.item_id for update;
  if exists (select 1 from public.proposal_completions c where c.proposal_id = v_p.id) then
    return private.proposal_json(v_p.id);
  end if;
  if not exists (select 1 from public.proposal_outcomes o where o.proposal_id = v_p.id and o.outcome = 'APPROVED') then
    perform private.fail('EI409', 'This decision has not been approved.');
  end if;
  if exists (select 1 from public.proposal_cancellations x where x.proposal_id = v_p.id) then
    perform private.fail('EI409', 'This decision was cancelled.');
  end if;
  if v_item.do_not_move then
    perform private.fail('EI409', 'This item is marked "Hold in place". An administrator or executor must release the hold first.');
  end if;

  v_type := case v_p.action
              when 'ASSIGN' then 'HANDOFF'
              when 'SELL' then 'SOLD'
              when 'DONATE' then 'DONATED'
              else 'DISPOSED'
            end::public.custody_event_type;

  if v_p.action = 'ASSIGN' then
    v_recv_user := v_p.recipient_user_id;
    v_recv_name := coalesce(private.jt(p, 'received_by_name'), v_p.recipient_name);
    if v_to is null and v_recv_user is not null then
      v_to := private.person_location(v_estate_id, v_recv_user);
    end if;
  else
    v_recv_name := coalesce(private.jt(p, 'received_by_name'), v_p.organization, v_p.recipient_name);
    if v_to is null then
      v_to := private.external_location(
        v_estate_id,
        coalesce(v_p.organization, v_p.recipient_name,
                 case v_p.action when 'SELL' then 'Sold' when 'DONATE' then 'Donated' else 'Disposed of' end)
      );
    end if;
  end if;

  insert into public.custody_events (
    id, estate_id, item_id, event_type, from_location_id, to_location_id, released_by_user_id,
    received_by_user_id, received_by_name, purpose, occurred_at, notes, receipt_media_id, photo_media_id,
    proposal_id, recorded_by
  ) values (
    v_cid, v_estate_id, v_item.id, v_type, v_item.current_location_id, v_to,
    coalesce(private.ju(p, 'released_by_user_id'), v_uid), v_recv_user, v_recv_name,
    coalesce(private.jt(p, 'purpose'), lower(v_p.action::text)),
    coalesce(private.jts(p, 'occurred_at'), now()), private.jt(p, 'notes'),
    private.ju(p, 'receipt_media_id'), private.ju(p, 'photo_media_id'), v_p.id, v_uid
  );

  update public.items set
    current_location_id = coalesce(v_to, current_location_id),
    status = private.completed_status(v_p.action),
    version = version + 1,
    updated_by = v_uid
  where id = v_item.id;

  insert into public.proposal_completions (proposal_id, estate_id, item_id, custody_event_id, final_amount, notes, completed_by)
  values (v_p.id, v_estate_id, v_item.id, v_cid, v_final, private.jt(p, 'notes'), v_uid);

  if v_final is not null and v_p.action in ('SELL', 'DONATE') then
    insert into public.valuations (id, estate_id, item_id, valuation_type, amount, source, entered_by)
    values (gen_random_uuid(), v_estate_id, v_item.id,
            case when v_p.action = 'SELL' then 'SALE_PROCEEDS' else 'DONATION_VALUE' end::public.valuation_type,
            v_final, 'Recorded when the decision was completed', v_uid);
  end if;

  return private.proposal_json(v_p.id);
end;
$$;

create or replace function private.api_record_custody(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := private.ju(p, 'id');
  v_type public.custody_event_type := private.jt(p, 'event_type')::public.custody_event_type;
  v_to uuid := private.ju(p, 'to_location_id');
  v_m public.estate_members;
  v_item public.items;
  v_event public.custody_events;
  v_status public.item_status;
begin
  v_m := private.require_member(v_estate_id, 'edit');
  if v_id is null or v_type is null then
    perform private.fail('EI422', 'id and event_type are required.');
  end if;
  select * into v_event from public.custody_events where id = v_id;
  if found then
    if v_event.recorded_by = v_uid then
      return private.row_json(v_event);
    end if;
    perform private.fail('EI409', 'A custody record with this ID already exists.');
  end if;
  if v_type in ('SOLD', 'DONATED', 'DISPOSED') then
    perform private.fail('EI422', 'Record sales, donations and disposals by completing an approved decision.');
  end if;
  select * into v_item from public.items
   where id = private.ju(p, 'item_id') and estate_id = v_estate_id for update;
  if not found then
    perform private.fail('EI404', 'Item not found.');
  end if;

  if v_item.status = 'MERGED' then
    perform private.fail('EI409', 'This record was merged into another item. Record the move on that item.');
  end if;
  v_status := v_item.status;
  if v_type in ('MOVED', 'HANDOFF', 'RETURNED') then
    if v_to is null then
      perform private.fail('EI422', 'Choose where the item went.');
    end if;
    if v_item.do_not_move and v_m.role not in ('ADMINISTRATOR', 'EXECUTOR') then
      perform private.fail('EI409', 'This item is marked "Hold in place". An administrator or executor must release the hold first.');
    end if;
    if v_type = 'HANDOFF' or not private.location_on_property(v_to) then
      if private.ju(p, 'received_by_user_id') is null and private.jt(p, 'received_by_name') is null then
        perform private.fail('EI422', 'Record who took the item.');
      end if;
      if private.jt(p, 'purpose') is null then
        perform private.fail('EI422', 'Record why the item was taken.');
      end if;
    end if;
    if v_type = 'RETURNED' and v_item.status = any (private.terminal_statuses()) then
      v_status := 'NEEDS_DECISION';
    end if;
  elsif v_type = 'REPORTED_MISSING' then
    v_status := 'MISSING';
  elsif v_type = 'FOUND' and v_item.status = 'MISSING' then
    select (l.payload::jsonb -> 'before' ->> 'status')::public.item_status into v_status
      from public.ledger l
     where l.item_id = v_item.id and l.entity = 'items' and l.action = 'UPDATE'
       and l.payload::jsonb -> 'after' ->> 'status' = 'MISSING'
       and l.payload::jsonb -> 'before' ->> 'status' <> 'MISSING'
     order by l.estate_seq desc
     limit 1;
    v_status := coalesce(v_status, 'DISCOVERED');
  end if;

  insert into public.custody_events (
    id, estate_id, item_id, event_type, from_location_id, to_location_id, released_by_user_id,
    received_by_user_id, received_by_name, purpose, occurred_at, notes, receipt_media_id, photo_media_id,
    proposal_id, recorded_by
  ) values (
    v_id, v_estate_id, v_item.id, v_type, v_item.current_location_id, v_to,
    private.ju(p, 'released_by_user_id'), private.ju(p, 'received_by_user_id'), private.jt(p, 'received_by_name'),
    private.jt(p, 'purpose'), coalesce(private.jts(p, 'occurred_at'), now()), private.jt(p, 'notes'),
    private.ju(p, 'receipt_media_id'), private.ju(p, 'photo_media_id'), private.ju(p, 'proposal_id'), v_uid
  )
  returning * into v_event;

  update public.items set
    current_location_id = coalesce(v_to, current_location_id),
    status = v_status,
    version = version + 1,
    updated_by = v_uid
  where id = v_item.id;

  return private.row_json(v_event);
end;
$$;

-- ---------------------------------------------------------------------------
-- Duplicates
-- ---------------------------------------------------------------------------

-- Merge p_dup into p_keep: photos and current values are linked to the kept
-- record (same stored files, no copies), and the duplicate is marked MERGED.
create or replace function private.merge_items(p_dup uuid, p_keep uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dup public.items;
  v_keep public.items;
begin
  perform 1 from public.items where id in (p_dup, p_keep) order by id for update;
  select * into v_dup from public.items where id = p_dup;
  select * into v_keep from public.items where id = p_keep;
  if v_dup.id is null or v_keep.id is null or v_dup.estate_id <> v_keep.estate_id then
    perform private.fail('EI404', 'Both items must exist in the same estate.');
  end if;
  if v_dup.status = 'MERGED' or v_keep.status = 'MERGED' then
    perform private.fail('EI409', 'One of these records was already merged.');
  end if;
  if exists (select 1 from public.proposals x where x.item_id = p_dup)
     or exists (select 1 from public.grab_rounds x where x.item_id = p_dup)
     or exists (select 1 from public.custody_events x where x.item_id = p_dup) then
    perform private.fail('EI409', format('Item #%s has decisions or moves recorded, so it cannot be merged away. Merge the other record into it, or keep both.', v_dup.inventory_number));
  end if;

  insert into public.media (
    id, estate_id, item_id, kind, sha256, storage_path, thumb_sha256, thumb_path, mime_type,
    byte_size, width, height, caption, captured_at, uploaded_by
  )
  select gen_random_uuid(), m.estate_id, p_keep, m.kind, m.sha256, m.storage_path, m.thumb_sha256, m.thumb_path,
         m.mime_type, m.byte_size, m.width, m.height, m.caption, m.captured_at, m.uploaded_by
    from public.media m
   where m.item_id = p_dup
     and not exists (select 1 from public.redactions r where r.media_id = m.id)
     and not exists (select 1 from public.media k where k.item_id = p_keep and k.sha256 = m.sha256);

  insert into public.valuations (
    id, estate_id, item_id, valuation_type, amount, currency, valuation_date, source, appraiser_name,
    comparable_url, notes, attachment_media_id, entered_by
  )
  select gen_random_uuid(), v.estate_id, p_keep, v.valuation_type, v.amount, v.currency, v.valuation_date, v.source,
         v.appraiser_name, v.comparable_url,
         left(coalesce(v.notes || ' ', '') || format('(Copied from merged record #%s.)', v_dup.inventory_number), 2000),
         v.attachment_media_id, v.entered_by
    from public.valuations v
   where v.item_id = p_dup
     and not exists (select 1 from public.valuations s where s.supersedes_id = v.id);

  update public.items set
    status = 'MERGED', merged_into_id = p_keep, version = version + 1, updated_by = auth.uid()
  where id = p_dup;
end;
$$;

create or replace function private.api_review_duplicate(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_estate_id uuid := private.ju(p, 'estate_id');
  v_id uuid := coalesce(private.ju(p, 'id'), gen_random_uuid());
  v_item uuid := private.ju(p, 'item_id');
  v_other uuid := private.ju(p, 'other_item_id');
  v_verdict public.duplicate_verdict := private.jt(p, 'verdict')::public.duplicate_verdict;
  v_review public.duplicate_reviews;
begin
  perform private.require_member(v_estate_id, 'edit');
  select * into v_review from public.duplicate_reviews where id = v_id;
  if found then
    return private.row_json(v_review);
  end if;
  if v_item is null or v_other is null or v_verdict is null then
    perform private.fail('EI422', 'item_id, other_item_id and verdict are required.');
  end if;
  if v_verdict = 'SAME_ITEM' then
    perform private.merge_items(v_item, v_other);
  end if;
  insert into public.duplicate_reviews (id, estate_id, item_id, other_item_id, verdict, reasons, note, decided_by)
  values (v_id, v_estate_id, v_item, v_other, v_verdict,
          private.jarr(p, 'reasons'), private.jt(p, 'note'), auth.uid())
  returning * into v_review;
  return private.row_json(v_review);
end;
$$;
