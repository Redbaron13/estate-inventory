import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentTarget, preflight } from '../scripts/deploy-preflight.mjs';
const prod = { TARGET: 'production', GITHUB_REF_NAME: 'mainbranch', GITHUB_REF: 'refs/heads/mainbranch', PROD_REF: 'productionref', VITE_SUPABASE_URL: 'https://productionref.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_test', SITE_URL: 'https://app.example/' };
const staging = { ...prod, TARGET: 'staging', GITHUB_REF_NAME: 'develop', GITHUB_REF: 'refs/heads/develop', STAGING_REF: 'stagingref', VITE_SUPABASE_URL: 'https://stagingref.supabase.co', SITE_URL: 'https://staging.example/', PRODUCTION_URL: prod.VITE_SUPABASE_URL, PRODUCTION_SITE_URL: prod.SITE_URL };
test('deployment rejects wrong branches, crosswired projects and shared staging destinations', () => {
  assert.equal(deploymentTarget(prod).site, prod.SITE_URL);
  assert.equal(deploymentTarget(staging).site, staging.SITE_URL);
  for (const env of [{ ...staging, GITHUB_REF_NAME: 'feature/test' }, { ...staging, GITHUB_REF: 'refs/tags/develop' }, { ...prod, PROD_REF: 'other' }, { ...staging, STAGING_REF: prod.PROD_REF }, { ...staging, SITE_URL: prod.SITE_URL }, { ...prod, TARGET: 'typo' }]) assert.throws(() => deploymentTarget(env));
});
test('privileged and malformed browser keys fail without disclosing their value', () => {
  for (const key of ['sb_secret_private', `eyJ.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`, 'invalid']) {
    assert.throws(() => deploymentTarget({ ...prod, VITE_SUPABASE_ANON_KEY: key }), error => !error.message.includes(key));
  }
  const anon = `eyJ.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.doesNotThrow(() => deploymentTarget({ ...prod, VITE_SUPABASE_ANON_KEY: anon }));
});
test('website TLS or redirect failures stop preflight before deployment', async () => {
  await assert.rejects(preflight(prod, async () => { throw new Error('certificate mismatch'); }), /certificate/);
  await assert.rejects(preflight(prod, async () => ({ ok: false, status: 503 })), /503/);
  await preflight(prod, async (_, options) => { assert.equal(options.redirect, 'error'); return { ok: true }; });
});
