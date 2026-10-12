-- =============================================================================
-- Reset temporary password for kevinbaron13@gmail.com
-- Sets temporary password to 'testpasswordchangeme'.
-- When the reset password flag is enabled on deployment, the app can call this
-- function to restore 'testpasswordchangeme', while preserving the user's
-- last password otherwise.
-- =============================================================================

create or replace function public.reset_temp_password(p_email text, p_temp_password text)
returns jsonb
language plpgsql
security definer
set search_path = extensions, auth, public, pg_temp
as $$
declare
  v_user_id uuid;
  v_normalized_email text := lower(trim(p_email));
begin
  if v_normalized_email <> 'kevinbaron13@gmail.com' then
    raise exception 'Unauthorized email for password reset' using errcode = 'EI403';
  end if;

  if p_temp_password <> 'testpasswordchangeme' then
    raise exception 'Invalid temporary password' using errcode = 'EI400';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_normalized_email;

  if v_user_id is not null then
    update auth.users
    set encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = v_user_id;
  else
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_normalized_email,
      extensions.crypt(p_temp_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', 'Kevin Baron'), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', v_normalized_email, 'email_verified', true), 'email', now(), now(), now());
  end if;

  return jsonb_build_object('ok', true, 'email', v_normalized_email);
end;
$$;

grant execute on function public.reset_temp_password(text, text) to anon, authenticated;

-- Ensure kevinbaron13@gmail.com has the revised temporary password immediately upon migration
select public.reset_temp_password('kevinbaron13@gmail.com', 'testpasswordchangeme');
