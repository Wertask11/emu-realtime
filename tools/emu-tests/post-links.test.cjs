/* 11/27 オーナー：「Xみたいに投稿の引用出来るようにしたい。知識を読むで投稿されたやつを引用して、新しく投稿する」。
   11/28 オーナー：「コメントはいらない。改善案とか届いた声でコメント送れたり確認できたりできるから」→ 返信・スレッドは外した。
   投稿に残すのは引用元の ID だけ（quotePostId）。決まり（firestore.rules）は変えない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const KNOW = readHtml('frontend/public/knowledge.html');
const LINKS = fs.readFileSync(path.join(__dirname, '../../frontend/public/emu-post-links.js'), 'utf8');
const RULES = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

test('投稿の一覧（SDK・普通の通信のどちらでも）に、引用元の ID が入る。形の悪い値は捨てる', () => {
  assert.match(INDEX, /'quotePostId'\];/, '普通の通信で読む欄にも入れる');
  const src = INDEX.slice(INDEX.indexOf('  function plainKnowledgePost('), INDEX.indexOf('  /* 引用の読み口'));
  const ctx = { emuNameForAddress: () => '', knowledgeFacetIds: () => ({}) };
  vm.runInNewContext(src + ';this.plain=plainKnowledgePost;this.id=emuPostLinkId;', ctx);
  assert.equal(ctx.plain({ id: 'p2', data: () => ({ title: 't', quotePostId: 'abc_1' }) }).quotePostId, 'abc_1');
  assert.equal(ctx.plain({ id: 'p3', data: () => ({ title: 't', quotePostId: 'x<script>' }) }).quotePostId, '', 'IDの形でないものは捨てる');
});

test('公開するとき：引用元が本当にある投稿かを確かめて付ける。新規のときだけ。返信・スレッドは無い', () => {
  const pub = INDEX.slice(INDEX.indexOf("if (message.type === 'emu-knowledge-publish')"), INDEX.indexOf("if (message.type === 'emu-knowledge-draft')"));
  assert.ok(pub.includes('postForm._knowledgeLink = emuPostLinkId(payload.quotePostId)'));
  const sub = INDEX.slice(INDEX.indexOf('postForm.addEventListener("submit"'), INDEX.indexOf('showSakuraModal();', INDEX.indexOf('postForm.addEventListener("submit"')));
  assert.ok(sub.indexOf('const knowledgeLink = postForm._knowledgeLink || null;') > 0 && sub.includes('postForm._knowledgeLink = null;'), '持ち越さない');
  const create = sub.slice(sub.indexOf('// 【新規モード】'));
  assert.ok(create.includes('await window.EmuPostLinks.get(knowledgeLink.quotePostId)'));
  assert.ok(create.includes('postData.quotePostId = target.rows[0].id;'));
  assert.ok(!/replyToPostId|threadRootId/.test(INDEX) && !/data-link-reply|L\.thread|lk-thread/.test(LINKS), '返信・スレッドは無い（コメントは改善案・届いた声で）');
  assert.ok(!sub.slice(0, sub.indexOf('// 【新規モード】')).includes('quotePostId'), '編集では付け替えない');
  /* 決まり：作るときは欄を足せる。あとから変える欄（changedOnly）には入っていない */
  const posts = RULES.slice(RULES.indexOf('match /posts/{postId}'), RULES.indexOf('match /posts/{postId}') + 4000);
  assert.ok(!/quotePostId/.test(posts), '決まりは変えない（あとから変えられない）');
});

test('知識を読む：引用のボタンで、送る中身に引用元の ID が付く。閉じたら外れる。ログインしていなければ付けない', () => {
  assert.ok(KNOW.includes('<script src="/emu-post-links.js" defer></script>'));
  const els = {};
  const field = { hidden: false };
  const el = (id) => els[id] || (els[id] = { id, value: '', required: true, placeholder: '題名', dataset: {}, classList: { contains: () => false }, focus() {}, closest: () => field });
  const ctx = {
    state: { posts: [{ id: 'p1', title: '元の知識', body: '本文', address: '0xa' }], account: '0xme', authors: {} },
    author: (p) => ({ name: p.id === 'p1' ? 'たろう' : '?' }),
    notify: () => {},
    payload: () => ({ title: '', body: '返信の本文' }),
    resetComposer: () => {},
    openComposer: () => {},
    setTimeout: () => {}, clearTimeout: () => {},
    document: {
      readyState: 'complete', head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, style: {} }),
      getElementById: (id) => id === 'composeForm' ? { querySelector: () => null, insertBefore() {}, firstChild: null } : el(id),
      querySelectorAll: () => [], addEventListener: (t, fn) => { ctx.onClick = fn; }
    },
    MutationObserver: function () { this.observe = () => {}; }
  };
  ctx.window = ctx;
  ctx.window.parent = { EmuPostLinks: { get: async () => null, thread: async () => ({ rows: [] }) } };
  vm.runInNewContext(LINKS, ctx);
  const click = (attr, id) => ctx.onClick({ preventDefault() {}, target: { closest: (sel) => sel === '[' + attr + ']' ? { getAttribute: () => id } : null } });
  click('data-link-quote', 'p1');
  /* 11/28 オーナー：「引用の時はタイトルいらない」。題名の欄は隠し、本文の1行目を題名として残す（カードでは出さない） */
  assert.equal(field.hidden, true, '題名の欄は出さない');
  assert.equal(el('title').required, false);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.payload())), { title: '返信の本文', body: '返信の本文', quotePostId: 'p1' });
  assert.ok(LINKS.includes("if (p.quotePostId && p.title && p.title === autoTitle(p.body))"), 'カードでは自動の題名を隠す');
  ctx.resetComposer();
  assert.equal(ctx.payload().quotePostId, undefined, '書く画面を閉じたら外れる');
  assert.equal(field.hidden, false, '外したら題名の欄が戻る');
  assert.equal(el('title').required, true);
  ctx.state.account = '';
  click('data-link-quote', 'p1');
  assert.equal(ctx.payload().quotePostId, undefined, 'ログインしていなければ付けない');
});
