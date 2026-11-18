'use strict';
/* 知識を読む：読み直したのに一覧が空（11/18 オーナー「読み直したのに表示されないとかあり得ない」）

   スマホでは Firebase の SDK が、常時接続の切れているときに例外を出さず「端末の控え」から答える。
   控えに投稿が無いと0件のまま送り、総数（171件）は別に数えるので「全171件の知識」なのに「該当する知識がありません」になっていた。

   見ること
     ・控え（fromCache）から答えたときは、普通の通信（runQuery）で読み直して出す
     ・SDK が返ってこないときも、普通の通信で読む
     ・普通の通信で読んだ続き（もっと見る）は、普通の通信で、最後の投稿の時刻から読む
     ・どちらも読めず控えが空なら、0件を送らずに失敗にする（引っぱったときは失敗を返す）
     ・サーバーから届いたとき（いつもの形）は、普通の通信を使わない
   本物のサーバーやアカウントは使わない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const fieldsLine = INDEX.match(/  const KNOWLEDGE_REST_FIELDS = \[[\s\S]*?\];/)[0];
const realSoon = build(INDEX, ['_spSoon'], {})._spSoon;

function restDoc(id, iso, title) {
  return { document: { name: 'projects/p/databases/(default)/documents/posts/' + id,
    fields: { title: { stringValue: title }, body: { stringValue: '本文' }, address: { stringValue: '0x' + '1'.repeat(40) },
      createdAt: { timestampValue: iso } } } };
}
function harness({ sdk, rest }) {
  const sent = [], restCalls = [];
  const fbLib = {
    orderBy: () => ({}), startAfter: (d) => ({ after: d }), limit: () => ({}), collection: () => ({}),
    query: (...a) => a, getDocs: sdk
  };
  const api = build(INDEX, ['syncKnowledgeFrame', 'runKnowledgeSync', 'readKnowledgePageRest', 'plainKnowledgePost', 'knowledgeFacetIds', '_spRestFields', '_spRestValue'], {
    window: { fbLib, db: {}, connectedAccount: '' },
    localStorage: { getItem: () => '' },
    console: { warn() {}, error() {} },
    sendKnowledge: (m) => sent.push(m),
    waitForKnowledgeFirebase: async () => true,
    knowledgeTotalCount: async () => 171,
    emuEnsureEntitlement: async () => '',
    _spSoon: (p, ms) => realSoon(p, Math.min(ms, 80)),
    _spRestGet: async (path, auth, fresh, post) => { restCalls.push(post.structuredQuery); return rest(post.structuredQuery); },
    emuNameForAddress: () => '',
    knowledgeAuthorAddrs: () => [],
    readKnowledgeDrafts: async () => [],
    scheduledKnowledgeCount: async () => 0,
    markKnowledgePassHolders: async () => {}, markKnowledgePlans: async () => {},
    _spMonthlyTheme: async () => {},
    countMyGoodPosts: async () => 0,
    readDiscussionConclusions: async () => [],
    knowledgeAuthorsKnown: () => ({}),
    emuKnowledgeTrials: async () => ({}), emuSendKnowledgeTrials() {},
    startKnowledgeWatch() {},
    _spIsOwnerAddr: () => false,
    currentTheme: 'はじめる', currentThemeCopy: ''
  }, 'const KNOWLEDGE_PAGE_SIZE = 2; let knowledgeShown = 0, knowledgeLastDoc = null, knowledgeHasMore = true, knowledgeRestCursor = null, knowledgeSyncing = null, knowledgeSyncPending = null, knowledgeWatchTop = null;\n' + fieldsLine);
  const posts = () => sent.filter(m => m.type === 'emu-knowledge-posts');
  return { sync: api.syncKnowledgeFrame, sent, posts, restCalls };
}
const cacheEmpty = async () => ({ docs: [], metadata: { fromCache: true } });

test('SDK が端末の控え（0件）から答えたときは、普通の通信で読んで出す', async () => {
  const h = harness({ sdk: cacheEmpty, rest: () => [restDoc('a', '2026-11-18T01:00:00Z', '新しい'), restDoc('b', '2026-11-17T01:00:00Z', 'その前'), restDoc('c', '2026-11-16T01:00:00Z', '次のページ')] });
  await h.sync({ append: false, strict: true });
  const m = h.posts()[0];
  assert.deepEqual(m.posts.map(p => p.title), ['新しい', 'その前']);
  assert.equal(m.totalCount, 171);
  assert.equal(m.hasMore, true);
  assert.equal(m.posts[0].createdAt, '2026-11-18T01:00:00.000Z');
  const q = h.restCalls[0];
  assert.equal(q.orderBy[0].direction, 'DESCENDING');
  assert.ok(!q.select.fields.some(f => f.fieldPath === 'imageUrl'), '重い画像は読まない');
  assert.equal(q.startAt, undefined);
  // もっと見る：普通の通信で、最後の投稿の時刻のあとから
  await h.sync({ append: true });
  assert.deepEqual(h.restCalls[1].startAt, { values: [{ timestampValue: '2026-11-17T01:00:00Z' }], before: false });
});

test('SDK が返ってこないときも、普通の通信で読む', async () => {
  const h = harness({ sdk: () => new Promise(() => {}), rest: () => [restDoc('a', '2026-11-18T01:00:00Z', '届いた')] });
  await h.sync({ append: false, strict: true });
  assert.deepEqual(h.posts()[0].posts.map(p => p.title), ['届いた']);
});

test('どちらも読めず控えも空なら、0件を送らずに失敗（引っぱったときは失敗を返す）', async () => {
  const h = harness({ sdk: cacheEmpty, rest: () => { throw new Error('HTTP 503'); } });
  await assert.rejects(h.sync({ append: false, strict: true }), /読み込めませんでした/);
  assert.equal(h.posts().length, 0, '空の一覧で上書きしない');
  assert.equal(h.sent.filter(m => m.type === 'emu-knowledge-error').length, 1);
  // 引っぱっていないとき（strict でない）は今までどおり、画面に知らせて終わる
  const h2 = harness({ sdk: cacheEmpty, rest: () => { throw new Error('HTTP 503'); } });
  await h2.sync({ append: false });
  assert.equal(h2.posts().length, 0);
});

test('サーバーから届いたとき（いつもの形）は、普通の通信を使わない', async () => {
  const doc = (id, title) => ({ id, data: () => ({ title, body: '本文', createdAt: { toDate: () => new Date('2026-11-18T00:00:00Z') } }) });
  const h = harness({ sdk: async () => ({ docs: [doc('a', 'SDK の投稿')], metadata: { fromCache: false } }), rest: () => { throw new Error('呼ばれないはず'); } });
  await h.sync({ append: false, strict: true });
  assert.deepEqual(h.posts()[0].posts.map(p => p.title), ['SDK の投稿']);
  assert.equal(h.restCalls.length, 0);
});

test('控えに投稿があり、普通の通信がだめなときは、控えを出す', async () => {
  const doc = { id: 'a', data: () => ({ title: '控えの投稿', body: '', createdAt: '' }) };
  const h = harness({ sdk: async () => ({ docs: [doc], metadata: { fromCache: true } }), rest: () => { throw new Error('HTTP 503'); } });
  await h.sync({ append: false, strict: true });
  assert.deepEqual(h.posts()[0].posts.map(p => p.title), ['控えの投稿']);
});
