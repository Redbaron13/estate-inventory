-- =============================================================================
-- Performance: evaluate the caller's id once per query, not once per row,
-- in the three policies that use auth.uid() directly (Supabase advisor
-- "auth_rls_initplan"). Same rules, same results.
-- =============================================================================

alter policy "read own and co-member profiles" on public.profiles
  using (id = (select auth.uid()) or private.shares_estate(id));

alter policy "update own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "members read claims after reveal" on public.claims
  using (private.is_member(estate_id) and (user_id = (select auth.uid()) or private.round_revealed(round_id)));
