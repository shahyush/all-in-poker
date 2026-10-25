import {test,expect} from '@playwright/test';

test('cards appear only as each deal arrives; cancellation restores all slots',async({page})=>{
  await page.route('http://127.0.0.1:5173/', route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {runDealAnimation}=await import(/* @vite-ignore */ '/src/table/animator.ts');
    document.body.innerHTML='<div id="table"><span data-deck style="display:block;width:30px;height:40px"></span>'+[0,1,2].map(seat=>`<div data-seat="${seat}">${[0,1].map(slot=>`<span data-slot="${slot}" style="display:inline-block;width:30px;height:40px">card</span>`).join('')}</div>`).join('')+'</div>';
    const root=document.getElementById('table')!;
    let done=0;
    const cancel=runDealAnimation(root,{type:'deal',seq:1,handId:'h',at:0,order:[0,1,2],button:0,holeCount:2},'h',false,()=>done++);
    const slots=[...root.querySelectorAll<HTMLElement>('[data-slot]')];
    const hidden=slots.every(slot=>slot.style.visibility==='hidden');
    const animations=document.getAnimations();
    animations.forEach(a=>a.pause());
    await Promise.all(animations.map(a => a.ready));
    await new Promise<void>(resolve => {
      animations[0].addEventListener('finish', () => resolve(), {once:true});
      animations[0].finish();
    });
    const arrived=slots.filter(slot=>slot.style.visibility!=='hidden').length;
    const destination=slots.find(slot=>slot.style.visibility!=='hidden')?.parentElement?.getAttribute('data-seat');
    cancel();
    const restored=slots.every(slot=>slot.style.visibility!=='hidden');
    const flyers=document.querySelectorAll('.fly').length;
    const reduceCancel=runDealAnimation(root,{type:'deal',seq:2,handId:'h',at:0,order:[0,1,2],button:0,holeCount:2},'h',true,()=>done++);
    await new Promise(resolve=>setTimeout(resolve,10));
    const reducedVisible=slots.every(slot=>slot.style.visibility!=='hidden');
    reduceCancel();
    return {hidden,arrived,destination,restored,flyers,reducedVisible,done};
  });
  expect(result).toEqual({hidden:true,arrived:1,destination:'1',restored:true,flyers:0,reducedVisible:true,done:1});
});

test('showdown presents large winning cards, both board winners and a visible reduced-motion-safe celebration', async ({page}) => {
  await page.setViewportSize({width:390,height:700});
  await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}));
  await page.goto('/');
  await page.evaluate(async () => {
    const refresh = await import(/* @vite-ignore */ '/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{}; (window as any).$RefreshSig$=()=>(type:unknown)=>type;
    (window as any).__vite_plugin_react_preamble_installed__=true;
    const fixture=await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx');
    fixture.renderLayout(9,4,true,true,true);
  });
  const result=page.getByRole('region',{name:'Winning hand'});
  await expect(result.locator('.pc')).toHaveCount(5);
  await expect(result.locator('.showdown-caption')).toContainText('Best five');
  await expect(result.locator('.showdown-card-source > span').filter({hasText:'Hole'})).toHaveCount(2);
  await expect(result.locator('.showdown-hand-name')).toContainText('Two pair');
  expect(await result.locator('.pc').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(60);
  await expect(page.locator('.seat.is-winner .winner-sparks')).toBeVisible();
  expect(await page.locator('.seat.is-winner .winner-sparks').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(18);
  await result.getByRole('button',{name:'B · You'}).click();
  await expect(result.locator('.showdown-hand-name')).toHaveText('Flush, Ace high');
  await expect(result.locator('.pc')).toHaveCount(5);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(result.locator('.winner-sparks')).toBeHidden();
  await expect(result.locator('.pc')).toHaveCount(5);
});

test('folded own cards stay readable and last-player-standing exposes both run choices', async ({page}) => {
  await page.setViewportSize({width:390,height:700});
  await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}));
  await page.goto('/');
  await page.evaluate(async () => {
    const refresh=await import(/* @vite-ignore */ '/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{};(window as any).$RefreshSig$=()=>(type:unknown)=>type;(window as any).__vite_plugin_react_preamble_installed__=true;
    (await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx')).renderLayout(5,4,false,false,false,false,true,false);
  });
  await expect(page.locator('.own-cards .pc:not(.back)')).toHaveCount(4);
  await expect(page.locator('.hero-meta')).toContainText('Folded');
  await expect(page.locator('.seat-cards .pc:not(.back)')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Fold',exact:true})).toBeDisabled();
  await page.evaluate(async()=>{(await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx')).renderLayout(5,4,false,false,false,true,false,false);});
  await expect(page.getByRole('button',{name:'Run out now, end betting if everyone agrees',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Two boards · keep betting',exact:true})).toBeEnabled();
});

test('folded player can inspect private cards during showdown', async ({page}) => {
  await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}));
  await page.goto('/');
  await page.evaluate(async () => {
    const refresh=await import(/* @vite-ignore */ '/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{};(window as any).$RefreshSig$=()=>(type:unknown)=>type;(window as any).__vite_plugin_react_preamble_installed__=true;
    (await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx')).renderLayout(5,4,false,false,true,false,true,false);
  });
  const result=page.getByRole('region',{name:'Winning hand'});
  await expect(result.locator('.pc')).toHaveCount(5);
  await result.getByRole('button',{name:'My folded hand'}).click();
  await expect(result.locator('.pc')).toHaveCount(4);
  await expect(result.locator('.showdown-hand-name')).toHaveText('Only visible to you');
 });

for(const [width,height] of [[390,700],[320,568],[844,390]]) test(`nine-player spectator view keeps the board clear at ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});
  await page.route('http://127.0.0.1:5173/',r=>r.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
  await page.goto('/');
  await page.evaluate(async()=>{
    const refresh=await import(/* @vite-ignore */ '/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{};(window as any).$RefreshSig$=()=>(t:unknown)=>t;(window as any).__vite_plugin_react_preamble_installed__=true;
    const fixture=await import(/* @vite-ignore */ '/e2e/layout-fixture.tsx');fixture.renderLayout(9,4,false,false,false,false,false,true,true);
  });
  await expect(page.locator('.seat')).toHaveCount(9);
  await expect(page.locator('.spectator-dock')).toBeVisible();
  const clashes=await page.evaluate(()=>{
    const board=document.querySelector('.board')!.getBoundingClientRect();
    return [...document.querySelectorAll('.seat-core,.seat-cards')].filter(el=>{const b=el.getBoundingClientRect();return b.left<board.right&&b.right>board.left&&b.top<board.bottom&&b.bottom>board.top;}).length;
  });
  expect(clashes).toBe(0);
  await expect(page.locator('.choice-grid')).toHaveCount(0);
});
