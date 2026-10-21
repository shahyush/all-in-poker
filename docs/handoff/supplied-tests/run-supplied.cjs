const vm=require('vm'),fs=require('fs'),path=require('path');const base=path.resolve(process.argv[2]||'poker_round3_current','engine'),results={};
for(const name of ['test-engine.cjs','test-journey.cjs']){
 const logs=[];const source=fs.readFileSync(path.join(base,'tests',name),'utf8');
 const context={require:p=>p==='fs'?{writeFileSync:(f,data)=>{results[name]=JSON.parse(data)}}:p.startsWith('./')?require(path.join(base,p)):require(p),__dirname:path.join(base,'tests'),console:{log:(...x)=>logs.push(x.join(' '))},process:{exit:n=>{if(n)throw Error('Nonzero test exit '+n)}}};
 try{new Function('require','__dirname','console','process',source)(context.require,context.__dirname,context.console,context.process);}catch(e){results[name]={...results[name],runnerError:String(e)}}
}
const src=fs.readFileSync(path.join(base,'tests/extra-tests.js'),'utf8').replace('export const EXTRA_TESTS','globalThis.EXTRA_TESTS');const c={};vm.runInNewContext(src,c);const {Journey}=require(path.join(base,'journey.js'));
results.extra=c.EXTRA_TESTS.map(([name,test])=>{try{return {name,status:test(new Journey())?'PASS':'FAIL'}}catch(e){return {name,status:'FAIL',error:String(e)}}});
fs.writeFileSync(process.argv[3]||'poker_r4_work/evidence/supplied-test-rerun.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,Array.isArray(v)?{passed:v.filter(x=>x.status==='PASS').length,total:v.length}: {passed:v.passed,total:v.tests,error:v.runnerError}]))));
