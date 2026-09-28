/* 同じものを何度も読まないこと。

   1回の読み直し（spDaoRefreshNow）で、SchoolPark は同じ一覧を
   何度も取りに行っていた。

     sp_quests …… 5か所（クエスト一覧／ギルド／完走数え／
                   メンバー／星空）
     sp_wisdom …… 3か所（知恵ライブラリ／信用スコア／メンバー）
     引用（cites）…… 知恵カード1枚につき3か所から
     受けた記録 …… クエストの数 × 名義の数だけ1件ずつ

   クエストが2本のうちは誰も気づかなかった。17本になった日、
   1回の読み直しが数百件になり、それを60秒ごとに回していたので、
   1日の読み取り枠（無料枠は50,000件）を5時間で使い切った。
   Firestore は 429（RESOURCE_EXHAUSTED）を返し、画面は
   「ゲスト」になり、数字は全部0になった。

   ここが緩むと、同じことがもう一度起きる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

/* 取っておく仕掛けと、共有の読み口。本物の通信だけ差し替える。 */
const MEMO = INDEX.slice(INDEX.indexOf('function _spMemoState() {'),
                         INDEX.indexOf('/* ───────── 普通の通信の関門'));
const READ = INDEX.slice(INDEX.indexOf('const SP_READ_TTL_MS = '),
                         INDEX.indexOf('async function _spReadAllOnce('))
  + INDEX.slice(INDEX.indexOf('/* クエスト一覧は、ここ1か所から取る。'),
                INDEX.indexOf('window._spAllWisdom = _spAllWisdom;')
                + 'window._spAllWisdom = _spAllWisdom;'.length);
assert.ok(MEMO.length > 800 && READ.length > 600, '切り出しが足りません');

function stage(opts) {
  const o = opts || {};
  const seen = { calls: 0, paths: [], live: 0, peak: 0 };
  let now = 1000000;
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Map, Promise, Number, String, Math, Array,
    Date: { now: () => now },
    window: {},
    _spReadAllOnce: async function (p) {
      seen.calls += 1; seen.paths.push(p);
      seen.live += 1; seen.peak = Math.max(seen.peak, seen.live);
      await null;
      seen.live -= 1;
      if (o.fail) throw new Error('boom');
      if (o.empty) return null;
      return (o.rows && o.rows[p]) || [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 9 }];
    }
  });
  vm.runInContext('var _spReadAllOnce;\n' + MEMO + READ, ctx);
  vm.runInContext('_spReadAllOnce = this._spReadAllOnce;', ctx);
  return { ctx, seen, tick: (ms) => { now += ms; } };
}

/* ───────── 取っておく仕掛け ───────── */

test('同じ一覧を5回聞いても、読みに行くのは1回', async () => {
  const s = stage();
  const all = await Promise.all(Array.from({ length: 5 }, () => s.ctx._spReadAll('sp_quests')));
  assert.equal(s.seen.calls, 1, '同じものを ' + s.seen.calls + '回読みに行っている');
  all.forEach(r => assert.equal(r.length, 2));
});

test('走っている最中に聞かれても、2本目を走らせない', async () => {
  const s = stage();
  const a = s.ctx._spReadAll('sp_quests');
  const b = s.ctx._spReadAll('sp_quests');
  await Promise.all([a, b]);
  assert.equal(s.seen.peak, 1, '同時に ' + s.seen.peak + '本走っている');
});

test('25秒たてば、ちゃんと読み直す', async () => {
  const s = stage();
  await s.ctx._spReadAll('sp_quests');
  s.tick(24000);
  await s.ctx._spReadAll('sp_quests');
  assert.equal(s.seen.calls, 1, '早すぎる読み直し');
  s.tick(2000);
  await s.ctx._spReadAll('sp_quests');
  assert.equal(s.seen.calls, 2, '25秒たっても古いものを返している');
});

test('行き先が違えば、別のものとして読む', async () => {
  const s = stage();
  await Promise.all([s.ctx._spReadAll('sp_quests'), s.ctx._spReadAll('sp_wisdom')]);
  assert.equal(s.seen.calls, 2);
});

test('読めなかった（null）は取っておかない', async () => {
  const s = stage({ empty: true });
  assert.equal(await s.ctx._spReadAll('sp_quests'), null);
  assert.equal(await s.ctx._spReadAll('sp_quests'), null);
  assert.equal(s.seen.calls, 2, '「読めなかった」を取っておくと、直っても読み直せない');
});

test('転んだものも取っておかない', async () => {
  const s = stage({ fail: true });
  await s.ctx._spReadAll('x').catch(() => {});
  await s.ctx._spReadAll('x').catch(() => {});
  assert.equal(s.seen.calls, 2);
});

test('取っておいたものを並べ替えても、次の人に影響しない', async () => {
  const s = stage();
  const a = await s.ctx._spReadAll('sp_quests');
  a.reverse();
  a.push({ id: 'z' });
  const b = await s.ctx._spReadAll('sp_quests');
  assert.equal(b.length, 2, '写しではなく現物を配っている');
  assert.equal(b[0].id, 'a', '並びが書き換えられている');
});

test('書き換えたら捨てる（押した結果がすぐ出る）', async () => {
  const s = stage();
  await s.ctx._spReadAll('sp_quests');
  s.ctx._spMemoDrop();
  await s.ctx._spReadAll('sp_quests');
  assert.equal(s.seen.calls, 2, '捨てていない。押しても25秒変わらない');
});

test('捨てる先を絞れる', async () => {
  const s = stage();
  await Promise.all([s.ctx._spReadAll('sp_quests'), s.ctx._spReadAll('sp_wisdom')]);
  s.ctx._spMemoDrop('readall:sp_quests');
  await Promise.all([s.ctx._spReadAll('sp_quests'), s.ctx._spReadAll('sp_wisdom')]);
  assert.equal(s.seen.calls, 3, '絞ったはずが ' + s.seen.calls + '回読んでいる');
});

test('溜め込まない（上限を超えたら古いものから捨てる）', async () => {
  const s = stage();
  for (let i = 0; i < 140; i += 1) await s.ctx._spReadAll('p' + i);
  const size = vm.runInContext('_spMemoState().size', s.ctx);
  assert.ok(size <= 100, '取っておいたものが ' + size + '件まで増えている');
});

test('クエストと知恵は、新しい順に並べて返す', async () => {
  const s = stage();
  const q = await s.ctx._spAllQuests();
  assert.deepEqual(Array.from(q.map(r => r.id)), ['b', 'a'], '新しい順になっていない');
  const w = await s.ctx._spAllWisdom();
  assert.deepEqual(Array.from(w.map(r => r.id)), ['b', 'a']);
  assert.equal(s.seen.calls, 2);
});

test('クエストと知恵は、共有の読み口を通る', async () => {
  const s = stage();
  await Promise.all([s.ctx._spAllQuests(), s.ctx._spAllQuests(), s.ctx._spReadAll('sp_quests')]);
  assert.equal(s.seen.calls, 1, 'sp_quests を ' + s.seen.calls + '回読んでいる');
});

test('fresh を渡せば、取っておいたものを捨てて読み直す', async () => {
  const s = stage();
  await s.ctx._spAllQuests();
  await s.ctx._spAllQuests(true);
  assert.equal(s.seen.calls, 2, '読み直しを頼んでも古いものを返している');
});

/* ───────── 読む口が1本にまとまっていること ───────── */

test('クエスト一覧を直に読むところが残っていない', () => {
  const direct = INDEX.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /fb\.collection\(window\.db, 'sp_quests'\)/.test(l));
  assert.deepEqual(direct, [], '共有の読み口を通らない読み方が残っています');
});

test('知恵カード一覧を直に読むところが残っていない', () => {
  const direct = INDEX.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /fb\.collection\(window\.db, 'sp_wisdom'\)/.test(l));
  assert.deepEqual(direct, [], '共有の読み口を通らない読み方が残っています');
});

test('受けた記録・報告・引用も、直に読まない', () => {
  const direct = INDEX.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /getDocs\(fb\.collection\(window\.db, 'sp_(quests|wisdom)', [^)]*'(commits|logs|cites)'\)\)/.test(l));
  assert.deepEqual(direct, [], 'クエスト・カードごとに直に読むところが残っています');
});

test('完走の数えが「クエスト数 × 名義数」で読んでいない', () => {
  const fn = INDEX.slice(INDEX.indexOf('async function _spCompletedQuestsOnce('),
                         INDEX.indexOf('\n}\n', INDEX.indexOf('async function _spCompletedQuestsOnce(')));
  assert.ok(fn.length > 500, '完走の数えが見つかりません');
  assert.ok(fn.indexOf('for (const a of aliases)') < 0,
    '名義の数だけ1件ずつ読む形が残っています');
  assert.match(fn, /_spReadAll\('sp_quests\/' \+ encodeURIComponent\(q\.id\) \+ '\/commits'\)/,
    '受けた人の一覧を1回読む形になっていません');
});

test('完走の数えは、短いあいだ取っておく', () => {
  const wrap = INDEX.slice(INDEX.indexOf('const SP_COMPLETED_TTL_MS'),
                           INDEX.indexOf('function _spAliasesOf('));
  assert.match(wrap, /_spMemo\('completed:/, '呼ばれるたびに数え直している');
  assert.match(wrap, /SP_COMPLETED_TTL_MS = 5 \* 60 \* 1000/);
});

/* ───────── 回す速さ ───────── */

test('定期の読み直しは5分ごと', () => {
  const at = INDEX.indexOf('_spRefreshTimer = setInterval(');
  const near = INDEX.slice(at, at + 400);
  assert.match(near, /\}, 5 \* 60 \* 1000\);/,
    '読み直しの間隔が短すぎます: ' + near.slice(0, 120));
});

test('枠を使い切っているあいだは、読み直さない', () => {
  const fn = INDEX.slice(INDEX.indexOf('async function spDaoRefreshNow(why)'),
                         INDEX.indexOf('window.spDaoRefreshNow = spDaoRefreshNow;'));
  assert.match(fn, /reason === 'quota'/, '枠切れでも読みに行っている');
  assert.match(fn, /blockedUntil/);
  /* 断られたぶんがまた枠を削る。読みに行く前に止めること。 */
  assert.ok(fn.indexOf("reason === 'quota'") < fn.indexOf('emuEnsureEntitlement'),
    '読みに行ったあとで止めている');
});

test('書き込みの口は、すべて取っておいた答えを捨てる', () => {
  const lib = INDEX.slice(INDEX.indexOf('window.fbLib = {'),
                          INDEX.indexOf('window.fbAuth = {'));
  ['addDoc', 'updateDoc', 'setDoc', 'deleteDoc'].forEach(function (n) {
    assert.match(lib, new RegExp(n + ':\\s*_spAfterWrite\\(' + n + '\\)'),
      n + ' が捨てていない（押しても結果が出ない）');
  });
  assert.match(lib, /b\.commit = _spAfterWrite\(commit\)/, 'まとめ書きが捨てていない');
});

test('置かれたままの画面は、読み直しを止める', () => {
  const at = INDEX.indexOf('const SP_IDLE_STOP_MS');
  assert.ok(at > 0, '置かれたままを見分ける仕掛けがありません');
  const src = INDEX.slice(at, at + 1400);
  assert.match(src, /SP_IDLE_STOP_MS = 30 \* 60 \* 1000/);
  /* 触れば、その場で戻ること。止まったままになってはいけない。 */
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    assert.ok(src.indexOf("'" + ev + "'") > 0, ev + ' で戻らない');
  });
  assert.match(src, /Date\.now\(\) - _spLastTouch > SP_IDLE_STOP_MS/,
    '置かれたままでも読み直している');
  /* タブに戻ったときも「触った」と数えること。
     数えないと、戻っても止まったままになる。 */
  const vis = INDEX.slice(INDEX.indexOf("visibilityState === 'visible') { _spTouched()"), 0) ;
  assert.match(src, /visibilityState === 'visible'\) \{ _spTouched\(\); spDaoRefreshNow/,
    'タブに戻っても止まったままになる');
});

/* ───────── 実際に走らせて、往復の数を数える ─────────

   数え方を変えたと言うだけでは、次の人が元に戻してしまう。
   本物の関数を動かして、Firestore を何回叩くかを数える。

   直す前の index.html で同じことをすると156往復になる。
   （クエスト17本 × 名義3つ × 呼ばれる3か所 ＋ 一覧3回）
   それを60秒ごとに回していたので、1日の読み取り枠を
   5時間で使い切った。 */
const { build } = require('../year-goals-tests/extract.cjs');

function countingRun(html, quests, aliases) {
  const hits = { docs: 0, doc: 0, rest: 0 };
  const snap = (rows) => ({ size: rows.length, metadata: { fromCache: false },
    forEach: (f) => rows.forEach(r => f({ id: r.id, data: () => r })) });
  const stubs = {
    console: { warn() {}, log() {} },
    SP_READ_TTL_MS: 25000, SP_COMPLETED_TTL_MS: 300000,
    SpQuestStore: { isFounder: () => false, fullLabel: () => '一般 #001' },
    SpGuildStore: { guildIdOf: () => '', byId: () => null },
    spGuildDefs: async () => [],
    _spSoon: async (pr) => ({ ok: true, value: await pr }),
    _spRestGet: async () => { hits.rest += 1; return { documents: [] }; },
    _spRestFields: (f) => f,
    _spRestQuests: async () => { hits.rest += 1; return quests; },
    _spRestQuestCommits: async () => { hits.rest += 1; return []; },
    _spRestDoc: async () => { hits.rest += 1; return null; },
    window: { db: {}, fbLib: {
      doc: (...a) => ({ path: a.slice(1).join('/') }),
      collection: (...a) => ({ path: a.slice(1).join('/') }),
      getDoc: async () => { hits.doc += 1;
        return { exists: () => false, metadata: { fromCache: false }, data: () => ({}) }; },
      getDocs: async (ref) => { hits.docs += 1;
        return snap(ref.path === 'sp_quests' ? quests : []); }
    } }
  };
  const names = ['spCompletedQuests'];
  ['_spMemoState', '_spMemo', '_spMemoDrop', '_spAliasesOf', '_spCompletedQuestsOnce',
   '_spReadAll', '_spReadAllOnce', '_spAllQuests'].forEach(function (n) {
    if (html.indexOf('function ' + n + '(') >= 0) names.push(n);
  });
  const api = build(html, names, stubs);
  const me = { addr: aliases[0], wallet: aliases[0], ches: aliases[1], aliases: aliases };
  return { hits: hits, run: () => api.spCompletedQuests(me) };
}

test('クエスト17本を3か所から数えても、往復は20回まで', async () => {
  const quests = Array.from({ length: 17 }, (_, i) => ({ id: 'q' + i, title: 't' }));
  const c = countingRun(INDEX, quests, ['0xwallet', '0xches', '0xother']);
  /* 1回の読み直しで3か所から呼ばれる（信用スコア・パスポート・星空）。 */
  await c.run(); await c.run(); await c.run();
  const total = c.hits.docs + c.hits.doc + c.hits.rest;
  assert.ok(total <= 20,
    'Firestore を ' + total + '回叩いている（一覧 ' + c.hits.docs
    + ' ／1件ずつ ' + c.hits.doc + ' ／普通の通信 ' + c.hits.rest + '）');
  assert.equal(c.hits.doc, 0, '1件ずつ読む形が戻っている');
});

test('名義が増えても、往復は増えない', async () => {
  const quests = Array.from({ length: 17 }, (_, i) => ({ id: 'q' + i, title: 't' }));
  const few = countingRun(INDEX, quests, ['0xa']);
  await few.run();
  const many = countingRun(INDEX, quests, ['0xa', '0xb', '0xc', '0xd', '0xe']);
  await many.run();
  const t1 = few.hits.docs + few.hits.doc + few.hits.rest;
  const t2 = many.hits.docs + many.hits.doc + many.hits.rest;
  assert.equal(t1, t2,
    '名義1つで ' + t1 + '回、5つで ' + t2 + '回。名義の数だけ読んでいる');
});

test('クエストが増えても、増え方は本数ぶんだけ（掛け算にならない）', async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'q' + i, title: 't' }));
  const a = countingRun(INDEX, mk(2), ['0xa', '0xb', '0xc']);
  await a.run();
  const b = countingRun(INDEX, mk(17), ['0xa', '0xb', '0xc']);
  await b.run();
  const t2 = a.hits.docs + a.hits.doc + a.hits.rest;
  const t17 = b.hits.docs + b.hits.doc + b.hits.rest;
  /* 2本→17本で15本ぶん増えるだけ。名義3つ掛けて45増えてはいけない。 */
  assert.equal(t17 - t2, 15,
    'クエストが15本増えて、往復が ' + (t17 - t2) + '回増えている');
});
