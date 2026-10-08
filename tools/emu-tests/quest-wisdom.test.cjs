/* クエストを受けて報告まで出したのに、知恵カードが置けなかった。

   置く前に「受けているか」を確かめるところが、Firestore の SDK（getDoc）に先に聞いていた。
   SDK の常時接続（Listen）が切れていると「client is offline」で例外になり、
   普通の通信で聞き直す前に「受けているかを確かめられませんでした」で止まっていた。
   報告（やってみた / つまずいた / 気づいた）は別の道で出せるので、知恵カードだけ置けなかった。
   「受ける」ボタンと同じく、サーバーの記録を普通の通信（REST）で1件読む。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');

const bodyOf = (head) => {
  const i = INDEX.indexOf(head);
  assert.ok(i > 0, head);
  return INDEX.slice(i, INDEX.indexOf('\n};\n', i));
};
const COMMIT_REST = "_spRestDoc('sp_quests/' + encodeURIComponent(questId)\n      + '/commits/' + encodeURIComponent(p.addr), true)";

test('知恵カードを置く前の「受けているか」は、SDK ではなくサーバーの記録（REST）で確かめる', () => {
  const b = bodyOf('window.spQuestWisdom = async function (questId, app) {');
  assert.ok(b.indexOf(COMMIT_REST) >= 0, 'REST で受けた記録を読んでいない');
  assert.equal(/getDoc\([^)]*'commits'/.test(b), false, 'SDK の getDoc で受けた記録を読んでいる（切れていると止まる）');
  /* 受けていない人は今まで通り止める。読めなかったときも置かせない */
  assert.ok(b.indexOf("if (!took) { alert('知恵カードを置けるのは、このクエストを受けた人だけです。'); return; }") >= 0);
  assert.ok(b.indexOf("alert('受けているかを確かめられませんでした。通信を確かめて、もう一度お試しください。'); return;") >= 0);
  assert.ok(b.indexOf(COMMIT_REST) < b.indexOf('openSpWisdomForm(q, app);'), '確かめる前に札を開いている');
});

test('完了にしたあと続けて置くときも、同じく REST で確かめる', () => {
  const b = bodyOf('window.spQuestClose = async function (questId, app) {');
  assert.ok(b.indexOf(COMMIT_REST) >= 0);
  assert.equal(/getDoc\([^)]*'commits'/.test(b), false);
});
