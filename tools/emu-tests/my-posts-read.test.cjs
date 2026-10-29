'use strict';
/* Emu の「自分の投稿」の読み方（emuReadMyPosts、10/29 オーナーから）。

   スマホで、投稿が7件あるのに「運営に受け取ってもらう」が「まず、知識をひとつ届けてみてください」、
   マイライブラリーが「投稿はありません」になった。SDK は常時接続が切れていると、例外を出さずに
   端末の控え（0件）から答える。それをそのまま「無い」と出していた。
     - まず普通の通信（runQuery）で、欄を絞って、アカウントの2つの名義の両方から読む
     - だめなら SDK。SDK の控えから来た答えは使わない
     - 読めなかったときは null（呼ぶ側は「読み込めませんでした」と出す。「無い」とは言わない） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const KNOW = readHtml('frontend/public/knowledge.html');
const W = '0x' + 'a'.repeat(40), C = '0x' + 'c'.repeat(40);

function make({ rest, sdk, identity = { aliases: [W, C] } }) {
  const seen = { rest: [], sdk: [] };
  const fb = {
    collection: (db, name) => ({ name }),
    where: (f, op, v) => ({ f, op, v }),
    limit: n => ({ limit: n }),
    query: (...a) => a,
    getDocs: async q => { seen.sdk.push(q); if (sdk instanceof Error) throw sdk; return sdk; }
  };
  const window = { fbLib: fb, db: {} };
  const fns = build(INDEX, ['_spSoon', '_spRestValue', '_spRestFields', 'emuReadMyPosts'], {
    window, console: { warn() {} },
    emuMyIdentity: async () => identity,
    emuAliasesNow: () => [W],
    _spRestGet: async (path, needAuth, fresh, post) => { seen.rest.push({ path, post }); if (rest instanceof Error) throw rest; return rest; }
  });
  return { read: fns.emuReadMyPosts, seen };
}
const restDoc = (id, title) => ({ document: { name: 'projects/p/databases/(default)/documents/posts/' + id,
  fields: { title: { stringValue: title }, goodCount: { integerValue: '2' }, createdAt: { timestampValue: '2026-10-28T04:36:27Z' } } } });

test('普通の通信で、欄を絞って、2つの名義の両方から読む', async () => {
  const m = make({ rest: [restDoc('p1', 'オンとオフのメリハリを！'), { readTime: 'x' }] });
  const rows = await m.read(['title', 'goodCount', 'createdAt'], 50);
  assert.deepEqual(rows, [{ id: 'p1', title: 'オンとオフのメリハリを！', goodCount: 2, createdAt: Date.parse('2026-10-28T04:36:27Z') }]);
  const q = m.seen.rest[0].post.structuredQuery;
  assert.equal(m.seen.rest[0].path, ':runQuery');
  assert.deepEqual(q.where.fieldFilter.op, 'IN');
  assert.deepEqual(q.where.fieldFilter.value.arrayValue.values.map(v => v.stringValue), [W, C], '両方の名義');
  assert.deepEqual(q.select.fields.map(f => f.fieldPath), ['title', 'goodCount', 'createdAt'], '本文や画像は読まない');
  assert.equal(q.limit, 50);
  assert.equal(m.seen.sdk.length, 0);
});

test('名義が1つなら、その1つで読む', async () => {
  const m = make({ rest: [], identity: { aliases: [W] } });
  assert.deepEqual(await m.read(['title'], 10), []);
  assert.equal(m.seen.rest[0].post.structuredQuery.where.fieldFilter.op, 'EQUAL');
});

test('普通の通信がだめなら SDK。SDK の控えから来た答えは「読めなかった」（null）にする', async () => {
  const cached = { metadata: { fromCache: true }, forEach() {} };
  assert.equal(await make({ rest: new Error('HTTP 429'), sdk: cached }).read(['title'], 10), null, '控えの0件を「無い」にしない');
  assert.equal(await make({ rest: new Error('HTTP 429'), sdk: new Error('offline') }).read(['title'], 10), null);
  const fresh = { metadata: { fromCache: false }, forEach(fn) { fn({ id: 'p2', data: () => ({ title: '千差万別', body: '長い本文' }) }); } };
  const m = make({ rest: new Error('HTTP 500'), sdk: fresh });
  assert.deepEqual(await m.read(['title'], 10), [{ id: 'p2', title: '千差万別' }], '頼んだ欄だけ返す');
  assert.deepEqual(m.seen.sdk[0][1], { f: 'address', op: 'in', v: [W, C] });
});

test('マイライブラリーと運営への依頼は、この読み方を使い、読めなかったときは「無い」と言わない', () => {
  const lib = INDEX.slice(INDEX.indexOf('async function loadKnowledgePanel(kind)'), INDEX.indexOf("window.addEventListener('emu-post-save-result'"));
  assert.ok(lib.includes("await emuReadMyPosts(['title', 'goodCount', 'changeCount', 'createdAt', 'address'], 100)"));
  assert.ok(lib.includes('postsUnread: rows === null'));
  assert.equal(lib.includes("where('address', '=='"), false, '1つの名義だけで読んでいる');
  assert.ok(KNOW.includes("emuT(items.postsUnread?'k.panel.postsUnread':'k.panel.noPosts')"));
  const review = INDEX.slice(INDEX.indexOf('async function _emuLoadReview()'), INDEX.indexOf('async function _emuLoadReview()') + 4000);
  assert.ok(review.includes("await emuReadMyPosts(['title', 'createdAt'], 50)"));
  assert.ok(review.includes('投稿を読み込めませんでした。時間をおいて、開き直してください。'));
  assert.equal(review.includes("where('address', '==', addr)"), false);
});
