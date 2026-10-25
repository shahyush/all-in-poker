import { test, expect, type Page } from '@playwright/test';
import { player, closePlayers } from './helpers.ts';

test.afterEach(async ({browser}, info) => closePlayers(browser, info.outputDir));

async function clearBoard(page: Page) {
  const errors = await page.evaluate(() => {
    const errors: string[] = [];
    const protectedEls = [...document.querySelectorAll('.board, .pot, .result-strip, .own-cards, .dock')];
    const overlap = (a: DOMRect,b: DOMRect) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;
    for (const seat of document.querySelectorAll('.seat-core, .seat-cards')) for (const el of protectedEls)
      if(overlap(seat.getBoundingClientRect(),el.getBoundingClientRect())) errors.push(`${seat.className} covers ${el.className}`);
    return errors;
  });
  expect(errors).toEqual([]);
}
async function actor(pages: Page[]) {
  await expect.poll(async () => (await Promise.all(pages.map(p => p.locator('.turn-line').innerText()))).some(s => s.startsWith('Your turn')), {timeout: 35000}).toBe(true);
  const texts = await Promise.all(pages.map(p => p.locator('.turn-line').innerText()));
  return pages[texts.findIndex(s => s.startsWith('Your turn'))];
}
async function checkCall(pages: Page[]) {
  const p = await actor(pages);
  const button = p.getByRole('group', {name: 'Actions'}).getByRole('button', {name: /^(Check|Call)/});
  await expect(button).toBeEnabled();
  await button.click();
  await expect(p.locator('.turn-line')).not.toContainText('Your turn');
}

for (const variant of ["Hold'em", 'Omaha 4']) test(`nine separate players: ${variant}, clear board, chat and balanced accounts`, async ({browser}, info) => {
  test.setTimeout(300000);
  const h = await player(browser, 'Nine Host', {record: true});
  const pages = [h.page];
  await h.page.getByRole('button', {name:'Host a table'}).click();
  await h.page.getByLabel('Table name').fill(`Nine seats ${variant}`);
  await h.page.getByRole('button', {name:'9', exact:true}).click();
  await h.page.getByLabel('Your buy-in (units)').fill('2');
  await h.page.getByRole('button', {name:'Review the table'}).click();
  await h.page.getByRole('button', {name:'Create and open the room'}).click();
  const invite = (await h.page.locator('.fine', {hasText:'/join/'}).first().textContent())!.trim();
  for (let i=1; i<9; i++) {
    const g = await player(browser, `Nine Player ${i}`);
    pages.push(g.page);
    await g.page.goto(invite);
    await g.page.getByRole('button',{name:'2,000',exact:true}).click();
    await g.page.getByRole('button',{name:/Join table/}).click();
    await expect(g.page.getByText(/starts the game/)).toBeVisible();
  }
  await h.page.getByRole('button',{name:'Start the game'}).click();
  const chooser = await Promise.any(pages.map(async p => {await p.locator('.choice-grid').waitFor({state:'visible',timeout:12000});return p;}));
  await expect(chooser.getByRole('button',{name:/Omaha 5/})).toBeDisabled();
  await expect(chooser.getByRole('button',{name:/Omaha 6/})).toBeDisabled();
  await chooser.getByRole('button',{name: variant === 'Omaha 4' ? /Omaha 4/ : /Hold'em/}).click();
  const holes = variant === 'Omaha 4' ? 4 : 2;
  for (const p of pages) {
    await expect(p.locator('.g-stakes')).toContainText(variant);
    await expect(p.locator('.seat')).toHaveCount(8);
    await expect(p.locator('.own-cards .pc:not(.back)')).toHaveCount(holes,{timeout:25000});
    await expect(p.locator('.seat .pc.back')).toHaveCount(holes*8);
    await clearBoard(p);
  }
  await h.page.screenshot({path:info.outputPath('01-nine-dealt.png')});
  for(let i=0;i<9;i++) await checkCall(pages);
  await expect(h.page.locator('.board .pc:not(.slot)')).toHaveCount(3);
  await h.page.waitForTimeout(1200); // capture completed burn + flop presentation
  await clearBoard(h.page);
  await h.page.screenshot({path:info.outputPath('02-nine-flop-portrait.png')});
  await h.page.setViewportSize({width:390,height:700});
  await clearBoard(h.page);
  expect(await h.page.locator('.dock').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await h.page.screenshot({path:info.outputPath('02b-nine-flop-short-screen.png')});
  await h.page.setViewportSize({width:844,height:390});
  await clearBoard(h.page);
  await h.page.screenshot({path:info.outputPath('03-nine-flop-landscape.png')});
  await h.page.setViewportSize({width:390,height:844});
  if(variant === 'Omaha 4') {
    const p = await actor(pages);
    await p.getByRole('button',{name:'Run twice',exact:true}).click();
    await Promise.all(pages.filter(q=>q!==p).map(async q=>{
      const agree=q.getByRole('button',{name:'Agree',exact:true});
      await expect(agree).toBeVisible();
      await agree.click();
    }));
    await expect(h.page.locator('.board')).toHaveCount(2);
  } else {
    for(let i=0;i<27;i++) await checkCall(pages);
  }
  await expect(h.page.locator('.result-strip')).toBeVisible({timeout:20000});
  await expect(h.page.getByRole('group', {name:'Actions'})).toHaveCount(0);
  await h.page.waitForTimeout(1000);
  await clearBoard(h.page);
  await h.page.screenshot({path:info.outputPath('04-nine-showdown.png')});
  // Local sessions exercise the real message command and propagation while the next hand advances.
  await Promise.all(pages.map(p=>p.getByRole('button',{name:/^Chat/}).click()));
  const message=`Nine-seat ${variant} message ♠️`;
  await h.page.getByLabel('Message').fill(message);
  await h.page.getByRole('button',{name:'Send',exact:true}).click();
  for(const p of pages) await expect(p.locator('.chat-body', {hasText:message})).toHaveCount(1);
  await h.page.screenshot({path:info.outputPath('05-nine-chat.png')});
  await Promise.all(pages.map(p=>p.keyboard.press('Escape')));
  await h.page.getByRole('button',{name:'Table menu'}).click();
  await h.page.getByRole('button',{name:'Accounts',exact:true}).click();
  await expect(h.page.getByRole('dialog',{name:'Table accounts'})).toBeVisible();
  await h.page.screenshot({path:info.outputPath('06-nine-accounts.png')});
  // Exact table accounting is exposed in the account rows, including each still-seated player's stack.
  const nets=await h.page.locator('table tbody tr td:last-child').allTextContents();
  expect(nets).toHaveLength(9);
  expect(nets.reduce((a,s)=>a+Number(s.replace(/[^\d-]/g,'')),0)).toBe(0);
});
