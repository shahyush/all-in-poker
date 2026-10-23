import { test, expect, type Page } from '@playwright/test';
import { HOSTED, player, PASSWORD, actCurrentTurn, shiftClock } from './helpers.ts';

// Dedicated dealer's-choice coverage, kept separate from the general journey (which tolerates either variant). These
// tests FAIL if a deliberate selection is dropped or silently defaulted — a missed choice is never accepted here.
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close().catch(() => undefined); });

async function hostAndJoin(browser: import('@playwright/test').Browser, name: string): Promise<{ h: { page: Page }; g: { page: Page }; pages: Page[] }> {
  const h = await player(browser, 'Tanisha');
  await h.page.getByRole('button', { name: 'Host a table' }).click();
  await h.page.getByLabel('Table name').fill(name);
  await h.page.getByLabel('Your buy-in (units)').fill('3');
  await h.page.getByRole('button', { name: 'Review the table' }).click();
  await h.page.getByRole('button', { name: 'Create and open the room' }).click();
  const url = (await h.page.locator('.fine', { hasText: '/join/' }).first().textContent())!.trim();
  const g = await player(browser, 'Aayush');
  await g.page.goto(url);
  await g.page.getByRole('button', { name: '2,000' }).click();
  await g.page.getByRole('button', { name: /Join table/ }).click();
  await expect(g.page.getByText(/starts the game/)).toBeVisible({ timeout: 30_000 });
  return { h, g, pages: [h.page, g.page] };
}

/** Find whichever page is offered the choice and deliberately pick `label`; assert it was actually dealt (not defaulted). */
async function pickAndExpect(pages: Page[], label: string): Promise<void> {
  let chooser: Page | null = null;
  for (let i = 0; i < 40 && !chooser; i++) {
    for (const p of pages) { if (await p.getByRole('button', { name: label }).isVisible().catch(() => false)) { chooser = p; break; } }
    if (!chooser) await pages[0].waitForTimeout(300);
  }
  expect(chooser, `a player is offered the dealer's choice for ${label}`).not.toBeNull();
  await chooser!.getByRole('button', { name: label }).click();
  // immediate feedback the tap registered ("Submitting…", or the brief "Locked in — dealing…" if the deal is slower than
  // the click round-trip). We do NOT wait on "Locked in" as a stable state: on a fast accept the server deals at once and
  // the choice overlay is replaced by the dealt hand, so that label is transient. The real confirmation is below — every
  // client ends up on the chosen variant; a dropped or defaulted choice would read "Hold'em" and fail there.
  await expect(chooser!.getByText(/Submitting|Locked in/).first()).toBeVisible({ timeout: 4_000 });
  for (const p of pages) await expect(p.locator('.g-stakes')).toContainText(label, { timeout: 20_000 });
}

const reachHand = async (pages: Page[], label: string) => {
  for (let i = 0; i < 60; i++) { if (await pages[0].locator('.g-stakes').getByText(label, { exact: false }).isVisible().catch(() => false)) break; if (!(await actCurrentTurn(pages))) break; }
  await expect(pages[0].locator('.g-stakes')).toContainText(label, { timeout: 25_000 });
};

test('a deliberate dealer\'s choice covers the whole orbit, then the next orbit lets the next player pick', async ({ browser }) => {
  test.setTimeout(180_000);
  const { h, pages } = await hostAndJoin(browser, 'Choosers');
  // sit idle in the lobby so realtime/edge can spin down, then start with no warm-up — the 15 s window must still let a
  // real player choose. On the local dev stack there is nothing to spin down, so the idle is token.
  await h.page.waitForTimeout(HOSTED ? 30_000 : 1_000);
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  // hand 1 (orbit start): deliberately pick Omaha 4 (2 players: 2*4+5=13 cards) — must be dealt, not defaulted
  await pickAndExpect(pages, 'Omaha 4');
  for (const p of pages) await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(4, { timeout: 15_000 });
  // hand 2 is mid-orbit: the same variant continues with NO choice offered to anyone (one pick covers the whole orbit)
  await reachHand(pages, 'Hand 2');
  for (const p of pages) {
    await expect(p.locator('.g-stakes')).toContainText('Omaha 4');
    await expect(p.getByRole('button', { name: /Omaha 5/ })).toHaveCount(0); // no choice buttons mid-orbit
    await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(4, { timeout: 15_000 });
  }
  // hand 3 opens the next orbit (2 players → 2-hand orbits): a fresh choice is offered, now a different deliberate pick
  await reachHand(pages, 'Hand 3');
  await pickAndExpect(pages, 'Omaha 5');
  for (const p of pages) await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(5, { timeout: 15_000 });
});

test('an unattended dealer\'s choice defaults to Hold\'em when nobody picks', async ({ browser }) => {
  test.setTimeout(120_000);
  const { pages } = await hostAndJoin(browser, 'Defaulters');
  await pages[0].getByRole('button', { name: 'Start the game' }).click();
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  // nobody chooses: let the 15 s window lapse. Real wall-clock on the hosted stack; fast-forwarded locally.
  if (HOSTED) await pages[0].waitForTimeout(16_000); else await shiftClock(16_000);
  await expect(pages[0].locator('.g-stakes')).toContainText("Hold'em", { timeout: 20_000 });
  for (const p of pages) await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(2, { timeout: 15_000 });
});
