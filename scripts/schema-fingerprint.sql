select md5(string_agg(x, E'\n' order by x)) as fingerprint, count(*) as objects from (
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 'C ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || md5(pg_get_constraintdef(c.oid))
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('public', 'private')
  union all
  select 'P ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || md5(coalesce(qual, '') || coalesce(with_check, ''))
    from pg_policies where schemaname in ('public', 'private', 'storage', 'realtime')
  union all
  select 'T ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and (n.nspname in ('public', 'private') or t.tgname like 'on_auth_user%')
  union all
  select 'A ' || a.attrelid::regclass::text || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
) s;
