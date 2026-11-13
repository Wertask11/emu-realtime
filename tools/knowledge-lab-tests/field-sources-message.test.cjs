'use strict';
/* AI分析で「選んだ各分野の知識を、少なくとも1件ずつ選んでください。（AI_FIELD_SOURCES_MISSING）」とだけ出て、
   どの分野が足りないのか分からなかった（11/13 オーナーから）。足りない分野の名前と、直し方を添える。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge-lab/lab.js'), 'utf8');
const start = src.indexOf('if (code === "AI_FIELD_SOURCES_MISSING") {');
const end = src.indexOf('feedback.classList.add("error");', start);
const block = src.slice(start, end);
const terms = [{ id: 'life', label: '暮らし・人生' }, { id: 'work', label: '仕事・キャリア' }, { id: 'edu', label: '教育' }, { id: 'health', label: '健康' }];
function run(fields, posts) {
  const state = { selected: new Map(posts.map(p => [p.id, p])) };
  const names = ids => ids.map(id => terms.find(t => t.id === id)?.label || id).join('・');
  return new Function('code', 'message', 'state', 'selectedFields', 'names', block + '\nreturn message;')(
    'AI_FIELD_SOURCES_MISSING', 'もとの文。', state, () => fields, names);
}
const posts = [
  { id: 'a', title: 'デスクワークの寒さ対策', facets: { field: ['life', 'work'] } },
  { id: 'b', title: '雨の日のリラックス術', facets: { field: ['life'] } },
  { id: 'c', title: '整える', knowledgeLab: { facets: { field: ['edu', 'life'] } } },
];

test('足りない分野の名前と、直し方を出す', () => {
  assert.ok(start > 0 && end > start);
  const m = run(['life', 'health'], posts);
  assert.match(m, /^もとの文。 足りない分野：「健康」。/);
  assert.match(m, /この分野の知識を1件足すか、「1\. 分野を2〜3つ選ぶ」でこの分野のチェックを外してください。/);
  assert.match(run(['work', 'health', 'edu'], posts.slice(0, 2)), /足りない分野：「健康」、「教育」。/);
});
test('分野の分からない知識が混ざっているときは、推測せず元の文だけ', () => {
  assert.equal(run(['life', 'health'], [...posts, { id: 'd', title: '分類の無い知識' }]), 'もとの文。');
});
test('全部そろっているように見えるときは、元の文だけ（サーバーの判断を上書きしない）', () => {
  assert.equal(run(['life', 'work'], posts), 'もとの文。');
});
