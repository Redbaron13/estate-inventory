begin;
\ir _helpers.psql
select plan(3);
select tests.create_user('b0000000-0000-4000-8000-000000000006', 'code@test.local', 'Code Tester');
select tests.as_user('b0000000-0000-4000-8000-000000000006');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-0000000000c6","name":"Code estate"}');
select matches((select estate_code from public.estates where id = 'e0000000-0000-4000-8000-0000000000c6'), '^EST-[0-9]{4}-[0-9A-F]{8}$', 'new estate gets a code');
select is((select count(*)::int from public.estates where estate_code is null), 0, 'no estate lacks a code');
select has_index('public', 'estates', 'idx_estates_estate_code', 'code is unique-indexed');
select * from finish();
rollback;
