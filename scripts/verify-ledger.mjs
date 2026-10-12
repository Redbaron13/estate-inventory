#!/usr/bin/env node
// Independently re-check every estate's hash-chained history.
//
//   DATABASE_URL=postgres://... node scripts/verify-ledger.mjs [--heads heads.json] [--write-heads heads.json]
//
// Recomputes hash_N = sha256(hash_{N-1} + payload_N) for every entry, in
// Node, without trusting the database's own verify function. With --heads it
// also confirms that fingerprints recorded on an earlier run are still there
// (so history before them cannot have been rewritten). Exits 1 on any problem.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const headsIn = flag('--heads');
const headsOut = flag('--write-heads');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL.');
  process.exit(2);
}

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();

const previous = headsIn && existsSync(headsIn) ? JSON.parse(readFileSync(headsIn, 'utf8')) : {};
const heads = {};
let failures = 0;

const estates = (await client.query('select id, name from public.estates order by created_at')).rows;
for (const estate of estates) {
  let prev = '0'.repeat(64);
  let expected = 1;
  let ok = true;
  const res = await client.query(
    'select estate_seq, prev_hash, hash, payload from public.ledger where estate_id = $1 order by estate_seq',
    [estate.id],
  );
  const bySeq = new Map();
  for (const row of res.rows) {
    const seq = Number(row.estate_seq);
    if (seq !== expected || row.prev_hash !== prev || sha(row.prev_hash + row.payload) !== row.hash) {
      console.error(`FAIL ${estate.name} (${estate.id}): entry ${seq} does not verify.`);
      ok = false;
      break;
    }
    bySeq.set(seq, row.hash);
    prev = row.hash;
    expected++;
  }
  const witnessed = previous[estate.id];
  if (ok && witnessed && bySeq.get(witnessed.seq) !== witnessed.hash) {
    console.error(`FAIL ${estate.name}: entry ${witnessed.seq} no longer has the fingerprint recorded on ${witnessed.at}. History was rewritten.`);
    ok = false;
  }
  if (ok) {
    heads[estate.id] = { seq: expected - 1, hash: prev, at: new Date().toISOString(), name: estate.name };
    console.log(`ok   ${estate.name}: ${expected - 1} entries, head ${prev.slice(0, 16)}…`);
  } else {
    failures++;
    if (witnessed) heads[estate.id] = witnessed; // keep the last good fingerprint
  }
}
// An estate recorded on an earlier run must still exist.
const present = new Set(estates.map((e) => e.id));
for (const [id, witnessed] of Object.entries(previous)) {
  if (!present.has(id)) {
    console.error(`FAIL ${witnessed.name ?? id}: this estate was verified on ${witnessed.at} and is now missing.`);
    failures++;
  }
}
await client.end();

if (headsOut) writeFileSync(headsOut, JSON.stringify({ ...previous, ...heads }, null, 2));
if (failures) {
  console.error(`${failures} estate(s) failed verification.`);
  process.exit(1);
}
console.log(`All ${estates.length} estate histories verify.`);
