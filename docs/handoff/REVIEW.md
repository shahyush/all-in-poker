# Round 3 review — findings and verification

Reviewed 21 October 2026. Source: the exact latest supplied “Poker PWA table states(1).zip”, not an earlier similarly named export. Original files are preserved. Infrastructure inspection and retrieved server-source tests were read-only; no Supabase setting, migration, live hand or deployment was changed by this review.

## Verdict

Round 3 is a useful design simulation and substantially better organised, but it is not yet ready to send to friends as a live game. The supplied 56 logic checks pass while 23 additional targeted cases fail. The local reference correction candidate passes those 24 cases (including one case that was already correct), and broader pure-model tests pass. These results support specific local fixes, not a guarantee of full playability or security. The existing deployed server source separately contains five reproducible engine defects.

The reference candidate is included to save implementation work. It is not a production application or a replacement for the existing API. A few simulator conventions still differ from the canonical launch profile and are enumerated below; do not mistake them for approved rules.

## Actual tests and their limits

| Check | Actual result | What it does not prove |
|---|---|---|
| Supplied Round 3 checks | Engine28/28, Journey13/13, branches15/15 | Robustness of untested branches, multi-client consistency, privacy, browser rendering |
| Additional source/model probes | Original:23 FAIL,1 PASS; correction candidate:24 PASS | Full application/server integration |
| Varied hand stress | 2,250 hands,27,082 actions,1,124 two-board outcomes,336 uncontested wins; zero reported failures | Real networking, production races, all possible poker states |
| Continuing-session soak | 16 sessions,640 hands,133 reloads,128 settled-snapshot retries; zero reported failures | Concurrent clients, historical reentry with production ledger, auth |
| Exhaustive five-card category counts | All2,598,960 distinct combinations match expected nine-category frequencies | Kicker ordering, Omaha selection, security or game progression |
| Evaluator differential | 8,000 player-hand evaluations,4,000 paired order comparisons across four variants; zero disagreements | Mathematical independence: both implementations use poker combination enumeration |
| Animation event planner | 37 cases pass for legal seats/hole counts, bounded duration, ordering/reduced motion/deduplication | An integrated renderer, actual visible animation or Safari frame timing |
| Existing server engine repro | Five of five known serious defects reproduced on freshly retrieved code | Exhaustive audit of every server path |
| Browser/phone | Not independently verified in this review | Export author's 50/50 geometry claim is not a new test by this reviewer |

The browser preview was blocked by the review environment's security policy. No alternate browser workaround was used. Therefore source-based layout review, handler invocation and model execution must not be labelled actual browser interaction or screenshot verification. Real Safari/installed mode, Android, keyboard, safe areas, rotation,200% text, reduced motion on device and multi-client tests remain release gates.

## Important source findings

**Randomness:** Round 3 ordinary entry uses a forced first Hold'em deal in the three-player path, predetermined second-hand fold behaviour and predictable subsequent hand-number seeds. Those are demonstration devices, not acceptable live randomness. The candidate makes ordinary entry use cryptographic sampling, isolating explicit fixture behaviour. But its browser still holds the whole deck/other players' cards for simulation, so it remains unsuitable as a privacy boundary. The freshly retrieved real server already uses a cryptographic random primitive with rejection sampling and Fisher–Yates; retain that good property while fixing the rest. “Rigged demo” does not establish that the existing server uses a rigged shuffle.

**Missing dealing:** Phone currently uses short entrance/fade CSS, not round-robin deck-to-seat delivery. The added planner gives a tested sequence contract, but no new production renderer was deployed or visually certified. Claude must implement and verify section8 of HANDOFF.md.

**Geometry evidence:** ReviewPage's 50 cases are ten presets × five dimensions. Assertions cover card bounding boxes, action-button minimum height and some horizontal overflow. They do not fully detect vertical clipping, ancestor clipping, heading/paragraph truncation, overlapping targets, absent controls, real keyboard/safe-area behaviour, orientation state continuity or readable six-card indices. A pass cannot close the phone acceptance checklist.

**Privacy/identity:** Current Journey is synthetic, entry password is `play`, recovery is a placeholder, opponents and deck exist locally, and persistence serializes simulation state. Do not put this object in production browser storage. Admission, individual authenticated identities, server cards and secure recovery need real implementation.

**Copy:** Remove review IDs/provisional explanations/style chooser/demo controls from production. Keep truthful limitations outside the product while still a simulation. Preserve necessary concise rule consequences, especially runouts and recovery. The candidate trims some text; it does not claim every product string or layout has been reviewed visually.

## Targeted audit cases

Original FAIL rows are reproduced defects or source-contract mismatches, not necessarily separate root causes. The PASS row A07 is a verified correct rule and must NOT be “fixed” into permitting an illegal raise.

| ID | Check | Original | Local candidate |
|---|---|---|---|
| A01 | Fresh ordinary games do not force the same first deal | FAIL | PASS |
| A02 | Early unanimous run-once keeps betting closed | FAIL | PASS |
| A03 | Runout choice resets between hands | FAIL | PASS |
| A04 | Each tournament level uses its own duration | FAIL | PASS |
| A05 | Tournament level cannot exceed configured final level | FAIL | PASS |
| A06 | New tournament starts at level one | FAIL | PASS |
| A07 | Short opening below full bet does not reopen a prior check (TDA49) | PASS | PASS |
| A08 | A retry of the same settled snapshot cannot erase a rebuy | FAIL | PASS |
| A09 | Expired straddle cannot be accepted before a timer callback | FAIL | PASS |
| A10 | A late dealer selection cannot replace timeout Holdem | FAIL | PASS |
| A11 | Declined vote restores exact remaining action time | FAIL | PASS |
| A12 | Preflop all-in prompt offers actions that actually work | FAIL | PASS |
| A13 | Buy-in input rejects decimal instead of rewriting amount | FAIL | PASS |
| A14 | Buy-in permits positive supported multiples above 20 | FAIL | PASS |
| A15 | Rebuy input rejects negative rather than converting it positive | FAIL | PASS |
| A16 | Omaha5 capacity agrees with nine-seat setup copy | FAIL | PASS |
| A17 | Waiting-room player can leave then rejoin a fresh session | FAIL | PASS |
| A18 | Reload approval at clock zero is not lost | FAIL | PASS |
| A19 | String amounts are not rounded into chip values | FAIL | PASS |
| A20 | Receipt key cannot acknowledge a different command payload | FAIL | PASS |
| A21 | PLO short-blind maximum uses nominal full preflop blinds | FAIL | PASS |
| A22 | Transition from three players to heads-up avoids repeated BB | FAIL | PASS |
| A23 | An ante-exhausted UTG cannot move the straddle to the button | FAIL | PASS |
| A24 | Pending action cannot race a newly proposed runout | FAIL | PASS |

See the evidence JSON for exact actual/expected values, not just these labels. A01 compares ordinary fresh deals; explicit test fixtures may remain deterministic. A16 is resolved using the explicitly chosen no-burn policy. A21 follows the nominal full-blind preflop pot-limit convention. A08 requires a stable settlement key, a deliberate API-contract change.

## Legacy test changes — disclosed, not hidden

Running the unchanged old tests against the candidate initially returned26/28 engine and11/13 Journey, with15/15 branches. Four tests depended on replaced contracts:

1. The deck-exhaustion fixture assumed burns. It now explicitly sets burnCards:true to retain that fixture; live profile is no burns. New capacity testing exercises no-burn hands separately.
2. The leave-settlement fixture now supplies a settlement key, required to prevent a repeated settlement from erasing a reload.
3. First-hand fixture asserted the hero must win. It now runs only under explicit fixtureMode:true, not ordinary gameplay.
4. Second-hand fixture asserted scripted opponents must fold. It also now runs only under explicit fixtureMode:true.

After those documented fixture adaptations,28/28 +13/13 +15/15 pass. Original tests and initial failing report are retained. These are not evidence that real play should preserve forced outcomes. Production must exclude fixture injection altogether.

## Existing server — blockers still requiring repair

| ID | Reproduction | Required correction |
|---|---|---|
| BUG01 | Nine-player Omaha6 gives eight players6 cards and the ninth4; deck empty | Reject unsupported capacity before any mutation/deal; O6 disabled above seven under no-burn profile |
| BUG02 | Player action accepted after its deadline | Compare database/server time during atomic command commit and settle/reject expired phase first |
| BUG03 | Cumulative short all-ins from100 to200 leave original bettor unable to raise | Track per-player reopening thresholds; full cumulative increment reopens where legally contestable |
| BUG04 | forceFold removes all-in participant from eligibility during side-pot betting | Leave/remove never folds an all-in pot claimant or destroys contributions |
| BUG05 | Timeout check resets consecutive timeout count to0 | Count check/fold automatic timeouts; reset only on valid manual action |

Existing index.ts also lacks the complete required Dealer's Choice/ante/straddle/tournament/session-ledger system; its reload and table-control model conflicts with the wireframe. It includes manual pause, relies on tick calls rather than verified autonomous scheduling, exposes raw internal error details and needs reliable receipt/idempotency semantics and durable history/cleanup. Inspect every path before reuse. Gateway verify_jwt:false alone is not proof of unauthenticated access: the API currently verifies auth.getUser internally. Preserve/check that authentication explicitly. commit_table already denies execution to anon/authenticated; do not incorrectly weaken it while repairing other RLS concerns.

## Candidate limitations still open for production

- One local Journey with synthetic bots is not simultaneous authenticated players. Stub invites, recovery, host approval, chat, reconnection and history must be replaced with actual server operations.
- Candidate Game/Session remain permissive reference APIs: optional action IDs/version checks, incomplete numeric-range validation and no server membership checks. Production validation must be mandatory and atomic.
- Candidate normal first hand still uses fixed dealer selection, compact arrays and a partial3→2 fix. Production needs securely random initial button, physical-seat rotation, dead button and missed-blind policy.
- Candidate straddle offer can add a separate4 seconds; production must use the existing choice cutoff with no serial delay. Current fixture offer timing is not the canonical rule.
- Candidate all-in offer is6 seconds and result hold8 seconds. Production profile uses5 and3 respectively; no extra waiting added by optional reveal.
- Candidate normal runout proposals need a server-enforced one-per-street limit, complete voter authorisation and private vote transport. Public per-player vote labels in the simulation are not the final privacy contract.
- Tournament level-duration/final-level bugs were patched, but production must handle several elapsed levels, fixed physical seats, simultaneous elimination ranking, no-attended-player abandonment and real tournament persistence.
- Reference session model does not implement the complete production historical reentry ledger, transactional accounting, request payload hashing, authoritative multi-device arbitration or approved-reload races.
- UI buy-in/rebuy parsing was corrected locally; audit every other amount field (creation, blind schedule and composer) and validate again on server. Do not assume those are safe from the same character-stripping defect.
- Actual phone rendering, clipping, private-card DOM absence and motion still need integrated browser/device tests. Required showdown information must be available in portrait as well as landscape.
- Legacy `allin-sim.js` bundles fixtures and the whole engine. It is useful only for local design review. Do not import it into the production client.
- Setup/table state/approved settings/ledger/history must be migrated deliberately. Do not replace the existing backend with the candidate or erase existing state to make tests pass.

## Running the evidence checks

Use a current Node runtime with Web Crypto support (Node22 or later). From this package root, create a separate output directory. The exact original export can be extracted into `original-round3/` with a normal safe ZIP tool; do not overwrite it with candidate files.

```sh
mkdir -p rerun
node tests/audit.cjs reference-candidate rerun/candidate-audit.json
node tests/run-supplied.cjs reference-candidate rerun/candidate-adapted-tests.json
node tests/stress.cjs reference-candidate rerun/stress.json
node tests/session-soak.cjs reference-candidate rerun/session-soak.json
node tests/differential.cjs reference-candidate existing-backend/api/engine.js rerun/differential.json
node tests/evaluate-exhaustive.cjs reference-candidate rerun/exhaustive.json
node tests/test-animation.cjs reference-candidate/animation-plan.cjs rerun/animation.json
node tests/reproduce-live.mjs > rerun/existing-backend-defects.json
```

The last command is expected to reproduce defects in the retrieved source, not pass a corrected server. For comparison after extracting original Round3:

```sh
node tests/audit.cjs original-round3 rerun/original-audit.json
node tests/run-supplied.cjs original-round3 rerun/original-supplied.json
```

Audit and supplied-test runners write explicit per-case status JSON; inspect it instead of relying only on shell exit code. The original target should reproduce failures; do not run that negative baseline as a passing release gate. The exhaustive function is unchanged between original and candidate; the recorded baseline measures original score5. Release tests must target the final production engine and integration, not only these files.

## Conflict audit and completion status

Known rule/UX/architecture contradictions are resolved explicitly in HANDOFF.md section2. Those resolutions are proposed build defaults, not fabricated owner approvals. Optional enabled tournament rebuys remain a separately defined expansion; the shipped tournament default is Off. These choices must be encoded once in a typed rule profile and tested; do not rely on different constants in each screen.

No claim is made that every possible defect has been found. The release checklist deliberately remains open for actual production integration and device evidence. This review supplies tested reference corrections, reproducible failures, preserved source context and an end-to-end implementation contract. Claude's final job is the working hosted product, not another review export.
