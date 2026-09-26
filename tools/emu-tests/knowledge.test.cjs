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

test('見学の範囲が、本数で決まっている', () => {
  assert.ok(INDEX.indexOf('const GUEST_KNOWLEDGE_LIMIT = 20;') >= 0, '本数が決まっていない');
  assert.ok(INDEX.indexOf('GUEST_KNOWLEDGE_LIMIT - knowledgeShown') >= 0, '残りを数えていない');
});

test('段が届くのを待ってから、見学かどうかを決める', () => {
  const i = INDEX.indexOf('const guest = !emuHasPlan');
  assert.ok(i > 0, '判定が見当たらない');
  const before = INDEX.slice(Math.max(0, i - 400), i);
  assert.ok(before.indexOf('await emuEnsureEntitlement()') >= 0, '段を待っていない');
});

test('見学で止まったことを、画面へ伝えている', () => {
  assert.ok(INDEX.indexOf('guestCapped: guestCapped, guestLimit: GUEST_KNOWLEDGE_LIMIT') >= 0,
    '止まったことを渡していない');
  assert.ok(INDEX.indexOf('knowledgeHasMore = false;') >= 0, '続きがあるように見せてしまう');
});

test('知識の画面に、区切りを出す場所がある', () => {
  assert.ok(KNOW.indexOf('id="guestWall"') >= 0, '出す箱が無い');
  assert.ok(KNOW.indexOf('state.guestCapped=!!m.guestCapped') >= 0, '受け取っていない');
  assert.ok(KNOW.indexOf('どなたでも読める新着') >= 0, '何も言わずに終わっている');
  assert.ok(KNOW.indexOf('Emu light') >= 0, 'この先どうすれば読めるか書いていない');
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
