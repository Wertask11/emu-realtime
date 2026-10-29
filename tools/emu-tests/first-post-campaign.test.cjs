'use strict';
/* 初投稿キャンペーン（10/29 オーナーから）の画面の側。
   初めて知識を公開したら、その場で 100 EMUER が「受け取る前のEMUER」に入る。公式ショップでそのまま使える。

   index.html は公開できたあとに emu-post-published を出す。wallet-success-ui.js がそれを
   サーバーに送る（初めてかどうか・期間内か・パスポートごとに1回かはサーバーが決める）。
     - 受け取れたら、その場で知らせて、公式ショップを開けるようにする
     - 届かなかったら端末に残して、次に開いたときに送り直す
     - 決着がついた名義には、もう送らない（投稿のたびにサーバーに聞かない）
   サーバー（/api/emuer/v2）は試験用の返事。本物のアカウントやお金は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const ROOT = path.join(__dirname, '../../frontend/public');
const ME = '0x' + 'a'.repeat(40);
const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
window.connectedAccount = ${JSON.stringify(ME)};
window.opened = [];
window.openEmuShopping = view => window.opened.push(view);
window.emuAuthHeaders = async json => Object.assign(json ? { 'Content-Type': 'application/json' } : {}, { Authorization: 'Bearer test' });
</script><script src="/wallet-success-ui.js"></script></body>`;
const API = 'https://emu-realtime.onrender.com/api/emuer/v2';
const IN_CAMPAIGN = Date.parse('2026-10-30T12:00:00+09:00');

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/wallet') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(api, { context, now = IN_CAMPAIGN } = {}) {
  context = context || await browser.newContext();
  await context.addInitScript(t => { Date.now = () => t; }, now);
  const calls = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.href.startsWith(API)) {
      const key = req.method() + ' ' + url.pathname.replace('/api/emuer/v2', '');
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      calls.push({ key, body, type: req.headers()['content-type'] || '' });
      const handler = api[key] || (key === 'GET /config' ? () => ({ json: { enabled: true, chainId: 137, contract: '0x' + '1'.repeat(40) } }) : null);
      if (!handler) return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' }, headers: { 'Access-Control-Allow-Origin': '*' } });
      const r = handler(body);
      return route.fulfill({ status: r.status || 200, json: r.json || { ok: true }, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    }
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/test/wallet');
  await page.waitForFunction(() => typeof window.wsFlushFirstPost === 'function');
  const publish = (postId, address = ME) => page.evaluate(([p, a]) =>
    window.dispatchEvent(new CustomEvent('emu-post-published', { detail: { postId: p, address: a } })), [postId, address]);
  const sent = () => calls.filter(c => c.key === 'POST /activity/first-post');
  return { page, calls, sent, errors, context, publish, close: () => context.close() };
}
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('emuFirstPostCampaign') || '{}'));

test('公開したら送り、受け取れたらその場で知らせる。「公式ショップで使う」で公式ショップを開く', async () => {
  const w = await open({ 'POST /activity/first-post': () => ({ json: { ok: true, amount: '100' } }) });
  try {
    await w.publish('p1');
    await w.page.waitForSelector('#wsFirstPostNotice');
    const text = await w.page.textContent('#wsFirstPostNotice');
    assert.match(text, /初投稿キャンペーン：100 EMUER を受け取りました/);
    assert.match(text, /受け取る前のEMUER/);
    assert.match(text, /公式ショップ/);
    assert.deepEqual(w.sent().map(c => c.body), [{ postId: 'p1' }], '名義はサーバーがログインから決める');
    assert.match(w.sent()[0].type, /application\/json/);
    await w.page.click('#wsFirstPostNotice button:has-text("公式ショップで使う")');
    assert.deepEqual(await w.page.evaluate(() => window.opened), ['commerce']);
    // 決着がついたので、次に公開してもサーバーに聞かない
    await w.publish('p2');
    await w.page.waitForTimeout(200);
    assert.equal(w.sent().length, 1);
    assert.ok((await state(w.page)).settled[ME]);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('対象外（前に投稿したことがある）なら、何も出さず、もう送らない', async () => {
  const w = await open({ 'POST /activity/first-post': () => ({ status: 409, json: { error: 'NOT_FIRST_POST' } }) });
  try {
    await w.publish('p1');
    await w.page.waitForFunction(() => JSON.parse(localStorage.getItem('emuFirstPostCampaign') || '{}').settled);
    assert.equal(await w.page.$('#wsFirstPostNotice'), null);
    await w.publish('p2');
    await w.page.waitForTimeout(200);
    assert.equal(w.sent().length, 1);
  } finally { await w.close(); }
});

test('届かなかったら端末に残して、次に開いたときに最初の投稿で送り直す', async () => {
  const context = await browser.newContext();
  const w = await open({ 'POST /activity/first-post': () => ({ status: 503, json: { error: 'FIRESTORE_UNAVAILABLE' } }) }, { context });
  try {
    await w.publish('p1');
    for (let i = 0; i < 40 && !w.sent().length; i += 1) await w.page.waitForTimeout(50);
    await w.page.waitForTimeout(100);
    // 2つ目を公開しても、送り直し待ちは最初の投稿のまま
    await w.publish('p2');
    await w.page.waitForTimeout(200);
    assert.equal((await state(w.page)).pending.postId, 'p1');
    await w.page.close();
    await context.unroute('**/*');
    const again = await open({ 'POST /activity/first-post': () => ({ json: { ok: true, amount: '100' } }) }, { context });
    await again.page.waitForSelector('#wsFirstPostNotice', { timeout: 15000 });
    assert.deepEqual(again.sent().map(c => c.body), [{ postId: 'p1' }]);
    assert.equal((await state(again.page)).pending, undefined);
  } finally { await context.close(); }
});

test('パスポートが無いときは、作ると受け取れると一度だけ知らせ、あとで送り直す', async () => {
  const w = await open({ 'POST /activity/first-post': () => ({ status: 409, json: { error: 'PASSPORT_REQUIRED' } }) });
  try {
    await w.publish('p1');
    await w.page.waitForSelector('#wsFirstPostNotice');
    assert.match(await w.page.textContent('#wsFirstPostNotice'), /パスポート（SchoolPark ID）を作ると受け取れます/);
    const s = await state(w.page);
    assert.equal(s.pending.postId, 'p1'); assert.equal(s.pending.toldPassport, true);
    await w.page.click('#wsFirstPostNotice button');
    await w.page.evaluate(() => window.wsFlushFirstPost());
    assert.equal(await w.page.$('#wsFirstPostNotice'), null, '2回目は知らせない');
  } finally { await w.close(); }
});

test('期間が終わったら送らない', async () => {
  const w = await open({ 'POST /activity/first-post': () => ({ json: { ok: true, amount: '100' } }) }, { now: Date.parse('2026-11-29T00:00:00+09:00') });
  try {
    await w.publish('p1');
    await w.page.waitForTimeout(200);
    assert.equal(w.sent().length, 0);
  } finally { await w.close(); }
});

test('index.html：新しく公開できたときだけ知らせる。前の窓口（/first-post/register）はもう呼ばない', () => {
  const INDEX = readHtml('frontend/public/index.html');
  assert.equal(INDEX.includes('onrender.com/first-post/register'), false, '窓口の無い古い呼び出しを残さない');
  const at = INDEX.indexOf('await _postBatch.commit();');
  const after = INDEX.slice(at, at + 400);
  assert.ok(after.includes('new CustomEvent("emu-post-published", { detail: { postId: _labPostRef.id, address: authorAddress } })'));
  assert.equal(INDEX.split('emu-post-published').length - 1, 2, '知らせるのは新規の投稿の1か所だけ（もう1つは説明）');
});

test('ギフトの画面に、期間中だけキャンペーンの案内を出す', () => {
  const GIFT = fs.readFileSync(path.join(ROOT, 'emu-gift-ui.js'), 'utf8');
  assert.ok(GIFT.includes("return head + body + campaign(now)"));
  assert.ok(GIFT.includes("Date.parse('2026-10-29T00:00:00+09:00'), FIRST_POST_UNTIL = Date.parse('2026-11-29T00:00:00+09:00')"));
  assert.ok(GIFT.includes('100 EMUER'));
});
