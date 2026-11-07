'use strict';
/* LAB-04・05・06（11/7）：通常の下書き（knowledge_drafts）の一覧・上限・端末からの取り込み。
   index.html の実際の関数を取り出し、本物のクライアント SDK と Rules（隔離エミュレーター）で動かす。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFixture } = require('./fixture.cjs');
const appLib = require('../quest-tests/node_modules/firebase/app');
const authLib = require('../quest-tests/node_modules/firebase/auth');
const fb = require('../quest-tests/node_modules/firebase/firestore');
const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const SRC = INDEX.slice(INDEX.indexOf('  const KNOWLEDGE_DRAFT_PAGE = 30;'), INDEX.indexOf('  /* いま持っている下書きの数。ルールがこの数を見て上限を判断する。'));
let f;
const clients = [];
before(async () => { f = await createFixture(); });
after(async () => { for (const c of clients) { await fb.terminate(c.db); await appLib.deleteApp(c.app); } await f?.close(); });

async function client(role) {
  const app = appLib.initializeApp({ apiKey: 'emulator-only', projectId: 'demo-emu-knowledge-lab' }, 'drafts-' + role + '-' + clients.length);
  const auth = authLib.getAuth(app);
  authLib.connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
  await authLib.signInWithEmailAndPassword(auth, f.users[role].email, 'Emulator-only-password-123');
  const db = fb.getFirestore(app);
  fb.connectFirestoreEmulator(db, '127.0.0.1', 8787);
  clients.push({ app, db });
  return db;
}
/* index.html の関数を、その人の画面と同じ道具立てで動かす */
async function page(role, plan) {
  const u = f.users[role];
  await f.db.collection('entitlements').doc(u.uid).set({ plan, source: 'emulator-only', startsAt: new Date(0) });
  f.entitlement.forget?.(u.uid);
  await f.entitlement.getEntitlement(u.uid, u.account); // 本番と同じく、枠の記録（plan_counts）を SPID で用意する
  const db = await client(role);
  const store = {};
  const account = u.account.walletAddress;
  const RANK = { guest: 0, light: 1, plus: 2, pro: 3 };
  const ctx = {
    /* vm の中で作ったオブジェクトは別の実行環境のものなので、SDK に渡す前にこちら側の形にする（テストの道具立てだけの事情） */
    window: { db, fbLib: { ...fb, writeBatch: (d) => { const b = fb.writeBatch(d); return { set: (r, data, o) => (o ? b.set(r, { ...data }, o) : b.set(r, { ...data })), commit: () => b.commit() }; } } },
    console: { warn: (...a) => process.env.LAB_DEBUG && console.error(...a), log() {} },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    emuAliasesNow: () => [account],
    emuHasPlan: (min) => RANK[plan] >= RANK[min],
    emuEnsureEntitlement: async () => plan,
    emuEnsureMembershipSubject: async () => {},
    _emuCountsRef: () => fb.doc(db, 'plan_counts', u.spid),
    knowledgeDraftKey: () => 'emu_knowledge_drafts_' + account,
    readLocalKnowledgeDrafts: () => { try { return JSON.parse(store['emu_knowledge_drafts_' + account] || '[]'); } catch (_) { return []; } },
    writeLocalKnowledgeDrafts: (items) => { store['emu_knowledge_drafts_' + account] = JSON.stringify(items); },
    Date, JSON, String, Number, Math, Promise, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.api={readKnowledgeDraftPage,readKnowledgeDrafts,countKnowledgeDrafts,importLocalKnowledgeDrafts,readLibraryUsed,emuLibraryCap};', ctx);
  return { ...ctx.api, db, u, account, store, ctx };
}
async function seed(u, account, n) {
  const col = f.db.collection('knowledge_drafts');
  for (let i = 0; i < n; i += 400) {
    const batch = f.db.batch();
    for (let j = i; j < Math.min(n, i + 400); j++)
      batch.set(col.doc('seed-' + u.uid + '-' + String(j).padStart(4, '0')), { owner: account, title: '下書き' + j, body: '本文', tags: '', imageUrl: '', savedAt: new Date(Date.now() - j * 1000).toISOString(), createdAt: new Date() });
    await batch.commit();
  }
  await f.db.collection('plan_counts').doc(u.spid).set({ drafts: n }, { merge: true });
}
async function readAll(api) {
  const ids = [];
  let cursor = null, pages = 0;
  do {
    const p = await api.readKnowledgeDraftPage(api.account, cursor);
    assert.ok(p.items.length <= 30, '1ページが30件を超えた');
    ids.push(...p.items.map((d) => d.id));
    cursor = p.next;
    pages++;
  } while (cursor && pages < 100);
  return { ids, pages };
}

for (const n of [0, 1, 30, 31, 100, 1000]) {
  test(`下書き ${n} 件：30件ずつ、重複も取りこぼしもなく最後まで開ける（件数も合う）`, async () => {
    const api = await page('alice', 'plus');
    await f.db.recursiveDelete(f.db.collection('knowledge_drafts'));
    await seed(api.u, api.account, n);
    const { ids, pages } = await readAll(api);
    assert.equal(ids.length, n);
    assert.equal(new Set(ids).size, n);
    assert.equal(pages, Math.max(1, Math.ceil(n / 30)));
    assert.equal(await api.countKnowledgeDrafts(api.account), n);
    assert.equal(await api.readLibraryUsed(), n);
  });
}

test('LAB-05：上限は段で決める（見学1件・light 30件・plus 以上1,000件）。Rules の libraryLimitOf と同じ', async () => {
  for (const [plan, cap] of [['guest', 1], ['light', 30], ['plus', 1000], ['pro', 1000]]) {
    const api = await page('bob', plan);
    assert.equal(api.emuLibraryCap(), cap, plan);
  }
  const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /return rank == 0 \? 1 : \(rank == 1 \? 30 : 1000\);/);
  assert.doesNotMatch(INDEX, /canDraft:typeof isFreeOnlyUser/);
  assert.doesNotMatch(INDEX, /下書きは有料パス限定です/);
});

test('LAB-06：端末の下書きは、枠の数と同じ処理でクラウドへ移す。やり直しても二重にならず、移せなかった分は端末に残す', async () => {
  await f.db.recursiveDelete(f.db.collection('knowledge_drafts'));
  // plus：3件とも移る。端末から消える
  const plus = await page('alice', 'plus');
  await f.db.collection('plan_counts').doc(plus.u.spid).set({ drafts: 0 }, { merge: true });
  const local = [1, 2, 3].map((i) => ({ id: 1700000000000 + i, title: '端末の下書き' + i, body: '本文' + i, tags: '', savedAt: new Date().toISOString() }));
  plus.ctx.writeLocalKnowledgeDrafts(local);
  assert.equal(await plus.importLocalKnowledgeDrafts(plus.account), 3);
  assert.deepEqual(plus.ctx.readLocalKnowledgeDrafts(), []);
  assert.equal(await plus.readLibraryUsed(), 3);
  // 同じ端末の原本がもう一度あっても（別のタブ・やり直し）、二重には作らず、枠も増えない
  plus.ctx.writeLocalKnowledgeDrafts(local);
  await plus.importLocalKnowledgeDrafts(plus.account);
  assert.equal((await f.db.collection('knowledge_drafts').where('owner', '==', plus.account).get()).size, 3);
  assert.equal(await plus.readLibraryUsed(), 3);
  // 見学：枠は1件。1件だけ移り、残りの2件は端末に残す（消さない）
  const guest = await page('guest', 'guest');
  await f.db.collection('plan_counts').doc(guest.u.spid).set({ drafts: 0 }, { merge: true });
  guest.ctx.writeLocalKnowledgeDrafts(local.map((d) => ({ ...d, id: d.id + 10 })));
  assert.equal(await guest.importLocalKnowledgeDrafts(guest.account), 1);
  assert.equal(guest.ctx.readLocalKnowledgeDrafts().length, 2);
  assert.equal(await guest.readLibraryUsed(), 1);
  // 一覧を開くと、クラウドの1件が出る（端末の残りは、枠が空くまで端末に残る）
  const shown = await guest.readKnowledgeDrafts(guest.account);
  assert.equal(shown.length, 1);
});

test('LAB-06（前の作り）：枠の数を増やさずに書くと Rules に断られる。だから前は取り込めていなかった', async () => {
  const api = await page('bob', 'plus');
  await assert.rejects(fb.addDoc(fb.collection(api.db, 'knowledge_drafts'), { owner: api.account, title: 'x', body: 'y', createdAt: new Date() }), (e) => e.code === 'permission-denied');
});
