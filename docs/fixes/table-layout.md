# Table overlap correction

Base: main 3b3c311. Frontend only; no backend, ledger, rule or timing changes.

The old percentage ellipse and downward-extending seat panels occupied the same area as the 92%-width centre. Compact, centre-anchored player panels now sit in side gutters. Physical seat order remains stable, with the viewer at the bottom. The board has a reserved centre width. Current wagers sit in their player's panel instead of drifting into the board. Six-card hands retain visible rank/suit indices. Empty status lines and redundant hand-label hint text no longer take space.

Landscape uses compact panels. Very short portrait viewports retain a minimum table height and can scroll vertically instead of clipping cards/controls. This is a deliberate fallback, not a claim that every phone fits without scrolling.

Validation in this workspace:
- Production build and TypeScript: passed.
- Engine: 59/59 passed (unchanged engine).
- `npx playwright test --config web/playwright.layout.config.ts`: 5 viewport tests passed, exercising 105 public-state layouts: 2–9 players at sampled legal capacities, 2/4/5/6 hole cards, one/two boards, and results. Asserts board/pot/result/hero separation, player-panel separation and horizontal containment. Uses actual Seat, Centre and Hero components with synthetic public state; this is not a multiplayer gameplay certification.
- Portrait and landscape screenshots inspected in Chromium.
- Server integration could not start: psql/PostgreSQL is absent. Full multiplayer journeys, hosted deployment and real iOS Safari remain unverified.

The fixture is outside the production entry graph, and the hosted journey configuration excludes this local-only layout spec. Before deployment, run the repository's integration and multiplayer checks in the existing database-equipped environment. Inspect phone screenshots, especially short portrait scrolling, and do not infer a chat fix from these layout changes.
