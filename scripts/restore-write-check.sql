-- Restore drill: record one item through the normal API path as a real
-- restored manager, the same way a phone does (reserve a number, then
-- create the item with a device-generated id). Proves auth identities,
-- membership, permissions, item numbering, the code generator and the
-- history trigger all work after a restore. Only ever run against a
-- throwaway restored copy.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

select set_config('request.jwt.claims',
         json_build_object('sub', m.user_id, 'role', 'authenticated')::text, false),
       set_config('drill.estate', m.estate_id::text, false)
  from public.estate_members m
 where m.role in ('ADMINISTRATOR', 'EXECUTOR') and m.is_active and m.removed_at is null
 order by m.joined_at
 limit 1
\gset ignored_

set role authenticated;

select (public.api('reserve_numbers',
          jsonb_build_object('estate_id', current_setting('drill.estate'), 'device_id', 'restore-drill', 'count', 1),
          gen_random_uuid()::text, 'restore-drill') -> 'result' ->> 'first_number') as drill_number
\gset

select 'Recorded drill item ' || (public.api('create_item',
         jsonb_build_object(
           'id', gen_random_uuid(),
           'estate_id', current_setting('drill.estate'),
           'inventory_number', :drill_number,
           'title', 'Restore drill check',
           'category', 'MSC',
           'device_id', 'restore-drill'),
         gen_random_uuid()::text, 'restore-drill') -> 'result' ->> 'item_code');

reset role;
