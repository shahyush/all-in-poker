const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const root=path.resolve(process.argv[2]||'poker_r4_work/reviewed-candidate'),P=require(path.join(root,'engine/poker-engine.js'));
 const E=await import(path.resolve(process.argv[3]||'poker_r4_work/live-source/api/engine.js'));
 const report={scope:'Differential against separately implemented retrieved server evaluator; shared conceptual algorithms are not a mathematical proof',handsCompared:0,pairOrderComparisons:0,failures:[]};
 for(const variant of ['holdem','omaha4','omaha5','omaha6'])for(let i=1;i<=1000;i++){
 const d=P.deck(i*47),h=variant==='holdem'?2:+variant.slice(5),board=d.slice(h*2,h*2+5),a=d.slice(0,h),b=d.slice(h,h*2);
 const ra=P.best(a,board,variant),rb=P.best(b,board,variant),sa=E.bestHand(a.map(E.parseCard),board.map(E.parseCard),variant),sb=E.bestHand(b.map(E.parseCard),board.map(E.parseCard),variant);
 try{assert.equal(ra.cat,Math.floor(sa.score/16**5));assert.equal(rb.cat,Math.floor(sb.score/16**5));assert.equal(Math.sign(ra.value-rb.value),Math.sign(sa.score-sb.score));report.handsCompared+=2;report.pairOrderComparisons++}catch(e){report.failures.push({variant,i,a,b,board,error:e.message})}
 }
 fs.writeFileSync(process.argv[4]||'poker_r4_work/evidence/differential.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
