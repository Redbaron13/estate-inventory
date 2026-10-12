-- =============================================================================
-- Foundation: extensions, private schema, enums, shared trigger functions,
-- user profiles.
--
-- Design rules (see docs/ARCHITECTURE.md):
--   * Nothing is ever deleted. DELETE and TRUNCATE are blocked by triggers on
--     every estate table.
--   * Most tables are append-only: corrections are new rows that reference the
--     row they supersede.
--   * The few mutable tables (estates, members, invites, locations, items,
--     profiles) are only changed through SECURITY DEFINER functions, and every
--     change is written to the hash-chained ledger.
--   * Every row carries sync_xid (the writing transaction id) so offline
--     devices can pull exactly what changed since their last sync.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations (plain-language labels live in the app; these are stable codes)
-- ---------------------------------------------------------------------------
create type public.member_role as enum (
  'ADMINISTRATOR', 'EXECUTOR', 'BENEFICIARY', 'FAMILY_MEMBER', 'APPRAISER', 'VIEW_ONLY'
);

create type public.item_status as enum (
  'DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION',
  'UP_FOR_GRABS', 'CLAIM_REQUESTED', 'ASSIGNED', 'APPROVAL_PENDING',
  'APPROVED_FOR_SALE', 'APPROVED_FOR_DONATION', 'APPROVED_FOR_DISPOSAL',
  'SOLD', 'DONATED', 'DISTRIBUTED', 'DISPOSED', 'MISSING', 'ON_HOLD', 'MERGED'
);

create type public.approval_rule as enum ('EXECUTOR', 'UNANIMOUS', 'MAJORITY');
create type public.claim_mode as enum ('SEALED', 'OPEN');
-- STAGING: a sorting area (e.g. "Donate pile"); HOLDING: where scanned items
-- land until someone puts them away; CONTAINER: a box or bin.
create type public.location_kind as enum (
  'PROPERTY', 'AREA', 'CONTAINER', 'STAGING', 'HOLDING', 'PERSON', 'EXTERNAL'
);
create type public.media_kind as enum (
  'FULL_ITEM', 'MARK', 'SERIAL', 'DAMAGE', 'PACKAGING', 'RECEIPT', 'DOCUMENT', 'HANDOFF', 'BARCODE', 'OTHER'
);
create type public.valuation_type as enum (
  'FAMILY_ESTIMATE', 'THIRD_PARTY_ESTIMATE', 'FORMAL_APPRAISAL', 'DATE_OF_DEATH',
  'INSURANCE', 'LISTING_PRICE', 'SALE_PROCEEDS', 'DONATION_VALUE'
);
create type public.interest as enum ('INTERESTED', 'NOT_INTERESTED', 'NEED_INFO');
create type public.resolution_method as enum (
  'SOLE_INTEREST', 'DISCUSSION', 'RANDOM_DRAW', 'ROTATION', 'INHERITANCE_CREDIT',
  'PURCHASE', 'NO_INTEREST', 'CANCELLED'
);
create type public.proposal_action as enum ('ASSIGN', 'SELL', 'DONATE', 'RECYCLE', 'DISPOSE');
create type public.decision as enum ('APPROVE', 'REJECT', 'ABSTAIN');
create type public.proposal_outcome as enum ('APPROVED', 'REJECTED', 'WITHDRAWN');
create type public.duplicate_verdict as enum ('SAME_ITEM', 'DIFFERENT_ITEMS', 'UNSURE');
create type public.custody_event_type as enum (
  'MOVED', 'HANDOFF', 'SOLD', 'DONATED', 'DISPOSED', 'RETURNED', 'FOUND', 'REPORTED_MISSING'
);

-- ---------------------------------------------------------------------------
-- Human-readable codes
--
-- Item code:      0428KB-LR7FUR-Q3X
--   0428  inventory number (4+ digits)     KB   member who entered it
--   LR    room where it was found          7    check digit
--   FUR   category                         Q3X  random (Crockford base32)
-- Location code:  BOX-9Q4TR  (kind prefix, 2 random, check digit, 2 random)
--
-- Check digit = sum(position * value) mod 11 over every other character in
-- reading order (0-9 = 0-9, A-Z = 10-35, positions from 1). A result of 10 is
-- never used: the random part is redrawn instead, so the check is always one
-- digit. Mirrored in supabase/functions/_shared/codes.ts.
-- ---------------------------------------------------------------------------
create or replace function private.code_alphabet() returns text
language sql immutable set search_path = '' as $$ select '0123456789ABCDEFGHJKMNPQRSTVWXYZ' $$;

create or replace function private.code_check_digit(p_body text) returns integer
language sql immutable set search_path = '' as $$
  select (coalesce(sum(t.pos * case when t.ch ~ '[0-9]' then ascii(t.ch) - 48 else ascii(t.ch) - 55 end), 0) % 11)::integer
    from regexp_split_to_table(regexp_replace(upper(p_body), '[^0-9A-Z]', '', 'g'), '') with ordinality as t(ch, pos)
   where t.ch <> ''
$$;

create or replace function private.random_code(p_length integer) returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr(private.code_alphabet(), (get_byte(b, i) % 32) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(p_length) as b) r,
         generate_series(0, p_length - 1) as i
$$;

-- Category codes used in item codes. Mirrored in supabase/functions/_shared/codes.ts.
create or replace function private.category_codes() returns text[]
language sql immutable set search_path = '' as $$
  select array['FUR', 'APL', 'KIT', 'CHN', 'JWL', 'ART', 'DEC', 'BKS', 'DOC', 'MEM', 'CLO',
               'LIN', 'ELE', 'TLS', 'OUT', 'SPT', 'TOY', 'COL', 'MUS', 'VEH', 'MSC']
$$;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Mutable tables: stamp the writing transaction and update time.
create or replace function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sync_xid := pg_current_xact_id();
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only tables and all deletes: refuse.
-- SQLSTATE EI423 is mapped to HTTP 423 (Locked) by the API.
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Records in "%" are permanent. Add a new record to correct or reverse one.', tg_table_name
    using errcode = 'EI423';
end;
$$;

-- Raise a typed application error. Codes map to HTTP statuses in the API:
--   EI400 bad request, EI403 forbidden, EI404 not found, EI409 conflict,
--   EI422 validation, EI423 permanent record.
create or replace function private.fail(p_code text, p_message text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message
    using errcode = p_code,
          detail = coalesce(p_detail::text, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: one per auth user. Never deleted (history references them).
-- To remove a person, deactivate their memberships and anonymize the profile
-- (see docs/RUNBOOK.md).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id),
  display_name text not null default '' check (length(display_name) <= 120),
  email text,
  phone text check (phone is null or length(phone) <= 40),
  large_text boolean not null default false,
  simplified_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_row();
create trigger profiles_no_delete before delete on public.profiles
  for each row execute function private.forbid_change();
create trigger profiles_no_truncate before truncate on public.profiles
  for each statement execute function private.forbid_change();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();
