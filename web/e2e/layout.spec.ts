import { test, expect } from '@playwright/test';
for (const [width, height] of [[320,568], [375,667], [390,700], [430,932], [844,390]]) {
  test(`board remains clear at ${width}x${height}`, async ({page}, info) => {
    await page.setViewportSize({width, height});
    // Replace the HTML entry, preserving Vite module serving; no auth/backend calls are needed.
    await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html', body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>.dealer-token { transition: none !important; }</style></head><body><div id="root"></div></body></html>'}));
    await page.goto('/');
    for (const [count, holes] of [[2,2], [3,4], [4,4], [6,6], [7,6], [8,5], [9,4]]) {
      for (const [twice, result] of [[false, false], [true, false], [true, true]]) {
        await page.evaluate(async ({count, holes, twice, result}) => {
          const refresh = await import(/* @vite-ignore */ '/@react-refresh');
          refresh.default.injectIntoGlobalHook(window);
          (window as any).$RefreshReg$ = () => {};
          (window as any).$RefreshSig$ = () => (type: unknown) => type;
          (window as any).__vite_plugin_react_preamble_installed__ = true;
          const module = await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx');
          module.renderLayout(count, holes, twice, twice, result);
        }, {count,holes,twice,result});
        await expect(page.locator('.seat')).toHaveCount(count-1);
        await expect(page.locator('.board')).toHaveCount(twice ? 2 : 1);
        // Let React and ResizeObserver place the token; this matrix checks settled geometry.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
        const problems = await page.evaluate(() => {
          const seats = [...document.querySelectorAll('.seat-core, .seat-cards')];
          const protectedItems = [...document.querySelectorAll('.board, .pot, .result-strip, .own-cards, .dock')];
          const errors: string[] = [];
          const intersects = (a: DOMRect,b: DOMRect) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;
          for (const s of seats) for (const b of protectedItems) if (intersects(s.getBoundingClientRect(),b.getBoundingClientRect())) errors.push(`${s.className} overlaps ${b.className}`);
          for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) { if (seats[i].parentElement !== seats[j].parentElement && intersects(seats[i].getBoundingClientRect(), seats[j].getBoundingClientRect())) errors.push('player panels overlap'); }
          for (const el of document.querySelectorAll('.seat, .board, .own-cards, .hero-meta, .dock')) { const r = el.getBoundingClientRect(); if(r.left < -1 || r.right > innerWidth+1) errors.push(`${el.className} overflows horizontally`); }
          const dock = document.querySelector('.dock')?.getBoundingClientRect();
          if (dock && dock.bottom > innerHeight + 1) errors.push('betting controls below viewport');
          const dealer = document.querySelector('.dealer-token')?.getBoundingClientRect();
          if (dealer) for (const el of document.querySelectorAll('.seat-stack, .seat-cards, .board, .pot, .result-strip')) {
            if (intersects(dealer, el.getBoundingClientRect())) errors.push(`dealer covers ${el.className}`);
          }
          return errors;
        });
        expect(problems, `${count} players, ${holes} cards, twice=${twice}`).toEqual([]);
      }
    }
    await page.waitForTimeout(500); // finish the fixture's card flip before recording
    await page.screenshot({path: info.outputPath('table.png'), fullPage: true});
  });
}
