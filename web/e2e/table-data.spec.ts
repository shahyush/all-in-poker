import {test, expect} from '@playwright/test';
test('long chats retain the newest messages and reactions in display order', async ({page}) => {
  let count = 205;
  await page.route('http://127.0.0.1:8787/**', async route => {
    const headers = {'access-control-allow-origin':'*', 'access-control-allow-headers':'content-type,authorization'};
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    const url=route.request().url();
    let body: unknown=[];
    if(url.endsWith('/dev/signin')) body={token:'dev:review',authUid:'review'};
    else if(url.endsWith('/dev/now')) body={now:Date.now()};
    else if(url.endsWith('/cmd')) body={ok:true,result:{player:{id:'review',name:'Reviewer'}}};
    else if(url.endsWith('/dev/query')) {
      const q=route.request().postDataJSON();
      if(q.table==='tables') body=[{id:'review',version:1,state:{seats:[],hand:null}}];
      else if(q.table==='chat_messages'||q.table==='chat_reactions') {
        const rows=Array.from({length:q.table==='chat_messages'?count:1001},(_,i)=>({id:i+1}));
        if(q.asc===false) rows.reverse();
        body=rows.slice(0,q.limit);
      }
    }
    await route.fulfill({json:body,headers});
  });
  await page.route('http://127.0.0.1:5173/',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
  await page.goto('/');
  await page.evaluate(async()=>{
    const refresh=await import(/* @vite-ignore */ '/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{}; (window as any).$RefreshSig$=()=>(type:unknown)=>type;
    (window as any).__vite_plugin_react_preamble_installed__=true;
    const fixture=await import(/* @vite-ignore */ '/e2e/table-data-fixture.tsx'); fixture.renderProbe();
  });
  await expect(page.locator('#messages')).toHaveText(JSON.stringify(Array.from({length:200},(_,i)=>i+6)));
  await expect(page.locator('#reactions')).toContainText('1001');
  count=206;
  await expect(page.locator('#messages')).toHaveText(JSON.stringify(Array.from({length:200},(_,i)=>i+7)));
});
