-- =============================================================================
-- Ledger: an append-only, hash-chained record of every change to estate data.
--
-- Each estate has its own chain. For entry N:
--   hash_N = sha256_hex( utf8( hash_{N-1} || payload_N ) )
-- with hash_0 = 64 zeros. payload is the exact JSON text that was hashed, so
-- anyone holding an export can recompute the chain with a few lines of code
-- (scripts/verify-ledger.mjs, src/lib/ledger.ts).
--
-- Every device that verifies the chain stores the head hash it saw. If history
-- were rewritten later, even by someone with database-owner access, the
-- recomputed chain would no longer match what those devices recorded.
-- =============================================================================

create table public.ledger (
  id bigint generated always as identity primary key,
  estate_id uuid not null references public.estates (id),
  estate_seq bigint not null,
  entity text not null,
  entity_id text not null,
  item_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE')),
  actor_id uuid,
  occurred_at timestamptz not null,
  payload text not null,
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  unique (estate_id, estate_seq)
);
create index ledger_item_idx on public.ledger (item_id, estate_seq) where item_id is not null;

create trigger ledger_append_only before update or delete on public.ledger
  for each row execute function private.forbid_change();
create trigger ledger_no_truncate before truncate on public.ledger
  for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Append trigger. TG_ARGV lists the primary-key columns of the source table.
-- ---------------------------------------------------------------------------
create or replace function private.ledger_append()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_estate uuid;
  v_entity_id text := '';
  v_item uuid;
  v_prev text;
  v_seq bigint;
  v_payload text;
  v_hash text;
  v_actor uuid := auth.uid();
  v_at timestamptz := clock_timestamp();
  i integer;
begin
  v_new := to_jsonb(new) - 'sync_xid';
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'sync_xid';
    -- Ignore no-op updates (only the timestamp moved).
    if (v_new - 'updated_at') = (v_old - 'updated_at') then
      return null;
    end if;
  end if;

  if tg_table_name = 'estates' then
    v_estate := (v_new ->> 'id')::uuid;
  else
    v_estate := (v_new ->> 'estate_id')::uuid;
  end if;

  for i in 0 .. tg_nargs - 1 loop
    v_entity_id := v_entity_id
      || case when i = 0 then '' else ':' end
      || coalesce(v_new ->> tg_argv[i], '');
  end loop;

  if tg_table_name = 'items' then
    v_item := (v_new ->> 'id')::uuid;
  elsif v_new ? 'item_id' then
    v_item := nullif(v_new ->> 'item_id', '')::uuid;
  end if;

  -- Serialize writers per estate so the chain stays linear.
  perform pg_advisory_xact_lock(hashtextextended('ledger:' || v_estate::text, 0));

  select l.hash, l.estate_seq
    into v_prev, v_seq
    from public.ledger l
   where l.estate_id = v_estate
   order by l.estate_seq desc
   limit 1;

  v_prev := coalesce(v_prev, repeat('0', 64));
  v_seq := coalesce(v_seq, 0) + 1;

  v_payload := jsonb_build_object(
    'v', 1,
    'estate_id', v_estate,
    'estate_seq', v_seq,
    'entity', tg_table_name,
    'entity_id', v_entity_id,
    'action', tg_op,
    'actor_id', v_actor,
    'occurred_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'before', v_old,
    'after', v_new
  )::text;

  v_hash := encode(extensions.digest(convert_to(v_prev || v_payload, 'UTF8'), 'sha256'), 'hex');

  insert into public.ledger (estate_id, estate_seq, entity, entity_id, item_id, action, actor_id, occurred_at, payload, prev_hash, hash)
  values (v_estate, v_seq, tg_table_name, v_entity_id, v_item, tg_op, v_actor, v_at, v_payload, v_prev, v_hash);

  -- Tell connected devices something changed (no data, just a nudge to sync).
  -- Never let a realtime problem block a write.
  begin
    perform realtime.send(
      jsonb_build_object('estate_seq', v_seq, 'entity', tg_table_name),
      'changed',
      'estate:' || v_estate::text,
      true
    );
  exception when others then
    null;
  end;

  return null;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('estates', array['id']),
      ('estate_members', array['estate_id', 'user_id']),
      ('estate_invites', array['id']),
      ('locations', array['id']),
      ('items', array['id']),
      ('number_reservations', array['id']),
      ('number_voids', array['inventory_number']),
      ('media', array['id']),
      ('media_verifications', array['id']),
      ('valuations', array['id']),
      ('proposals', array['id']),
      ('proposal_decisions', array['id']),
      ('decision_invalidations', array['decision_id']),
      ('proposal_outcomes', array['proposal_id']),
      ('custody_events', array['id']),
      ('proposal_completions', array['proposal_id']),
      ('proposal_cancellations', array['proposal_id']),
      ('grab_rounds', array['id']),
      ('grab_resolutions', array['round_id']),
      ('claims', array['id']),
      ('duplicate_reviews', array['id']),
      ('redactions', array['id'])
    ) as t(tbl, pk)
  loop
    execute format(
      'create trigger %I after insert or update on public.%I for each row execute function private.ledger_append(%s)',
      spec.tbl || '_ledger',
      spec.tbl,
      (select string_agg(quote_literal(c), ', ') from unnest(spec.pk) as c)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-side chain check (a convenience; the independent check runs on each
-- device and in the backup job, which do not trust this function).
-- ---------------------------------------------------------------------------
create or replace function private.verify_ledger(p_estate_id uuid)
returns table (ok boolean, checked bigint, first_bad_seq bigint, head_seq bigint, head_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_prev text := repeat('0', 64);
  v_expected bigint := 1;
begin
  for r in
    select l.estate_seq, l.prev_hash, l.payload, l.hash
      from public.ledger l
     where l.estate_id = p_estate_id
     order by l.estate_seq
  loop
    if r.estate_seq <> v_expected
       or r.prev_hash <> v_prev
       or r.hash <> encode(extensions.digest(convert_to(r.prev_hash || r.payload, 'UTF8'), 'sha256'), 'hex') then
      return query select false, v_expected - 1, r.estate_seq, null::bigint, null::text;
      return;
    end if;
    v_prev := r.hash;
    v_expected := v_expected + 1;
  end loop;
  return query select true, v_expected - 1, null::bigint, v_expected - 1, v_prev;
end;
$$;
