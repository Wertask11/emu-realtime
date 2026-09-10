/* #000 の記録が欠けていても、画面が落ちないことを確かめる。

   ギルドとクエストは同じ dao.html の中にある。
   founderSections を素通しにしていたころは、その欄が1つ欠けた記録が1件あるだけで
   描画そのものが落ち、ギルドもクエストもまとめて消えた。
   記録の側は直せても、直すまでのあいだ画面が真っ白になってよい理由はない。

   使い方: node --test tools/quest-tests/founder-sections.test.cjs        */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../../frontend/public/schoolpark/quest-store.js');

const founder = extra => Object.assign(
  { id: store.FOUNDER_ID, kind: 'founder', questNumber: 0 }, extra);

test('全文がそろっていれば、そのまま出す', () => {
  const q = founder({ founderSections: [{ title: 'SchoolPark論文', body: '本文' }] });
  assert.deepEqual(store.sections(q), [{ title: 'SchoolPark論文', body: '本文' }]);
});

test('欄ごと無いときは、空の並びを返す（undefined を返さない）', () => {
  assert.deepEqual(store.sections(founder()), []);
});

test('並びでないものが入っていても、空の並びを返す', () => {
  for (const bad of ['本文', 0, {}, null, true]) {
    assert.deepEqual(store.sections(founder({ founderSections: bad })), [],
      '形が崩れた記録: ' + JSON.stringify(bad));
  }
});

test('中身が欠けていても、題と本文は必ず文字列になる', () => {
  const q = founder({ founderSections: [null, {}, { title: '起業観①' }, { body: '人生観' }] });
  assert.deepEqual(store.sections(q), [
    { title: '', body: '' },
    { title: '', body: '' },
    { title: '起業観①', body: '' },
    { title: '', body: '人生観' }
  ]);
});

test('#000 でないクエストは、全文を持たない', () => {
  const ordinary = { id: 'abc123', questNumber: 1, founderSections: [{ title: 'x', body: 'y' }] };
  assert.deepEqual(store.sections(ordinary), []);
});

/* kind と questNumber は #000 の見分けそのもの。
   記録の取り込みで文字列になりやすいので、そこも確かめる。 */
test('kind や questNumber が文字列になっていたら、#000 とは見なさない', () => {
  assert.equal(store.isFounder(founder()), true);
  assert.equal(store.isFounder(founder({ questNumber: '0' })), false);
  assert.equal(store.isFounder(founder({ kind: 'Founder' })), false);
  assert.deepEqual(store.sections(founder({ questNumber: '0' })), []);
});
