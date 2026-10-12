// Independent verification of an estate's hash-chained history. Runs in the
// browser, in Deno, and in Node (all provide crypto.subtle), and does not
// trust the server's own verification.
import type { LedgerEntry } from './domain.ts';

export const GENESIS_HASH = '0'.repeat(64);

export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChainHead {
  seq: number;
  hash: string;
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  /** Entries whose details are withheld from this member (sealed choices); their links are still checked. */
  withheld: number;
  head: ChainHead;
  problem?: { seq: number; reason: string };
}

/**
 * Verify entries that continue from `start` (default: the beginning).
 * Every entry must link to the previous hash; every entry whose payload is
 * visible must hash to its recorded value.
 */
export async function verifyChain(entries: LedgerEntry[], start: ChainHead = { seq: 0, hash: GENESIS_HASH }): Promise<ChainCheck> {
  let prev = start.hash;
  let expected = start.seq + 1;
  let withheld = 0;
  let checked = 0;
  for (const e of [...entries].sort((a, b) => a.estate_seq - b.estate_seq)) {
    if (e.estate_seq !== expected) {
      return { ok: false, checked, withheld, head: { seq: expected - 1, hash: prev }, problem: { seq: e.estate_seq, reason: `Entry ${expected} is missing.` } };
    }
    if (e.prev_hash !== prev) {
      return { ok: false, checked, withheld, head: { seq: expected - 1, hash: prev }, problem: { seq: e.estate_seq, reason: 'This entry does not link to the one before it. History before it may have been changed.' } };
    }
    if (e.payload === null) {
      withheld++;
    } else {
      const h = await sha256Hex(e.prev_hash + e.payload);
      if (h !== e.hash) {
        return { ok: false, checked, withheld, head: { seq: expected - 1, hash: prev }, problem: { seq: e.estate_seq, reason: 'This entry was altered after it was recorded.' } };
      }
      try {
        const p = JSON.parse(e.payload) as { estate_seq?: number };
        if (p.estate_seq !== e.estate_seq) {
          return { ok: false, checked, withheld, head: { seq: expected - 1, hash: prev }, problem: { seq: e.estate_seq, reason: 'Entry number does not match its contents.' } };
        }
      } catch {
        return { ok: false, checked, withheld, head: { seq: expected - 1, hash: prev }, problem: { seq: e.estate_seq, reason: 'Entry contents are not readable.' } };
      }
    }
    prev = e.hash;
    expected++;
    checked++;
  }
  return { ok: true, checked, withheld, head: { seq: expected - 1, hash: prev } };
}
