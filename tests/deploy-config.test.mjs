import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authPatch, configureAuth } from '../scripts/configure-deploy.mjs';

test('default sender release preserves security and avoids restricted templates', () => {
  const patch = authPatch({ uri_allow_list: 'https://existing.example/callback', mailer_autoconfirm: false }, 'https://app.example/', 'code');
  assert.deepEqual(patch, { site_url: 'https://app.example/', uri_allow_list: 'https://existing.example/callback,https://app.example/', mailer_otp_length: 6, mailer_otp_exp: 900 });
  assert.throws(() => authPatch({}, 'http://app.example/', ''), /HTTPS/);
});
test('custom sender receives both code templates', () => {
  const patch = authPatch({ smtp_host: 'smtp.example', uri_allow_list: 'https://app.example/' }, 'https://app.example/', 'code');
  assert.equal(patch.mailer_templates_magic_link_content, 'code');
  assert.equal(patch.mailer_templates_confirmation_content, 'code');
  assert.equal(patch.uri_allow_list, 'https://app.example/');
});
test('deployment verifies settings and fails without leaking API responses', async () => {
  const env = { TARGET: 'production', PROD_REF: 'testref', SUPABASE_ACCESS_TOKEN: 'test-only', SITE_URL: 'https://app.example/' };
  let config = {}; const methods = [];
  await configureAuth(env, async (_, options) => {
    methods.push(options.method);
    if (options.method === 'PATCH') config = JSON.parse(options.body);
    return { ok: true, json: async () => config };
  });
  assert.deepEqual(methods, ['GET', 'PATCH', 'GET']);
  await assert.rejects(configureAuth(env, async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(configureAuth(env, async () => ({ ok: true, json: async () => ({}) })), /verification failed/);
});
