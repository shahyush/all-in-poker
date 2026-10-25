import { test, expect, type Page } from '@playwright/test';

// every test opens several phone contexts; close them so later tests do not inherit their polling load
test.afterEach(async ({ browser }, testInfo) => { await closePlayers(browser, testInfo.outputDir); }); // saves each player's recording on hosted runs
import { HOSTED, player, actWhenMyTurn, shiftClock, actCurrentTurn, closePlayers } from './helpers.ts';

async function hostTable(page: Page, opts: { name: string; units?: string; straddle?: boolean }): Promise<string> {
  await page.getByRole('button', { name: 'Host a table' }).click();
  await page.getByLabel('Table name').fill(opts.name);
  await page.getByLabel('Your buy-in', {exact:true}).fill(String(Number(opts.units ?? '2') * 1000));
  if (opts.straddle) { await page.getByRole('button', { name: 'More table rules' }).click(); await page.getByLabel(/Allow a UTG straddle/).check(); }
  await page.getByRole('button', { name: 'Review the table' }).click();
  await page.getByRole('button', { name: 'Create and open the room' }).click();
  return (await page.locator('.fine', { hasText: '/join/' }).first().textContent())!.trim();
}
async function joinVia(page: Page, url: string, units = '2,000') {
  await page.goto(url);
  await page.getByRole('button', { name: units }).click();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Join table/ }).click();
  const sawFeedback = await page.getByText(/Taking your seat/).isVisible({ timeout: 2500 }).catch(() => false);
  await expect(page.getByText(/starts the game/)).toBeVisible({ timeout: 30_000 }); // cold edge/realtime start can be slow
  console.log(`[join] reached the lobby in ${Date.now() - t0} ms; "Joining…" feedback shown: ${sawFeedback}`);
}
async function turnOf(pages: Page[]): Promise<Page | null> {
  // isEnabled() waits for a missing element (forever with no timeout); a page that has left the table has no action bar
  for (const p of pages) {
    const fold = p.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Fold' });
    if (await fold.count() === 0) continue;
    if (await fold.isEnabled({ timeout: 1000 }).catch(() => false)) return p;
  }
  return null;
}
async function chooseIfAsked(pages: Page[], variant = /Hold'em/) {
  // the choice buttons are disabled while a choice request is in flight or once the deal has started
  for (const p of pages) {
    const b = p.getByRole('button', { name: variant });
    if (await b.count() === 0) continue;
    if (await b.isVisible().catch(() => false) && await b.isEnabled({ timeout: 500 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => undefined); return; }
  }
}

test('reconnect, rotation, uncontested reveal, reload approval and run it twice', async ({ browser }) => {
  test.setTimeout(180_000);
  const h = await player(browser, 'Tanisha');
  const g = await player(browser, 'Aayush');
  const url = await hostTable(h.page, { name: 'Two of us' });
  await joinVia(g.page, url);
  // Start immediately, no artificial warm-up: the 15 s dealer's-choice window covers a cold realtime/edge start.
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  const pages = [h.page, g.page];
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  await chooseIfAsked(pages);
  // reconnect mid-hand: reload the guest page; same seat, own cards return, no second deal
  const labels = async () => (await g.page.locator('.own-cards .pc:not(.back)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).filter(Boolean).join('|');
  // capture only once both named hole cards are actually on screen (during the cold-start deal the faces can lag the count)
  let before = '';
  await expect.poll(async () => { before = await labels(); return before.split('|').filter(Boolean).length; }, { timeout: 20_000 }).toBe(2);
  await g.page.reload();
  // the same two cards come back after the reload (reconnect restores the seat and hand; no second deal)
  await expect.poll(labels, { timeout: 20_000 }).toBe(before);
  await expect(g.page.locator('.own-cards .pc:not(.back)')).toHaveCount(2);
  // rotate mid-hand: layout changes, state does not
  await g.page.setViewportSize({ width: 844, height: 390 });
  await expect(g.page.locator('.own-cards .pc:not(.back)')).toHaveCount(2);
  await g.page.screenshot({ path: 'test-results/shots/10-rotated.png' });
  await g.page.setViewportSize({ width: 390, height: 844 });
  // uncontested: first actor folds; the winner reveals one card, which MUST propagate to the opponent.
  let first: Page | null = null;
  await expect.poll(async () => { first = await turnOf(pages); return first !== null; }).toBe(true);
  const actor = first!;
  const winner = actor === h.page ? g.page : h.page;
  await actWhenMyTurn(actor, 'Fold');
  // The uncontested pot lingers the full reveal window (revealMs), and a landed reveal re-extends the linger so the
  // shown card reaches every client before the next hand. This is a hard assertion now, not a best-effort race:
  // the winner taps the first card, then the folded opponent must see a face-up card in the winner's seat.
  const revealBtn = winner.getByRole('button', { name: /Tap to show: card 1/ });
  await revealBtn.click({ timeout: 9000 });
  await expect(actor.locator('.seat .pc:not(.back)').first()).toBeVisible({ timeout: 8000 });
  await winner.screenshot({ path: 'test-results/shots/11-reveal.png' });
  await expect(h.page.locator('.g-stakes')).toContainText('Hand 2', { timeout: 20_000 });
  // the compact last-hand recap names the previous hand's winner and award (uncontested here) without exposing mucked cards
  await expect(h.page.locator('.g-recap')).toContainText(/won/, { timeout: 10_000 });
  // hand 2 is mid-orbit (dealer's choice runs once per orbit), so no new variant is offered here — it continues the orbit
  // reload: guest requests, host approves; credited at the next boundary only
  await g.page.getByRole('button', { name: 'Table menu' }).click();
  await g.page.getByRole('button', { name: 'Add chips' }).click();
  await g.page.getByRole('button', { name: '1,000', exact: true }).click();
  await g.page.getByRole('button', { name: /^Request/ }).click();
  await g.page.getByRole('button', { name: 'Table menu' }).click();
  await expect(g.page.getByText(/waiting for the host/)).toBeVisible();
  await g.page.keyboard.press('Escape');
  await h.page.getByRole('button', { name: 'Table menu' }).click();
  await expect(h.page.getByText(/Aayush asks for 1,000/)).toBeVisible();
  await h.page.getByRole('button', { name: 'Approve' }).click();
  await h.page.keyboard.press('Escape');
  const stackBefore = (await g.page.locator('.hero-meta b').textContent())!;
  // finish hand 2 by checking down
  for (let i = 0; i < 20; i++) { if (!(await actCurrentTurn(pages))) break; }
  await expect(h.page.locator('.g-stakes')).toContainText('Hand 3', { timeout: 20_000 });
  // the guest's own screen must show the credit once it has caught up with hand 3 (clients poll/subscribe independently)
  await expect(g.page.locator('.g-stakes')).toContainText('Hand 3', { timeout: 20_000 });
  await expect.poll(async () => Number((await g.page.locator('.hero-meta b').textContent())!.replace(/,/g, '')) - Number(stackBefore.replace(/,/g, '')), { timeout: 10_000 }).toBeGreaterThanOrEqual(1000 - 15);
  // run-it proposal on the flop: propose twice, other agrees -> two boards
  await chooseIfAsked(pages);
  for (let i = 0; i < 30; i++) { if (await h.page.locator('.board-label', { hasText: /^flop$/i }).isVisible().catch(() => false)) break; if (!(await actCurrentTurn(pages))) break; }
  let proposer: Page | null = null;
  for (let i = 0; i < 20 && !proposer; i++) { proposer = await turnOf(pages); if (!proposer) await h.page.waitForTimeout(300); }
  await proposer!.getByRole('button', { name: 'Two boards · keep betting' }).click();
  const other = proposer === h.page ? g.page : h.page;
  await expect(other.getByText(/Play two boards/)).toBeVisible();
  await other.getByRole('button', { name: 'Agree' }).click();
  await expect(h.page.getByText('Board B')).toBeVisible({ timeout: 15_000 });
  await h.page.screenshot({ path: 'test-results/shots/12-two-boards.png' });
  // Agreement preserves betting: play the remaining streets on both boards before the award.
  for (let i = 0; i < 35; i++) {
    if (await h.page.getByText(/Pot detail/).isVisible().catch(() => false)) break;
    if (!(await actCurrentTurn(pages))) await h.page.waitForTimeout(300);
  }
  await expect(h.page.getByText(/Pot detail/)).toBeVisible({ timeout: 15_000 });
  await h.page.screenshot({ path: 'test-results/shots/13-two-boards.png' });
  // leave, history and recovery are verified on a fresh session below, not stacked onto this long reload-heavy journey
  // (nine rapid reloads/rotations here can degrade the live client transport, which is a test artifact, not a product bug).
});

test('leave after a hand: the session summary, history and player recovery', async ({ browser }) => {
  test.setTimeout(180_000);
  const h = await player(browser, 'Tanisha');
  const g = await player(browser, 'Aayush');
  const url = await hostTable(h.page, { name: 'Two of us' });
  await joinVia(g.page, url);
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  const pages = [h.page, g.page];
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  await chooseIfAsked(pages);
  // play one hand to a settled result, so there is a real session to leave from
  for (let i = 0; i < 40; i++) { if (await h.page.getByText(/Pot detail|Showdown/).first().isVisible().catch(() => false)) break; if (!(await actCurrentTurn(pages))) break; }
  // guest leaves after the hand
  await g.page.getByRole('button', { name: 'Table menu' }).click();
  await g.page.getByRole('button', { name: 'Leave table' }).click();
  await g.page.getByRole('button', { name: 'Confirm' }).click();
  // the leave command must reach the server (the menu then offers to undo it, or the summary already shows)
  await expect
    .poll(async () =>
      (await g.page.getByRole('button', { name: 'Stay', exact: true }).isVisible().catch(() => false)) ||
      (await g.page.getByRole('heading', { name: 'Two of us' }).isVisible().catch(() => false)),
    { timeout: 25_000 })
    .toBe(true);
  await g.page.keyboard.press('Escape');
  // no manual reload: the exit commits at the next hand boundary and the app transitions the leaving player to the
  // session summary and fetches the accounting on its own
  await expect(g.page.getByRole('heading', { name: 'Two of us' })).toBeVisible({ timeout: 45_000 });
  await expect(g.page.getByText('Chips taken off').first()).toBeVisible({ timeout: 10_000 });
  await g.page.screenshot({ path: 'test-results/shots/14-session-summary.png' });
  await g.page.getByRole('button', { name: 'History' }).click();
  await expect(g.page.getByRole('button', { name: /Two of us/ })).toBeVisible();
  // recovery: save a code, forget the device, restore the same player
  await g.page.goto('/profile');
  await g.page.getByRole('button', { name: 'Create my player code' }).click();
  const code = (await g.page.getByLabel('Player code').textContent())!.trim();
  await g.page.getByRole('button', { name: 'Forget this player on this device' }).click();
  await g.page.getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(g.page.getByText('Your seat is waiting.')).toBeVisible();
  await g.page.getByRole('button', { name: 'I saved a player code' }).click();
  await g.page.getByLabel('Player code').fill(code);
  await g.page.getByRole('button', { name: 'Restore my player' }).click();
  await expect(g.page.getByRole('heading', { name: 'Aayush' })).toBeVisible();
  await g.page.goto('/');
  await expect(g.page.getByText('Good to see you, Aayush')).toBeVisible();
  await g.page.getByRole('button', { name: 'My evenings' }).click();
  await expect(g.page.getByRole('button', { name: /Two of us/ })).toBeVisible();
});

test('server timers run with every browser closed; a timed-out player folds and sits out after two misses', async ({ browser }) => {
  test.skip(HOSTED, 'drives the local dev clock; on the hosted stack timers are observed in the reconnect journey instead');
  const h = await player(browser, 'Host');
  const g = await player(browser, 'Guest');
  const url = await hostTable(h.page, { name: 'Timers' });
  await joinVia(g.page, url);
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  await expect(h.page.locator('.game')).toBeVisible();
  const saved = await h.ctx.storageState();
  const tableUrl = h.page.url();
  await h.page.context().close(); await g.page.context().close();
  // nobody is connected: choice defaults, actions time out, next hands start, purely on the server
  for (let i = 0; i < 12; i++) { await shiftClock(31_000); await new Promise((r) => setTimeout(r, 1300)); }
  const back = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: saved });
  const page = await back.newPage();
  await page.goto(tableUrl);
  await expect(page.locator('.game')).toBeVisible();
  await expect(page.getByText('Sitting out', {exact:true})).toBeVisible();
  await expect(page.locator('.g-stakes')).not.toContainText(/Hand 1(?:\s|$)/);
  await back.close();
});

test('last player standing: equal banks, orbit blinds, play to a winner and standings', async ({ browser }) => {
  test.setTimeout(180_000);
  const h = await player(browser, 'Tan');
  const g = await player(browser, 'Aay');
  await h.page.getByRole('button', { name: 'Host a table' }).click();
  await h.page.getByRole('button', { name: 'Last player standing' }).click();
  await h.page.getByLabel('Table name').fill('Cup');
  await h.page.getByLabel('Starting bank').fill('300');
  await h.page.getByRole('button', { name: 'Review the table' }).click();
  await h.page.getByRole('button', { name: 'Create and open the room' }).click();
  const url = (await h.page.locator('.fine', { hasText: '/join/' }).first().textContent())!.trim();
  await g.page.goto(url);
  await g.page.getByRole('button', { name: /Join game/ }).click();
  await expect(g.page.getByText(/starts the game/)).toBeVisible();
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  const pages = [h.page, g.page];
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  await expect(h.page.locator('.g-stakes')).toContainText('Blinds 5/10');
  // shove every turn until someone has everything (two players: the first called shove decides it unless they tie)
  for (let i = 0; i < 80; i++) {
    if (await h.page.getByText('Final standings').isVisible().catch(() => false)) break;
    await chooseIfAsked(pages);
    const p = await turnOf(pages);
    if (!p) { await h.page.waitForTimeout(400); continue; }
    const raise = p.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^(Bet|Raise)$/ });
    if (await raise.isEnabled()) { await raise.click(); await p.getByRole('button', { name: /All-in|Max/ }).click(); await p.getByRole('button', { name: /^(Bet|Raise to) / }).click(); }
    else { const call = p.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^Call/ }); if (await call.isVisible()) await actWhenMyTurn(p, 'Call'); else await actWhenMyTurn(p, 'Check'); }
  }
  await expect(h.page.getByText('Final standings')).toBeVisible({ timeout: 30_000 });
  await expect(h.page.getByText('Winner')).toBeVisible();
  await h.page.screenshot({ path: 'test-results/shots/14-tournament-result.png' });
});
