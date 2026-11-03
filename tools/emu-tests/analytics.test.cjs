'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const source=fs.readFileSync('frontend/public/emu-analytics.js','utf8');
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}};
function browser({dnt='0',hostname='emu-for-schoolpark.vercel.app',fail=false,responseStatus=1,localStorage=memory(),sessionStorage=memory()}={}) {
 const calls=[],listeners={},intervals=[];let clock=0;const timers=new Map();
 const document={visibilityState:'visible',readyState:'loading',addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[]};
 const context={document,navigator:{doNotTrack:dnt},location:{hostname,origin:'https://'+hostname,pathname:'/'},localStorage,sessionStorage,crypto:{randomUUID},AbortController,Event,console,
 setTimeout(fn){timers.set(++clock,fn);return clock},clearTimeout:id=>timers.delete(id),setInterval:fn=>intervals.push(fn),
 fetch:async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});if(fail)throw Error('offline');return{ok:true,json:async()=>({status:responseStatus})}},addEventListener:(n,fn)=>{(listeners[n]||=[]).push(fn)},dispatchEvent:e=>(listeners[e.type]||[]).forEach(fn=>fn(e))};
 context.window=context;context.parent=context;vm.runInNewContext(source,context);return{context,api:context.EmuAnalytics,calls,intervals,localStorage,sessionStorage};
}
test('anonymous measurement starts without a prompt; prior opt-out, DNT/GPC and withdrawal stay respected',async()=>{
 const b=browser();await b.api.flush();assert.equal(b.calls[0].body.batch[0].event,'session_start');
 b.api.consent(false);assert.equal(b.api.track('post_publish',{}),false);assert.equal(b.localStorage.getItem('emu.analytics.visitor.v1'),null);assert.equal(b.sessionStorage.getItem('emu.analytics.queue.v1'),null);
 const stopped=memory();stopped.setItem('emu.analytics.consent.v1','no');const prior=browser({localStorage:stopped});await prior.api.flush();assert.equal(prior.calls.length,0);prior.api.consent(true);await prior.api.flush();assert.equal(prior.calls.length,1);
 const d=browser({dnt:'1'});d.api.consent(true);await d.api.flush();assert.equal(d.calls.length,0);
 const g=browser({dnt:'1'});g.context.navigator.doNotTrack='0';g.context.navigator.globalPrivacyControl=true;g.api.consent(true);await g.api.flush();assert.equal(g.calls.length,0);
 assert.doesNotMatch(source,/createElement\('aside'\)|emuAnalyticsChoice|計測してよいですか/);
});
test('strict enum/count allowlist removes all free text, identity, money, unknown events and URLs',async()=>{
 const b=browser();b.api.consent(true);
 const secret={query:'PRIVATE_QUERY',body:'PRIVATE_BODY',email:'private@example.com',wallet:'0xPRIVATE',passportId:'PRIVATE_ID',token:'PRIVATE_TOKEN',amount:123456,current_url:'https://private.test/?token=PRIVATE_URL',action:'improvement'};
 b.api.track('knowledge_action',secret,'local-resource-PRIVATE');b.api.track('knowledge_lab_search',{...secret,mode:'semantic',result_count:7,more:false});
 b.api.track('knowledge_lab_search',{mode:'PRIVATE_MODE',result_count:-1,more:'PRIVATE_STRING'});assert.equal(b.api.track('made_up_event',secret),false);
 await b.api.flush();const payload=JSON.stringify(b.calls);assert.doesNotMatch(payload,/PRIVATE|private@example|123456|current_url/);
 const batch=b.calls[0].body.batch;assert.equal(batch[1].properties.action,'improvement');assert.equal(batch[2].properties.result_count,7);assert.equal(batch[3].properties.result_count,undefined);
 for(const x of batch){assert.match(x.properties.distinct_id,/^emu_anon_[0-9a-f-]{36}$/);assert.equal(x.properties.service,'emu_for_schoolpark');assert.equal(x.properties.$process_person_profile,false);}
 assert.equal(b.calls[0].credentials,'omit');assert.equal(b.calls[0].referrerPolicy,'no-referrer');
});
test('retry keeps exact insert IDs, concurrent sends and duplicate committed operations are suppressed',async()=>{
 const b=browser({fail:true});b.api.consent(true);b.api.track('post_publish',{surface:'lab'},'post-success');b.api.track('post_publish',{surface:'lab'},'post-success');
 await b.api.flush();await b.api.flush();assert.equal(b.calls.length,2);assert.deepEqual(b.calls[0].body.batch,b.calls[1].body.batch);
 assert.equal(b.calls[0].body.batch.filter(x=>x.event==='post_publish').length,1);assert.equal(b.api.status().delivery,'pending');
 const c=browser({localStorage:b.localStorage,sessionStorage:b.sessionStorage});await c.api.flush();assert.equal(c.api.status().delivery,'http_accepted');assert.deepEqual(c.calls[0].body.batch,b.calls[0].body.batch);
 await c.api.flush();assert.equal(c.calls.length,1);
});
test('real PostHog Ok receipts acknowledge packets; status zero or unknown strings stay pending',async()=>{
 const accepted=browser({responseStatus:'Ok'});accepted.api.consent(true);await accepted.api.flush();assert.equal(accepted.api.status().delivery,'http_accepted');await accepted.api.flush();assert.equal(accepted.calls.length,1);
 for(const responseStatus of [0,'unknown']){const denied=browser({responseStatus});denied.api.consent(true);await denied.api.flush();assert.equal(denied.api.status().delivery,'pending');assert.notEqual(denied.sessionStorage.getItem('emu.analytics.queue.v1'),'[]');}
});
test('view rerenders and hidden views do not create events; returning after visibility does',async()=>{
 const b=browser();b.api.consent(true);b.context.document.visibilityState='hidden';b.api.view('knowledge_list_view',{surface:'feed'});await b.api.flush();assert.equal(b.calls[0].body.batch.length,1);
 b.context.document.visibilityState='visible';b.intervals[0]();b.api.view('knowledge_list_view',{surface:'feed'});b.intervals[0]();await b.api.flush();assert.equal(b.calls[1].body.batch.length,1);
 b.context.document.visibilityState='hidden';b.intervals[0]();b.context.document.visibilityState='visible';b.intervals[0]();await b.api.flush();assert.equal(b.calls[2].body.batch.length,1);
});
test('session and test traffic share no account IDs; preview/local are excluded automatically',async()=>{
 for(const hostname of ['127.0.0.1','some-preview.vercel.app']){const b=browser({hostname});b.api.consent(true);await b.api.flush();assert.equal(b.calls[0].body.batch[0].properties.traffic_type,'internal');}
 const b=browser();b.api.setTestTraffic(true);b.api.consent(true);await b.api.flush();assert.equal(b.calls[0].body.batch[0].properties.traffic_type,'internal');
});
test('completion requires a server-observed increase; first historical snapshot, duplicate and failures do not count',async()=>{
 const b=browser();b.api.consent(true);b.api.observeQuestCompletion('private-quest',2);b.api.observeQuestCompletion('private-quest',2);b.api.observeQuestCompletion('private-quest',3);b.api.observeQuestCompletion('private-quest',3);await b.api.flush();
 assert.equal(b.calls[0].body.batch.filter(x=>x.event==='quest_complete').length,1);assert.doesNotMatch(JSON.stringify(b.calls),/private-quest/);
});
test('storage unavailability or blocked initialization never throws into application',()=>{
 const storage={getItem(){throw Error('denied')},setItem(){throw Error('denied')},removeItem(){throw Error('denied')}};
 assert.doesNotThrow(()=>browser({localStorage:storage,sessionStorage:storage}).api.track('post_publish',{}));
});
test('hooks follow persistence and real UI; no invented quest_start or business/rules edits',()=>{
 const root=fs.readFileSync('frontend/public/index.html','utf8'),lab=fs.readFileSync('frontend/public/knowledge-lab/lab.js','utf8');
 assert.match(root,/await _postBatch\.commit\(\);[\s\S]{0,250}track\('post_publish'/);
 assert.match(root,/if \(!!saved !== joined\) throw[\s\S]{0,140}if \(joined\).*track\('quest_join'/);
 assert.match(root,/const c = await _spRestDoc\(w.path, true, true\);[\s\S]{0,230}if \(rounds > w.rounds\)/);
 assert.match(lab,/const result = await api\("\/posts",[\s\S]{0,400}payload.visibility === "public" && \(!p \|\| p.visibility !== "public"\)/);
 // 11/3：#267 で「保存した版だけを保存済みにする」処理が保存のあとに入った。計測が保存の成功のあとにあることは同じ
 assert.match(lab,/const result = await api\("\/notes",[\s\S]{0,700}knowledge_lab_research/);
 assert.doesNotMatch(source,/quest_start|identify\(|autocapture:|capture_pageview:/); // comment contains autocapture: inspect actual code below instead
});
