"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {once}=require("node:events");
const {fixture}=require("./fixture");
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail("worker did not wake before the 30-second interval");}
async function setup(options={}){
 const f=fixture({startWorker:true,...options});await f.seed();
 const server=f.app.listen(0,"127.0.0.1");await once(server,"listening");
 const base="http://127.0.0.1:"+server.address().port;
 const call=async(path,body)=>{const r=await fetch(base+"/api/economy"+path,{method:"POST",headers:{"content-type":"application/json","x-test-user":"alice"},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const body=async(key)=>{const q=await call("/quotes",{goal:"コーヒーを学びたい"});return {quoteId:q.quote.id,termsVersion:q.quote.termsVersion,requestId:key,paymentConsent:true,aiConsent:true};};
 return {f,call,body,close:async()=>{f.economy.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test("paid HTTP submission wakes the existing worker; idempotent replay invokes AI and charges once",async()=>{
 const t=await setup();try{
 const b=await t.body("wake-request-once-0001");
 const responses=await Promise.all([t.call("/jobs",b),t.call("/jobs",b),t.call("/jobs",b)]);
 assert.equal(new Set(responses.map(x=>x.job.id)).size,1);
 const a=await t.f.actor();await until(async()=> (await t.f.economy.service.view(a,responses[0].job.id)).state==="completed");
 assert.equal(t.f.calls(),1);assert.equal(Object.keys(t.f.db._dump("mitemiru_orders")).length,1);
 assert.equal((await t.f.commerce.servicePayments.balances(t.f.auth().walletAddress)).spendable,"95");
 }finally{await t.close();}
});
test("new job arriving during an active cycle gets a coalesced wake without waiting for periodic recovery",async()=>{
 let release;const gate=new Promise(r=>{release=r;});
 const t=await setup({providerWait:()=>gate});try{
 const first=await t.call("/jobs",await t.body("wake-request-first-0001"));
 await until(()=>t.f.calls()===1);
 const second=await t.call("/jobs",await t.body("wake-request-second-0002"));
 release();const a=await t.f.actor();
 await until(async()=> (await t.f.economy.service.view(a,second.job.id)).state==="completed");
 assert.equal((await t.f.economy.service.view(a,first.job.id)).state,"completed");
 assert.equal(t.f.calls(),2);assert.equal(Object.keys(t.f.db._dump("mitemiru_orders")).length,2);
 }finally{release();await t.close();}
});
test("disabled automatic worker does not execute a paid request via HTTP wake",async()=>{
 const t=await setup({startWorker:false});try{
 const j=await t.call("/jobs",await t.body("wake-disabled-request-0001"));
 await new Promise(r=>setTimeout(r,30));assert.equal(t.f.calls(),0);
 assert.equal((await t.f.economy.service.view(await t.f.actor(),j.job.id)).state,"queued");
 }finally{await t.close();}
});
