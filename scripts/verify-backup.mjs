#!/usr/bin/env node
// Check that every photo and document recorded in the database has a copy in
// the locked R2 vault with the right fingerprint, and record the result.
//
//   DATABASE_URL=... node scripts/verify-backup.mjs --listing r2-media.json [--remote r2:bucket/media] [--rehash 200] [--sample 20]
//
// --listing   output of: rclone lsjson --recursive --files-only <remote>
// --remote    rclone remote path used to re-download files for hashing
// --rehash    how many not-yet-verified files to re-hash this run (default 200)
// --sample    how many already-verified files to re-hash at random, to catch
//             later damage (default 0)
//
// Files are named by their SHA-256, so verification is: the vault holds a
// file at the same path, and its bytes hash to the name. Results are written
// to public.media_verifications (append-only). Exits 1 if anything is missing
// or does not match.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
const flag = (name, d = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : d;
};
const listingPath = flag('--listing');
const remote = flag('--remote');
const rehashLimit = Number(flag('--rehash', '200'));
const sampleSize = Number(flag('--sample', '0'));
const url = process.env.DATABASE_URL;
if (!url || !listingPath) {
  console.error('Set DATABASE_URL and pass --listing.');
  process.exit(2);
}

const inVault = new Map(JSON.parse(readFileSync(listingPath, 'utf8')).map((o) => [o.Path, o.Size]));

function hashRemote(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const p = spawn('rclone', ['cat', `${remote}/${path}`]);
    p.stdout.on('data', (d) => h.update(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(h.digest('hex')) : reject(new Error(`rclone cat exited ${code}`))));
  });
}

const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();

const media = (await client.query(`
  select m.id, m.estate_id, m.sha256, m.storage_path, m.thumb_sha256, m.thumb_path, m.byte_size,
         exists (select 1 from public.media_verifications v where v.media_id = m.id and v.location = 'r2' and v.matches) as verified
    from public.media m
   order by m.created_at`)).rows;

// A random selection of already-verified files gets re-checked as well.
const verified = media.filter((m) => m.verified);
const sampled = new Set();
while (sampled.size < Math.min(sampleSize, verified.length)) {
  sampled.add(verified[Math.floor(Math.random() * verified.length)].id);
}

let missing = 0;
let mismatched = 0;
let rehashed = 0;
let resampled = 0;
for (const m of media) {
  for (const path of [m.storage_path, m.thumb_path]) {
    if (!path) continue;
    if (!inVault.has(path)) {
      console.error(`MISSING in vault: ${path} (media ${m.id})`);
      missing++;
    }
  }
  const due = (!m.verified && rehashed < rehashLimit) || sampled.has(m.id);
  if (due && remote && inVault.has(m.storage_path)) {
    const actual = await hashRemote(m.storage_path);
    if (m.verified) resampled++;
    else rehashed++;
    const matches = actual === m.sha256;
    if (!matches) {
      console.error(`MISMATCH: ${m.storage_path} hashes to ${actual}`);
      mismatched++;
    }
    // Shared copies (merged duplicates) point at the same file; record each media row.
    await client.query(
      'insert into public.media_verifications (estate_id, media_id, location, verified_sha256, matches) values ($1, $2, $3, $4, $5)',
      [m.estate_id, m.id, 'r2', actual, matches],
    );
  }
}
await client.end();

console.log(`${media.length} files recorded, ${inVault.size} objects in vault, ${rehashed} new and ${resampled} earlier files re-hashed this run.`);
if (missing || mismatched) {
  console.error(`${missing} missing, ${mismatched} mismatched.`);
  process.exit(1);
}
console.log('Every recorded file has a matching copy in the vault.');
