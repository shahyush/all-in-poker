const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(process.argv[2]||'poker_r4_work/reviewed-candidate'),P=require(path.join(root,'engine/poker-engine.js'));
let rngState=736924;const rnd=()=>{rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState/4294967296};
const report={seed:rngState,scope:'Pure model, no network or browser',hands:0,actions:0,twoBoards:0,uncontested:0,failures:[],variants:{}};
for(const variant of ['holdem','omaha4','omaha5','omaha6'])for(let n=2;n<=(variant==='omaha6'?7:9);n++)for(let k=0;k<75;k++){
 let g;try{
 const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i,stack:1+Math.floor(rnd()*1200)}));
 g=new P.Game({players,variant,sb:5,bb:10,ante:k%4===0?2:0,dealer:k%n,seed:++rngState,straddle:k%3===0});g.deal(variant,{straddle:k%3===0});
 let steps=0;while(g.s.phase!=='result'){
 if(++steps>400)throw Error('Hand failed to terminate');
 if(g.s.phase==='betting'){
 const id=g.s.players[g.s.actor].id,L=g.legal(id);assert(L);let r=rnd(),type=L.check?'check':'call',amount=0;
 if(r<.13)type='fold';else if(r<.48&&L.canRaise){type='raise';amount=r<.25?L.max:L.min+Math.floor(rnd()*(L.max-L.min+1))}
 g.act({id,type,amount,key:'a'+steps,version:g.s.version});report.actions++;
 }else if(g.s.phase==='street'||g.s.phase==='runout'){
 if(g.s.phase==='runout'&&[3,4].includes(g.s.board.length)&&g.runoutCapacity().two<=g.runoutCapacity().available&&rnd()<.5){g.runTwice();report.twoBoards++}else g.advance();
 }else throw Error('Unexpected phase '+g.s.phase);
 assert.equal(g.s.players.reduce((s,p)=>s+p.stack+p.paid,0),g.initial);for(const p of g.s.players)assert(Number.isSafeInteger(p.stack)&&p.stack>=0);
 }
 const consumed=g.d.slice(0,g.cursor);assert.equal(new Set(consumed).size,consumed.length);assert(g.cursor<=52);
 if(g.s.boards.length){for(const b of g.s.boards)assert.equal(new Set(b).size,5);const shared=g.s.boards[0].filter(c=>g.s.boards[1].includes(c));assert(shared.length===3||shared.length===4)}
 assert.equal(g.s.awards.reduce((s,a)=>s+a.amount,0),g.s.pots.reduce((s,p)=>s+p.amount,0));
 for(const pot of g.s.pots)for(const award of pot.awards)assert(pot.eligible.includes(award.id));
 report.hands++;report.variants[variant]=(report.variants[variant]||0)+1;if(g.s.uncontested)report.uncontested++;
 }catch(e){report.failures.push({variant,n,k,error:e.message,state:g?.snapshot()});if(report.failures.length>=5)break}
}
fs.writeFileSync(process.argv[3]||'poker_r4_work/evidence/stress.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,failures:report.failures.map(x=>({...x,state:undefined}))}));if(report.failures.length)process.exitCode=1;
