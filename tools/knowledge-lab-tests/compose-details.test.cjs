'use strict';
/* 投稿の入口をひとつに・詳しく整理する（任意）（11/7）。
   知識を読むの投稿画面で公開した投稿に、親の画面（index.html の emuAttachLabDetails）が、
   同じ投稿ID のまま Knowledge Lab の分類を付ける。index.html の実際の関数を取り出し、隔離エミュレーターの Lab API に送る。
   見ること：投稿IDが変わらない・画像や作成日が残る・投稿の回数を使わない・やり直しても二重にならない・
   AI の利用は本人がチェックしたときだけ・何も書いていなければ送らない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFixture } = require('./fixture.cjs');
const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const KNOWLEDGE = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge.html'), 'utf8');
const LAB = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge-lab/lab.js'), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
let f;
before(async () => { f = await createFixture(); });
after(async () => { await f?.close(); });

function helpers(role, notices) {
  const ctx = {
    fetch: (url, opts) => fetch(f.base + url, opts),
    emuAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + f.users[role].token }),
    document: { getElementById: () => ({ contentWindow: { postMessage: (m) => notices.push(m) } }) },
    window: { location: { origin: 'http://127.0.0.1' } },
    JSON, String, Array, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(between(INDEX, '  function _emuLabDetails(raw) {', '  window._emuLabDetails = _emuLabDetails;') +
    between(INDEX, 'async function emuAttachLabDetails(postId, post, lab) {', 'window.emuAttachLabDetails = emuAttachLabDetails;') +
    '\nthis.api={_emuLabDetails,emuAttachLabDetails};', ctx);
  return ctx.api;
}
/* 知識を読むで公開した投稿（index.html の新規投稿と同じ形） */
async function normalPost(role, id) {
  const address = f.users[role].account.walletAddress;
  const data = { title: '朝の10分で続けた学び', body: '毎朝10分だけ机に向かうと決めて、3か月続きました。', tags: '経験,習慣', userType: 'paid', address, displayName: 'Emuer', userId: address, updatedAt: new Date(), createdAt: new Date(Date.UTC(2026, 10, 1)), goodCount: 2, changeCount: 1, imageUrl: 'data:image/jpeg;base64,AAAA' };
  await f.db.collection('posts').doc(id).set(data);
  return data;
}
/* その人の投稿の回数（月ごとの記録の合計）。記録の文書が初めて作られても、回数が増えていなければ使っていない */
const usage = async (role) => (await f.db.collection('plan_usage').where('__name__', '>=', f.users[role].spid).where('__name__', '<', f.users[role].spid + '\uf8ff').get()).docs.reduce((n, d) => n + Number(d.data().post || 0), 0);

test('何も書いていなければ付けない。AI の同意は true のときだけ。形の悪い分類は捨てる', () => {
  const { _emuLabDetails } = helpers('alice', []);
  assert.equal(_emuLabDetails(null), null);
  assert.equal(_emuLabDetails({ facets: {}, verification: 'self-reported', aiUseConsent: false }), null);
  assert.equal(_emuLabDetails({ aiUseConsent: 'true' }), null, '文字の true で同意にしない');
  const v = _emuLabDetails({ facets: { field: ['field-education', 'bad id!'], 'Bad Axis': ['x'] }, period: ' 2025年春 ', aiUseConsent: 1 });
  assert.deepEqual({ ...v.facets }, { field: ['field-education'] });
  assert.equal(v.period, '2025年春');
  assert.equal(v.aiUseConsent, false);
  assert.equal(v.verification, 'self-reported');
  assert.equal(_emuLabDetails({ happened: 'x'.repeat(3000) }).happened.length, 2000);
});

test('公開した投稿に、同じ投稿IDのまま分類を付ける。画像・作成日・Good は残り、投稿の回数は使わない。やり直しても二重にならない', async () => {
  const notices = [];
  const { _emuLabDetails, emuAttachLabDetails } = helpers('alice', notices);
  const id = 'compose' + Date.now();
  const post = await normalPost('alice', id);
  const before = await usage('alice');
  const lab = _emuLabDetails({ facets: { field: ['field-education'] }, period: '2025年春', learned: '小さく始めると続く', aiUseConsent: false });
  assert.equal(await emuAttachLabDetails(id, post, lab), true);
  const saved = (await f.db.collection('posts').doc(id).get()).data();
  assert.equal(saved.title, post.title);
  assert.equal(saved.imageUrl, post.imageUrl, '画像が消えた');
  assert.equal(saved.createdAt.toDate().getTime(), post.createdAt.getTime(), '作成日が変わった');
  assert.equal(saved.goodCount, 2);
  assert.equal(saved.changeCount, 1);
  assert.deepEqual(saved.knowledgeLab.facets.field, ['field-education']);
  assert.equal(saved.knowledgeLab.learned, '小さく始めると続く');
  assert.equal(saved.knowledgeLab.aiUseConsent.allowed, false);
  assert.equal(saved.knowledgeLab.revision, 1);
  assert.equal(saved.authorSchoolParkId, f.users.alice.spid);
  // 同じ投稿は1件だけ（新しい投稿を作っていない）
  assert.equal((await f.db.collection('posts').where('title', '==', post.title).get()).size, 1);
  assert.equal(await usage('alice'), before, '投稿の回数を使った');
  // AI に同意していないので、意味検索の順番待ちに入らない
  assert.equal((await f.db.collection('knowledge_lab_semantic_queue').doc(id).get()).exists, false);
  // 通信が切れてもう一度送っても、同じ結果で、版は増えない
  assert.equal(await emuAttachLabDetails(id, post, lab), true);
  assert.equal((await f.db.collection('posts').doc(id).get()).data().knowledgeLab.revision, 1);
  assert.deepEqual(notices, []);
});

test('AI に同意したときだけ、意味検索の順番待ちに入る（AI はここでは動かさない）', async () => {
  const { _emuLabDetails, emuAttachLabDetails } = helpers('alice', []);
  const id = 'composeai' + Date.now();
  const post = await normalPost('alice', id);
  assert.equal(await emuAttachLabDetails(id, post, _emuLabDetails({ facets: { field: ['field-education'] }, aiUseConsent: true })), true);
  const saved = (await f.db.collection('posts').doc(id).get()).data();
  assert.equal(saved.knowledgeLab.aiUseConsent.allowed, true);
  assert.equal((await f.db.collection('knowledge_lab_semantic_queue').doc(id).get()).exists, true);
});

test('他人の投稿には付けられない。付けられなかったときは、投稿は公開のまま、あとで整理できると知らせる', async () => {
  const notices = [];
  const { _emuLabDetails, emuAttachLabDetails } = helpers('bob', notices);
  const id = 'composeother' + Date.now();
  const post = await normalPost('alice', id);
  assert.equal(await emuAttachLabDetails(id, post, _emuLabDetails({ period: '2025年' })), false);
  const saved = (await f.db.collection('posts').doc(id).get()).data();
  assert.equal(saved.knowledgeLab, undefined);
  assert.equal(saved.title, post.title);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /投稿は公開しました/);
});

test('画面：入口はひとつ（Lab の「経験知を届ける」は Emu の中では共通の投稿画面を開く）。AI 同意は初期オフ。予約投稿には付かないと確かめる', () => {
  assert.doesNotMatch(KNOWLEDGE, /data-command="experience"/, '投稿画面から Lab の別の入力画面へ飛ばさない');
  assert.match(KNOWLEDGE, /<summary>詳しく整理する（任意）<\/summary>/);
  assert.match(KNOWLEDGE, /<input id="labAIConsent" type="checkbox">/, 'AI 同意が初めからチェックされている');
  assert.doesNotMatch(KNOWLEDGE, /id="labAIConsent"[^>]*checked/);
  assert.match(KNOWLEDGE, /kind==='schedule'&&labPayload\(\)&&!confirm\(/);
  assert.match(LAB, /typeof window\.parent\.emuOpenKnowledgeComposer === "function"/);
  assert.match(LAB, /action: "compose"/);
  assert.match(INDEX, /if \(knowledgeLabDetails\) emuAttachLabDetails\(_labPostRef\.id, postData, knowledgeLabDetails\);/);
});

test('画面：Lab から「経験知を届ける」を押すと、親が共通の投稿画面を開く。Lab に保存していない入力があれば開かない。ほかの窓からは動かない', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge-lab/integration.js'), 'utf8');
  const handlers = [], labWindow = {};
  let opened = 0, leave = true;
  const frame = { contentWindow: labWindow, getAttribute: () => '/knowledge-lab.html?view=library' };
  const window = {
    addEventListener: (type, fn) => { if (type === 'message') handlers.push(fn); },
    dispatchEvent() {}, closeSpRoom: () => (leave ? undefined : false), emuOpenKnowledgeComposer: () => { opened++; },
    auth: { currentUser: null },
  };
  const ctx = {
    window, location: new URL('https://emu.example/'), URLSearchParams, URL, CustomEvent: class {},
    document: { getElementById: (id) => (id === 'spRoomFrame' ? frame : null), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, readyState: 'complete', documentElement: { classList: { contains: () => false } } },
    console, setTimeout, clearTimeout, fetch: async () => ({ ok: false, json: async () => ({}) }), history: { replaceState() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const send = (source, origin) => Promise.all(handlers.map((h) => h({ source, origin, data: { type: 'emu-lab-action', action: 'compose' } })));
  await send({}, 'https://emu.example');
  await send(labWindow, 'https://evil.example');
  assert.equal(opened, 0);
  leave = false;
  await send(labWindow, 'https://emu.example');
  assert.equal(opened, 0, '保存していない Lab の入力を置いて開いた');
  leave = true;
  await send(labWindow, 'https://emu.example');
  assert.equal(opened, 1);
});
