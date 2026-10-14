'use strict';
const {test,before,after}=require('node:test');const fs=require('node:fs');const path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('../quest-tests/node_modules/@firebase/rules-unit-testing');
const fb=require('../quest-tests/node_modules/firebase/firestore');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-emu-knowledge-lab-rules',firestore:{host:'127.0.0.1',port:8787,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const col of ['writers','private_posts','notes','saved','search','taxonomy','history','system','operations','post_control','limits','reports','audit'])await fb.setDoc(fb.doc(db,'knowledge_lab_'+col,'secret'),{privateBody:'PRIVATE_TEST_ONLY'});for(const [uid,address]of [['alice','0x1111111111111111111111111111111111111111'],['owner','0xdcc687c05f130e57597a8525771299a4efb6edf7']]){await fb.setDoc(fb.doc(db,'ches_accounts',uid),{walletAddress:address,chesAddress:address});await fb.setDoc(fb.doc(db,'ches_verified_accounts',uid),{walletAddress:address,chesAddress:address});await fb.setDoc(fb.doc(db,'entitlements',uid),{plan:'plus',source:'emulator-only'});}await fb.setDoc(fb.doc(db,'posts','lab-public'),{address:'0x1111111111111111111111111111111111111111',title:'public',body:'公開本文',knowledgeLab:{revision:1}});});});
after(async()=>{await env?.cleanup();});
test('anonymous, authenticated and Owner clients cannot read/write server-only Lab data',async()=>{
  for(const context of [env.unauthenticatedContext(),env.authenticatedContext('alice'),env.authenticatedContext('owner')]){
    const db=context.firestore();for(const name of ['writers','private_posts','notes','saved','search','taxonomy','history','system','operations','post_control','limits','reports','audit']){
      await assertFails(fb.getDoc(fb.doc(db,'knowledge_lab_'+name,'secret')));await assertFails(fb.getDocs(fb.collection(db,'knowledge_lab_'+name)));await assertFails(fb.setDoc(fb.doc(db,'knowledge_lab_'+name,'forged'),{authorSchoolParkId:'victim'}));await assertFails(fb.deleteDoc(fb.doc(db,'knowledge_lab_'+name,'secret')));
    }
    await assertFails(fb.setDoc(fb.doc(db,'knowledge_lab_future','entry','nested','secret'),{body:'private'}));
  }
});
test('existing public posts stay readable; Lab edits must use server revision checks',async()=>{
  await assertSucceeds(fb.getDoc(fb.doc(env.unauthenticatedContext().firestore(),'posts','lab-public')));
  await assertFails(fb.updateDoc(fb.doc(env.authenticatedContext('alice').firestore(),'posts','lab-public'),{title:'client-overwrite'}));
});
test('normal posting quota remains valid, but forged Lab attribution and private root posts are rejected',async()=>{
  const db=env.authenticatedContext('alice').firestore(),d=new Date(Date.now()+9*3600000),usage='alice_r_m'+d.getUTCFullYear()+'-'+(d.getUTCMonth()+1);
  const post={address:'0x1111111111111111111111111111111111111111',title:'通常投稿',body:'本文',goodCount:0,changeCount:0,goodUsers:[],changeUsers:[],createdAt:new Date()};
  let batch=fb.writeBatch(db);batch.set(fb.doc(db,'plan_usage',usage),{post:1});batch.set(fb.doc(db,'posts','normal'),post);await assertSucceeds(batch.commit());
  for(const extra of [{authorSchoolParkId:'SP-OTHER'},{knowledgeLab:{revision:1}},{visibility:'private'}]){batch=fb.writeBatch(db);batch.set(fb.doc(db,'plan_usage',usage),{post:2});batch.set(fb.doc(db,'posts','forged'),{...post,...extra});await assertFails(batch.commit());}
});
test('existing Good and Change work, linked identities cannot self-award, withdrawn content receives no new reactions',async()=>{
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const [uid,spid,address]of [['bob','SP-BOB','0x2222222222222222222222222222222222222222'],['linked','SP-ALICE','0x3333333333333333333333333333333333333333']]){await fb.setDoc(fb.doc(db,'ches_accounts',uid),{walletAddress:address,chesAddress:address,spid});await fb.setDoc(fb.doc(db,'ches_verified_accounts',uid),{walletAddress:address,chesAddress:address,spid});await fb.setDoc(fb.doc(db,'entitlements',uid),{plan:'plus',source:'emulator-only'});}await fb.setDoc(fb.doc(db,'posts','reaction-public'),{address:'0x1111111111111111111111111111111111111111',authorSchoolParkId:'SP-ALICE',knowledgeLab:{revision:1},visibility:'public',title:'公開知識',body:'本文',goodCount:0,changeCount:0,goodUsers:[],changeUsers:[]});await fb.setDoc(fb.doc(db,'posts','withdrawn'),{address:'0x1111111111111111111111111111111111111111',visibility:'withdrawn',knowledgeLab:{revision:2,tombstone:true},body:'',goodCount:0,changeCount:0,goodUsers:[],changeUsers:[]});});
  const bob=env.authenticatedContext('bob').firestore(),linked=env.authenticatedContext('linked').firestore();
  await assertFails(fb.updateDoc(fb.doc(linked,'posts','reaction-public'),{goodCount:1,goodUsers:['0x3333333333333333333333333333333333333333']}));
  await assertSucceeds(fb.updateDoc(fb.doc(bob,'posts','reaction-public'),{goodCount:1,goodUsers:['0x2222222222222222222222222222222222222222']}));
  await assertSucceeds(fb.updateDoc(fb.doc(bob,'posts','reaction-public'),{changeCount:1,changeUsers:['0x2222222222222222222222222222222222222222']}));
  await assertFails(fb.updateDoc(fb.doc(bob,'posts','withdrawn'),{goodCount:1,goodUsers:['0x2222222222222222222222222222222222222222']}));
});
