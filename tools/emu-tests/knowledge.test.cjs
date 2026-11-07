/* 見学の人に、知識が一部見えるか。

   前は「運営が選んだ知識だけ（recommended == true）」を見せる作りだった。
   ところが本番の posts 106件のうち、recommended を持つものは0件。
   立てる画面もサーバーの入口も作られていなかった。
   だから見学の人には「該当する知識がありません」しか出なかった。
   10/1 に来た一般ユーザーは、全員がこれを踏むところだった。

   いまは、新着の頭から GUEST_KNOWLEDGE_LIMIT 件までを見学の範囲にする。
   選ぶ手間が要らず、開幕日から中身が見える。

   もうひとつ。段（プラン）が届くのを待たずに判定していたため、
   公式パスを持っている人でも、間に合わなければ見学者として絞られていた。
   「読めるときと読めないときがある」の正体。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const KNOW = readHtml('frontend/public/knowledge.html');

test('知識一覧と見張りが、recommended で絞るのをやめている', () => {
  /* 22272 の showEmuFeed('recommended') は別物（旧フィード）。
     ここで見るのは、知識を読む画面が使う2か所だけ。
     どちらも本番に1件も無い欄で絞っていた。 */
  assert.equal(INDEX.indexOf("where('recommended', '==', true)"), -1,
    "知識一覧か見張りが、まだ recommended で絞っている");
});

/* 11/7 創業者決定：見学の「新着20件」の制限は廃止。見学の人も、公開している知識を最後まで読める。
   一覧（index.html）でも Knowledge Lab（検索・投稿の詳細）でも、20件で止めない。 */
test('見学でも、20件で止めない（一覧）', () => {
  assert.equal(INDEX.indexOf('GUEST_KNOWLEDGE_LIMIT'), -1, '見学の本数の制限が残っている');
  assert.equal(INDEX.indexOf('guestCapped: guestCapped'), -1, '止まったことを渡している');
  assert.equal(INDEX.indexOf('knowledgeHasMore = false;'), -1, '見学で続きを止めている');
});

test('見学でも、20件で止めない（Knowledge Lab の検索・投稿の詳細・料金表）', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  const service = read('backend/knowledge-lab/service.js'), semantic = read('backend/knowledge-lab/semantic.js');
  assert.doesNotMatch(service, /READER_PLAN_REQUIRED|guestCapped|\.limit\(20\)\s*\.get\(\);\s*if \(!s\.docs\.some/);
  assert.doesNotMatch(semantic, /guestCapped|plan\.guest/);
  assert.doesNotMatch(read('backend/membership-policy.js'), /latest-20/);
  assert.doesNotMatch(read('frontend/public/membership-features.js'), /新着20件/);
  assert.doesNotMatch(read('frontend/public/knowledge-lab/lab.js'), /新着20件/);
});

/* ───────── 旧ログインボーナス ─────────

   配布はサーバーで止めてあったが、画面の箱とボタンは残っていて、
   隠すかどうかはサーバーの「もう配っていません」という返事に頼っていた。
   その返事が返らなければボタンが出たままになり、押せば失敗する。
   出していない約束は、画面からも消す。 */

test('「+0.5 受取」のボタンが無い', () => {
  assert.equal(INDEX.indexOf('id="emuLoginBonusBtn"'), -1, 'ボタンが残っている');
  assert.equal(INDEX.indexOf('id="emuLoginBonusRow"'), -1, '箱が残っている');
});

test('パスポートのショートカットにも無い', () => {
  assert.equal(INDEX.indexOf('onclick="handleLoginBonus()"'), -1, 'ショートカットが残っている');
  assert.equal(INDEX.indexOf("label: 'ログイン\\nボーナス'"), -1, '差し替えの一覧に残っている');
});

test('サーバーに受取状況を聞きに行かない', () => {
  assert.equal(INDEX.indexOf('refreshEmuLoginBonusStatus();\n}'), -1, 'まだ聞きに行っている');
});

test('読み込み中の豆知識でも宣伝しない', () => {
  assert.equal(INDEX.indexOf('ログインボーナスは毎日+0.5 EMUER'), -1,
    '無いものを宣伝し続けている');
});
