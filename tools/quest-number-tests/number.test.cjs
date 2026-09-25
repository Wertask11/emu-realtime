/* クエストの番号が重ならないか。

   番号は運営が手で指定する。自動では振らない。だから
   「同じ組み合わせを二度使わない」は、記録の決まりが守るしかない。

     予約札のID = {系列}-{番号3桁}-{枝番}-{段階}
       例：general-002-1-入門 ／ general-003-0-なし ／ special-001-0-なし

   クエスト本体と予約札を1つの取引で作り、取引の中で
   「予約札がまだ無いこと」を確かめる。文書IDは同じものを2つ作れないので、
   これがそのまま重複防止になる……はず。ここで本当にそうか確かめる。

   21本を手で番号指定して出す直前なので、ここが効いていないと
   同じ #002-1 入門 が2本できる。出したあと番号は変えられない。 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('../quest-tests/node_modules/@firebase/rules-unit-testing');
const fb = require('../quest-tests/node_modules/firebase/firestore');
const store = require('../../frontend/public/schoolpark/quest-store.js');

const OWNER = '0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7';
const MEMBER = '0xcccc000000000000000000000000000000000003';
let env, owner, member;

const base = {
  title: 'クエスト', knowledge: '知識', hypothesis: '予想', action: '行動', measure: '検証',
  budget: '0', budgetCurrency: 'EMUER', need: 10,
  owner: OWNER, ownerName: '運営', status: 'OPEN', createdAt: 1, closesAt: 2000000000000
};
const q = (extra) => Object.assign({}, base, extra);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sp-numbers',
    firestore: { host: '127.0.0.1', port: 8080,
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await fb.setDoc(fb.doc(d, 'ches_accounts', 'owner'), { walletAddress: OWNER, chesAddress: OWNER });
    await fb.setDoc(fb.doc(d, 'ches_accounts', 'member'), { walletAddress: MEMBER, chesAddress: MEMBER });
    /* 10/1 の一般公開まで、SchoolPark に入るには公式パスが要る */
    await fb.setDoc(fb.doc(d, 'paid_users', OWNER), { plan: 'official' });
    await fb.setDoc(fb.doc(d, 'paid_users', MEMBER), { plan: 'official' });
  });
  owner = env.authenticatedContext('owner').firestore();
  member = env.authenticatedContext('member').firestore();
});

/* ───────── 重複防止（ここが本丸） ───────── */

test('同じ番号は二度使えない', async () => {
  await store.createQuest(fb, owner, q({ series: 'general', questNumber: 1, branch: 0, stage: '' }));
  await assert.rejects(
    () => store.createQuest(fb, owner, q({ series: 'general', questNumber: 1, branch: 0, stage: '' })),
    /QUEST_NUMBER_TAKEN/);
});

test('枝番と段階まで含めて一意。#002-1 入門 と #002-1 標準 は別', async () => {
  await store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: 1, stage: '入門' }));
  await assertSucceeds(store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: 1, stage: '標準' })));
  await assertSucceeds(store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: 2, stage: '入門' })));
  await assert.rejects(
    () => store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: 1, stage: '入門' })),
    /QUEST_NUMBER_TAKEN/);
});

test('系列が違えば、同じ #001 が両方にある', async () => {
  await store.createQuest(fb, owner, q({ series: 'general', questNumber: 1, branch: 0, stage: '' }));
  await assertSucceeds(store.createQuest(fb, owner, q({ series: 'special', questNumber: 1, branch: 0, stage: '' })));
});

test('同時に同じ番号を取りに行っても、通るのは1本だけ', async () => {
  const tries = Array.from({ length: 5 }, () =>
    store.createQuest(fb, owner, q({ series: 'general', questNumber: 7, branch: 0, stage: '' }))
      .then(() => 'ok').catch(() => 'ng'));
  const got = await Promise.all(tries);
  assert.equal(got.filter((x) => x === 'ok').length, 1, '同じ番号が2本以上通った');
});

test('WORK の15本（5分野 × 3段階）が、全部別の番号として通る', async () => {
  const made = [];
  for (const b of [1, 2, 3, 4, 5]) {
    for (const s of ['入門', '標準', '実践']) {
      made.push(await store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: b, stage: s })));
    }
  }
  assert.equal(made.length, 15);
  const keys = made.map((x) => store.numberKey(x.series, x.questNumber, x.branch, x.stage));
  assert.equal(new Set(keys).size, 15, '同じ予約札が2つできている');
});

/* ───────── 予約札そのもの ───────── */

test('予約札のIDは、画面と記録の決まりで同じ文字列になる', async () => {
  const made = await store.createQuest(fb, owner, q({ series: 'general', questNumber: 2, branch: 1, stage: '入門' }));
  const key = store.numberKey('general', 2, 1, '入門');
  assert.equal(key, 'general-002-1-入門');
  const snap = await fb.getDoc(fb.doc(owner, 'sp_quest_numbers', key));
  assert.ok(snap.exists(), '決まりが作った予約札のIDが、画面の作るIDと違う');
  assert.equal(snap.data().questId, made.id);
});

test('予約札は、あとから書き換えも削除もできない（番号の付け替え防止）', async () => {
  const made = await store.createQuest(fb, owner, q({ series: 'general', questNumber: 1, branch: 0, stage: '' }));
  const key = store.numberKey('general', 1, 0, '');
  await assertFails(fb.updateDoc(fb.doc(owner, 'sp_quest_numbers', key), { questId: 'other' }));
  await assertFails(fb.deleteDoc(fb.doc(owner, 'sp_quest_numbers', key)));
  void made;
});

test('予約札だけを先に立てることはできない', async () => {
  await assertFails(fb.setDoc(fb.doc(owner, 'sp_quest_numbers', 'general-009-0-なし'), { questId: 'nothing' }));
});

/* ───────── 出せるのは誰か ───────── */

test('クエストを出せるのは運営だけ', async () => {
  await assert.rejects(
    () => store.createQuest(fb, member, q({ series: 'general', questNumber: 1, branch: 0, stage: '',
      owner: MEMBER, ownerName: 'ふつうの人' })));
});

test('番号を持たないクエストは出せない', async () => {
  await assertFails(fb.addDoc(fb.collection(owner, 'sp_quests'), base));
});

test('形の外れた番号は、画面の側で止まる', async () => {
  const bad = [
    { series: 'other',   questNumber: 1, branch: 0, stage: '',   why: /SERIES/ },
    { series: 'general', questNumber: 0, branch: 0, stage: '',   why: /NUMBER/ },
    { series: 'general', questNumber: 1000, branch: 0, stage: '', why: /NUMBER/ },
    { series: 'general', questNumber: 1, branch: 6, stage: '',   why: /BRANCH/ },
    { series: 'general', questNumber: 1, branch: 0, stage: '上級', why: /STAGE/ }
  ];
  for (const b of bad) {
    await assert.rejects(() => store.createQuest(fb, owner, q(b)), b.why, JSON.stringify(b));
  }
});

test('形の外れた番号は、記録の決まりの側でも止まる（画面を通さず書いても）', async () => {
  const bad = [
    { series: 'other',   questNumber: 1,    branch: 0, stage: '' },
    { series: 'general', questNumber: 0,    branch: 0, stage: '' },
    { series: 'general', questNumber: 1000, branch: 0, stage: '' },
    { series: 'general', questNumber: 1,    branch: 6, stage: '' },
    { series: 'general', questNumber: 1,    branch: 0, stage: '上級' }
  ];
  for (const b of bad) {
    await assertFails(fb.addDoc(fb.collection(owner, 'sp_quests'), q(b)));
  }
});

test('Quest #000 のふりはできない', async () => {
  await assertFails(fb.addDoc(fb.collection(owner, 'sp_quests'),
    q({ series: 'general', questNumber: 0, branch: 0, stage: '', kind: 'founder' })));
  await assertFails(fb.setDoc(fb.doc(owner, 'sp_quests', 'founder-quest-000'),
    q({ series: 'general', questNumber: 1, branch: 0, stage: '' })));
});

test('出したあと、番号と条件は動かせない（受けた人が見た条件が変わらないように）', async () => {
  const made = await store.createQuest(fb, owner, q({ series: 'general', questNumber: 1, branch: 0, stage: '' }));
  const ref = fb.doc(owner, 'sp_quests', made.id);
  await assertFails(fb.updateDoc(ref, { questNumber: 5 }));
  await assertFails(fb.updateDoc(ref, { series: 'special' }));
  await assertFails(fb.updateDoc(ref, { branch: 3 }));
  await assertFails(fb.updateDoc(ref, { stage: '実践' }));
  await assertFails(fb.updateDoc(ref, { title: '別の題' }));
  await assertFails(fb.updateDoc(ref, { budget: '99999' }));
  await assertFails(fb.updateDoc(ref, { closesAt: 9000000000000 }));
  /* 動かせるのは進み具合だけ */
  await assertSucceeds(fb.updateDoc(ref, { status: 'RUNNING' }));
  await assertSucceeds(fb.updateDoc(ref, { status: 'CLOSED', closedAt: 1 }));
});
