# Task: map the directive's role matrix onto estate roles

Status: not started. Feature flag: none needed (policy only).

Goal: ESTATE_EXECUTOR, LEGAL_COUNSEL, BENEFICIARY and AUDITOR map onto the existing `estate_members` roles. Compare the matrix in the directive with the policies in `supabase/migrations/20261011120300_access.sql`.

Rules:
- Append-only tables stay append-only. No new UPDATE or DELETE paths.
- Writes go through `src/lib/actions.ts` and `public.api()`.
- Add a pgTAP test per role in `supabase/tests/`.
- Run `npm run check`, `npm run db:test` and the Playwright tests.
