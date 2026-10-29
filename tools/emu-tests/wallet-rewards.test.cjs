'use strict';
/* EMUER の受け取り（wallet-success-ui.js）を、MetaMask の無いところで確かめる（10/29 オーナーから）。

   1. LINE・Google のアプリ内ブラウザには MetaMask が無い。今日のぶん（+1 EMUER）を押すと、
      前は「missing provider」で止まった。いまは報酬を作るだけにして（claim:false）、
      ウォレットに移す前のEMUERとして公式ショップで使えると伝える。
   2. 未請求の報酬の「受け取る」も、MetaMask が無いときはサーバーに署名を頼まない
      （頼むと15分は公式ショップでも使えなくなる）。
   3. Good・Change の報酬の記録。前は JSON の印を付けずに送っていて、サーバーが中身を読めず
      記録されていなかった。いまは印を付けて送り、届かなければ端末に残して、次に開いたときに送り直す。

   サーバー（/api/emuer/v2）は試験用の返事。本物のアカウントやお金は使わない。 */
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
window.opened = [];
window.openEmuShopping = view => window.opened.push(view);
window.emuAuthHeaders = async (json, options) => { window.authCalls = (window.authCalls || []).concat([options || null]);
  return Object.assign(json ? { 'Content-Type': 'application/json' } : {}, { Authorization: 'Bearer test' }); };
</script><script src="/wallet-success-ui.js"></script></body>`;
const API = 'https://emu-realtime.onrender.com/api/emuer/v2';

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

/* api: { '<METHOD> <path>': (body, headers) => ({ status, json }) } */
async function open(api, context) {
  context = context || await browser.newContext();
  const calls = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.href.startsWith(API)) {
      const key = req.method() + ' ' + url.pathname.replace('/api/emuer/v2', '');
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      calls.push({ key, body, type: req.headers()['content-type'] || '' });
      const handler = api[key] || (key === 'GET /config' ? () => ({ json: { enabled: true, chainId: 137, startsAt: '2026-10-01T00:00:00+09:00', contract: '0x' + '1'.repeat(40) } }) : null);
      if (!handler) return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' }, headers: { 'Access-Control-Allow-Origin': '*' } });
      const r = handler(body);
      return route.fulfill({ status: r.status || 200, json: r.json || { ok: true }, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    }
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [], alerts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await page.goto(base + '/test/wallet');
  await page.waitForFunction(() => typeof window.wsOpenRewards === 'function');
  return { page, calls, errors, alerts, context, close: () => context.close() };
}

test('MetaMask が無いとき：今日のぶんは「作るだけ」で受け取り、公式ショップで使えると伝える', async () => {
  let claimed = false;
  const w = await open({
    'GET /daily/login/status': () => ({ json: { claimedToday: claimed } }),
    'POST /daily/login': () => { claimed = true; return { json: { ok: true, recorded: true, amount: '1' } }; },
    'GET /rewards': () => ({ json: { rewards: [] } })
  });
  try {
    await w.page.evaluate(() => window.wsOpenRewards());
    const login = w.page.locator('#wsLogin');
    await w.page.waitForFunction(() => document.getElementById('wsLogin').textContent === '今日のぶん +1 EMUER を受け取る');
    assert.equal(await w.page.locator('#wsBalance').innerText(), '—', '残高は MetaMask が無いと読めない');
    await login.click();
    await w.page.waitForFunction(() => document.getElementById('wsLogin').textContent === '今日のぶんは受け取り済み');
    assert.match(await w.page.locator('#wsStatus').innerText(), /1 EMUER を受け取りました。ウォレットに移す前のEMUERとしてたまり、City の公式ショップでそのまま使えます。/);
    const sent = w.calls.find(c => c.key === 'POST /daily/login');
    assert.deepEqual(sent.body, { address: ME, claim: false });
    assert.deepEqual(w.alerts, [], '「missing provider」を出さない');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('MetaMask が無いとき：未請求の報酬は「公式ショップで使える」と出し、ボタンで公式ショップを開く（署名は頼まない）', async () => {
  const w = await open({
    'GET /daily/login/status': () => ({ json: { claimedToday: true } }),
    'GET /rewards': () => ({ json: { rewards: [{ claimId: '0x01', kind: 'good-received', amount: '1' }, { claimId: '0x02', kind: 'login', amount: '1' }] } })
  });
  try {
    await w.page.evaluate(() => window.wsOpenRewards());
    await w.page.waitForFunction(() => !document.getElementById('wsClaim').hidden);
    assert.equal(await w.page.locator('#wsClaim').innerText(), 'City の公式ショップで使う');
    assert.equal(await w.page.locator('#wsStatus').innerText(),
      '受け取る前のEMUERが 2 EMUER あります（2件）。City の公式ショップでそのまま使えます。ウォレットへ移すときは、MetaMask の入ったブラウザで開いてください。');
    await w.page.locator('#wsClaim').click();
    assert.deepEqual(await w.page.evaluate(() => window.opened), ['commerce']);
    assert.equal(await w.page.locator('#walletSuccessOverlay').evaluate(el => el.classList.contains('active')), false, '受け取りの画面は閉じる');
    assert.deepEqual(w.alerts, []);
    assert.equal(w.calls.some(c => c.key === 'POST /rewards/bundle' || c.key.endsWith('/authorization')), false, '署名を頼まない');
  } finally { await w.close(); }
});

test('Good・Change の報酬：JSON として送る。届かなければ端末に残し、次に開いたときに送り直す', async () => {
  let fail = true;
  const api = { 'POST /activity/reaction': () => (fail ? { status: 503, json: { error: 'DOWN' } } : { json: { ok: true } }) };
  const context = await browser.newContext();
  const w = await open(api, context);
  try {
    await w.page.evaluate(() => window.dispatchEvent(new CustomEvent('emu-reaction-result', { detail: { postId: 'p1', action: 'good', ok: true } })));
    for (let i = 0; i < 40 && !w.calls.some(c => c.key === 'POST /activity/reaction'); i += 1) await w.page.waitForTimeout(50);
    const first = w.calls.find(c => c.key === 'POST /activity/reaction');
    assert.match(first.type, /application\/json/, 'JSON の印を付ける');
    assert.deepEqual(first.body, { postId: 'p1', action: 'good', address: ME });
    await w.page.waitForFunction(() => JSON.parse(localStorage.getItem('emuReactionRewardQueue') || '[]').length === 1);
    // 失敗した反応は送り直し待ち。うまくいかなかった反応（ok:false）は送らない
    await w.page.evaluate(() => window.dispatchEvent(new CustomEvent('emu-reaction-result', { detail: { postId: 'p2', action: 'change', ok: false } })));
    assert.equal(await w.page.evaluate(() => JSON.parse(localStorage.getItem('emuReactionRewardQueue')).length), 1);
    const authOptions = await w.page.evaluate(() => window.authCalls);
    assert.ok(authOptions.some(o => o && o.interactive === false), '裏で送るときはログインの画面を出さない');

    fail = false;
    const again = await context.newPage();
    await again.goto(base + '/test/wallet');
    await again.waitForFunction(() => !localStorage.getItem('emuReactionRewardQueue'), null, { timeout: 15000 });
    assert.equal(w.calls.filter(c => c.key === 'POST /activity/reaction').length >= 2, true, '開き直したら送り直す');
  } finally { await w.close(); }
});

test('Good・Change の報酬：送っても意味がない返事（投稿が無いなど）は、送り直さない', async () => {
  const w = await open({ 'POST /activity/reaction': () => ({ status: 409, json: { error: 'REACTION_NOT_VERIFIED' } }) });
  try {
    await w.page.evaluate(() => window.dispatchEvent(new CustomEvent('emu-reaction-result', { detail: { postId: 'p3', action: 'change', ok: true } })));
    await w.page.waitForFunction(() => !localStorage.getItem('emuReactionRewardQueue') && true);
    for (let i = 0; i < 40 && !w.calls.some(c => c.key === 'POST /activity/reaction'); i += 1) await w.page.waitForTimeout(50);
    await w.page.waitForTimeout(200);
    assert.equal(await w.page.evaluate(() => localStorage.getItem('emuReactionRewardQueue')), null);
  } finally { await w.close(); }
});
