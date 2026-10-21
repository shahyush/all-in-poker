import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Hosted mode: E2E_HOSTED=1 E2E_BASE=https://all-in-poker.aayush9shah.workers.dev E2E_GROUP_PASSWORD=<entered in the environment, never in chat> */
export const HOSTED = !!process.env.E2E_HOSTED;
export const PASSWORD = process.env.E2E_GROUP_PASSWORD ?? 'friday-night';
export const API = process.env.E2E_API ?? 'http://127.0.0.1:8787';

export function attachDiagnostics(page: Page, tag: string): void {
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${tag}] console.error`, m.text()); });
  page.on('requestfailed', (r) => { const u = r.url(); if (u.includes('/functions/') || u.includes('/rest/') || u.includes('/auth/')) console.log(`[${tag}] requestfailed`, r.method(), u.split('?')[0], r.failure()?.errorText ?? ''); });
  page.on('response', (r) => { const u = r.url(); if ((u.includes('/functions/v1/api/') || u.includes('/auth/v1/')) && r.status() >= 400) console.log(`[${tag}] http ${r.status()}`, r.request().method(), u.split('?')[0]); });
}

/** Wait for a locator and, on timeout, print the page's visible text so the CI log shows what the user would see. */
export async function expectVisibleOrDump(page: Page, locator: ReturnType<Page['getByRole']>, label: string, timeout = 30_000): Promise<void> {
  try { await expect(locator).toBeVisible({ timeout }); }
  catch (e) {
    const text = await page.locator('body').innerText().catch(() => '(no body)');
    console.log(`[dump:${label}] current URL ${page.url()}`);
    console.log(`[dump:${label}] visible text:\n${text}`);
    throw e;
  }
}

export async function player(browser: Browser, name: string, opts: { landscape?: boolean; reducedMotion?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: opts.landscape ? { width: 844, height: 390 } : { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  attachDiagnostics(page, name);
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
