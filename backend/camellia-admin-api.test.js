const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),express=require('express');
const {createBillingRouter}=require('./billing');
const {makeFirestore}=require('./fake-firestore');
async function setup(){
 const db=makeFirestore(),access=[];
 const original=db.collection.bind(db);db.collection=name=>{access.push(name);return original(name);};
 const uid='camellia:synthetic-user';
 await db.collection('camellia_users').doc(uid).set({birthDate:'2000-01-01',agreedAt:'2026-10-01T00:00:00Z',checkCount:2,lastCheckAt:'2026-10-01T00:00:00Z'});
 await db.collection('camellia_users').doc(uid).collection('profile').doc('basic').set({displayName:'Synthetic',concerns:'SENSITIVE_CONCERN_TEXT'});
 await db.collection('camellia_auth_users').doc(uid).set({identities:{line:true,schoolpark:true}});
 await db.collection('camellia_users').doc(uid).collection('imports').doc('conversation-one').set({source:'camellia-beta-localStorage',kind:'conversation',content:'{"text":"SENSITIVE_TEST_TEXT"}'});
 const app=express();app.use('/api',createBillingRouter({db,requireFirebaseUser:(req,res,next)=>next(),requireOwner:(req,res,next)=>req.headers['x-test-owner']==='1'?next():res.status(403).json({error:'OWNER_ONLY'}),rateLimit:()=>((req,res,next)=>next())}).router);
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{server,access,uid,call:async(path,owner=true)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/camellia${path}`,{headers:owner?{'x-test-owner':'1'}:{}});return{status:response.status,data:await response.json()};}};
}
test('Camellia summary excludes private detail and keeps canonical UID; detail requires owner',async()=>{
 const s=await setup();try{
  const denied=await s.call('?summary=1',false);assert.equal(denied.status,403);
  const summary=await s.call('?summary=1');assert.equal(summary.status,200);assert.equal(summary.data.members.length,1);
  const member=summary.data.members[0];assert.equal(member.checkCount,2);assert.equal(member.provider,'line / schoolpark');assert.deepEqual(member.imports,[]);assert.deepEqual(member.daily,[]);assert.equal(member.chat,null);assert.ok(!JSON.stringify(summary.data).includes('SENSITIVE_TEST_TEXT'));assert.equal(member.basic.displayName,'Synthetic');assert.ok(!JSON.stringify(summary.data).includes('SENSITIVE_CONCERN_TEXT'),'summary carries the name only');
  const detail=await s.call('?uid='+encodeURIComponent(s.uid));assert.equal(detail.status,200);assert.equal(detail.data.members[0].uid,s.uid);assert.ok(JSON.stringify(detail.data).includes('SENSITIVE_TEST_TEXT'));assert.ok(JSON.stringify(detail.data).includes('SENSITIVE_CONCERN_TEXT'),'detail still shows the whole profile');
  assert.equal((await s.call('?uid=a%2Fb')).status,400);
 }finally{s.server.close();}
});
