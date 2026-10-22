import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedCommit } from '../scripts/check-backend-deploy.mjs';

test('backend compatibility uses a valid live commit and fails closed on unavailable metadata', async () => {
  const sha = 'a'.repeat(40);
  assert.equal(await publishedCommit('https://app.example/estate-inventory/', async url => {
    assert.equal(url.pathname, '/estate-inventory/release.json');
    return { ok: true, status: 200, json: async () => ({ commit: sha }) };
  }), sha);
  assert.equal(await publishedCommit('https://app.example/', async () => ({ status: 404 })), null);
  await assert.rejects(publishedCommit('https://app.example/', async () => ({ status: 500 })), /Cannot verify/);
  await assert.rejects(publishedCommit('https://app.example/', async () => ({ ok: true, status: 200, json: async () => ({ commit: 'bad' }) })), /valid source commit/);
});
