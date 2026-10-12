-- Access control: estates are isolated from each other, sealed claims stay
-- sealed, and API roles cannot write to tables directly.
begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('a0000000-0000-4000-8000-000000000001', 'owner@test.local', 'Olive Owner');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'sib@test.local', 'Sam Sibling');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'other@test.local', 'Otto Outsider');

-- Owner creates estate A and invites the sibling; the outsider creates estate B.
select tests.as_user('a0000000-0000-4000-8000-000000000001');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-00000000000a","name":"Estate A"}');
select tests.new_item('e0000000-0000-4000-8000-00000000000a', 'Family Bible', '{"category":"BKS"}');
create temp table invite as
  select tests.api('create_invite', '{"estate_id":"e0000000-0000-4000-8000-00000000000a","email":"sib@test.local"}') as r;
select tests.as_user('a0000000-0000-4000-8000-000000000002');
select tests.api('accept_invite', jsonb_build_object('code', (select r ->> 'code' from invite)));
select tests.as_user('a0000000-0000-4000-8000-000000000003');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-00000000000b","name":"Estate B"}');

-- ---------------------------------------------------------------- isolation
set local role authenticated;
select tests.as_user('a0000000-0000-4000-8000-000000000003');
select is((select count(*) from public.items where estate_id = 'e0000000-0000-4000-8000-00000000000a')::int, 0,
  'outsider cannot see another estate''s items');
select is((select count(*) from public.estates)::int, 1, 'outsider sees only their own estate');
select is((select count(*) from public.profiles where id = 'a0000000-0000-4000-8000-000000000001')::int, 0,
  'outsider cannot read profiles of people in other estates');

select tests.as_user('a0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.items)::int, 1, 'sibling sees estate A items');
select is((select count(*) from public.estate_invites)::int, 0, 'non-managers cannot read invitations');

-- --------------------------------------------------------- no direct writes
select throws_ok(
  $$insert into public.items (id, estate_id, inventory_number, item_code, title, created_by)
    values (gen_random_uuid(), 'e0000000-0000-4000-8000-00000000000a', 99, '0099SS-XX0MSC-AAA', 'x', auth.uid())$$,
  '42501', null, 'members cannot insert items directly');
select throws_ok(
  $$update public.estates set name = 'Hijacked' where id = 'e0000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'members cannot update estates directly');
select throws_ok(
  $$select * from public.ledger$$,
  '42501', null, 'members cannot read the raw ledger table');
select lives_ok(
  $$update public.profiles set display_name = 'Sam S.' where id = auth.uid()$$,
  'members can update their own profile name');

-- ------------------------------------------------------- API permission checks
select tests.as_user('a0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-00000000000a","id":"c0000000-0000-4000-8000-000000000001","inventory_number":5,"title":"Sneaky"}')$$,
  'EI403', null, 'outsider cannot add items to estate A through the API');
select throws_ok(
  $$select public.ledger_page('e0000000-0000-4000-8000-00000000000a', 0, 10)$$,
  'EI403', null, 'outsider cannot read estate A history');
select throws_ok(
  $$select public.pull_changes('e0000000-0000-4000-8000-00000000000a', '0')$$,
  'EI403', null, 'outsider cannot sync estate A');
select ok(not private.can_read_media('e0000000-0000-4000-8000-00000000000a/' || repeat('a', 64) || '.jpg'),
  'outsider cannot read estate A files');

select tests.as_user('a0000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.api('update_estate', '{"estate_id":"e0000000-0000-4000-8000-00000000000a","version":1,"changes":{"approval_rule":"MAJORITY"}}')$$,
  'EI403', null, 'a beneficiary cannot change estate rules');
select ok(private.can_read_media('e0000000-0000-4000-8000-00000000000a/' || repeat('a', 64) || '.jpg'),
  'members can read their estate''s files');

reset role;
set local role anon;
select throws_ok(
  $$select public.api('create_estate', '{"name":"Anon estate"}')$$,
  '42501', null, 'signed-out callers cannot call the API');

select * from finish();
rollback;
