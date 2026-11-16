"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {fixture}=require("./fixture");
const start=Date.parse("2026-11-07T06:48:46.671Z"),end=start+7*86400000;
async function paid(){
 const f=fixture({env:{ECONOMY_EXPLORER_TRIAL_START:new Date(start).toISOString()}});f.advance(start-f.now());await f.seed();const a=await f.actor();
 const q=await f.economy.service.quote(a,{goal:"コーヒーを学びたい"});
 const j=await f.economy.service.submit(a,{quoteId:q.id,termsVersion:q.termsVersion,requestId:"trial-cutoff-paid-request",paymentConsent:true,aiConsent:true});
 return {f,a,j};
}
test("exact existing trial end rejects new quotes, refunds an unexecuted paid job once and preserves history",async()=>{
 const {f,a,j}=await paid();try{
  f.advance(end-f.now());assert.equal(f.economy.service.config().trialEndMs,end);
  await assert.rejects(f.economy.service.quote(a,{goal:"新しい依頼"}),/SERVICE_DISABLED/);
  await f.economy.tick();await f.economy.tick();
  assert.equal((await f.economy.service.view(a,j.id)).state,"refunded");assert.equal(f.calls(),0);
  assert.equal((await f.commerce.servicePayments.balances(f.auth().walletAddress)).spendable,"100");
  assert.equal(f.db._count("mitemiru_orders"),1);
 }finally{f.economy.close();}
});
test("refund outage at trial end stays pending and a recovered worker settles without new admission",async()=>{
 const {f,a,j}=await paid();try{
  f.advance(end-f.now());const refund=f.commerce.servicePayments.refund;
  f.commerce.servicePayments.refund=async()=>{throw Error("isolated refund outage");};
  await f.economy.tick();assert.equal((await f.economy.service.view(a,j.id)).state,"refund_pending");
  f.commerce.servicePayments.refund=refund;await f.economy.tick();
  assert.equal((await f.economy.service.view(a,j.id)).state,"refunded");assert.equal(f.calls(),0);
  assert.equal((await f.commerce.servicePayments.balances(f.auth().walletAddress)).spendable,"100");
 }finally{f.economy.close();}
});
