/* 知識の募集フォーム：短い題名でも出せる。足りないときは、どの欄かを名指しで知らせる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');
const INDEX = readHtml('frontend/public/index.html');
const V2 = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge-bounty-v2-ui.js'), 'utf8');
const api = build(INDEX, ['_emuRequestProblem'], { Date, String });
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test('「禁煙について」（6文字）のような短い題名でも通る', () => {
  assert.equal(api._emuRequestProblem('禁煙について', 'どのようにやめましたか？？経験者の方教えてください！', tomorrow), '');
  assert.equal(api._emuRequestProblem('禁煙', 'やめ方を教えて', tomorrow), '');
});

test('足りない欄を名指しで知らせる', () => {
  assert.match(api._emuRequestProblem('', 'どのようにやめましたか', tomorrow), /何について知識を探していますか/);
  assert.match(api._emuRequestProblem('禁煙について', '教えて', tomorrow), /困っている状況・知りたい条件/);
  assert.match(api._emuRequestProblem('禁煙について', 'どのようにやめましたか', ''), /回答期限を選んで/);
  assert.match(api._emuRequestProblem('禁煙について', 'どのようにやめましたか', '2020-01-01'), /今日以降/);
});

test('v2 の募集ボタンも同じ判定を使い、前の「8文字・10文字」の下限は残っていない', () => {
  assert.ok(V2.includes('window._emuRequestProblem(question, context, deadline)'));
  assert.ok(!/question\.length < 8|context\.length < 10/.test(V2));
  assert.ok(!/question\.length < 8 \|\| context\.length < 10/.test(INDEX));
  assert.ok(INDEX.includes('const problem = _emuRequestProblem(question, context, deadline);'));
});
