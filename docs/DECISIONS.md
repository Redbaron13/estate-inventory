# Decisions

Why the app is built the way it is. Newest decisions go at the bottom; a decision that changes gets a new entry rather than an edit, so the reasoning trail stays intact.

| # | Decision | Why | Rejected alternatives |
| --- | --- | --- | --- |
| 1 | Built for one family first, not a public product | Fewer moving parts, no billing or support burden; the design can still grow later | Multi-tenant SaaS from day one |
| 2 | Records are append-only; mistakes are corrected by adding a record | The point of the app is trust between siblings. If anything can be silently edited, nothing can be trusted | Soft deletes, edit-in-place with an audit table (audit tables can be edited too) |
| 3 | Per-estate hash-chained history, verified by every phone and by an independent script | Makes tampering visible even to someone with full database access, without blockchain overhead | Database audit logs only; external notarization services |
| 4 | Photos stored by content hash in an insert-only bucket | A photo can't be replaced with a different one under the same record; duplicates cost nothing | Mutable file paths |
| 5 | Mistaken uploads are hidden ("redacted") and kept in the vault | Keeps the record complete while respecting privacy in the app | Hard delete |
| 6 | Supabase backend (Postgres, Auth, Storage, Realtime, Edge Functions) | Requested; one service covers database, sign-in, files and API with a usable free tier | Firebase, self-hosted Postgres |
| 7 | API is a Supabase Edge Function at `/api/v1` running as the signed-in user, never the service-role key | Database access rules then protect the API too; a bug in the function can't bypass them | Service-role API with checks in code |
| 8 | Static React (Vite) PWA hosted on Cloudflare Pages | Installs from the browser on iPhone and Android, works offline, free hosting, R2 in the same account | Native apps (store review, two codebases), Next.js (server not needed), Vercel (moved to Cloudflare to sit with R2) |
| 9 | Offline-first: full estate copy on the phone, outbox with idempotency keys, field-level conflict checks | Closets, basements and garages have no signal; nothing typed there may be lost or applied twice | Online-only; last-write-wins sync |
| 10 | Item numbers reserved per phone in blocks (50 at first, reduced to 20 so numbers stay close to the item count) | Offline items get their permanent code at capture, without collisions | Temporary codes renumbered on sync (confusing on printed labels) |
| 11 | Item code `0428KB-LR7FUR-Q3X`: number, member, room found, check digit in the middle, category, random tail | Readable aloud; separates where it was found from what it is; check digit catches typos; the middle position avoids an extra dash | Item name in the code (too long, changes when renamed); UUIDs |
| 12 | Place codes like `BOX-9Q4TR` with QR labels; a Holding area for scanned items not yet put away | Staging areas and boxes are how estate clear-outs actually run | Free-text locations |
| 13 | Duplicate check asks "same item twice, or two of them?" and records the answer | Sets of identical items are common in a house; auto-merging would lose real items | Automatic de-duplication |
| 14 | Claim mode chosen per estate: sealed or open | Families differ; sealed requests prevent "I only want it because you do" | One fixed mode |
| 15 | Default approval: executor approves, with unanimous or majority as options; rule and approvers snapshotted per proposal | Matches how estates are legally administered, while allowing families to choose otherwise | Unanimous only (one person can block everything) |
| 16 | Sign-in by 6-digit email code, plus an optional password | Magic links open in Safari instead of the installed app on iPhone; codes work everywhere. Password covers email delays | Magic links only |
| 17 | 7-year retention default | Covers typical estate, tax and dispute timelines | Indefinite (unbounded cost); 3 years |
| 18 | Backups: nightly encrypted dump plus photos to a Cloudflare R2 bucket with lock rules; monthly automated restore drill | Supabase's free tier has no backups; locks make backups survive account compromise or mistakes; drills prove they restore | Supabase backups alone (same provider, deletable) |
| 19 | Nightly backups locked 1 year then expire; monthly copies and all photos locked 7 years | Keeps the vault within R2's free 10 GB while honouring the retention period | Every nightly copy for 7 years (about 2,500 copies, nearly all redundant) |
| 20 | Vault in western North America, database in US East | One regional outage can't take out both copies | Same region |
| 21 | Backups include the app's rules on Supabase-managed tables (`hooks.sql`) | `supabase db dump` leaves them out; a restore without them loads the data but breaks photo access, live updates and new sign-ups. Found by test-restoring | Relying on migrations being re-run after a restore |
| 22 | Deploys: CI on every pull request; staging automatically from main if configured; production only by a manual run with typed confirmation | One person maintaining it; production changes should be deliberate | Continuous deployment to production |
| 23 | Local development and GitHub Codespaces both supported | Work on the Windows PC, then continue on another device | Local only |
| 24 | Your own copy: on-device ZIP (data, history, thumbnails, optional photos, readable HTML inventory) saved via the share sheet to iCloud Drive | Works offline and on iPhone without iCloud APIs; readable without the app | iCloud/CloudKit integration (needs a native app and Apple developer account) |
| 25 | Batch inventory replaces "Scan and put away": a running list (scan, type or photograph), shared traits set once, save all | Clearing a room means dozens of similar items; entering each one separately is the main time sink | One-at-a-time capture only |
| 26 | Marking photos are stored as media kind MARK next to a Markings text field | An inscription is evidence; a photo preserves what the text can't | Text only |
| 27 | Files are handed over with a share-sheet-first saver that asks for one more tap when iOS refuses | iOS opens the share sheet only right after a tap; a download fallback is ignored by installed web apps | Plain downloads |
| 28 | Host the app on GitHub Pages for now (supersedes the hosting part of 8) | Works with what's already connected; no extra account or token. Cost: no response headers, so the CSP isn't enforced there | Cloudflare Pages (needs an API token), Vercel (connector lacks access to the team) |
| 29 | Default branch is `mainbranch`; CI and deploy trigger on it | Owner's directive; one branch name everywhere | Keeping `main` alongside it |
| 30 | Estate ID is 18 characters: time hex, name slug, reverse-alphabet sequence tier, random, mod-36 check character (`estate-id.ts`); stored in `estates.estate_code`, unique | Owner-specified scheme; self-validating, no personal numbers stored | EST-YYYY-HEX8 from an SSN hash |


| 31 | Releases use major.minor.patch plus the approved eight-character custom identifier; undeployed builds prepend ZY | Owner-confirmed format; persistent reservations prevent collision and a positional checksum catches common transcription errors | Shortened random UUIDs without a registry |
| 32 | CI gates automatic web production releases from mainbranch and staging releases from develop; backend deploy runs before frontend when configured (supersedes 22) | Owner requested an easy live and development pipeline; production refuses backend changes when credentials are absent | Independent backend/frontend jobs that can publish an incompatible app |
| 33 | Keep one responsive PWA as both installed and browser application for this release | Preserves offline behavior and the existing shared data model on phones and computers without introducing signing and store dependencies | Claiming native package support without producing signed packages |
| 34 | Add a native macOS WebKit host alongside the PWA (extends 33) | Owner requested the Mac app workflow. Reuses inventory rules and reports while adding native file handling. CI previews use ZY IDs; public packages require Developer ID signing and notarization | Reimplementing the append-only inventory in a second client |
| 35 | Patch only app-owned hosted auth settings and verify them after deployment | The full CLI config push inherited local auth settings and the default sender rejected custom templates, blocking release 0.2.0. Preserve production security settings and apply templates only with custom SMTP | Ignoring config errors or weakening email confirmation |

| 36 | Retire the public temporary-password RPC and use verified Supabase Auth recovery | The legacy function allowed an unauthenticated administrator password reset. A forward migration removes it; client code, database regression tests and hosted smoke verification enforce the boundary | Keeping a browser flag as the only gate on a privileged function |

| 37 | Derive the web base path and Mac home from the registered Pages target; test Mac rendering on a local fixture | The custom domain moved the app to the root and an unavailable live origin blocked repair builds. Keep HTTPS and origin checks; preserve the prior API origin so existing installed clients can sync | Hardcoded github.io URLs or weakening native navigation checks |
