begin;
\ir _helpers.psql
select plan(2);
select has_index('public', 'estates', 'idx_estates_estate_code', 'estate id is unique-indexed');
select throws_ok($$insert into public.estates (name, created_by, estate_code) values ('x', gen_random_uuid(), 'bad')$$, null, null, 'malformed estate id is rejected');
select * from finish();
rollback;
