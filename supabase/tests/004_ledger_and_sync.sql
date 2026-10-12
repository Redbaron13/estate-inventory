-- The history chain detects tampering, and sync returns what a device needs.
begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('f0000000-0000-4000-8000-000000000001', 'led@test.local', 'Lee Ledger');
select tests.as_user('f0000000-0000-4000-8000-000000000001');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-0000000000f1","name":"Ledger estate"}');
select tests.new_item('e0000000-0000-4000-8000-0000000000f1', 'Rocking chair', '{"category":"FUR"}');
select tests.new_item('e0000000-0000-4000-8000-0000000000f1', 'Quilt', '{"category":"LIN"}');

select ok((select ok from private.verify_ledger('e0000000-0000-4000-8000-0000000000f1')), 'an untouched history verifies');
select is((select count(*) from public.ledger where estate_id = 'e0000000-0000-4000-8000-0000000000f1' and entity = 'items')::int, 2,
  'every item creation is in the history');
select is((select prev_hash from public.ledger where estate_id = 'e0000000-0000-4000-8000-0000000000f1' and estate_seq = 1), repeat('0', 64),
  'the chain starts from a zero hash');

-- Sync
create temp table pulled as select public.pull_changes('e0000000-0000-4000-8000-0000000000f1', '0') as r;
select is(jsonb_array_length((select r -> 'items' from pulled)), 2, 'a first sync returns every item');
select ok((select r ->> 'cursor' from pulled) is not null, 'sync returns a cursor for next time');
select is((select r -> 'ledger_head' ->> 'hash' from pulled),
          (select hash from public.ledger where estate_id = 'e0000000-0000-4000-8000-0000000000f1' order by estate_seq desc limit 1),
          'sync includes the current history fingerprint');
select is(jsonb_array_length((select r -> 'locations' from pulled)), 2, 'the house and holding area come with a new estate');

-- Tampering (simulating someone with database-owner access rewriting history)
alter table public.ledger disable trigger ledger_append_only;
update public.ledger set payload = replace(payload, 'Rocking chair', 'Folding chair')
 where estate_id = 'e0000000-0000-4000-8000-0000000000f1' and payload like '%Rocking chair%';
alter table public.ledger enable trigger ledger_append_only;

select ok(not (select ok from private.verify_ledger('e0000000-0000-4000-8000-0000000000f1')), 'an edited history fails verification');
select ok((select first_bad_seq from private.verify_ledger('e0000000-0000-4000-8000-0000000000f1')) is not null,
  'verification points at the first altered entry');

select * from finish();
rollback;
