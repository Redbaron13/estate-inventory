-- =============================================================================
-- LOCAL DEVELOPMENT SEED ONLY. Never run against a hosted project.
-- Creates three demo members (password: estate-demo-pass) and a demo estate.
--   alex@example.com   administrator
--   blair@example.com  beneficiary
--   casey@example.com  beneficiary
-- =============================================================================

create or replace function pg_temp.seed_user(p_id uuid, p_email text, p_name text) returns void
language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('estate-demo-pass', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p_name), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
$$;

create or replace function pg_temp.act_as(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', (select email from auth.users where id = p_id))::text, false);
$$;

create or replace function pg_temp.api(p_fn text, p_args jsonb) returns jsonb
language sql as $$ select (public.api(p_fn, p_args) -> 'result') $$;

select pg_temp.seed_user('11111111-1111-4111-8111-111111111111', 'alex@example.com', 'Alex Morgan');
select pg_temp.seed_user('22222222-2222-4222-8222-222222222222', 'blair@example.com', 'Blair Morgan');
select pg_temp.seed_user('33333333-3333-4333-8333-333333333333', 'casey@example.com', 'Casey Morgan');

do $$
declare
  v_estate uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  v_alex uuid := '11111111-1111-4111-8111-111111111111';
  v_blair uuid := '22222222-2222-4222-8222-222222222222';
  v_casey uuid := '33333333-3333-4333-8333-333333333333';
  v_house uuid;
  v_living uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_kitchen uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_basement uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_stage_donate uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  v_box uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  v_res jsonb;
  v_code text;
  v_first integer;
  i integer;
  v_titles text[] := array[
    'Dining room table', 'Brass floor lamp', 'Box of paperback books', 'Grandfather clock',
    'China cabinet', 'Pearl necklace', 'Kitchen mixer', 'Oil painting of the shore'
  ];
  v_locs uuid[];
  v_cats text[] := array['FUR', 'DEC', 'BKS', 'FUR', 'FUR', 'JWL', 'APL', 'ART'];
begin
  perform pg_temp.act_as(v_alex);
  perform pg_temp.api('create_estate', jsonb_build_object(
    'id', v_estate, 'name', 'Estate of Margaret Morgan (demo)', 'decedent_name', 'Margaret Morgan',
    'date_of_death', '2026-08-30', 'approval_rule', 'EXECUTOR', 'claim_mode', 'SEALED',
    'sealed_window_hours', 48, 'help_contact_name', 'Alex', 'help_contact_phone', '555-0100'));
  select id into v_house from public.locations where estate_id = v_estate and kind = 'PROPERTY';

  perform pg_temp.api('create_location', jsonb_build_object('estate_id', v_estate, 'id', v_living, 'parent_id', v_house, 'name', 'Living room', 'kind', 'AREA'));
  perform pg_temp.api('create_location', jsonb_build_object('estate_id', v_estate, 'id', v_kitchen, 'parent_id', v_house, 'name', 'Kitchen', 'kind', 'AREA'));
  perform pg_temp.api('create_location', jsonb_build_object('estate_id', v_estate, 'id', v_basement, 'parent_id', v_house, 'name', 'Basement', 'kind', 'AREA'));
  perform pg_temp.api('create_location', jsonb_build_object('estate_id', v_estate, 'id', v_stage_donate, 'parent_id', v_basement, 'name', 'Donate pile', 'kind', 'STAGING', 'purpose', 'Items approved for donation'));
  perform pg_temp.api('create_location', jsonb_build_object('estate_id', v_estate, 'id', v_box, 'parent_id', v_stage_donate, 'name', 'Box 1', 'kind', 'CONTAINER'));

  -- Invite and accept for Blair and Casey.
  v_res := pg_temp.api('create_invite', jsonb_build_object('estate_id', v_estate, 'email', 'blair@example.com', 'role', 'BENEFICIARY'));
  v_code := v_res ->> 'code';
  perform pg_temp.act_as(v_blair);
  perform pg_temp.api('accept_invite', jsonb_build_object('code', v_code));
  perform pg_temp.act_as(v_alex);
  v_res := pg_temp.api('create_invite', jsonb_build_object('estate_id', v_estate, 'email', 'casey@example.com', 'role', 'BENEFICIARY'));
  v_code := v_res ->> 'code';
  perform pg_temp.act_as(v_casey);
  perform pg_temp.api('accept_invite', jsonb_build_object('code', v_code));

  -- Alex records eight items.
  perform pg_temp.act_as(v_alex);
  v_res := pg_temp.api('reserve_numbers', jsonb_build_object('estate_id', v_estate, 'device_id', 'seed', 'count', 20));
  v_first := (v_res ->> 'first_number')::integer;
  v_locs := array[v_living, v_living, v_basement, v_living, v_living, v_house, v_kitchen, v_living];
  for i in 1 .. array_length(v_titles, 1) loop
    perform pg_temp.api('create_item', jsonb_build_object(
      'estate_id', v_estate,
      'id', ('bbbbbbbb-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      'inventory_number', v_first + i - 1,
      'title', v_titles[i],
      'category', v_cats[i],
      'found_location_id', v_locs[i],
      'potentially_valuable', v_titles[i] in ('Grandfather clock', 'Pearl necklace', 'Oil painting of the shore'),
      'barcode', case when v_titles[i] = 'Kitchen mixer' then '0050946872667' end
    ));
  end loop;

  perform pg_temp.api('add_valuation', jsonb_build_object('estate_id', v_estate, 'item_id', 'bbbbbbbb-0000-4000-8000-000000000004',
    'valuation_type', 'FAMILY_ESTIMATE', 'amount', 1500, 'source', 'Similar listings online'));
  perform pg_temp.api('add_valuation', jsonb_build_object('estate_id', v_estate, 'item_id', 'bbbbbbbb-0000-4000-8000-000000000006',
    'valuation_type', 'FORMAL_APPRAISAL', 'amount', 2200, 'appraiser_name', 'Shore Appraisals'));

  -- The grandfather clock goes up for grabs (sealed for 48 hours).
  perform pg_temp.api('open_round', jsonb_build_object('estate_id', v_estate, 'item_id', 'bbbbbbbb-0000-4000-8000-000000000004'));
  perform pg_temp.act_as(v_blair);
  perform pg_temp.api('set_claim', jsonb_build_object('estate_id', v_estate, 'item_id', 'bbbbbbbb-0000-4000-8000-000000000004',
    'id', gen_random_uuid(), 'interest', 'INTERESTED', 'note', 'I always wound it with Mom.'));

  -- Casey proposes donating the paperbacks.
  perform pg_temp.act_as(v_casey);
  perform pg_temp.api('create_proposal', jsonb_build_object('estate_id', v_estate, 'item_id', 'bbbbbbbb-0000-4000-8000-000000000003',
    'id', gen_random_uuid(), 'action', 'DONATE', 'organization', 'Public library book sale', 'reason', 'Nobody wants them.'));

  perform set_config('request.jwt.claims', '', false);
end;
$$;
