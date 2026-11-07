'use strict';
/* LAB-10（11/7）：Lab で整理した投稿でも、画像を確かめ・変え・外せる。
   画像は Firestore Rules（posts の imageUrl）と同じ決まりでだけ受け付ける。送らなければ今の画像のまま。隔離エミュレーターだけを使う。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./fixture.cjs');
let f;
before(async () => { f = await createFixture(); });
after(async () => { await f?.close(); });
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
async function normalPost(id) {
  const address = f.users.alice.account.walletAddress;
  await f.db.collection('posts').doc(id).set({ title: '画像つきの投稿', body: '本文です。', tags: '経験', address, userId: address, userType: 'paid', displayName: 'Emuer', createdAt: new Date(), updatedAt: new Date(), goodCount: 0, changeCount: 0, imageUrl: IMG });
}
const save = (id, revision, key, extra) => f.call('PUT', '/posts', 'alice', { id, revision, key, title: '画像つきの投稿', body: '本文です。', tags: '経験', visibility: 'public', facets: { field: ['field-education'] }, aiUseConsent: false, ...extra });

test('分類を付けても画像は残る。本人の編集では今の画像が返る。一覧には画像そのものを載せない', async () => {
  const id = 'img' + Date.now();
  await normalPost(id);
  assert.equal((await save(id, 0, 'img-a')).status, 200);
  assert.equal((await f.db.collection('posts').doc(id).get()).data().imageUrl, IMG);
  const mine = await f.call('GET', '/posts/' + id, 'alice');
  assert.equal(mine.body.imageUrl, IMG);
  assert.equal(mine.body.hasImage, true);
  const other = await f.call('GET', '/posts/' + id, 'bob');
  assert.equal(other.status, 200);
  assert.equal(other.body.imageUrl, undefined, '本人以外に大きな画像を返した');
  assert.equal(other.body.hasImage, true);
});

test('画像を変える・外す。大きすぎる画像や data:image 以外（SVG・http）は断る', async () => {
  const id = 'img2' + Date.now();
  await normalPost(id);
  assert.equal((await save(id, 0, 'img2-a')).status, 200);
  const NEW = 'data:image/png;base64,' + 'B'.repeat(800000);
  const changed = await save(id, 1, 'img2-b', { imageUrl: NEW });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await f.db.collection('posts').doc(id).get()).data().imageUrl, NEW);
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.invalid/a.png', 'javascript:alert(1)', 'data:image/png;base64,' + 'C'.repeat(1048001)]) {
    const r = await save(id, 2, 'img2-bad-' + bad.length, { imageUrl: bad });
    assert.ok(r.status === 400 || r.status === 413, bad.slice(0, 30) + ' → ' + r.status);
  }
  assert.equal((await f.db.collection('posts').doc(id).get()).data().imageUrl, NEW, '断った画像で上書きされた');
  const removed = await save(id, 2, 'img2-c', { imageUrl: '' });
  assert.equal(removed.status, 200);
  assert.equal('imageUrl' in (await f.db.collection('posts').doc(id).get()).data(), false);
});
