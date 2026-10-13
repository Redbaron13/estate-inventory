-- Estate ID (18 characters, built by the app from date of death, name and
-- sequence; see supabase/functions/_shared/estate-id.ts). Nullable so existing
-- estates are untouched. Idempotent.
alter table public.estates add column if not exists estate_code text;

create unique index if not exists idx_estates_estate_code on public.estates (estate_code);

do $$ begin
  alter table public.estates add constraint estates_estate_code_format
    check (estate_code is null or estate_code ~ '^[0-9A-F]{5}[A-Z]{5}[A-Z][0-9]{3}[0-9A-Z]{4}$');
exception when duplicate_object then null; end $$;
