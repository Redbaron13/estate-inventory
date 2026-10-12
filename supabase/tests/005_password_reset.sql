-- Password reset logic test: kevinbaron13@gmail.com temporary password reset
begin;
\ir _helpers.psql
select plan(4);

-- Valid reset for kevinbaron13@gmail.com
select is(
  (select public.reset_temp_password('kevinbaron13@gmail.com', 'testpasswordchangeme') ->> 'ok'),
  'true',
  'reset_temp_password succeeds for kevinbaron13@gmail.com'
);

-- Verified password hash matches
select is(
  (select encrypted_password = extensions.crypt('testpasswordchangeme', encrypted_password)
   from auth.users where email = 'kevinbaron13@gmail.com'),
  true,
  'password hash in auth.users matches testpasswordchangeme'
);

-- Unauthorized email fails with EI403
select throws_ok(
  $$select public.reset_temp_password('otheruser@example.com', 'testpasswordchangeme')$$,
  'EI403',
  null,
  'unauthorized email cannot be reset'
);

-- Invalid temporary password fails with EI400
select throws_ok(
  $$select public.reset_temp_password('kevinbaron13@gmail.com', 'wrongpassword')$$,
  'EI400',
  null,
  'invalid temporary password is rejected'
);

select * from finish();
rollback;
