# Notes for AI agents

Read [HANDOFF.md](HANDOFF.md) first: current state, accounts, gotchas, open items and backlog. Then `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

Rules that matter here:

- The repository is public. Never commit passwords, tokens, service-role keys or the age private key. `.env.hosted` holds only public client values.
- Records are append-only by design. Don't add UPDATE/DELETE paths to append-only tables; corrections are new rows.
- Every write from the app goes through `src/lib/actions.ts` and the outbox; every server write through `public.api()`. A Dexie transaction must list every table it touches.
- Run `npm run check`, `npm run db:test` and the Playwright tests before pushing. CI must be green; the `pages` job publishes the live app.
- Commit as `Kevin Baron <98280733+Redbaron13@users.noreply.github.com>`; pushes with any other email are rejected.
- Writing style for docs and app text: plain, short, sentence case, no em dashes.
