-- Workflow rules: item codes, inventory numbers, version conflicts, sealed
-- and open up-for-grabs rounds, approval rules, completion and custody,
-- holds, and duplicate merging.
begin;
\ir _helpers.psql
select plan(42);

select tests.create_user('c0000000-0000-4000-8000-000000000001', 'ann@test.local', 'Ann Admin');
select tests.create_user('c0000000-0000-4000-8000-000000000002', 'ben@test.local', 'Ben Brother');
select tests.create_user('c0000000-0000-4000-8000-000000000003', 'cat@test.local', 'Cat Sister');

select tests.as_user('c0000000-0000-4000-8000-000000000001');
select tests.api('create_estate', '{"id":"e0000000-0000-4000-8000-0000000000c1","name":"Workflow estate","claim_mode":"SEALED","sealed_window_hours":24}');
create temp table inv as
  select 'ben' as who, tests.api('create_invite', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","email":"ben@test.local","role":"BENEFICIARY"}') ->> 'code' as code
  union all
  select 'cat', tests.api('create_invite', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","email":"cat@test.local","role":"BENEFICIARY"}') ->> 'code';
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select tests.api('accept_invite', jsonb_build_object('code', (select code from inv where who = 'ben')));
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select tests.api('accept_invite', jsonb_build_object('code', (select code from inv where who = 'cat')));

select is((select member_code from public.estate_members where user_id = 'c0000000-0000-4000-8000-000000000001'), 'AA',
  'member codes come from initials');

-- ------------------------------------------------------------- item codes
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select tests.api('create_location', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"d0000000-0000-4000-8000-000000000001","name":"Living room","kind":"AREA"}');
select tests.api('create_location', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"d0000000-0000-4000-8000-000000000002","parent_id":"d0000000-0000-4000-8000-000000000001","name":"Box 7","kind":"CONTAINER"}');
create temp table items as
  select 'sofa' as k, tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Green sofa',
           '{"category":"FUR","found_location_id":"d0000000-0000-4000-8000-000000000002"}') as r;

select is((select tag from public.locations where id = 'd0000000-0000-4000-8000-000000000001'), 'LR', 'room tags come from the name');
select matches((select r ->> 'item_code' from items where k = 'sofa'), '^0001AA-LR[0-9]FUR-[0-9A-HJKMNP-TV-Z]{3}$',
  'item code = number + member, room found + check digit + category, random');
select ok(private.valid_item_code((select r ->> 'item_code' from items where k = 'sofa')), 'generated code passes its check digit');
select ok(not private.valid_item_code(overlay((select r ->> 'item_code' from items where k = 'sofa')
          placing ((substr((select r ->> 'item_code' from items where k = 'sofa'), 10, 1)::int + 1) % 10)::text from 10 for 1)),
  'a wrong check digit fails validation');
select is((select r ->> 'current_location_id' from items where k = 'sofa'), 'd0000000-0000-4000-8000-000000000002',
  'the item is stored where it was put (the box)');
select ok(private.valid_location_code((select code from public.locations where id = 'd0000000-0000-4000-8000-000000000002'), 'CONTAINER'),
  'location codes carry a valid check digit');

-- ------------------------------------------------------ inventory numbers
create temp table res as
  select tests.api('reserve_numbers', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","device_id":"phone-1","count":3}') as r;
select throws_ok(format($$select public.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"%s","inventory_number":1,"title":"Dup number"}')$$, gen_random_uuid()),
  'EI409', null, 'a used inventory number cannot be reused');
select throws_ok(format($$select public.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"%s","inventory_number":999,"title":"Unreserved"}')$$, gen_random_uuid()),
  'EI422', null, 'numbers must be reserved by the creating member');
select throws_ok(format($$select public.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"%s","inventory_number":%s,"title":"Bad code","item_code":"%sAA-XX0MSC-AAA"}')$$,
                        gen_random_uuid(), (select (r ->> 'first_number')::int from res), lpad((select r ->> 'first_number' from res), 4, '0')),
  'EI422', null, 'a code with a wrong check digit is rejected');
select lives_ok(format($$select tests.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"c1000000-0000-4000-8000-000000000001","inventory_number":%s,"title":"Lamp","category":"DEC"}')$$,
                       (select (r ->> 'first_number')::int from res)),
  'an item using a reserved number is created');
select lives_ok($$select tests.api('create_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","id":"c1000000-0000-4000-8000-000000000001","inventory_number":1,"title":"Replay"}')$$,
  'replaying the same create (same id) is harmless');
select is((select title from public.items where id = 'c1000000-0000-4000-8000-000000000001'), 'Lamp', 'the replay did not change the item');

-- ------------------------------------------------------- version conflicts
select lives_ok($$select tests.api('update_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","item_id":"c1000000-0000-4000-8000-000000000001","version":1,"changes":{"description":"Brass, works"}}')$$,
  'an edit with the current version succeeds');
select throws_ok($$select public.api('update_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","item_id":"c1000000-0000-4000-8000-000000000001","version":1,"changes":{"description":"Stale"}}')$$,
  'EI409', null, 'an edit based on an old version is refused, not silently applied');

-- --------------------------------------------------------- sealed rounds
create temp table rnd as
  select tests.api('open_round', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from items where k = 'sofa'))) as r;
select is((select r ->> 'mode' from rnd), 'SEALED', 'round takes the estate''s claim mode');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select tests.api('set_claim', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from items where k = 'sofa'),
                                                 'id', gen_random_uuid(), 'interest', 'INTERESTED'));
select is((select status::text from public.items where id = (select (r ->> 'id')::uuid from items where k = 'sofa')), 'UP_FOR_GRABS',
  'a sealed claim does not change the item status');

set local role authenticated;
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*) from public.claims)::int, 0, 'other members cannot see a sealed claim');
select is((select count(*) from jsonb_array_elements(public.ledger_page('e0000000-0000-4000-8000-0000000000c1', 0, 500) -> 'entries') e
            where e ->> 'entity' = 'claims' and e ->> 'payload' is not null)::int, 0,
  'the history withholds sealed claim details from other members');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.claims)::int, 1, 'the claimant sees their own claim');
reset role;

select tests.as_user('c0000000-0000-4000-8000-000000000001');
select throws_ok(format($$select public.api('resolve_round', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","round_id":"%s","method":"SOLE_INTEREST"}')$$, (select r ->> 'id' from rnd)),
  'EI409', null, 'a sealed round cannot be settled before the reveal time');

-- ------------------------------------------- open round + self-dealing rule
select tests.api('update_estate', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","version":1,"changes":{"claim_mode":"OPEN"}}');
create temp table rnd2 as
  select tests.api('open_round', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', 'c1000000-0000-4000-8000-000000000001')) as r;
select tests.api('set_claim', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","item_id":"c1000000-0000-4000-8000-000000000001","id":"c2000000-0000-4000-8000-000000000001","interest":"INTERESTED"}');
select is((select status::text from public.items where id = 'c1000000-0000-4000-8000-000000000001'), 'CLAIM_REQUESTED',
  'an open claim shows on the item');
create temp table resolved as
  select tests.api('resolve_round', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'round_id', (select r ->> 'id' from rnd2), 'method', 'SOLE_INTEREST')) as r;
select is((select r -> 'proposal' ->> 'recipient_user_id' from resolved), 'c0000000-0000-4000-8000-000000000001',
  'sole interest creates an assignment proposal for that person');
select is((select r -> 'proposal' ->> 'rule' from resolved), 'MAJORITY',
  'when the only executor/administrator is the recipient, the others decide by majority');
select ok(not ('c0000000-0000-4000-8000-000000000001' = any (select jsonb_array_elements_text(r -> 'proposal' -> 'eligible_approvers') from resolved)),
  'nobody approves a proposal that gives an item to themselves');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select tests.api('decide', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'proposal_id', (select r -> 'proposal' ->> 'id' from resolved), 'decision', 'APPROVE'));
select is((select status::text from public.items where id = 'c1000000-0000-4000-8000-000000000001'), 'APPROVAL_PENDING',
  'one of two approvals is not a majority');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select tests.api('decide', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'proposal_id', (select r -> 'proposal' ->> 'id' from resolved), 'decision', 'APPROVE'));
select is((select status::text from public.items where id = 'c1000000-0000-4000-8000-000000000001'), 'ASSIGNED',
  'two of two approvals assigns the item');

-- --------------------------------------------------- completion + custody
select tests.api('complete_proposal', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1',
  'proposal_id', (select r -> 'proposal' ->> 'id' from resolved), 'notes', 'Picked up Saturday'));
select is((select status::text from public.items where id = 'c1000000-0000-4000-8000-000000000001'), 'DISTRIBUTED',
  'completing a handoff marks the item distributed');
select is((select l.kind::text from public.items i join public.locations l on l.id = i.current_location_id where i.id = 'c1000000-0000-4000-8000-000000000001'),
  'PERSON', 'the item is now in the recipient''s possession');
select is((select count(*) from public.custody_events where item_id = 'c1000000-0000-4000-8000-000000000001' and event_type = 'HANDOFF')::int, 1,
  'a handoff custody record exists');

-- ------------------------------------------------- executor rule + donation
select tests.as_user('c0000000-0000-4000-8000-000000000002');
create temp table vase as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Vase', '{"category":"DEC"}') as r;
create temp table don as
  select tests.api('create_proposal', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from vase),
                   'id', gen_random_uuid(), 'action', 'DONATE', 'organization', 'Habitat ReStore')) as r;
select is((select r ->> 'rule' from don), 'EXECUTOR', 'the default rule is executor approval');
select is((select cardinality(eligible_approvers) from public.proposals where id = (select (r ->> 'id')::uuid from don)), 1,
  'with no executor named, the administrator approves');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select tests.api('decide', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'proposal_id', (select r ->> 'id' from don), 'decision', 'APPROVE'));
select is((select status::text from public.items where id = (select (r ->> 'id')::uuid from vase)), 'APPROVED_FOR_DONATION', 'executor approval approves');
select tests.api('complete_proposal', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'proposal_id', (select r ->> 'id' from don), 'final_amount', 20));
select is((select status::text from public.items where id = (select (r ->> 'id')::uuid from vase)), 'DONATED', 'completion marks it donated');
select is((select amount from public.valuations where item_id = (select (r ->> 'id')::uuid from vase) and valuation_type = 'DONATION_VALUE'), 20.00::numeric,
  'the donation value is recorded as its own valuation');

-- ---------------------------------------------------- thresholds and holds
select tests.api('update_estate', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","version":2,"changes":{"auto_approve_below":100,"unanimous_above":1000}}');
create temp table cheap as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Mixing bowls', '{"category":"KIT"}') as r;
select tests.api('add_valuation', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from cheap), 'valuation_type', 'FAMILY_ESTIMATE', 'amount', 15));
select is((tests.api('create_proposal', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from cheap), 'id', gen_random_uuid(), 'action', 'DONATE')) ->> 'auto_approved')::boolean,
  true, 'items valued below the threshold are approved automatically');
create temp table dear as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Diamond ring', '{"category":"JWL"}') as r;
select tests.api('add_valuation', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from dear), 'valuation_type', 'FORMAL_APPRAISAL', 'amount', 4000));
select is(tests.api('create_proposal', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from dear), 'id', gen_random_uuid(), 'action', 'SELL', 'amount', 3500)) ->> 'rule',
  'UNANIMOUS', 'items above the high-value threshold need unanimous approval');
create temp table held as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Matched dining chairs', '{"category":"FUR","do_not_move":true,"do_not_move_reason":"Set of 8; keep together"}') as r;
select throws_ok(format($$select public.api('create_proposal', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","item_id":"%s","id":"%s","action":"SELL"}')$$, (select r ->> 'id' from held), gen_random_uuid()),
  'EI409', null, 'a "hold in place" item cannot be proposed for sale');

-- --------------------------------------------------------------- duplicates
create temp table d1 as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Blue lamp', '{"category":"DEC","barcode":"012345678905"}') as r;
create temp table d2 as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Blue lamp', '{"category":"DEC","barcode":"012345678905"}') as r;
select tests.api('review_duplicate', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'id', gen_random_uuid(),
  'item_id', (select r ->> 'id' from d2), 'other_item_id', (select r ->> 'id' from d1), 'verdict', 'SAME_ITEM', 'reasons', '["BARCODE"]'::jsonb));
select is((select status::text from public.items where id = (select (r ->> 'id')::uuid from d2)), 'MERGED', 'a confirmed duplicate is marked merged, not deleted');
select is((select merged_into_id::text from public.items where id = (select (r ->> 'id')::uuid from d2)), (select r ->> 'id' from d1), 'it points at the record it merged into');
select throws_ok(format($$select public.api('update_item', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","item_id":"%s","version":2,"changes":{"title":"x"}}')$$, (select r ->> 'id' from d2)),
  'EI409', null, 'a merged record cannot be edited');

-- -------------------------------------------------------------- random draw
select tests.api('update_estate', '{"estate_id":"e0000000-0000-4000-8000-0000000000c1","version":3,"changes":{"auto_approve_below":null,"unanimous_above":null}}');
create temp table drawn as select tests.new_item('e0000000-0000-4000-8000-0000000000c1', 'Cuckoo clock', '{"category":"DEC"}') as r;
create temp table rnd3 as
  select tests.api('open_round', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from drawn))) as r;
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select tests.api('set_claim', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from drawn), 'id', gen_random_uuid(), 'interest', 'INTERESTED'));
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select tests.api('set_claim', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'item_id', (select r ->> 'id' from drawn), 'id', gen_random_uuid(), 'interest', 'INTERESTED'));
create temp table draw as
  select tests.api('resolve_round', jsonb_build_object('estate_id', 'e0000000-0000-4000-8000-0000000000c1', 'round_id', (select r ->> 'id' from rnd3), 'method', 'RANDOM_DRAW')) -> 'resolution' as r;
select is(
  (select r ->> 'winner_user_id' from draw),
  (select (r -> 'draw_candidates') ->> ((('x' || lpad(substr(encode(extensions.digest(convert_to(r ->> 'draw_seed', 'UTF8'), 'sha256'), 'hex'), 1, 8), 16, '0'))::bit(64)::bigint
                                          % jsonb_array_length(r -> 'draw_candidates'))::int) from draw),
  'anyone can re-check a random draw from its recorded seed');

select * from finish();
rollback;
