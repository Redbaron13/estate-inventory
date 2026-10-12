-- =============================================================================
-- Privileges. Applied last so it covers every object above.
--
-- * anon (signed-out) gets nothing.
-- * authenticated may SELECT estate tables (Row Level Security filters rows),
--   update a few columns of its own profile, and execute the public entry
--   points. It cannot INSERT, UPDATE or DELETE estate tables directly.
-- * Future objects get no automatic grants: each new migration must grant
--   explicitly (see docs/PIPELINE.md, "Database changes").
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant select on
  public.profiles,
  public.estates,
  public.estate_members,
  public.estate_invites,
  public.locations,
  public.items,
  public.number_reservations,
  public.number_voids,
  public.media,
  public.media_verifications,
  public.valuations,
  public.proposals,
  public.proposal_decisions,
  public.decision_invalidations,
  public.proposal_outcomes,
  public.custody_events,
  public.proposal_completions,
  public.proposal_cancellations,
  public.grab_rounds,
  public.grab_resolutions,
  public.claims,
  public.duplicate_reviews,
  public.redactions
to authenticated;

grant update (display_name, phone, large_text, simplified_mode) on public.profiles to authenticated;

grant execute on function public.api(text, jsonb, text, text) to authenticated;
grant execute on function public.my_estates() to authenticated;
grant execute on function public.pull_changes(uuid, text) to authenticated;
grant execute on function public.ledger_page(uuid, bigint, integer) to authenticated;
grant execute on function public.verify_ledger(uuid) to authenticated;

-- Helpers referenced by RLS and storage policies run as the caller.
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.is_manager(uuid) to authenticated;
grant execute on function private.shares_estate(uuid) to authenticated;
grant execute on function private.round_revealed(uuid) to authenticated;
grant execute on function private.fail(text, text, jsonb) to authenticated;
grant execute on function private.media_path_estate(text) to authenticated;
grant execute on function private.can_upload_media(text) to authenticated;
grant execute on function private.can_read_media(text) to authenticated;
grant execute on function private.can_receive_topic(text) to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
