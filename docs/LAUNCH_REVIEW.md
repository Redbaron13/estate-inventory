# Launch review and plan

Reviewed November 15, 2026 (Eastern). Source baseline: `0ea0a884fa77e1a8d2e8553fd9c3d739bc7b8c31` on GitHub `mainbranch`. Changes in this PR are proposed, not deployed.

## Decision

Do not invite the family to rely on this installation yet. The inventory implementation is substantial and its existing CI passed, but the public domain fails certificate validation, automated recovery has not run, staging is inactive, and browser storage is shared across accounts. A green build alone does not establish launch readiness.

Keep GitHub as the deployment authority. Use local demo data for development, the separate staging Supabase project for rehearsal, and production only after the gates below pass. Do not copy production records into staging.

## Verified live state

| Area | Evidence | Result |
| --- | --- | --- |
| GitHub source | `git fetch origin`; local HEAD equals `origin/mainbranch` | `0ea0a884`, version 0.2.2 |
| PR #27 | GitHub PR metadata | Merged at `36db31aa`. Its description's pending/queued text is historical |
| Latest production attempt | [Deploy 40160820471](https://github.com/Redbaron13/estate-inventory/actions/runs/40160820471) | App, database/browser and Mac CI passed. Backend and Pages publication passed. Final HTTPS/release verification failed. Mac distribution skipped |
| Website | Certificate-validating request to `https://eiapp3.redbaronworks.com/` | Certificate hostname mismatch. No insecure bypass used |
| Pages configuration | GitHub Pages API | Workflow publication; custom domain `eiapp3.redbaronworks.com`; `https_enforced=false` |
| Backups | [Backup 43725987699](https://github.com/Redbaron13/estate-inventory/actions/runs/43725987699) job detail | Check succeeded; actual backup skipped. This is not proof of a recoverable backup |
| Secret locations | GitHub secret names only | Repository secret list empty. Deployment/storage/R2 credentials exist in `github-pages`. Backup and restore jobs did not select that environment |
| Branch controls | Protection endpoint and rulesets API | Mainbranch classic protection returned 404; ruleset list empty. Production environment restricts refs but also allows several extra branches and tags |
| Production Supabase | Personal Account connection | `dszldulsyoovtnsaquay`, active/healthy, Postgres 17.11; 14 migration versions listed; active API version 6. Earlier notes about unavailable account access are stale |
| Staging Supabase | Same connection | `cccwxgabydcjticdqmls`, inactive. No staging database writes attempted |
| Supabase security | Live advisor | Leaked-password protection disabled. Four authenticated security-definer RPC warnings. Ledger RLS/no-policy informational notice |
| GitLab original import | [baronaerial/estate-inventory](https://gitlab.com/baronaerial/estate-inventory) branch API | Mainbranch is `ba53a6e8`, predating PR #27. Issues/MRs disabled. Not a current mirror; no GitLab CI file or pipeline runs |
| Other GitLab project | [baron-aerial-group/estate-inventory-app](https://gitlab.com/baron-aerial-group/estate-inventory-app) branch and import metadata | Initial commit `0e3ef863`, imported from a different GitHub repository (`estate-inventory-app`). Not this application's release source; no GitLab CI file or pipeline runs |

The referenced chat contains the original request, with no additional implementation transcript or attachments. `/mnt/data/Set Up CI CD.txt` is absent in this workspace. Its contents have not been reviewed.

PR #27 review comments included a P1 finding about reserving a release before backend mutations. The current workflow already reserves and builds before migrations; this PR preserves that ordering and adds destination/TLS validation ahead of allocation. Historical bot summaries are not a current launch approval.

## Prioritized launch work

| Priority | Work and owner | Completion evidence |
| --- | --- | --- |
| P0 | Owner: repair custom-domain DNS/certificate in Pages; enable HTTPS enforcement once available | Ordinary browser and certificate-validating requests load the domain; no certificate exception; manifest matches approved commit |
| P0 | Maintainer: merge this PR after green CI | All required jobs green on reviewed head; production preflight blocks bad TLS and crossed environments before hosted writes |
| P0 | Owner/maintainer: establish actual backup and restore | Configure missing age recipient and recovery identity securely; run Backup then Restore drill from approved mainbranch; actual data/media verification jobs succeed; retain run links |
| P0 for shared devices | Maintainer: separate local caches, pending operations and witnesses by account | Two-account browser test proves B cannot read A's cache or upload A's queued changes; A's offline work survives switching back |
| P0 | Owner: add protected-branch/ruleset requirements | Require PR plus app, database/browser and Mac checks; block direct/force pushes and deletion. Restrict production environment to mainbranch and approved release policy |
| P1 | Owner: activate staging and finish environment settings | Staging deployment passes against its own project, domain, email redirects and synthetic data |
| P1 | Owner/maintainer: prove email onboarding/recovery | Real invited test address receives a code, signs in, accepts invitation and recovers access. Test installed iPhone and browser. Do not assume SMTP is configured from a secret name |
| P1 | Maintainer: validate offline permission fixes and finish account isolation | This PR denies local reports/ZIPs without export permission. Account switching/removal still needs separate cache ownership |
| P1 | Owner: secure accounts | Replace temporary credentials if still used; enable available password protections; verify administrator recovery and MFA plan |
| P1 | Family pilot | Two family testers record 10 fictional items, retry interrupted batches, resolve one conflict, request an item, approve/complete a handoff and save a readable report |
| P2 | Maintainer: usability/performance work | VoiceOver/keyboard and real Safari pass; photo batch sizes measured; scan decoder and PDF loading reviewed; accessible field hints and retry states verified |
| P2 | Owner: GitLab policy | Decide archive versus one-way source mirror. Keep deployment credentials off stale imports; do not enable a second production publisher |

P0 means a launch gate. The shared-device restriction can support a limited pilot only on a separate browser profile/device for each person, with explicit acknowledgment that offline copies remain on their devices. It does not fix account isolation.

## Proposed CI/CD behavior

1. Feature branches open PRs to `develop` for staging rehearsal or `mainbranch` for reviewed fixes. PR jobs receive no hosted deployment secrets.
2. Shared CI runs lint, TypeScript, unit/release tests, local migrations and pgTAP, independent ledger verification, responsive Playwright tests and Mac checks.
3. `develop` deployment uses the staging GitHub environment, a distinct Supabase project and separate Cloudflare website. Production deploys only from `mainbranch`, using `github-pages`.
4. New preflight validates branch/target, client key type, backend reference versus client URL, distinct staging backend/website and website HTTPS before allocating a release or changing hosted state. TLS validation remains enabled. A fresh site may return 404, but must have working HTTPS and must not redirect.
5. Existing ordering remains: build, forward-only migration/auth/API deployment, retired-RPC check, artifact publication, exact release identity/commit check and API health check. A frontend-only release still requires the live source baseline to prove no backend changes were skipped.
6. Backup and restore jobs now select the production environment where credentials actually live. Missing configuration fails clearly. Cloudflare account ID is included in backup readiness checks. Successful workflow status must not conceal an unconfigured recovery job.
7. CI now rejects known high/critical advisories in shipped npm dependencies. Registry availability is required for this check. Development-tool advisories are recorded separately rather than silently applying breaking upgrades. A compatible undici update for jsdom is included; the pinned miniflare dependency under wrangler still leaves a high advisory in development tooling.
8. Private deployment tokens/passwords are scoped to the steps that need them, rather than npm installation/build. Checkout does not persist its write token.
9. All action references in these workflows are pinned to verified commit IDs. The adjacent version comment identifies the reviewed release. Review pins through PRs when updating.

No workflow was dispatched to production, no settings were changed remotely, no migration was applied to a hosted project, and no existing records were deleted by this review. Opening the PR only starts validation.

## Configuration inventory

Only names and locations are documented. Never paste credential values into an issue, PR, screenshot, public artifact or this file. Presence of a secret does not prove it works.

| Location | Names | State/action |
| --- | --- | --- |
| `github-pages` environment | `SUPABASE_ACCESS_TOKEN`, `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` | Names present. Public URL/key are client configuration; password and access token are private |
| `github-pages` environment | `PROD_SUPABASE_DB_URL`, `PROD_STORAGE_S3_ACCESS_KEY_ID`, `PROD_STORAGE_S3_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID` | Names present. Backup jobs now use this environment. Validate actual bucket access and locks |
| `github-pages` variables | `BACKUP_AGE_RECIPIENT`, `R2_BUCKET` | R2_BUCKET present; recipient absent in inspected environment variables. Recipient is public encryption configuration |
| `github-pages` secrets | `BACKUP_AGE_IDENTITY` | Not listed. This is a private decryption key. Keep an offline recovery copy; give drill automation only the intended recovery key |
| `staging` environment | `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` | Names present |
| `staging` environment | `STAGING_SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_SITE_URL`; optional `PAGES_PROJECT` variable | STAGING_SITE_URL and PAGES_PROJECT variables are present. Add the missing private credentials here and validate. Production environment secrets do not automatically appear in staging |
| Optional Mac distribution | Six `APPLE_*` settings in `docs/MACOS.md` | Not required for the PWA pilot. Native previews are not signed public releases |

Use separate project-scoped credentials wherever the provider supports them. The frontend preflight rejects secret/service-role keys; an anon/publishable key is intentionally visible. Keep local demo credentials local. Do not run credential-import scripts on untrusted files or source them as shell code.

## Code and data review

The central action/outbox pattern is appropriate for no-signal capture. Capture transactions explicitly include related tables; resumable batch keys have regression tests. Server changes dispatch through `public.api()` to an allowlist of private functions. SQL uses an empty search path and explicit membership checks. Append-only correction semantics and ledger verification should be preserved.

`src/lib/db.ts:106` names one database for all accounts. `src/lib/db.ts:189` loads by estate ID alone. `src/pages/Estates.tsx:48` and `src/pages/Family.tsx` sign out without clearing or partitioning it. `src/lib/sync.ts` flushes before refreshing memberships, while outbox records have no account owner. This creates both cached-data exposure and possible misattribution when another authorized family member signs in on the same browser. Do not fix this by clearing pending work. Introduce an account ownership boundary, migration of existing offline data, and two-account regression coverage.

`src/pages/Reports.tsx:72,171` denies only when a membership exists and can_export is false. Unknown membership therefore fails open. `src/pages/Backup.tsx` and `src/lib/backup.ts:89` lack a comparable export check. The API report route enforces export permission, but locally generated files can bypass that route. This PR adds fail-closed checks to both report screens, the backup screen and the ZIP builder, with unit and offline browser regression coverage. Cached permissions can still be stale; account isolation remains open. Previously downloaded/offline data cannot be remotely revoked with certainty.

`src/lib/sync.ts` ignores the result of its second outbox flush before setting lastSyncAt. Pending counts still expose unsent work, but the timestamp can imply more success than occurred. Distinguish last successful pull from all uploads confirmed. Add expired-session-on-second-flush coverage.

`supabase/functions/api/index.ts:19` reports API version 0.1.0 despite frontend 0.2.2. Health is liveness, not a backend/source compatibility proof. Add deployed source identity and expected contract/version to future release smoke checks.

The API parses unbounded JSON and photo registration downloads complete files to hash them. Storage bucket limits provide one layer, but set explicit request limits, validate content types/metadata, and test maximum-size uploads before increasing exposure. The existing CORS wildcard fallback does not bypass token/RLS controls, but explicit allowed origins should be required for hosted deployment.

Dynamic domain handling correctly derives Pages paths and keeps the prior github.io API origin during migration. Browser storage does not move across domains. Before switching an existing user's origin, upload pending work or save a copy from the old installation, then verify new-origin sync. Never tell users to clear site data as the first troubleshooting step.

## UI and UX review

The strongest design choice is the room-first home action: photograph now, add details later. The five-tab navigation, large capture buttons, resumable batch list, visible upload queue, item status words and readable reports fit the family workflow. Native dialogs now cover several actions that older handoff notes still describe as browser prompts.

Recommended order of improvements:

- Reduce instructions before capture. Desktop/phone screenshots showed a long opening explanation pushing capture controls down the screen. This PR shortens it and the floating save-panel hint while retaining the one-photo-per-item and device-only save explanation.
- Make sign-in dependable first. This PR stops applying the new-account password length rule to existing-account sign-in and gives the visibility button the clear accessible name “Show password”. Account creation still requires ten characters. Email-code delivery and recovery still need real-provider testing.
- Make device-only, queued, uploaded and independently backed-up states distinct. “All saved” describes queue state, not off-site recovery. Show last actual backup/restore dates to administrators and keep failure messages actionable.
- Replace “you can't break anything” in help text with accurate reassurance about corrections. Append-only mistakes and unintended disclosures can still require care.
- Add a safe account-switch explanation and flow before allowing shared tablets. A sign-out button must not imply that local copies disappear.
- Keep “no response”, “not interested” and “sealed” visibly distinct. Existing family-report tests cover this distinction. Verify with multiple real accounts and clock/reveal boundaries.
- Finish keyboard and VoiceOver review of dialogs, scan controls, validation messages, labels and batch progress. `Field` hints are visual text without `aria-describedby`; connect them to controls.
- Test real iPhone camera/HEIC, file sharing, installed offline restart and update while editing. Chromium's tablet viewport is responsive coverage, not Safari coverage.
- Split costly scan/PDF modules where useful. Current build precaches about 3 MB and reports a main chunk above 500 KB. Measure first-use performance on an older phone before changing caching that supports offline capture.

## Security review

| ID | Severity | Evidence, impact and disposition |
| --- | --- | --- |
| S1 | High | Shared cache/account queue boundary described above. A different account can encounter earlier cached estate data or submit queued work with its token. Open launch restriction; no destructive cache cleanup introduced |
| S2 | High | Local report/ZIP permission checks failed open or were absent. Fixed in this PR at screen and ZIP-builder boundaries. Stale cached permissions and account separation remain under S1 |
| S3 | High operational | Live custom domain fails TLS. New deployment preflight fails before hosted writes; owner still needs to repair Pages certificate |
| S4 | High operational | Backups silently skipped because environment secrets were out of scope. Workflow scope/readiness fixed here; actual backup and drill still unproven |
| S5 | High | Mainbranch has no visible ruleset/classic protection. Workflow CI is not a substitute for protected merge controls. Owner configuration remains |
| S6 | Critical dependency advisory, exploitability unproven | Production dependency audit flagged DOMPurify through jsPDF. Updated the lockfile from 3.4.16 to compatible 3.4.18. Production dependency audit now reports zero findings; report generation is included in browser validation. No matching shadow-root/template-evaluation path was found in app source; do not claim demonstrated exploitation |
| S7 | Medium | Leaked-password protection disabled in live advisor. Enable if supported by the chosen plan; verify account recovery before tightening auth |
| S8 | Medium defense in depth | GitHub Pages does not apply public/_headers. Preview tests enforce CSP, production hosting does not establish that same protection. Move to a header-capable host or separately design/test supported meta CSP; frame-ancestors requires a response header |
| S9 | Medium operational | GitLab copy predates the migration removing the unsafe reset RPC. Never deploy the stale import to production; use GitHub baseline and verify removal on any new environment |
| S10 | Low | Production source maps are enabled in vite.config.ts. Public source already exists, but avoid shipping maps unless useful and intentional |

The live security-definer warnings are not evidence of a new bypass by themselves. `public.api()` is intentionally the authenticated workflow gateway; `my_estates` filters by auth.uid(), ledger access checks membership and masks sealed data, and functions use explicit schemas. The ledger's RLS with no read policy is intentional because reads use the filtered RPC. Retain those controls and tests rather than blindly granting a table policy or revoking the required gateway.

No raw HTML/eval sink was found in React app source. The readable backup HTML escapes text. Tokens persist in browser storage for the offline PWA; this makes XSS prevention and device access controls important. This review is not a forensic history scan or proof that no secret has ever been committed.

References: [DOMPurify advisory and patched version](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [Supabase password protection and plan requirements](https://supabase.com/docs/guides/auth/password-security), [security-definer advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Release and recovery acceptance

Before merging a launch candidate, record the exact commit, PR/check links, staging URL and release identity. Rehearse forward migrations on staging. Prove that a failed preflight leaves hosted state unchanged. After production publication, verify the manifest and API, sign in on an installed phone, create and sync a fictional item, and export a report. Obtain explicit authorization before adding test records to a real estate.

For frontend recovery, redeploy a reviewed artifact compatible with the current backend, then verify its source identity and installed-client update. Database migrations remain forward-only. Do not roll back data by applying destructive SQL or restoring an old database over production without a separate recovery plan and approval. Test restore into an isolated target first and compare ledger heads, photos, counts and a fresh workflow write.

Validation results for this PR are recorded below after the local and remote checks complete. Open launch gates remain open even if those checks pass.

## Validation of the proposed changes

- Local `npm run check`: lint and TypeScript passed; 48 unit tests and 15 release/deployment script tests passed.
- `npm run db:test`: 84 pgTAP tests passed against a newly created local Supabase demo stack, including migration of the retired password-reset function.
- API `deno check` passed. Independent local ledger verification passed.
- Production build passed. Existing warnings remain for a main chunk above 500 KB and the PWA plugin's deprecated inlineDynamicImports option.
- Responsive Playwright suite: 34 passed, two intentional desktop/tablet skips for the phone-only wiki screenshot test. The final short-copy build was included in the repeated full responsive suite before push.
- Browser plugin was not available. Local validation used the installed Chromium headless shell and the repository's desktop, tablet and phone projects. Chrome on macOS uses native sharing, so the report-download assertion was verified with the headless shell. Real OS share sheets and Safari remain manual pilot checks.
- Backup/restore readiness shell checks were exercised with empty, partial and complete dummy settings. Empty/partial setup failed; complete setup emitted ready=true. No real backup was dispatched.
- All workflow YAML parsed successfully; action pins were resolved against their actual release commits; `git diff --check` passed.
- Production npm audit: zero known findings after the DOMPurify patch. The full development audit still reports 19 findings (one high, 15 moderate, three low), including pinned undici under miniflare/wrangler. This is not a zero-vulnerability claim for the complete toolchain. Update the provider toolchain in a separately tested change.
- Current production API health and public access checks are read-only. No real-family sign-in, SMTP delivery, invitation, destructive security probe, remote backup/restore or production deployment was performed.

Remote PR CI must finish successfully before merge. Passing this PR does not close the operational launch gates above.
