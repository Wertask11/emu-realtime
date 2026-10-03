/* EMUER の予算を、まとめて公開する口。

   #002 WORK は15本ある。1本ずつ押すと16回になり、途中で1回でも
   転ぶと、どこまで済んだのか分からなくなる。

   ここが緩むと、額を変えられない予算がまとめて15本出てしまう。
   出す前に全部並べて見せること、押し直しても二度出さないこと、
   10/1 の関門に当たったら止まることを確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');

const SRC = ADMIN.slice(ADMIN.indexOf('const qbAllBtn = $("#qbAll");'),
                        ADMIN.indexOf('el.querySelectorAll("[data-qbudget]")'));
assert.ok(SRC.length > 1500, 'まとめて出す口が見つかりません');

/* #002 WORK 15本。入門50×5・標準100×5・実践200×5。 */
function work15() {
  const out = [];
  [[50, '入門'], [100, '標準'], [200, '実践']].forEach(pair => {
    for (let i = 0; i < 5; i += 1) {
      out.push({ id: 'w-' + pair[1] + '-' + i, title: '仕事', stage: pair[1],
        budget: String(pair[0]), budgetCurrency: 'EMUER', questNumber: 2 });
    }
  });
  return out;
}

function stage(opts) {
  const o = opts || {};
  const seen = { posts: [], alerts: [], confirms: [], prompts: [], rendered: 0 };
  const targets = o.targets || work15();
  const ctx = vm.createContext({
    Number, String, Math, parseInt, Array, Object, Error, JSON,
    console: { warn() {} },
    $: () => ({ set onclick(f) { ctx.__fire = f; }, get onclick() { return ctx.__fire; } }),
    SpQuestStore: { fullLabel: q => '一般 #002 ' + q.stage, isFounder: () => false },
    SP_STAGE_EMUER: q => ({ '入門': 50, '標準': 100, '実践': 200 })[String((q && q.stage) || '')] || 100,
    emuNeedBudget: () => targets,
    emuPerPerson: q => parseInt(q.budget, 10) || 100,
    prompt: (msg, def) => { seen.prompts.push(msg); return o.people === undefined ? def : o.people; },
    confirm: (msg) => { seen.confirms.push(msg); return o.cancel ? false : true; },
    alert: (msg) => { seen.alerts.push(msg); },
    renderSchoolPark: () => { seen.rendered += 1; },
    encodeURIComponent,
    api: async (p, init) => {
      seen.posts.push({ path: p, body: init.body });
      const fail = (o.failFor || {})[seen.posts.length];
      if (fail) throw Object.assign(new Error(fail), { code: fail });
      if ((o.alreadyFor || []).indexOf(seen.posts.length) >= 0) return { ok: true, alreadyPublished: true };
      return { ok: true };
    }
  });
  vm.runInContext(SRC, ctx);
  return { ctx, seen, fire: () => ctx.__fire() };
}

/* ───────── 出す前に止まること ───────── */

test('出す前に、15本ぜんぶと総額を見せる', async () => {
  const s = stage();
  await s.fire();
  assert.equal(s.seen.confirms.length, 1, '確かめずに出している');
  const msg = s.seen.confirms[0];
  assert.match(msg, /15本ぶん公開します/);
  /* 15行ぜんぶ出ていること。1本でも隠れていたら、知らずに出すことになる。 */
  ['入門', '標準', '実践'].forEach(st => {
    const n = (msg.match(new RegExp(st, 'g')) || []).length;
    assert.equal(n, 5, st + ' が ' + n + '本しか出ていない');
  });
  /* 総額 = (50+100+200)×5本×100人 = 175,000 */
  assert.match(msg, /175,000 EMUER/, '総額が出ていない: ' + msg.slice(-120));
  assert.match(msg, /額は変えられません/, '取り返しがつかないことを言っていない');
});

test('確かめで「いいえ」なら、1本も出さない', async () => {
  const s = stage({ cancel: true });
  await s.fire();
  assert.equal(s.seen.posts.length, 0, 'やめたのに出している');
});

test('人数を入れなければ、何もしない', async () => {
  for (const v of ['', '0', '-3', 'あ']) {
    const s = stage({ people: v });
    await s.fire();
    assert.equal(s.seen.posts.length, 0, '人数「' + v + '」で出している');
  }
});

test('相手が1本も無ければ、そう言って終わる', async () => {
  const s = stage({ targets: [] });
  await s.fire();
  assert.equal(s.seen.posts.length, 0);
  assert.match(s.seen.alerts[0], /ありません/);
});

/* ───────── 出す中身 ───────── */

test('1人あたりの額は、カードに書いた額を使う', async () => {
  const s = stage();
  await s.fire();
  assert.equal(s.seen.posts.length, 15);
  const per = s.seen.posts.map(p => p.body.perPersonEmuer).sort((a, b) => a - b);
  assert.deepEqual(Array.from(per),
    [50, 50, 50, 50, 50, 100, 100, 100, 100, 100, 200, 200, 200, 200, 200],
    'カードの額と違う額で出している');
});

test('総額は、1人あたり × 人数', async () => {
  const s = stage({ people: '10' });
  await s.fire();
  s.seen.posts.forEach(p => {
    assert.equal(p.body.totalEmuer, p.body.perPersonEmuer * 10,
      '掛け算が合っていない: ' + JSON.stringify(p.body));
  });
});

test('叩く先は、クエストごとの口', async () => {
  const s = stage();
  await s.fire();
  s.seen.posts.forEach(p => {
    assert.match(p.path, /^\/api\/schoolpark\/quest-completions\/.+\/budget$/,
      '別の口を叩いている: ' + p.path);
  });
  /* 15本とも別のクエストへ。同じところへ15回投げていないこと。 */
  const uniq = new Set(s.seen.posts.map(p => p.path));
  assert.equal(uniq.size, 15, '同じクエストへ何度も投げている');
});

/* ───────── 転んだとき ───────── */

test('10/1 の関門に当たったら、そこで止める', async () => {
  const s = stage({ failFor: { 1: 'NOT_STARTED' } });
  await s.fire();
  assert.equal(s.seen.posts.length, 1,
    '断られると分かっているのに ' + s.seen.posts.length + '回投げている');
  assert.match(s.seen.alerts[0], /10月1日/, 'なぜ出せないのか言っていない');
});

test('1本転んでも、残りは出す', async () => {
  const s = stage({ failFor: { 3: 'FIRESTORE_UNAVAILABLE' } });
  await s.fire();
  assert.equal(s.seen.posts.length, 15, '転んだところで止まっている');
  assert.match(s.seen.alerts[0], /出した：14本/);
  assert.match(s.seen.alerts[0], /出せませんでした/);
  assert.match(s.seen.alerts[0], /もう一度押すと/, '押し直せることを言っていない');
});

test('すでに違う額で出ているものは、名前を出して飛ばす', async () => {
  const s = stage({ failFor: { 2: 'BUDGET_EXISTS_DIFFERENT' } });
  await s.fire();
  assert.equal(s.seen.posts.length, 15);
  assert.match(s.seen.alerts[0], /すでに違う額で出ています/);
  assert.match(s.seen.alerts[0], /変えられません/);
});

test('同じ額ですでに出ていたものは、出したぶんに数えない', async () => {
  const s = stage({ alreadyFor: [1, 2, 3] });
  await s.fire();
  assert.match(s.seen.alerts[0], /出した：12本/);
  assert.match(s.seen.alerts[0], /すでに同じ額で出ていた：3本/);
});

test('終わったら、画面を読み直す', async () => {
  const s = stage();
  await s.fire();
  assert.equal(s.seen.rendered, 1, '出したのに画面が古いまま');
});

/* ───────── 相手の選び方（画面の側） ───────── */

test('相手は、予算が無い EMUER のクエストだけ', () => {
  const pick = ADMIN.slice(ADMIN.indexOf('const emuNeedBudget = ()'),
                           ADMIN.indexOf('const emuNeedBudget = ()') + 400);
  assert.match(pick, /isFounder\(q\)/, '#000 を相手に入れている');
  assert.match(pick, /budgetCurrency === "EMUER"/, '円のクエストに EMUER の予算を出そうとしている');
  assert.match(pick, /!emuBudgetOf\.has\(q\.id\)/, 'すでに出ているものを外していない');
});

test('1人あたりの額は、カードの額を先に見る', () => {
  const fn = ADMIN.slice(ADMIN.indexOf('const emuPerPerson = q =>'),
                         ADMIN.indexOf('const emuNeedBudget = ()'));
  assert.match(fn, /q\.budgetCurrency === "EMUER" && onCard > 0/,
    'カードに書いた額を見ていない');
  assert.match(fn, /SP_STAGE_EMUER\(q\)/, '書いていないときの決め方が無い');
});

test('予算が付いているクエストは、額と渡したぶんを出す', () => {
  assert.match(ADMIN, /emuBudgetOf\.has\(q\.id\)[\s\S]{0,400}渡した/,
    'もう予算があることが行から分からない');
});

test('帳簿が読めないときは、まとめて出す口を出さない', () => {
  const box = ADMIN.slice(ADMIN.indexOf('クエストの状態を変える'),
                          ADMIN.indexOf('const qbAllBtn'));
  assert.match(box, /if \(!emuLedger\)/,
    '読めていないのに「予算が無い」と決めつけて出してしまう');
});

/* ───────── カードの額が「全体の予算」だったとき ─────────

   10/2、一般 #001 でこれをやった。カードに「12,500 EMUER」と
   書いてあったが、それはクエスト全体の予算のつもりで入れた数字で、
   1人あたりではなかった。そのまま 12,500 × 100人 ＝ 1,250,000 の
   予算が立ち、1人完走するたびに 12,500 出る状態になった。

   予算はいちど出すと変えられない。長い一覧の中に混ぜて出すと、
   1本だけ桁が違っていても気づかない。 */

test('カードの額が段から決まる額と違えば、先に別で見せて止める', async () => {
  const s = stage({ targets: [{ id: 'q1', title: 'Emuの知識を、やってみる', stage: '',
    budget: '12500', budgetCurrency: 'EMUER', questNumber: 1 }] });
  await s.fire();
  assert.equal(s.seen.confirms.length, 2,
    '確かめが ' + s.seen.confirms.length + '回しかない（桁違いを別に見せていない）');
  const warn = s.seen.confirms[0];
  assert.match(warn, /カードの額と、段から決まる額が違う/);
  assert.match(warn, /12,500 EMUER/, 'カードの額が出ていない');
  assert.match(warn, /100 EMUER/, '段から決まる額が出ていない');
  assert.match(warn, /1,250,000 EMUER/, '総額が出ていない。桁が分からない');
  assert.match(warn, /クエスト全体の予算を書いた欄ではありません/,
    '何を取り違えやすいのか言っていない');
});

test('そこで「いいえ」なら、1本も出さない', async () => {
  const s = stage({ cancel: true, targets: [{ id: 'q1', title: 'x', stage: '',
    budget: '12500', budgetCurrency: 'EMUER', questNumber: 1 }] });
  await s.fire();
  assert.equal(s.seen.posts.length, 0, 'やめたのに出している');
});

test('カードの額と段から決まる額が同じなら、よけいに聞かない', async () => {
  const s = stage();                               // #002 の15本。どれも一致する
  await s.fire();
  assert.equal(s.seen.confirms.length, 1,
    '同じなのに2回聞いている（毎回聞くと、本当に違うときに気づかなくなる）');
  assert.equal(s.seen.posts.length, 15);
});

test('違うものだけを出す（合っているものは混ぜない）', async () => {
  const s = stage({ targets: work15().concat([{ id: 'odd', title: 'ずれている', stage: '',
    budget: '12500', budgetCurrency: 'EMUER', questNumber: 1 }]) });
  await s.fire();
  const warn = s.seen.confirms[0];
  assert.match(warn, /1本あります/, '何本ずれているのか合っていない');
  assert.doesNotMatch(warn, /入門/, '合っているものまで並べている');
});
