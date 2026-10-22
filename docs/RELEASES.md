# Releases and device installation

Version 0.2.0 adds room-first batch capture, resumable saves, family-choice reports, a beneficiary summary, installation guidance, and a shared release-identity allocator.

## Daily use

Open https://redbaron13.github.io/estate-inventory/. In More, choose **Install on this device** for instructions or the browser's installation prompt. The same responsive PWA works in a browser and as an installed app on phones, tablets, Mac, Windows and Linux. On the computer the navigation sits beside the work; phones keep bottom navigation. Desktop installation support depends on the browser.

This release distributes a browser-runtime PWA (WBx3), including when installed. It does not produce signed .dmg, .exe, .AppImage, .ipa or .apk packages. The reserved distribution codes below support future separate packages; they do not claim native binaries exist. App-store distribution and native signing are separate work.

## Development and production

1. Work on a feature branch. `npm ci`, `npx supabase start`, `npm run dev`. The local Supabase stack uses fictional seed data, not production.
2. Open a PR. CI runs lint, TypeScript, unit and identifier tests, a production build, API type checking, database/permission tests, independent history verification, and desktop/tablet/phone browser tests.
3. Merge into `develop` for staging. This runs the same CI, then applies forward migrations and the API to a separate staging Supabase project before publishing to Cloudflare Pages' `staging` branch. Incomplete staging configuration fails clearly.
4. Increase package version with `npm version patch`, `minor`, or `major` as appropriate. Commit package.json and package-lock.json together.
5. Merge into `mainbranch`. CI gates a production release to the existing GitHub Pages site. With Supabase credentials, migrations and API deploy first. Without credentials, frontend-only updates may deploy; changes to `supabase/` since the last published release are refused to prevent a partial release. For the first release only, when no previous release manifest exists, the check uses the push range or HEAD^ for a manual run. Later releases compare against the last published source commit, including changes from failed runs.
6. Each deployment reserves its identity and builds before any backend mutation, then saves the exact build as an Actions artifact, publishes, and verifies `release.json` contains this deployment's ID and commit. It also verifies API health. A successful HTTP response from an old site does not count as success.
7. Installed apps offer an update prompt. Finish current capture before restarting. IndexedDB and the outbox remain across releases.

Production always uses `mainbranch`. Manual production deploys require typing `production`. GitHub environment protection can require a reviewer if desired. Deployment runs serialize, including registry allocation. Feature PRs never receive deployment secrets.

## Required environment configuration

Production remains on the existing GitHub Pages `gh-pages` branch. Public client values fall back to `.env.hosted` and are safe in a browser. Secret credentials never enter Vite client variables.

| Location | Name | Purpose |
| --- | --- | --- |
| Repository or `github-pages` secrets | `SUPABASE_ACCESS_TOKEN` | Deploy API and backend settings |
| Same | `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD` | Existing production backend |
| Same, optional | `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` | Override public client config |
| `staging` secrets | `SUPABASE_ACCESS_TOKEN` | Staging deployments |
| Same | `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_DB_PASSWORD` | Separate staging database |
| Same | `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` | Public staging client config |
| Same | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Publish staging web app |
| `staging` variables | `STAGING_SITE_URL`, `PAGES_PROJECT` | Actual staging branch URL and existing Pages project name |

Staging must have a different Supabase URL from production. Create the Cloudflare Pages project and its staging branch domain first, then set that exact URL. No paid project is created automatically. Configure Supabase Auth redirect URLs and email delivery for each environment, and verify a real invitation in staging before inviting the family.

On 2026-10-19 the connected Supabase account exposed LotterySaver and theLobbyApp, not the documented production project `dszldulsyoovtnsaquay`. This session could not verify production database access or create a staging project under the right organization. Reconnect Supabase to that organization to complete account-side setup. Keep passwords and access tokens in GitHub secrets, never in a PR or project note.

## Eight-character release identifiers

The owner's approved format is `DDaaABCD`:

| Position | Meaning |
| --- | --- |
| 1–2 | Distribution: DH handheld, DT tablet, MC Mac, IN Windows, LX Linux, WB web |
| 3–4 | Architecture/runtime: x6 x86, x1 ARM, x3 browser runtime |
| 5 (suffix 1) | Cohort character shared by all builds of a given **major.minor**, across patches and targets |
| 6 (suffix 2) | Unique allocation character |
| 7 (suffix 3) | Position-weighted check character |
| 8 (suffix 4) | Unique allocation character |

Suffix characters are uppercase A–Z and 0–9. They cannot repeat each other or occur anywhere in the first four characters, ignoring case. Repeated prefix characters such as the D in DT are fixed codes and are not subject to the suffix exclusion rule.

Undeployed builds prepend `ZY`, making **10 characters**, for example the ID printed by `npm run release:prepare`. The 8-character deployed ID is a custom release identifier, not an RFC UUID. SemVer and the full source commit are kept separately.

The cohort is a SHA-256-derived selection from characters that are safe for every prefix, using major.minor as input. Different minor versions can share a cohort because the alphabet is finite; the full ID is still never reused. The checksum weights the base-36 value plus one of each other character by its 1-based position, then selects from the unused characters. It detects common errors; it is not cryptographic proof.

`scripts/reserve-release.mjs` stores every reservation in `release-registry.json` on branch `release-registry`. It uses the GitHub contents API with an expected file SHA and workflow concurrency. A failed reservation stops deployment. Failed builds keep their reservation; a retry of that run reuses it. Never delete or reset that branch. Back it up with the repository. The format has finite capacity; exhaustion fails explicitly instead of recycling an ID. `node --test tests/release-id.test.mjs` checks all supported targets, collisions, retries, checksums and exhaustion.

The registry is an allocation ledger. It does not certify successful publication: the Actions deployment result plus the matching live `release.json` establish that. A reservation can remain for a failed build. Production SemVer must increase for a different source commit.

## Recovery

For a frontend regression, revert the offending change on `mainbranch`, increase the patch version, and let CI deploy a new identifiable build. Exact previous builds are downloadable from Actions artifacts for 90 days. Database changes use forward corrective migrations; reverting frontend code does not undo a database migration. Off-site encrypted backups and a successful restore drill remain separate requirements in docs/PIPELINE.md and issue #13.

References: [Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments), [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Release 0.2.1

The production pipeline now updates only app-owned hosted auth settings through the Management API, reads them back to verify them, and preserves the project's confirmation and SMTP settings. It installs code email templates only when a custom SMTP host is configured. The built-in sender's template restriction no longer blocks database, API and web releases. Production opens the password sign-in form first; delivering email codes to siblings still needs custom SMTP.

Mac build, native launch verification and optional signed downloads are documented in `MACOS.md`. Deployment credentials can be imported from the private `textfile/.env` with `scripts/import-deploy-secrets.mjs`; values are sent to GitHub secrets through standard input and are not printed or added to Vite.
