/* やってみた記録（1枚）を出してよいクエスト（11/20）。

   #001 LEARN（試す）と #002 WORK（提出もの）は、やったあとに一度で書ける。
   #003 PLAY・#004 CONNECT・#005・特殊 #001/#002 は「開始宣言 → 中間 → 最終」と日を分けて出す決まりなので、
   1枚の記録は出さない（始める前に「分かったこと」と知恵カードまで書かせてしまう）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');
const KNOWLEDGE = readHtml('frontend/public/knowledge.html');
const SEEDS = path.join(__dirname, '..', 'quest-seeds');
const seeds = (f) => JSON.parse(fs.readFileSync(path.join(SEEDS, f), 'utf8'));
const { spQuestReportGuide } = build(INDEX, ['spQuestReportGuide'], { SP_LOG_KINDS: ['やってみた', 'つまずいた', '気づいた'] });
const oneSheet = (q) => spQuestReportGuide(q).kind !== 'listed';

test('#001 LEARN と #002 WORK の15本は、1枚で出せる', () => {
  assert.equal(oneSheet({ series: 'general', questNumber: 1, title: 'Emuの知識を、やってみる' }), true);
  for (const q of seeds('general-002-work.json')) assert.equal(oneSheet(q), true, q.title);
});

test('日を分けて報告するクエスト（#003〜#005・特殊）は、1枚では出させない', () => {
  const timed = [...seeds('general-003-play.json'), ...seeds('remaining-4.json')];
  assert.ok(timed.length >= 5);
  for (const q of timed) assert.equal(oneSheet(q), false, q.title);
});

test('画面：判定はクエストの一覧で作り、詳細の入口と1枚の札の両方で守る', () => {
  assert.ok(INDEX.indexOf("oneSheet: spQuestReportGuide(q).kind !== 'listed',") > 0);
  assert.ok(DAO.indexOf("canTry: !e.isFounder && e.status !== 'CLOSED' && e.oneSheet !== false,") > 0);
  const open = INDEX.slice(INDEX.indexOf('window.openSpTryForm = async function'), INDEX.indexOf('function closeSpTryForm'));
  assert.ok(/if \(spQuestReportGuide\(q\)\.kind === 'listed'\) \{[\s\S]{0,200}return;/.test(open), '直接開かれても1枚にしない');
});

test('知識の投稿の「これを試す」は、#001 を探して、その投稿を選んだ状態で開く', () => {
  assert.ok(KNOWLEDGE.indexOf('class="try-btn" data-react="try"') > 0);
  assert.ok(KNOWLEDGE.indexOf("['history','voices','propose','try']") > 0, '押してもボタンを「送信中」にしない');
  const from = INDEX.slice(INDEX.indexOf('window.spTryFromPost = async function'), INDEX.indexOf('async function spTrySubmit'));
  assert.ok(from.indexOf("x.series === 'general' && Number(x.questNumber) === 1") > 0);
  assert.ok(from.indexOf('openSpTryForm(q.id, app, { id: postId, title: postTitle })') > 0);
});

test('1枚の記録：受ける → 3つの報告 → 知恵カード の順。空の「つまずいた」は「（特になし）」', () => {
  const submit = INDEX.slice(INDEX.indexOf('async function spTrySubmit'), INDEX.indexOf('window.spTrySubmit = spTrySubmit;'));
  const at = (s) => { const i = submit.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at("fb.setDoc(ref, { name: p.name, tookAt: Date.now() })") < at("await _spLogSave(questId, data)"));
  assert.ok(at("await _spLogSave(questId, data)") < at("/quest-completions/'"));
  assert.ok(submit.indexOf("{ kind: 'つまずいた', body: stuck || '（特になし）' }") > 0);
  /* 前の周が確認待ち・パスポートが無いときは、何も書く前に止める */
  assert.ok(at('if (!p.spid)') < at("await _spLogSave(questId, data)"));
  assert.ok(at('if (placed > approved)') < at("await _spLogSave(questId, data)"));
});
