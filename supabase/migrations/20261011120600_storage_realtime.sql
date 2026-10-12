-- =============================================================================
-- File storage and realtime change signals.
--
-- Bucket "estate-media" is private. Paths are content-addressed:
--   {estate_id}/{sha256}.{jpg|png|webp|heic|pdf}
-- Members may upload new files and read files of their estates. There are no
-- UPDATE or DELETE policies, so files cannot be overwritten or removed through
-- the API. Redacted files stop being readable.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estate-media', 'estate-media', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create or replace function private.media_path_estate(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(jpg|png|webp|heic|pdf)$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

create or replace function private.can_upload_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.estate_members m
     where m.estate_id = private.media_path_estate(p_name)
       and m.user_id = auth.uid()
       and m.is_active
       and (m.can_add_items or m.can_edit_items)
  );
$$;

create or replace function private.can_read_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(private.media_path_estate(p_name))
     and not exists (
       select 1
         from public.redactions r
         join public.media md on md.id = r.media_id
        where md.storage_path = p_name or md.thumb_path = p_name
     );
$$;

create policy "estate members upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'estate-media' and private.can_upload_media(name));

create policy "estate members read media" on storage.objects
  for select to authenticated
  using (bucket_id = 'estate-media' and private.can_read_media(name));

-- ---------------------------------------------------------------------------
-- Realtime: devices subscribe to the private channel "estate:{id}" and get a
-- tiny "changed" signal from the ledger trigger, then pull. Only members may
-- receive an estate's signals.
-- ---------------------------------------------------------------------------
create or replace function private.can_receive_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^estate:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_member(substring(p_topic from 8)::uuid)
    else false
  end;
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "estate members receive change signals" on realtime.messages
        for select to authenticated
        using (realtime.messages.extension = 'broadcast' and private.can_receive_topic(realtime.topic()))
    $p$;
  end if;
end;
$$;
