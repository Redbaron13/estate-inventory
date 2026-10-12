-- =============================================================================
-- Estate tables.
--
-- MUTABLE (changed only through workflow functions, every change ledgered):
--   estates, estate_members, estate_invites, locations, items
-- APPEND-ONLY (UPDATE/DELETE/TRUNCATE refused by trigger):
--   number_reservations, number_voids, media, media_verifications, valuations,
--   proposals, proposal_decisions, decision_invalidations, proposal_outcomes,
--   custody_events, proposal_completions, proposal_cancellations, grab_rounds,
--   grab_resolutions, claims, duplicate_reviews, redactions
--
-- Client-generated UUIDs are accepted for rows that can be created offline
-- (items, locations, media, valuations, claims, proposals, custody events),
-- which makes replaying a queued request harmless.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Estates
-- ---------------------------------------------------------------------------
create table public.estates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  decedent_name text check (decedent_name is null or length(decedent_name) <= 200),
  date_of_death date,
  case_reference text check (case_reference is null or length(case_reference) <= 120),
  approval_rule public.approval_rule not null default 'EXECUTOR',
  auto_approve_below numeric(12, 2) check (auto_approve_below is null or auto_approve_below >= 0),
  unanimous_above numeric(12, 2) check (unanimous_above is null or unanimous_above >= 0),
  claim_mode public.claim_mode not null default 'SEALED',
  sealed_window_hours integer not null default 72 check (sealed_window_hours between 1 and 720),
  help_contact_name text check (help_contact_name is null or length(help_contact_name) <= 120),
  help_contact_phone text check (help_contact_phone is null or length(help_contact_phone) <= 40),
  retention_years integer not null default 7 check (retention_years between 1 and 100),
  next_inventory_number integer not null default 1 check (next_inventory_number >= 1),
  default_location_id uuid,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  sync_xid xid8 not null default pg_current_xact_id()
);

-- ---------------------------------------------------------------------------
-- Membership. Removal sets is_active = false; the row stays forever.
-- ---------------------------------------------------------------------------
create table public.estate_members (
  estate_id uuid not null references public.estates (id),
  user_id uuid not null references public.profiles (id),
  role public.member_role not null default 'FAMILY_MEMBER',
  -- Two letters used in item codes (e.g. "KB"). Unique within the estate.
  member_code text check (member_code ~ '^[A-Z]{2}$'),
  can_add_items boolean not null default true,
  can_edit_items boolean not null default true,
  can_propose boolean not null default true,
  can_approve boolean not null default true,
  can_export boolean not null default true,
  is_active boolean not null default true,
  invited_by uuid references public.profiles (id),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removal_reason text,
  updated_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  primary key (estate_id, user_id),
  unique (estate_id, member_code)
);
create index estate_members_user_idx on public.estate_members (user_id) where is_active;

-- Give each new member a code from their initials, avoiding collisions.
create or replace function private.assign_member_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_words text[];
  v_first text;
  v_last text;
  v_candidate text;
  v_candidates text[] := '{}';
begin
  if new.member_code is not null then
    return new;
  end if;
  select upper(regexp_replace(coalesce(nullif(display_name, ''), split_part(coalesce(email, ''), '@', 1), 'Member'), '[^A-Za-z ]', ' ', 'g'))
    into v_name
    from public.profiles where id = new.user_id;
  v_words := array_remove(regexp_split_to_array(btrim(coalesce(v_name, 'MEMBER')), '\s+'), '');
  v_first := coalesce(v_words[1], 'MEMBER');
  v_last := coalesce(v_words[cardinality(v_words)], v_first);
  if cardinality(v_words) >= 2 then
    v_candidates := v_candidates || (left(v_first, 1) || left(v_last, 1));
    v_candidates := v_candidates || (left(v_first, 1) || substr(v_last, 2, 1));
  end if;
  v_candidates := v_candidates || left(v_first || 'X', 2);
  v_candidates := v_candidates || (left(v_first, 1) || substr(v_first, 3, 1));
  foreach v_candidate in array v_candidates loop
    if v_candidate ~ '^[A-Z]{2}$' and not exists (
      select 1 from public.estate_members m where m.estate_id = new.estate_id and m.member_code = v_candidate
    ) then
      new.member_code := v_candidate;
      return new;
    end if;
  end loop;
  loop
    v_candidate := left(v_first, 1) || chr(65 + (get_byte(extensions.gen_random_bytes(1), 0) % 26));
    exit when not exists (select 1 from public.estate_members m where m.estate_id = new.estate_id and m.member_code = v_candidate);
  end loop;
  new.member_code := v_candidate;
  return new;
end;
$$;

create trigger estate_members_code before insert on public.estate_members
  for each row execute function private.assign_member_code();

-- ---------------------------------------------------------------------------
-- Invitations. The plain code is shown once to the inviter; only its
-- SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table public.estate_invites (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  email text not null check (position('@' in email) > 1),
  role public.member_role not null default 'FAMILY_MEMBER',
  code_hash text not null unique,
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id()
);
create index estate_invites_estate_idx on public.estate_invites (estate_id);

-- ---------------------------------------------------------------------------
-- Locations: hierarchical (House > Basement > Shelf 3). PERSON locations
-- represent "in someone's possession"; EXTERNAL covers auction houses,
-- donation pickups and the like. Location is separate from status.
-- ---------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  parent_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  kind public.location_kind not null default 'AREA',
  -- Scannable label code, e.g. BOX-9Q4TR (prefix by kind; check digit in the middle).
  code text not null check (code ~ '^(PRP|RM|BOX|STG|HLD|PER|EXT)-[0-9A-HJKMNP-TV-Z]{2}[0-9][0-9A-HJKMNP-TV-Z]{2}$'),
  -- Two-character abbreviation used in item codes for "where found" (LR, B2).
  tag text not null check (tag ~ '^[A-Z0-9]{2}$'),
  purpose text check (purpose is null or length(purpose) <= 200),
  person_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  unique (estate_id, code),
  foreign key (estate_id, parent_id) references public.locations (estate_id, id)
);

alter table public.estates
  add foreign key (id, default_location_id) references public.locations (estate_id, id);
create index locations_sync_idx on public.locations (estate_id, sync_xid);

-- ---------------------------------------------------------------------------
-- Items: current state. Full history is in the ledger.
-- inventory_number comes from a block the creating device reserved, so items
-- created offline get their permanent number immediately.
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  inventory_number integer not null check (inventory_number >= 1),
  -- Permanent label code, e.g. 0428KB-LR7FUR-Q3X (see foundation migration).
  -- Generated on the device so it works offline. Never changes.
  item_code text not null check (item_code ~ '^[0-9]{4,}[A-Z]{2}-[A-Z0-9]{2}[0-9][A-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$'),
  title text not null check (length(trim(title)) between 1 and 300),
  description text check (description is null or length(description) <= 5000),
  category text not null default 'MSC' check (category = any (private.category_codes())),
  quantity integer not null default 1 check (quantity between 1 and 100000),
  condition text check (condition is null or length(condition) <= 80),
  barcode text check (barcode is null or length(barcode) <= 128),
  barcode_format text check (barcode_format is null or length(barcode_format) <= 40),
  brand text check (brand is null or length(brand) <= 200),
  model text check (model is null or length(model) <= 200),
  serial_number text check (serial_number is null or length(serial_number) <= 200),
  dimensions text check (dimensions is null or length(dimensions) <= 200),
  weight text check (weight is null or length(weight) <= 80),
  markings text check (markings is null or length(markings) <= 2000),
  provenance text check (provenance is null or length(provenance) <= 5000),
  notes text check (notes is null or length(notes) <= 5000),
  original_location_id uuid,
  current_location_id uuid,
  status public.item_status not null default 'DISCOVERED',
  potentially_valuable boolean not null default false,
  do_not_move boolean not null default false,
  do_not_move_reason text check (do_not_move_reason is null or length(do_not_move_reason) <= 1000),
  physically_verified_at timestamptz,
  physically_verified_by uuid references public.profiles (id),
  merged_into_id uuid,
  device_id text check (device_id is null or length(device_id) <= 80),
  captured_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, inventory_number),
  unique (estate_id, item_code),
  unique (estate_id, id),
  foreign key (estate_id, original_location_id) references public.locations (estate_id, id),
  foreign key (estate_id, current_location_id) references public.locations (estate_id, id),
  foreign key (estate_id, merged_into_id) references public.items (estate_id, id),
  check (merged_into_id is null or merged_into_id <> id)
);
create index items_sync_idx on public.items (estate_id, sync_xid);
create index items_barcode_idx on public.items (estate_id, barcode) where barcode is not null;

-- ---------------------------------------------------------------------------
-- Inventory number reservations and voids (append-only).
-- ---------------------------------------------------------------------------
create table public.number_reservations (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  user_id uuid not null references public.profiles (id),
  device_id text not null check (length(device_id) between 1 and 80),
  first_number integer not null,
  last_number integer not null,
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  check (last_number >= first_number),
  unique (estate_id, id)
);
create index number_reservations_sync_idx on public.number_reservations (estate_id, sync_xid);

create table public.number_voids (
  estate_id uuid not null references public.estates (id),
  inventory_number integer not null,
  reservation_id uuid not null,
  voided_by uuid not null references public.profiles (id),
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  primary key (estate_id, inventory_number),
  foreign key (estate_id, reservation_id) references public.number_reservations (estate_id, id)
);
create index number_voids_sync_idx on public.number_voids (estate_id, sync_xid);

-- ---------------------------------------------------------------------------
-- Media (photos, receipts, documents). Content-addressed: the storage path is
-- {estate_id}/{sha256}.{ext}, so a file can never be silently replaced.
-- ---------------------------------------------------------------------------
create table public.media (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid,
  kind public.media_kind not null default 'FULL_ITEM',
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  thumb_sha256 text check (thumb_sha256 is null or thumb_sha256 ~ '^[0-9a-f]{64}$'),
  thumb_path text,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 26214400),
  width integer,
  height integer,
  caption text check (caption is null or length(caption) <= 500),
  captured_at timestamptz,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id)
);
create index media_sync_idx on public.media (estate_id, sync_xid);
create index media_item_idx on public.media (item_id);
create index media_path_idx on public.media (storage_path);
create index media_thumb_path_idx on public.media (thumb_path);

-- Written only by the backup job (service role) after it re-hashes the bytes.
create table public.media_verifications (
  id bigint generated always as identity primary key,
  estate_id uuid not null references public.estates (id),
  media_id uuid not null,
  location text not null check (location in ('supabase', 'r2')),
  verified_sha256 text not null,
  matches boolean not null,
  checked_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, media_id) references public.media (estate_id, id)
);
create index media_verifications_media_idx on public.media_verifications (media_id);

-- ---------------------------------------------------------------------------
-- Valuations: each kind of value is its own record. A correction is a new
-- record with supersedes_id set; the original remains.
-- ---------------------------------------------------------------------------
create table public.valuations (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  valuation_type public.valuation_type not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency char(3) not null default 'USD',
  valuation_date date not null default current_date,
  source text check (source is null or length(source) <= 300),
  appraiser_name text check (appraiser_name is null or length(appraiser_name) <= 200),
  comparable_url text check (comparable_url is null or length(comparable_url) <= 1000),
  notes text check (notes is null or length(notes) <= 2000),
  attachment_media_id uuid,
  supersedes_id uuid references public.valuations (id),
  entered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  foreign key (estate_id, attachment_media_id) references public.media (estate_id, id)
);
create index valuations_sync_idx on public.valuations (estate_id, sync_xid);
create index valuations_item_idx on public.valuations (item_id);

-- ---------------------------------------------------------------------------
-- Disposition proposals. The approval rule and the eligible approvers are
-- snapshotted at creation so later setting changes cannot alter a pending vote.
-- ---------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  action public.proposal_action not null,
  recipient_user_id uuid references public.profiles (id),
  recipient_name text check (recipient_name is null or length(recipient_name) <= 200),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  organization text check (organization is null or length(organization) <= 200),
  reason text check (reason is null or length(reason) <= 2000),
  rule public.approval_rule not null,
  eligible_approvers uuid[] not null,
  auto_approved boolean not null default false,
  requested_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  check (action <> 'ASSIGN' or recipient_user_id is not null or recipient_name is not null)
);
create index proposals_sync_idx on public.proposals (estate_id, sync_xid);
create index proposals_item_idx on public.proposals (item_id);

create table public.proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  proposal_id uuid not null,
  user_id uuid not null references public.profiles (id),
  decision public.decision not null,
  comment text check (comment is null or length(comment) <= 2000),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id)
);
create index proposal_decisions_sync_idx on public.proposal_decisions (estate_id, sync_xid);
create index proposal_decisions_proposal_idx on public.proposal_decisions (proposal_id);

-- An administrator may invalidate a decision with a recorded reason. The
-- original decision stays visible.
create table public.decision_invalidations (
  decision_id uuid primary key,
  estate_id uuid not null references public.estates (id),
  proposal_id uuid not null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  invalidated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, decision_id) references public.proposal_decisions (estate_id, id),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id)
);
create index decision_invalidations_sync_idx on public.decision_invalidations (estate_id, sync_xid);

create table public.proposal_outcomes (
  proposal_id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  outcome public.proposal_outcome not null,
  note text check (note is null or length(note) <= 2000),
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id)
);
create index proposal_outcomes_sync_idx on public.proposal_outcomes (estate_id, sync_xid);

-- ---------------------------------------------------------------------------
-- Custody: every physical movement or change of hands.
-- ---------------------------------------------------------------------------
create table public.custody_events (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  event_type public.custody_event_type not null,
  from_location_id uuid,
  to_location_id uuid,
  released_by_user_id uuid references public.profiles (id),
  received_by_user_id uuid references public.profiles (id),
  received_by_name text check (received_by_name is null or length(received_by_name) <= 200),
  purpose text check (purpose is null or length(purpose) <= 1000),
  occurred_at timestamptz not null,
  notes text check (notes is null or length(notes) <= 2000),
  receipt_media_id uuid,
  photo_media_id uuid,
  proposal_id uuid,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  foreign key (estate_id, from_location_id) references public.locations (estate_id, id),
  foreign key (estate_id, to_location_id) references public.locations (estate_id, id),
  foreign key (estate_id, receipt_media_id) references public.media (estate_id, id),
  foreign key (estate_id, photo_media_id) references public.media (estate_id, id),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id)
);
create index custody_events_sync_idx on public.custody_events (estate_id, sync_xid);
create index custody_events_item_idx on public.custody_events (item_id);

create table public.proposal_completions (
  proposal_id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  custody_event_id uuid not null,
  final_amount numeric(12, 2) check (final_amount is null or final_amount >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  completed_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  foreign key (estate_id, custody_event_id) references public.custody_events (estate_id, id)
);
create index proposal_completions_sync_idx on public.proposal_completions (estate_id, sync_xid);

-- An approved decision that falls through (buyer backs out, charity declines)
-- is cancelled with a reason; the approval itself stays on record.
create table public.proposal_cancellations (
  proposal_id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  cancelled_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id)
);
create index proposal_cancellations_sync_idx on public.proposal_cancellations (estate_id, sync_xid);

-- ---------------------------------------------------------------------------
-- Up for grabs. Each round records the claim mode it opened under, so
-- changing the estate setting mid-round cannot expose sealed choices.
-- ---------------------------------------------------------------------------
create table public.grab_rounds (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  mode public.claim_mode not null,
  reveal_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  opened_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  unique (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  check ((mode = 'SEALED') = (reveal_at is not null))
);
create index grab_rounds_sync_idx on public.grab_rounds (estate_id, sync_xid);
create index grab_rounds_item_idx on public.grab_rounds (item_id);

create table public.grab_resolutions (
  round_id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  method public.resolution_method not null,
  winner_user_id uuid references public.profiles (id),
  reason text check (reason is null or length(reason) <= 2000),
  draw_seed text,
  draw_candidates uuid[],
  proposal_id uuid,
  resolved_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, round_id) references public.grab_rounds (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  foreign key (estate_id, proposal_id) references public.proposals (estate_id, id)
);
create index grab_resolutions_sync_idx on public.grab_resolutions (estate_id, sync_xid);

-- A member may change their mind before the round closes; the latest row
-- counts and earlier rows remain as history.
create table public.claims (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  round_id uuid not null,
  item_id uuid not null,
  user_id uuid not null references public.profiles (id),
  interest public.interest not null,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, round_id) references public.grab_rounds (estate_id, id),
  foreign key (estate_id, item_id) references public.items (estate_id, id)
);
create index claims_sync_idx on public.claims (estate_id, sync_xid);
create index claims_round_idx on public.claims (round_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Duplicate reviews: a person's verdict on whether two records are the same
-- physical item. SAME_ITEM merges the newer record into the older one (the
-- merged record stays, marked MERGED).
-- ---------------------------------------------------------------------------
create table public.duplicate_reviews (
  id uuid primary key,
  estate_id uuid not null references public.estates (id),
  item_id uuid not null,
  other_item_id uuid not null,
  verdict public.duplicate_verdict not null,
  reasons text[] not null default '{}',
  note text check (note is null or length(note) <= 1000),
  decided_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, item_id) references public.items (estate_id, id),
  foreign key (estate_id, other_item_id) references public.items (estate_id, id),
  check (item_id <> other_item_id)
);
create index duplicate_reviews_sync_idx on public.duplicate_reviews (estate_id, sync_xid);
create index duplicate_reviews_pair_idx on public.duplicate_reviews (item_id, other_item_id);

-- ---------------------------------------------------------------------------
-- Redactions: hide a mistaken upload from everyone in the app. The bytes stay
-- in the locked backup until the retention period ends.
-- ---------------------------------------------------------------------------
create table public.redactions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates (id),
  media_id uuid not null unique,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  redacted_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sync_xid xid8 not null default pg_current_xact_id(),
  foreign key (estate_id, media_id) references public.media (estate_id, id)
);
create index redactions_sync_idx on public.redactions (estate_id, sync_xid);

-- ---------------------------------------------------------------------------
-- Immutability triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  mutable_tables text[] := array['estates', 'estate_members', 'estate_invites', 'locations', 'items'];
  append_only_tables text[] := array[
    'number_reservations', 'number_voids', 'media', 'media_verifications', 'valuations',
    'proposals', 'proposal_decisions', 'decision_invalidations', 'proposal_outcomes',
    'custody_events', 'proposal_completions', 'proposal_cancellations', 'grab_rounds',
    'grab_resolutions', 'claims', 'duplicate_reviews', 'redactions'
  ];
begin
  foreach t in array mutable_tables loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_row()', t || '_touch', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.forbid_change()', t || '_no_delete', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.forbid_change()', t || '_no_truncate', t);
  end loop;

  foreach t in array append_only_tables loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.forbid_change()', t || '_no_truncate', t);
  end loop;
end;
$$;
