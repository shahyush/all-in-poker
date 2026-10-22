# CHECKPOINT — 2026-10-22

Reliability checkpoint: the full hosted multiplayer suite is green on the live app (CI run 39752698967), including the
15-second Dealer's Choice with cold-start readiness and the leave→session-summary transition. Visual overhaul not started
(it is gated behind this checkpoint).

Branch `main` on github.com/shahyush/all-in-poker (private). Read `CLAUDE.md` for the rules and `docs/handoff/` for the contract.

## Completed features
- **Engine** (`engine/`): CSPRNG deck, hold'em / Omaha 4-5-6 evaluation (exhaustive check), dealer's choice with a 15 s usable window re-anchored to the chooser's first view (30 s warm-up cap, defaults to Hold'em only if nobody is ever ready),
  blinds/antes/straddle, missed-blind policy, moving button (cash) and dead button (tournament), pot-limit cap, TDA reopening,
  side pots / uncalled excess / odd chips, run-it-twice (voluntary + forced offer), uncontested reveal window, tournaments
  (levels on the clock, eliminations after settlement with shared places, winner, abandonment), host succession, nobody-present
  hold with scheduler wake-ups, chip-conservation invariant, deal/board animation plans.
- **Server** (`server/`): admission by group password (PBKDF2, bootstrap env → DB hash), private player identity per device,
  recovery codes (single use, verifier only), tables/join/start/all game commands/reloads/chat/host transfer, idempotent
  `actionId` receipts (409 on reuse with a different body), CAS commit via `allin_commit`, due-table jobs, archive + purge.
- **Database**: forward-only migrations (4 files, rollback notes in headers), select-only RLS, writes only through RPCs,
  realtime publication, pg_cron dispatcher (every second, only fires for due tables).
- **PWA** (`web/`): After Hours look, portrait + landscape phone table, deck-to-seat dealing and staged board reveals, all
  journeys (entry → invite → buy-in → hands → awards → next hand → reload → sit out / leave → history / session accounts →
  recovery), offline shell via a stamped service worker, reduced-motion support.
- **Deployment (backend)**: schema + functions + cron live on `vlnkslhmmbkkvbpvzuiw`; edge functions `api` (v8, bundle
  `2f17bfe6…`), `code` (v2), `app` (v3, redirect) deployed through the Supabase MCP (authorised route).

## Live verification (2026-10-22, hosted)
On https://all-in-poker.aayush9shah.workers.dev the full hosted suite is green (CI run 39752698967, hosted-e2e: 5 passed,
1 skipped). Sign-in verification is separate (live-smoke: WebKit + Chromium session → token → admission → identity
survives reload). Gameplay, with separate player identities:
- Three friends: invite -> entry -> buy-in -> seat -> start -> Dealer's Choice -> dealing -> betting every street ->
  settlement -> next hand. (journey.spec)
- A deliberate Dealer's Choice registers after a 30 s idle lobby (no artificial warm-up) and on consecutive hands —
  cross-checked in the live hand log (the test's "Choosers" table dealt `omaha4` from the deliberate pick, not the
  default). An unattended choice still defaults to Hold'em. (choice.spec — two separate tests; a missed pick is a failure.)
- Reconnect, rotation, uncontested reveal, reload approval, run-it-twice (two boards), leave, history, recovery.
  The leaving guest's exit commits at the boundary (DB: `left_at` + `taken_off`, chips conserved) and the client
  transitions itself to the session summary with no manual reload. (journeys2 reconnect)
- Tournament: create with levels, play to a winner, standings. (passes on live)
- The server-timer-only test is local (drives the dev clock); skipped on hosted and covered by the reconnect journey.
Scheduler confirmed advancing live from Supabase logs: the 1 s `allin-dispatch-due` cron POSTs `/api/jobs` → 200 with no
boot failures, and the `api` function boots on the pinned bundle (`code/server.js?sha=2f17bfe6…` → 200).
Key fixes this session: 15 s Dealer's Choice with a readiness re-anchor (`choice_ready`, fired by the chooser's client the
moment it renders the choice) so cold-start/idle latency cannot eat the window; the leave race (mark the seat leaving
before the pre-tick resolves a boundary, so the leaver is cashed out instead of dealt a stalling hand); the client-driven
post-leave transition (poll own `left_at`, navigate to the summary); earlier — realtime auth, adaptive poll, action-ready
margin, scheduler dispatch bug, iOS session-restore/token-mirror.
Explicitly UNVERIFIED (optional, per instruction): uncontested-reveal propagation to the other player within the 3 s
window — on the live transport it often lapses to the spec muck; reveal correctness is covered by engine unit tests.
Real-device checks (actual iPhone/Android hardware, installed PWA, Safari keyboard) remain NOT VERIFIED.

## Actual test results (this checkpoint)
| Layer | Command | Result |
| --- | --- | --- |
| Local engine | `npm run test -w engine` | **55 passed** (vitest; BUG01–05, antes, missed blinds, chip conservation, timeouts/presence, 4 tournament cases, dealer's-choice re-anchor + warm-up-cap default) |
| Database integration | `npm run test -w server` (Postgres 16, RLS as `authenticated`) | **18 passed** (incl. leave-as-result-window-lapses and choice_ready re-anchor through the full API) |
| Independent multiplayer clients | `npm run test:e2e -w web` (Playwright, iPhone 13 emulation, separate browser contexts, local Node API) | **6 passed** locally (journey, 2× choice, reconnect, server-timers, tournament) |
| Deployed backend | Supabase logs (authorised) | `api` v8 boots on bundle `2f17bfe6…`; 1 s dispatcher POSTs `/api/jobs` → 200, no boot failures |
| Deployed phone browser (hosted-e2e) | CI run 39752698967 against the live Worker + Supabase | **5 passed, 1 skipped** (deliberate choice after idle, default choice, journey, reconnect/leave, tournament; local-only server-timer test skipped). Reveal propagation optional/unverified. Real hardware NOT VERIFIED. |

## Known failures / fixed this round
- **Live sign-in on iPhone Safari (2026-10-21 17:19–17:24 UTC)**: anonymous sign-up and admission succeeded server-side
  (owner profile created), but the phone then lost its auth-js session without any refresh or sign-out reaching the server,
  showed "Session expired", and created a new anonymous identity on reload (a second `teens` player). Fix: the browser
  transport mirrors its tokens and restores the same identity (`setSession`/`refreshSession`), never mints a new identity
  from a command path, retries the first round trip once, and surfaces the auth error text. Verified on the deployed URL by
  the CI live smoke (WebKit + Chromium): session → token validation → admission answer → identity survives reload.
  Resolved 2026-10-22: ownership moved off that orphaned `teens` profile to the owner's active one (see Ownership reservation).
- **Engine bug (fixed)**: a running table held because nobody was present had `dueAt = null`, so the scheduler never revisited
  it: a returning player who only heart-beat never got a new hand, and the 30-minute abandonment never ran. Now `idleCheckAt`
  re-arms every 45 s until a hand starts or the table is abandoned (`engine/src/table.ts`, test "all players absent").
- **Timeout-only tournament legitimately never finishes**: with everyone present but nobody acting, each orbit returns the
  blinds (UTG and SB fold, BB collects), so stacks never fall below a blind and nobody busts. The test asserts level/blind
  progression, chip conservation and bounds the run to 30 hands; completion is covered separately by simulated shoves.
- **e2e flakes (fixed, tests only)**: the reload assertion read the guest screen before its own poll caught up (now waits on
  the guest page); `isEnabled()` on a missing action bar waits forever (now `count()` first + `actionTimeout`); the server
  test suite reset the dev server's database underneath it (dev server now uses `allin_dev`, tests `allin_test`).
- **Production bundle is current**: `api` v8 runs bundle `2f17bfe6…` (15 s dealer's choice + readiness re-anchor, leave
  race fix), rebuilt from source, uploaded through the publish workflow with a one-time token, sha verified in the asset
  store against the pin in `api/index.ts`, token cleared afterwards.

## Remaining tasks
1. Frontend + backend LIVE and the hosted multiplayer suite is green (CI 39752698967). `deploy-worker.yml` deploys the
   Worker on every push and now auto-runs the hosted journeys after a deploying push whenever the Cloudflare + password
   secrets are present (still forceable via the `run_hosted_e2e` dispatch input).
2. Real-device pass: play a full hosted game on actual iPhone/Android hardware with separate identities (all streets,
   awards, next hand, reload, reconnect, history, installed PWA, Safari keyboard); tick the live rows in `docs/RELEASE.md`.
   This is the only reliability item still NOT VERIFIED.
3. Reveal propagation within the 3 s window is intentionally left optional/unverified on the live transport (engine unit
   tests cover reveal correctness). Revisit only if desired.
4. Standard CLI deploy route (`deploy-functions.yml`) stays dormant until `SUPABASE_ACCESS_TOKEN` exists as a GitHub secret;
   until then the `api` bundle ships via the index.ts + app_assets hash-pin path (publish-bundle.yml + MCP redeploy).
5. Visual overhaul (sapphire/emerald/burgundy palette exploration, dealer-button animation, pacing, hand labels, etc.)
   is the next phase — gated behind this reliability checkpoint, now met.
6. Remove the chunk rows `edge/server.js.p00…p10` from `app_assets` once the bundle flow is settled (keep `edge/server.js`).

## Ownership reservation
Admission bootstraps the owner only while `group_settings` is empty: the first player admitted with the bootstrap
`GROUP_PASSWORD` becomes `is_owner`, the password hash moves into the database and the env value is never consulted again.
No invitation has been sent and nobody else knows the password, so entering first reserves ownership. Legacy profiles are
not owners (`is_owner=false`). The owner should save their player code immediately (Profile → Save my player code).

Ownership resolved (2026-10-22): the bootstrap had left `is_owner` on an orphaned first `teens` profile
(`0d8dfc01…`, zero memberships/sessions, never seen). Per the owner's confirmation, ownership moved to their active
`teens` profile (`62f58b13…`: the player that hosted/played the live tables); the orphan is `is_owner=false`, `status`
`revoked`. Both profile rows and all records are preserved. Exactly one owner now (`62f58b13…`).

## Deployment blockers (exact)
- **Network**: this cloud environment's policy denies `CONNECT vlnkslhmmbkkvbpvzuiw.supabase.co:443` and
  `api.supabase.com:443` (proxy answers 403 to CONNECT). The Supabase CLI and direct REST calls therefore cannot run here;
  the Supabase MCP tools are the authorised path and were used for everything. Single setting to change: the environment's
  *Network access* → add `vlnkslhmmbkkvbpvzuiw.supabase.co` and `api.supabase.com` under Allowed domains (or a broader level).
- **GitHub Pages**: run 39628036053, step `actions/configure-pages@v5`: *Create Pages site failed. Error: Resource not accessible
  by integration*. Pages is free only for public repos; private needs GitHub Pro (paid). Not an option under the rules.
- **Supabase as web host**: `GET /functions/v1/app/` returned `content-type: text/plain` for `index.html` (the platform
  serves HTML from edge functions on `*.supabase.co` as plain text). The handoff warned about exactly this.
- **Edge function deploy via MCP**: `deploy_edge_function` refused a remote import (`Cannot import from
  vlnkslhmmbkkvbpvzuiw.supabase.co:443`), so `api/index.ts` fetches the bundle at boot, verifies its sha256, and imports it
  from a data URL. Supported Deno/Supabase features, but non-standard; `static.ts` + `deploy-functions.yml` is the standard route.

## Supabase changes made so far (all additive; legacy data preserved)
Tables added: group_settings, recovery_codes, ledger, reload_requests, session_participants, command_receipts,
table_tombstones, app_settings, diagnostics; columns added to profiles, tables, table_members, table_secrets, hole_cards,
hand_history, app_assets(encoding). Functions: allin_* (14), current_player_id, is_member, is_participant,
shares_table_with, heartbeat, allin_dispatch_due; handle_new_user() made a no-op. Policies: select-only set listed in
migration 1; old broad profiles policies removed. Grants: insert/update/delete revoked from anon/authenticated. Realtime
publication: tables, hole_cards, chat_messages, reload_requests, table_members (replica identity full). Cron: job
`allin-dispatch-due` (1 s). Rows: app_settings {job_key, function_url, anon_key, upload_token_sha='used'}; app_assets
`edge/server.js` + 11 chunk rows; schema_migrations entries for the 4 migrations. Row counts unchanged: profiles 3,
tables 2, table_members 3, hand_history 2, auth.users 3. Legacy objects untouched: commit_table(), prototype app_assets
rows (app.js, engine.js, index.html, manifest, sw.js), trigger on_auth_user_created.

## Known device limitation (documented, non-blocking)
- **iOS Safari chat keyboard.** On the identified Friday table the composer never reached the server (0 messages, 0
  reactions persisted) while reactions — which need no keyboard — worked: the signature of the compose box sitting behind
  the on-screen keyboard. iOS Safari ignores `interactive-widget=resizes-content`, so the fix tracks the VisualViewport
  and insets the sheet above the keyboard (`--kb`). This is mechanism-verified (code + the two-session hosted chat test,
  which passes) but NOT verified on real iOS Safari from this environment, which cannot drive a physical device. Treated
  as a documented limitation, not a blocker; a one-line confirmation from a real iPhone would close it.
