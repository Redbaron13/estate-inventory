# Estate Inventory

**Live app:** https://redbaron13.github.io/estate-inventory/

A private, offline-first app for a family to record a loved one's belongings and decide together where each one goes: to a family member, or to be sold, donated, recycled or thrown away. It installs on a phone from the browser (a PWA), works in a closet or basement with no signal, and syncs when the connection comes back.

Nothing is ever silently changed or lost. Every decision, edit, photo and approval is kept as a permanent, tamper-evident history; mistakes are corrected by adding a correction, never by erasing. Backups go nightly to a locked vault that even the account owner cannot delete from.

## What it does

- **Record items fast, online or not.** Photo, name, category, the room it was found in and where it is now. Scan a product barcode or one of the app's own labels. Item numbers are reserved on the phone ahead of time, so offline items still get their permanent code.
- **Item codes people can read.** `0428KB-LR7FUR-Q3X` is item 428, entered by KB, found in the living room (LR), checksum 7, furniture (FUR), plus a random tail. A mistyped code is caught by the checksum.
- **Places and boxes.** Rooms, boxes, staging areas and a holding area each get a printed label (`BOX-9Q4TR`). Scan a box, then scan items into it.
- **Duplicate check.** Flags likely duplicates (same barcode, serial, photo or a similar name in the same room) and asks: same item recorded twice, or two of them?
- **Fair decisions.** Proposals need approval by the executor, everyone, or a majority (the estate chooses). "Up for grabs" rounds can be open or sealed: sealed requests stay hidden from everyone, administrators included, until the reveal time, and ties are settled by a draw anyone can re-check.
- **Reports and labels.** Inventory, valuations, who received what, open issues and the full history, as spreadsheet files or PDF. Avery label sheets with QR codes.
- **Your own copy.** A backup file (data, history, thumbnails, optionally every photo) you can save to iCloud Drive or anywhere else from the share sheet, readable without the app.

## How it is built

| Part | Technology |
| --- | --- |
| App | React + TypeScript + Vite PWA, Dexie (on-phone database), Workbox service worker |
| API | Supabase Edge Function (Deno + Hono) at `/functions/v1/api/v1`, spec in `api/openapi.yaml` |
| Database | Supabase Postgres: append-only tables, per-estate hash-chained history, row-level security |
| Files | Supabase Storage, content-addressed (`{estate}/{sha256}.jpg`), no overwrite or delete |
| Hosting | GitHub Pages: https://redbaron13.github.io/estate-inventory/ (published automatically after tests pass). Cloudflare Pages is wired up in `deploy.yml` for when its token is added |
| Backups | GitHub Actions, nightly to a Cloudflare R2 bucket with lock rules; monthly restore drill |

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md).

## Working on it

First time on a computer:

- Windows: `powershell -ExecutionPolicy Bypass -File setup\setup-windows.ps1`
- Mac: `bash setup/setup-mac.sh`
- Any device with a browser: open the repository on GitHub, **Code > Codespaces > Create codespace**

Each sets up the tools, links the folder to GitHub, starts a local database with demo data and writes `.env.local`. Then:

```
npm run dev          # http://localhost:5173  (sign in as alex@example.com / estate-demo-pass)
npm run check        # lint, types, unit tests
npm run db:test      # database tests
npm run test:e2e     # phone-sized browser tests (needs `npm run build` and `npm run preview` running)
```

Making and releasing a change is described in [docs/PIPELINE.md](docs/PIPELINE.md). Operating it (secrets, backups, restore, incidents) is in [docs/RUNBOOK.md](docs/RUNBOOK.md). A plain-language guide for family members is in [docs/USER-GUIDE.md](docs/USER-GUIDE.md).

## Repository map

```
src/                    the app (pages, components, lib: sync, outbox, codes, PDF, backup)
supabase/migrations/    database schema, history chain, access rules, workflows
supabase/functions/     api/ (the /api/v1 function) and _shared/ (code shared with the app)
supabase/tests/         database tests (pgTAP)
tests/unit, tests/e2e   app tests (Vitest, Playwright)
scripts/                independent history and backup verifiers
setup/                  computer setup and backup vault setup
.github/workflows/      CI, deploy, nightly backup, monthly restore drill
```
