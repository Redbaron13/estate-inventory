import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../../supabase/functions/_shared/domain.ts';
import { GENESIS_HASH, sha256Hex, verifyChain } from '../../supabase/functions/_shared/ledger.ts';
import sample from './fixtures/ledger-sample.json';

// Real entries produced by the database's hash-chain trigger. Verifying them
// here proves the browser and the database compute the same fingerprints.
const real = sample as LedgerEntry[];

describe('history chain', () => {
  it('verifies entries produced by the database', async () => {
    const r = await verifyChain(real);
    expect(r.ok).toBe(true);
    expect(r.head.seq).toBe(real.length);
    expect(r.head.hash).toBe(real[real.length - 1].hash);
  });

  it('continues from a fingerprint this phone saw earlier', async () => {
    const r = await verifyChain(real.slice(5), { seq: 5, hash: real[4].hash });
    expect(r.ok).toBe(true);
  });

  it('detects an edited entry', async () => {
    const tampered = real.map((e) => ({ ...e }));
    tampered[3].payload = tampered[3].payload!.replace('"INSERT"', '"UPDATE"');
    const r = await verifyChain(tampered);
    expect(r.ok).toBe(false);
    expect(r.problem?.seq).toBe(4);
  });

  it('detects history rewritten before the fingerprint this phone saw', async () => {
    // Someone with database access rewrites entry 2 and recomputes every later hash.
    const rewritten = real.map((e) => ({ ...e }));
    rewritten[1].payload = rewritten[1].payload!.replace('"INSERT"', '"UPDATE"');
    let prev = GENESIS_HASH;
    for (const e of rewritten) {
      e.prev_hash = prev;
      e.hash = await sha256Hex(prev + e.payload);
      prev = e.hash;
    }
    expect((await verifyChain(rewritten)).ok).toBe(true); // internally consistent...
    const witnessed = { seq: 6, hash: real[5].hash }; // ...but not what this phone saw
    const r = await verifyChain(rewritten.slice(6), witnessed);
    expect(r.ok).toBe(false);
  });

  it('checks links of withheld (sealed) entries without their details', async () => {
    const withheld = real.map((e, i) => (i === 2 ? { ...e, payload: null } : e));
    const r = await verifyChain(withheld);
    expect(r.ok).toBe(true);
    expect(r.withheld).toBe(1);
  });

  it('detects a missing entry', async () => {
    const r = await verifyChain([...real.slice(0, 3), ...real.slice(4)]);
    expect(r.ok).toBe(false);
  });
});
