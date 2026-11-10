'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture');
function trace(f){
 const base=f.db.collection.bind(f.db),out={queries:[],jobGets:0};
 f.db.collection=name=>{const c=base(name);if(name!=='emuer_v2_agent_jobs')return c;return {...c,
  doc(id){const d=c.doc(id);return {...d,get:async()=>{out.jobGets++;return d.get();}};},
  where(...args){const q=c.where(...args);return {...q,limit(n){const l=q.limit(n);return {get:async()=>{out.queries.push(args);return l.get();}};}};}
 };};return out;
}
async function setup(opts={}){const f=fixture(opts);await f.seed();f.a=await f.actor();return f;}
async function submit(f,key='read-budget-test-0001'){const q=await f.economy.service.quote(f.a,{goal:'コーヒーを学びたい'});return f.economy.service.submit(f.a,{quoteId:q.id,termsVersion:q.termsVersion,requestId:key,paymentConsent:true,aiConsent:true});}
test('idle worker uses one indexed existence query even with large completed history; public status adds no reads',async()=>{
 const f=await setup();try{
  for(let i=0;i<150;i++)await f.db.collection('emuer_v2_agent_jobs').doc('past'+i).set({state:'completed',spid:f.a.spid});
  const r=trace(f);await f.economy.tick();assert.equal(r.queries.filter(q=>q[0]==='state').length,1);r.queries.length=0;await f.economy.tick();assert.equal(r.queries.length,1);assert.equal(r.queries[0][1],'in');assert.ok(!r.queries[0][2].includes('completed'));assert.equal(r.jobGets,0);
  const route=f.economy.router.stack.find(x=>x.route?.path==='/status').route.stack.at(-1).handle;
  for(let i=0;i<30;i++)route({}, {json(s){assert.equal(s.worker.state,'healthy');}});
  assert.equal(r.queries.length,1);assert.equal(f.calls(),0);
 }finally{f.economy.close();}
});
test('nonempty recovery keeps per-state scans and recovers payment then completes in the same cycle without double charge',async()=>{
 const opts={rpcDown:true},f=await setup(opts);try{
  const j=await submit(f);assert.equal(j.state,'awaiting_payment');opts.rpcDown=false;
  const r=trace(f);await f.economy.tick();
  assert.deepEqual(r.queries.filter(x=>x[1]==='==').map(x=>x[2]),['awaiting_payment','awaiting_wallet_payment','queued','running','result_saved','refund_pending']);
  const done=await f.economy.service.view(f.a,j.id);assert.equal(done.state,'completed');assert.equal(done.payment.amount,5);assert.equal(f.calls(),1);
  await f.economy.tick();assert.equal(f.calls(),1);assert.equal(Object.keys(f.db._dump('mitemiru_orders')).length,1);
 }finally{f.economy.close();}
});
test('history reuses actor-scoped query data but rechecks live payment; direct detail still performs ownership read',async()=>{
 const f=await setup();try{
  const j=await submit(f);await f.db.collection('emuer_v2_agent_jobs').doc('foreign').set({spid:'OTHER',state:'completed',price:999,result:{secret:'NEVER-RETURN'}});
  const r=trace(f);const rows=await f.economy.service.history(f.a);assert.equal(rows.length,1);assert.equal(rows[0].id,j.id);assert.equal(rows[0].payment.status,'paid');assert.equal(rows[0].result,null);assert.equal(r.jobGets,0);assert.equal(r.queries.length,1);assert.ok(!JSON.stringify(rows).includes('NEVER-RETURN'));
  await f.economy.service.view(f.a,j.id);assert.equal(r.jobGets,1);await assert.rejects(f.economy.service.view({spid:'OTHER'},j.id),/JOB_NOT_FOUND/);
  await f.commerce.servicePayments.refund('agent_'+j.id,j.id);const refunded=await f.economy.service.history(f.a);assert.equal(refunded[0].payment.status,'refunded');
 }finally{f.economy.close();}
});
test('quota failure backs off without reads or payments, keeps intake closed, and resumes existing worker after repair',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-06T03:00:00Z')});
 const f=await setup();try{
  let attempts=0;const health=f.economy.service.workerHealth;f.economy.service.workerHealth=(...a)=>{attempts++;return health(...a);};
  f.db._breakAll('RESOURCE_EXHAUSTED');await f.economy.tick();const first=attempts;
  const route=f.economy.router.stack.find(x=>x.route?.path==='/status').route.stack.at(-1).handle;route({}, {json(s){assert.equal(s.service.enabled,false);assert.equal(s.worker.state,'not_ready');}});
  await f.economy.tick();t.mock.timers.tick(59999);await f.economy.tick();assert.equal(attempts,first);
  t.mock.timers.tick(1);await f.economy.tick();assert.ok(attempts>first);const second=attempts;
  f.db._repair();t.mock.timers.tick(119999);await f.economy.tick();assert.equal(attempts,second);
  t.mock.timers.tick(1);f.advance(180000);await f.economy.tick();route({}, {json(s){assert.equal(s.service.enabled,true);assert.equal(s.worker.state,'healthy');}});
  const restored=attempts;await f.economy.tick();assert.ok(attempts>restored);assert.equal(f.calls(),0);assert.equal(f.db._count('mitemiru_orders'),0);
 }finally{f.economy.close();}
});
