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

/** Hosted runs record every player's screen. Playwright's `video` option only covers its own context fixture, and these
 *  tests open a context per player, so recording has to be requested here — otherwise no recording exists at all. */
export function contextOptions(opts: { landscape?: boolean; reducedMotion?: boolean } = {}) {
  const viewport = opts.landscape ? { width: 844, height: 390 } : { width: 390, height: 844 };
  return { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: (opts.reducedMotion ? 'reduce' : 'no-preference') as 'reduce' | 'no-preference', ...(HOSTED ? { recordVideo: { dir: 'test-results/videos', size: viewport } } : {}) };
}
const playerNames = new WeakMap<Page, string>();
/** Close every context, first saving each recording as <player>.webm in the test's output directory (hosted runs). */
export async function closePlayers(browser: Browser, outputDir: string): Promise<void> {
  let k = 0;
  for (const c of browser.contexts()) {
    for (const pg of c.pages()) {
      const v = pg.video(); if (!v) continue;
      const name = (playerNames.get(pg) ?? `page-${++k}`).replace(/[^\w.-]+/g, '_');
      await c.close().catch(() => undefined);           // finalises the file
      await v.saveAs(`${outputDir}/${name}.webm`).catch(() => undefined);
      await v.delete().catch(() => undefined);
    }
    await c.close().catch(() => undefined);
  }
}

export async function player(browser: Browser, name: string, opts: { landscape?: boolean; reducedMotion?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(contextOptions(opts));
  const page = await ctx.newPage();
  playerNames.set(page, name);
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

/** Robustly drive one betting action on whichever page's turn it is. Waits for the "Your turn" cue (not just an enabled
 *  button, which can briefly show on a stale view), acts, then waits for the cue to clear so we never double-act or act on
 *  a turn that already moved. Returns true if it acted, false if the hand has reached a result/showdown. */
export async function actCurrentTurn(pages: Page[], opts: { fold?: boolean } = {}): Promise<boolean> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await p.getByText('Pot detail').isVisible().catch(() => false)) return false;
      if (await p.getByText('Showdown').first().isVisible().catch(() => false)) return false;
    }
    let actor: Page | null = null;
    for (const p of pages) { if (await p.getByText(/^Your turn/).isVisible().catch(() => false)) { actor = p; break; } }
    if (!actor) { await pages[0].waitForTimeout(250); continue; }
    const dock = actor.getByRole('group', { name: 'Actions' });
    const call = dock.getByRole('button', { name: /^Call/ });
    const btn = opts.fold ? dock.getByRole('button', { name: 'Fold' }) : (await call.isEnabled({ timeout: 500 }).catch(() => false)) ? call : dock.getByRole('button', { name: 'Check' });
    if (!(await btn.isEnabled({ timeout: 2000 }).catch(() => false))) { await actor.waitForTimeout(200); continue; }
    await btn.click().catch(() => undefined);
    // confirm it registered: the cue clears (turn advanced) within a few seconds
    await actor.getByText(/^Your turn/).waitFor({ state: 'hidden', timeout: 4000 }).catch(() => undefined);
    return true;
  }
  return false;
}
