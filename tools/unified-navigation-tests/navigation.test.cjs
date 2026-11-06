'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs');
function fixture(gate=async()=>({allowed:true}),custom=null) {
 const opened=[],alerts=[],initials=[],classes=new Set();
 const app=custom?custom(opened):{go:screen=>()=>opened.push(screen)};
 const nodes={mainApp:{style:{display:'block'}},spDaoFrame:{contentWindow:{app}}};
 const document={body:{classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},contains:v=>classes.has(v)}},documentElement:{style:{setProperty(){}}},getElementById:id=>nodes[id],querySelector:()=>null,querySelectorAll:()=>[]};
 const location=new URL('http://local.invalid/?lab=library');
 const window={auth:{currentUser:{uid:'fixture'}},_setEmuHomeTab(){},_emuEnsureAppVisible(){},scrollTo(){},spEnsureSchoolParkAccess:gate,spShowSchoolParkUnavailable(){alerts.push('denied')},openSpDao(screen){initials.push(screen);opened.push('open')},alert:m=>alerts.push(m),addEventListener(){}};
 const context={window,document,location,history:{state:null,replaceState(state,_t,url){this.state=state;location.href='http://local.invalid'+url;},pushState(state,_t,url){this.state=state;location.href='http://local.invalid'+url;}},URL,Set,Date,Promise,console,setTimeout,queueMicrotask,MutationObserver:class{observe(){}}};
 vm.runInNewContext(fs.readFileSync('frontend/public/unified-navigation.js','utf8'),context);
 return {nav:window.EmuNavigation,window,opened,alerts,classes,location,initials};
}
test('five canonical views retain existing query parameters and select only valid workspace screens',async()=>{
 const f=fixture();assert.equal(await f.nav.existing('unknown'),false);assert.deepEqual(f.opened,[]);
 await f.nav.existing('library');assert.deepEqual(f.opened,['open','library']);assert.deepEqual(f.initials,['library']);assert.equal(f.nav.current,'wisdom');assert.equal(new URL(f.location.href).searchParams.get('lab'),'library');
 for(const screen of ['logs','experiments','city','tasks','yeargoals'])await f.nav.existing(screen);
 assert.deepEqual(f.opened.slice(-2),['open','yeargoals']);assert.equal(f.nav.current,'practice');
});
test('denied entry and account change while waiting never open a workspace',async()=>{
 const denied=fixture(async()=>({allowed:false}));assert.equal(await denied.nav.existing('city'),false);assert.deepEqual(denied.opened,[]);
 let release;const changed=fixture(()=>new Promise(r=>{release=r}));const pending=changed.nav.existing('city');changed.window.auth.currentUser={uid:'other'};release({allowed:true});assert.equal(await pending,false);assert.deepEqual(changed.opened,[]);
});
test('an explicit read/search/practice navigation cancels a late workspace entry; repeated clicks share one gate',async()=>{
 for(const view of ['read','search','practice']){
  let release,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>{release=r})});const a=f.nav.existing('experiments'),b=f.nav.existing('experiments');
  assert.equal(calls,1);f.nav.activate(view);release({allowed:true});assert.equal(await a,false);assert.equal(await b,false);assert.deepEqual(f.opened,[]);assert.equal(f.nav.current,view);
  let releaseDenied;const denied=fixture(()=>new Promise(r=>{releaseDenied=r}));const late=denied.nav.existing('city');denied.nav.activate(view);releaseDenied({allowed:false});assert.equal(await late,false);assert.deepEqual(denied.alerts,[]);
 }
});
test('the booked dialogue URL uses server booking authorization for both voice and auxiliary chat',async()=>{
 for(const outcome of ['held','scheduled']){
  const f=fixture();f.window.emuAuthHeaders=async()=>({Authorization:'LOCAL_TEST_ONLY'});
  f.window.fetch=async url=>({ok:true,json:async()=>url.endsWith('/my')?({sessions:[{id:'booking',outcome}]}):({session:{id:'booking',outcome}})});
  f.window.accountGo=page=>f.opened.push(page);f.window.openRoom3=id=>{f.opened.push(id);return true;};
  assert.equal(await f.nav.resumeDialogue(),outcome==='scheduled');assert.deepEqual(f.opened,[outcome==='scheduled'?'booking':'sessions']);
 }
 const denied=fixture();denied.window.emuAuthHeaders=async()=>({});denied.window.fetch=async url=>({ok:!url.endsWith('/access'),json:async()=>({sessions:[{id:'booking',outcome:'scheduled'}]})});
 denied.window.accountGo=page=>denied.opened.push(page);assert.equal(await denied.nav.resumeDialogue(),false);assert.deepEqual(denied.opened,['sessions']);
});
test('a hidden frame left on City is switched to the quest screen before the workspace is shown (11/6)',async()=>{
 const f=fixture(undefined,opened=>{const a={state:{screen:'city'},go:screen=>()=>{a.state.screen=screen;opened.push('go:'+screen);}};return a;});
 f.window.openSpDao=()=>f.opened.push('shown');
 assert.equal(await f.nav.existing('experiments'),true);
 assert.deepEqual(f.opened.slice(0,2),['go:experiments','shown'],'the frame was shown while still on City');
});
