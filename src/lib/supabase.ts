import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

// Used for sign-in, realtime change signals, and reading/caching photos.
// All writes go through the /api/v1 function (src/lib/api.ts).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'estate-inventory-auth',
  },
});

/** Current access token, refreshed if needed. Null when signed out or offline with an expired token. */
export async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
