'use strict';
/* 下書きの置き場所をひとつに（11/7 創業者承認）。
   ・知識を読むの下書きも、Knowledge Lab の下書き（knowledge_lab_private_posts）に置く
   ・前の置き場所（knowledge_drafts）の分は、本人が開いたときにサーバーが移す。元は消さず、移した印だけを付ける
   ・下書きの数（plan_counts）は移しても変わらない。二重に移さない。他の人の分は移さない
   ・消すと Lab のアーカイブへ（あとで戻せる）。Lab に届かないときは前の置き場所に書き、次に開いたときに移す
   index.html の実際の関数を取り出し、本物のクライアント SDK・Lab API・Rules（隔離エミュレーター）で動かす。 */
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
const SRC = INDEX.slice(INDEX.indexOf('  const KNOWLEDGE_DRAFT_PAGE = 30;'), INDEX.indexOf('  /* 投稿の書き手の、いまの名前と写真（user_profiles。誰でも読める）。'));
let f;
const clients = [];
before(async () => { f = await createFixture(); });
after(async () => { for (const c of clients) { await fb.terminate(c.db); await appLib.deleteApp(c.app); } await f?.close(); });

async function page(role, plan, { labDown = false } = {}) {
  const u = f.users[role];
  await f.db.collection('entitlements').doc(u.uid).set({ plan, source: 'emulator-only', startsAt: new Date(0) });
  f.entitlement.forget?.(u.uid);
  await f.entitlement.getEntitlement(u.uid, u.account);
  const app = appLib.initializeApp({ apiKey: 'emulator-only', projectId: 'demo-emu-knowledge-lab' }, 'unify-' + role + '-' + clients.length);
  const auth = authLib.getAuth(app);
  authLib.connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
  await authLib.signInWithEmailAndPassword(auth, u.email, 'Emulator-only-password-123');
  const db = fb.getFirestore(app);
  fb.connectFirestoreEmulator(db, '127.0.0.1', 8787);
  clients.push({ app, db });
  const store = {};
  const account = u.account.walletAddress;
  const RANK = { guest: 0, light: 1, plus: 2, pro: 3 };
  const realm = (o) => (o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : o);
  const ctx = {
    window: {
      db, auth: { currentUser: { uid: u.uid } },
      emuAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + u.token }),
      fbLib: { ...fb, writeBatch: (d) => { const b = fb.writeBatch(d); return { set: (r, data, o) => (o ? b.set(r, { ...data }, o) : b.set(r, { ...data })), delete: (r) => b.delete(r), commit: () => b.commit() }; },
        updateDoc: (r, data) => fb.updateDoc(r, { ...data }) },
    },
    fetch: async (url, opts) => { if (labDown) throw new Error('offline'); return fetch(f.base + url, opts); },
    console: { warn() {}, log() {} }, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    emuAliasesNow: () => [account], emuHasPlan: (min) => RANK[plan] >= RANK[min],
    emuEnsureEntitlement: async () => plan, emuEnsureMembershipSubject: async () => {},
    _emuUid: () => u.uid, sendKnowledge: () => {},
    knowledgeDraftKey: () => 'emu_knowledge_drafts_' + account,
    readLocalKnowledgeDrafts: () => { try { return JSON.parse(store['emu_knowledge_drafts_' + account] || '[]'); } catch (_) { return []; } },
    writeLocalKnowledgeDrafts: (items) => { store['emu_knowledge_drafts_' + account] = JSON.stringify(items); },
    Date, JSON, String, Number, Math, Promise, Error, Object, Array, Map, encodeURIComponent,
  };
  ctx.window.crypto = ctx.crypto;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.api={readKnowledgeDrafts,createKnowledgeDraft,updateKnowledgeDraft,deleteKnowledgeDraft,readLibraryUsed};', ctx);
  ctx.window.emuEntitlementSchoolParkId = u.spid;
  const api = ctx.api;
  return { ...api, u, account, ctx, db, realm, plan };
}
const counts = async (u) => Number((await f.db.collection('plan_counts').doc(u.spid).get()).data()?.drafts || 0);
const priv = (id) => f.db.collection('knowledge_lab_private_posts').doc(id).get();

test('前の置き場所の下書きを、開いたときに Lab の下書きへ移す。元は残し、数は変わらず、二重にも移さない。他の人の分は移さない', async () => {
  const alice = await page('alice', 'plus');
  const bob = f.users.bob;
  const kd = f.db.collection('knowledge_drafts');
  const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  await kd.doc('legacy-a1').set({ owner: alice.account, title: '前の下書き1', body: '本文1', tags: '経験,習慣', imageUrl: IMG, savedAt: '2026-11-01T00:00:00.000Z', createdAt: new Date(Date.UTC(2026, 10, 1)),
    lab: { facets: { field: ['field-education', 'field-nope'] }, period: '2025年', aiUseConsent: true, verification: 'in-progress' } });
  await kd.doc('legacy-a2').set({ owner: alice.account, title: '', body: '題名のない下書き', tags: '', imageUrl: 'javascript:alert(1)', savedAt: '2026-11-02T00:00:00.000Z' });
  await kd.doc('legacy-b1').set({ owner: bob.account.walletAddress, title: 'ボブの下書き', body: '本文', tags: '' });
  await f.db.collection('plan_counts').doc(alice.u.spid).set({ drafts: 2 }, { merge: true });
  const items = await alice.readKnowledgeDrafts(alice.account);
  const ids = items.map((d) => d.id);
  assert.ok(ids.includes('kd-legacy-a1') && ids.includes('kd-legacy-a2'), JSON.stringify(ids));
  assert.ok(!ids.includes('legacy-a1'), '移した元を二重に出した');
  assert.ok(!ids.includes('kd-legacy-b1'));
  // 元の文書は消えていない（印だけ）
  assert.equal((await kd.doc('legacy-a1').get()).data().movedTo, 'kd-legacy-a1');
  assert.equal((await kd.doc('legacy-a1').get()).data().body, '本文1');
  assert.equal((await kd.doc('legacy-b1').get()).data().movedTo, undefined, '他の人の分を移した');
  const a1 = (await priv('kd-legacy-a1')).data();
  assert.equal(a1.visibility, 'draft');
  assert.equal(a1.imageUrl, IMG);
  assert.deepEqual(a1.knowledgeLab.facets.field, ['field-education'], '使えない分類を残した');
  assert.equal(a1.knowledgeLab.aiUseConsent.allowed, true, '本人が付けていた同意を落とした');
  assert.equal(a1.knowledgeLab.verification, 'in-progress');
  const a2 = (await priv('kd-legacy-a2')).data();
  assert.equal(a2.title, '（無題の下書き）');
  assert.equal('imageUrl' in a2, false, '安全でない画像を移した');
  assert.equal(a2.knowledgeLab.aiUseConsent.allowed, false);
  assert.equal(await counts(alice.u), 2, '移しただけで数が変わった');
  // もう一度移しても二重にならない
  const again = await f.call('POST', '/me/drafts/import', 'alice', {});
  assert.equal(again.status, 200);
  assert.equal(again.body.moved, 0);
  assert.equal(await counts(alice.u), 2);
  // 一覧の形（知識を読むで開ける）
  const one = items.find((d) => d.id === 'kd-legacy-a1');
  assert.equal(one.source, 'lab');
  assert.equal(one.labOnly, false);
  assert.equal(one.hasImage, true);
  assert.equal(one.lab.period, '2025年');
});

test('新しい下書きは Lab の下書きに置く。数は1つ増える。開き直して上書き・消す（アーカイブへ）で数が戻る', async () => {
  const alice = await page('alice', 'plus');
  const before = await counts(alice.u);
  const made = await alice.createKnowledgeDraft(alice.account, alice.realm({ title: '新しい下書き', body: '本文です', tags: '経験', imageUrl: '', lab: { facets: { field: ['field-education'] }, learned: '学び' } }));
  assert.equal(made.source, 'lab');
  assert.equal(await counts(alice.u), before + 1);
  const saved = (await priv(made.id)).data();
  assert.equal(saved.visibility, 'draft');
  assert.equal(saved.knowledgeLab.learned, '学び');
  assert.equal(saved.knowledgeLab.aiUseConsent.allowed, false, 'AI の同意を勝手に付けた');
  assert.equal((await f.db.collection('knowledge_drafts').where('title', '==', '新しい下書き').get()).size, 0, '前の置き場所にも書いた');
  await alice.updateKnowledgeDraft(alice.account, made.id, alice.realm({ title: '直した下書き', body: '直した本文', tags: '', imageUrl: '', draftSource: 'lab' }));
  const updated = (await priv(made.id)).data();
  assert.equal(updated.title, '直した下書き');
  assert.equal(updated.knowledgeLab.revision, 2);
  assert.equal(await counts(alice.u), before + 1, '上書きで数が増えた');
  await alice.deleteKnowledgeDraft(alice.account, made.id, 'lab');
  assert.equal((await priv(made.id)).exists, false);
  assert.equal((await f.db.collection('knowledge_lab_archived_posts').doc(made.id).get()).exists, true, 'アーカイブに残っていない');
  assert.equal(await counts(alice.u), before, '消しても数が戻らない');
});

test('見学の上限（1件）は Lab でも同じ。いっぱいなら断る', async () => {
  const guest = await page('guest', 'guest');
  await f.db.collection('plan_counts').doc(guest.u.spid).set({ drafts: 1 }, { merge: true });
  await assert.rejects(guest.createKnowledgeDraft(guest.account, guest.realm({ title: 'x', body: 'y', tags: '', imageUrl: '' })), (e) => e.message === 'LIBRARY_FULL' && e.cap === 1);
});

test('Lab に届かないときは前の置き場所に書いて失わない。次に開いたときに移す', async () => {
  const down = await page('bob', 'plus', { labDown: true });
  await f.db.collection('plan_counts').doc(down.u.spid).set({ drafts: 0 }, { merge: true });
  const made = await down.createKnowledgeDraft(down.account, down.realm({ title: 'つながらない時の下書き', body: '本文', tags: '', imageUrl: '' }));
  assert.notEqual(made.source, 'lab');
  assert.equal((await f.db.collection('knowledge_drafts').doc(made.id).get()).exists, true);
  assert.equal(await counts(down.u), 1);
  const shown = await down.readKnowledgeDrafts(down.account);
  assert.ok(shown.some((d) => d.id === made.id), 'つながらない間も一覧に出る');
  const up = await page('bob', 'plus');
  const after = await up.readKnowledgeDrafts(up.account, { refresh: true });
  assert.ok(after.some((d) => d.id === 'kd-' + made.id), JSON.stringify(after.map((d) => d.id)));
  assert.ok(!after.some((d) => d.id === made.id));
  assert.equal(await counts(up.u), 1);
});
