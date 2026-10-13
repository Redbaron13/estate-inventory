-- Human-readable estate code, EST-YYYY-HEX8. Added nullable so existing rows
-- are untouched by a bulk edit; new estates get a code from the default and
-- existing ones are filled in once. Idempotent.
alter table public.estates add column if not exists estate_code text;

alter table public.estates alter column estate_code set default (
  'EST-' || to_char(now() at time zone 'utc', 'YYYY') || '-' ||
  upper(substr(encode(extensions.digest(convert_to(gen_random_uuid()::text, 'UTF8'), 'sha256'), 'hex'), 1, 8))
);

update public.estates
   set estate_code = 'EST-' || to_char(created_at at time zone 'utc', 'YYYY') || '-' ||
       upper(substr(encode(extensions.digest(convert_to(id::text || ':' || created_at::text, 'UTF8'), 'sha256'), 'hex'), 1, 8))
 where estate_code is null;

create unique index if not exists idx_estates_estate_code on public.estates (estate_code);

do $$ begin
  alter table public.estates add constraint estates_estate_code_format
    check (estate_code is null or estate_code ~ '^EST-[0-9]{4}-[0-9A-F]{8}$');
exception when duplicate_object then null; end $$;
