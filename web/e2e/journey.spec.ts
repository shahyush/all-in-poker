import { test, expect } from '@playwright/test';

// every test opens several phone contexts; close them so later tests do not inherit their polling load
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close().catch(() => undefined); });
import { player, actWhenMyTurn, PASSWORD, attachDiagnostics, expectVisibleOrDump, actCurrentTurn } from './helpers.ts';

test('three friends: invite → entry → buy-in → start → dealer choice → a full hand → next hand', async ({ browser }) => {
  test.setTimeout(180_000);
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
  // Start immediately — no artificial warm-up. The 15 s dealer's-choice window (RULES.timers.choiceMs) comfortably covers
  // a cold realtime/edge start, and the adaptive poll (700 ms during the choice phase) surfaces the window either way.
  await host.page.getByRole('button', { name: 'Start the game' }).click();

  // dealer's choice: whoever is chooser picks Omaha 4 (others see "is choosing"). With the 15 s window a deliberate
  // selection reliably registers; we still branch on the variant actually dealt so a defaulted hand can't wedge the run.
  const pages = [host.page, guests[0].page, guests[1].page];
  for (const p of pages) await expect(p.locator('.game')).toBeVisible();
  const chooser = await Promise.any(pages.map(async (p) => { await p.getByRole('button', { name: /Omaha 4/ }).waitFor({ state: 'visible', timeout: 12_000 }); return p; })).catch(() => null);
  expect(chooser, 'a player is offered the dealer\'s choice').not.toBeNull();
  await chooser!.getByRole('button', { name: /Omaha 4/ }).click().catch(() => undefined);
  // wait until a variant is dealt (chosen Omaha 4, or the Hold'em default if the window lapsed)
  await expect(pages[0].locator('.g-stakes')).toContainText(/Omaha 4|Hold'em/, { timeout: 15_000 });
  const dealt = (await pages[0].locator('.g-stakes').innerText()).match(/Omaha 4/) ? 4 : 2;
  const backs = dealt * 2; // two opponents
  // every player sees their own cards and nobody else's faces
  for (const p of pages) {
    await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(dealt, { timeout: 15_000 });
    const html = await p.locator('.g-surface').innerHTML();
    expect(html).not.toMatch(/aria-label="(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Jack|Queen|King|Ace) of/);
    await expect(p.locator('.seat .pc.back')).toHaveCount(backs);
  }
  await pages[0].screenshot({ path: 'test-results/shots/02-dealt-portrait.png' });
  await pages[2].screenshot({ path: 'test-results/shots/03-dealt-landscape.png' });

  // preflop: everyone calls/checks, then check down to showdown
  let acted = 0;
  for (let i = 0; i < 40; i++) { if (await pages[0].getByText('Showdown').first().isVisible().catch(() => false)) break; if (!(await actCurrentTurn(pages))) break; acted++; }
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
  await expect(pages[0].getByRole('dialog', { name: 'Table accounts' })).toBeVisible();
  await pages[0].screenshot({ path: 'test-results/shots/07-accounts.png' });
  const nets = await pages[0].locator('table tbody tr td:last-child').allTextContents();
  const sum = nets.reduce((a, s) => a + Number(s.replace(/[^\d-]/g, '')), 0);
  expect(sum).toBe(0);
});
