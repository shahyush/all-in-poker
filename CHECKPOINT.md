# CHECKPOINT — 2026-10-25

Branch `main` on github.com/shahyush/all-in-poker . Read `CLAUDE.md` for the rules and `docs/handoff/` for the contract.
This file separates **implemented** (code merged, local tests green), **deployed** (live on the hosted app) and **verified**
(passed against the deployed app, or seen in its recordings). Nothing is called done on the strength of a push alone.

## October 25 follow-up review

Frontend 5ab89cb deployed (run 40207759196); api v21 unchanged. Current hosted gameplay result remains pending; live-smoke hit its job limit while installing browser dependencies, before app testing. This is not a successful smoke result.

Re-reviewed secure Fisher–Yates/rejection sampling, deck privacy, burns/capacity, Omaha evaluation, side pots, accounting and the current house rules. Engine 71/71 and Chromium layout/interaction 14/14 pass locally. Server 22/22 passed in current CI. No new engine or accounting defect was found by this review; this is not a guarantee against all defects.

WebKit regression found that its fetch rejects a timed-out request with AbortError instead of the supplied TimeoutError reason. The wrapper now preserves the controller's explicit reason. Existing timeout/recovery/caller-cancellation regression remains unchanged.

Nine-player WebKit traces on a58be45 exceeded the 300s journey budget; both continued through showdown, chat, next hand and nine balanced account rows. The longer case completed its assertions at approximately 339s. The test now reads turn cues once per check, checks message delivery concurrently and closes contexts concurrently. Whole-journey budget is 420s; individual action deadlines, balance assertions and game clocks are unchanged. It must pass a fresh run before being marked verified.

Security advisor review: no ERROR-level findings. Server-only tables intentionally have RLS with no client policy. Anonymous access is deliberate and membership/own-card scoped. Remaining configuration warnings include mutable search_path on allin_now overloads, pg_net in public, and password-protection settings; no data or grants were changed in this review. Real-device keyboards, installed-PWA behaviour and physical iPhone/Android performance remain unverified.

## October 25 gameplay refinement (supersedes fixed-blind setup below)

New last-player-standing tables set `orbitBlindStep: 5`: both blinds increase exactly five at the next complete dealer-choice orbit, with the orbit count persisted. Existing game configurations remain unchanged.

Voluntary two-board agreement now resumes the exact actor/remaining clock and keeps betting open. Two boards receive their own burn and card each subsequent street; one betting round covers both boards and each pot is split at settlement. Standard forced all-in run twice is retained. Legacy run-once commands still close betting, but are no longer offered as a voluntary UI action.

Showdowns hold 12 seconds; ordered reveals are spaced 850ms, followed by winner highlights and a brief gold spark burst. Action keys have tactile depth, seat plaques are compact, and house-rule text now matches the implementation. Reduced motion is respected.

Deployed: frontend f5ef4ca on Cloudflare (run 40205941837); api v21 with static bundle e8b6f4d3de96acc267837c337481b46e2ab1a9fceb2e2796a26533e3ce3455c4. Deployment, live-site verification and WebKit/Chromium sign-in smoke passed.

Validation: 71 engine tests and 22 server integration tests passed in GitHub CI. Chromium's complete 11-journey suite passed on a58be45, including nine-player Hold'em and Omaha, continued two-board betting, chat and balanced accounts. All 13 layout/interaction checks passed; Firefox layout passed. WebKit's full run remains pending.

Hosted run 40205941837: deploy and live-smoke passed; gameplay 6 passed, 2 failed, 1 skipped. Invite preview stalled at “Opening your invite”; the reconnect/two-board journey hit its 180-second budget with clients on different streets. These failures are NOT declared resolved. A follow-up bounds Supabase auth/REST request headers and bodies to 12 seconds, bounds invite preview requests to 12 seconds, and prevents an unmounted table's in-flight poll from restarting. The stalled-request/recovery/caller-abort browser regression and production build pass locally; deployed verification follows.

## October 25 update

Frontend main `5ec0de5` deployed successfully (Cloudflare version `0963a91f-68ac-47bb-b1fc-57c717a9cf2a`); Chromium and WebKit live sign-in smoke passed. Full hosted gameplay verification remains pending. Backend api v20 is active, deploying `static.ts` with the committed bundle directly (SHA `54929c91a8450083563c5c5b1cde0c32336b999e02d40e367fb05d0d2db9befa`), avoiding the asset-store cold-boot dependency.

This change replaces the new-game Tournament UI with **Last player standing**: equal starting bank, one entry, no rebuys, fixed blinds, final player with chips wins. Existing tournament records keep their original rules. The internal mode remains compatible with the existing elimination engine. Creation is checked at 320px, 390px and landscape widths, including the submitted rules. End-to-end winner coverage is updated; deployment verification follows the push. No historical ledger records are modified.

The previous Chromium functional run passed 10/11 (including both nine-player journeys); its choice test demanded a transient confirmation label after the dealt state had already replaced it. That assertion now accepts either confirmation or the chosen dealt variant, and still requires every client to show the selected variant.

## What is live right now

| Layer | Version | How to check |
| --- | --- | --- |
| Frontend (Cloudflare Worker, free plan) | build = commit sha, shown as **Build …** at the foot of the table menu | https://all-in-poker.aayush9shah.workers.dev → table → ☰ |
| Edge `api` | **v21**, static bundle `e8b6f4d3…`, orbit blinds, continued two-board betting and 12-second showdown | Supabase MCP `list_edge_functions`; the pin is `BUNDLE_SHA` in `supabase/functions/api/index.ts` |
| Database | migrations 1–6 applied (6 = `allin_begin`, `allin_load` with approved reloads, `allin_chat` with membership/rate limit/receipt) | `supabase/migrations/` |

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
| **Pacing** — per-card deal travel (420 ms + 320 ms gap, slowed on review 2026-10-24) scaling with cards (no cap; `actionReadyAt` waits the whole deal, betting clock starts after), flop one-by-one, burn lead before each street, chip sweep, sliding dealer button, 7 s contested showdown, position-ordered reveals, winning-card emphasis, pot award | ✅ | ✅ | ⏳ partially reviewed (flop one-by-one, chip sweep, 6 s showdown hold, RIT two boards seen); deal travel and the 3-player Omaha hand await the run for `3ceab0a`/`73b4002` |
| **Personal accounting** — own completed result frozen on leave, separate from others' provisional results; per-visit history; whole-table reconciliation | ✅ | ✅ | ✅ leave journey asserts "Chips taken off" and screenshots `14-session-summary.png`; visual review from `e2e-artifacts` pending |
| **Rules audit** (Hold'em, Omaha 4/5/6, RIT, side pots, refunds, odd chips, deck sufficiency, conservation) | ✅ `docs/handoff/RULES_AUDIT.md`, each rule names its test | — | — |
| Real iPhone/Android, installed PWA, Safari keyboard | — | — | ❌ NOT VERIFIED (no device from this environment); see "Known device limitation" |

## Evidence

- Hosted suite: `deploy-worker.yml` → deploy → live-smoke → hosted-e2e against the live Worker. Each hosted run uploads the
  `hosted-e2e-results` artifact **and** force-publishes screenshots, `.webm` recordings and error context to the
  `e2e-artifacts` branch (`RUN.txt` = run id + commit). The review environment cannot download Actions artifacts, so the
  branch is what gets reviewed frame by frame.
- Last fully green hosted run: 39993649847 on `9f81fd1` against api v18 (8 passed, 1 skipped); 39990559616 on `1f2432b` also green.

## Actual test results (2026-10-23)

| Layer | Command | Result |
| --- | --- | --- |
| Engine | `npm run test -w engine` | **59 passed** |
| Server (Postgres 16, RLS) | `npm run test -w server` | **22 passed** |
| Hosted phone browser | CI hosted-e2e (run 39944449726) | **7 passed, 1 skipped** (chat ×2, choice per-orbit, choice default, 3-player Omaha 4 journey, reconnect/RIT/reload, leave/history/recovery, tournament) |

## Remaining

1. **Latency.** Edge logs on 2026-10-23 showed p50 2.7 s / p90 4.8 s per command (6–7 sequential DB calls + ~0.5 s isolate boot); this made a serialized chat burst miss its budget, a reveal land after the 6 s window and a cold admit take 10 s (run 39987883777, 3 failures). api v18 cuts round trips to 3–4 (full run 39993649847, 223 commands: p50 1.9 s / p90 3.3 s edge-measured; 1.0–1.5 s inside the function; all 8 hosted journeys green). The remaining boot cost goes away with the static-entry CLI deploy (`deploy-functions.yml`), dormant until `SUPABASE_ACCESS_TOKEN` exists as a GitHub secret. Chat sheet focus fix `73b4002` verified in run 39990559616.
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

### Browser-toolbar layout follow-up
User's real-browser concern reproduced: at visible heights 520/560 portrait and 280/290 landscape, betting controls fell below the viewport despite prior full-device-size checks. Table breakpoints now use a named size container following `100dvh`, rather than media-query height that can still represent the larger layout viewport. TablePage observes its own rendered size for seat orientation. Compact layouts remove the old-hand recap, tighten seat/hero spacing and retain the controls. Expanded geometry coverage includes browser/layout-height mismatch, current-player actions and two boards; all 21 Chromium layout/interaction tests pass. Actual iOS toolbar/keyboard behavior remains physical-device unverified; these are explicit browser-area simulations, not device certification.

### Showdown size, celebration delivery and rail clearance (25 October)
User reported tiny showdown hands and missing confetti. Added a dedicated full-width winning-five-card panel below the table, with a large hand name and selectable winners for split/two-board pots. It reads only server-published award cards; mucked hands remain private. Removed duplicated contested winner text from the centre so the boards retain space. Celebration mounting is eligible throughout the visible award rather than only a 2.2-second server-time interval that delayed clients could miss; each mount plays an 18-piece gold/ivory burst, respecting reduced motion. Narrow (<=350px) rail plaques are 68px wide. Geometry assertions now check >=6px clearance from actual opponent card boxes and plaques to both boards, including occupied left seats. Added a browser test for large winning cards, both winners and reduced-motion behavior. Engine 71/71 and web build passed; browser CI and hosted verification are tracked separately from physical iOS checks.


## 2026-10-25 — folded private cards, Last Player Standing run choices, eight-second showdown
Own hole cards remain readable after folding and can be inspected using My folded hand during a contested award; opponents' private cards stay hidden. Last Player Standing now supports the same unanimous voluntary once/twice choices and all-in run vote as cash. Voluntary two boards retains betting; Run once closes betting only after unanimous acceptance. Deck sufficiency checks and chip conservation remain enforced. Contested showdown holds 8 seconds, with staggered reveals compressed only enough to reserve readable winner time at nine seats. Uncontested reveal remains 10 seconds. Engine regressions cover both run counts, all-in double boards, private folded cards, conservation, and the 8-second result deadline.


## Multiple active tables — 2026-10-25
User explicitly allows simultaneous table memberships. Removed global server admission guards and the single-active-seat index; per-table membership primary key remains. Lobby lists every active table and permits host/join alongside existing games. Last Player Standing departures still preserve chips in play; an existing membership no longer blocks another game. Server regression covers cross-table joins, same-table idempotency, hosting while seated, and independent leaving.

## October 25 local smoothness review — NOT DEPLOYED

Deployment pause remains active. Recovered prior unpushed privacy/three-minute cleanup/six-second showdown/host departure work after workspace pruning. Added serialized resource refresh, separate game/chat paths, private-hand caching, keyed table routes, recoverable table/invite failures, identity-safe auth restore, hidden-tab polling pause and bounded parallel timer dispatch. Clarified runout choices. See docs/reviews/2026-10-25-smoothness.md for exact findings, live latency evidence and verification limits. No hosted verification or real-device claim; Postgres integration remains unrun. Production is unchanged.


## October 25 deployment authorised — host delete and faster pacing

User explicitly authorised deploying the complete refinement. Host-only close_table archives a waiting table immediately or finishes and records the current hand before closing. Cash chips exit through the ledger; history is preserved; non-host closure is rejected. UI says Delete table, Leave table, Add chips, Sit out. Deal travel/gap are 320/220 ms (down from 420/320); runout stages 1700 ms (down from 2200); contested showdown remains six seconds. Decision windows are unchanged.

Removed redundant table/hole-card safety polls because the game loop already polls those; account fallback is 15 seconds and membership fallback 10 seconds, while realtime changes still refresh immediately. All prior local recovery/privacy/cleanup fixes are included. Deployment and hosted verification results will be recorded after completion.
