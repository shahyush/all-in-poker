import {test, expect} from '@playwright/test';
test('a stalled read times out and the next request recovers', async ({page}) => {
  await page.route('http://127.0.0.1:5173/', route => route.fulfill({contentType:'text/html', body:'<html></html>'}));
  await page.route('**/stalled-read', () => {});
  await page.route('**/healthy-read', route => route.fulfill({json:{version:2}}));
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const {boundedFetch} = await import(/* @vite-ignore */ '/src/transport/fetch.ts');
    (window as any).readResult = boundedFetch('/stalled-read').then(() => 'unexpected success', (e:Error) => e.name);
  });
  await page.clock.fastForward(12001);
  expect(await page.evaluate(() => (window as any).readResult)).toBe('TimeoutError');
  expect(await page.evaluate(async () => {
    const {boundedFetch} = await import(/* @vite-ignore */ '/src/transport/fetch.ts');
    return (await (await boundedFetch('/healthy-read')).json()).version;
  })).toBe(2);
  expect(await page.evaluate(async () => {
    const {boundedFetch} = await import(/* @vite-ignore */ '/src/transport/fetch.ts');
    const c = new AbortController(); c.abort();
    return boundedFetch('/healthy-read', {signal:c.signal}).then(() => 'unexpected success', (e:Error) => e.name);
  })).toBe('AbortError');
});
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

test('refresh storms serialize reads, retain the trailing update, and recover after failure', async ({page}) => {
  await page.route('http://127.0.0.1:5173/', r => r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {coalescedRefresh} = await import(/* @vite-ignore */ '/src/state/refresh.ts');
    let reads=0, active=0, max=0, release: (()=>void)|undefined;
    const refresh=coalescedRefresh(async()=>{reads++; active++; max=Math.max(max,active); if(reads===1)await new Promise<void>(r=>{release=r}); active--;});
    const first=refresh(); await Promise.resolve();
    const burst=Array.from({length:50},()=>refresh());
    release!(); await Promise.all([first,...burst]);
    let attempts=0;
    const recovery=coalescedRefresh(async()=>{if(++attempts===1)throw Error('offline');});
    await recovery().catch(()=>{}); await recovery();
    return {reads,max,attempts};
  });
  expect(result).toEqual({reads:2,max:1,attempts:2});
});

test('a failed identity restore preserves tokens and never creates a different player', async ({page}) => {
  await page.route('http://127.0.0.1:5173/', r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {SupabaseTransport}=await import(/* @vite-ignore */ '/src/transport/supabase.ts');
    localStorage.setItem('allin.auth.mirror',JSON.stringify({access_token:'saved-access',refresh_token:'saved-refresh'}));
    const t=new SupabaseTransport('https://example.supabase.co','test-public-key');
    let anonymous=0;
    t.client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}}),setSession:async()=>({data:{session:null},error:new Error('temporarily offline')}),signInAnonymously:async()=>{anonymous++;return {data:{user:{id:'wrong-player'}}};}},realtime:{setAuth:async()=>{}}} as any;
    const error=await t.ensureSession().then(()=>null,(e:Error)=>e.message);
    return {anonymous,error,retained:localStorage.getItem('allin.auth.mirror')!==null};
  });
  expect(result.anonymous).toBe(0); expect(result.retained).toBe(true); expect(result.error).toContain('reconnect your player');
});

test('game refreshes do not wait for chat or refetch the same private hand', async ({page})=>{
  const counts:Record<string,number>={};
  await page.route('http://127.0.0.1:8787/**',async route=>{
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const url=route.request().url(); let body:unknown=[];
    if(url.endsWith('/dev/signin'))body={token:'dev:review',authUid:'review'};
    else if(url.endsWith('/dev/now'))body={now:Date.now()};
    else if(url.endsWith('/cmd'))body={ok:true,result:{player:{id:'review',name:'Reviewer'}}};
    else if(url.endsWith('/dev/query')){
      const q=route.request().postDataJSON(); counts[q.table]=(counts[q.table]??0)+1;
      if(q.table==='tables') {await new Promise(r=>setTimeout(r,50));body=[{id:'review',version:1,status:'running',state:{status:'running',seats:[],hand:{id:'hand-1',phase:'betting',actor:0}}}];}
      if(q.table==='hole_cards')body=[{hand_id:'hand-1',cards:[1,2]}];
    }
    await route.fulfill({json:body,headers});
  });
  await page.route('http://127.0.0.1:5173/',r=>r.fulfill({contentType:'text/html',body:'<html><div id="root"></div></html>'}));
  await page.goto('/');
  await page.evaluate(async()=>{
    const refresh=await import(/* @vite-ignore */ '/@react-refresh'); refresh.default.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$=()=>{};(window as any).$RefreshSig$=()=>(t:unknown)=>t;(window as any).__vite_plugin_react_preamble_installed__=true;
    (await import(/* @vite-ignore */ '/e2e/table-data-fixture.tsx')).renderProbe();
  });
  await expect(page.locator('#own')).toHaveText('hand-1');
  await page.evaluate(()=>(window as any).probeRefresh());
  const before={...counts};
  await page.evaluate(()=>Promise.all(Array.from({length:30},()=>(window as any).probeRefresh('game'))));
  expect(counts.hole_cards).toBe(before.hole_cards);
  expect(counts.chat_messages).toBe(before.chat_messages);
  expect(counts.ledger).toBe(before.ledger);
  expect(counts.tables-before.tables).toBe(2);
});

test('installed shell opens without a network wait and never intercepts game data', async({page})=>{
  await page.route('http://127.0.0.1:5173/',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('/');
  const result=await page.evaluate(async()=>{
    const source=await (await fetch('/sw.js')).text();
    let network=0;const listeners:Record<string,(e:any)=>void>={};
    const fakeSelf={location:{origin:location.origin},registration:{scope:location.origin+'/'},addEventListener:(type:string,cb:(e:any)=>void)=>{listeners[type]=cb;}};
    new Function('self','caches','fetch',source)(fakeSelf,{open:async()=>({match:async()=>new Response('cached shell')})},async()=>{network++;throw Error('offline')});
    let response:Promise<Response>|undefined;
    listeners.fetch({request:{method:'GET',url:location.origin+'/table/example',mode:'navigate'},respondWith:(p:Promise<Response>)=>{response=p;}});
    const body=await (await response!).text();
    let intercepted=false;
    listeners.fetch({request:{method:'GET',url:'https://example.supabase.co/rest/v1/tables'},respondWith:()=>{intercepted=true;}});
    listeners.fetch({request:{method:'POST',url:location.origin+'/cmd'},respondWith:()=>{intercepted=true;}});
    return {body,network,intercepted};
  });
  expect(result).toEqual({body:'cached shell',network:0,intercepted:false});
});


test('a command whose body stalls times out without retrying the action, then recovers', async ({page}) => {
  await page.route('http://127.0.0.1:5173/', r => r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const {SupabaseTransport}=await import(/* @vite-ignore */ '/src/transport/supabase.ts');
    const transport=Object.create(SupabaseTransport.prototype);
    transport.token=async()=> 'test-token'; transport.fnUrl='/test-api'; transport.key='test';
    const original=window.fetch;
    let calls=0;
    window.fetch=async(input, init)=> {
      if(String(input)!=='/test-api/cmd') return original(input,init);
      calls++;
      if(calls>1) return new Response(JSON.stringify({ok:true,result:'accepted'}));
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        init!.signal!.addEventListener('abort',()=>controller.error(init!.signal!.reason),{once:true});
      }}));
    };
    (window as any).commandTest={transport,calls:()=>calls};
    (window as any).commandResult=transport.cmd('start',{},'table','same-action').catch((e:any)=>e.code);
  });
  await page.clock.fastForward(20001);
  expect(await page.evaluate(()=>(window as any).commandResult)).toBe('timeout');
  expect(await page.evaluate(()=>(window as any).commandTest.calls())).toBe(1);
  expect(await page.evaluate(()=>(window as any).commandTest.transport.cmd('start',{},'table','same-action'))).toBe('accepted');
});
