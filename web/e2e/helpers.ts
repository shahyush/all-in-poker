import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Hosted mode: E2E_HOSTED=1 E2E_BASE=https://all-in-poker.pages.dev E2E_GROUP_PASSWORD=<entered in the environment, never in chat> */
export const HOSTED = !!process.env.E2E_HOSTED;
export const PASSWORD = process.env.E2E_GROUP_PASSWORD ?? 'friday-night';
export const API = process.env.E2E_API ?? 'http://127.0.0.1:8787';

export async function player(browser: Browser, name: string, opts: { landscape?: boolean; reducedMotion?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: opts.landscape ? { width: 844, height: 390 } : { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto('/');
  await page.getByLabel('Your nickname').fill(name);
  await page.getByLabel('Group password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Shall we deal you in?')).toBeVisible();
  return { ctx, page };
}

export async function shiftClock(ms: number): Promise<void> {
  // Local only: rewinds stored deadlines so the server treats time as elapsed (same helper the API tests use).
  const r = await fetch(API + '/dev/shift', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms }) });
  if (!r.ok) throw new Error('shift failed');
}

export async function actWhenMyTurn(page: Page, action: 'Fold' | 'Check' | 'Call' | 'Raise', raiseTo?: number): Promise<void> {
  const dock = page.getByRole('group', { name: 'Actions' });
  const btn = action === 'Call' ? dock.getByRole('button', { name: /^Call/ }) : action === 'Check' ? dock.getByRole('button', { name: 'Check' }) : action === 'Fold' ? dock.getByRole('button', { name: 'Fold' }) : dock.getByRole('button', { name: /^(Bet|Raise)$/ });
  await expect(btn).toBeEnabled({ timeout: 40_000 });
  await btn.click();
  if (action === 'Raise') {
    const input = page.getByLabel('Amount');
    if (raiseTo) await input.fill(String(raiseTo));
    await page.getByRole('button', { name: /^(Bet|Raise to) / }).click();
  }
}
