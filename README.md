# All In — private poker for friends (play chips only)

A phone-first progressive web app for a closed group: one shared group password at the door, a private player
identity per device, dealer's-choice cash games and tournaments, a server-authoritative engine, and saved history.
No real money, no email, no phone numbers.

* **App URL (GitHub Pages):** https://shahyush.github.io/all-in-poker/ — goes live once the repository is public (see `docs/RELEASE.md`)
* **Backend:** Supabase project `vlnkslhmmbkkvbpvzuiw` (free plan) — Postgres + RLS, anonymous auth, Realtime, Edge Functions, pg_cron
* **Status and evidence:** `docs/RELEASE.md` · **How to host / play / install:** `docs/GUIDE.md`

## Layout

| Path | What |
| --- | --- |
| `engine/` | Pure TypeScript poker core: CSPRNG deck, hold'em / Omaha (4–6 cards) evaluation, side pots, dealer's choice, blinds/antes/straddle, missed-blind policy, pot-limit cap, TDA reopening, run-it-twice, tournaments, timers, host succession, deal/board animation plans. 50 vitest tests incl. the five reproduced defects BUG01–05 and the exhaustive 2,598,960-hand evaluator check. |
| `server/` | Runtime-agnostic command API (`/cmd`, `/jobs`): admission, recovery codes, tables, every game command, reloads, chat, host transfer, due-table jobs. Idempotent by `actionId`, compare-and-set commits through `allin_commit`. Node dev server for local play; Deno entry for the edge. 15 integration tests on a real Postgres (RLS matrix, replay, timers, host loss, tournament, archive). |
| `web/` | Vite + React PWA ("After Hours" look), portrait and landscape phone table, real deck-to-seat dealing and staged board reveals, offline shell. 4 Playwright multi-client journeys (`web/e2e`). |
| `supabase/migrations/` | Forward-only migrations on the existing project (no data dropped). `supabase/functions/{api,code,app}` edge functions. |
| `scripts/` | `bundle-function.mjs` (esbuild the server for Deno), `publish-assets.mjs` (upload a bundle to the asset store), `local-db-reset.sh`. |
| `docs/` | Release gates, evidence screenshots, host/player guide. |

## Run locally

```bash
npm ci
# local Postgres 16 on 127.0.0.1:54329 (see scripts/local-db-reset.sh), then:
npm test                         # engine + server (needs ALLIN_DB_URL / ALLIN_ADMIN_DB_URL, see .env.example)
ALLIN_GROUP_PASSWORD=friday-night npm run dev:server   # API on :8787 with a 1s job ticker
VITE_DEV_API=http://127.0.0.1:8787 npm run dev:web     # PWA on :5173 (polling transport)
npm run test:e2e -w web          # Playwright journeys against the two dev servers
```

## Build and deploy

* **PWA:** `.github/workflows/pages.yml` builds `web/` and deploys to GitHub Pages on every push to `main`
  (`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` default to this project; override with repository variables).
* **Database:** apply `supabase/migrations/*.sql` in order (`supabase db push`, or the SQL editor). All four are recorded in
  `supabase_migrations.schema_migrations` on the live project.
* **API:** `npm run bundle:function` → `supabase/functions/api/bundle/server.js`. The deployed `api` function loads that exact
  bundle (sha256-pinned) from the `code` function, which serves it from `public.app_assets`. To ship a new bundle: store the
  sha256 of a one-time token in `app_settings.upload_token_sha`, run the *Publish server bundle* workflow with the token,
  clear the setting, then redeploy `api` with the new `BUNDLE_SHA`. With the Supabase CLI you can instead deploy the bundle
  directly: `supabase functions deploy api --no-verify-jwt`.
* **Secrets:** only `GROUP_PASSWORD` (Edge Function secret, bootstrap only). Browser builds contain just the publishable key.
