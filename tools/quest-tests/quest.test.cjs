/* Quest #000 と、クエストの出し方の決まりを確かめる。

   番号の決まり（一般／特殊・枝番・段階・重複防止）は、
   PR #94 で自動採番から手で指定する形に変わった。
   そちらの試しは tools/quest-number-tests に移してある。
   ここに残すのは #000 まわりと、受け付け・報告・完了の道すじ。

   admin SDK はエミュレータの場所を環境変数から読む。
   入れておかないと本物の Google に繋ぎに行き、資格が無いと言って落ちる。 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
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
    /* 10/1 の一般公開まで、SchoolPark に入るには公式パスが要る（canAccessSchoolPark）。
       この試しを書いたときは、まだこの門が無かった。 */
    await fb.setDoc(fb.doc(seedDb,'paid_users',owner),{plan:'official'});
    await fb.setDoc(fb.doc(seedDb,'paid_users','member'),{plan:'official'});
  });
  db=env.authenticatedContext('founder').firestore();
  guest=env.authenticatedContext('member').firestore();
});
after(async () => { await env?.cleanup(); });
/* 自動採番の世界の試し3本（番号なしで先に出せる／#001 から順に振られる／
   飛ばした番号・重複・偽の通し番号を書けない）は、ここから外した。
   いまは運営が番号を指定する形なので、そのまま置いても意味が変わる。
   tools/quest-number-tests に、いまの仕組みで書き直してある
   （重複防止・同時に取りに行ったとき・予約札の付け替え防止など14本）。 */
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
test('ふつうのクエストは、受け付け・報告・完了が通る。番号と条件は動かせない',async()=>{
  const q=await store.createQuest(fb,db,{...normal,series:'general',questNumber:1,branch:0,stage:''});
  assert.equal(q.questNumber,1);
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

test('#000 の種まきは、同時に2回走らせても1件しか作らない',async()=>{
  /* エミュレータは走らせっぱなしなので、前の回の種が残っていることがある。
     残っていると「もう在る」と判断され、作った数が 0 になって落ちる。
     この試しの持ち場だけ、先に空にしてから始める。 */
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST
    + '/emulator/v1/projects/demo-schoolpark-seed/databases/(default)/documents',
    { method: 'DELETE' });
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
