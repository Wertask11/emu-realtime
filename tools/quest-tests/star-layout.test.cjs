/* 星空の星座の並び（sp_star_layouts/{uid}）。11/20 オーナー：黄道12星座・星の入れ替え・自分だけの星座。
   本人だけが読み書きでき、決まった欄・大きさだけを置ける。消せない。 */
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-star-layouts',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('../../firestore.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const good = () => ({
  slots: ['learning', 'nft', 'learning'],
  customs: [{ name: 'はじまり座', points: [{ x: 0, y: 1, t: 'nft' }], lines: [{ a: 0, b: 0 }] }],
  completed: { aries: 1763600000000 },
  updatedAt: 1763600000000,
});

test('本人は自分の並びを作り・読み・書き換えられる', async () => {
  const db = env.authenticatedContext('alice').firestore();
  const ref = fb.doc(db, 'sp_star_layouts', 'alice');
  await assertSucceeds(fb.setDoc(ref, good()));
  await assertSucceeds(fb.getDoc(ref));
  await assertSucceeds(fb.setDoc(ref, { ...good(), slots: ['nft', 'learning', 'learning'] }));
});

test('ほかの人の並びは読めない・書けない。ログインしていない人も同じ', async () => {
  await env.withSecurityRulesDisabled(async ctx => { await fb.setDoc(fb.doc(ctx.firestore(), 'sp_star_layouts', 'alice'), good()); });
  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(fb.getDoc(fb.doc(bob, 'sp_star_layouts', 'alice')));
  await assertFails(fb.setDoc(fb.doc(bob, 'sp_star_layouts', 'alice'), good()));
  const guest = env.unauthenticatedContext().firestore();
  await assertFails(fb.getDoc(fb.doc(guest, 'sp_star_layouts', 'alice')));
  await assertFails(fb.setDoc(fb.doc(guest, 'sp_star_layouts', 'alice'), good()));
});

test('決まった欄以外・大きすぎるものは置けない（星の数そのものも置けない）', async () => {
  const ref = fb.doc(env.authenticatedContext('alice').firestore(), 'sp_star_layouts', 'alice');
  await assertFails(fb.setDoc(ref, { ...good(), counts: { learning: 999 } }));
  await assertFails(fb.setDoc(ref, { ...good(), slots: Array(601).fill('learning') }));
  await assertFails(fb.setDoc(ref, { ...good(), customs: [1, 2, 3, 4].map(() => good().customs[0]) }));
  await assertFails(fb.setDoc(ref, { ...good(), completed: 'all' }));
  await assertFails(fb.setDoc(ref, { ...good(), updatedAt: 'now' }));
  await assertSucceeds(fb.setDoc(ref, { ...good(), slots: Array(600).fill('learning') }));
});

test('並びは消せない', async () => {
  const ref = fb.doc(env.authenticatedContext('alice').firestore(), 'sp_star_layouts', 'alice');
  await assertSucceeds(fb.setDoc(ref, good()));
  await assertFails(fb.deleteDoc(ref));
});
