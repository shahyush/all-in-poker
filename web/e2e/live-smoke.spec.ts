import { test, expect } from '@playwright/test';

// Runs only against the deployed site (E2E_LIVE=1 E2E_BASE=https://...). No group password needed: a fresh device must
// get an anonymous session, the API must validate its token (the entry screen appears only after `me` succeeded), and
// admission must reach the server (a wrong password is answered by the API, not by a client-side session failure).
// Then a reload must keep the same anonymous identity instead of minting a new one.
test('live: fresh device → session → API validates token → admission answers → identity survives reload', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const nickname = page.getByLabel('Your nickname');
  await expect(nickname).toBeVisible({ timeout: 45_000 });
  const uid1 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('allin.auth') ?? 'null')?.user?.id ?? null; } catch { return null; } });
  expect(uid1, 'anonymous session stored').toBeTruthy();
  await nickname.fill('Smoke ' + browserName);
  await page.getByLabel('Group password').fill('not-the-password-' + Date.now());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText(/group password is not right/i, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel('Your nickname')).toBeVisible({ timeout: 45_000 });
  const uid2 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('allin.auth') ?? 'null')?.user?.id ?? null; } catch { return null; } });
  expect(uid2, 'same anonymous identity after reload').toBe(uid1);
  expect(errors, 'no uncaught page errors').toEqual([]);
});
