-- =============================================================================
-- Public entry points (the only functions API roles may execute):
--   public.api(fn, args, key, request_hash)  every write, with idempotency
--   public.my_estates()                      estates the caller belongs to
--   public.pull_changes(estate, since)       incremental sync for devices
--   public.ledger_page(estate, after, limit) history for verification
--   public.verify_ledger(estate)             server-side chain check
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Idempotency: a device that retries a request after a dropped connection
-- gets the original response instead of a duplicate action.
-- ---------------------------------------------------------------------------
create table private.idempotency_keys (
  user_id uuid not null,
  key text not null check (length(key) between 8 and 128),
  fn text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create or replace function public.api(
  p_fn text,
  p_args jsonb default '{}'::jsonb,
  p_key text default null,
  p_request_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing private.idempotency_keys;
  v_result jsonb;
begin
  if v_uid is null then
    perform private.fail('EI401', 'Please sign in.');
  end if;
  if p_fn not in (
    'create_estate', 'update_estate', 'create_invite', 'revoke_invite', 'accept_invite',
    'update_member', 'remove_member', 'update_profile', 'reserve_numbers', 'void_numbers',
    'create_location', 'update_location', 'create_item', 'update_item', 'register_media',
    'redact_media', 'add_valuation', 'open_round', 'set_claim', 'resolve_round',
    'create_proposal', 'decide', 'invalidate_decision', 'withdraw_proposal',
    'complete_proposal', 'record_custody', 'review_duplicate'
  ) then
    perform private.fail('EI404', format('Unknown operation "%s".', p_fn));
  end if;

  if p_key is not null then
    select * into v_existing from private.idempotency_keys where user_id = v_uid and key = p_key;
    if found then
      if v_existing.fn <> p_fn or v_existing.request_hash <> coalesce(p_request_hash, '') then
        perform private.fail('EI422', 'This request ID was already used for a different request.');
      end if;
      return jsonb_build_object('replayed', true, 'result', v_existing.response);
    end if;
  end if;

  execute format('select private.%I($1)', 'api_' || p_fn) into v_result using coalesce(p_args, '{}'::jsonb);

  if p_key is not null then
    insert into private.idempotency_keys (user_id, key, fn, request_hash, response)
    values (v_uid, p_key, p_fn, coalesce(p_request_hash, ''), coalesce(v_result, 'null'::jsonb));
  end if;

  return jsonb_build_object('replayed', false, 'result', v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estates the caller belongs to, with their role.
-- ---------------------------------------------------------------------------
create or replace function public.my_estates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           (to_jsonb(e) - 'sync_xid')
           || jsonb_build_object('my_role', m.role, 'my_permissions', jsonb_build_object(
                'can_add_items', m.can_add_items, 'can_edit_items', m.can_edit_items,
                'can_propose', m.can_propose, 'can_approve', m.can_approve, 'can_export', m.can_export))
           order by e.created_at desc), '[]'::jsonb)
    from public.estate_members m
    join public.estates e on e.id = m.estate_id
   where m.user_id = auth.uid() and m.is_active
$$;

-- ---------------------------------------------------------------------------
-- Incremental sync.
--
-- Each row records the transaction that last wrote it (sync_xid). The cursor
-- returned is the oldest transaction still running when this snapshot was
-- taken, so a slow transaction can never be skipped: anything it writes has
-- an id at or above the cursor and arrives on the next pull. Rows may arrive
-- twice; devices apply them idempotently.
--
-- Runs as the caller (SECURITY INVOKER), so Row Level Security decides what
-- comes back, including sealed claims.
-- ---------------------------------------------------------------------------
create or replace function public.pull_changes(p_estate_id uuid, p_since text default '0')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since xid8 := coalesce(nullif(p_since, ''), '0')::xid8;
  v_cursor xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v jsonb;
begin
  if not private.is_member(p_estate_id) then
    perform private.fail('EI403', 'You are not a member of this estate.');
  end if;

  select jsonb_build_object(
    'cursor', v_cursor::text,
    'full', v_since = '0'::xid8,
    'server_time', now(),
    'estates', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.estates t where t.id = p_estate_id and t.sync_xid >= v_since),
    'members', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.estate_members t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'profiles', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'email', pr.email, 'phone', pr.phone)), '[]'::jsonb)
                   from public.profiles pr
                  where pr.id in (select m.user_id from public.estate_members m where m.estate_id = p_estate_id)),
    'invites', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid' - 'code_hash'), '[]'::jsonb) from public.estate_invites t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'locations', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.locations t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'items', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.items t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'number_reservations', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.number_reservations t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'number_voids', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.number_voids t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'media', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.media t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'valuations', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.valuations t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'proposals', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.proposals t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'proposal_decisions', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.proposal_decisions t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'decision_invalidations', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.decision_invalidations t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'proposal_outcomes', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.proposal_outcomes t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'proposal_completions', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.proposal_completions t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'proposal_cancellations', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.proposal_cancellations t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'custody_events', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.custody_events t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'grab_rounds', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.grab_rounds t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'grab_resolutions', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.grab_resolutions t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    -- Claims become visible to others at reveal time without being rewritten,
    -- so revealed rounds are always re-sent until 90 days after settlement.
    'claims', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb)
                 from public.claims t
                where t.estate_id = p_estate_id
                  and (t.sync_xid >= v_since
                       or t.round_id in (
                         select r.id from public.grab_rounds r
                          where r.estate_id = p_estate_id
                            and (r.mode = 'OPEN' or r.reveal_at <= now())
                            and not exists (select 1 from public.grab_resolutions g
                                             where g.round_id = r.id and g.created_at < now() - interval '90 days')))),
    'redactions', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.redactions t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'duplicate_reviews', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.duplicate_reviews t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'media_verifications', (select coalesce(jsonb_agg(to_jsonb(t) - 'sync_xid'), '[]'::jsonb) from public.media_verifications t where t.estate_id = p_estate_id and t.sync_xid >= v_since),
    'ledger_head', (select jsonb_build_object('estate_seq', l.estate_seq, 'hash', l.hash)
                      from public.ledger l where l.estate_id = p_estate_id order by l.estate_seq desc limit 1)
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger pages. Entries are always returned with their hashes so the chain
-- can be checked; the payload is withheld only where the underlying record
-- may not be seen yet (another member's sealed choice, invitation details
-- for non-managers). Withheld payloads become visible once allowed.
-- ---------------------------------------------------------------------------
create or replace function private.ledger_payload_visible(p_estate_id uuid, p_entity text, p_entity_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim public.claims;
begin
  if p_entity = 'claims' then
    select * into v_claim from public.claims where id = p_entity_id::uuid;
    return v_claim.user_id = auth.uid() or private.round_revealed(v_claim.round_id);
  elsif p_entity = 'estate_invites' then
    return private.is_manager(p_estate_id);
  end if;
  return true;
end;
$$;

create or replace function public.ledger_page(p_estate_id uuid, p_after_seq bigint default 0, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_estate_id) then
    perform private.fail('EI403', 'You are not a member of this estate.');
  end if;
  return jsonb_build_object(
    'head', (select jsonb_build_object('estate_seq', l.estate_seq, 'hash', l.hash)
               from public.ledger l where l.estate_id = p_estate_id order by l.estate_seq desc limit 1),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'estate_seq', x.estate_seq, 'entity', x.entity, 'entity_id', x.entity_id,
               'item_id', x.item_id, 'action', x.action, 'actor_id', x.actor_id,
               'occurred_at', x.occurred_at, 'prev_hash', x.prev_hash, 'hash', x.hash,
               'payload', case when private.ledger_payload_visible(p_estate_id, x.entity, x.entity_id) then x.payload end
             ) order by x.estate_seq)
        from (
          select * from public.ledger l
           where l.estate_id = p_estate_id and l.estate_seq > coalesce(p_after_seq, 0)
           order by l.estate_seq
           limit least(greatest(coalesce(p_limit, 500), 1), 2000)
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.verify_ledger(p_estate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.is_member(p_estate_id) then
    perform private.fail('EI403', 'You are not a member of this estate.');
  end if;
  select * into r from private.verify_ledger(p_estate_id);
  return to_jsonb(r);
end;
$$;
