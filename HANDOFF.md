> Domain update, 2026-10-24: Pages is configured for eiapp3.redbaronworks.com. A DNS-only CNAME now points it to redbaron13.github.io. Confirm certificate issuance, HTTPS enforcement and the exact release manifest before treating the domain as ready. Deploy and Mac builds derive their URL/base from Pages metadata. Existing github.io clients retain API access for queued sync; local data does not transfer between origins. Deployment credentials were located in the owner's private textfiles/.env.vercel file; never commit it.

> Update, 2026-10-22: PR #27 merged at 36db31a. Its CI passed, including database and responsive end-to-end tests. Production deployment stopped after migrations because the default Supabase email provider rejected custom email templates. Release 0.2.1 removes the unsafe public temporary-password reset RPC and its client fallback, adds a regression test and a hosted API absence check, and adds a narrow verified auth update, credential import from private textfile/.env, and a native Mac host with CI previews and optional signed distribution. Verify the new Deploy run before treating 0.2.1 as live. Release 0.2.2 deploys a Pages artifact directly from approved mainbranch rather than the blocked gh-pages branch, and fixes the batch Save panel background. See docs/RELEASES.md and docs/MACOS.md.

# Handoff: Estate Inventory

The working state of the project for the next person or AI agent picking it up. Read this first, then `README.md`, then `docs/`. Deployment guidance updated 2026-10-24. The dated baseline below describes the original installation; use docs/RELEASES.md and the latest Deploy run for current release status.

## 1. What this is and who it's for

A private, offline-first PWA for one family (the owner, Kevin Baron, and his siblings) to inventory a deceased parent's personal property and decide where each item goes (a family member, sale, donation, recycling, disposal) with as little conflict as possible. Core promises:

- **Nothing is silently changed or lost.** Append-only records, a per-estate hash-chained history, content-addressed photos, locked off-site backups.
- **Works with no signal** (closets, basements). Everything is recorded on the phone and syncs later.
- **Fair decisions.** Approval rules (executor, unanimous, majority), sealed up-for-grabs rounds hidden even from administrators, verifiable random draws.

**Owner's working preferences:** concise and direct; no em dashes in writing; challenge flawed assumptions; accuracy matters. Owner is a NJ paralegal; this is a family tool first, not a commercial product.

## 2. Current status (2026-10-12)

| Area | State |
| --- | --- |
| Live app | https://redbaron13.github.io/estate-inventory/ (GitHub Pages; releases now deploy artifacts from protected `mainbranch`) |
| Backend | Supabase project `dszldulsyoovtnsaquay` (US East, Postgres 17), all 11 migrations applied; schema fingerprint matches the tested local database exactly (708 objects) |
| API | Supabase Edge Function `api`, version 2, serving `/functions/v1/api/v1/*` |
| Tests | 29 unit, 79 database (pgTAP), 6 end-to-end (Playwright, phone size); all green locally and in GitHub Actions |
| Pipeline | PR: CI. Push to mainbranch: CI, then GitHub Pages publish (staging/production deploy steps skip until their secrets exist) |
| Backups | Built and tested (dump, encrypt, R2 upload, restore drill proven locally) but **not running**: R2 not enabled and secrets not set. Jobs skip quietly; a nightly keep-alive runs |
| Email sign-in codes | **Not working on hosted** (see Known issues). Password sign-in works |
| Data in production | One estate, "Demo estate (sample data)" with fictional items, owner as administrator plus two demo members (blair.demo@example.com, casey.demo@example.com). The owner has started adding real test items there |

Credentials are **not** in this file or the repo (the repo is public). The owner received his temporary password and the demo members' password in chat. Ask him; never commit them.

## 3. Where everything lives

| Thing | Location / identifier | Notes |
| --- | --- | --- |
| Code | github.com/Redbaron13/estate-inventory, branch `mainbranch` (default) | **Public** repo. Commits must use the GitHub no-reply email `98280733+Redbaron13@users.noreply.github.com` (the account blocks pushes exposing the personal email) |
| Hosted app | GitHub Pages artifact from approved `mainbranch` (`deploy.yml`, job `release`) | Base path `/estate-inventory/`; built with `VITE_BASE=/estate-inventory/ vite build --mode hosted` |
| Supabase | Project ref `dszldulsyoovtnsaquay`, org created through the **Vercel Marketplace** integration | Billing/plan changes go through Vercel. Free plan: pauses after 7 days idle (keep-alive in `backup.yml`), no Supabase backups |
| API deployment | Entry file deployed via Supabase MCP imports the real source from jsDelivr at a **pinned commit**: `https://cdn.jsdelivr.net/gh/Redbaron13/estate-inventory@9c3b7cb6644764d46a230317217f99934d4304e0/supabase/functions/api/index.ts` | API code unchanged since that commit. To update: push, then redeploy the one-line entry with the new SHA (pass `import_map_path: "deno.json"` or the deploy fails). Or set `SUPABASE_ACCESS_TOKEN` and use `deploy.yml` |
| Public client config | `.env.hosted` (URL, publishable key, API URL) | Public by design. Only loaded by `--mode hosted`; never by local/CI test builds |
| Cloudflare | Personal account `d5b087b4eafcf7a455495e0b05d1fbda`; LLC account `2690df298302ce7e277c5a7f35f848b6` | R2 **not enabled** on the personal account yet (needs dashboard + card). No API token available to agents |
| Vercel | User `kbaron-7828`, team `baron-aerial-media` | The Vercel connector used by agents lacks access to that team scope; `vercel.json` is ready if it's re-authorized |
| Claude project | claude.ai Project "EstateProperty-App" | A copy of this handoff is saved there |

## 4. Architecture in brief

Full detail: `docs/ARCHITECTURE.md`. Decisions and reasons: `docs/DECISIONS.md` (27 entries).

- **Frontend**: React 19 + TypeScript + Vite 8 PWA (`src/`). Dexie (IndexedDB) holds a full copy of each estate; an outbox queues writes with idempotency keys; Workbox service worker caches the whole app. Barcode scanning via native BarcodeDetector or bundled zxing-wasm. PDFs (jsPDF), QR labels, ZIP backup to iCloud via share sheet.
- **API**: Deno + Hono Edge Function (`supabase/functions/api/index.ts`) running **as the signed-in user** (never service role). All writes go through `public.api(fn, args, key, hash)`, which dispatches to `private.api_*` SECURITY DEFINER functions with idempotency.
- **Shared logic** (`supabase/functions/_shared/`): item/place codes, domain rules (proposal state, rounds, duplicates, exceptions), report builders, ledger verification. Used by both app and API. Unit tests cross-check against SQL-generated fixtures.
- **Database** (`supabase/migrations/`): append-only tables (triggers raise `EI423`), mutable tables only via workflow functions, per-estate hash chain `hash_n = sha256(hash_{n-1} || payload_n)`, RLS everywhere (sealed claims hidden until reveal), storage bucket `estate-media` insert/read only, content-addressed paths.
- **Codes**: item `0428KB-LR7FUR-Q3X` (number, member initials, room found, mod-11 check digit, category, random tail); place `BOX-9Q4TR`.

### Key files

| Path | What |
| --- | --- |
| `src/lib/actions.ts` | Every local write (capture, edits, photos, proposals, rounds, custody) and its outbox op. `ITEM_TABLES` must list every table a capture touches |
| `src/lib/sync.ts`, `outbox.ts`, `db.ts` | Sync engine, outbox replay, Dexie schema |
| `src/lib/config.ts` | Number block size (20, refill below 8) and endpoints |
| `src/components/FileSaver.tsx`, `src/lib/files.ts` | Share-sheet-first file delivery with the iOS "tap again" fallback. Use `useFileSaver()` for any generated file |
| `src/pages/QuickScan.tsx` | Batch inventory (route `/e/:id/scan`) |
| `src/pages/Capture.tsx` | Single-item capture wizard (photos, library picker, markings + marking photo, duplicates, next step) |
| `src/pages/Reports.tsx` | Report list and per-report screen (`/e/:id/reports/:key`) |
| `supabase/migrations/20261011120400_workflows.sql` | All business rules on the server |
| `scripts/verify-ledger.mjs`, `verify-backup.mjs`, `dump-platform-hooks.sql`, `restore-write-check.sql` | Independent history check, vault check, backup of rules on Supabase-managed tables, restore usability check |
| `.github/workflows/` | `ci.yml`, `deploy.yml` (CI, Pages, staging/prod), `backup.yml`, `restore-drill.yml` |
| `setup/` | Windows/Mac dev setup, R2 vault setup (`r2-setup.mjs`) |

## 5. How to work on it

```
npm ci
npx supabase start            # local stack + demo seed (alex@/blair@/casey@example.com, password estate-demo-pass, local only)
npm run dev                   # http://localhost:5173
npm run check                 # lint + types + unit
npm run db:test               # pgTAP
npm run build && npm run preview &   # then: npx playwright test
deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts
```

Release: push to `mainbranch`; CI must pass; the `release` job deploys the verified Pages artifact from mainbranch. Database changes: new migration file, test locally, then apply to hosted (CLI `supabase db push` with secrets, or the Supabase MCP `apply_migration`).

### Agent-environment gotchas (cloud sandbox)

- Docker stops when the workspace idles. Restart with `nohup dockerd &`; the Supabase containers come back with their data.
- The local edge runtime can't boot behind the sandbox proxy. Serve the API with plain Deno instead (`SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon> DENO_CERT=/root/.ccr/ca-bundle.crt deno run --allow-net --allow-env --config supabase/functions/api/deno.json supabase/functions/api/index.ts` on :8000) and set `VITE_API_URL=http://127.0.0.1:8000/api/v1` in `.env.local`. Normal machines don't need this.
- Playwright: `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Supabase MCP `apply_migration` / `execute_sql` **hang until timeout on statements it treats as destructive** (DROP, DELETE, UPDATE without WHERE) because they need a human confirmation. Use `ALTER POLICY`, `CREATE OR REPLACE`, `UPDATE ... WHERE`.
- Large migrations can be applied in parts; then fix `supabase_migrations.schema_migrations` versions to match the files (parts 2 and 3 of workflows are recorded as `20261011120401/402`, backed by no-op placeholder files).
- `gh api` works only for repository-scoped endpoints; repo settings (Pages config) can't be changed from the sandbox.
- Each fresh browser session signed in to an estate reserves a block of item numbers. Testing against the owner's live estate creates number gaps; prefer local tests.

## 6. Work completed (in order)

1. Database: schema, append-only triggers, hash-chained ledger, RLS, approvals, sealed rounds, duplicates, redactions, 79 pgTAP tests.
2. API (`/api/v1`, OpenAPI 3.1 in `api/openapi.yaml`) and shared TypeScript modules.
3. Offline-first PWA: capture with photos and barcodes, places and QR labels, decisions, up for grabs, reports, iCloud backup ZIP, history witness on each phone.
4. Pipeline and backups: CI, deploy, nightly encrypted R2 backup with lock tiers, monthly restore drill. The restore path was proven end to end locally and found that `db dump` omits policies and triggers on Supabase-managed tables; `hooks.sql` now covers that.
5. Hosted deployment: migrations, API function, GitHub Pages, demo estate, owner login, change-password option.
6. 2026-10-12 fixes and features:
   - Fixed "object store was not found" when saving a new item as **Up for grabs** (`grab_rounds` missing from the capture transaction; audit found no other gaps).
   - Reports rebuilt: each report on its own screen, content first, phone-readable cards, Save PDF / Spreadsheet, iOS share-sheet fallback.
   - QR labels were solid black squares (modules drawn 0.15in too large). Fixed; a rendered sheet decodes 20/20.
   - **Batch inventory** replaces "Scan and put away": running list from scans, typed names or photos (one item per photo); shared room found, destination, kind, brand, condition, valuable flag; per-row overrides; save all; labels for the batch; scanned item labels become moves; list persists on the phone.
   - **Markings** text field plus "photo of the marking" (media kind `MARK`) on capture and item pages; **choose several earlier photos** from the library at once.
   - Smaller per-device number blocks (20).
   - Supabase advisor fix: three RLS policies now use `(select auth.uid())`.
   - Migration history on hosted aligned with repo files.

## 7. Remaining for the current goal (a family-ready app)

**Needs the owner (accounts and secrets):**
1. Change the temporary password (Family and settings > Password).
2. **Email**: create a Resend account, verify a domain, add SMTP in Supabase Auth settings, then set `email_sent` in `supabase/config.toml` `[remotes.production.auth.rate_limit]` to 30. Until then siblings can't receive sign-in codes or invitation confirmations. (`docs/RUNBOOK.md`, step 5.)
3. **Supabase access token** as GitHub secret `SUPABASE_ACCESS_TOKEN` (+ `PROD_*` secrets). Unlocks `supabase config push`, which applies the 6-digit code email template and redirect URLs; without it, "Email me a code" sends a magic link the app doesn't use.
4. **Backups**: enable R2 in the Cloudflare dashboard, `npx wrangler login`, `node setup/r2-setup.mjs`, create the R2 token, age key pair, then the secrets listed in `docs/PIPELINE.md`. Run Backup, then Restore drill, once by hand.
5. Decide: Supabase Pro ($25/month via Vercel) before real data; keep the repo public or not (private needs a paid GitHub plan for Pages); enable leaked-password protection in Supabase Auth.

**Agent can do once those exist:**
- Run `supabase config push` and verify a real 6-digit code sign-in on an iPhone.
- First backup + restore drill; check the job summaries.
- Invite flow end to end with a real sibling email.

## 8. Known issues and limits

- Hosted "Email me a code" doesn't work yet (above). Password sign-in works.
- The demo estate is permanent (append-only by design). Real work should go in a new estate ("Switch estate" > start one). The demo estate has number gaps from test sessions.
- Deep links on GitHub Pages return HTTP 404 with the app shell (the `404.html` fallback); harmless, but uptime monitors will see 404s on deep URLs.
- GitHub Pages can't set response headers, so the Content Security Policy from `public/_headers` / `vercel.json` isn't enforced there (it is in local/CI preview and would be on Cloudflare or Vercel).
- Supabase advisors still list 69 unindexed foreign keys and unused indexes (INFO). Irrelevant at family scale; revisit if data grows.
- iOS: the share sheet needs a fresh tap; handled by `useFileSaver`. Installed PWAs show "A new version is ready" after a release; tap it to update.
- Reasons (hide a photo, set aside or withdraw a decision, remove a member) are typed into `window.prompt`, and several confirmations use `window.confirm`. They work, but look out of place in an installed app and can't be styled.

## 9. Planned future work (backlog, roughly by value)

1. Release a device's unused item numbers on sign-out (void them) to keep numbering tight.
2. Batch inventory: optional duplicate check per row before saving (today duplicates surface in the Exceptions report).
3. Equalization view: running total of assigned value per beneficiary, with inheritance-credit accounting.
4. Notifications (email or push) when a decision needs someone or a sealed round reveals.
5. Edit a photo's kind after upload; reorder photos; set the cover photo.
6. Printable one-page item sheet (photos, history, values) for appraisers or attorneys.
7. Move hosting to Cloudflare Pages (token needed) so the CSP headers apply; add a staging Supabase project.
8. Account removal flow (anonymize profile; history keeps the id).
9. MFA enforcement for administrators and executors.
10. Accessibility audit and VoiceOver pass on the batch and report screens.
11. Replace the remaining `window.prompt`/`window.confirm` uses with the app's Dialog.
12. Index foreign keys if an estate grows past a few thousand items.

## 10. Verification recipes

- Schema parity: run `scripts/schema-fingerprint.sql` on local (`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f ...`) and hosted (SQL editor or MCP `execute_sql`); both must return the same hash. On 2026-10-12 both returned `2557e1a53ebc8c59e8ce80f933a18bf6` (708 objects).
- History: `DATABASE_URL=... node scripts/verify-ledger.mjs` (add `--heads file` to compare with saved fingerprints).
- Labels: render `itemLabelsPdf` output with `pdftoppm -r 200` and decode with zxing-wasm; every code must decode.
- Live smoke: `curl https://dszldulsyoovtnsaquay.supabase.co/functions/v1/api/v1/health`.

