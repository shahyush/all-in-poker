# Table overlap correction

Base: main 3b3c311. Frontend only; no backend, ledger, rule or timing changes.

The old percentage ellipse and downward-extending seat panels occupied the same area as the 92%-width centre. Compact, centre-anchored player panels now sit in side gutters. Physical seat order remains stable, with the viewer at the bottom. The board has a reserved centre width. Current wagers sit in their player's panel instead of drifting into the board. Six-card hands retain visible rank/suit indices. Empty status lines and redundant hand-label hint text no longer take space.

Landscape and short portrait use compact panels. The layout tests now require the betting controls to remain within the viewport down to 320×568. The dealer token occupies reserved space in the dealer’s name row and still moves between seats. Betting controls are absent during vote, runout and showdown.

Validation in this workspace:
- Production build and TypeScript: passed.
- Engine: 59/59 passed (unchanged engine).
- `npx playwright test --config web/playwright.layout.config.ts`: 5 viewport tests passed, exercising 105 public-state layouts: 2–9 players at sampled legal capacities, 2/4/5/6 hole cards, one/two boards, and results. Asserts board/pot/result/hero separation, player-panel separation and horizontal containment. Uses actual Seat, Centre and Hero components with synthetic public state; this is not a multiplayer gameplay certification.
- Portrait and landscape screenshots inspected in Chromium.
- CI run 40197233161: both nine-player journeys passed against the real application and isolated Postgres, with separate authenticated browser contexts. Hold’em played all streets; Omaha 4 ran two boards. All nine received chat exactly once and their table-account nets summed to zero. Screenshots and host videos are in artifact 12600198559. This is CI/local-auth coverage, not hosted Supabase or real-device evidence.
- The same run exposed a pre-existing server-test timing race: the hard-coded 2,000 ms deal wait is shorter than the current 2,020 ms three-player Hold’em presentation. The helper now derives its wait from shared dealTiming. Run 40198186851 passed engine/server/typecheck, the layout matrix and both nine-player journeys with the compact-layout follow-up. Recording review then found a long-recap intrinsic-width bug and five/six-card footer crowding; both have targeted geometry checks and local fixes, awaiting the final CI run.

The fixture is outside the production entry graph, and the hosted journey configuration excludes both CI-only specs. Changes remain on the review branch until merged; no live deployment is claimed. Real iOS keyboard behaviour remains unverified.

## Remaining review priorities

- The recording shows all opponent card backs already occupying their slots during the deal. `runDealAnimation` adds a `dealt` class on arrival, but there is no matching visibility rule; private cards appear together after the full presentation. A follow-up should reveal each slot only on arrival, while preserving reconnect/reduced-motion handling and the full decision window. Slower configured travel alone does not prove this is complete.
- Nine-player chat delivery passes in Chromium with local auth. Physical iOS keyboard/installed-PWA behaviour and production reconnect/cold-start behaviour are separate checks; this PR does not claim them fixed.
- Long similar player names truncate to indistinguishable prefixes on compact panels. A player-details affordance or clear seat identifiers would improve full-table usability.
