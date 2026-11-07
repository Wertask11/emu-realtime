'use strict';
/* 11/7 創業者決定：見学（guest）の「新着20件」の制限は廃止。見学の人も、公開している知識全体を読める・探せる。
   読む以外（投稿・募集・回答・下書き）の権利は変えていない。隔離エミュレーターだけを使う。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./fixture.cjs');
let f;
before(async () => { f = await createFixture(); });
after(async () => { await f?.close(); });

test('見学でも、新着20件より古い公開投稿を開ける。検索も20件で止まらない', async () => {
  const batch = f.db.batch();
  for (let i = 0; i < 30; i++)
    batch.set(f.db.collection('posts').doc('guestread-' + String(i).padStart(2, '0')), { title: '見学の検証 ' + i, body: '見学読み取り keyword', createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60000), address: '0x' + '1'.repeat(40) });
  await batch.commit();
  const owner = { ...f.users.owner, walletAddress: f.users.owner.account.walletAddress.toLowerCase(), owner: true };
  await f.api.service.rebuild(owner); await f.api.service.waitForRebuild();
  // いちばん古い投稿（新着20件の外）
  for (const role of ['guest', null]) {
    const r = await f.call('GET', '/posts/guestread-00', role);
    assert.equal(r.status, 200, (role || 'ログインなし') + ' ' + JSON.stringify(r.body));
    assert.equal(r.body.title, '見学の検証 0');
  }
  const ids = [];
  let cursor = null;
  do {
    const r = await f.call('GET', '/search?q=' + encodeURIComponent('見学読み取り') + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 'guest');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.guestCapped, undefined);
    ids.push(...r.body.items.map((p) => p.id));
    cursor = r.body.next;
  } while (cursor);
  assert.equal(ids.filter((id) => id.startsWith('guestread-')).length, 30);
  const plans = (await f.call('GET', '/membership')).body;
  const list = Array.isArray(plans) ? plans : plans.plans || Object.values(plans);
  assert.ok(JSON.stringify(list).includes('all-public'));
  assert.ok(!JSON.stringify(list).includes('latest-20'));
});

test('読む以外の権利は変えていない：見学は公開投稿を書けない', async () => {
  const r = await f.call('PUT', '/posts', 'guest', { key: 'guest-post', title: '見学の投稿', body: '書けないはず', visibility: 'public', facets: {} });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});
