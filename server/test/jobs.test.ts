import { it, expect, vi } from 'vitest';
import { App } from '../src/app.ts';
import type { Db } from '../src/db.ts';
const ids=Array.from({length:5},()=>crypto.randomUUID());
function makeApp() {
  const db={rpc:vi.fn(),select:vi.fn()} as unknown as Db;
  return new App(db,{verify:async()=>({authUid:'unused'})},{jobKey:'test'});
}
it('a blocked table does not block other tables, and timer concurrency is bounded',async()=>{
  const app=makeApp(); let active=0,max=0;const completed:string[]=[];
  let release!:()=>void;
  const blocked=new Promise<void>(r=>{release=r;});
  const run=vi.spyOn(app.handlers,'runTable').mockImplementation(async id=>{
    active++;max=Math.max(max,active);
    if(id===ids[0])await blocked;else await Promise.resolve();
    completed.push(id);active--;return {ok:true};
  });
  const result=app.handle({method:'POST',path:'/jobs',headers:{'x-allin-job':'test'},body:{tableIds:[...ids,ids[0]]}});
  await vi.waitFor(()=>expect(completed).toHaveLength(4));
  expect(completed).not.toContain(ids[0]);expect(max).toBeLessThanOrEqual(3);
  release(); const response=await result;
  expect(response.status).toBe(200);expect(run).toHaveBeenCalledTimes(5);
});
it('one failed table is reported without preventing other timer updates',async()=>{
  const app=makeApp();
  vi.spyOn(app.handlers,'runTable').mockImplementation(async id=>{if(id===ids[0])throw Error('temporary failure');return {ok:true};});
  const response=await app.handle({method:'POST',path:'/jobs',headers:{'x-allin-job':'test'},body:{tableIds:ids.slice(0,2)}});
  expect(response.body).toEqual({ok:true,ran:2,results:{[ids[0]]:'temporary failure',[ids[1]]:'ok'}});
});

it('preflight grants are short-lived and stay scoped to the permitted origin',()=>{
  const app=new App({} as Db,{verify:async()=>({authUid:'unused'})},{corsOrigin:'https://allowed.example'});
  expect(app.cors('https://allowed.example')['Access-Control-Max-Age']).toBe('600');
  expect(app.cors('https://other.example')['Access-Control-Allow-Origin']).toBe('https://allowed.example');
  expect(app.cors('https://allowed.example').Vary).toBe('Origin');
});
