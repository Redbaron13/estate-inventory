# Runbook

Operating the production app: one-time setup, backups, restore, and what to do when something goes wrong.

## Where things live

| Thing | Where | Notes |
| --- | --- | --- |
| Database, sign-in, photos, API | Supabase project `estate-inventory` (`dszldulsyoovtnsaquay`, US East, Postgres 17) | Created through the Vercel Marketplace integration, so plan changes and billing go through Vercel |
| App | Cloudflare Pages project `estate-inventory` | Static files only; no data |
| Backup vault | Cloudflare R2 bucket `estate-inventory-vault` (western North America) | Locked prefixes; see "Backups" |
| Code, pipeline, backup jobs | GitHub `Redbaron13/estate-inventory` (private) | |
| Backup decryption key | Offline: password manager plus a printed copy | Also a GitHub secret for the monthly drill |

## One-time production setup

Do these in order. Each step says what it unlocks.

1. **Database password.** Supabase > Project settings > Database > Reset database password. Save it in your password manager, then as `PROD_SUPABASE_DB_PASSWORD`. Unlocks deploys.
2. **Supabase access token.** supabase.com > Account > Access tokens > Generate. Save as `SUPABASE_ACCESS_TOKEN`.
3. **Connection string for backups.** Supabase > Connect > Session pooler > copy the URI, put the password in, save as `PROD_SUPABASE_DB_URL`. Use the session pooler, not the direct connection: the direct address is IPv6-only and GitHub's runners are IPv4.
4. **Storage keys for backups.** Supabase > Storage > S3 configuration > New access key. Save as `PROD_STORAGE_S3_ACCESS_KEY_ID` and `PROD_STORAGE_S3_SECRET_ACCESS_KEY`. These can read every photo, so treat them like the database password.
5. **Email that reaches your family.** Supabase's built-in email only delivers to members of your Supabase team, at about 2 messages an hour. Before inviting anyone: create a free Resend account, verify a domain you own (a subdomain such as `mail.` of your business domain is fine), create an SMTP key, and enter it under Supabase > Authentication > Emails > SMTP settings (host `smtp.resend.com`, port 465, user `resend`). Then raise `email_sent` under `[remotes.production.auth.rate_limit]` in `supabase/config.toml` to 30 and deploy. Until then, family members can sign in with a password.
6. **Cloudflare.** Create an API token (My Profile > API Tokens > "Edit Cloudflare Workers" template, limited to your account) and save it as `CLOUDFLARE_API_TOKEN`; save the account ID as `CLOUDFLARE_ACCOUNT_ID`. Use the account you want billing on; you have two.
7. **Backup vault.** On your computer: `npx wrangler login`, then `CLOUDFLARE_ACCOUNT_ID=<id> node setup/r2-setup.mjs` (PowerShell: `$env:CLOUDFLARE_ACCOUNT_ID='<id>'; node setup/r2-setup.mjs`). If R2 isn't enabled yet, the dashboard asks you to enable it first (free tier, card on file). Then create the R2 token as the script prints and save `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
8. **Backup encryption key.** See below. Saves `BACKUP_AGE_RECIPIENT` (variable) and `BACKUP_AGE_IDENTITY` (secret).
9. **First deploy.** Add `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`, `PROD_SITE_URL`, then Actions > Deploy > production. The first run creates the Pages project; if the site address it reports differs from `PROD_SITE_URL`, update the secret and run it again.
10. **First backup.** Actions > Backup > Run workflow. Check the run summary lists a database file and the media count. Then Actions > Restore drill > Run workflow to prove you can get it back.
11. **Supabase plan.** The free plan pauses a project after 7 days without activity (the nightly backup's health check counts as activity) and keeps no backups of its own. The R2 vault covers backups either way. Upgrading to Pro ($25/month, through Vercel) adds daily Supabase backups and removes pausing; worth doing before the family starts entering real items.

### Backup encryption key

Backups are encrypted with [age](https://age-encryption.org) before they leave GitHub. On a computer you trust:

```
winget install FiloSottile.age        (Mac: brew install age)
age-keygen -o estate-backup-key.txt
```

- The line starting `# public key: age1...` is the **recipient**. Put the `age1...` value in GitHub as the variable `BACKUP_AGE_RECIPIENT`.
- The whole file is the **identity** (private key). Store it in your password manager and print a copy for your estate papers. Without it, the backups cannot be read by anyone, including you.
- Put the same file contents in GitHub as the secret `BACKUP_AGE_IDENTITY` so the monthly drill can test real restores. Trade-off: someone who took over your GitHub account could decrypt backups. If you'd rather not accept that, leave the secret out and run the restore drill by hand a few times a year.
- Then delete `estate-backup-key.txt` from the computer.

## Backups

**What runs:** `.github/workflows/backup.yml`, nightly at 07:17 UTC (3:17 AM Eastern in summer).

1. Verifies every estate's history chain in Node and checks that last night's fingerprints are still in place.
2. Dumps the database (roles, schema, data including sign-in accounts and storage records) plus the app's rules on Supabase-managed tables, which `supabase db dump` leaves out. Encrypts it and uploads to the vault.
3. Copies every new photo and document to the vault. Files are named by their own fingerprint, so a copy that already exists is never touched.
4. Confirms every file the database knows about is in the vault, re-hashes up to 300 new files plus 20 random older ones per night, and records the result in `media_verifications`.

**Vault layout and locks** (set by `setup/r2-setup.mjs`):

| Prefix | Contents | Lock | Then |
| --- | --- | --- | --- |
| `db/daily/` | every nightly database backup | 1 year | expires after ~13 months |
| `db/monthly/` | first backup of each month | 7 years | kept |
| `media/` | every photo and document | 7 years | kept |
| `heads/` | history fingerprints from each night | 7 years | kept |
| `state/` | pointers to the latest backup and fingerprints | none | overwritten nightly |

A lock means no one can delete or overwrite those objects until the period ends, including anyone holding the R2 keys. Only a Cloudflare account administrator can remove a lock rule, so protect that login with two-factor authentication.

**Checking on it:** Actions > Backup shows each night's summary. GitHub emails you when a scheduled run fails. A failure doesn't lose anything (Supabase still holds the data), but fix it within a few days.

**Monthly drill:** `.github/workflows/restore-drill.yml` restores the latest backup into a throwaway database and checks row counts, history chains, sample photos, access rules, the append-only guards and a test write.

## Restore

Use this only for real data loss: the Supabase project is gone, corrupted, or unrecoverable. A restore replaces everyone's work since the backup, so it is never the way to undo a release.

1. **Get the backup.** Download the newest `db-*.tar.gz.age` and its `.sha256` from the vault (`state/latest-db.txt` names it). Check it: `sha256sum -c` (or compare by eye with `Get-FileHash` on Windows).
2. **Decrypt and unpack:** `age -d -i estate-backup-key.txt -o backup.tar.gz db-....tar.gz.age`, then `tar xzf backup.tar.gz`. You get `roles.sql`, `schema.sql`, `data.sql`, `hooks.sql`, `migrations.txt`, `counts.json`, `heads.json`.
3. **New Supabase project** (or the old one, if it's empty). Get its session pooler connection string as `$DB`.
4. **Load it, in this order:**
   ```
   psql "$DB" -f roles.sql                       (errors here are platform settings it already has; continue)
   psql "$DB" --single-transaction -v ON_ERROR_STOP=1 -f schema.sql -c "SET session_replication_role = replica" -f data.sql
   psql "$DB" -v ON_ERROR_STOP=1 -f hooks.sql
   ```
5. **Tell the CLI which migrations are applied:** `npx supabase link --project-ref <new-ref>` then `npx supabase migration repair --status applied $(cat migrations.txt)`. Future deploys then apply only newer migrations.
6. **Check it:** row counts against `counts.json`; `DATABASE_URL="$DB" node scripts/verify-ledger.mjs --heads heads.json` must say every history verifies.
7. **Photos:** create the S3 keys for the new project, then `rclone copy r2:estate-inventory-vault/media sb:estate-media --checksum` (remotes configured as in `backup.yml`). Then `node scripts/verify-backup.mjs` against the new project.
8. **Point everything at it:** update the `PROD_*` secrets, run Deploy to production (deploys the API, auth settings and an app build with the new address), and update the Supabase URL in the Vercel integration if you use it.
9. **Tell the family.** Phones re-sync on their own. Anything entered after the backup that hadn't synced is still in those phones' outboxes and uploads automatically. Their history check compares the restored chain with what they saw; a phone that had seen newer entries shows a mismatch warning, which here is expected and confirms what was lost.

The drill runs steps 1 to 6 every month, so this procedure is known to work.

## When something goes wrong

**"The shared history does not match what this phone saw before."** Something changed the record of entries that phone had already verified. Don't dismiss it.
1. Screenshot the warning (it shows the entry number and the fingerprint that phone saw).
2. Run `npm run verify:ledger` against production with the latest fingerprints from the vault: `rclone copyto r2:estate-inventory-vault/state/heads-latest.json heads.json`, then `DATABASE_URL=... node scripts/verify-ledger.mjs --heads heads.json`.
3. If the server chain verifies and matches the vault, the phone's stored data is the likely problem; on that phone, Save a copy, then use "Re-check the whole history".
4. If it fails, the database was changed outside the app. Compare against the locked fingerprints under `heads/` to find the last good night, and restore from that night's backup into a new project to compare. Change the database password and access tokens.

**A photo was uploaded by mistake** (wrong item, private document). Open the item, tap the photo, then "Hide this photo (uploaded by mistake)" and give a reason. It disappears for everyone and stays in the vault with the reason recorded. True erasure isn't possible by design; if it's legally required, it needs the vault lock to expire.

**A family member lost their phone.** Anything not yet uploaded from that phone is lost unless they had saved a copy. To cut the phone off: in Supabase > SQL Editor run `delete from auth.sessions where user_id = '<their user id>';` (find the id under Authentication > Users). The phone loses access when its current sign-in token expires, within an hour; they sign in again on the new phone. The estate copy stored on the lost phone stays readable to anyone who can unlock it, so the phone's own passcode is the protection there. To remove someone from the estate entirely, use Family and settings > Remove from this estate (recorded in history).

**Someone wants their account deleted.** Their profile name and email can be changed; history entries keep their user id and what they did, because the record must stay complete for the estate. Explain the 7-year retention when they join.

**The Supabase project is paused** (free plan, after inactivity). Supabase > the project > Restore. Data is kept. Phones keep working offline meanwhile and upload once it's back.

**A backup run failed.** Open the run; the failing step names the missing secret or the error. Common causes: an expired Supabase or Cloudflare token, a changed database password, or the project being paused.

**A deploy failed partway.** Steps run in order (database, auth, API, app), so a failure leaves earlier steps applied. Database migrations are transactional per file. Fix the cause and run Deploy again; already-applied steps are skipped or are harmless to repeat.

## Costs at this size

| Service | Plan | Cost |
| --- | --- | --- |
| Supabase | Free (Pro recommended before real use) | $0 ($25/month on Pro) |
| Cloudflare Pages | Free | $0 |
| Cloudflare R2 | Free tier: 10 GB stored, 1M writes/month | $0 at expected size; $0.015/GB-month beyond |
| GitHub | Free, private repository, 2,000 Actions minutes/month | $0 |
| Resend | Free: 3,000 emails/month | $0 |
