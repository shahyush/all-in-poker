import {test,expect} from '@playwright/test';

for(const [width,height] of [[320,568],[390,844],[667,375]]) test(`host flow uses chip amounts, clear seats and recoverable errors at ${width}x${height}`,async({page},info)=>{
  await page.setViewportSize({width,height});
  let submitted:any=null;
  let signins=0;
  await page.route('http://127.0.0.1:8787/**', async route=>{
    const url=route.request().url();
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization'};
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    let body:any;
    if(url.endsWith('/dev/signin')) { signins++; await new Promise(resolve=>setTimeout(resolve,100)); body={token:'dev:review',authUid:'review'}; }
    else if(url.endsWith('/dev/now')) body={now:Date.now()};
    else if(url.endsWith('/dev/query')) body=[];
    else {
      const command=route.request().postDataJSON();
      if(command.type==='me') body={ok:true,result:{player:{id:'review',name:'teens',isOwner:true}}};
      else {submitted=command;body={ok:false,error:{message:'Connection lost. Please try again.'}};}
    }
    await route.fulfill({json:body,headers});
  });
  await page.goto('/create');
  await expect(page.getByRole('heading',{name:'Host a table'})).toBeVisible();
  expect(signins).toBe(1);
  await page.getByLabel('Table name').fill('Sunday Afternoon');
  await expect(page.getByLabel('Your buy-in',{exact:true})).toHaveValue('3000');
  const sizes=await page.getByRole('group',{name:'Number of seats'}).locator('button').evaluateAll(els=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
  expect(sizes).toHaveLength(8);
  expect(sizes.every(x=>x.w>=44&&x.h>=44)).toBe(true);
  await page.screenshot({path:info.outputPath('host-form.png'),fullPage:true});
  await page.getByRole('button',{name:'9',exact:true}).click();
  await expect(page.getByText('At nine players: Hold’em or Omaha 4.')).toBeVisible();
  await page.getByRole('button',{name:'More table rules'}).click();
  await page.getByLabel('Buy-in unit',{exact:true}).fill('2000');
  await expect(page.getByRole('button',{name:'Review the table'})).toBeDisabled();
  await page.getByRole('group',{name:'Quick buy-in'}).getByRole('button',{name:'4,000',exact:true}).click();
  await page.getByRole('button',{name:'Review the table'}).click();
  await expect(page.getByText('4,000 chips',{exact:true})).toBeVisible();
  await expect(page.getByText(/One game for a full orbit/)).toBeVisible();
  await page.getByRole('button',{name:'Create and open the room'}).click();
  await expect(page.getByRole('alert')).toContainText('Connection lost');
  expect(submitted.payload.buyIn).toBe('4000');
  await expect(page.getByRole('button',{name:'Create and open the room'})).toBeEnabled();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Your buy-in',{exact:true})).toHaveValue('4000');
  await page.getByRole('button',{name:'Tournament',exact:true}).click();
  await page.screenshot({path:info.outputPath('tournament-form.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
