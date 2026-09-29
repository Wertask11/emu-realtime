/* クエストをまとめて出す口の試験。

   #002 WORK は5分野×3段で15本ある。1本ずつ欄に貼ると半日かかり、
   貼り間違いが混ざる。貼るのは1回にした。

   ここが緩むと、題名も報酬も締切もあとから変えられないものが
   まとめて15本出てしまう。出す前に止まることを確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');
const SEED = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/quest-seeds/general-002-work.json'), 'utf8'));

const src = ADMIN.slice(ADMIN.indexOf('function aqBulkParse()'),
                        ADMIN.indexOf('function aqBulkSay('));
assert.ok(src.length > 500, 'まとめて出す口が見つかりません');

function parser(json) {
  const ctx = vm.createContext({
    JSON, Date, Number, String, Array, Error, Math,
    SpQuestStore: {
      isValidSeries: s => ['general', 'special'].includes(s),
      isValidNumber: n => Number.isInteger(n) && n >= 1 && n <= 999,
      isValidBranch: n => Number.isInteger(n) && n >= 0 && n <= 9,
      isValidStage: s => ['', '入門', '標準', '実践'].includes(s),
      fullLabel: q => '一般 #' + String(q.questNumber).padStart(3, '0')
        + (q.branch ? '-' + q.branch : '') + (q.stage ? ' ' + q.stage : '')
    },
    SpGuildStore: { isValidId: id => ['learn', 'work', 'play', 'connect', 'web3'].includes(id) },
    CURRENCIES: ['JPY', 'JPYC', 'EMUER'],
    ownerAddr: '0xowner',
    auth: { currentUser: { displayName: '運営' } },
    $: () => ({ value: json })
  });
  vm.runInContext(src, ctx);
  return () => ctx.aqBulkParse();
}
const run = (v) => parser(typeof v === 'string' ? v : JSON.stringify(v))();
const fails = (v, re) => {
  assert.throws(() => run(v), (e) => {
    assert.match(e.message, re, '出た文言: ' + e.message);
    return true;
  });
};

/* ───────── 本物の15本 ───────── */

test('#002 WORK の15本を、そのまま読める', () => {
  const rows = run(SEED);
  assert.equal(rows.length, 15);
});

test('15本の報酬は、段ごとに 50／100／200 EMUER', () => {
  const by = {};
  run(SEED).forEach(r => {
    const k = r.body.stage + ':' + r.body.budget + r.body.budgetCurrency;
    by[k] = (by[k] || 0) + 1;
  });
  assert.deepEqual(by, { '入門:50EMUER': 5, '標準:100EMUER': 5, '実践:200EMUER': 5 });
});

test('現場資料と与件が、切り詰められずに入る', () => {
  const rows = run(SEED);
  rows.forEach(r => {
    assert.ok(r.body.brief.length > 1000, r.label + ' の現場資料が入っていない');
    assert.notEqual(r.body.brief.length, 4000, r.label + ' の現場資料が上限で切れている');
    assert.ok(r.body.given.length > 100, r.label + ' の与件が入っていない');
    assert.notEqual(r.body.given.length, 1500, r.label + ' の与件が上限で切れている');
    assert.ok(r.body.deliverable && r.body.criteria, r.label + ' の提出か評価が空');
  });
});

test('15本すべての与件の先頭に、演習であることの断りが入っている', () => {
  run(SEED).forEach(r => {
    assert.match(r.body.given.slice(0, 120), /架空の演習/, r.label);
    assert.match(r.body.given.slice(0, 260), /実在する企業名・店名/, r.label);
  });
});

test('15本とも WORK ギルドで、出すのは運営', () => {
  run(SEED).forEach(r => {
    assert.equal(r.body.guildId, 'work', r.label);
    assert.equal(r.body.owner, '0xowner', r.label);
    assert.equal(r.body.status, 'OPEN', r.label);
  });
});

test('締切は 12/17・12/24・12/28 の3つ、どれも90日以内', () => {
  const rows = run(SEED);
  const days = rows.map(r => Math.ceil((r.closesAt - Date.parse('2026-10-01T00:00:00+09:00')) / 86400000));
  days.forEach((d, i) => assert.ok(d <= 90, rows[i].label + ' が ' + d + '日で90日を超える'));
  const dates = [...new Set(rows.map(r =>
    new Date(r.closesAt + 9 * 3600000).toISOString().slice(0, 10)))].sort();
  assert.deepEqual(dates, ['2026-12-17', '2026-12-24', '2026-12-28']);
});

test('実践がいちばん早く締まり、入門がいちばん遅い', () => {
  const by = {};
  run(SEED).forEach(r => { by[r.body.stage] = r.closesAt; });
  assert.ok(by['実践'] < by['標準'], '実践が標準より後に締まる');
  assert.ok(by['標準'] < by['入門'], '標準が入門より後に締まる');
});

/* ───────── 出す前に止まること ───────── */

test('空・壊れたJSON・配列でないものは断る', () => {
  fails('', /貼ってください/);
  fails('   ', /貼ってください/);
  fails('{', /読めません/);
  fails({ a: 1 }, /配列/);
  fails([], /空です/);
});

test('番号や段階が正しくないものは、何件目かを言って断る', () => {
  const ok = { series: 'general', questNumber: 9, branch: 0, stage: '', title: 'a' };
  fails([ok, { ...ok, series: 'x' }], /の2件目：系列/);
  fails([{ ...ok, questNumber: 0 }], /の1件目：番号/);
  fails([{ ...ok, branch: 99 }], /の1件目：枝番/);
  fails([{ ...ok, stage: '達人' }], /の1件目：段階/);
  fails([{ ...ok, title: '' }], /の1件目：題名/);
  fails([{ ...ok, guildId: 'nope' }], /の1件目：ギルド/);
});

test('貼った中に同じ番号が2つあれば、出す前に止める', () => {
  const q = { series: 'general', questNumber: 9, branch: 1, stage: '入門', title: 'a' };
  fails([q, { ...q, title: 'b' }], /同じ番号が貼った中に2つ/);
  /* 段が違えば別物。止めてはいけない。 */
  assert.equal(run([q, { ...q, stage: '標準' }]).length, 2);
});

test('一度に出せるのは60本まで', () => {
  const many = (n) => Array.from({ length: n }, (_, i) =>
    ({ series: 'general', questNumber: i + 1, branch: 0, stage: '', title: 'a' }));
  assert.equal(run(many(60)).length, 60);
  fails(many(61), /60本まで/);
});

/* ───────── 値の決め方 ───────── */

test('締切は closesAt をそのまま使い、無ければ日数、どちらも無ければ14日', () => {
  const base = { series: 'general', questNumber: 9, branch: 0, stage: '', title: 'a' };
  assert.equal(run([{ ...base, closesAt: 1800000000000 }])[0].closesAt, 1800000000000);
  const d3 = run([{ ...base, days: 3 }])[0].closesAt - Date.now();
  assert.ok(Math.abs(d3 - 3 * 86400000) < 5000, '日数が効いていない');
  const d14 = run([base])[0].closesAt - Date.now();
  assert.ok(Math.abs(d14 - 14 * 86400000) < 5000, '既定の14日になっていない');
});

test('日数は90日で頭打ちにする（フォームと同じ）', () => {
  const r = run([{ series: 'general', questNumber: 9, branch: 0, stage: '', title: 'a', days: 999 }]);
  const d = (r[0].closesAt - Date.now()) / 86400000;
  assert.ok(d <= 90.1, d + '日になっている');
});

test('通貨が変な値なら円にする。人数は1〜50に収める', () => {
  const base = { series: 'general', questNumber: 9, branch: 0, stage: '', title: 'a' };
  assert.equal(run([{ ...base, budgetCurrency: 'BTC' }])[0].body.budgetCurrency, 'JPY');
  assert.equal(run([{ ...base, budgetCurrency: 'EMUER' }])[0].body.budgetCurrency, 'EMUER');
  /* 人数の決め方は、1本ずつ出す欄（aqNeed）とまったく同じ式にしてある。
     0 と欠けている値は既定の5、負の数は1、大きすぎる値は50。
     ここを別の式にすると、同じ値を入れても出し方で結果が変わる。 */
  const same = (v) => Math.max(1, Math.min(50, Number(v) || 5));
  for (const v of [0, -3, 1, 5, 50, 999, undefined, 'x']) {
    assert.equal(run([{ ...base, need: v }])[0].body.need, same(v),
      '人数 ' + String(v) + ' の扱いが、1本ずつ出す欄とずれている');
  }
  assert.equal(same(0), 5);
  assert.equal(same(-3), 1);
  assert.equal(same(999), 50);
});

test('出す人は貼った中身ではなく、いまの運営で決める', () => {
  const r = run([{ series: 'general', questNumber: 9, branch: 0, stage: '', title: 'a',
    owner: '0xsomeone-else', status: 'CLOSED' }]);
  assert.equal(r[0].body.owner, '0xowner', '他人の名前で出せてはいけない');
  assert.equal(r[0].body.status, 'OPEN', '出した瞬間に閉じていてはいけない');
});

/* ───────── すでにある番号を飛ばすこと ───────── */

test('すでにある番号は飛ばす作りになっている', () => {
  const go = ADMIN.slice(ADMIN.indexOf('$("#aqBulkGo").onclick'),
                         ADMIN.indexOf('$("#avSubmit").onclick'));
  assert.match(go, /QUEST_NUMBER_TAKEN/, '途中で止まったら押し直せない');
  assert.match(go, /skipped/, '飛ばした数を数えていない');
  assert.match(go, /confirm\(/, '確かめずに15本出してしまう');
});

/* ───────── 一般 #003 PLAY「自分の町で、ゴミを拾う」 ─────────

   完走の判定はサーバーが持っていて、報告が
   「やってみた・つまずいた・気づいた」の3種類そろっているかを見る
   （backend/quest-completion.js の LOG_KINDS）。1つでも欠けると
   COMPLETION_EVIDENCE_MISSING で完走にならない。

   クエストの文面が別の言葉（開始宣言・中間報告・最終報告）で
   書かれていると、受けた人はそのとおりに3回書いて、それでも
   完走できない。文面の側に読み替えを書いておく。 */
const PLAY3 = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/quest-seeds/general-003-play.json'), 'utf8'));
const LOG_KINDS = ['やってみた', 'つまずいた', '気づいた'];

test('#003 PLAY を、そのまま読める', () => {
  const rows = run(PLAY3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body.title, '自分の町で、ゴミを拾う');
  assert.equal(rows[0].body.guildId, 'play');
  assert.equal(rows[0].body.budget, '100');
  assert.equal(rows[0].body.budgetCurrency, 'EMUER');
});

test('#003 の報告の言い換えが、システムの3種類と結び付けてある', () => {
  const b = run(PLAY3)[0].body;
  const text = b.brief + b.deliverable + b.criteria;
  LOG_KINDS.forEach(function (k) {
    assert.ok(text.indexOf(k) >= 0,
      '「' + k + '」が文面に出てこない。受けた人はこれを書けないと完走できない');
  });
  /* 3種類そろわないと完走にならないことを、はっきり書いてあること。 */
  assert.match(b.brief + b.deliverable, /1つでも欠けると/,
    '1種類でも欠けたら完走にならないことが書かれていない');
});

test('#003 の締切は 12/17。受けた人の14日後が 12/31 に収まる', () => {
  const at = run(PLAY3)[0].closesAt;
  const jst = new Date(at + 9 * 3600000).toISOString().slice(0, 10);
  assert.equal(jst, '2026-12-17', '募集の締切がずれている');
  const last = new Date(at + 14 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
  assert.equal(last, '2026-12-31', '最後に受けた人が年内に終わらない');
});

test('#003 に、安全と写真のきまりが書いてある', () => {
  const b = run(PLAY3)[0].body;
  [/ガラス片/, /注射針/, /顔が分かる写真/, /自宅が分かる写真/].forEach(function (x) {
    assert.match(b.brief, x, '守ってほしいことが抜けている: ' + x);
  });
});

test('#003 は案件ものとして出る（仮説検証の箱は出ない）', () => {
  const b = run(PLAY3)[0].body;
  assert.ok(b.given && b.deliverable && b.criteria, '案件ものの欄が空');
  assert.equal(b.knowledge, '', '仮説検証の箱と両方出ると、同じことを2度書くことになる');
});
