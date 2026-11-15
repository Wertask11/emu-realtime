'use strict';
/* 運営からのギフト：延長が認められたあとの画面（11/15 オーナーから）。

   前は認められたあとも見出しが「1週間の体験は終わりました」で、延長されたのか分かりにくかった。
   いまは「🎉 延長が認められました」と、いつまで使えるか（あと何日か）を先に出し、
   「知識を届ける」で投稿の画面を開く。延長の期間が過ぎたら、そう出してプランを案内する。
   サーバー（/api/emu-gift）は試験用の返事。本物のアカウントは使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
window.composed = 0; window.legal = [];
window.emuOpenKnowledgeComposer = () => { window.composed++; };
window.openLegal = (...a) => { window.legal.push(a); };
window.emuAuthHeaders = async (json) => Object.assign(json ? { 'Content-Type': 'application/json' } : {}, { Authorization: 'Bearer test' });
</script><button id="emuGiftButton" hidden></button><script src="/emu-gift-ui.js"></script></body>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/gift') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(status) {
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.href.startsWith('https://emu-realtime.onrender.com/api/emu-gift/status'))
      return route.fulfill({ json: status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/test/gift');
  await page.evaluate(() => window.emuGiftOpen());
  await page.waitForSelector('#emuGiftTitle');
  return { page, errors, close: () => context.close() };
}

const DAY = 86400000;

test('延長が認められたら、見出しで知らせ、いつまで使えるかとあと何日かを先に出す', async () => {
  const now = Date.now();
  const w = await open({ open: true, canClaim: false, trialClaimedAt: now - 20 * DAY, trialExpiresAt: now - 13 * DAY,
    schoolParkId: 'SP-TEST-0001', extensionStatus: 'approved', extensionExpiresAt: now + 30 * DAY - 60000 });
  try {
    assert.equal(await w.page.locator('#emuGiftTitle').innerText(), '🎉 延長が認められました');
    const box = await w.page.locator('.emu-gift-granted').innerText();
    assert.match(box, /Emu for SchoolPark light を/);
    assert.match(box, /まで/);
    assert.match(box, /使えます（あと 30 日）。/);
    const card = await w.page.locator('.emu-gift-card').innerText();
    assert.doesNotMatch(card, /1週間の体験は終わりました/, '見出しに体験の終わりを出さない');
    assert.match(card, /1週間の体験（.+ まで）のあと、パスポートIDを運営が確かめて延長しました。/);
    await w.page.locator('[data-gift="compose"]').click();
    assert.equal(await w.page.evaluate(() => window.composed), 1, '「知識を届ける」で投稿の画面を開く');
    assert.equal(await w.page.locator('#emuGiftSheet').isHidden(), true);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('延長の期間が過ぎたら、そう出して、プランの画面を開けるようにする', async () => {
  const now = Date.now();
  const w = await open({ open: true, canClaim: false, trialClaimedAt: now - 50 * DAY, trialExpiresAt: now - 43 * DAY,
    schoolParkId: 'SP-TEST-0001', extensionStatus: 'approved', extensionExpiresAt: now - DAY });
  try {
    assert.equal(await w.page.locator('#emuGiftTitle').innerText(), '延長の期間は終わりました');
    assert.match(await w.page.locator('.emu-gift-card').innerText(), /いまは見学（無料）です。書いた投稿はそのまま残っています。/);
    await w.page.locator('[data-gift="plans"]').click();
    assert.deepEqual(await w.page.evaluate(() => window.legal), [['membership', 'plan', 'light']]);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('申請中・延長前の画面は、これまでどおり', async () => {
  const now = Date.now();
  const w = await open({ open: true, canClaim: false, trialClaimedAt: now - 10 * DAY, trialExpiresAt: now - 3 * DAY,
    schoolParkId: 'SP-TEST-0001', extensionStatus: 'pending' });
  try {
    assert.equal(await w.page.locator('#emuGiftTitle').innerText(), '1週間の体験は終わりました');
    assert.match(await w.page.locator('.emu-gift-card').innerText(), /パスポートIDを運営に送りました。/);
  } finally { await w.close(); }
});
