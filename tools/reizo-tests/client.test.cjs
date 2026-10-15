'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../frontend/public/reizo/chat.js'),'utf8');
function client(fetcher, {shortTimeout=false, token}={}) {
 const timers=[];const classes=new Set(['sp-dao-open']);
 const window={auth:{currentUser:{uid:'USER_A',getIdToken:token|| (async()=> 'LOCAL-TOKEN')}},addEventListener(){}};
 const document={body:{classList:{contains:k=>classes.has(k)}},getElementById:()=>({contentWindow:{app:{state:{screen:'experiments',me:{private:'PRIVATE_DATA'},quests:[{private:'PRIVATE_QUEST'}]}}}})};
 vm.runInNewContext(source,{window,document,AbortController,fetch:fetcher,setTimeout:(fn,ms)=>{const id=setTimeout(fn,shortTimeout?10:ms);timers.push(id);return id;},clearTimeout});
 return {chat:window.ReizoChat,window,classes};
}
test('only generated pairs enter bounded history and no application data crosses the boundary',async()=>{
 const calls=[];const {chat}=client(async(url,opt)=>{calls.push(JSON.parse(opt.body));return {ok:true,json:async()=>({reply:'ぼくだよ',provider:'gemini'})};});
 for(let i=0;i<9;i++)await chat.ask('hello '+i);
 assert.equal(calls[0].currentPage,'quest');assert.equal(calls[0].history.length,0);assert.equal(calls.at(-1).history.length,6);
 assert.ok(!JSON.stringify(calls).includes('PRIVATE_DATA'));assert.ok(!JSON.stringify(calls).includes('PRIVATE_QUEST'));
});
test('new identity gets empty history; star screen resolves without personal records',async()=>{
 const calls=[];const {chat,window,classes}=client(async(url,opt)=>{calls.push(JSON.parse(opt.body));return {ok:true,json:async()=>({reply:'ぼくだよ',provider:'gemini'})};});
 await chat.ask('hi');window.auth.currentUser={uid:'USER_B',getIdToken:async()=> 'NEW-TOKEN'};classes.add('sp-star-open');await chat.ask('hello');assert.equal(calls[1].history.length,0);assert.equal(calls[1].currentPage,'passport');
});
test('hung token times out and never dispatches a delayed external request',async()=>{
 let resolveToken,calls=0;const {chat}=client(async()=>{calls++;throw Error('MUST_NOT_SEND');},{shortTimeout:true,token:()=>new Promise(r=>{resolveToken=r;})});
 await assert.rejects(chat.ask('hi'),/TIMEOUT/);resolveToken('LATE-TOKEN');await new Promise(r=>setImmediate(r));assert.equal(calls,0);
});
test('failed turn does not pollute external history, and pending requests reject duplicates',async()=>{
 let finish;const calls=[];const {chat}=client(async(url,opt)=>{calls.push(JSON.parse(opt.body));return new Promise(r=>{finish=r;});});
 const pending=chat.ask('first');await new Promise(r=>setImmediate(r));await assert.rejects(chat.ask('duplicate'),/BUSY/);
 finish({ok:false});await assert.rejects(pending,/AI_UNAVAILABLE/);assert.equal(calls.length,1);
});
test('sign-out cancels in-flight text and no stale answer is returned',async()=>{
 let finish;const {chat,window}=client(async()=>new Promise(r=>{finish=r;}));
 const pending=chat.ask('hi');await new Promise(r=>setImmediate(r));window.auth.currentUser=null;chat.reset();finish({ok:true,json:async()=>({reply:'PRIVATE_OLD_REPLY',provider:'gemini'})});await assert.rejects(pending,/SESSION_CHANGED/);
});
