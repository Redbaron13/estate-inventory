#!/usr/bin/env node
// One-time setup of the locked Cloudflare R2 backup vault.
//
//   npx wrangler login                      (once, in a browser)
//   CLOUDFLARE_ACCOUNT_ID=<id> node setup/r2-setup.mjs [bucket-name]
//
// Creates the bucket and its retention rules. A bucket lock rule makes every
// object under its prefix impossible to delete or overwrite until the
// retention period ends, even with valid keys. Only a Cloudflare account
// administrator can remove a rule, so keep that login protected with 2FA and
// give GitHub an R2 token scoped to "Object Read & Write" on this bucket only.
//
//   db/daily/    nightly database backups     locked 1 year, then expire
//   db/monthly/  first backup of each month   locked 7 years
//   media/       every photo and document     locked 7 years
//   heads/       history fingerprints         locked 7 years
//   state/       "latest" pointers            not locked (overwritten nightly)
//
// Safe to run again; existing rules with the same name are replaced.
import { spawnSync } from 'node:child_process';

const bucket = process.argv[2] || 'estate-inventory-vault';
const SEVEN_YEARS = 2557; // days, including leap days
const ONE_YEAR = 366;

function wrangler(args, { allowFail = false } = {}) {
  console.log(`\n> wrangler ${args.join(' ')}`);
  const res = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0 && !allowFail) {
    console.error(`\nStopped: "wrangler ${args.join(' ')}" failed. Fix the error above and run this again.`);
    process.exit(1);
  }
  return res.status === 0;
}

if (!wrangler(['whoami'], { allowFail: true })) {
  console.error('\nSign in first: npx wrangler login');
  process.exit(1);
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.log('\nTip: you have more than one Cloudflare account; set CLOUDFLARE_ACCOUNT_ID to pick one without a prompt.');
}

// Western North America: a different region from the primary database
// (Supabase, US East), so one regional outage can't take out both copies.
// Fails harmlessly if the bucket already exists.
wrangler(['r2', 'bucket', 'create', bucket, '--location', 'wnam'], { allowFail: true });

const locks = [
  ['db-daily', 'db/daily/', ONE_YEAR],
  ['db-monthly', 'db/monthly/', SEVEN_YEARS],
  ['media', 'media/', SEVEN_YEARS],
  ['heads', 'heads/', SEVEN_YEARS],
];
for (const [name, prefix, days] of locks) {
  wrangler(['r2', 'bucket', 'lock', 'add', bucket, name, prefix, '--retention-days', String(days), '--force']);
}

// Nightly copies expire shortly after their lock ends; monthly copies stay.
wrangler(['r2', 'bucket', 'lifecycle', 'add', bucket, 'expire-daily-db', 'db/daily/', '--expire-days', String(ONE_YEAR + 35), '--force']);

wrangler(['r2', 'bucket', 'lock', 'list', bucket]);
wrangler(['r2', 'bucket', 'lifecycle', 'list', bucket]);

console.log(`
Vault "${bucket}" is ready. Next, in the Cloudflare dashboard:
  R2 > Manage API tokens > Create API token
    Permissions: Object Read & Write.  Specify bucket: ${bucket}.
  Put the Access Key ID and Secret Access Key in GitHub as
  R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (see docs/RUNBOOK.md, "Backups").`);
