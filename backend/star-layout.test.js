/* 星空の星座の並び（backend/star-layout.js）。11/20 オーナー：星の配置を自由に・自分だけの星座・完成した日。
   本人の uid の書類にしか書かないこと、決まった形・大きさに整えること、空いた点・しまった星を残せることを確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createStarLayoutRouter, cleanLayout, forSky } = require('./star-layout');

function fakeDb() {
  const docs = new Map();
  return {
    docs,
    collection(name) {
      return { doc(id) {
        const key = name + '/' + id;
        return {
          async get() { return { exists: docs.has(key), data: () => docs.get(key) }; },
          async set(data) { docs.set(key, JSON.parse(JSON.stringify(data))); }
        };
      } };
    }
  };
}
async function serve(db) {
  const app = express();
  app.use(express.json());
  const requireFirebaseUser = (req, res, next) => {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    req.identity = { uid: h.slice(7) }; next();
  };
  app.use('/api/schoolpark/star-layout', createStarLayoutRouter({ db, requireFirebaseUser, now: () => 1763600000000 }).router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/schoolpark/star-layout';
  return { base, close: () => new Promise(r => server.close(r)) };
}
const req = (base, method, who, body) => fetch(base + '/me', {
  method, headers: Object.assign({ 'Content-Type': 'application/json' }, who ? { Authorization: 'Bearer ' + who } : {}),
  body: body ? JSON.stringify(body) : undefined
});

test('ログインしていないと読めない・書けない', async () => {
  const { base, close } = await serve(fakeDb());
  try {
    assert.equal((await req(base, 'GET')).status, 401);
    assert.equal((await req(base, 'PUT', null, { layout: {} })).status, 401);
  } finally { await close(); }
});

test('本人の uid の書類にだけ書き、本人だけが読める（空いた点・しまった星・自分だけの星座も戻る）', async () => {
  const db = fakeDb();
  const { base, close } = await serve(db);
  try {
    const layout = { slots: ['learning', '', 'nft', ''], held: ['post'], completed: { aries: 1763500000000 },
      customs: [{ name: 'はじまり座', points: [[0, 1, 'nft'], [2, 3, 'learning']], lines: [[0, 1]] }] };
    assert.equal((await req(base, 'PUT', 'alice', { layout })).status, 200);
    assert.deepEqual([...db.docs.keys()], ['sp_star_layouts/alice']);
    const mine = await (await req(base, 'GET', 'alice')).json();
    assert.equal(mine.ok, true);
    assert.deepEqual(mine.layout.slots, ['learning', '', 'nft'], '空いた点は残し、後ろの空きだけ詰める');
    assert.deepEqual(mine.layout.held, ['post']);
    assert.deepEqual(mine.layout.customs, [{ name: 'はじまり座', points: [[0, 1, 'nft'], [2, 3, 'learning']], lines: [[0, 1]] }]);
    assert.deepEqual(mine.layout.completed, { aries: 1763500000000 });
    const other = await (await req(base, 'GET', 'bob')).json();
    assert.deepEqual(other, { ok: true, layout: {} }, 'ほかの人の並びは見えない');
  } finally { await close(); }
});

test('決まった欄・大きさに整える（星の数そのものや、知らない欄は置かない）', () => {
  const out = cleanLayout({
    counts: { learning: 999 }, uid: 'someone-else',
    slots: Array(700).fill('learning').concat(['<b>']),
    held: ['ok', 1, '<x>'],
    customs: [1, 2, 3, 4].map(() => ({ name: 'あいうえおかきくけこさしすせそ', points: Array(20).fill([9, -3, 'nft']), lines: [[0, 0], [0, 1], [0, 50]] })),
    completed: { aries: 1, taurus: 'x', 'bad key': 5, leo: -1 }
  }, 42);
  assert.deepEqual(Object.keys(out).sort(), ['completed', 'customs', 'held', 'slots', 'updatedAt']);
  assert.equal(out.slots.length, 600);
  assert.deepEqual(out.held, ['ok']);
  assert.equal(out.customs.length, 3);
  assert.equal(out.customs[0].name, 'あいうえおかきくけこさし');
  assert.equal(out.customs[0].points.length, 12);
  assert.deepEqual(out.customs[0].points[0], { x: 4, y: 0, t: 'nft' }, 'マスの外は端に寄せる');
  assert.deepEqual(out.customs[0].lines, [{ a: 0, b: 1 }], '自分自身・無い点への線は捨てる');
  assert.deepEqual(out.completed, { aries: 1 });
  assert.equal(out.updatedAt, 42);
  assert.deepEqual(forSky(out).customs[0].lines, [[0, 1]]);
});

test('中身の無い保存は断る', async () => {
  const { base, close } = await serve(fakeDb());
  try {
    assert.equal((await req(base, 'PUT', 'alice', { nothing: true })).status, 400);
  } finally { await close(); }
});
