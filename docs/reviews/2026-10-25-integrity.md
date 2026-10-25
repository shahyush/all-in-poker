# Gameplay, integrity and phone review — 25 October 2026

This review applies to PR #1, not the currently deployed application. No production accounts or historical hands were altered. CI results must be checked against the final commit; a green older run does not verify these edits.

## Correctness examined

- `random.ts`: cryptographic `getRandomValues`, rejection sampling (no modulo bias), Fisher–Yates shuffle; fails closed if entropy is unavailable. Production handlers do not accept a client RNG. This is implementation review, not independent RNG certification or proof against a compromised server.
- `table.ts`: one 52-card deck, round-robin hole cards left of the button, real consumed burns before board streets. Public state excludes deck, cursor, hole map, burned cards and queued future board cards. Individual cards are returned only for the requested seated identity through authenticated server handling.
- Hold’em may use any five available cards; Omaha 4/5/6 uses exactly two hole cards and three community cards. Existing evaluator tests enumerate all 2,598,960 five-card combinations and check category counts, kickers, wheels and suit ties.
- Legal actions enforce actor, available stack, call amounts, full-raise/minimum-raise rules and pot-limit caps. Folded players cannot win pots. Uncalled excess is returned; side pots include folded contributions but exclude folded winners. Odd chips follow the documented house convention; two-board splits give the odd board chip to A.
- Run It Twice reserves separate undealt cards and burns while retaining the shared prefix. Deck capacity limits are deliberate: Hold’em/Omaha 4 up to nine, Omaha 5 up to eight, Omaha 6 up to seven. Run It Twice may be unavailable when the remaining deck cannot support it.
- Dealer’s choice applies to an orbit. Early consensual runouts are a house rule: agreement ends further betting. This must not be described as ordinary all-in-only poker.
- Existing server integration tests cover membership/private-card access, replayed and conflicting action IDs, simultaneous joins, rapid chat, reactions, buy-in/rebuy/leave/rejoin conservation and recovery. They require PostgreSQL and run in CI.

## New regression evidence

1,000 seeded hands (250 per variant), varying table size, stacks, folds, min/max raises and all-in runouts. Every intermediate state checks total chips, nonnegative integer stacks, unique dealt cards, deck bounds, private-card isolation and hidden fields. Winners must not be folded. A dedicated test forces rejection of the biased random tail and checks fail-closed behavior.

Presentation checks cover per-card arrival visibility, cancellation cleanup, reduced motion, round-robin order, burn-before-flop timing and final-street-aggressor showdown order. Layout matrix: eight portrait/landscape viewports, seven legal seat/card combinations, three board/result states = 168 cases per browser. CI includes Chromium, WebKit and Firefox layout/animation; Chromium and WebKit run the full functional suite, including two nine-player journeys.

## Changes in this pass

- Hide each destination card until its flying card arrives, including the viewer’s cards. Restore slots when animation is cancelled.
- Show a face-down deck and burn pile, with a 500ms burn before staged board flips.
- Share burn/board duration constants; extend the next betting deadline by the complete presentation time, and disable UI action during that presentation.
- Final-street aggressor shows first; checked-down order starts left of the button. No winner-first or winner-last manipulation.
- Highlight winning board cards separately for each Run It Twice board.
- Compact player stack/bet rows on shallow landscape screens to prevent newly reproduced seat collisions.

## Limits and remaining release checks

Browser automation is not proof of all phones. Actual iOS keyboard, safe-area/browser chrome, installed PWA updates, background suspension and real network loss need physical-device validation. These tests use an isolated development server and database; they do not verify production Supabase authentication, realtime cold starts or production delivery. Merge and coordinated frontend/backend deployment, followed by hosted checks, remain separate from this PR review. No claim of universal compatibility, independent security certification, or cryptographically verifiable dealing is made.

Reference rules consulted: https://www.pokertda.com/view-poker-tda-rules/ and https://www.pokerstars.com/poker/games/omaha/ . TDA tournament conventions are distinguished from this private table’s documented house rules.
