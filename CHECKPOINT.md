# CHECKPOINT — 2026-10-23

Branch `main` on github.com/shahyush/all-in-poker (private). Read `CLAUDE.md` for the rules and `docs/handoff/` for the contract.
This file separates **implemented** (code merged, local tests green), **deployed** (live on the hosted app) and **verified**
(passed against the deployed app, or seen in its recordings). Nothing is called done on the strength of a push alone.

## What is live right now

| Layer | Version | How to check |
| --- | --- | --- |
| Frontend (Cloudflare Worker, free plan) | build = commit sha, shown as **Build …** at the foot of the table menu | https://all-in-poker.aayush9shah.workers.dev → table → ☰ |
| Edge `api` | **v17**, bundle `3fd50706…` (chat direct write, per-orbit choice, server-side burns, balanced seating). v16 = burns bundle `65c7c9e9…` | Supabase MCP `list_edge_functions`; the pin is `BUNDLE_SHA` in `supabase/functions/api/index.ts` |
| Database | migrations 1–5 applied (5 = `chat_messages.action_id` + `allin_chat`) | `supabase/migrations/` |

Installed PWAs that predate build `62d3420` do not yet have the update prompt, so each phone needs **one** manual refresh /
reinstall to pick it up; from then on the "Update ready · tap to refresh" pill handles new builds.

## Status matrix

| Item | Implemented | Deployed | Verified on the deployed app |
| --- | --- | --- | --- |
| **Chat reliability** — chat written directly (`allin_chat`), off the table-version CAS; exactly-once by `action_id` (lost-response retry cannot double-post). Root cause of "reactions work, chat doesn't": chat lost the optimistic lock to game actions and was dropped with 409 | ✅ server test (burst + replay) | ✅ api v14 → v15 | ✅ both chat journeys green on CI 39940657690 and 39944449726 (messages, emoji, reactions, reconnect, rapid burst) |
| **PWA update prompt + visible build id** — installed PWAs were running stale cached builds (new SW waited for every instance to close) | ✅ | ✅ build `62d3420` | ✅ leave → summary → history → recovery journey green after fixing a first-load reload bug (CI 39944449726) |
| **Dealer's Choice once per orbit** — chooser tracked apart from the button; `handsTotal` fixed at orbit start so joins/leaves/sit-outs can't reshape it; capacity fallback to Hold'em per hand; persists in state; "Choice n/N" in the stakes line | ✅ engine + server tests | ✅ api v15 + web `62d3420` | ✅ `choice.spec` per-orbit flow green (CI 39944449726) |
| **Table redesign** — tall portrait oval, rail-seated pods (avatar + name/stack plaque), pot pill, larger board cards, bigger dealer disc; landscape wide oval | ✅ | ✅ build `6a24bef`+ | ✅ screenshots `10-rotated`/`11-reveal`/`12-two-boards` reviewed from `e2e-artifacts` run 39962759601; balanced seat spread needs api v17 traffic (verify in the next run) |
| **Server-side burns** — one hidden card before flop/turn/river (each board when run twice); never leaves the server; card-free `burn` event drives a face-down animation; deck sufficiency counts burns (Omaha 5 ≤ 8 dealt, Omaha 6 ≤ 7); `canRunTwice` includes burns | ✅ 59 engine tests incl. two burn tests | ✅ api v16 → v17 (serving since ~13:20 UTC) | ✅ face-down burn flyer + one-by-one flop seen in run 39962759601 recordings (Hold'em hand 2 of `journeys2 reconnect`); hole-card travel to be re-reviewed at 1 fps |
| **Pacing** — per-card deal travel scaling with cards (no cap; `actionReadyAt` waits the whole deal, betting clock starts after), flop one-by-one, burn lead before each street, chip sweep, sliding dealer button, 7 s contested showdown, position-ordered reveals, winning-card emphasis, pot award | ✅ | ✅ | ⏳ partially reviewed (flop one-by-one, chip sweep, 6 s showdown hold, RIT two boards seen); deal travel and the 3-player Omaha hand await the run for `3ceab0a`/`73b4002` |
| **Personal accounting** — own completed result frozen on leave, separate from others' provisional results; per-visit history; whole-table reconciliation | ✅ | ✅ | ✅ leave journey asserts "Chips taken off" and screenshots `14-session-summary.png`; visual review from `e2e-artifacts` pending |
| **Rules audit** (Hold'em, Omaha 4/5/6, RIT, side pots, refunds, odd chips, deck sufficiency, conservation) | ✅ `docs/handoff/RULES_AUDIT.md`, each rule names its test | — | — |
| Real iPhone/Android, installed PWA, Safari keyboard | — | — | ❌ NOT VERIFIED (no device from this environment); see "Known device limitation" |

## Evidence

- Hosted suite: `deploy-worker.yml` → deploy → live-smoke → hosted-e2e against the live Worker. Each hosted run uploads the
  `hosted-e2e-results` artifact **and** force-publishes screenshots, `.webm` recordings and error context to the
  `e2e-artifacts` branch (`RUN.txt` = run id + commit). The review environment cannot download Actions artifacts, so the
  branch is what gets reviewed frame by frame.
- Last fully green hosted run: 39944449726 on `62d3420` (7 passed, 1 skipped).

## Actual test results (2026-10-23)

| Layer | Command | Result |
| --- | --- | --- |
| Engine | `npm run test -w engine` | **59 passed** |
| Server (Postgres 16, RLS) | `npm run test -w server` | **22 passed** |
| Hosted phone browser | CI hosted-e2e (run 39944449726) | **7 passed, 1 skipped** (chat ×2, choice per-orbit, choice default, 3-player Omaha 4 journey, reconnect/RIT/reload, leave/history/recovery, tournament) |

## Remaining

1. Chat offline-draft defect: the host's chat sheet closed when a send failed offline (`chat.spec` rapid test, offline step). Cause: `Sheet`'s focus effect depended on an inline `onClose` and re-focused the close button on every re-render, so the Enter keystroke landed on it. Fixed in `73b4002` (effect runs once per open); hosted verification pending.
2. Review the recordings on `e2e-artifacts` (Hold'em default hand; 3-player Omaha 4) and refine pacing from what is seen.
3. Real-device pass on actual phones (installed PWA, Safari keyboard) — the one reliability item still NOT VERIFIED.
4. Standard CLI deploy route (`deploy-functions.yml`) stays dormant until `SUPABASE_ACCESS_TOKEN` exists as a GitHub secret.
5. Remove the chunk rows `edge/server.js.p00…p10` from `app_assets` (keep `edge/server.js`).

## Incidents (this session)
- **2026-10-23 12:10–12:46 UTC — a publish without its redeploy; no outage resulted (verified in logs, corrected).** The
  burns bundle was published to `app_assets` at 12:10, but the review environment restarted before the matching `api`
  redeploy, which only happened at 12:46 (v16). I first reported this as a ~35-minute outage; the edge logs say otherwise:
  `/api` answered 200/204 continuously through the window (only isolated cold-edge 5xx, including before the publish),
  998 bundle fetches for the pinned old sha all returned 200, and not one `[allin boot]` error was logged — the `code`
  function kept serving the pinned version, so v15 never failed to boot. v16 began serving with the next traffic
  (~13:20 UTC; the dispatcher only calls the API when a table is due, so there was no traffic between). The window is
  still real in principle, so publish and redeploy are done back to back in one step from now on.

## Ownership reservation
Admission bootstraps the owner only while `group_settings` is empty: the first player admitted with the bootstrap
`GROUP_PASSWORD` becomes `is_owner`, the password hash moves into the database and the env value is never consulted again.
Legacy profiles are not owners. Ownership resolved 2026-10-22: moved from the orphaned first `teens` profile (`0d8dfc01…`,
now `is_owner=false`, `revoked`) to the owner's active `teens` profile (`62f58b13…`). All rows preserved; exactly one owner.

## Deployment blockers (exact)
- **Network**: this cloud environment denies `CONNECT vlnkslhmmbkkvbpvzuiw.supabase.co:443`, `api.supabase.com:443` and the
  Worker host; the Supabase MCP tools are the authorised path and were used for everything. GitHub Actions artifact (blob)
  downloads are also blocked, hence the `e2e-artifacts` branch.
- **GitHub Pages**: free only for public repos; not an option. **Supabase as web host**: serves HTML as `text/plain`.
- **Edge deploy via MCP** refuses remote imports, so `api/index.ts` fetches the sha-pinned bundle from the `code` function
  at boot (publish-bundle.yml with a one-time token whose sha256 sits briefly in `app_settings.upload_token_sha`, cleared
  after). Between publish and redeploy the pin mismatches, so the two steps are always done back to back.

## Supabase changes (all additive; legacy data preserved)
Tables added: group_settings, recovery_codes, ledger, reload_requests, session_participants, command_receipts,
table_tombstones, app_settings, diagnostics, chat_reactions; columns added to profiles, tables, table_members,
table_secrets, hole_cards, hand_history, app_assets(encoding), **chat_messages(action_id, partial unique index)**.
Functions: allin_* (incl. `allin_react`, **`allin_chat`**), current_player_id, is_member, is_participant, shares_table_with,
heartbeat, allin_dispatch_due. Select-only policies; insert/update/delete revoked from anon/authenticated. Realtime:
tables, hole_cards, chat_messages, chat_reactions, reload_requests, table_members. Cron `allin-dispatch-due` (1 s).

## Known device limitation (documented, non-blocking)
- **iOS Safari chat keyboard.** iOS ignores `interactive-widget=resizes-content`, so the composer tracks the VisualViewport
  and insets the sheet above the keyboard (`--kb`). Mechanism-verified (code + the two-session hosted chat test) but NOT
  verified on a real iPhone from this environment. The separate, confirmed cause of "chat doesn't work" — messages dropped
  under the table lock — is fixed and verified live (see Status matrix).
