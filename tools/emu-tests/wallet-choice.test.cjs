'use strict';
/* 「ウォレットではじめる」でウォレットを選ぶ（wallet-choice.js、10/30 オーナーから）。

   MetaMask はこれまでどおり。HashPort Wallet などは WalletConnect でつなぎ、つないだウォレットを
   window.ethereum に置く（Emu はウォレットとのやりとりを全部 window.ethereum で行うので、そのまま使える）。
   WalletConnect の本物（relay・QR）にはつながない。試験用の偽物のウォレットを使う。
   最後に、同梱した本物の部品がブラウザで読み込めることだけを確かめる。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { readHtml } = require('../year-goals-tests/extract.cjs');

const ROOT = path.join(__dirname, '../../frontend/public');
const CHOICE = fs.readFileSync(path.join(ROOT, 'wallet-choice.js'), 'utf8');
const ME = '0x' + 'a'.repeat(40), PHONE = '0x' + 'b'.repeat(40);
/* 偽物の WalletConnect。connect で QR の画面の代わりに、決めた結果を返す */
const FAKE_WC = `window.EmuWalletConnect = { EthereumProvider: { init: async (opts) => {
  window.wcInit = opts;
  const handlers = {};
  const session = { topic: 't', peer: { metadata: { name: 'HashPort Wallet', redirect: { native: 'hashport://' } } } };
  const p = { isFakeWc: true, session: window.wcHasSession ? session : null,
    on: (e, f) => { handlers[e] = f; },
    connect: async () => { window.wcConnects = (window.wcConnects || 0) + 1;
      window.flagWhileConnecting = localStorage.getItem('emuWcLogin');
      if (window.wcResult === 'closed') throw new Error('Connection request reset. Please try again.');
      if (window.wcResult === 'error') throw new Error('relay down');
      p.session = session; },
    request: async ({ method }) => {
      if (method === 'personal_sign') { await new Promise(r => { window.approveSign = r; }); return '0xsig'; }
      return method === 'eth_requestAccounts' || method === 'eth_accounts' ? [${JSON.stringify(PHONE)}] : null; },
    disconnect: () => handlers.disconnect && handlers.disconnect() };
  return p; } } };`;
const page = (withInjected) => `<!doctype html><meta charset="utf-8"><body><script>
${withInjected ? `window.ethereum = { isMetaMask: true, request: async () => [${JSON.stringify(ME)}] };` : ''}
</script><script src="/wallet-choice.js"></script></body>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/test/injected') return res.end(page(true));
    if (url.pathname === '/test/plain') return res.end(page(false));
    if (url.pathname === '/test/bundle') return res.end('<!doctype html><meta charset="utf-8"><script src="/vendor/walletconnect/ethereum-provider-2.26.0.js"></script>');
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    // 試験用のプロジェクトID を入れた版（?ready）と、ID が空の版（入れる前の状態）
    if (url.pathname === '/wallet-choice.js') return res.end(CHOICE.replace(/var WC_PROJECT_ID = '[^']*';/,
      req.headers.referer && /ready/.test(req.headers.referer) ? "var WC_PROJECT_ID = 'test-project';" : "var WC_PROJECT_ID = '';"));
    if (url.pathname.startsWith('/vendor/walletconnect/') && req.headers.referer && !/bundle/.test(req.headers.referer)) return res.end(FAKE_WC);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(p, { mobile = false, init = null } = {}) {
  const context = await browser.newContext(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } : {});
  if (init) await context.addInitScript(init);
  await context.route('**/*', route => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const pg = await context.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(base + p);
  await pg.waitForFunction(() => typeof window.emuChooseWallet === 'function');
  return { pg, errors, close: () => context.close() };
}
const choose = pg => pg.evaluate(() => { window.chosen = undefined; window.emuChooseWallet().then(k => { window.chosen = k; }); });
const chosen = pg => pg.waitForFunction(() => window.chosen !== undefined).then(() => pg.evaluate(() => window.chosen));

test('選ぶ画面：MetaMask と HashPort Wallet など。プロジェクトID が無いうちは WalletConnect は「準備中」', async () => {
  const w = await open('/test/injected');
  try {
    await choose(w.pg);
    await w.pg.waitForSelector('#emuWalletChoice:not([hidden])');
    assert.match(await w.pg.textContent('#emuWalletChoiceTitle'), /どのウォレットで入りますか/);
    assert.match(await w.pg.textContent('[data-wc="metamask"]'), /MetaMask/);
    assert.match(await w.pg.textContent('[data-wc="walletconnect"]'), /HashPort Wallet など[\s\S]*準備中/);
    assert.equal(await w.pg.$eval('[data-wc="walletconnect"]', b => b.disabled), true);
    await w.pg.click('[data-wc="metamask"]');
    assert.equal(await chosen(w.pg), 'metamask');
    assert.equal(await w.pg.evaluate(() => window.ethereum.isMetaMask), true, 'MetaMask はそのまま');
    // 閉じたら null（何もしない）
    await choose(w.pg);
    await w.pg.click('[data-wc="close"]');
    assert.equal(await chosen(w.pg), null);
    await choose(w.pg);
    await w.pg.keyboard.press('Escape');
    assert.equal(await chosen(w.pg), null);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('HashPort Wallet など：WalletConnect でつなぎ、window.ethereum に置く。MetaMask を選び直すと元に戻す', async () => {
  const w = await open('/test/injected?ready');
  try {
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    assert.equal(await chosen(w.pg), 'walletconnect');
    const init = await w.pg.evaluate(() => window.wcInit);
    assert.equal(init.projectId, 'test-project');
    assert.deepEqual(init.chains, [137], 'Polygon（EMUER のあるところ）');
    assert.equal(init.showQrModal, true, 'パソコンでは QR、スマホではウォレットの一覧を出す');
    assert.ok(init.methods.includes('personal_sign') && init.methods.includes('eth_sendTransaction'));
    assert.equal(init.metadata.name, 'Emu for SchoolPark');
    assert.equal(await w.pg.evaluate(() => window.ethereum.isFakeWc), true);
    assert.deepEqual(await w.pg.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' })), [PHONE]);
    assert.equal(await w.pg.evaluate(() => window.emuWalletIsWalletConnect()), true);
    // もう一度選んでも、つなぎが残っていれば QR を出し直さない
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    assert.equal(await chosen(w.pg), 'walletconnect');
    assert.equal(await w.pg.evaluate(() => window.wcConnects), 1);
    // MetaMask を選び直すと、ブラウザの MetaMask に戻す
    await choose(w.pg);
    await w.pg.click('[data-wc="metamask"]');
    assert.equal(await chosen(w.pg), 'metamask');
    assert.equal(await w.pg.evaluate(() => window.ethereum.isMetaMask), true);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('QR の画面を閉じたら選ぶ画面に戻る。つなげなかったら理由を出す', async () => {
  const w = await open('/test/plain?ready');
  try {
    await w.pg.evaluate(() => { window.wcResult = 'closed'; });
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    await w.pg.waitForFunction(() => window.wcConnects === 1);
    await w.pg.waitForSelector('#emuWalletChoice:not([hidden])');
    assert.equal(await w.pg.$eval('.emu-wc-message', m => m.hidden), true, '自分で閉じたときは何も言わない');
    assert.equal(await w.pg.$eval('[data-wc="walletconnect"]', b => b.disabled), false);
    await w.pg.evaluate(() => { window.wcResult = 'error'; });
    await w.pg.click('[data-wc="walletconnect"]');
    await w.pg.waitForSelector('.emu-wc-message:not([hidden])');
    assert.match(await w.pg.textContent('.emu-wc-message'), /ウォレットにつなげませんでした/);
    assert.equal(await w.pg.evaluate(() => typeof window.ethereum), 'undefined', 'つながっていないものは置かない');
    // MetaMask の無いブラウザで MetaMask を選んだら、これまでどおり（index.html が案内する）
    await w.pg.click('[data-wc="metamask"]');
    assert.equal(await chosen(w.pg), 'metamask');
    assert.equal(await w.pg.evaluate(() => typeof window.ethereum), 'undefined');
  } finally { await w.close(); }
});

test('index.html：ボタン・パスポートへの追加・開き直したときの復元が、選ぶ画面を通る', () => {
  const INDEX = readHtml('frontend/public/index.html');
  assert.ok(INDEX.includes('<script src="/wallet-choice.js"></script>'));
  const btn = INDEX.slice(INDEX.indexOf('document.getElementById("connectWalletButton").addEventListener("click"'));
  assert.ok(btn.slice(0, 400).includes('kind = await window.emuChooseWallet();'));
  assert.ok(btn.slice(0, 400).includes('await emuStartWalletLogin(kind);'));
  assert.ok(INDEX.includes('provider: _viaWalletConnect ? "walletconnect" : "metamask"'));
  assert.ok(INDEX.includes('if (parsed.provider === "walletconnect") return;'), 'WalletConnect の人に MetaMask のアドレスを入れない');
  const link = INDEX.slice(INDEX.indexOf('SPID.linkWallet = async function ()'), INDEX.indexOf('SPID.linkWallet = async function ()') + 500);
  assert.ok(link.includes('await window.emuChooseWallet()'));
});

test('同梱した WalletConnect の部品が、ブラウザで読み込める', async () => {
  const context = await browser.newContext();
  await context.route('**/*', route => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const pg = await context.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/test/bundle');
    assert.equal(await pg.evaluate(() => typeof window.EmuWalletConnect?.EthereumProvider?.init), 'function');
    assert.deepEqual(errors, []);
    const notice = fs.readFileSync(path.join(ROOT, 'vendor/walletconnect/readme.txt'), 'utf8');
    assert.match(notice, /Portions © 2025 Reown, Inc\. All Rights Reserved/, 'ライセンスが求める表記');
    assert.match(CHOICE, /var WC_SRC = '\/vendor\/walletconnect\/ethereum-provider-2\.26\.0\.js';/);
    assert.match(CHOICE, /var WC_PROJECT_ID = '80d72a3cd33769b8dfc50bd48b224c6a';/, '本番は Reown の Emu for SchoolPark');
  } finally { await context.close(); }
});

test('スマホ：署名を待つあいだ「ウォレットで承認 → Emu に戻る」を出し、ウォレットを開くボタンを置く。承認したら消す', async () => {
  const w = await open('/test/plain?ready', { mobile: true });
  try {
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    assert.equal(await chosen(w.pg), 'walletconnect');
    assert.ok(await w.pg.evaluate(() => window.flagWhileConnecting), 'つないでいるあいだは、続きから入る印を置く');
    assert.equal(await w.pg.evaluate(() => window.wcInit.metadata.redirect.universal), base + '/', '承認後の戻り先を伝える');
    await w.pg.evaluate(() => { window.signed = window.ethereum.request({ method: 'personal_sign', params: ['m', '0x'] }); });
    await w.pg.waitForSelector('#emuWalletGuide:not([hidden])');
    assert.match(await w.pg.textContent('.emu-wc-guide-title'), /HashPort Wallet で「署名」を承認してください/);
    assert.match(await w.pg.textContent('.emu-wc-steps'), /このページ（Emu）に戻ってくる/);
    assert.equal(await w.pg.getAttribute('.emu-wc-open', 'href'), 'hashport://');
    assert.match(await w.pg.textContent('.emu-wc-open'), /HashPort Wallet を開く/);
    await w.pg.evaluate(() => window.approveSign());
    assert.equal(await w.pg.evaluate(() => window.signed), '0xsig');
    assert.equal(await w.pg.$eval('#emuWalletGuide', g => g.hidden), true);
    // 読むだけ（アカウント）では出さない
    await w.pg.evaluate(() => window.ethereum.request({ method: 'eth_accounts' }));
    assert.equal(await w.pg.$eval('#emuWalletGuide', g => g.hidden), true);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('パソコン：署名を待つあいだ「スマホで承認」を出す（ウォレットを開くボタンは出さない）', async () => {
  const w = await open('/test/plain?ready');
  try {
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    await chosen(w.pg);
    await w.pg.evaluate(() => { window.ethereum.request({ method: 'personal_sign', params: ['m', '0x'] }); });
    await w.pg.waitForSelector('#emuWalletGuide:not([hidden])');
    assert.match(await w.pg.textContent('.emu-wc-steps'), /スマホの HashPort Wallet に届いた「署名」を承認する/);
    assert.equal(await w.pg.$eval('.emu-wc-open', a => a.hidden), true);
  } finally { await w.close(); }
});

test('ページが開き直されたとき：つなぐ途中・WalletConnect で入っていた人は、QR も選ぶ画面も出さずに続きから', async () => {
  // つなぐ途中（印あり）＋つなぎが残っている
  let w = await open('/test/plain?ready', { init: () => { localStorage.setItem('emuWcLogin', String(Date.now())); window.wcHasSession = true; } });
  try {
    assert.equal(await w.pg.evaluate(() => window.emuWalletConnectResume()), true);
    assert.equal(await w.pg.evaluate(() => window.ethereum.isFakeWc), true);
    assert.equal(await w.pg.evaluate(() => window.wcConnects || 0), 0, 'QR を出し直さない');
    assert.equal(await w.pg.$('#emuWalletChoice'), null, '選ぶ画面も出さない');
  } finally { await w.close(); }
  // WalletConnect で入っていた人
  w = await open('/test/plain?ready', { init: () => { localStorage.setItem('emu_auth', JSON.stringify({ type: 'wallet', provider: 'walletconnect' })); window.wcHasSession = true; } });
  try { assert.equal(await w.pg.evaluate(() => window.emuWalletConnectResume()), true); } finally { await w.close(); }
  // つなぎが切れていたら、何もしない（ログイン画面のまま）
  w = await open('/test/plain?ready', { init: () => { localStorage.setItem('emuWcLogin', String(Date.now())); } });
  try {
    assert.equal(await w.pg.evaluate(() => window.emuWalletConnectResume()), false);
    assert.equal(await w.pg.evaluate(() => typeof window.ethereum), 'undefined');
  } finally { await w.close(); }
  // MetaMask・LINE の人、古い印（30分より前）は、部品も読み込まない
  for (const init of [
    () => { localStorage.setItem('emu_auth', JSON.stringify({ type: 'wallet', provider: 'metamask' })); },
    () => { localStorage.setItem('emu_auth', JSON.stringify({ type: 'chesFree', provider: 'line' })); },
    () => { localStorage.setItem('emuWcLogin', String(Date.now() - 31 * 60 * 1000)); }
  ]) {
    w = await open('/test/injected?ready', { init });
    try {
      assert.equal(await w.pg.evaluate(() => window.emuWalletConnectResume()), false);
      assert.equal(await w.pg.evaluate(() => !!window.EmuWalletConnect), false);
      assert.equal(await w.pg.evaluate(() => window.ethereum.isMetaMask), true);
    } finally { await w.close(); }
  }
});

test('QR を閉じたら、続きから入る印を消す。index.html は開いたときに続きから入り、終わったら印を消す', async () => {
  const w = await open('/test/plain?ready');
  try {
    await w.pg.evaluate(() => { window.wcResult = 'closed'; });
    await choose(w.pg);
    await w.pg.click('[data-wc="walletconnect"]');
    await w.pg.waitForSelector('#emuWalletChoice:not([hidden])');
    assert.equal(await w.pg.evaluate(() => localStorage.getItem('emuWcLogin')), null);
  } finally { await w.close(); }
  const INDEX = readHtml('frontend/public/index.html');
  assert.ok(INDEX.includes('if (await window.emuWalletConnectResume()) await emuStartWalletLogin("walletconnect");'));
  assert.ok(INDEX.includes('if (_fpDirectReturn || _billingReturn || window._chesEntered || window.connectedAccount) return;'));
  assert.equal(INDEX.split('if (_viaWalletConnect && window.emuWalletConnectDone) window.emuWalletConnectDone();').length - 1, 2, '入れたとき・失敗したとき');
  assert.ok(INDEX.includes('localStorage.removeItem("emuWcLogin");'), 'ログアウトで消す');
});
