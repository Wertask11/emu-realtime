'use strict';
/* EMUERのうちわけ（11/15 オーナー：「ばらばらすぎる。通信エラーなのか本当に無いのかあるのか、はっきりして」）。

   11/15「1つにまとめていいよ」：出すのは 実EMUER（ウォレット）・アプリ内EMUER・合計 の3行だけ。
   アプリ内EMUERは /api/emu/gifts/me の balance（受け取る前の報酬＋応援の台帳）。台帳のぶんは使い道が狭いので一言添える。
   サーバーが古く rewards を返さないときは、受け取る前の報酬を足して同じ数にする。
   どの画面も同じ読み方（wallet-success-ui.js の emuEmuerSummary）。
   読めなかったものは 0 と出さず「読み込めませんでした（通信エラー）」と出し、合計も出さない。
   サーバーとチェーンは試験用の返事。本物のアカウントやお金は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const ME = '0x' + 'a'.repeat(40);
const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
window.connectedAccount = ${JSON.stringify(ME)};
window.openEmuShopping = () => {};
window.emuAuthHeaders = async (json) => Object.assign(json ? { 'Content-Type': 'application/json' } : {}, { Authorization: 'Bearer test' });
/* チェーンの代わり：公開RPCで残高を読む部分だけを差し替える */
window.ethers = { providers: { StaticJsonRpcProvider: function () { if (window.chainDown) throw new Error('rpc down'); return {}; } },
  Contract: function () { return { balanceOf: async () => window.chainWei }; },
  utils: { formatUnits: (v) => String(Number(v) / 1e18) } };
window.chainWei = 3e18;
</script><script src="/wallet-success-ui.js"></script></body>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/sum') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open({ rewards, giftsMe, chainDown }) {
  const context = await browser.newContext();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/emuer/v2/config') return route.fulfill({ json: { enabled: true, chainId: 137, startsAt: '2026-10-01T00:00:00+09:00', contract: '0x' + '1'.repeat(40) }, headers: H });
    if (url.pathname === '/api/emuer/v2/rewards') return rewards === 'down' ? route.abort() : route.fulfill({ json: { rewards }, headers: H });
    if (url.pathname === '/api/emu/gifts/me') return giftsMe === 'down' ? route.abort() : route.fulfill({ json: giftsMe, headers: H });
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/test/sum');
  await page.waitForFunction(() => typeof window.emuRenderEmuerBreakdown === 'function');
  if (chainDown) await page.evaluate(() => { window.chainDown = true; });
  await page.evaluate(() => { const b = document.createElement('div'); b.id = 'box'; document.body.appendChild(b); });
  return { page, errors, close: () => context.close() };
}
const rowsOf = page => page.$$eval('#box .emu-sum-row', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));

test('アプリ内EMUERは1つの数で出す。実EMUERと合計も出す。台帳のぶんがあれば一言添える', async () => {
  const w = await open({ rewards: [], giftsMe: { ok: true, balance: 7, ledger: 5, rewards: 2, sentToday: 0, dailyLimit: 100 } });
  try {
    await w.page.evaluate(() => window.emuRenderEmuerBreakdown(document.getElementById('box'), true));
    assert.deepEqual(await rowsOf(w.page), [
      '実EMUER（ウォレット） 3 EMUER',
      'アプリ内EMUER 7 EMUER',
      '合計 10 EMUER']);
    assert.match(await w.page.locator('#box').innerText(), /うち 5 EMUER は、応援・協賛・投票にだけ使えます/);
    assert.equal(await w.page.locator('#box [data-emu-sum-reload]').count(), 0);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('古いサーバー（rewards を返さない）でも、受け取る前の報酬を足して同じ1つの数にする', async () => {
  const w = await open({ rewards: [{ claimId: '0x1', amount: '1' }, { claimId: '0x2', amount: '1' }], giftsMe: { ok: true, balance: 0, sentToday: 0, dailyLimit: 100 } });
  try {
    await w.page.evaluate(() => window.emuRenderEmuerBreakdown(document.getElementById('box'), true));
    assert.deepEqual(await rowsOf(w.page), ['実EMUER（ウォレット） 3 EMUER', 'アプリ内EMUER 2 EMUER', '合計 5 EMUER']);
    assert.doesNotMatch(await w.page.locator('#box').innerText(), /だけ使えます/, '台帳が0なら添え書きは出さない');
  } finally { await w.close(); }
});

test('読めなかったところは 0 にせず「読み込めませんでした」と出し、合計は出さない。もう一度読み込める', async () => {
  const w = await open({ rewards: [{ claimId: '0x1', amount: '2' }], giftsMe: 'down', chainDown: true });
  try {
    await w.page.evaluate(() => window.emuRenderEmuerBreakdown(document.getElementById('box'), true));
    assert.deepEqual(await rowsOf(w.page), [
      '実EMUER（ウォレット） 読み込めませんでした（通信エラー）',
      'アプリ内EMUER 読み込めませんでした（通信エラー）']);
    assert.match(await w.page.locator('#box').innerText(), /0 ではなく「まだ分からない」です/);
    // 通信が戻ったら、もう一度読み込むで正しい数に変わる
    await w.page.evaluate(() => { window.chainDown = false; });
    await w.page.unroute('**/*').catch(() => {});
    await w.page.context().unroute('**/*');
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    await w.page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/emuer/v2/rewards') return route.fulfill({ json: { rewards: [{ claimId: '0x1', amount: '2' }] }, headers: H });
      if (url.pathname === '/api/emu/gifts/me') return route.fulfill({ json: { ok: true, balance: 2, ledger: 0, rewards: 2, sentToday: 0, dailyLimit: 100 }, headers: H });
      if (url.pathname === '/api/emuer/v2/config') return route.fulfill({ json: { enabled: true, chainId: 137, contract: '0x' + '1'.repeat(40) }, headers: H });
      return route.continue();
    });
    await w.page.locator('#box [data-emu-sum-reload]').click();
    await w.page.waitForFunction(() => /合計/.test(document.getElementById('box').innerText));
    assert.deepEqual(await rowsOf(w.page), [
      '実EMUER（ウォレット） 3 EMUER',
      'アプリ内EMUER 2 EMUER',
      '合計 5 EMUER']);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
