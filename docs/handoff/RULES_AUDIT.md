# Poker rules audit

Audit of the server-authoritative engine (`engine/src`) for Texas Hold'em, Omaha 4/5/6, against standard rules.
Every rule below is enforced on the server; clients only render. Line references are to `engine/src/table.ts` unless noted.
"Covered by" names the regression test in `engine/test` / `server/test` that locks the behaviour.

## Already correct (verified)

- **Dealing order & hole counts.** One card per seat clockwise from the left of the button; Hold'em 2, Omaha 4/5/6 per `RULES.variants`. Covered by `deals one card per seat clockwise from the left of the button`, `BUG01`.
- **Omaha 2+3.** Hand evaluation uses exactly two hole cards and three board cards; Hold'em plays any. `evaluator.ts` / `currentBest`. Covered by `omaha uses exactly two hole cards: a board flush with one hole spade is not a flush`.
- **Blinds / heads-up / dead button.** Heads-up: button posts the small blind and acts first pre-flop, last post-flop. Tournament dead-button advances the big blind. Covered by `heads-up: button posts the small blind…`, `tournament dead button…`, `A22/R4-17`.
- **Straddle (house rule).** Live 2×BB UTG straddle, action starts left of the straddler, straddler keeps the option, min raise-to 4×BB; the offer closes with the choice window. Covered by `straddle: live 2xBB…`, `A09/R4-10`, `A23/R4-09`.
- **Min-raise, reopening, short all-ins.** Legal minimum raise tracked by last full raise; a short all-in below a full raise does not reopen action to players who already acted; cumulative short all-ins that reach a full raise do reopen. Covered by `BUG03/R4-14`, `A07`.
- **Pot-limit.** Max raise-to is S+P+2C using nominal blinds after a short big blind; no all-in offered above the cap. Covered by `A21/R4-13`, `pot-limit: maximum raise-to is S + P + 2C…`.
- **Side pots, refunds, splits, odd chips.** Short all-in wins only the eligible pot; uncalled bets refunded before award; ties split with the odd chip clockwise from the button; two boards give Board A the odd chip. Covered by `side pots…`, `refunds an uncalled bet…`, `ties split exactly with odd chips…`.
- **Showdown eligibility & evaluation.** Only non-folded, eligible players are evaluated per pot/board. Covered by `pots, refunds and showdown`.
- **Chip conservation.** `settle` halts the hand if total chips change across settlement; conservation re-checked every hand. Covered by `chip conservation`, `plays many hands across variants and seat counts`, Friday-table accounting regression (`server/test`).
- **Deck sufficiency / unsupported combos.** `variantAllowed(n, variant)` rejects any variant whose single board — hole cards + 5 community + 3 burns — needs more than 52 cards, before any mutation (Omaha 6 above seven dealt players, Omaha 5 above eight); `canRunTwice` requires `2 × (cards left + burns left)` from the remaining deck before a second board is offered. Covered by `BUG01`, `burns: one hidden card is consumed before each community street…`, `burns when run twice…`, `run twice…`.
- **Tournament vs cash.** Tournaments never run it twice (`beginRunout` runs once when not cash), are freezeouts, levels advance on the server clock, a hand keeps the blinds it started with. Covered by the tournament suite (`A04/A05/A06/R4-20`, `timeout-only tournament…`, `simulated shoves…`).
- **Reconnect / retry / duplicate safety.** All writes go through `allin_commit` (CAS) with per-`actionId` receipts; a duplicate actionId replays the stored result exactly once, a stale re-send is rejected by engine state, and reload requests carry a client-stable `requestId`. Covered by `retry safety: a lost response cannot apply an action twice`, Friday-table regression (duplicate leave/reload).

## Run It Twice — two distinct mechanisms (both correct)

1. **Standard all-in run-it-twice.** Triggered only when no further betting is possible because players are all-in (`closeStreet` → `beginRunout`). Community cards already dealt are **shared**; only the remainder is dealt a second time from the same deck (`queueStages` copies the prefix into both boards and deals distinct cards from the cursor). Offered when ≥2 players remain and the deck can cover it (`openOffer`/`canRunTwice`); default once, unanimous "twice" to run twice. Each board wins half the pot, Board A the odd chip. This matches standard rules.
2. **Early run (house rule), `propose`.** On the flop or turn, before any bet on that street, the player to act may offer to end betting and deal the rest once or twice; it only happens on unanimous agreement, and a decline/timeout restores betting exactly where it left off (`propose`/`resolveProposal`). This is a non-standard convenience, now labelled as such in-app ("End betting, deal the rest") and in the Rules sheet.

Aayush's "proposing ends play prematurely" was this house rule working as designed but under-labelled ("Run it: once/twice" gave no hint it ends the hand); the control now reads "End betting, deal the rest · Run once / Run twice". "Betting continues after the runout" could not be reproduced in the engine — `act` requires `phase === 'betting'`, which never holds during `runout`/`offer`/`vote`, and the client action dock is gated on the same; the likely perception is the preflop-all-in flow (shared flop shown, then the run-once/twice offer), which is expected and is clearly labelled "No more betting."

## Configurable house rules (explicit)

- **Burn cards: ON** (`RULES.burnCards = true`). One hidden card is consumed from the deck, at the cursor, immediately before the flop, the turn and the river (`burnCard`, called from `closeStreet`, `beginRunout` and `queueStages`). When a hand runs twice, **each board burns ahead of each of its own remaining streets**; the already-shared prefix is not re-burned. Burned cards live only in `HandState.burned`, which `publicView` strips, so they can never reappear as board or hole cards and are never sent to a client; the hand log and the public `burn` event record only *that* a burn happened (board + street), which is what drives the face-down burn animation. Consequences, applied in code rather than left implicit: deck sufficiency now counts three burns per board (`cardsForOneBoard`), so **Omaha 5 seats at most eight dealt players** (40 + 5 + 3 = 48 ≤ 52; nine would need 53) and Omaha 6 stays at seven (42 + 8 = 50); and `canRunTwice` requires `2 × (cards left + streets left)` from the remaining deck, so a second board is offered only when it can be burned and dealt in full.
- **Early-run agreement** (above) — a house convenience beyond standard rules.
- **Straddle** — optional per table (`rules.straddle`).

## Remaining / unverified

- Burns are now real (see house rules); the engine test "burns: one hidden card is consumed before each community street…" pins the deck order, the card-free announcements and the public-view stripping.
- No historical rule violations found in recorded hands: `settle` would have halted any hand that failed chip conservation, and no halted/`error` hands exist in the audited sessions.
