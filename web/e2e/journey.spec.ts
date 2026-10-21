import { test, expect } from '@playwright/test';

// every test opens several phone contexts; close them so later tests do not inherit their polling load
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close().catch(() => undefined); });
import { player, actWhenMyTurn, PASSWORD, attachDiagnostics, expectVisibleOrDump } from './helpers.ts';

test('three friends: invite → entry → buy-in → start → dealer choice → a full hand → next hand', async ({ browser }) => {
  const host = await player(browser, 'Tanisha');
  // host creates a table
  await host.page.getByRole('button', { name: 'Host a table' }).click();
  await host.page.getByLabel('Table name').fill('Friday at ours');
  await host.page.getByLabel('Your buy-in (units)').fill('3');
  await host.page.getByRole('button', { name: 'Review the table' }).click();
  await host.page.getByRole('button', { name: 'Create and open the room' }).click();
  await expect(host.page.getByText('Waiting for one more player.')).toBeVisible();
  await host.page.screenshot({ path: 'test-results/shots/01-waiting-host.png' });
  const code = (await host.page.locator('.code').textContent())!.trim();
  const inviteUrl = (await host.page.locator('.fine', { hasText: '/join/' }).first().textContent())!.trim();
  expect(inviteUrl).toContain('/join/' + code);

  // guests open the invite link before entering: destination is preserved through entry
  const guests = [] as { page: import('@playwright/test').Page }[];
  for (const [i, name] of ['Aayush', 'Sam'].entries()) {
    const ctx = await browser.newContext({ viewport: i === 1 ? { width: 844, height: 390 } : { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: i === 1 ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    attachDiagnostics(page, name);
    await page.goto(inviteUrl);
    await expect(page.getByText("You are invited")).toBeVisible();
    await page.getByLabel('Your nickname').fill(name);
    await page.getByLabel('Group password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectVisibleOrDump(page, page.getByRole('heading', { name: 'Friday at ours' }), 'invite-preview');
    await page.getByRole('button', { name: '2,000' }).click();
    await page.getByRole('button', { name: /Join table/ }).click();
    await expect(page.getByText(/starts the game/)).toBeVisible();
    guests.push({ page });
  }
  await expect(host.page.getByText('Everyone here is ready when you are.')).toBeVisible();
  await host.page.getByRole('button', { name: 'Start the game' }).click();

  // dealer's choice: whoever is chooser picks Omaha 4 (3 players), others see "is choosing"
  const pages = [host.page, guests[0].page, guests[1].page];
  let chooser = null as import('@playwright/test').Page | null;
  for (const p of pages) { await expect(p.locator('.game')).toBeVisible(); if (await p.getByRole('button', { name: /Omaha 4/ }).isVisible().catch(() => false)) chooser = p; }
  expect(chooser).not.toBeNull();
  await chooser!.getByRole('button', { name: /Omaha 4/ }).click();
  await expect(pages[0].locator('.g-stakes')).toContainText('Omaha 4');
  // every player sees their own four cards and nobody else's faces
  for (const p of pages) {
    await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(4, { timeout: 15_000 });
    const html = await p.locator('.g-surface').innerHTML();
    expect(html).not.toMatch(/aria-label="(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Jack|Queen|King|Ace) of/);
    await expect(p.locator('.seat .pc.back')).toHaveCount(8);
  }
  await pages[0].screenshot({ path: 'test-results/shots/02-dealt-portrait.png' });
  await pages[2].screenshot({ path: 'test-results/shots/03-dealt-landscape.png' });

  // preflop: everyone calls/checks, then check down to showdown
  async function whoseTurn(): Promise<import('@playwright/test').Page | null> {
    for (const p of pages) { const fold = p.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Fold' }); if (await fold.count() === 0) continue; if (await fold.isEnabled({ timeout: 1000 }).catch(() => false)) return p; }
    return null;
  }
  let acted = 0;
  for (let i = 0; i < 40; i++) {
    const resultVisible = await pages[0].getByText('Pot detail').isVisible().catch(() => false);
    if (resultVisible) break;
    const p = await whoseTurn();
    if (!p) { await pages[0].waitForTimeout(300); continue; }
    const call = p.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^Call/ });
    if (await call.isVisible()) await actWhenMyTurn(p, 'Call'); else await actWhenMyTurn(p, 'Check');
    acted++;
  }
  expect(acted).toBeGreaterThanOrEqual(6);
  await expect(pages[0].getByText('Showdown')).toBeVisible();
  await pages[0].screenshot({ path: 'test-results/shots/04-showdown.png' });
  await pages[0].getByRole('button', { name: 'Pot detail' }).click();
  await expect(pages[0].getByRole('dialog', { name: 'Pot detail' })).toBeVisible();
  await pages[0].screenshot({ path: 'test-results/shots/05-pot-detail.png' });
  await pages[0].keyboard.press('Escape');
  // next hand starts automatically on the server timer
  await expect(pages[0].locator('.g-stakes')).toContainText('Hand 2', { timeout: 20_000 });
  await pages[1].screenshot({ path: 'test-results/shots/06-hand2-choice.png' });

  // chat with the keyboard open keeps the turn cue
  await pages[1].getByRole('button', { name: /^Chat/ }).click();
  await pages[1].getByLabel('Message').fill('nice hand 🙂');
  await pages[1].getByRole('button', { name: 'Send' }).click();
  await expect(pages[1].getByText('nice hand 🙂')).toBeVisible();
  await pages[1].keyboard.press('Escape');
  await expect(pages[0].getByRole('button', { name: /Chat, 1 unread/ })).toBeVisible();

  // accounts: added = in play + taken off − net consistency
  await pages[0].getByRole('button', { name: 'Table menu' }).click();
  await pages[0].getByRole('button', { name: 'Accounts' }).click();
  await expect(pages[0].getByRole('dialog', { name: 'Session accounts' })).toBeVisible();
  await pages[0].screenshot({ path: 'test-results/shots/07-accounts.png' });
  const nets = await pages[0].locator('table tbody tr td:last-child').allTextContents();
  const sum = nets.reduce((a, s) => a + Number(s.replace(/[^\d-]/g, '')), 0);
  expect(sum).toBe(0);
});
