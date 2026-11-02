const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const file='frontend/public/schoolpark/city-bridge.js';
const bridgeModule=()=>import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(file,'utf8')));
const fixture=()=>{const calls=[];const parent={auth:{currentUser:{uid:'local-test'}},spEnsureSchoolParkAccess:async()=>({allowed:true}),spOpenPlay:kind=>calls.push(['play',kind]),openSpRoom:(...args)=>calls.push(['room',...args])};return{parent,calls}};
test('City delegates all games and elevator to existing entries, without participation/reward writes',async()=>{
 const {createBridge}=await bridgeModule();const {parent,calls}=fixture();const b=createBridge(parent,{state:{quests:[]}});
 for(const name of ['echo','ringo','gods'])await b.openPlay(name);await b.openElevator();
 assert.deepEqual(calls,[['play','echo'],['play','ringo'],['play','gods'],['room','/schoolpark/south-elevator.html','エレベーター']]);
 await assert.rejects(b.openPlay('unknown'),/PLAY_UNAVAILABLE/);assert.equal(calls.length,4);
});
test('City preserves access denial and session changes before opening games',async()=>{
 const {createBridge}=await bridgeModule();const {parent,calls}=fixture();const b=createBridge(parent,{});
 parent.spEnsureSchoolParkAccess=async()=>({allowed:false});await assert.rejects(b.openPlay('echo'),/SCHOOLPARK_ACCESS_DENIED/);
 parent.spEnsureSchoolParkAccess=async()=>{parent.auth.currentUser=null;return {allowed:true}};await assert.rejects(b.openElevator(),/AUTH_REQUIRED|SESSION_CHANGED/);assert.deepEqual(calls,[]);
});
