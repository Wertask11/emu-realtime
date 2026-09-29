/* トレジャリーの3つの数字。

   長いあいだ、この画面は sp_quests の budget 欄を足していた。
   あれはカードに出る「1人あたりの報酬額」で、何人完走するかも、
   実際にいくら確保したかも入っていない。それを「約束済み」と呼び、
   「ある」から引いていた。

   9/29、#002 WORK を15本出しただけで 1,750（50×5+100×5+200×5）が
   足され、使える額が -1,750 になり「約束が持っている額を超えています」
   と赤字で出た。お金は1円も動いていない。クエストを出すたびに
   赤字が増える作りだった。

   本当の額は emuer_v2_guild_quest_budgets にある。
   引き算に使うのは allocatedEmuer（実際に人へ引き当てた額）だけ。
   totalEmuer は「ここまでなら渡せる」という上限で、負債ではない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');

/* #002 WORK 15本ぶん。入門50×5・標準100×5・実践200×5。 */
const WORK15 = [];
[[50, '入門'], [100, '標準'], [200, '実践']].forEach(function (pair) {
  for (let i = 0; i < 5; i += 1) {
    WORK15.push({ id: 'w' + pair[1] + i, title: '仕事', budget: String(pair[0]),
      budgetCurrency: 'EMUER', status: 'OPEN', createdAt: 1 });
  }
});

function load(opts) {
  const o = opts || {};
  const state = {};
  const app = { state: state, setState: function (x) { Object.assign(state, x); } };
  const warn = [];
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    SP_CURRENCIES: ['JPY', 'JPYC', 'EMUER'],
    SP_CURRENCY_LABEL: { JPY: '円', JPYC: 'JPYC', EMUER: 'EMUER' },
    SP_SHARE_DONE: 0.8, SP_SHARE_POOL: 0.2,
    spMoney: function (v, c) { return Math.round(Number(v) || 0) + ' ' + c; },
    _spReadAll: async function (path) {
      if (path === 'sp_quests') return o.quests || [];
      if (path === 'sp_treasury') return o.entries || [];
      return [];
    },
    _spQuestBudgets: async function () {
      if (o.ledgerFails) throw new Error('HTTP 500');
      return o.ledger || { count: 0, total: 0, allocated: 0, remaining: 0 };
    },
    window: { db: {}, fbLib: {} },
    Date, Math, Number, String, parseInt
  };
  const api = build(INDEX, ['spDaoLoadTreasury'], stubs);
  return { run: () => api.spDaoLoadTreasury(app), state: state, warn: warn };
}

const HAVE_12500 = [{ kind: 'in', amount: 12500, currency: 'EMUER', at: Date.now() }];

/* 選んでいる通貨は最初のタブ（円）。EMUER を見るには切り替える。 */
function emuer(state) {
  const tab = state.treasury.curTabs.find(function (t) { return t.label === 'EMUER'; });
  tab.go();
  return state.treasury;
}

/* ───────── 9/29 に起きたこと ───────── */

test('クエストを15本出しただけでは、使える額は1 EMUER も減らない', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500 });
  await l.run();
  const t = emuer(l.state);
  assert.equal(t.card.have, '12500 EMUER');
  assert.equal(t.card.paid, '0 EMUER', '出しただけで渡したことになっている');
  assert.equal(t.card.free, '12500 EMUER',
    'クエストを出しただけで使える額が減っている（これが -1750 の原因）');
  assert.equal(t.card.warn, '', 'お金が動いていないのに警告を出している');
});

test('予算の上限を大きく取っても、使える額は減らない', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500,
    ledger: { count: 15, total: 175000, allocated: 0, remaining: 175000 } });
  await l.run();
  const t = emuer(l.state);
  assert.equal(t.card.free, '12500 EMUER',
    '上限を決めただけで負債として引いている');
  assert.match(t.card.reserved, /175000 EMUER/, '上限がどこにも出ていない');
  assert.match(t.card.reserved, /お金は減っていません/, '上限の意味が書かれていない');
});

test('人に渡したぶんだけが引かれる', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500,
    ledger: { count: 15, total: 175000, allocated: 3000, remaining: 172000 } });
  await l.run();
  const t = emuer(l.state);
  assert.equal(t.card.paid, '3000 EMUER');
  assert.equal(t.card.free, '9500 EMUER', '12500 − 3000 になっていない');
  assert.equal(t.card.warn, '');
});

test('本当に足りなくなったときは、赤く言う', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500,
    ledger: { count: 15, total: 175000, allocated: 20000, remaining: 155000 } });
  await l.run();
  const t = emuer(l.state);
  assert.equal(t.card.free, '-7500 EMUER');
  assert.equal(t.card.freeColor, '#E08A7A');
  assert.match(t.card.warn, /渡した額が/, '本当に足りないときに黙っている');
});

/* ───────── 読めなかったとき ───────── */

test('帳簿が読めないときは、0と書かない', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500, ledgerFails: true });
  await l.run();
  const t = emuer(l.state);
  assert.equal(t.card.paid, 'いま読めません', '読めないのに0を出している');
  assert.equal(t.card.free, '—', '読めないのに使える額を出している');
  assert.match(t.card.warn, /読めませんでした/);
  assert.equal(t.card.freeColor, '#D0E2BE', '読めないだけで赤くしない');
});

test('帳簿が読めなくても、画面そのものは出る', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500, ledgerFails: true });
  await l.run();
  assert.ok(l.state.treasury, '画面ごと落ちている');
  assert.ok(l.state.treasury.txs.length > 0, '直近の動きまで消えている');
  assert.match(l.warn.join(''), /EMUER の予算を読めませんでした/);
});

/* ───────── 内訳 ───────── */

test('EMUER の内訳は、上限・渡したぶん・残りの3つ', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500,
    ledger: { count: 15, total: 175000, allocated: 35000, remaining: 140000 } });
  await l.run();
  const t = emuer(l.state);
  assert.deepEqual(Array.from(t.alloc.map(function (a) { return a.label; })),
    ['確保してある上限', '渡したぶん', 'まだ渡せるぶん']);
  assert.equal(t.alloc[1].amount, '35000 EMUER');
  assert.equal(t.alloc[1].pct, '20%');
});

test('予算をまだ1本も出していなければ、出し方を書く', async () => {
  const l = load({ quests: WORK15, entries: HAVE_12500 });
  await l.run();
  const t = emuer(l.state);
  assert.deepEqual(Array.from(t.alloc), []);
  assert.match(t.allocNote, /EMUERの予算を公開/, 'どこから出すのか書かれていない');
});

test('円とJPYCは、目安であることを断る', async () => {
  const l = load({
    quests: [{ id: 'y1', title: '仕事', budget: '50000', budgetCurrency: 'JPY',
               status: 'OPEN', createdAt: 1 }],
    entries: [{ kind: 'in', amount: 100000, currency: 'JPY', at: Date.now() }] });
  await l.run();
  const t = l.state.treasury;                 /* 最初のタブが円 */
  assert.equal(t.card.have, '100000 JPY');
  assert.equal(t.card.paid, '0 JPY', '円には帳簿が無いのに引いている');
  assert.equal(t.card.free, '100000 JPY',
    'クエストを出しただけで円の使える額が減っている');
  assert.match(t.allocNote, /支払う額そのものではありません/,
    '目安であることを断っていない');
});

/* ───────── 画面の側 ───────── */

test('画面が、渡したぶんと上限の両方を出している', () => {
  assert.match(DAO, /渡したぶん[\s\S]{0,200}treasury\.card\.paid/,
    '渡したぶんが出ていない');
  assert.match(DAO, /treasury\.card\.reserved/, '確保の上限が出ていない');
  assert.equal(DAO.indexOf('treasury.card.promised'), -1,
    '古い「約束済み」が残っている');
  assert.equal(DAO.indexOf('約束が持っている額を超えています'), -1,
    '古い警告文が残っている');
});

test('注記が、上限は支出ではないと言っている', () => {
  assert.match(DAO, /予算を出しただけでは EMUER は動きません/);
  assert.match(DAO, /支出でも借りでもありません/);
});

test('帳簿を読む口は、取っておく仕掛けを通る', () => {
  const fn = INDEX.slice(INDEX.indexOf('async function _spQuestBudgets()'),
                         INDEX.indexOf('window.spDaoLoadTreasury'));
  assert.match(fn, /_spMemo\('emuer-budgets'/,
    '読み直すたびに Render を叩いている');
  assert.match(fn, /allocatedEmuer/);
  assert.match(fn, /totalEmuer/);
});
