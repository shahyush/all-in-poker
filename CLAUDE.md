# All In — project rules for Claude Code

Read first, every session: `docs/handoff/START_HERE.md`, then `docs/handoff/HANDOFF.md` (canonical build contract and rule
resolutions), `docs/handoff/REVIEW.md`, `docs/handoff/RULE_DECISIONS.json`, `docs/handoff/RELEASE_CHECKLIST.csv`.
Current state and blockers: `CHECKPOINT.md`. Release gates and evidence: `docs/RELEASE.md`.

## Non-negotiable rules
- **Private repository stays private.** Never change visibility, never enable GitHub Pro/Pages-on-private or any paid plan.
- **No costs.** Supabase free plan only; no paid add-ons, custom domains, or third-party paid services. Free hosts only
  (Netlify free tier via `netlify.toml` is the chosen frontend host; GitHub Pages is unavailable for a private free repo).
- **Preserve the existing Supabase project `vlnkslhmmbkkvbpvzuiw` and its data.** Forward-only migrations, no drops of user
  data, no project reset. Legacy rows (3 email users, 2 closed tables, prototype `app_assets`) stay.
- **Never ask for or paste secrets in chat** (passwords, service-role keys, access tokens). Secrets go in Supabase Edge
  Function secrets or GitHub Actions secrets, entered by the owner. Browser builds may contain only the publishable key.
- **Do not bypass network or permission controls.** From this cloud environment `*.supabase.co` and `api.supabase.com`
  are denied by the environment's network policy; the Supabase MCP tools are the authorised path. Do not use pg_net
  from the database to reach services the environment blocks (pg_net is only for the cron dispatcher, by design).
- **Database changes go through reviewed migrations** in `supabase/migrations/` (grouped, with rollback notes in the file
  header), applied via `apply_migration`/`execute_sql` after a short explanation. Known MCP limit: a statement containing a
  standalone `DROP` or two `delete` keywords triggers a confirmation gate that times out; split or wrap such statements.
- **Server-authoritative engine.** Hidden cards never leave `table_secrets`; clients receive `publicView()` plus their own
  `hole_cards`. All chip movement happens inside `allin_commit` (CAS). Commands carry a client `actionId` and are replayed
  from `command_receipts`; same id with a different body is a 409.
- **Tests before pushes**: `npm run test -w engine`, `npm run test -w server` (local Postgres 16 on 127.0.0.1:54329, see
  `scripts/local-db-reset.sh`), `npm run typecheck -w web`, and `npm run test:e2e -w web` when the web or engine changed.
  Keep regression tests for BUG01–05, antes in the pot, missed blinds, chip conservation, timeouts/presence and the
  tournament cases (timeout-only progression stays separate from active-betting completion).
- **Honest status.** Never call the app share-ready until a hosted multiplayer game (separate identities, all streets,
  awards, next hand, reload, reconnect, saved history) has been played on the deployed URL. Mark device checks that were
  not run as NOT VERIFIED.
- **No automated messages or invites to friends.**

## Layout and commands
See `README.md`. Workspaces: `engine/` (pure TS core), `server/` (runtime-agnostic API; Node dev server + Deno entries),
`web/` (Vite + React PWA, "After Hours" tokens in `web/src/theme.css`). Edge functions in `supabase/functions/`
(`api` loads the sha-pinned bundle from `code`; `static.ts` is the standard CLI entry). `npm run bundle:function` rebuilds
`supabase/functions/api/bundle/server.js`; update `BUNDLE_SHA` in `supabase/functions/api/index.ts` and redeploy `api` after.

## Conventions
- Commit messages: imperative summary + short body. Attribution lines as configured by the harness; no model ids in code.
- Keep the After Hours visual direction; phone portrait + landscape only; remove unnecessary text rather than add it.
- Amounts are integers in chips; `parseChipAmount` is strict; raise-to semantics everywhere.
