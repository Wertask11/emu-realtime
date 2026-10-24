/* 知識の募集：EMUER v2（運営トレジャリーから1 EMUER）の形でも、募集の公開と採用ができる。
   9/19 に画面だけ v2 になり、決まりが古い形（uncommitted / pending_distribution）しか
   通さなかったため、募集の公開も採用も断られていた。 */
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');

const ASKER = '0xaaaa000000000000000000000000000000000001';
const ANSWERER = '0xbbbb000000000000000000000000000000000002';
let env;

function usageId(uid) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${uid}_r_m${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}
const v2Request = (over) => Object.assign({
  question: '禁煙について', context: 'どのようにやめましたか？経験者の方教えてください！',
  bounty: 1, author: ASKER, status: 'open', answerCount: 0,
  rewardPolicy: 'emuer-v2-treasury-1', settlementStatus: 'treasury_review',
  deadline: new Date(Date.now() + 7 * 86400000), createdAt: new Date()
}, over || {});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-knowledge-request',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('../../firestore.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    /* 採用は「別の二人か」を Passport（SPID）で確かめる（自分への採用を防ぐため）。
       サーバーが結び付けたときと同じ形（passportBindingVersion: 1）で置く。 */
    await fb.setDoc(fb.doc(d, 'ches_verified_accounts', 'asker'), { walletAddress: ASKER, spid: 'SP-ASKR-ASKR-ASKR-ASK1', passportBindingVersion: 1 });
    await fb.setDoc(fb.doc(d, 'ches_verified_accounts', 'answerer'), { walletAddress: ANSWERER, spid: 'SP-ANSR-ANSR-ANSR-ANS1', passportBindingVersion: 1 });
    await fb.setDoc(fb.doc(d, 'ches_wallets', ASKER), { uid: 'asker', address: ASKER, spid: 'SP-ASKR-ASKR-ASKR-ASK1', passportBindingVersion: 1 });
    await fb.setDoc(fb.doc(d, 'ches_wallets', ANSWERER), { uid: 'answerer', address: ANSWERER, spid: 'SP-ANSR-ANSR-ANSR-ANS1', passportBindingVersion: 1 });
    await fb.setDoc(fb.doc(d, 'entitlements', 'asker'), { plan: 'plus' });
    await fb.setDoc(fb.doc(d, 'entitlements', 'answerer'), { plan: 'plus' });
  });
});

async function create(uid, data) {
  const db = env.authenticatedContext(uid).firestore();
  const batch = fb.writeBatch(db);
  batch.set(fb.doc(fb.collection(db, 'knowledge_requests')), data);
  batch.set(fb.doc(db, 'plan_usage', usageId(uid)), { request: 1 }, { merge: true });
  return batch.commit();
}

test('v2 の募集（残高は減らない・1 EMUER）を公開できる。題名が短くても通る', async () => {
  await assertSucceeds(create('asker', v2Request()));
});

test('これまでの形の募集も、今までどおり公開できる', async () => {
  await assertSucceeds(create('asker', v2Request({ bounty: 3, settlementStatus: 'uncommitted', rewardPolicy: null })));
});

test('v2 の形を名乗っても、額や状態が違えば通さない', async () => {
  await assertFails(create('asker', v2Request({ bounty: 3 })));
  await assertFails(create('asker', v2Request({ rewardPolicy: 'other' })));
  await assertFails(create('asker', v2Request({ settlementStatus: 'pending_distribution' })));
  await assertFails(create('asker', v2Request({ settlementStatus: 'done' })));
  await assertFails(create('asker', v2Request({ author: ANSWERER })));   // 他人の名義では出せない
});

async function seedOpenRequest(over) {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await fb.setDoc(fb.doc(d, 'knowledge_requests', 'req1'), v2Request(over));
    await fb.setDoc(fb.doc(d, 'knowledge_answers', 'ans1'), {
      requestId: 'req1', requestAuthor: ASKER, answerAuthor: ANSWERER, status: 'submitted',
      experience: '自分は3年前にやめました。', knowledge: '最初の2週間がいちばんつらいです。', limits: '個人差あり'
    });
  });
}
function adopt(uid, reqPatch) {
  const db = env.authenticatedContext(uid).firestore();
  const batch = fb.writeBatch(db);
  batch.update(fb.doc(db, 'knowledge_answers', 'ans1'), { status: 'accepted', acceptedAt: new Date() });
  batch.update(fb.doc(db, 'knowledge_requests', 'req1'), Object.assign({
    status: 'awarded', acceptedAnswerId: 'ans1', acceptedAnswerAuthor: ANSWERER, awardedAt: new Date(),
    rewardPolicy: 'emuer-v2-treasury-1', settlementStatus: 'treasury_review'
  }, reqPatch || {}));
  return batch.commit();
}

test('v2 の採用：募集した本人は、回答を採用して運営の確認待ちにできる', async () => {
  await seedOpenRequest();
  await assertSucceeds(adopt('asker'));
});

test('v2 の採用：これまでの形で出した募集中の募集でも採用できる', async () => {
  await seedOpenRequest({ bounty: 3, settlementStatus: 'uncommitted', rewardPolicy: null });
  await assertSucceeds(adopt('asker'));
});

test('v2 の採用：本人以外・採用済み・別の回答者・ほかの欄の書き換えは通さない', async () => {
  await seedOpenRequest();
  await assertFails(adopt('answerer'));                                   // 本人以外
  await assertFails(adopt('asker', { acceptedAnswerAuthor: ASKER }));     // 回答者をすり替え
  await assertFails(adopt('asker', { bounty: 100 }));                     // 額の書き換え
  await assertFails(adopt('asker', { settlementStatus: 'done' }));        // 状態を飛ばす
  await assertSucceeds(adopt('asker'));
  await assertFails(adopt('asker'));                                      // 採用済みをもう一度
});

test('これまでの採用（募集者の残高から配る形）も、今までどおり通る', async () => {
  await seedOpenRequest({ bounty: 3, settlementStatus: 'uncommitted', rewardPolicy: null });
  const db = env.authenticatedContext('asker').firestore();
  const batch = fb.writeBatch(db);
  batch.update(fb.doc(db, 'knowledge_answers', 'ans1'), { status: 'accepted', acceptedAt: new Date() });
  batch.update(fb.doc(db, 'knowledge_requests', 'req1'), {
    status: 'awarded', acceptedAnswerId: 'ans1', acceptedAnswerAuthor: ANSWERER, awardedAt: new Date(),
    settlementStatus: 'pending_distribution'
  });
  await assertSucceeds(batch.commit());
});
