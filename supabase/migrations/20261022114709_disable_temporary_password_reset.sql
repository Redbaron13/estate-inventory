-- Retire the legacy administrator password-reset bypass. Account recovery and
-- password changes must go through Supabase Auth's verified user flows.
drop function if exists public.reset_temp_password(text, text);
