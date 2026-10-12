# Architecture

## Shape of the system

```
 Phone (PWA)                                   Supabase (one project per environment)
 ┌──────────────────────────────┐   HTTPS     ┌──────────────────────────────────────┐
 │ React UI                     │ ──────────▶ │ Edge Function  /api/v1  (Hono, Deno) │
 │ Dexie: full copy of each     │   bearer    │   checks the user's token, then      │
 │   estate the user belongs to │   token     │   calls public.api() AS that user    │
 │ Outbox: changes made offline │             │                                      │
 │ Blob store: photos not yet   │ ── signed ─▶│ Storage  estate-media (insert-only)  │
 │   uploaded                   │   upload    │                                      │
 │ Witness: last verified       │ ◀─ pull ─── │ Postgres                             │
 │   history fingerprint        │ ◀─ live ─── │   append-only tables + ledger        │
 │ Service worker: whole app    │  broadcast  │   row-level security                 │
 │   cached for offline use     │             │   SECURITY DEFINER workflow functions│
 └──────────────────────────────┘             └──────────────────────────────────────┘
          ▲                                             │ nightly (GitHub Actions)
          │ GitHub Pages (static files)                 ▼
                                               Cloudflare R2 vault (bucket lock rules)
```

The API never uses the service-role key. Every request runs as the signed-in user, so the database's own access rules apply to the API exactly as they would to a direct query.

## Data that cannot be quietly changed

**Append-only tables.** Most tables (decisions, valuations, custody events, claims, media, redactions and so on) reject `UPDATE`, `DELETE` and `TRUNCATE` with error `EI423`, enforced by triggers, so this holds even for code with full table access. A correction is a new row that refers to the old one: a decision is invalidated by a `decision_invalidations` row; a mistaken photo is hidden by a `redactions` row and stays in the vault.

**A few tables hold current state** (estates, members, invites, locations, items, profiles). Nobody can write them directly. They change only through `private.api_*` functions reached through `public.api(fn, args, idempotency_key, request_hash)`, and every change writes a ledger entry.

**Hash-chained history.** Each estate has its own chain in `public.ledger`:

```
hash_n = sha256( hash_(n-1) || payload_n )     hash_0 = 64 zeros
```

A per-estate advisory lock keeps sequence numbers gapless. Rewriting any past entry changes every hash after it. Three independent checks look for that:

1. Each phone stores the last fingerprint it verified and checks that new entries continue from it (`src/lib/sync.ts`, `checkHistory`). If the server's history ever stops matching, that phone shows a warning on the Backup screen with the entry number and the fingerprint it last saw. Entries withheld from a member (sealed requests before the reveal) still have their links checked; their contents are checked once revealed.
2. `scripts/verify-ledger.mjs` recomputes every chain in Node without trusting the database, and compares against fingerprints saved in the vault the night before. It runs nightly and in every restore drill.
3. The fingerprints themselves are stored under `heads/` in the locked vault, so the reference point cannot be edited either.

**Photos and documents** are stored by content hash, `{estate_id}/{sha256}.{ext}`. The storage bucket allows inserts and reads only. When a photo is registered, the API downloads the stored bytes and re-hashes them; the record is refused if they don't match.

## Offline sync

- Each estate the user belongs to is mirrored in IndexedDB (Dexie). The app reads only from the local copy, so every screen works offline.
- Changes go into an outbox in order. Each entry's id is also its idempotency key, so a request repeated after a dropped connection has no second effect (`private.idempotency_keys`).
- Sync pushes the outbox, then pulls changes since a cursor. The cursor is a Postgres transaction id snapshot (`pg_snapshot_xmin`), so rows committed late by long transactions are never skipped.
- Item edits carry the field values they were based on. If someone else changed the same field in the meantime, the server refuses with a conflict and the app shows both versions to choose from. Edits to different fields merge.
- Live updates arrive as Supabase Realtime broadcasts on `estate:{id}`, which just prompt a pull. Only members can subscribe.

**Item numbers offline.** Each phone reserves a block of 20 numbers (refilled below 8; `src/lib/config.ts`). Small blocks keep numbers close to the real item count when several phones are in use. Offline items use the next reserved number, so codes are permanent from the moment of capture. Unused numbers can be voided, which is recorded. If a phone runs out offline, items are saved as drafts and get numbers on reconnect.

## Codes

```
0428KB-LR7FUR-Q3X
└┬─┘└┤ └┤│└┬┘ └┬┘
 │   │  ││ │   └ random (Crockford base32)
 │   │  ││ └ category (21 codes: FUR, KIT, JWL, ART, ...)
 │   │  │└ check digit (mod 11 over the whole code)
 │   │  └ room where found (from the nearest room or property)
 │   └ member who entered it (2 letters, unique per estate)
 └ inventory number (4+ digits)
```

Place codes: `BOX-9Q4TR` (prefix PRP, RM, BOX, STG, HLD, PER, EXT). The same rules are implemented in SQL (`private.code_check_digit`, `private.new_item_code`) and TypeScript (`supabase/functions/_shared/codes.ts`); the unit tests feed SQL-generated codes to the TypeScript parser so the two can't drift apart.

## Decisions and fairness

- **Approval rule** per estate: executor (falls back to administrators), unanimous, or majority. The rule and the list of eligible approvers are snapshotted when a proposal is made, so changing members later can't change an open vote. Someone receiving an item can't approve their own assignment.
- **Auto-approval** is possible only below a value threshold, only with a recorded value, never for items marked potentially valuable. Above `unanimous_above` everyone must agree.
- **Sealed rounds.** Requests are hidden by row-level security until the reveal time by the server's clock, and the ledger API withholds their payloads until then, so administrators can't peek either.
- **Random draws** are verifiable: `winner = sorted_candidates[ int(first 8 hex of sha256(seed)) mod n ]`, with the seed recorded.

## Duplicates

Candidates are found by barcode, serial number, identical photo hash, and name similarity (trigram) within the same room. A reviewer records a verdict: same item (the duplicate is merged into the original, with its photos and values copied; nothing is deleted), different items, or unsure.

## Environments

| Environment | Database and API | App | Data |
| --- | --- | --- | --- |
| Local | `npx supabase start` (Docker) | `npm run dev` | demo seed |
| CI | fresh local stack per run | built and served by `vite preview` | demo seed |
| Staging (optional) | second free Supabase project | Cloudflare Pages branch `staging` (once its token exists) | test data |
| Production | Supabase project `dszldulsyoovtnsaquay` | GitHub Pages, `gh-pages` branch, built from `main` after CI passes | real data |

## Security posture in one list

- Anonymous users get nothing. Signed-in users read only rows from estates they belong to.
- No table accepts direct writes from the app; all writes go through permission-checked functions.
- Sign-in by 6-digit email code or password; optional authenticator-app 2FA.
- Content Security Policy limits the app to its own files and Supabase (`public/_headers`). Enforced by hosts that honour `_headers` (Cloudflare Pages) or `vercel.json`, and in CI; GitHub Pages can't send headers, so it isn't enforced on the current live site.
- Backups are encrypted with age before leaving GitHub; the private key is kept offline.
