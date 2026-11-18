'use strict';
/* Knowledge Text：本棚から本を選び、開くと中からいろいろなものが飛び出して、最後に本文が出る（11/18 オーナー）
   ・テーマの一覧とコンテンツの一覧は本の表紙として並ぶ
   ・本を押すと演出が出て、終わると本文が出る（もとの本文の出し方はそのまま）
   ・押すと演出をとばせる。動きを減らす設定では演出なしですぐ本文
   サーバーは偽物（このテストの中の決まった答え）。本物のデータは使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(''); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

const CONTENTS = [
  { id: 'c1', title: 't', theme: 'money', subTheme: '', subSubTheme: '', summary: '詐欺の見抜き方', body: 'うまい話には理由がある。\n全文です。', note: '注意書き', createdAt: 1763400000000 },
  { id: 'c2', title: 't', theme: 'money', subTheme: '', subSubTheme: '', summary: '貯金の始め方', body: '先取りで貯める。', createdAt: 1763400000000 },
];
async function open({ width = 390, reducedMotion = 'no-preference', query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion });
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/room1/contents') return route.fulfill({ json: CONTENTS });
    return u.origin === base ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/admin/room1/index.html' + query);
  await page.locator('#list .card').first().waitFor({ state: 'attached' });
  // テストのコンテンツを、最初のテーマに入れる
  const sub = await page.locator('#list .card h2').first().textContent();
  await page.evaluate((s) => { room1Contents.forEach((c) => { c.subTheme = s; }); }, sub);
  return { page, errors, sub, close: () => context.close() };
}

test('テーマとコンテンツが本の表紙として並ぶ', async () => {
  const w = await open();
  try {
    const cover = await w.page.locator('#list .card').first().evaluate((el) => { const s = getComputedStyle(el); return { img: s.backgroundImage, color: s.color, mark: getComputedStyle(el, '::after').content }; });
    assert.match(cover.img, /linear-gradient/);
    assert.equal(cover.color, 'rgb(255, 255, 255)');
    assert.notEqual(cover.mark, 'none');
    await w.page.locator('#list .card').first().click();
    await w.page.locator('#detailList .card').nth(1).waitFor();
    assert.equal(await w.page.locator('#detailList .card').count(), 2);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('本を押すと、本が開いて中からいろいろなものが飛び出し、最後に本文が出る', async () => {
  const w = await open();
  try {
    await w.page.locator('#list .card').first().click();
    await w.page.locator('#detailList .card').first().click();
    const stage = w.page.locator('.bk-stage');
    await stage.waitFor();
    assert.match(await stage.locator('.bk-cover').textContent(), /詐欺の見抜き方/);
    assert.match(await stage.locator('.bk-cover small').textContent(), /MONEY/);
    assert.ok(await stage.locator('.bk-fly span').count() >= 10, '飛び出すものがある');
    assert.equal(await w.page.locator('#detailBody').textContent(), '', '演出の間は本文はまだ');
    await stage.waitFor({ state: 'detached', timeout: 5000 });
    await w.page.locator('#detailBody.bk-reveal').waitFor();
    const body = await w.page.locator('#detailBody').textContent();
    assert.match(body, /うまい話には理由がある/);
    assert.match(body, /注意書き/);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('押すと演出をとばして、すぐ本文が出る。戻ると本棚に戻る', async () => {
  const w = await open({ width: 1280 });
  try {
    await w.page.locator('#list .card').first().click();
    await w.page.locator('#detailList .card').nth(1).click();
    await w.page.locator('.bk-stage').waitFor();
    await w.page.waitForTimeout(200);
    await w.page.locator('.bk-stage').click();
    assert.equal(await w.page.locator('.bk-stage').count(), 0);
    assert.match(await w.page.locator('#detailBody').textContent(), /先取りで貯める/);
    await w.page.evaluate(() => backToSub());
    assert.equal(await w.page.locator('#detailList .card').count(), 2);
    assert.equal(await w.page.locator('#detailBody').textContent(), '');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('動きを減らす設定では、演出をせずにすぐ本文を出す', async () => {
  const w = await open({ reducedMotion: 'reduce' });
  try {
    await w.page.locator('#list .card').first().click();
    await w.page.locator('#detailList .card').first().click();
    assert.equal(await w.page.locator('.bk-stage').count(), 0);
    assert.match(await w.page.locator('#detailBody').textContent(), /うまい話には理由がある/);
  } finally { await w.close(); }
});

test('リンクで直接開いたときも、演出のあとに本文が出る', async () => {
  const w = await open({ query: '?contentId=c1' });
  try {
    await w.page.locator('.bk-stage').waitFor();
    await w.page.locator('.bk-stage').waitFor({ state: 'detached', timeout: 5000 });
    assert.match(await w.page.locator('#detailBody').textContent(), /うまい話には理由がある/);
  } finally { await w.close(); }
});
