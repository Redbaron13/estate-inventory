-- Permanent records: nothing can be edited or deleted outside the workflow
-- functions, not even by the database owner role used here.
begin;
\ir _helpers.psql
select plan(10);

select tests.create_user('b0000000-0000-4000-8000-000000000001', 'imm@test.local', 'Ima Mutable');
select tests.as_user('b0000000-0000-4000-8000-000000000001');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-0000000000b1","name":"Immutable estate"}');
create temp table it as select tests.new_item('e0000000-0000-4000-8000-0000000000b1', 'Silver tea set', '{"category":"CHN"}') as r;
select tests.api('add_valuation', jsonb_build_object(
  'estate_id', 'e0000000-0000-4000-8000-0000000000b1', 'item_id', (select r ->> 'id' from it),
  'valuation_type', 'FAMILY_ESTIMATE', 'amount', 300));

select throws_ok($$update public.valuations set amount = 1 where estate_id = 'e0000000-0000-4000-8000-0000000000b1'$$, 'EI423', null, 'valuations cannot be edited');
select throws_ok($$delete from public.valuations$$, 'EI423', null, 'valuations cannot be deleted');
select throws_ok($$delete from public.items$$, 'EI423', null, 'items cannot be deleted');
select throws_ok($$truncate public.items cascade$$, 'EI423', null, 'items cannot be truncated');
select throws_ok($$delete from public.estate_members$$, 'EI423', null, 'memberships cannot be deleted (only deactivated)');
select throws_ok($$update public.ledger set payload = '{}'$$, 'EI423', null, 'ledger entries cannot be edited');
select throws_ok($$delete from public.ledger$$, 'EI423', null, 'ledger entries cannot be deleted');
select throws_ok($$delete from public.profiles$$, 'EI423', null, 'profiles cannot be deleted');

-- A correction is a new record that points at the old one.
select lives_ok($$
  select tests.api('add_valuation', jsonb_build_object(
    'estate_id', 'e0000000-0000-4000-8000-0000000000b1', 'item_id', (select r ->> 'id' from it),
    'valuation_type', 'FAMILY_ESTIMATE', 'amount', 350,
    'supersedes_id', (select id from public.valuations where item_id = (select (r ->> 'id')::uuid from it) limit 1)))
$$, 'a corrected value is added as a new record');
select is((select count(*) from public.valuations where item_id = (select (r ->> 'id')::uuid from it))::int, 2,
  'both the original and the correction remain');

select * from finish();
rollback;
