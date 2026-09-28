/* ランキングは、出すぶんだけ読むこと。

   ここは前、順位を10人ぶん出すために user_profiles を丸ごと
   読んでいた。しかもプロフィール画像は Storage が使えないため
   （Blazeプランが必要）1件200KBまでの文字列として同じ
   ドキュメントに入っている。10人の名前を出すために、
   全員の画像まで運んでいたことになる。

   このプロジェクトは無料枠で動いている。1日の読み取り上限を
   使い切ると、Firestore は 429（RESOURCE_EXHAUSTED）を返し、
   画面側の読み取りもまとめて断られる。「ゲスト」と表示され、
   数字が全部0になるのはそれである。

   そして読めなかったとき、ここは 500 を返していた。飾りが
   落ちただけでコンソールが赤で埋まり、本当の不具合が埋もれる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SERVER.slice(SERVER.indexOf('// ── ランキング用サーバーキャッシュ'),
                         SERVER.indexOf('// Room3 リアルタイム'));
assert.ok(SRC.length > 2000, 'ランキングのところが見つかりません');
assert.match(SRC, /app\.get\('\/api\/ranking'/, '入口が切り出せていません');

/* 何件読んだかを数える偽の Firestore。 */
function stage(opts) {
  const o = opts || {};
  const seen = { posts: 0, profileDocs: 0, wholeCollections: [], masks: [], getAllCalls: 0 };
  const posts = (o.posts || []).map(d => ({ data: () => d }));

  const db = {
    collection(name) {
      return {
        limit(n) {
          return { async get() {
            if (name === 'posts' && o.postsThrow) {
              const e = new Error('Quota exceeded'); e.code = 8; throw e;
            }
            seen.posts += 1;
            return { docs: posts, size: posts.length };
          } };
        },
        doc(id) { return { __col: name, __id: id }; },
        /* 一覧をまるごと読んだら、それを記録する（あってはならない） */
        async get() { seen.wholeCollections.push(name); return { docs: [] }; }
      };
    },
    async getAll(...args) {
      seen.getAllCalls += 1;
      const last = args[args.length - 1];
      const hasOpt = last && !last.__col;
      const refs = hasOpt ? args.slice(0, -1) : args;
      if (hasOpt) seen.masks.push(last.fieldMask);
      seen.profileDocs += refs.length;
      if (o.namesThrow) throw new Error('getAll failed');
      return refs.map(r => ({
        id: r.__id,
        exists: Object.prototype.hasOwnProperty.call(o.names || {}, r.__id),
        data: () => ({ displayName: (o.names || {})[r.__id] })
      }));
    }
  };

  let handler = null;
  const ctx = vm.createContext({
    db,
    console: { log() {}, error() {}, warn() {} },
    Date, Object, Array, Math, Number, String, Set, JSON, parseInt,
    app: { get(p, fn) { if (p === '/api/ranking') handler = fn; } }
  });
  vm.runInContext(SRC, ctx);
  assert.ok(handler, '入口が拾えていません');

  const call = async (query) => {
    let body = null, code = 200;
    const res = {
      json(v) { body = v; return res; },
      status(c) { code = c; return res; }
    };
    await handler({ query: query || {} }, res);
    return { body, code };
  };
  return { call, seen, ctx };
}

/* 5人が投稿し、Good をもらっている状態 */
const POSTS = [
  { address: '0xAAA', goodCount: 9, changeCount: 1, goodUsers: ['0xbbb'] },
  { address: '0xbbb', goodCount: 5, changeCount: 4, goodUsers: ['0xaaa', '0xccc'] },
  { address: '0xccc', goodCount: 3, changeCount: 0 },
  { address: '0xddd', goodCount: 1, changeCount: 0 },
  { address: 'unknown', goodCount: 99, changeCount: 99 },
  { address: '', goodCount: 99, changeCount: 0 }
];

/* ───────── 読む量 ───────── */

test('名前は、順位に残った人のぶんだけ引く', async () => {
  const s = stage({ posts: POSTS, names: { '0xaaa': 'あ' } });
  const { body } = await s.call({ type: 'good_post', limit: '2' });
  assert.equal(body.length, 2);
  assert.equal(s.seen.profileDocs, 2,
    'プロフィールを ' + s.seen.profileDocs + '件読んでいる（出すのは2件）');
});

test('登録者ぜんぶのプロフィールを読みに行かない', async () => {
  const s = stage({ posts: POSTS, names: {} });
  await s.call({ type: 'good_post' });
  assert.deepEqual(Array.from(s.seen.wholeCollections), [],
    '一覧をまるごと読んでいる: ' + s.seen.wholeCollections.join(','));
});

test('プロフィール画像は運ばない（名前だけを頼む）', async () => {
  const s = stage({ posts: POSTS, names: {} });
  await s.call({ type: 'good_post' });
  assert.equal(s.seen.masks.length, 1, 'fieldMask を付けずに頼んでいる');
  assert.deepEqual(Array.from(s.seen.masks[0]), ['displayName'],
    '頼んでいる欄: ' + JSON.stringify(s.seen.masks[0]));
});

test('同じ人が何度出てきても、名前は1回しか引かない', async () => {
  const posts = Array.from({ length: 30 }, () =>
    ({ address: '0xaaa', goodCount: 1, changeCount: 0 }));
  const s = stage({ posts, names: { '0xaaa': 'あ' } });
  await s.call({ type: 'posted' });
  assert.equal(s.seen.profileDocs, 1, '同じ人を ' + s.seen.profileDocs + '回引いている');
});

test('匿名や空のアドレスは引きに行かない', async () => {
  const s = stage({ posts: POSTS, names: {} });
  await s.call({ type: 'good_post', limit: '50' });
  assert.equal(s.seen.profileDocs, 4, '匿名まで引いている（' + s.seen.profileDocs + '件）');
});

test('誰も残らなければ、名前は引かない', async () => {
  const s = stage({ posts: [{ address: '0xaaa', goodCount: 0, changeCount: 0 }], names: {} });
  const { body } = await s.call({ type: 'good_post' });
  assert.equal(body.length, 0);
  assert.equal(s.seen.getAllCalls, 0, '出す人がいないのに名前を引いている');
});

test('1時間のうちは、投稿を読み直さない', async () => {
  const s = stage({ posts: POSTS, names: {} });
  await s.call({ type: 'good_post' });
  await s.call({ type: 'change_post' });
  await s.call({ type: 'posted' });
  assert.equal(s.seen.posts, 1, '投稿を ' + s.seen.posts + '回読んでいる');
});

/* ───────── 読めなかったとき ───────── */

test('読み取り枠を使い切っても、500 は返さない', async () => {
  const s = stage({ posts: POSTS, postsThrow: true });
  const { body, code } = await s.call({ type: 'good_post' });
  assert.equal(code, 200, 'ランキングが落ちただけで ' + code + ' を返している');
  assert.ok(Array.isArray(body), '配列以外を返すと画面側が壊れる');
  assert.equal(body.length, 0);
});

test('名前が引けなくても、順位は出す', async () => {
  const s = stage({ posts: POSTS, namesThrow: true });
  const { body, code } = await s.call({ type: 'good_post', limit: '3' });
  assert.equal(code, 200);
  assert.equal(body.length, 3, '名前が引けないだけで順位ごと消えている');
  body.forEach(i => assert.match(i.displayName, /^0x|^匿名$/,
    '名前の代わりが入っていない: ' + i.displayName));
});

/* ───────── 中身が変わっていないこと ───────── */

test('名前があれば名前、無ければ短いアドレス', async () => {
  const s = stage({ posts: POSTS, names: { '0xaaa': 'あきら' } });
  const { body } = await s.call({ type: 'good_post', limit: '50' });
  const by = {};
  body.forEach(i => { by[i.address] = i.displayName; });
  assert.equal(by['0xaaa'], 'あきら');
  assert.equal(by['0xbbb'], '0xbbb...xbbb',
    '短いアドレスの作り方が変わっている');
});

test('順位と点の出し方は前と同じ', async () => {
  const s = stage({ posts: POSTS, names: {} });
  const good = (await s.call({ type: 'good_post', limit: '50' })).body;
  assert.deepEqual(Array.from(good.map(i => i.address)),
    ['0xaaa', '0xbbb', '0xccc', '0xddd']);
  assert.equal(good[0].scoreLabel, '👍 9 Good獲得');

  const total = (await s.call({ type: 'total_post', limit: '50' })).body;
  assert.equal(total[0].address, '0xbbb');    /* 5 + 4*2 = 13 */
  assert.equal(total[0].score, 13);
  assert.equal(total[1].score, 11);           /* 9 + 1*2 = 11 */

  const posted = (await s.call({ type: 'posted', limit: '50' })).body;
  assert.equal(posted[0].scoreLabel, '📝 1件');

  const given = (await s.call({ type: 'good_given', limit: '50' })).body;
  assert.equal(given.find(i => i.address === '0xbbb').score, 1);
  assert.equal(given.find(i => i.address === '0xaaa').score, 1);
});

test('一度に返すのは50件まで', async () => {
  const posts = Array.from({ length: 80 }, (_, i) =>
    ({ address: '0x' + String(i).padStart(3, '0'), goodCount: 80 - i, changeCount: 0 }));
  const s = stage({ posts, names: {} });
  assert.equal((await s.call({ type: 'good_post', limit: '999' })).body.length, 50);
  assert.equal((await s.call({ type: 'good_post' })).body.length, 10);
});
