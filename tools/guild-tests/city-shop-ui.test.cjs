/* City をわかりやすくした画面（10/28）。
   入口を「公式ショップ／街のお店／3Dの街」の3つにし、公式ショップの商品をトップに並べ、
   街のお店に 3D の展示店（THE FIELD STORE）と出店の案内を出す。
   ここでは、その約束が守られているかを本物の dao.html と City で確かめる。
   みてみる（/api/mitemiru）は試験用の返事。本番のアカウントやお金は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startFixture } = require('./city-3d-fixture.cjs');

const SHOPS = { ok: true, shops: [
  { id: 'schoolpark-official', name: 'SchoolPark公式仮想店舗', emoji: '🏫', storeType: 'schoolpark_virtual', description: '公式' },
  { id: 'cafe-nagi', name: 'カフェ 凪', emoji: '☕', storeType: 'real_partner', description: '本と珈琲', address: '東京都渋谷区 1-2-3', paymentGuide: 'レジで円・JPYC' },
  { id: 'old-shop', name: '昔のお店', storeType: 'legacy' }] };
const PRODUCTS = [
  { id: 'sticker', shopId: 'schoolpark-official', storeType: 'schoolpark_virtual', name: '冷蔵庫くんステッカー', prices: { EMUER: 1 }, methods: ['emuer_ledger', 'emuer_chain'], remaining: null, fulfillment: 'その場でダウンロード' },
  { id: 'note', shopId: 'schoolpark-official', storeType: 'schoolpark_virtual', name: '探究ノート', prices: { EMUER: 30 }, methods: ['emuer_ledger', 'emuer_chain'], remaining: 12 },
  { id: 'coffee', shopId: 'cafe-nagi', storeType: 'real_partner', name: '探究ブレンド', prices: { JPY: 600, JPYC: 600 }, methods: [], remaining: null }];
const ME = { ok: true, isOwner: false, emuer: { ok: false, error: 'PLAN_REQUIRED', unconverted: '42' } };
const ORDERS = { ok: true, orders: [
  { id: 'o1', productName: '探究ノート', amount: 30, currency: 'EMUER', status: 'paid', pickupCode: 'K7Q2MX', createdAt: Date.parse('2026-10-27T10:00:00Z') },
  { id: 'o2', productName: '冷蔵庫くんステッカー', amount: 1, currency: 'EMUER', status: 'fulfilled', pickupCode: 'P3RT8A', createdAt: Date.parse('2026-10-20T10:00:00Z') }] };

let fixture, browser;
before(async () => {
  fixture = await startFixture();
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); await fixture?.close(); });

/* MetaMask と ethers の代わり。親の画面（Emu）にだけ置く。 */
function walletMock({ account, balance = '1852', reject = false, fail = '' }) {
  return `if (window.top === window) {
    window.__chain = [];
    window.emuerV2ConfigOnce = async () => ({ enabled: true, chainId: 137, contract: '0x9c102cC3016C70767082b60196565878D9314864' });
    window.ethereum = { request: async ({ method, params }) => { __chain.push(method); return method === 'eth_requestAccounts' ? ['${account}'] : method === 'eth_chainId' ? '0x89' : null; } };
    window.ethers = {
      utils: { formatUnits: v => String(v) },
      providers: { Web3Provider: function () { this.getNetwork = async () => ({ chainId: 137 }); this.getSigner = () => ({}); } },
      Contract: function (address, abi) {
        (abi || []).forEach(f => __chain.push('abi:' + f));
        this.balanceOf = async a => { __chain.push('balanceOf:' + a); return '${balance}'; };
        this.exchange = async (...args) => { __chain.push('exchange:' + args[0]);
          if (${reject}) throw Object.assign(new Error('user rejected transaction'), { code: 'ACTION_REJECTED' });
          if ('${fail}') throw Object.assign(new Error('${fail}'), { code: '${fail}' });
          return { hash: '0xtx', wait: async () => ({}) }; };
      }
    };
  }`;
}
async function open(width = 390, { products = PRODUCTS, shopsFail = false, me = ME, wallet = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 700 });
  if (wallet) await context.addInitScript(walletMock(wallet));
  const calls = [], errors = [], posts = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'emu-realtime.onrender.com') {
      calls.push(url.pathname);
      const json = body => route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
      if (url.pathname === '/api/mitemiru/shops') return shopsFail ? route.fulfill({ status: 503, json: { error: 'X' }, headers: { 'Access-Control-Allow-Origin': '*' } }) : json(SHOPS);
      if (url.pathname === '/api/mitemiru/products') { const id = url.searchParams.get('shopId'); return json({ ok: true, products: products.filter(p => !id || p.shopId === id) }); }
      if (url.pathname === '/api/mitemiru/me') return json(me);
      if (url.pathname === '/api/mitemiru/orders' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); posts.push(body);
        return json(body.method === 'emuer_chain'
          ? { ok: true, order: { id: 'c1', status: 'pending_payment' }, exchange: { contract: '0xc', orderId: '0xorder', productId: '0xp', price: '30', deadline: 1, authorization: '0xsig' } }
          : { ok: true, order: { id: 'l1', status: 'paid' } });
      }
      if (/^\/api\/mitemiru\/orders\/c1\/(confirm|cancel)$/.test(url.pathname)) { posts.push({ path: url.pathname }); return json({ ok: true }); }
      if (url.pathname === '/api/mitemiru/orders') return json(ORDERS);
      const r = await fetch(fixture.base + url.pathname, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      return route.fulfill({ status: r.status, body: await r.text(), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.hostname === 'emu-for-schoolpark.vercel.app') { calls.push(url.href); return route.fulfill({ body: '<!doctype html><title>Emu</title>', contentType: 'text/html' }); }
    if (url.origin !== fixture.base) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(fixture.base + '/test/parent');
  const frame = page.frames().find(f => f.url().endsWith('/schoolpark/dao.html'));
  await frame.waitForFunction(() => window.app?.state.me.name === 'テスト用Passport');
  if (width >= 700 && !(await frame.getByText('08', { exact: true }).filter({ visible: true }).count())) await frame.getByTitle('サイドバーを開く', { exact: true }).click();
  await frame.getByText('08', { exact: true }).filter({ visible: true }).click();
  await frame.locator('.city-doors').waitFor();
  const text = () => frame.locator('#sp-city').innerText();
  return { page, frame, calls, errors, posts, text, chain: () => page.evaluate(() => window.__chain || []), close: () => context.close() };
}

test('トップは3つの入口と、公式ショップの商品。残高（/me）は読まない', async () => {
  const f = await open();
  try {
    const doors = await f.frame.locator('.city-door b').allInnerTexts();
    assert.deepEqual(doors, ['公式ショップ', '街のお店', '3Dの街を歩く']);
    await f.frame.locator('.city-product').first().waitFor();
    assert.deepEqual(await f.frame.locator('.city-product b').allInnerTexts(), ['冷蔵庫くんステッカー', '探究ノート'], '公式ショップの商品だけを並べる');
    assert.equal(f.calls.some(p => p.endsWith('/me')), false, 'トップでは自分の記録を読まない');
    assert.match(await f.text(), /出店の相談をする/);
    assert.equal(await f.frame.getByRole('button', { name: '3Dの街へ入る ↗', exact: true }).count(), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('商品が無ければ「これから並びます」。読めなくてもページ全体の失敗にはしない', async () => {
  let f = await open(390, { products: [] });
  try {
    await f.frame.getByText('商品はこれから並びます。新しい商品が入ったら、ここに出ます。').waitFor();
  } finally { await f.close(); }
  f = await open(390, { shopsFail: true });
  try {
    await f.frame.getByText(/商品を読み込めませんでした/).waitFor();
    assert.equal(await f.frame.locator('[role="alert"]').count(), 0, 'トップの商品が読めないだけで警告を出さない');
  } finally { await f.close(); }
});

test('トップの商品から開いて、交換できない理由を分かる言葉で出す', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-product[data-value="note"]').click();
    await f.frame.locator('.city-wallet').waitFor();
    const t = await f.text();
    assert.match(t, /ウォレットに移す前のEMUER\s*42 EMUER/);
    assert.match(t, /Light・Plus・Pro プランで使えます/);
    assert.equal(await f.frame.getByRole('button', { name: 'ウォレットのEMUERで交換する', exact: true }).isDisabled(), true);
    assert.equal(await f.frame.getByRole('button', { name: 'ウォレットに移す前のEMUERで交換する', exact: true }).isDisabled(), true);
    assert.doesNotMatch(t, /PLAN_REQUIRED|未変換|既存のEMUER注文処理/);
  } finally { await f.close(); }
});

test('公式ショップ：残高、商品、使い方', async () => {
  const f = await open(1440);
  try {
    await f.frame.locator('.city-door[data-value="commerce"]').click();
    await f.frame.locator('.city-wallet').waitFor();
    const t = await f.text();
    assert.match(t, /42 EMUER/);
    assert.match(t, /EMUERをためる[\s\S]*商品と交換する[\s\S]*受け取る/);
    assert.equal(await f.frame.locator('.city-section .city-card').count(), 2);
    assert.doesNotMatch(t, /みてみるデータ|Camellia|SchoolPark公式仮想店舗/);
  } finally { await f.close(); }
});

test('街のお店：提携店と 3D の展示店と出店の案内。昔の店（legacy）は出さない', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-door[data-value="partners"]').click();
    await f.frame.getByText('THE FIELD STORE').waitFor();
    const t = await f.text();
    assert.match(t, /カフェ 凪/); assert.match(t, /東京都渋谷区 1-2-3/);
    assert.doesNotMatch(t, /昔のお店/);
    assert.match(t, /EMUERは使えません/);
    assert.equal(await f.frame.locator('[data-action="walk"][data-value="field-store"]').count(), 1, '3Dで入る');
    assert.equal(await f.frame.locator('.city-join [data-action="contact"]').count(), 1);
  } finally { await f.close(); }
});

test('交換履歴の状態は日本語で出し、引換コードを見せる', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-nav [data-value="orders"]').click();
    await f.frame.getByText('K7Q2MX').waitFor();
    const statuses = await f.frame.locator('.city-order-status').allInnerTexts();
    assert.deepEqual(statuses, ['受け取り待ち · 引換コードを受付で見せてください', '受け取り済み']);
    assert.doesNotMatch(await f.text(), /\bpaid\b|\bfulfilled\b|既存みてみる注文|Passport ID/);
  } finally { await f.close(); }
});

test('出店の相談は、Emu の画面が無ければ同じフォームを別のタブで開く', async () => {
  const f = await open();
  try {
    const popup = f.page.context().waitForEvent('page');
    await f.frame.locator('.city-join [data-action="contact"]').click();
    const opened = await popup;
    await opened.waitForLoadState();
    const asked = f.calls.find(u => u.startsWith('https://emu-for-schoolpark.vercel.app/'));
    assert.ok(asked, 'お問い合わせのフォームを開いていない');
    assert.equal(new URL(asked).searchParams.get('contact'), 'general');
    await opened.close();
  } finally { await f.close(); }
});

/* 10/28：全部ウォレットに受け取った人は、City の「使えるEMUER」が 0 に見えた。
   Emu のウォレットは受け取り済み（ウォレット）の数字、City は受け取る前の数字だけを出していたため。 */
const WALLET = '0xdcc6800000000000000000000000000000006edf';
const ME_OK = { ok: true, isOwner: false, wallet: WALLET, emuer: { ok: true, error: null, unconverted: '0' } };

test('公式ショップは、ウォレットのEMUERと、移す前のEMUERの両方を出す', async () => {
  const f = await open(1440, { me: ME_OK, wallet: { account: WALLET } });
  try {
    await f.frame.locator('.city-door[data-value="commerce"]').click();
    await f.frame.getByText('1,852 EMUER').waitFor();
    assert.match(await f.text(), /ウォレットのEMUER\s*1,852 EMUER[\s\S]*ウォレットに移す前のEMUER\s*0 EMUER/);
    assert.ok((await f.chain()).includes('balanceOf:' + WALLET), '連携済みのウォレットの残高を読む');
    assert.equal((await f.chain()).includes('eth_requestAccounts'), false, '残高を読むだけで MetaMask の許可は求めない');
    assert.equal(await f.frame.locator('[data-action="walk"][data-value="schoolpark-official"]').count(), 1, '公式ショップも3Dで入れる');
  } finally { await f.close(); }
});

test('ウォレットのEMUERで交換：注文 → MetaMask → 確かめる', async () => {
  const f = await open(390, { me: ME_OK, wallet: { account: WALLET } });
  try {
    await f.frame.locator('.city-product[data-value="note"]').click();
    const pay = f.frame.getByRole('button', { name: 'ウォレットのEMUERで交換する', exact: true });
    await f.frame.getByText('1,852 EMUER').waitFor();
    assert.equal(await f.frame.getByRole('button', { name: 'ウォレットに移す前のEMUERで交換する', exact: true }).isDisabled(), true, '移す前のEMUERは 0');
    await pay.click();
    await f.frame.getByText('ウォレットのEMUERで交換しました。引換コードは下の交換履歴にあります。').waitFor();
    assert.equal(f.posts[0].method, 'emuer_chain'); assert.equal(f.posts[0].productId, 'note');
    assert.equal('amount' in f.posts[0] || 'price' in f.posts[0], false, '金額は画面から送らない');
    assert.ok((await f.chain()).includes('exchange:0xorder'));
    /* 呼ぶ関数は、本当にコントラクトにあるもの（前は payExchange という無い名前で呼んでいて、必ず失敗していた） */
    const abi = (await f.chain()).filter(c => c.startsWith('abi:function exchange('));
    assert.deepEqual(abi, ['abi:function exchange(bytes32,bytes32,uint256,uint256,bytes)']);
    const sol = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../contracts-v2/src/EMUERv2.sol'), 'utf8');
    assert.match(sol, /function exchange\(\s*bytes32 orderId, bytes32 productId, uint256 price, uint256 deadline,\s*bytes calldata authorization\s*\)/);
    assert.deepEqual(f.posts.slice(1).map(p => p.path), ['/api/mitemiru/orders/c1/confirm']);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('MetaMask で断ったら注文を取り消す。別のアカウントなら払わない', async () => {
  let f = await open(390, { me: ME_OK, wallet: { account: WALLET, reject: true } });
  try {
    await f.frame.locator('.city-product[data-value="note"]').click();
    await f.frame.getByText('1,852 EMUER').waitFor();
    await f.frame.getByRole('button', { name: 'ウォレットのEMUERで交換する', exact: true }).click();
    await f.frame.getByText('支払いを取り消しました。EMUERは使われていません。').waitFor();
    assert.deepEqual(f.posts.slice(1).map(p => p.path), ['/api/mitemiru/orders/c1/cancel']);
  } finally { await f.close(); }
  f = await open(390, { me: ME_OK, wallet: { account: '0x195f0000000000000000000000000000000042ac' } });
  try {
    await f.frame.locator('.city-product[data-value="note"]').click();
    await f.frame.getByText('1,852 EMUER').waitFor();
    await f.frame.getByRole('button', { name: 'ウォレットのEMUERで交換する', exact: true }).click();
    await f.frame.getByText(/いま MetaMask で開いているアカウントが違います/).waitFor();
    assert.equal((await f.chain()).some(c => c.startsWith('exchange:')), false);
    assert.deepEqual(f.posts.slice(1).map(p => p.path), ['/api/mitemiru/orders/c1/cancel'], '払っていない注文は取り消して在庫を戻す');
  } finally { await f.close(); }
});

test('送る前に止まった支払い（ガス代が足りない・通らない）は、理由を出して注文を取り消す。「確認してください」は残さない', async () => {
  for (const [fail, text] of [
    ['INSUFFICIENT_FUNDS', /POL（Polygon のガス代）が足りません/],
    ['UNPREDICTABLE_GAS_LIMIT', /この支払いは通らないため、送りませんでした/]
  ]) {
    const f = await open(390, { me: ME_OK, wallet: { account: WALLET, fail } });
    try {
      await f.frame.locator('.city-product[data-value="note"]').click();
      await f.frame.getByText('1,852 EMUER').waitFor();
      await f.frame.getByRole('button', { name: 'ウォレットのEMUERで交換する', exact: true }).click();
      await f.frame.getByText(text).waitFor();
      assert.deepEqual(f.posts.slice(1).map(p => p.path), ['/api/mitemiru/orders/c1/cancel'], fail);
      assert.equal(await f.frame.getByText('支払いを確認してください。').count(), 0, '止まったあとに「確認してください」を残さない');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('City の中に「SchoolParkの広場へ」と「08 CITY / 3D EXPLORER」は出さない', async () => {
  const f = await open(1440);
  try {
    const t = await f.text();
    assert.doesNotMatch(t, /SchoolParkの広場へ|3D EXPLORER/);
  } finally { await f.close(); }
});
