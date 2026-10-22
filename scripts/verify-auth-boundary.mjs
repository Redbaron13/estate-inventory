import { pathToFileURL } from 'node:url';

export async function verifyAuthBoundary(env = process.env, request = fetch) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Missing public API configuration.');
  // Invalid non-owner address: even the retired implementation could not reset
  // a real account with this probe. Do not send an administrator email/password.
  const response = await request(`${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/reset_temp_password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: 'security-check@example.invalid', p_temp_password: 'verification-only' }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (response.status !== 404 || body.code !== 'PGRST202') throw new Error('The retired password-reset RPC is still exposed or its schema cache is stale.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (let attempt = 0; ; attempt++) {
    try { await verifyAuthBoundary(); break; }
    catch (error) { if (attempt >= 9) throw error; await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  console.log('Verified: anonymous API callers cannot find the retired password-reset RPC.');
}
