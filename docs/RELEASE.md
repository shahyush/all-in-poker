# Release status — All In V1 (2026-10-21)

**Not share-ready yet.** Everything that can be done without the project owner is built, tested and deployed. Three owner
actions remain (section 1). Until they are done the app URL does not resolve and nobody can enter.

## 1. Owner actions (in this order)

| # | Action | Where | Why |
| --- | --- | --- | --- |
| 1 | ~~Connect the repo to Cloudflare~~ DONE: Worker `all-in-poker` built from `main`, URL https://all-in-poker.aayush9shah.workers.dev/ (workers.dev route enabled by the owner). | dash.cloudflare.com | Free plan, private repo, assets-only Worker (`wrangler.toml`). The API allowlist is pinned to this origin plus version previews. |
| 2 | **Allow anonymous sign-ins** | Supabase Dashboard → Authentication → Sign In / Providers → *Allow anonymous sign-ins* → Save | Players get a private session without email/phone. The server never trusts the anonymous session alone: admission needs the group password, and RLS keys everything to `profiles.auth_user_id`. |
| 3 | Set the bootstrap **GROUP_PASSWORD** secret | Supabase Dashboard → Edge Functions → Secrets → add `GROUP_PASSWORD` (the MCP prompt from this session does the same) | Used only until the first player is admitted; from then on the PBKDF2 hash in `group_settings` is authoritative and the owner rotates it in-app. |

After 1–3: open the URL, enter a nickname + the group password (first admitted player becomes the owner), save the player
code, create a table, and play a hand with two phones. Then section 3's "live" rows can be ticked.

## 2. What is deployed

| Component | State | Evidence |
| --- | --- | --- |
| Postgres schema, RLS, grants, realtime publication | applied to `vlnkslhmmbkkvbpvzuiw`; migrations `20261021140000`–`140300` recorded in `supabase_migrations.schema_migrations`; legacy data kept (3 email users, 2 closed tables tagged `legacy`) | `supabase/migrations/`, advisor run clean of write exposure |
| pg_cron `allin-dispatch-due` (every second) → pg_net → `/functions/v1/api/jobs` | running: 590 successful runs / 0 failures in the 10 minutes before this note; dispatches only when a table is due | `cron.job_run_details` |
| Edge function `api` v4 (`verify_jwt=false`, own auth) | live; loads bundle sha `548045ad…ec9a` (current sources) from `code`, verifies the hash before use; allowed origins from `app_settings.app_origins` | v3 smoke: `POST /jobs` wrong key → 403; `POST /cmd` no token → 401; right key → ok. v4 boot NOT YET EXERCISED (no request can reach it from here; first hosted request will show in function logs) |
| Edge function `code` v2 | live; serves `edge/server.js` byte-identical to `supabase/functions/api/bundle/server.js` (57,083 bytes, same sha256); one-time-token upload endpoint | pg_net GET returned 200, 57,083 bytes, matching sha |
| Edge function `app` v6 | 302 redirect to https://all-in-poker.aayush9shah.workers.dev/ (prototype host retired) | |
| PWA | Cloudflare Worker `all-in-poker` serving `web/dist`; URL reported by the owner. NOT YET LOADED from this environment (network policy denies `*.workers.dev`); hosted game NOT YET PLAYED | |

## 3. Gates (from RELEASE_CHECKLIST.csv) — status

Legend: ✅ verified by automated test or production check · 🟡 implemented, verified locally only (needs the live URL) ·
⛔ NOT VERIFIED — needs a real device or the owner · ➖ out of V1 per HANDOFF.md

| Area | Status | Notes |
| --- | --- | --- |
| 01 Private entry & identity | ✅ server logic / 🟡 live | admit, replay, recovery code single-use + rebind, forget-this-device, owner password rotation: `server/test/api.test.ts`; live admission waits on anonymous sign-ins |
| 02 Home, invitations, joining | ✅ | preview before entry, atomic last seat (CAS), one active seat per player, closed invites 404 |
| 03/04 Create cash / tournament | ✅ | strict validation, unit multiples, Omaha capacity, level schedule |
| 05 Waiting room & host | ✅ | remove before/during play, host loss → succession after 30 s with epoch bump (`game.test.ts`) |
| 06 Dealer choice, blinds, antes, straddle | ✅ | 4 s choice, missed-blind policy, short blinds, heads-up order, straddle within the choice window (`engine/test/table.test.ts`) |
| 07 Phone table portrait/landscape | 🟡 | emulated iPhone 13 in Playwright both orientations (`docs/evidence/02-dealt-portrait.png`, `03-dealt-landscape.png`, `10-rotated.png`); ⛔ real iPhone / Android not available in this environment |
| 08 Betting controls | ✅ | legal action list from the server (`actorLegal`), strict integers, PL cap, reopening, raise capped at max opponent capacity |
| 09 Cards, evaluation, pots | ✅ | exhaustive 5-card evaluator check (2,598,960), side pots, uncalled excess, odd chips, chip-conservation invariant halts the table |
| 10 Run once / twice | ✅ | voluntary proposal with exact clock restore, forced offer, shared flop prefix, per-pot splits, board A odd chip |
| 11 Results & reveal | ✅ | 3 s uncontested reveal window, showdown shows all live hands, 3 s to next hand (`11-reveal.png`, `12-two-boards.png`) |
| 12 Rebuys & accounts | ✅ | request/approve/credit at hand boundary exactly once, ledger + session summary (`13-session-summary.png`) |
| 13 Tournament play | ✅ | level clock, eliminations ranked, winner, abandoned event (`14-tournament-result.png`) |
| 14 Chat & rules | ✅ | plain text, rate limited, unread cue, rules sheet |
| 15 Reconnect, timers, host transfer | ✅ | server timers with every browser closed (e2e 3), receipts replay, action-id conflict 409 |
| 16 Break, leave, cleanup | ✅ | sit-out after hand, leave after hand, all-in departure keeps the pot, closure/abandonment archive |
| 17 Profile, history, privacy | ✅ | own hole cards only (RLS test), departed members keep history, forget device |
| 18 Server & deployment architecture | ✅ | one engine, CSPRNG, hidden cards never leave `table_secrets`, grants revoked for anon/authenticated writes, service role only in functions |
| 19 Browser/accessibility/PWA | 🟡 / ⛔ | Chromium-emulated phone passes; reduced motion honoured (`prefers-reduced-motion` disables deal/board animation), 44 px targets, large-text layout checked in emulation; ⛔ installed PWA, Safari keyboard, real zoom need a device |
| R4-01…R4-28 engine/server gates | ✅ | all reproduced in `engine/test` and `server/test` (BUG01–05, no-burn capacity, early run once, vote time, PL short blinds, short raise rights, atomic settlement, action-id conflict, heads-up, timeout check, tournament restart/elimination, no-client progression, host epoch race, RLS matrix, recovery) |
| R4-29 actual iPhone, R4-30 actual Android, R4-31 dense phone states on device | ⛔ | not available here — do after owner actions |
| R4-33 PWA update | 🟡 | versioned shell cache per build; new build waits for next launch |
| R4-34 migration safety | ✅ | forward-only, no drops, legacy rows preserved |
| R4-35 hosting cost | ✅ | see section 5 |
| R4-36 shareable live journey, R4-39 build artifact | 🟡 | build artifact green; live journey blocked on owner actions |
| R4-40 tournament rebuy | ➖ | out of V1 (HANDOFF.md) |

## 4. Test evidence (this session)

| Suite | Result |
| --- | --- |
| `npm run test -w engine` | 53 passed (incl. 4 new tournament cases: forced short-stack all-in + elimination after settlement, timeout-only progression, simulated-shove completion, all-absent hold/abandon) |
| `npm run test -w server` (real Postgres 16, RLS as `authenticated`) | 15 passed |
| `npm run test:e2e -w web` (Playwright, iPhone 13 emulation, 3–4 independent browser contexts, local dev API) | 4 passed in 1.3 min — `docs/evidence/e2e-results.json`, screenshots `docs/evidence/*.png` |
| Supplied reproductions (handoff `tests/`) | candidate audit A01–A24 pass; 28/13/15 supplied checks pass; `reproduce-live.mjs` confirmed BUG01–05 on the old engine, all five fixed |
| Production smoke (pg_net) | `code` bundle sha matches; `api` 403/401/200 as expected; cron 590/0 |

## 5. Cost and limits (all free tier, nothing enabled that bills)

* Supabase Free: 500 MB database, 500k edge invocations/month, 2M realtime messages, 200 concurrent realtime peers, project
  pauses after 7 days of inactivity (cron cannot prevent that; opening the app resumes it). A quiet poker night is a few
  thousand invocations: the dispatcher only calls `/jobs` when a table is due.
* GitHub Pages (public repo): free, 100 GB/month soft bandwidth. GitHub Actions: free for public repos.
* No custom domain, no paid add-ons, no third-party services.

## 6. Rollback

* API: redeploy `api` with the previous `BUNDLE_SHA` (previous bundles stay in `app_assets` under `edge/`).
* Database: migrations are additive; nothing was dropped. Legacy prototype rows are untouched.
* PWA: re-run the Pages workflow from an earlier commit.
