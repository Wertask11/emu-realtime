/* 11/28 オーナー：冷蔵庫くんに「私に合う知識や投稿を探して」と頼んだら、知識を読むの投稿からも合いそうなものを出す。
   投稿はAIへ送らない（この端末で並べるだけ）。自分の投稿・もう役に立ったを押した投稿は出さない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/public/reizo/post-match.js'), 'utf8');
const CHAT = fs.readFileSync(path.join(__dirname, '../../frontend/public/reizo/request-chat.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const load = () => { const ctx = { window: {} }; vm.runInNewContext(SRC, ctx); return ctx.window.EmuPostMatch; };

const ME = '0xme';
const POSTS = [
  { id: 'mine', title: '自分の投稿', tags: '心構え', address: ME, goodUsers: [] },
  { id: 'liked', title: '前に役に立った', tags: 'お金', address: '0xa', goodUsers: [ME], goodCount: 3 },
  { id: 'money', title: '騙されないお金の守り方', tags: 'お金 詐欺', body: '投資の話には…', address: '0xb', goodUsers: [], goodCount: 2 },
  { id: 'mind', title: '余裕がない時こそ届ける', tags: '心構え 感謝', body: '届けることは大事', address: '0xc', goodUsers: [] },
  { id: 'cook', title: 'カレーの作り方', tags: '料理', body: '玉ねぎを炒める', address: '0xd', goodUsers: [] }
];

test('決まり文句（私に合う・知識・投稿・探して・Emu for SchoolPark）は手がかりにしない', () => {
  const m = load();
  assert.deepEqual([...m.cues('私に合う知識やその投稿を、Emu for SchoolPark内で探して')], []);
  assert.ok(m.cues('お金の守り方を探して').includes('お金'));
});

test('「私に合う」だけのときは、あなたの興味（書いた投稿・役に立ったを押した投稿のテーマ）で選ぶ。自分の投稿・押し済みは出さない', () => {
  const m = load();
  const got = m.rank(POSTS, '私に合う知識やその投稿を、Emu for SchoolPark内で探して', [ME], ['心構え'], 3);
  const ids = got.map((g) => g.post.id);
  assert.ok(ids.includes('money') && ids.includes('mind'), JSON.stringify(ids));
  assert.ok(!ids.includes('mine') && !ids.includes('liked') && !ids.includes('cook'));
  assert.match(got.find((g) => g.post.id === 'money').why, /役に立った.*#お金/);
  assert.match(got.find((g) => g.post.id === 'mind').why, /よく書く #心構え/);
});

test('言葉が入っているときは、その言葉が入った投稿を先に出す', () => {
  const m = load();
  const got = m.rank(POSTS, 'カレーの作り方を持ってきて', [ME], ['心構え'], 3);
  assert.equal(got[0].post.id, 'cook');
  assert.match(got[0].why, /頼んだ言葉/);
});

test('頼むの結果のあとに、知識を読むからの欄を出す。投稿はAIへ送らない（読むのは公開の投稿だけ）', () => {
  assert.ok(INDEX.includes('<script src="/reizo/post-match.js" defer></script><script src="/reizo/request-chat.js" defer></script>'));
  assert.ok(CHAT.includes("showResult(job);\n    if (!job.artifactId) showPosts(goal, userAt);"));
  assert.ok(CHAT.includes("投稿はAIには送っていないよ"));
  assert.ok(!/fetch\(|api\(/.test(SRC), 'post-match.js はサーバーやAIへ送らない（読むだけ）');
  assert.ok(SRC.includes("window._spRestGet(':runQuery', false, true,"), '公開の投稿をログインなしの読み方で読む');
});
