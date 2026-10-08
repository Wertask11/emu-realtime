/* Emu「知識を探す」：常時接続（Listen）が戻らないパソコンでも、普通の通信で読む。

   ここは onSnapshot だけで読んでいた。パソコンでは Listen が「transport errored」を
   繰り返して戻らないことがあり、ずっと「通信に時間がかかっています」のままだった。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const i = INDEX.indexOf('async function loadKnowledgeRequests(byUser) {');
const BODY = INDEX.slice(i, INDEX.indexOf('function _emuRenderKnowledgeRequests(', i));

test('Listen が4秒で返らなければ、普通の通信で募集を読む', () => {
  assert.ok(i > 0);
  assert.ok(BODY.indexOf("_spRestGet('knowledge_requests?pageSize=30&orderBy=' + encodeURIComponent('createdAt desc'), true)") > 0,
    '普通の通信で読んでいない（ログインの証も付ける）');
  assert.ok(BODY.indexOf('restSoon = setTimeout(viaRest, 4000);') > 0, '待つ時間が決まっていない');
  assert.ok(/clearTimeout\(restSoon\)/.test(BODY), '止めたあとも逃げ道が走る');
});

test('Listen が転んだときも、断られたのでなければ普通の通信で読み直す', () => {
  const j = BODY.indexOf('async function (error) {');
  assert.ok(j > 0, '転んだときの受け口が無い');
  const seg = BODY.slice(j, j + 300);
  assert.ok(seg.indexOf("error.code === 'permission-denied'") > 0 && seg.indexOf('await viaRest()') > 0);
});
