const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');
const store = require('../../frontend/public/schoolpark/quest-store.js');
const payload = require('./fixture.json');
const admin = require('../../backend/node_modules/firebase-admin');
const { seed } = require('../seed-founder-quest.cjs');
const owner = '0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7';
let env, db, guest;
const normal = { title:'通常Quest', knowledge:'知識', hypothesis:'予想', action:'行動', measure:'検証', budget:'0', budgetCurrency:'JPY', need:1, owner, ownerName:'Founder', status:'OPEN', createdAt:1, closesAt:2 };
before(async () => {
  env = await initializeTestEnvironment({ projectId:'demo-schoolpark-quests', firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('../../firestore.rules','utf8')} });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const seedDb=c.firestore();
    await fb.setDoc(fb.doc(seedDb,'ches_accounts','founder'),{walletAddress:owner,chesAddress:owner});
    await fb.setDoc(fb.doc(seedDb,'ches_accounts','member'),{walletAddress:'member',chesAddress:'member'});
  });
  db=env.authenticatedContext('founder').firestore();
  guest=env.authenticatedContext('member').firestore();
});
after(async () => { await env?.cleanup(); });
test('pre-activation preserves legacy issuing; cannot create a fake founder or counter',async()=>{
  const q=await store.createQuest(fb,db,normal);
  assert.equal(q.questNumber,null);
  await assertFails(fb.setDoc(fb.doc(db,'sp_quests','fake'),{...normal,kind:'founder',questNumber:0}));
  await assertFails(fb.setDoc(fb.doc(db,'sp_quest_counters','quests'),{nextNumber:1}));
  await assertFails(fb.setDoc(fb.doc(guest,'sp_quest_numbers','0'),{questId:'fake'}));
});
test('activate Founder singleton with complete text (Admin-only)',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    const d=c.firestore();const b=fb.writeBatch(d);
    b.set(fb.doc(d,'sp_quests',store.FOUNDER_ID),{...normal,title:'SchoolPark Quest #000',kind:'founder',questNumber:0,closesAt:null,founderVersion:1,founderSections:payload.sections});
    b.set(fb.doc(d,'sp_quests',store.FOUNDER_ID,'commits',owner),{name:'Founder',tookAt:1});
    b.set(fb.doc(d,'sp_quest_counters','quests'),{nextNumber:1,lastQuestId:store.FOUNDER_ID});
    b.set(fb.doc(d,'sp_quest_numbers','0'),{questId:store.FOUNDER_ID});
    await b.commit();
  });
  const d=(await fb.getDoc(fb.doc(db,'sp_quests',store.FOUNDER_ID))).data();
  assert.deepEqual(d.founderSections,payload.sections);
  assert.equal(d.founderSections.length,6);
  assert.ok(d.founderSections[0].body.length>50000);
  await assertFails(fb.updateDoc(fb.doc(db,'sp_quests',store.FOUNDER_ID),{status:'CLOSED',closedAt:1}));
  await assertFails(fb.deleteDoc(fb.doc(db,'sp_quests',store.FOUNDER_ID)));
  await assertFails(fb.deleteDoc(fb.doc(db,'sp_quests',store.FOUNDER_ID,'commits',owner)));
  await assertFails(fb.setDoc(fb.doc(guest,'sp_quests',store.FOUNDER_ID,'commits','member'),{name:'other',tookAt:2}));
  await assertFails(fb.addDoc(fb.collection(db,'sp_quests',store.FOUNDER_ID,'logs'),{author:owner,body:'log',kind:'やってみた'}));
});
test('concurrent creation assigns #001 onwards, no duplicates or gaps',async()=>{
  const made=await Promise.all(Array.from({length:5},(_,i)=>store.createQuest(fb,db,{...normal,title:'Quest '+i})));
  assert.deepEqual(made.map(q=>q.questNumber).sort((a,b)=>a-b),[1,2,3,4,5]);
  for(const q of made){
    assert.equal((await fb.getDoc(fb.doc(db,'sp_quest_numbers',String(q.questNumber)))).data().questId,q.id);
  }
  assert.equal((await fb.getDoc(fb.doc(db,'sp_quest_counters','quests'))).data().nextNumber,6);
});
test('cannot issue unnumbered, duplicate, skipped, forged or standalone sequence writes',async()=>{
  await assertFails(fb.addDoc(fb.collection(db,'sp_quests'),normal));
  for(const questNumber of [0,1,6,99]) await assertFails(fb.addDoc(fb.collection(db,'sp_quests'),{...normal,questNumber}));
  await assertFails(fb.updateDoc(fb.doc(db,'sp_quest_counters','quests'),{nextNumber:7,lastQuestId:'fake'}));
  await assertFails(fb.setDoc(fb.doc(db,'sp_quest_numbers','6'),{questId:'fake'}));
  await assertFails(fb.updateDoc(fb.doc(db,'sp_quest_numbers','1'),{questId:'fake'}));
  await assertFails(fb.deleteDoc(fb.doc(db,'sp_quest_numbers','1')));
  await assertFails(store.createQuest(fb,guest,{...normal,owner:'member'}));
  await assertFails(store.createQuest(fb,db,{...normal,kind:'founder',founderSections:payload.sections}));
});
test('normal Quest accepts participation, logs and close; number and conditions immutable',async()=>{
  const q=await store.createQuest(fb,db,normal);
  assert.equal(q.questNumber,6);
  await assertSucceeds(fb.setDoc(fb.doc(guest,'sp_quests',q.id,'commits','member'),{name:'Member',tookAt:1}));
  await assertSucceeds(fb.addDoc(fb.collection(guest,'sp_quests',q.id,'logs'),{author:'member',body:'通常の検証',kind:'やってみた'}));
  await assertFails(fb.updateDoc(fb.doc(db,'sp_quests',q.id),{questNumber:100}));
  await assertFails(fb.updateDoc(fb.doc(db,'sp_quests',q.id),{title:'差し替え'}));
  await assertSucceeds(fb.updateDoc(fb.doc(db,'sp_quests',q.id),{status:'RUNNING'}));
  await assertSucceeds(fb.updateDoc(fb.doc(db,'sp_quests',q.id),{status:'CLOSED',closedAt:2}));
  await assertSucceeds(fb.deleteDoc(fb.doc(guest,'sp_quests',q.id,'commits','member')));
  assert.equal(store.label({questNumber:0}),'#000');
  assert.equal(store.label({questNumber:1000}),'#1000');
  assert.equal(store.label({}),'');
});

test('actual seed is idempotent under concurrent retries and preserves full source',async()=>{
  const app=admin.initializeApp({projectId:'demo-schoolpark-seed'},'seed-test');
  const seedDb=app.firestore();
  const results=await Promise.all([seed(seedDb,payload,require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex')),seed(seedDb,payload,require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex'))]);
  assert.equal(results.filter(r=>r.created).length,1);
  const quests=await seedDb.collection('sp_quests').get();
  assert.equal(quests.size,1);
  assert.deepEqual(quests.docs[0].data().founderSections,payload.sections);
  const members=await quests.docs[0].ref.collection('commits').get();
  assert.equal(members.size,1);
  assert.equal((await seedDb.collection('sp_quest_counters').doc('quests').get()).data().nextNumber,1);
  await app.delete();
});
