-- =============================================================================
-- Access control: membership helpers and Row Level Security.
--
-- Reads: an active member can read their estate's rows. Exceptions:
--   * claims: during a sealed round you see only your own choice until the
--     reveal time. This is enforced here, not just hidden in the app.
--   * invitations: managers (ADMINISTRATOR / EXECUTOR) only.
-- Writes: no table accepts direct INSERT/UPDATE/DELETE from API roles. All
-- changes go through public.api(), which dispatches to the private.api_*
-- workflow functions that enforce the estate's rules.
-- =============================================================================

create or replace function private.is_member(p_estate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.estate_members m
     where m.estate_id = p_estate_id
       and m.user_id = auth.uid()
       and m.is_active
  );
$$;

create or replace function private.is_manager(p_estate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.estate_members m
     where m.estate_id = p_estate_id
       and m.user_id = auth.uid()
       and m.is_active
       and m.role in ('ADMINISTRATOR', 'EXECUTOR')
  );
$$;

create or replace function private.shares_estate(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.estate_members mine
      join public.estate_members theirs on theirs.estate_id = mine.estate_id
     where mine.user_id = auth.uid()
       and mine.is_active
       and theirs.user_id = p_user_id
  );
$$;

create or replace function private.round_revealed(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.mode = 'OPEN' or r.reveal_at <= now() from public.grab_rounds r where r.id = p_round_id),
    false
  );
$$;

-- Default permissions for each role.
create or replace function private.role_defaults(p_role public.member_role)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'ADMINISTRATOR' then '{"can_add_items":true,"can_edit_items":true,"can_propose":true,"can_approve":true,"can_export":true}'::jsonb
    when 'EXECUTOR'      then '{"can_add_items":true,"can_edit_items":true,"can_propose":true,"can_approve":true,"can_export":true}'::jsonb
    when 'BENEFICIARY'   then '{"can_add_items":true,"can_edit_items":true,"can_propose":true,"can_approve":true,"can_export":true}'::jsonb
    when 'FAMILY_MEMBER' then '{"can_add_items":true,"can_edit_items":true,"can_propose":true,"can_approve":true,"can_export":true}'::jsonb
    when 'APPRAISER'     then '{"can_add_items":false,"can_edit_items":true,"can_propose":false,"can_approve":false,"can_export":false}'::jsonb
    else                      '{"can_add_items":false,"can_edit_items":false,"can_propose":false,"can_approve":false,"can_export":false}'::jsonb
  end;
$$;

-- Returns the caller's active membership or raises 403.
-- p_permission: null (any member), 'add', 'edit', 'propose', 'approve',
-- 'export', 'manage' (ADMINISTRATOR/EXECUTOR), 'admin' (ADMINISTRATOR only).
create or replace function private.require_member(p_estate_id uuid, p_permission text default null)
returns public.estate_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.estate_members;
begin
  if auth.uid() is null then
    perform private.fail('EI401', 'Please sign in.');
  end if;
  select * into m
    from public.estate_members
   where estate_id = p_estate_id and user_id = auth.uid() and is_active;
  if not found then
    perform private.fail('EI403', 'You are not a member of this estate.');
  end if;
  if p_permission is null then
    return m;
  end if;
  if (p_permission = 'add' and not m.can_add_items)
     or (p_permission = 'edit' and not m.can_edit_items)
     or (p_permission = 'propose' and not m.can_propose)
     or (p_permission = 'approve' and not m.can_approve)
     or (p_permission = 'export' and not m.can_export)
     or (p_permission = 'manage' and m.role not in ('ADMINISTRATOR', 'EXECUTOR'))
     or (p_permission = 'admin' and m.role <> 'ADMINISTRATOR') then
    perform private.fail('EI403', 'Your role in this estate does not allow that.', jsonb_build_object('permission', p_permission));
  end if;
  return m;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.estates enable row level security;
alter table public.estate_members enable row level security;
alter table public.estate_invites enable row level security;
alter table public.locations enable row level security;
alter table public.items enable row level security;
alter table public.number_reservations enable row level security;
alter table public.number_voids enable row level security;
alter table public.media enable row level security;
alter table public.media_verifications enable row level security;
alter table public.valuations enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_decisions enable row level security;
alter table public.decision_invalidations enable row level security;
alter table public.proposal_outcomes enable row level security;
alter table public.custody_events enable row level security;
alter table public.proposal_completions enable row level security;
alter table public.proposal_cancellations enable row level security;
alter table public.grab_rounds enable row level security;
alter table public.grab_resolutions enable row level security;
alter table public.claims enable row level security;
alter table public.redactions enable row level security;
alter table public.duplicate_reviews enable row level security;
alter table public.ledger enable row level security;

create policy "read own and co-member profiles" on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.shares_estate(id));

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "members read estate" on public.estates
  for select to authenticated
  using (private.is_member(id));

create policy "managers read invites" on public.estate_invites
  for select to authenticated
  using (private.is_manager(estate_id));

-- Sealed rounds: only your own choice is visible until reveal_at.
create policy "members read claims after reveal" on public.claims
  for select to authenticated
  using (private.is_member(estate_id) and (user_id = auth.uid() or private.round_revealed(round_id)));

do $$
declare
  t text;
begin
  foreach t in array array[
    'estate_members', 'locations', 'items', 'number_reservations', 'number_voids', 'media',
    'media_verifications', 'valuations', 'proposals', 'proposal_decisions',
    'decision_invalidations', 'proposal_outcomes', 'custody_events', 'proposal_completions',
    'proposal_cancellations', 'grab_rounds', 'grab_resolutions', 'duplicate_reviews', 'redactions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_member(estate_id))',
      'members read ' || t, t
    );
  end loop;
end;
$$;

-- The ledger has no read policy: members read it through public.ledger_page(),
-- which withholds sealed-claim and invitation details until they may be seen.
