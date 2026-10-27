import { test, expect } from '@playwright/test';
for (const [width, height, layoutHeight, safe] of [[320,480], [1024,768], [1440,900], [768,1024], [390,700,844,1], [844,290,390,1], [390,560,844], [375,520,667], [667,280,375], [390,560], [375,520], [667,280], [844,290], [320,568], [375,667], [390,700], [430,932], [844,390], [667,375], [740,360], [932,430]]) {
  test(`board remains clear at ${width}x${height}${layoutHeight ? " with browser bars" : ""}${safe ? " and safe areas" : ""}`, async ({page}, info) => {
    await page.setViewportSize({width, height: layoutHeight ?? height});
    // Replace the HTML entry, preserving Vite module serving; no auth/backend calls are needed.
    await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html', body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>.dealer-token { transition: none !important; }</style></head><body><div id="root"></div></body></html>'}));
    await page.goto('/');
    await page.evaluate(({height, width, safe}) => {
      const style = document.documentElement.style;
      style.setProperty('--vh', `${height}px`);
      if (safe) {
        style.setProperty('--safe-t', width < height ? '47px' : '0px');
        style.setProperty('--safe-b', width < height ? '34px' : '21px');
        style.setProperty('--safe-l', width < height ? '0px' : '47px');
        style.setProperty('--safe-r', width < height ? '0px' : '47px');
      }
    }, {height, width, safe});
    for (const [count, holes] of [[2,2], [3,4], [4,4], [6,6], [7,6], [8,5], [9,4]]) {
      for (const [twice, result, acting] of [[false, false, false], [false, false, true], [true, false, true], [true, true, false]]) {
        await page.evaluate(async ({count, holes, twice, result, acting}) => {
          const refresh = await import(/* @vite-ignore */ '/@react-refresh');
          refresh.default.injectIntoGlobalHook(window);
          (window as any).$RefreshReg$ = () => {};
          (window as any).$RefreshSig$ = () => (type: unknown) => type;
          (window as any).__vite_plugin_react_preamble_installed__ = true;
          const module = await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx');
          module.renderLayout(count, holes, twice, twice, result, acting);
        }, {count,holes,twice,result,acting});
        await expect(page.locator('.seat')).toHaveCount(count-1);
        await expect(page.locator('.board')).toHaveCount(twice ? 2 : 1);
        // Let React and ResizeObserver place the token; this matrix checks settled geometry.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
        const problems = await page.evaluate((visibleHeight) => {
          const seats = [...document.querySelectorAll('.seat-core, .seat-cards')];
          const protectedItems = [...document.querySelectorAll('.board, .pot, .result-strip, .own-cards, .showdown-cards, .dock')];
          const errors: string[] = [];
          const intersects = (a: DOMRect,b: DOMRect) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;
          for (const s of seats) for (const b of protectedItems) if (intersects(s.getBoundingClientRect(),b.getBoundingClientRect())) errors.push(`${s.className} overlaps ${b.className}`);
          for (const seat of document.querySelectorAll('.seat-core, .seat-cards .pc')) for (const board of document.querySelectorAll('.board')) {
            const s = seat.getBoundingClientRect(), b = board.getBoundingClientRect();
            if (s.top < b.bottom && s.bottom > b.top) {
              const gap = s.right <= b.left ? b.left - s.right : s.left - b.right;
              if (gap < 6) errors.push(`seat leaves less than 6px beside the board: ${gap}`);
            }
          }

          for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) { if (seats[i].parentElement !== seats[j].parentElement && intersects(seats[i].getBoundingClientRect(), seats[j].getBoundingClientRect())) errors.push(`player panels overlap: ${seats[i].parentElement?.getAttribute('data-seat')} ${seats[i].className} ${JSON.stringify(seats[i].getBoundingClientRect())} / ${seats[j].parentElement?.getAttribute('data-seat')} ${seats[j].className} ${JSON.stringify(seats[j].getBoundingClientRect())}`); }
          for (const el of document.querySelectorAll('.seat, .board, .own-cards, .hero-meta, .showdown-cards, .dock')) { const r = el.getBoundingClientRect(); if(r.left < -1 || r.right > innerWidth+1) errors.push(`${el.className} overflows horizontally`); if (r.top < -1 || r.bottom > visibleHeight+1) errors.push(`${el.className} overflows vertically`); }
          const ownSeat = document.querySelector('.g-own-seat')?.getBoundingClientRect();
          if (ownSeat) for (const el of document.querySelectorAll('.board, .pot, .result-strip, .seat-core, .seat-cards')) {
            if (intersects(ownSeat, el.getBoundingClientRect())) errors.push(`own seat covers ${el.className}`);
          }
          const cards = document.querySelector('.own-cards')?.getBoundingClientRect();
          const stack = document.querySelector('.hero-meta')?.getBoundingClientRect();
          if (cards && stack && intersects(cards, stack)) errors.push('own cards cover stack');
          const dock = document.querySelector('.g-hero')?.getBoundingClientRect();
          if (dock && dock.bottom > visibleHeight + 1) errors.push('betting controls below viewport');
          const dealer = document.querySelector('.dealer-token')?.getBoundingClientRect();
          if (dealer) for (const el of document.querySelectorAll('.seat-stack, .seat-cards, .board, .pot, .result-strip')) {
            if (intersects(dealer, el.getBoundingClientRect())) errors.push(`dealer covers ${el.className}`);
          }
          return errors;
        }, height);
        expect(problems, `${count} players, ${holes} cards, twice=${twice}`).toEqual([]);
      }
    }
    await page.waitForTimeout(500); // finish the fixture's card flip before recording
    await page.screenshot({path: info.outputPath('table.png'), fullPage: true});
  });
}
