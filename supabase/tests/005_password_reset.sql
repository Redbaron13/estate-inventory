-- Password recovery must never expose a public administrator reset function.
begin;
\ir _helpers.psql
select plan(3);

select is(
  to_regprocedure('public.reset_temp_password(text,text)')::text,
  null::text,
  'legacy administrator reset function is absent'
);

set local role anon;
select throws_ok(
  $$select public.reset_temp_password('security-check@example.invalid', 'verification-only')$$,
  '42883', null,
  'anonymous callers cannot invoke the retired password reset'
);

set local role authenticated;
select throws_ok(
  $$select public.reset_temp_password('security-check@example.invalid', 'verification-only')$$,
  '42883', null,
  'signed-in callers cannot invoke the retired password reset'
);
reset role;
select * from finish();
rollback;
