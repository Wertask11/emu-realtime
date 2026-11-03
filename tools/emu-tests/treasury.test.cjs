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

/* 11/2 の画面統合（#265）で、SchoolPark のトレジャリーの画面（spDaoLoadTreasury）は終了した。
   同じ数え方（上限は支出ではない・引くのは実際に渡したぶんだけ・読めないときに0と書かない）は、
   運営が見る管理画面のトレジャリーで守る（下の管理画面のテスト）。11/3 テストを今の形に合わせる。 */
test('SchoolPark のトレジャリーの画面は終了し、古い数え方（クエストの額を「ある」から引く）がどこにも残っていない', () => {
  assert.equal(INDEX.indexOf('window.spDaoLoadTreasury'), -1, '終了したトレジャリーの画面の読み込みが残っている');
  assert.equal(DAO.indexOf('{{ treasury.'), -1, '終了したトレジャリーの画面が残っている');
  assert.equal(INDEX.indexOf('pot[c].have - pot[c].promised'), -1, 'クエストの1人あたり額を残高から引いている');
});

test('帳簿を読む口は、取っておく仕掛けを通る', () => {
  const at = INDEX.indexOf('async function _spQuestBudgets()');
  assert.ok(at > 0, '帳簿を読む口が見つからない');
  const fn = INDEX.slice(at, INDEX.indexOf('\n}\n', at));
  assert.match(fn, /_spMemo\('emuer-budgets'/,
    '読み直すたびに Render を叩いている');
  assert.match(fn, /allocatedEmuer/);
  assert.match(fn, /totalEmuer/);
});

/* ───────── 管理画面のトレジャリーも、同じ数え方 ─────────

   同じ計算が2か所にあった。SchoolPark の画面だけ直しても、
   運営が見る管理画面は赤いままになる。両方を見る。 */
const ADMIN = readHtml('frontend/public/membership-admin.html');
const ADMIN_TR = ADMIN.slice(ADMIN.indexOf('/* ───── トレジャリーの集計 ─────'),
                             ADMIN.indexOf('<label>何のお金か</label>'));

test('管理画面が、クエストの額を「ある」から引いていない', () => {
  assert.ok(ADMIN_TR.length > 1000, 'トレジャリーの集計が見つかりません');
  assert.equal(ADMIN_TR.indexOf('pot[c].have - pot[c].promised'), -1,
    'クエストの1人あたり額を残高から引いている（これが赤字の原因）');
  assert.match(ADMIN_TR, /pot\[c\]\.have - paid/,
    '実際に渡したぶんを引いていない');
});

test('管理画面が、本当の帳簿を読んでいる', () => {
  assert.match(ADMIN_TR, /guild-quest\/budgets/, '本当の帳簿を読んでいない');
  assert.match(ADMIN_TR, /allocatedEmuer/);
  assert.match(ADMIN_TR, /totalEmuer/);
  /* 上限は引かない。引くと、払えるのに払えないように見える。 */
  assert.equal(ADMIN_TR.indexOf('- emuLedger.total'), -1, '上限を負債として引いている');
});

test('管理画面が、読めなかったときに0と書かない', () => {
  assert.match(ADMIN_TR, /いま読めません/, '読めないのに0を出している');
  assert.match(ADMIN_TR, /const known = \(c !== "EMUER"\) \|\| !!emuLedger/);
});

test('管理画面の古い文言が、画面に出ていない', () => {
  /* 何が起きていたかの説明は、注釈として残してよい。
     見るのは、実際に画面へ出す文字のほう。 */
  const shown = ADMIN_TR.slice(ADMIN_TR.indexOf('el.innerHTML ='));
  assert.ok(shown.length > 500, '画面に出す部分が見つかりません');
  assert.equal(shown.indexOf('約束済み'), -1, '古い「約束済み」が画面に出ている');
  assert.equal(shown.indexOf('払えない約束をしていることになります'), -1,
    '古い警告文が画面に出ている');
  assert.match(shown, /渡したぶん/, '新しい言い方になっていない');
});

test('管理画面も、上限とクエストの額を別行で見せている', () => {
  assert.match(ADMIN_TR, /お金は減っていません/, '上限の意味が書かれていない');
  assert.match(ADMIN_TR, /支払う額そのものではありません/,
    'クエストの額が目安であることを断っていない');
  /* 予算を1本も出していないときは、どこから出すのか書く。 */
  assert.match(ADMIN_TR, /EMUERの予算を公開/);
});
