-- Generates idempotent SQL that recreates this app's objects attached to
-- Supabase-managed schemas (auth, storage, realtime). `supabase db dump`
-- skips those schemas entirely, so without this a restored database would
-- have the data but no photo upload/read rules, no live-update rule and no
-- profile creation for new sign-ups.
--
-- Usage (backup.yml):  psql "$DB_URL" -At -f scripts/dump-platform-hooks.sql > hooks.sql
-- Restore order:       roles.sql, schema.sql, data.sql, hooks.sql
\set ON_ERROR_STOP on
select '-- Platform hooks generated ' || now()::text;
select 'begin;';

-- Row-level security policies on managed tables
select format(
  E'drop policy if exists %I on %I.%I;\ncreate policy %I on %I.%I as %s for %s to %s%s%s;',
  policyname, schemaname, tablename,
  policyname, schemaname, tablename,
  permissive, cmd,
  (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
  case when qual is not null then E'\n  using (' || qual || ')' else '' end,
  case when with_check is not null then E'\n  with check (' || with_check || ')' else '' end)
from pg_policies
where schemaname in ('auth', 'storage', 'realtime')
order by schemaname, tablename, policyname;

-- Triggers on managed tables that call this app's functions
select format(E'drop trigger if exists %I on %I.%I;\n%s;',
  t.tgname, n.nspname, c.relname, pg_get_triggerdef(t.oid))
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where n.nspname in ('auth', 'storage', 'realtime')
  and not t.tgisinternal
  and pn.nspname not in ('auth', 'storage', 'realtime')
order by n.nspname, c.relname, t.tgname;

select 'commit;';
