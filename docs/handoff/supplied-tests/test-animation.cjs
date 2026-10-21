const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {planDeal,planBoard,EventGate}=require(path.resolve(process.argv[2]||'poker_r4_work/reviewed-candidate/animation-plan.cjs'));
let cases=0;for(const h of [2,4,5,6])for(let n=2;n<=9;n++)if(n*h+5<=52){
 const seats=Array.from({length:n},(_,i)=>'p'+i);const plan=planDeal({eventId:'e1',handId:'h1',seatIds:seats,buttonSeatId:'p0',holeCount:h});assert.equal(plan.steps.length,n*h);assert(plan.durationMs<=1500);assert.equal(plan.steps[0].to,'p1');assert.equal(plan.steps[n-1].to,'p0');assert.equal(new Set(plan.steps.map(s=>s.key)).size,n*h);for(const id of seats)assert.equal(plan.steps.filter(s=>s.to===id).length,h);assert(!JSON.stringify(plan).includes('cards'));cases++;
}
assert.throws(()=>planDeal({eventId:'e',handId:'h',seatIds:Array.from({length:9},(_,i)=>i),buttonSeatId:0,holeCount:6}));cases++;
assert.equal(planDeal({eventId:'e',handId:'h',seatIds:['a','b'],buttonSeatId:'a',holeCount:6,reducedMotion:true}).durationMs,0);cases++;
for(const [a,b] of [[0,3],[3,4],[4,5]]){const p=planBoard({eventId:'e',handId:'h',fromCount:a,toCount:b});assert.equal(p.steps.length,b-a);assert(p.steps.every(s=>s.delayMs===0));cases++}
assert.throws(()=>planBoard({eventId:'e',handId:'h',fromCount:0,toCount:5}));cases++;
const gate=new EventGate();assert(gate.accept(1));assert(!gate.accept(1));gate.resume(15);assert(!gate.accept(14));assert(gate.accept(16));cases++;
const report={cases,passed:cases,scope:'Pure event/animation planning only; no DOM renderer, device or timing visual verification'};fs.writeFileSync(process.argv[3]||'poker_r4_work/evidence/animation-tests.json',JSON.stringify(report,null,2));console.log(report);
