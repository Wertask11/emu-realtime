'use strict';
/* 投稿の削除と、投稿の記録（11/2 オーナーから）。

   覚えの無い投稿があったとき、投稿を消す手段が画面に無かった（Firestore のルールでは本人は消せたが、ボタンが無い）。
   - 本人：自分の投稿のカードと、マイライブラリーの「自分の投稿」に「削除」
   - 運営：ほかの人の投稿に「運営として削除」（理由を聞く）
   消すのはサーバー（/api/posts/:id/delete）。だれが・いつ・どの端末から消したかが、運営だけの記録に残る。
   投稿・書き直しのあとには、投稿ID だけをサーバーに送り、端末の情報を記録してもらう（/api/post-audit）。
   親（index.html）の役は、このテストの小さなページが受け持つ。本物の保存先は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const ROOT = path.join(__dirname, '../../frontend/public');
const ME = '0x' + 'a'.repeat(40), OTHER = '0x' + 'b'.repeat(40);
const POSTS = [
  { id: 'mine1', title: '自分の投稿', body: 'x', address: ME, goodCount: 0, changeCount: 0, createdAt: Date.now() },
  { id: 'other1', title: 'ほかの人の投稿', body: 'y', address: OTHER, goodCount: 1, changeCount: 0, createdAt: Date.now() }
];
const parent = isOwner => `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:420px;height:900px;border:0"></iframe>
<script>
window.sent = [];
const f = document.getElementById('k');
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data || {}, w = f.contentWindow, to = location.origin;
  window.sent.push(m);
  if (m.type === 'emu-knowledge-ready') w.postMessage({ type:'emu-knowledge-posts', posts:${JSON.stringify(POSTS)}, drafts:[], account:${JSON.stringify(ME)}, isOwner:${isOwner} }, to);
  if (m.type === 'emu-knowledge-panel') w.postMessage({ type:'emu-knowledge-panel-data', kind:m.kind, items:{ posts:[{ id:'mine1', title:'自分の投稿', goodCount:0, changeCount:0 }], drafts:[] } }, to);
});
</script>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/user') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(parent(false)); }
    if (url.pathname === '/test/owner') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(parent(true)); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(p) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + p);
  const frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
  await frame.locator('.card h3').first().waitFor();
  // 子から親への知らせは非同期で届く。期待する数がそろうまで待ってから読む
  const sent = async (type, atLeast = 1) => {
    await page.waitForFunction(([t, n]) => window.sent.filter(m => m.type === t).length >= n, [type, atLeast]);
    return page.evaluate(t => window.sent.filter(m => m.type === t), type);
  };
  return { page, frame, errors, sent, close: () => context.close() };
}

test('本人：自分の投稿に「削除」。ほかの人の投稿には出さない。マイライブラリーの自分の投稿にも「削除」', async () => {
  const k = await open('/test/user');
  try {
    assert.equal(await k.frame.locator('[data-delete-post="mine1"]').innerText(), '削除');
    assert.equal(await k.frame.locator('[data-delete-post="other1"]').count(), 0);
    await k.frame.locator('[data-delete-post="mine1"]').click();
    assert.deepEqual((await k.sent('emu-knowledge-delete-post')).map(m => [m.postId, m.asOwner]), [['mine1', false]]);
    await k.page.evaluate(() => document.getElementById('k').contentWindow.postMessage({ type: 'emu-knowledge-open-library' }, location.origin));
    await k.frame.locator('[data-delete-mypost="mine1"]').click();
    const last = (await k.sent('emu-knowledge-delete-post', 2)).at(-1);
    assert.equal(last.postId, 'mine1'); assert.equal(last.fromLibrary, true);
    // 親からの知らせを出す
    await k.page.evaluate(() => document.getElementById('k').contentWindow.postMessage({ type: 'emu-knowledge-notice', text: '投稿を削除しました。' }, location.origin));
    await k.frame.getByText('投稿を削除しました。').waitFor();
    assert.deepEqual(k.errors, []);
  } finally { await k.close(); }
});

test('運営：ほかの人の投稿に「運営として削除」', async () => {
  const k = await open('/test/owner');
  try {
    assert.equal(await k.frame.locator('[data-delete-post="other1"]').innerText(), '運営として削除');
    await k.frame.locator('[data-delete-post="other1"]').click();
    assert.deepEqual((await k.sent('emu-knowledge-delete-post')).map(m => [m.postId, m.asOwner]), [['other1', true]]);
  } finally { await k.close(); }
});

test('index.html：削除はサーバーに頼み、索引と一覧を読み直す。投稿・書き直しのあとに記録を送る', () => {
  const INDEX = readHtml('frontend/public/index.html');
  const h = INDEX.slice(INDEX.indexOf("if (message.type === 'emu-knowledge-delete-post' && message.postId)"));
  const handler = h.slice(0, h.indexOf("\n    }\n") + 6);
  assert.ok(handler.includes("'https://emu-realtime.onrender.com/api/posts/' + encodeURIComponent(postId) + '/delete'"));
  assert.ok(handler.includes('window.confirm('), '本人は確かめてから');
  assert.ok(handler.includes('window.prompt('), '運営は理由を聞く');
  assert.ok(handler.includes('window.emuLabSyncIndex?.(postId)'));
  assert.ok(handler.includes('await syncKnowledgeFrame({ append:false })'));
  assert.ok(INDEX.includes('isOwner: typeof _spIsOwnerAddr === \'function\' && !!account && _spIsOwnerAddr(account)'));
  assert.ok(INDEX.includes('emuRecordPostAudit(_labPostRef.id, "create");'));
  assert.ok(INDEX.includes('emuRecordPostAudit(editingId, "edit");'));
  const rec = INDEX.slice(INDEX.indexOf('function emuRecordPostAudit('), INDEX.indexOf('function _emuAddress() {'));
  assert.ok(rec.includes('"https://emu-realtime.onrender.com/api/post-audit"'));
  assert.ok(rec.includes('JSON.stringify({ postId: String(postId), kind:'), '送るのは投稿ID と種類だけ（本文は送らない）');
});
