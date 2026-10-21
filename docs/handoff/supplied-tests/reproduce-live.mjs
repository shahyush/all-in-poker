import * as E from '../existing-backend/api/engine.js';
const cfg={variant:'holdem',sb:50,bb:100,actionSeconds:20,ritSeconds:12,ritVoteSeconds:20};
function fresh(n,variant='holdem') {return E.newHand({config:{...cfg,variant},seats:Array.from({length:9},(_,i)=>i<n?{userId:'p'+i,name:'P'+i,stack:1000}:null),button:-1,handNo:0},1000,()=>0);}
const out=[];
{
 const {secret}=fresh(9,'omaha6');
 out.push({id:'BUG01',expected:'Reject before dealing an impossible 9-player Omaha 6 hand',actual:{holeCounts:Object.values(secret.hole).map(x=>x.length),remaining:secret.deck.length},bugReproduced:Object.values(secret.hole).some(x=>x.length!==6)});
}
{
 const {pub,secret}=fresh(3);const seat=pub.toAct;const deadline=pub.deadline;
 let accepted=false;try{E.applyAction(pub,secret,seat,{type:'call'},deadline+1,cfg);accepted=true}catch{}
 out.push({id:'BUG02',expected:'Reject or resolve timeout before accepting a late player action',actual:{acceptedAfterDeadline:accepted},bugReproduced:accepted});
}
{
 const {pub,secret}=fresh(4);pub.street='flop';pub.board=[30,31,32];pub.pot=0;pub.currentBet=100;pub.minRaise=100;pub.acted=[0];pub.noRaise=[];pub.toAct=1;
 pub.seats.forEach((p,i)=>{if(p){p.stack=[900,150,200,1000][i];p.bet=i===0?100:0;p.total=p.bet;p.allIn=false;}});
 E.applyAction(pub,secret,1,{type:'allin'},1100,cfg);
 E.applyAction(pub,secret,2,{type:'allin'},1200,cfg);
 E.applyAction(pub,secret,3,{type:'call'},1300,cfg);
 const legal=E.legalActions(pub,0);
 out.push({id:'BUG03',expected:'After betting 100 then facing cumulative all-ins to 200, player 0 can raise with a funded opponent remaining',actual:{toAct:pub.toAct,canRaise:legal.canRaise,currentBet:pub.currentBet,noRaise:pub.noRaise},bugReproduced:legal.canRaise===false});
}
{
 const {pub,secret}=fresh(3);pub.street='flop';pub.board=[30,31,32];pub.seats[0].allIn=true;pub.seats[0].stack=0;pub.toAct=1;
 E.forceFold(pub,secret,0,1100,cfg);
 out.push({id:'BUG04',expected:'An all-in player keeps pot eligibility when leaving or being removed during side-pot betting',actual:{folded:pub.seats[0].folded,inHand:pub.seats[0].inHand},bugReproduced:pub.seats[0].folded});
}
{
 const {pub,secret}=fresh(3);
 E.applyAction(pub,secret,0,{type:'call'},1100,cfg);
 E.applyAction(pub,secret,1,{type:'call'},1200,cfg);
 E.applyAction(pub,secret,2,{type:'check'},1300,cfg);
 const seat=pub.toAct;
 E.timeoutAction(pub,secret,pub.deadline+1,cfg);
 out.push({id:'BUG05',expected:'An automatic check still counts as a missed action for the two-timeout sit-out policy',actual:{timeouts:pub.seats[seat].timeouts},bugReproduced:pub.seats[seat].timeouts===0});
}
console.log(JSON.stringify({scope:'Local pure-engine reproduction using retrieved api engine.js; no live mutations',results:out},null,2));
