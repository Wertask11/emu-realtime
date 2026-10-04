/* 今月のテーマ。

   前は同じ言葉をコードの5か所に書いていて、毎月そのすべてを直していた。
   10月に入っても9月の「整える／夏のあとの、戻し方」が出たままだったのは、
   直すところが多すぎて漏れたから。10/4 に記録（sp_docs/monthly-theme）へ
   移した。

   ここが緩むと、また画面ごとに違うテーマが出る。確かめること:
     ・控えの言葉が、どのファイルでもそろっている
     ・記録から読んで、画面へ渡している
     ・読めなかったときに、テーマが消えない
     ・テーマ名は、タグとして使える形でしか保存できない */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const INDEX = read('frontend/public/index.html');
const KNOW = read('frontend/public/knowledge.html');
const PAGES = read('frontend/public/emu-i18n-pages.js');
const ADMIN = read('frontend/public/membership-admin.html');

const THEME = 'はじめる';

/* ───────── 控えの言葉がそろっているか ───────── */

test('先月のテーマが、どこにも残っていない', () => {
  [['index.html', INDEX], ['knowledge.html', KNOW], ['emu-i18n-pages.js', PAGES]]
    .forEach(([name, src]) => {
      assert.equal(src.indexOf('夏のあとの、戻し方'), -1, name + ' に先月の説明文が残っています');
    });
  assert.equal(KNOW.indexOf('整える'), -1, 'knowledge.html に先月のテーマ名が残っています');
  assert.equal(PAGES.indexOf('整える'), -1, 'emu-i18n-pages.js に先月のテーマ名が残っています');
});

test('控えのテーマ名が、どのファイルでも同じ', () => {
  assert.ok(INDEX.indexOf('let currentTheme = "' + THEME + '"') > 0, 'index.html の控えが違います');
  assert.ok(KNOW.indexOf("monthlyTheme:'" + THEME + "'") > 0, 'knowledge.html の state の控えが違います');
  assert.ok(KNOW.indexOf("m.monthlyTheme||'" + THEME + "'") > 0, 'knowledge.html の受け取りの控えが違います');
  assert.ok(KNOW.indexOf('id="monthlyTheme">' + THEME + '</div>') > 0, 'knowledge.html の表示の控えが違います');
  assert.ok(INDEX.indexOf("currentTheme : '" + THEME + "'") > 0, '渡すときの控えが違います');
});

/* ───────── 記録から読む ───────── */

function stageTheme(opts) {
  const o = opts || {};
  const SEG = INDEX.slice(INDEX.indexOf('let currentTheme = "'),
                          INDEX.indexOf('// トレンド用'));
  const seen = { read: [] };
  const ctx = vm.createContext({
    String, Number, Promise, console: { warn() { } },
    _spRestDoc: async (p, auth) => {
      seen.read.push({ path: p, auth: auth });
      if (o.throws) throw new Error(o.throws);
      return o.doc === undefined ? { title: 'つづける', summary: '止めなかったやり方。' } : o.doc;
    }
  });
  vm.runInContext(SEG + '\nglobalThis.__t = { get name() { return currentTheme; },'
    + ' get copy() { return currentThemeCopy; }, load: _spMonthlyTheme };', ctx);
  return { ctx, seen, t: ctx.__t };
}

test('記録があれば、そのテーマになる', async () => {
  const s = stageTheme();
  const got = await s.t.load();
  assert.equal(got.name, 'つづける');
  assert.equal(s.t.name, 'つづける');
  assert.equal(s.t.copy, '止めなかったやり方。');
});

test('読むのは sp_docs/monthly-theme。証は要らない', async () => {
  const s = stageTheme();
  await s.t.load();
  assert.equal(s.seen.read.length, 1);
  assert.equal(s.seen.read[0].path, 'sp_docs/monthly-theme');
  assert.equal(s.seen.read[0].auth, false, '誰でも読める記録に、証を付けています');
});

test('一度読んだら、覚えている', async () => {
  const s = stageTheme();
  await s.t.load();
  await s.t.load();
  await s.t.load();
  assert.equal(s.seen.read.length, 1, '開くたびに読みに行っています');
});

test('記録がまだ無ければ、控えのまま', async () => {
  const s = stageTheme({ doc: null });
  const got = await s.t.load();
  assert.equal(got.name, THEME);
  assert.ok(String(got.copy).indexOf('始め') >= 0, got.copy);
});

test('読めなくても、テーマは消えない', async () => {
  /* テーマが出ないより、控えが出ているほうがよい。 */
  const s = stageTheme({ throws: 'NETWORK_DOWN' });
  const got = await s.t.load();
  assert.equal(got.name, THEME);
  assert.equal(s.t.name, THEME);
});

test('中身が空の記録では、控えを上書きしない', async () => {
  const s = stageTheme({ doc: { title: '  ', summary: '' } });
  const got = await s.t.load();
  assert.equal(got.name, THEME, '空の題名で上書きしています');
});

/* ───────── 画面へ渡す ───────── */

test('テーマと説明文を、両方わたす', () => {
  const i = INDEX.indexOf("type:'emu-knowledge-posts'");
  assert.ok(i > 0, '渡すところが見つかりません');
  const seg = INDEX.slice(i, i + 1200);
  assert.ok(seg.indexOf('monthlyTheme:') > 0, 'テーマを渡していません');
  assert.ok(seg.indexOf('monthlyCopy:') > 0, '説明文を渡していません');
});

test('渡す前に、記録を読んでいる', () => {
  const i = INDEX.indexOf("type:'emu-knowledge-posts'");
  const before = INDEX.slice(0, i);
  const j = before.lastIndexOf('await _spMonthlyTheme();');
  assert.ok(j > 0 && i - j < 400, '渡す直前に読んでいません');
});

test('トレンドの見出しも、記録を読んでから出す', () => {
  const i = INDEX.indexOf('async function filterTrendPosts()');
  const seg = INDEX.slice(i, i + 500);
  assert.ok(seg.indexOf('await _spMonthlyTheme();') > 0, '読まずに見出しを出しています');
});

/* ───────── 知識の画面で出す ───────── */

test('説明文は、辞書に上書きされない形で入れる', () => {
  /* data-i18n が残っていると、言語をあてる処理に上書きされて
     控えの文（先月の文）に戻る。 */
  const i = KNOW.indexOf("$('#monthlyTheme').textContent=state.monthlyTheme;");
  assert.ok(i > 0, 'テーマ名を出すところが見つかりません');
  const seg = KNOW.slice(i, i + 400);
  assert.ok(seg.indexOf("removeAttribute('data-i18n')") > 0, '辞書の印を外していません');
  assert.ok(seg.indexOf('state.monthlyCopy') > 0, '説明文を入れていません');
});

test('説明文を入れる相手に、印が付いている', () => {
  assert.ok(KNOW.indexOf('id="monthlyCopy"') > 0, '説明文の目印がありません');
});

/* ───────── 管理画面から変える ───────── */

test('管理画面に、テーマの編集欄がある', () => {
  assert.ok(ADMIN.indexOf('function renderMonthlyTheme(f)') > 0, '編集欄がありません');
  assert.ok(ADMIN.indexOf("'<div id=\"mtBox\"></div>'") > 0, '置き場所がありません');
  assert.ok(ADMIN.indexOf('renderMonthlyTheme(f);') > 0, '呼んでいません');
});

test('保存するのは sp_docs/monthly-theme', () => {
  const i = ADMIN.indexOf('function renderMonthlyTheme(f)');
  const seg = ADMIN.slice(i, ADMIN.indexOf('async function ydWriteTo(f, body, docId)'));
  assert.ok(seg.indexOf("ydWriteTo(f, body, 'monthly-theme')") > 0, '保存先が違います');
  assert.ok(seg.indexOf('blocks: []') > 0, 'sp_docs の決まり（配列）を満たしていません');
  assert.ok(seg.indexOf('updatedAt: Date.now()') > 0, '更新した時刻を入れていません');
});

test('テーマ名が空・空白まじり・長すぎるときは、保存しない', () => {
  const i = ADMIN.indexOf('function renderMonthlyTheme(f)');
  const seg = ADMIN.slice(i, ADMIN.indexOf('async function ydWriteTo(f, body, docId)'));
  assert.ok(seg.indexOf('if (!title)') > 0, '空を止めていません');
  assert.ok(seg.indexOf('/\\s/.test(title)') > 0, '空白を止めていません（タグとして使えなくなります）');
  assert.ok(seg.indexOf('title.length > 120') > 0, '長さを見ていません');
  assert.ok(seg.indexOf('summary.length > 400') > 0, '説明文の長さを見ていません');
});

test('保存の前に、前のテーマの投稿が外れることを伝える', () => {
  const i = ADMIN.indexOf('function renderMonthlyTheme(f)');
  const seg = ADMIN.slice(i, ADMIN.indexOf('async function ydWriteTo(f, body, docId)'));
  assert.ok(seg.indexOf('confirm(') > 0, '確かめていません');
  assert.ok(seg.indexOf('一覧から外れます') > 0, '何が起きるか伝えていません');
  assert.ok(seg.indexOf('投稿そのものは消えません') > 0, '消えないことを伝えていません');
});

test('読めなかったときは、編集欄を出さない', () => {
  /* 空のまま保存すると、いま出ているテーマを消すことになる。 */
  const i = ADMIN.indexOf('function renderMonthlyTheme(f)');
  const seg = ADMIN.slice(i, i + 1200);
  assert.ok(seg.indexOf('編集欄は出していません') > 0, '空で上書きできてしまいます');
});

test('年内目標の保存先は、これまでどおり', () => {
  /* 置き場所を受け取れるようにしたが、既定は year-goals のまま。 */
  assert.ok(ADMIN.indexOf("encodeURIComponent(docId || 'year-goals')") > 0, '既定が変わっています');
  assert.ok(ADMIN.indexOf("f.doc(f.db, 'sp_docs', 'year-goals'), body") > 0,
    '年内目標の保存先が変わっています');
});
