'use strict';
/* 知識を読む：一覧が届くまで「該当する知識がありません」と出していた（11/12 オーナーから）。

   サーバー（Render）が眠りから起きるあいだ、親（index.html）は段・下書きの返事を待ってから
   一覧を送っていた。そのあいだ知識を読む（knowledge.html）は、最初の空の一覧を描いたまま
   「該当する知識がありません」と出していた。
   いまは、
     ・一覧が届くまでは「知識を読み込んでいます…」と出す（ほかの知らせで描き直しても同じ）
     ・読み込めなかったときは、理由と「もう一度読み込む」を出す（押すと親に読み直しを頼む）
     ・一覧が届いて本当に0件なら、今までどおり「該当する知識がありません」
     ・親は、段と下書きを3秒までしか待たない（一覧を先に出し、下書きは届いたら送る）

   親の役は、このテストの小さなページが受け持つ。本物の保存先は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PARENT = `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:420px;height:860px;border:0"></iframe>
<script>
window.sent = [];
const f = document.getElementById('k');
window.toFrame = m => f.contentWindow.postMessage(m, location.origin);
addEventListener('message', e => { if (e.source === f.contentWindow) window.sent.push(e.data || {}); });
</script>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/parent') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PARENT); }
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

async function open() {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/test/parent');
  await page.waitForFunction(() => window.sent.some(m => m.type === 'emu-knowledge-ready'));
  const frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
  const posts = () => frame.locator('#posts').innerText();
  const send = m => page.evaluate(x => window.toFrame(x), m);
  return { page, frame, errors, posts, send, close: () => context.close() };
}

test('一覧が届くまでは「読み込んでいます」。ほかの知らせで描き直しても「ありません」にならない', async () => {
  const k = await open();
  try {
    assert.match(await k.posts(), /知識を読み込んでいます/);
    assert.doesNotMatch(await k.posts(), /該当する知識がありません/);
    await k.send({ type: 'emu-knowledge-filter', mode: 'new' });
    await k.send({ type: 'emu-knowledge-loading', append: false });
    await k.send({ type: 'emu-knowledge-drafts', drafts: [] });
    await k.send({ type: 'emu-knowledge-authors', authors: {} });
    await k.page.waitForTimeout(150);
    assert.match(await k.posts(), /知識を読み込んでいます/);
    assert.doesNotMatch(await k.posts(), /該当する知識がありません/);
    assert.deepEqual(k.errors, []);
  } finally { await k.close(); }
});

test('一覧が届けば投稿を出す。本当に0件なら「該当する知識がありません」', async () => {
  const k = await open();
  try {
    await k.send({ type: 'emu-knowledge-posts', posts: [{ id: 'p1', title: '夜中の仕事に卵かけご飯', body: '本文', address: '0xabc', createdAt: '2026-11-10T00:00:00Z' }], account: '' });
    await k.frame.locator('#posts article.card').first().waitFor();
    assert.match(await k.posts(), /夜中の仕事に卵かけご飯/);
    await k.send({ type: 'emu-knowledge-posts', posts: [], account: '' });
    await k.page.waitForTimeout(150);
    assert.match(await k.posts(), /該当する知識がありません/);
    assert.deepEqual(k.errors, []);
  } finally { await k.close(); }
});

test('読み込めなかったときは理由と「もう一度読み込む」。押すと親に読み直しを頼む', async () => {
  const k = await open();
  try {
    await k.send({ type: 'emu-knowledge-error', error: '投稿を読み込めませんでした。' });
    const btn = k.frame.locator('#posts [data-reload]');
    await btn.waitFor();
    assert.equal(await btn.innerText(), 'もう一度読み込む');
    assert.match(await k.posts(), /投稿を読み込めませんでした/);
    assert.doesNotMatch(await k.posts(), /該当する知識がありません/);
    await btn.click();
    await k.page.waitForFunction(() => window.sent.some(m => m.type === 'emu-knowledge-refresh'));
    assert.match(await k.posts(), /知識を読み込んでいます/);
    assert.deepEqual(k.errors, []);
  } finally { await k.close(); }
});

test('一覧が出たあとに読み直しで失敗しても、出ている一覧は消さない', async () => {
  const k = await open();
  try {
    await k.send({ type: 'emu-knowledge-posts', posts: [{ id: 'p1', title: '残る知識', body: '本文', address: '0xabc', createdAt: '2026-11-10T00:00:00Z' }], account: '' });
    await k.frame.locator('#posts article.card').first().waitFor();
    await k.send({ type: 'emu-knowledge-error', error: '投稿を読み込めませんでした。' });
    await k.page.waitForTimeout(150);
    assert.match(await k.posts(), /残る知識/);
    assert.equal(await k.frame.locator('#posts [data-reload]').count(), 0);
  } finally { await k.close(); }
});

test('親は段と下書きを3秒までしか待たず、一覧を先に送る', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function runKnowledgeSync(options)');
  const body = html.slice(start, html.indexOf("type:'emu-knowledge-posts', posts:rows", start));
  assert.ok(start > 0);
  assert.match(body, /await _spSoon\(emuEnsureEntitlement\(\)\.catch\(\(\) => ''\), 3000\)/);
  assert.match(body, /const draftsSoon = await _spSoon\(draftsRead, 3000\);/);
  assert.match(body, /if \(!draftsSoon\.ok\) draftsRead\.then\(list => sendKnowledge\(\{ type:'emu-knowledge-drafts', drafts:list \|\| \[\] \}\)\);/);
  assert.doesNotMatch(body, /await emuEnsureEntitlement\(\);/);
  assert.doesNotMatch(body, /const drafts = await readKnowledgeDrafts\(account\);/);
});
