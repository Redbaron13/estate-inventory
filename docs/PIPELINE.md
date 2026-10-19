> Release update (0.2.0): see [RELEASES.md](RELEASES.md) for the current mainbranch/develop workflow, identifiers, environment settings and installation instructions. That document supersedes the deployment instructions below. The backup and restore instructions below still apply.

# Making and releasing changes

```
 your computer            GitHub                                   users' phones
 ─────────────            ──────                                   ─────────────
 branch + commit  ──push──▶ pull request ──▶ CI (all tests)
                                 │ merge
                                 ▼
                           mainbranch ──▶ CI ──▶ staging (if configured)
                                 │
              Actions > Deploy > production (type "production")
                                 ▼
                     database ▶ auth settings ▶ API ▶ app  ──▶ "A new version is ready"
```

## Everyday loop

1. Start from an up-to-date mainbranch: `git checkout mainbranch && git pull`.
2. Make a branch: `git checkout -b short-description`.
3. Run it locally: `npm run db:start` (once), `npm run dev`, sign in as `alex@example.com` / `estate-demo-pass`.
4. Before pushing: `npm run check` and, if you touched the database, `npm run db:test`.
5. Push and open a pull request: `git push -u origin short-description`, then `gh pr create --fill`.
6. GitHub runs CI on the pull request. Merge when it is green.

Working on another device: open the repository in a Codespace (Code > Codespaces), or run the setup script for that computer. Everything lives in GitHub, so `git pull` on any device picks up where you left off.

## What CI checks

| Job | Checks |
| --- | --- |
| Lint, types, unit tests, build | ESLint, TypeScript, Vitest (codes, ledger verification, sync, reports), production build, Deno type check of the API |
| Database and end-to-end | Fresh local Supabase from the migrations; 79 database tests (access rules, immutability, approvals, sealed rounds, history chain, sync); independent history check; Playwright on a phone-sized browser under the production security policy: offline capture with a photo then sync, the duplicate prompt, inventory, decisions and reports |

A failed end-to-end run uploads screenshots and traces (Actions run > Artifacts > playwright-report).

## Releasing to production

Actions > **Deploy** > Run workflow > target **production**, type `production` in the confirm box.

The job reruns CI, then in this order:

1. **Database migrations** (`supabase db push`), with a dry run printed first. Forward only; the demo seed is never applied.
2. **Auth settings** (`supabase config push`): sign-in code email, code lifetime, redirect URLs.
3. **API function** and its allowed origin.
4. **App** to Cloudflare Pages.
5. **Smoke test** of the API health endpoint and the site.

Phones show "A new version is ready" the next time the app is open. Nothing in progress is interrupted, and changes waiting in the outbox upload with the new version.

Pushes to mainbranch also deploy to **staging** automatically once a staging project is configured (`STAGING_*` secrets). Without one, that step is skipped.

## Rules for database changes

The database is the record, so changes to it follow stricter rules than app code.

- **New file for every change**: `npm run db:new describe_change`. Never edit a migration that has reached production; CI and production would disagree about what it contains.
- **Forward only.** To undo something, write a new migration that reverses it. There is no "down".
- **Never drop or rewrite history tables.** Append-only tables and the ledger are permanent by design. If a column becomes unused, leave it.
- **Old phones keep working for a while.** A phone can be offline for days with changes queued from an older app version. When changing a `private.api_*` function, keep accepting the old arguments (new fields optional, defaults for missing ones) for at least 30 days. Rename in two releases: add the new name, then remove the old one a month later.
- **Test it**: add or extend a pgTAP test in `supabase/tests/`. `npm run db:reset` rebuilds the local database from scratch to prove the migrations apply cleanly.
- **Keep SQL and TypeScript in step.** Codes and validation exist in both `supabase/migrations/*_workflows.sql` and `supabase/functions/_shared/`. The unit tests compare them; if you change one, run `npm test`.

## Rolling back

- **App**: Cloudflare dashboard > Workers & Pages > estate-inventory > Deployments > choose the previous production deployment > Rollback. Takes effect in seconds.
- **API function**: rerun Deploy from an earlier commit (Run workflow > "Use workflow from" a tag or branch), or fix forward.
- **Database**: fix forward with a new migration. Never reset or restore production to undo a release; a restore rolls back everyone's real work too. See RUNBOOK "Restore" for genuine data loss.

## Secrets and variables

Set under GitHub > Settings > Secrets and variables > Actions. GitHub Free has no per-environment secrets for private repositories, so names carry a prefix.

| Name | Kind | Used by | Where it comes from |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | secret | deploy | supabase.com > Account > Access tokens |
| `PROD_SUPABASE_PROJECT_REF` | secret | deploy, backup | `dszldulsyoovtnsaquay` |
| `PROD_SUPABASE_DB_PASSWORD` | secret | deploy | Project settings > Database > Reset password |
| `PROD_SUPABASE_URL` | secret | deploy, backup | `https://dszldulsyoovtnsaquay.supabase.co` |
| `PROD_SUPABASE_ANON_KEY` | secret | deploy | Project settings > API keys (publishable key) |
| `PROD_SITE_URL` | secret | deploy | the Pages address, e.g. `https://estate-inventory.pages.dev` |
| `PROD_SUPABASE_DB_URL` | secret | backup | Connect > Session pooler connection string (not "Direct": GitHub runners have no IPv6) |
| `PROD_STORAGE_S3_ACCESS_KEY_ID`, `PROD_STORAGE_S3_SECRET_ACCESS_KEY` | secret | backup | Storage > S3 configuration > New access key |
| `CLOUDFLARE_API_TOKEN` | secret | deploy | Cloudflare > My Profile > API Tokens, template "Edit Cloudflare Workers" or a custom token with Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | secret | deploy, backup, drill | Cloudflare dashboard sidebar |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secret | backup, drill | R2 > Manage API tokens, Object Read & Write on the vault bucket only |
| `BACKUP_AGE_IDENTITY` | secret | drill | the private key from `age-keygen` (RUNBOOK "Backup encryption key") |
| `BACKUP_AGE_RECIPIENT` | variable | backup | the public key line (`age1...`) |
| `R2_BUCKET` | variable | backup, drill | optional; defaults to `estate-inventory-vault` |
| `PAGES_PROJECT` | variable | deploy | optional; defaults to `estate-inventory` |
| `STAGING_*` | secret | deploy | same as the `PROD_` set, for a second free project (optional) |

## Limits worth knowing

- **Required checks before merging** need branch protection, which GitHub only offers for private repositories on a paid plan (Pro, $4/month). Without it, merging a red pull request is possible, but production still can't receive it: the deploy job reruns CI and stops on failure.
- **GitHub Actions minutes**: private repositories get 2,000 free minutes a month. One CI run is about 15 minutes, and a merged change runs it twice (on the pull request, then before deploying). The nightly backup takes about 5 minutes and the monthly drill about 15, which leaves room for roughly 60 merged changes a month.

