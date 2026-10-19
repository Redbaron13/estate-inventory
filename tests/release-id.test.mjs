import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateRelease, validateReleaseId, minorCohort, DISTRIBUTIONS, ARCHITECTURES } from '../scripts/release-id.mjs';
test('all targets share a minor cohort and follow positional checksum and exclusion rules', () => {
 const registry = { schema: 1, releases: [] };
 for (const distribution of DISTRIBUTIONS) for (const architecture of ARCHITECTURES) for (let i = 0; i < 20; i++) {
  const r = allocateRelease({ version: '0.2.0', distribution, architecture, deploymentKey: `${distribution}:${architecture}:${i}`, deployed: true, registry });
  assert.equal(r.id.length, 8);
  assert.equal(r.id[4], minorCohort('0.2.9'));
  assert.equal(validateReleaseId(r.id, '0.2.0'), true);
  assert.equal(new Set(r.id.slice(4)).size, 4);
  for (const c of r.id.slice(4)) assert.equal(r.id.slice(0, 4).toUpperCase().includes(c), false);
  const altered = r.id.slice(0, 6) + (r.id[6] === 'A' ? 'B' : 'A') + r.id[7];
  assert.equal(validateReleaseId(altered, '0.2.0'), false);
 }
 assert.equal(new Set(registry.releases.map(r => r.id)).size, registry.releases.length);
});
test('retries reuse a reservation and branches receive ZY', () => {
 const registry = { schema: 1, releases: [] };
 const args = { version: '1.2.3', deploymentKey: 'test', registry };
 const r = allocateRelease(args);
 assert.equal(r.id.length, 10); assert.ok(r.id.startsWith('ZY')); assert.ok(validateReleaseId(r.id));
 assert.equal(allocateRelease(args).id, r.id); assert.equal(registry.releases.length, 1);
 assert.throws(() => allocateRelease({ ...args, version: '1.3.0' }));
 assert.throws(() => minorCohort('01.2.0'));
});
test('finite space fails closed instead of reusing an identifier', () => {
 const registry = { schema: 1, releases: [] };
 let exhausted = false;
 for (let i = 0; i < 1500; i++) {
  try { allocateRelease({ version: '0.2.0', deploymentKey: `r${i}`, deployed: true, registry }); }
  catch (e) { assert.match(e.message, /exhausted/); exhausted = true; break; }
 }
 assert.ok(exhausted);
});
