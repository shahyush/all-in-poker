import { test, expect, type Page } from '@playwright/test';
import { player } from './helpers.ts';

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close().catch(() => undefined); });

async function hostTable(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Host a table' }).click();
  await page.getByLabel('Table name').fill(name);
  await page.getByLabel('Your buy-in (units)').fill('2');
  await page.getByRole('button', { name: 'Review the table' }).click();
  await page.getByRole('button', { name: 'Create and open the room' }).click();
  return (await page.locator('.fine', { hasText: '/join/' }).first().textContent())!.trim();
}
async function joinVia(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: '2,000' }).click();
  await page.getByRole('button', { name: /Join table/ }).click();
  await expect(page.getByText(/starts the game/)).toBeVisible({ timeout: 30_000 }); // cold edge/realtime start can be slow
}
const openChat = (p: Page) => p.getByRole('button', { name: /Chat/ }).click();
const bodies = (p: Page) => p.locator('.chat-msg .chat-body');

// Separate players: messages send once, arrive in order, carry emoji; reactions toggle with live counts and who-reacted,
// and all of it survives a reconnect. (The on-screen keyboard overlay itself can't be simulated headless; we assert the
// compose input and Send stay on-screen when focused, which is the behaviour interactive-widget=resizes-content gives.)
test('table chat and reactions across two separate player sessions', async ({ browser }) => {
  test.setTimeout(180_000);
  const h = await player(browser, 'Tanisha');
  const g = await player(browser, 'Aayush');
  const url = await hostTable(h.page, 'Chatters');
  await joinVia(g.page, url);
  await h.page.getByRole('button', { name: 'Start the game' }).click();
  for (const p of [h.page, g.page]) await expect(p.locator('.game')).toBeVisible();

  await openChat(h.page);
  await openChat(g.page);

  // host sends three messages (one with an emoji), confirming each lands before the next so order is deterministic
  const msgs = ['first up ♠️', 'second here', 'nice pot 🎉'];
  for (let i = 0; i < msgs.length; i++) {
    await h.page.getByLabel('Message').fill(msgs[i]);
    await h.page.getByRole('button', { name: 'Send' }).click();
    await expect(bodies(h.page)).toHaveCount(i + 1, { timeout: 20_000 });
  }
  // the guest sees exactly three, in order, no duplicates
  await expect(bodies(g.page)).toHaveCount(3, { timeout: 20_000 });
  await expect(bodies(g.page).nth(0)).toContainText('first up ♠️');
  await expect(bodies(g.page).nth(2)).toContainText('nice pot 🎉');
  await expect(bodies(h.page)).toHaveCount(3); // sender sees each once, not echoed twice

  // the guest inserts an emoji from the picker and sends; the host receives it in order as the fourth message
  await g.page.getByRole('button', { name: 'Add emoji' }).click();
  await g.page.getByRole('group', { name: 'Insert an emoji' }).getByRole('button', { name: '🔥' }).click();
  await g.page.getByLabel('Message').fill((await g.page.getByLabel('Message').inputValue()) + ' lets go');
  await g.page.getByRole('button', { name: 'Send' }).click();
  await expect(bodies(h.page)).toHaveCount(4, { timeout: 20_000 });
  await expect(bodies(h.page).nth(3)).toContainText('🔥');

  // reactions: the guest thumbs-up the host's last message; the host sees the chip, the count, and who reacted
  const gLast = g.page.locator('.chat-msg').nth(2);
  await gLast.getByRole('button', { name: 'Add a reaction' }).click();
  await gLast.getByRole('group', { name: 'Choose a reaction' }).getByRole('button', { name: '👍' }).click();
  const hLast = h.page.locator('.chat-msg').nth(2);
  await expect(hLast.locator('.react-chip')).toBeVisible({ timeout: 20_000 });
  await expect(hLast.locator('.react-chip .react-n')).toHaveText('1');
  await expect(hLast.locator('.react-who')).toContainText('Aayush');

  // the host adds the same reaction -> count 2 on both screens
  await hLast.getByRole('button', { name: /👍/ }).click();
  await expect(hLast.locator('.react-chip .react-n')).toHaveText('2', { timeout: 10_000 });
  await expect(gLast.locator('.react-chip .react-n')).toHaveText('2', { timeout: 20_000 });

  // the guest removes their reaction (its chip shows pressed for them) -> back to 1 on both
  await gLast.getByRole('button', { name: /👍/ }).click();
  await expect(gLast.locator('.react-chip .react-n')).toHaveText('1', { timeout: 10_000 });
  await expect(hLast.locator('.react-chip .react-n')).toHaveText('1', { timeout: 20_000 });

  // reconnect: the guest reloads; chat history, order and reactions all come back without a manual refetch
  await g.page.reload();
  await openChat(g.page);
  await expect(bodies(g.page)).toHaveCount(4, { timeout: 30_000 });
  await expect(bodies(g.page).nth(0)).toContainText('first up ♠️');
  await expect(g.page.locator('.chat-msg').nth(2).locator('.react-chip .react-n')).toHaveText('1', { timeout: 20_000 });

  // keyboard room: focusing the input must keep it and Send within the viewport (not covered by chrome)
  const input = g.page.getByLabel('Message');
  await input.focus();
  const vh = g.page.viewportSize()!.height;
  const ib = (await input.boundingBox())!;
  const sb = (await g.page.getByRole('button', { name: 'Send' }).boundingBox())!;
  expect(ib.y + ib.height).toBeLessThanOrEqual(vh);
  expect(sb.y + sb.height).toBeLessThanOrEqual(vh);
});
