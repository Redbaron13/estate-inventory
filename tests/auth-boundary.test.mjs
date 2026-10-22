import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthBoundary } from '../scripts/verify-auth-boundary.mjs';

test('security smoke requires the missing-function response, not just any 404', async () => {
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'public-test-key' };
  await verifyAuthBoundary(env, async (_url, options) => {
    assert.equal(JSON.parse(options.body).p_email, 'security-check@example.invalid');
    return { status: 404, json: async () => ({ code: 'PGRST202' }) };
  });
  for (const [status, code] of [[200, undefined], [404, 'OTHER'], [400, 'EI403']]) {
    await assert.rejects(verifyAuthBoundary(env, async () => ({ status, json: async () => ({ code }) })), /still exposed/);
  }
});
