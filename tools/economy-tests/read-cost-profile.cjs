"use strict";
// Isolated fixture only: no production SDK, credentials, model or network call.
const { fixture } = require("../../backend/economy/fixture");
async function profile() {
  const f = fixture(), phases = {}; let phase = "seed";
  function count(kind, n = 1) {
    if (phase === "seed") return;
    const p = phases[phase] ||= { minimumDocumentReads:0, writeRequests:0, queries:0 };
    p[kind] += n;
  }
  function wrap(target) {
    return new Proxy(target, { get(t,k) {
      const v=t[k]; if(typeof v!=="function") return v;
      if(["collection","doc","where","limit","orderBy","select"].includes(k)) return (...a)=>wrap(v.apply(t,a));
      if(k==="get") return async(...a)=>{ const s=await v.apply(t,a);count("minimumDocumentReads",Array.isArray(s.docs)?Math.max(1,s.size):1);if(Array.isArray(s.docs))count("queries");return s; };
      if(["set","create","delete","update"].includes(k)) return(...a)=>{count("writeRequests");return v.apply(t,a);};
      return v.bind(t);
    }});
  }
  const collection=f.db.collection.bind(f.db), transaction=f.db.runTransaction.bind(f.db);
  f.db.collection=(...a)=>wrap(collection(...a));
  f.db.runTransaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(t,k){const v=t[k];if(k==="get")return async(...a)=>{count("minimumDocumentReads");return v.apply(t,a);};if(["set","create","delete"].includes(k))return(...a)=>{count("writeRequests");return v.apply(t,a);};return typeof v==="function"?v.bind(t):v;}})));
  try {
    await f.seed();const a=await f.actor();
    phase="quote";const q=await f.economy.service.quote(a,{goal:"コーヒーを学びたい"});
    const b={quoteId:q.id,termsVersion:q.termsVersion,requestId:"isolated-read-cost-profile",paymentConsent:true,aiConsent:true};
    phase="payment_submission";const j=await f.economy.service.submit(a,b);
    phase="worker_generation_settlement";await f.economy.tick();
    phase="history";await f.economy.service.history(a);
    phase="same_key_replay";await f.economy.service.submit(a,b);
    phase="public_status";phases[phase]={minimumDocumentReads:0,writeRequests:0,queries:0};const route=f.economy.router.stack.find(x=>x.route?.path==="/status").route.stack.at(-1).handle;
    for(let i=0;i<100;i++)route({}, {json(){}});
    return {scope:"isolated ledger/search fixture",phases,productionWrites:0,excludes:["real source adapters","real identity/membership reads","index entry billing","transaction contention retries","other app traffic"],orderCount:f.db._count("mitemiru_orders"),modelCalls:f.calls()};
  } finally { f.economy.close(); }
}
if(require.main===module) profile().then(x=>console.log(JSON.stringify(x,null,2))).catch(()=>{console.error("ISOLATED_PROFILE_FAILED");process.exitCode=1;});
module.exports={profile};
