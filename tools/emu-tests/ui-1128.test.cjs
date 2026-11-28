/* 11/28 夜のオーナーの頼み（文字の並びで確かめる）。
   - ナレッジラボの詳細の操作を、知識を読むと同じ絵文字のボタンに（文字は読み上げ用に残す）
   - スマホの引用は題名だけ出し、タップで全文
   - 冷蔵庫くんに頼むの結果：カードごとに種類と要約。決まり文句は最後に1回。次にやることは同じカードの中に */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../../frontend/public', p), 'utf8');

test('ナレッジラボ：詳細の操作は絵文字のボタン。押すと今までと同じ動き（id は同じ）。文字は残す', () => {
  const lab = read('knowledge-lab/lab.js'), css = read('knowledge-lab/lab.css');
  for (const [id, emoji, label] of [['goodKnowledge', '🫶', '役に立った'], ['changeKnowledge', '🤝', '改善案を届ける'], ['proposeKnowledge', '✍️', '議題にする'],
    ['saveKnowledge', '📚', 'マイライブラリーに保存'], ['unsaveKnowledge', '📤', '保存を外す'], ['useKnowledge', '🔬', '研究に使う'], ['openWriter', '👤', '書き手を見る']]) {
    assert.ok(lab.includes(`<button type="button" id="${id}" data-emoji="${emoji}" title="${label}">${label}</button>`), id);
  }
  assert.ok(lab.includes('<div class="actions lab-icon-acts">'));
  assert.ok(css.includes('.lab-icon-acts>button::before{content:attr(data-emoji)') && css.includes('font-size:0!important'));
});

test('スマホの引用：題名だけ出し「タップで全文」。押すと全文', () => {
  const links = read('emu-post-links.js');
  assert.ok(links.includes('<span class="lk-quote-more" aria-hidden="true">タップで全文 ▾</span>'));
  assert.ok(links.includes('@media(max-width:760px){.lk-quote[aria-expanded="false"] .lk-quote-body{display:none}'));
});

test('頼むの結果：カードは種類と要約。決まり文句は最後に1回。次にやることは同じカードの中（同じ資料を2回出さない）', () => {
  const chat = read('reizo/request-chat.js');
  assert.ok(chat.includes("var sum = short(r.evidence, 90);") && chat.includes("n.textContent = '次にやること：' + next;"));
  assert.ok(!chat.includes("p.textContent = r.reason || '';"), '同じ決まり文句をカードごとに出さない');
  assert.ok(!chat.includes("h.textContent = '次にやること'"), '次にやることのカードを別に並べ直さない');
});
