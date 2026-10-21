const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(process.argv[2]||'poker_r4_work/reviewed-candidate'),{Game}=require(path.join(root,'engine/poker-engine.js')),{Session}=require(path.join(root,'engine/session-model.js'));
const report={scope:'Sequential pure-model sessions, not simultaneous clients',sessions:0,hands:0,reloads:0,retries:0,failures:[]};
for(const variant of ['holdem','omaha4','omaha5','omaha6'])for(const n of [2,3,6,7]){
 const sess=new Session({unit:1000,players:Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i,stack:1000}))});
 try{for(let h=1;h<=40;h++){
 const players=sess.players();for(const p of players)if(p.stack<100){const id='refill:'+h+':'+p.id;sess.request(id,p.id,1000);sess.approve(id);report.reloads++}sess.boundary();
 const g=new Game({players:sess.players(),variant,seed:h*721+n,sb:5,bb:10,dealer:(h-1)%n});g.deal();let k=0;
 while(g.s.phase!=='result'){
 if(++k>250)throw Error('Nonterminating hand');if(g.s.phase==='betting'){const p=g.s.players[g.s.actor],L=g.legal(p.id);let type=L.check?'check':'call',amount=0;if(k%7===0&&L.canRaise){type='raise';amount=L.min}g.act({id:p.id,type,amount,key:'h'+h+'a'+k})}else g.advance();
 }
 const snapshot=g.snapshot().players;sess.boundary(snapshot,'h'+h);if(h%5===0){let id='reload:'+h;sess.request(id,'p0',1000);sess.approve(id);sess.boundary();report.reloads++;sess.boundary(snapshot,'h'+h);report.retries++}
 const rows=sess.rows();assert.equal(rows.reduce((s,r)=>s+r.net,0),0);assert.equal(rows.reduce((s,r)=>s+r.added,0),sess.total());report.hands++;
 }
 for(const p of sess.players())sess.leave(p.id);sess.boundary();const taken=sess.total();sess.boundary();assert.equal(sess.total(),taken);assert(sess.closed);assert(sess.rows().every(r=>r.stack===0));report.sessions++;
 }catch(e){report.failures.push({variant,n,error:e.stack})}
}
fs.writeFileSync(process.argv[3]||'poker_r4_work/evidence/session-soak.json',JSON.stringify(report,null,2));console.log(report);if(report.failures.length)process.exitCode=1;
