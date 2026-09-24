/* 年内目標のカードが出ない・保存できない、を起こさないための試し。

   起きていたこと（2026/9/24 の画面の控え）：

     年内目標を読めませんでした: Failed to get document because the client is offline.
     クエストを普通の通信で読みました（1件）

   Firestore の SDK は、変更を受け取り続けるための専用の通信路が切れると、
   自分を「オフライン」と見なす。そのあとの getDoc は、手元の控えに
   無ければ上の例外を投げる。クエスト一覧には普通の通信の逃げ道があり、
   そちらは助かっていた。年内目標には無かったので、黙って消えていた。

   書くほうも同じ通信路を使う。切れているあいだ setDoc は失敗せず、
   サーバーが受け取るまで返事をしないまま待つ。保存ボタンは押したきり
   何も起きず、「いま保存中」の札が下りないので二度と押せなくなる。
   「二回目は保存できなかった」のはこれ。

   どちらも、専用の通信路を使わない普通の通信へ逃がして直した。
   ここでは、その逃げ道が本当に効くかどうかだけを見る。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('./extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const ADMIN = readHtml('frontend/public/membership-admin.html');

const OFFLINE = Object.assign(
  new Error('Failed to get document because the client is offline.'),
  { code: 'unavailable' }
);
const DENIED = Object.assign(
  new Error('Missing or insufficient permissions.'),
  { code: 'permission-denied' }
);

/* ───────── 見る側（index.html） ───────── */

/* 画面の代わり。setState で渡ってきたものを覚えておくだけ。 */
function fakeApp() {
  const seen = [];
  return {
    seen: seen,
    setState: function (s) { seen.push(s); },
    get last() { return seen.length ? seen[seen.length - 1] : null; }
  };
}

/* snap の代わり。exists と fromCache の組み合わせを作る。 */
function snapOf(data, fromCache) {
  return {
    exists: function () { return !!data; },
    data: function () { return data; },
    metadata: { fromCache: !!fromCache }
  };
}

const DOC = {
  title: 'SchoolParkの年内目標',
  summary: '12/31までに、7つのクエストをすべて完走させる。',
  updatedAt: 1790154592862,
  blocks: [
    { type: 'heading', text: '全体像' },
    { type: 'text', text: '一般は5つのギルドから1本ずつ。' },
    { type: 'table', head: ['区分', 'ギルド'], rows: [{ cells: ['一般 #001', '01 LEARN'] }] },
    { type: 'image', url: '/schoolpark/images/quest-7-kousei.png', caption: '構成' }
  ]
};

/* index.html 側を組み立てる。getDoc と fetch は毎回差し替える。 */
function reader(opts) {
  opts = opts || {};
  const calls = { getDoc: 0, fetch: 0, warn: [], timers: [] };
  const stubs = {
    console: { warn: function () { calls.warn.push([].slice.call(arguments).join(' ')); } },
    setTimeout: function (fn, ms) { calls.timers.push(ms); return calls.timers.length; },
    clearTimeout: function () {},
    fetch: async function (url) {
      calls.fetch++;
      calls.url = url;
      if (opts.fetch) return await opts.fetch(url);
      throw new Error('通信できない');
    },
    window: {
      db: { app: { options: { projectId: 'emusch-2a111', apiKey: 'KEY' } } },
      auth: { currentUser: opts.token === null ? null
        : { getIdToken: async function () { return opts.token || 'TOKEN'; } } },
      fbLib: {
        doc: function () { return { path: 'sp_docs/year-goals' }; },
        getDoc: async function () {
          calls.getDoc++;
          if (typeof opts.getDoc === 'function') return await opts.getDoc(calls.getDoc);
          throw OFFLINE;
        }
      }
    }
  };
  const api = build(INDEX,
    ['_spDenied', '_spWarnDenied', '_spRestValue', '_spRestFields', '_spRestGet',
     '_spRestDoc', '_spYearBlock', '_spYearDate', 'spDaoLoadYearDoc'],
    stubs,
    "const SP_DOC_BLOCK_TYPES = ['heading','text','table','image'];\n"
    + "const SP_DENIED_NOTE = '権限がありません';\n"
    + "let _spYearRetryTimer = null;\n");
  /* 中で window.spDaoLoadYearDoc を呼ぶので、そこにも同じものを置く。 */
  stubs.window.spDaoLoadYearDoc = api.spDaoLoadYearDoc;
  return { api: api, calls: calls, window: stubs.window };
}

/* REST が返す形を作る（Firestore は値に型の名前を付けて返す）。 */
function toRest(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toRest) } };
  const f = {}; Object.keys(v).forEach(function (k) { f[k] = toRest(v[k]); });
  return { mapValue: { fields: f } };
}
function restDoc(d) {
  const fields = {}; Object.keys(d).forEach(function (k) { fields[k] = toRest(d[k]); });
  return { ok: true, status: 200, json: async function () { return { fields: fields }; } };
}

test('SDK が「オフライン」を投げても、普通の通信でカードが出る', async () => {
  const r = reader({ fetch: async function () { return restDoc(DOC); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  const st = r.app.last;
  assert.ok(st && st.yearDoc, '年内目標が渡っていない');
  assert.equal(st.yearDoc.title, 'SchoolParkの年内目標');
  assert.equal(st.yearDoc.blocks.length, 4);
  assert.equal(st.yearDoc.updatedLabel, '2026年9月23日');
  assert.equal(r.calls.fetch, 1);
  assert.equal(r.calls.timers.length, 0, '読めたのに読み直しを予約している');
});

/* 上の test で使う小道具。app を作って r に持たせる。 */
function fakeAppInto(r) { r.app = fakeApp(); return r.app; }

test('逃げ道に使う宛先は sp_docs/year-goals。証が無くても投げる', async () => {
  const r = reader({ token: null, fetch: async function () { return restDoc(DOC); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.match(r.calls.url, /\/projects\/emusch-2a111\/databases\/\(default\)\/documents\/sp_docs\/year-goals\?key=KEY$/);
  assert.ok(r.app.last && r.app.last.yearDoc, '誰でも読める記録なのに、証が無いだけで諦めた');
});

test('SDK が読めたときは、普通の通信へ行かない', async () => {
  const r = reader({ getDoc: async function () { return snapOf(DOC, false); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.equal(r.calls.fetch, 0);
  assert.ok(r.app.last.yearDoc);
});

test('控えから「無い」が返ったときは、普通の通信で確かめ直す', async () => {
  const r = reader({
    getDoc: async function () { return snapOf(null, true); },
    fetch: async function () { return restDoc(DOC); }
  });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.equal(r.calls.fetch, 1);
  assert.ok(r.app.last.yearDoc, '控えの「無い」を信じてカードを消した');
});

test('本当に記録が無いときだけ、カードを消す', async () => {
  const r = reader({ getDoc: async function () { return snapOf(null, false); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.equal(r.calls.fetch, 0);
  assert.deepEqual(r.app.last, { yearDoc: null });
});

test('記録が 404（まだ書かれていない）なら、カードを消す', async () => {
  const r = reader({ fetch: async function () { return { ok: false, status: 404 }; } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.deepEqual(r.app.last, { yearDoc: null });
});

test('どちらも読めないときは、いま出ているものを消さない', async () => {
  const r = reader({ fetch: async function () { throw new Error('通信できない'); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.equal(r.app.seen.length, 0, '読めていないのに画面を書き換えた');
});

test('どちらも読めないときは、一度だけ読み直しを予約する', async () => {
  const r = reader({ fetch: async function () { throw new Error('通信できない'); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r), 0);
  assert.deepEqual(r.calls.timers, [4000]);
  await r.api.spDaoLoadYearDoc(r.app, 1);
  assert.deepEqual(r.calls.timers, [4000], '読み直しの読み直しを予約している');
});

test('決まりで断られたときは、断られたと分かる言葉を残す', async () => {
  const r = reader({
    getDoc: async function () { throw DENIED; },
    fetch: async function () { throw new Error('HTTP 403'); }
  });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.ok(r.calls.warn.some(function (w) { return w.indexOf('権限がありません') >= 0; }));
});

test('中身の無いブロックは落とす。全部落ちたらカードを出さない', async () => {
  const r = reader({ fetch: async function () {
    return restDoc({ title: 'x', summary: '', updatedAt: 0, blocks: [
      { type: 'heading', text: '' }, { type: 'table', rows: [] },
      { type: 'image', url: '' }, { type: 'なにか', text: 'あ' }
    ] });
  } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  assert.deepEqual(r.app.last, { yearDoc: null });
});

test('REST から来た表の行は、{cells:[…]} のまま画面へ渡る', async () => {
  const r = reader({ fetch: async function () { return restDoc(DOC); } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  const t = r.app.last.yearDoc.blocks.find(function (b) { return b.isTable; });
  assert.deepEqual(t.head, ['区分', 'ギルド']);
  assert.deepEqual(t.rows, [{ cells: ['一般 #001', '01 LEARN'] }]);
  assert.equal(t.hasHead, true);
});

/* ───────── 書く側（membership-admin.html） ───────── */

function writer(opts) {
  opts = opts || {};
  const calls = { fetch: 0, setDoc: 0, timers: [] };
  const stubs = {
    fetch: async function (url, init) {
      calls.fetch++; calls.url = url; calls.init = init;
      if (opts.fetch) return await opts.fetch(url, init);
      return { ok: true, status: 200, json: async function () { return {}; } };
    },
    setTimeout: function (fn, ms) {
      calls.timers.push(ms);
      if (opts.fireTimers) { const id = { fn: fn }; queueMicrotask(fn); return id; }
      return { fn: fn };
    },
    clearTimeout: function () {},
    app: { options: { projectId: 'emusch-2a111', apiKey: 'KEY' } },
    auth: { currentUser: opts.token === null ? null
      : { getIdToken: async function () { return opts.token || 'TOKEN'; } } }
  };
  const api = build(ADMIN,
    ['ydRestValue', 'ydRestFields', 'ydRestWrite', 'ydWrite',
     'ydFromRestValue', 'ydFromRestFields', 'ydRestRead', 'ydToDocBlock', 'ydLoad'],
    stubs);
  return { api: api, calls: calls };
}

const BODY = {
  title: 'SchoolParkの年内目標',
  summary: 'まとめ',
  blocks: [
    { type: 'heading', text: '全体像' },
    { type: 'table', head: ['区分'], rows: [{ cells: ['一般 #001'] }] }
  ],
  updatedAt: 1790154592862,
  by: '0xdcc687c05f130e57597a8525771299a4efb6edf7'
};

test('保存：SDK がすぐ返れば、普通の通信は使わない', async () => {
  const w = writer();
  const f = { doc: function () { return {}; }, db: {}, setDoc: async function () { w.calls.setDoc++; } };
  assert.equal(await w.api.ydWrite(f, BODY), 'sdk');
  assert.equal(w.calls.fetch, 0);
});

test('保存：SDK が返事をしないとき、待ちっぱなしにならず普通の通信で書く', async () => {
  const w = writer({ fireTimers: true });
  const f = { doc: function () { return {}; }, db: {},
    /* 通信が切れているときの setDoc。手元にためたまま、ずっと返事をしない。 */
    setDoc: function () { return new Promise(function () {}); } };
  assert.equal(await w.api.ydWrite(f, BODY), 'rest');
  assert.equal(w.calls.fetch, 1);
  assert.deepEqual(w.calls.timers, [15000]);
});

test('保存：決まりで断られたときは、そのまま失敗として返す', async () => {
  const w = writer();
  const f = { doc: function () { return {}; }, db: {},
    setDoc: async function () { throw DENIED; } };
  await assert.rejects(function () { return w.api.ydWrite(f, BODY); },
    function (e) { return e.code === 'permission-denied'; });
  assert.equal(w.calls.fetch, 0, '断られたのに普通の通信で投げ直した');
});

test('保存：普通の通信は PATCH で、欄を updateMask に並べ、証を付ける', async () => {
  const w = writer();
  await w.api.ydRestWrite(BODY);
  assert.match(w.calls.url, /documents\/sp_docs\/year-goals\?/);
  ['title', 'summary', 'blocks', 'updatedAt', 'by'].forEach(function (k) {
    assert.ok(w.calls.url.indexOf('updateMask.fieldPaths=' + k) >= 0, k + ' が updateMask に無い');
  });
  assert.equal(w.calls.init.method, 'PATCH');
  assert.equal(w.calls.init.headers.Authorization, 'Bearer TOKEN');
});

test('保存：updatedAt は整数として送る（決まりが is int を見るため）', async () => {
  const w = writer();
  await w.api.ydRestWrite(BODY);
  const sent = JSON.parse(w.calls.init.body);
  assert.deepEqual(sent.fields.updatedAt, { integerValue: '1790154592862' });
  assert.equal(sent.fields.title.stringValue, 'SchoolParkの年内目標');
});

test('保存：表の行は {cells:[…]} の入れ子のまま送られる', async () => {
  const w = writer();
  await w.api.ydRestWrite(BODY);
  const sent = JSON.parse(w.calls.init.body);
  const table = sent.fields.blocks.arrayValue.values[1].mapValue.fields;
  assert.equal(table.type.stringValue, 'table');
  assert.deepEqual(table.rows.arrayValue.values[0].mapValue.fields.cells,
    { arrayValue: { values: [{ stringValue: '一般 #001' }] } });
});

test('保存：普通の通信も断られたら、理由を付けて失敗にする', async () => {
  const w = writer({ fetch: async function () {
    return { ok: false, status: 403, json: async function () {
      return { error: { message: 'Missing or insufficient permissions.' } }; } };
  } });
  await assert.rejects(function () { return w.api.ydRestWrite(BODY); }, /HTTP 403/);
});

test('保存：証が取れないときは、投げる前に止める', async () => {
  const w = writer({ token: null });
  await assert.rejects(function () { return w.api.ydRestWrite(BODY); }, /ログインの証/);
  assert.equal(w.calls.fetch, 0);
});

test('送った形は、そのまま読み返せる（書く↔読むが一致している）', async () => {
  const w = writer();
  await w.api.ydRestWrite(BODY);
  const sent = JSON.parse(w.calls.init.body);
  assert.deepEqual(w.api.ydFromRestFields(sent.fields), BODY);
});

/* ───────── 編集欄を開くとき ───────── */

test('読み込み：SDK が「オフライン」でも、普通の通信で中身が出る', async () => {
  const w = writer({ fetch: async function () { return restDoc(BODY); } });
  const f = { doc: function () { return {}; }, db: {},
    getDoc: async function () { throw OFFLINE; } };
  const r = await w.api.ydLoad(f);
  assert.equal(r.ok, true);
  assert.equal(r.data.title, 'SchoolParkの年内目標');
});

test('読み込み：控えの古い「無い」を信じず、普通の通信で確かめ直す', async () => {
  const w = writer({ fetch: async function () { return restDoc(BODY); } });
  const f = { doc: function () { return {}; }, db: {},
    getDoc: async function () { return snapOf(null, true); } };
  const r = await w.api.ydLoad(f);
  assert.equal(r.ok, true);
  assert.equal(r.data.blocks.length, 2, '控えの「無い」で空の編集欄を出そうとした');
});

test('読み込み：どちらも読めないときは ok:false（空の編集欄を出さない）', async () => {
  const w = writer({ fetch: async function () { throw new Error('通信できない'); } });
  const f = { doc: function () { return {}; }, db: {},
    getDoc: async function () { throw OFFLINE; } };
  const r = await w.api.ydLoad(f);
  assert.equal(r.ok, false);
  assert.ok(r.why);
});

test('読み込み：本当にまだ無いときは ok:true の data なし', async () => {
  const w = writer();
  const f = { doc: function () { return {}; }, db: {},
    getDoc: async function () { return snapOf(null, false); } };
  const r = await w.api.ydLoad(f);
  assert.deepEqual(r, { ok: true, data: null });
});

test('読み込み：記録が 404 なら、まだ無いと分かる（読めなかった扱いにしない）', async () => {
  const w = writer({ fetch: async function () { return { ok: false, status: 404 }; } });
  const f = { doc: function () { return {}; }, db: {},
    getDoc: async function () { throw OFFLINE; } };
  const r = await w.api.ydLoad(f);
  assert.deepEqual(r, { ok: true, data: null });
});

/* ───────── 見る側と書く側で、形が食い違っていないか ───────── */

test('管理画面が作る形を、見る側がそのまま読める', async () => {
  const w = writer();
  const blocks = [
    { type: 'heading', text: '全体像' },
    { type: 'text', text: '本文' },
    { type: 'table', head: ['区分', 'ギルド'], rows: [['一般 #001', '01 LEARN']] },
    { type: 'image', url: '/a.png', caption: '図' }
  ].map(w.api.ydToDocBlock);
  const r = reader({ fetch: async function () {
    return restDoc({ title: 'T', summary: 'S', updatedAt: 1790154592862, blocks: blocks });
  } });
  await r.api.spDaoLoadYearDoc(fakeAppInto(r));
  const got = r.app.last.yearDoc.blocks;
  assert.equal(got.length, 4);
  assert.deepEqual(got.map(function (b) { return b.type; }),
    ['heading', 'text', 'table', 'image']);
  assert.deepEqual(got[2].rows, [{ cells: ['一般 #001', '01 LEARN'] }]);
  assert.equal(got[3].caption, '図');
  assert.equal(got[3].hasCaption, true);
});

/* ───────── クエスト一覧の逃げ道（作り直したので、そのまま動くか見る） ───────── */

function questReader(opts) {
  opts = opts || {};
  const calls = { fetch: 0 };
  const stubs = {
    console: { warn: function () {} },
    fetch: async function (url) {
      calls.fetch++; calls.url = url;
      if (opts.fetch) return await opts.fetch(url);
      return { ok: true, status: 200, json: async function () { return { documents: opts.docs || [] }; } };
    },
    window: {
      db: { app: { options: { projectId: 'emusch-2a111', apiKey: 'KEY' } } },
      auth: { currentUser: opts.token === null ? null
        : { getIdToken: async function () { return 'TOKEN'; } } }
    }
  };
  return { api: build(INDEX, ['_spRestValue', '_spRestFields', '_spRestGet', '_spRestQuests'], stubs), calls: calls };
}

test('クエストの逃げ道：宛先と証はそのまま', async () => {
  const q = questReader({ docs: [
    { name: 'projects/x/databases/(default)/documents/sp_quests/a', fields: { createdAt: { integerValue: '1' }, title: { stringValue: '古い' } } },
    { name: 'projects/x/databases/(default)/documents/sp_quests/b', fields: { createdAt: { integerValue: '9' }, title: { stringValue: '新しい' } } }
  ] });
  const out = await q.api._spRestQuests();
  assert.match(q.calls.url, /documents\/sp_quests\?pageSize=100&key=KEY$/);
  assert.deepEqual(out.map(function (d) { return d.id; }), ['b', 'a'], '新しい順になっていない');
  assert.equal(out[0].title, '新しい');
});

test('クエストの逃げ道：証が無ければ投げない（必ず断られるため）', async () => {
  const q = questReader({ token: null });
  await assert.rejects(function () { return q.api._spRestQuests(); }, /ログインの証/);
  assert.equal(q.calls.fetch, 0);
});

test('クエストの逃げ道：断られたら、そのまま失敗として返す', async () => {
  const q = questReader({ fetch: async function () { return { ok: false, status: 403 }; } });
  await assert.rejects(function () { return q.api._spRestQuests(); }, /HTTP 403/);
});

test('クエストの逃げ道：多くても30件まで', async () => {
  const docs = [];
  for (let i = 0; i < 40; i++) {
    docs.push({ name: 'a/b/c/sp_quests/q' + i, fields: { createdAt: { integerValue: String(i) } } });
  }
  const q = questReader({ docs: docs });
  assert.equal((await q.api._spRestQuests()).length, 30);
});
