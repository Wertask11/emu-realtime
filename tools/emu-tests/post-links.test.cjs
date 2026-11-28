/* 11/27 オーナー：「Xみたいに投稿の引用出来るようにしたい。知識を読むで投稿されたやつを引用して、新しく投稿する。スレッド機能とか」。
   投稿に残すのは ID だけ（quotePostId・replyToPostId・threadRootId）。決まり（firestore.rules）は変えない。 */
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

test('投稿の一覧（SDK・普通の通信のどちらでも）に、引用・返信・スレッドの ID が入る。形の悪い値は捨てる', () => {
  assert.match(INDEX, /'quotePostId', 'replyToPostId', 'threadRootId'\];/, '普通の通信で読む欄にも入れる');
  const src = INDEX.slice(INDEX.indexOf('  function plainKnowledgePost('), INDEX.indexOf('  /* 引用・スレッドの読み口'));
  const ctx = { emuNameForAddress: () => '', knowledgeFacetIds: () => ({}) };
  vm.runInNewContext(src + ';this.plain=plainKnowledgePost;this.id=emuPostLinkId;', ctx);
  const row = ctx.plain({ id: 'p2', data: () => ({ title: 't', quotePostId: 'abc_1', replyToPostId: 'x<script>', threadRootId: 'root-9' }) });
  assert.equal(row.quotePostId, 'abc_1');
  assert.equal(row.replyToPostId, '', 'IDの形でないものは捨てる');
  assert.equal(row.threadRootId, 'root-9');
});

test('公開するとき：引用・返信先が本当にある投稿かを確かめて付ける。返信はスレッドの最初の投稿も付ける。新規のときだけ', () => {
  const pub = INDEX.slice(INDEX.indexOf("if (message.type === 'emu-knowledge-publish')"), INDEX.indexOf("if (message.type === 'emu-knowledge-draft')"));
  assert.ok(pub.includes('postForm._knowledgeLink = (payload.quotePostId || payload.replyToPostId)'));
  const sub = INDEX.slice(INDEX.indexOf('postForm.addEventListener("submit"'), INDEX.indexOf('showSakuraModal();', INDEX.indexOf('postForm.addEventListener("submit"')));
  assert.ok(sub.indexOf('const knowledgeLink = postForm._knowledgeLink || null;') > 0 && sub.includes('postForm._knowledgeLink = null;'), '持ち越さない');
  const create = sub.slice(sub.indexOf('// 【新規モード】'));
  assert.ok(create.includes('await window.EmuPostLinks.get(knowledgeLink.replyToPostId || knowledgeLink.quotePostId)'));
  assert.ok(create.includes('postData.threadRootId = t.threadRootId || t.id;'), '返信への返信も同じスレッドに並ぶ');
  assert.ok(!sub.slice(0, sub.indexOf('// 【新規モード】')).includes('quotePostId'), '編集では付け替えない');
  /* 決まり：作るときは欄を足せる。あとから変える欄（changedOnly）には入っていない */
  const posts = RULES.slice(RULES.indexOf('match /posts/{postId}'), RULES.indexOf('match /posts/{postId}') + 4000);
  assert.ok(!/quotePostId|replyToPostId|threadRootId/.test(posts), '決まりは変えない（あとから変えられない）');
});

test('知識を読む：引用・返信のボタン、引用元の札、返信先、スレッド。送る中身に ID が付き、返信は題名なしなら「Re: 元の題名」', () => {
  assert.ok(KNOW.includes('<script src="/emu-post-links.js" defer></script>'));
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, value: '', required: true, placeholder: '題名', dataset: {}, classList: { contains: () => false }, focus() {} });
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
  click('data-link-reply', 'p1');
  assert.equal(el('title').required, false, '返信は題名なしで出せる');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.payload())), { title: 'Re: 元の知識', body: '返信の本文', replyToPostId: 'p1' });
  click('data-link-quote', 'p1');
  assert.equal(ctx.payload().quotePostId, 'p1');
  assert.equal(el('title').required, true, '引用は題名が要る');
  ctx.resetComposer();
  assert.equal(ctx.payload().quotePostId, undefined, '書く画面を閉じたら外れる');
  ctx.state.account = '';
  click('data-link-quote', 'p1');
  assert.equal(ctx.payload().quotePostId, undefined, 'ログインしていなければ付けない');
});
