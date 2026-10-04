/* みてみる（SchoolPark Mall）。

   2026-10-04、この画面を確認なしで丸ごと作り直してしまった。
   元のデザイン（ヒーロー・花びら・時計・カルーセル・セール・カート・
   紙吹雪・ショップの小窓）が本番から消えた。

   元に戻したうえで、[MIGRATE] の印が付いていた箇所だけサーバーへ繋いだ。
   ここで守るのは2つ。

     ・デザインの部分（CSSとHTMLの骨組み）が、元と1バイトも違わないこと
     ・見せかけの購入が残っていないこと（本当に注文が立ち、引換コードが出る）
*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '../..');
const FILE = 'frontend/public/schoolpark/east-shopping.html';
const NOW = fs.readFileSync(path.join(root, FILE), 'utf8');

/* 作り直す前の版。#147 の1つ前にある。 */
const BEFORE = execFileSync('git', ['show', 'd47dd16^:' + FILE], { cwd: root, encoding: 'utf8', maxBuffer: 8e6 });

const DESIGN_END = '<script>\n/* ═══════════════════════\n   DATA';

test('デザインの部分が、元と1バイトも違わない', () => {
  const a = BEFORE.slice(0, BEFORE.indexOf(DESIGN_END));
  const b = NOW.slice(0, NOW.indexOf(DESIGN_END));
  assert.ok(a.length > 30000, '元の版を取れていません');
  assert.equal(b, a, 'CSS か HTML の骨組みが変わっています');
});

test('元の見た目の部品が、全部そろっている', () => {
  ['hero-petal', 'carousel-card', 'sale-card', 'cart-footer', 'confetti-canvas',
   'shop-card', 'modal-overlay', 'stat-box', 'owner-gate', 'countdownTimer',
   'School Park Mall'].forEach(k => {
    assert.ok(NOW.indexOf(k) > 0, k + ' が消えています');
  });
});

test('元の描画の関数が、全部そろっている', () => {
  ['spawnPetals', 'startClock', 'startCountdown', 'renderShops', 'shopCardHTML',
   'productCardHTML', 'openShop', 'renderNewCarousel', 'renderSaleGrid',
   'addToCart', 'changeQty', 'removeFromCart', 'renderBag', 'launchPetals',
   'showToast', 'switchTab', 'filterCat'].forEach(fn => {
    assert.ok(new RegExp('function\\s+' + fn + '\\b').test(NOW), fn + ' が消えています');
  });
});

/* 見せかけが残っていないこと。 */

test('見せかけの購入が残っていない', () => {
  assert.equal(NOW.indexOf("console.log('[MIGRATE] Order:'"), -1, '購入が console.log のままです');
  assert.equal(NOW.indexOf("SHOPS.push({id:Date.now()"), -1, 'ショップが画面の中だけで増えます');
  assert.equal(NOW.indexOf('function saveSaleSetting'), -1, '中身の無いセール設定が残っています');
});

test('残っている [MIGRATE] は、カートの置き場所だけ', () => {
  /* カートは端末の中（localStorage）に置いたまま。買うときにサーバーへ
     注文を立てるので、売り買いそのものには関わらない。
     ここが増えていたら、ほかに繋ぎ忘れがある。 */
  const left = NOW.split('\n').filter(l => l.indexOf('[MIGRATE]') >= 0);
  left.forEach(l => assert.ok(l.indexOf('cart') >= 0 || l.indexOf('雛形') >= 0,
    '繋ぎ忘れがあります：' + l.trim()));
  assert.ok(left.length <= 3, '[MIGRATE] が増えています');
});

test('オーナー判定が、URLの ?owner=1 ではない', () => {
  /* 前は ?owner=1 を付ければ誰でも運営の画面を開けた。 */
  assert.equal(NOW.indexOf("get('owner') === '1'"), -1, 'URLで運営になれます');
  assert.ok(NOW.indexOf('const isOwner = () => !!(ME && ME.isOwner)') > 0, 'サーバーに聞いていません');
});

test('商品とショップは、サーバーから読む', () => {
  assert.ok(NOW.indexOf("call('/shops'") > 0, 'ショップを読んでいません');
  assert.ok(NOW.indexOf("call('/products'") > 0, '商品を読んでいません');
  assert.equal(NOW.indexOf('const SHOPS = [];'), -1, '空の決め打ちが残っています');
});

test('注文は、本当にサーバーへ送る', () => {
  const i = NOW.indexOf('async function startPay(method)');
  assert.ok(i > 0, '支払いの口がありません');
  const seg = NOW.slice(i, i + 1400);
  assert.ok(seg.indexOf("call('/orders', { method: 'POST'") > 0, '注文を立てていません');
});

test('引換コードを出す', () => {
  assert.ok(NOW.indexOf('function showOrders(') > 0, '結果を出す口がありません');
  assert.ok(NOW.indexOf('pickupCode') > 0, '引換コードを出していません');
});

test('払い方は5通りそろっている', () => {
  ['emuer_ledger', 'emuer_chain', 'jpyc', 'jpy_card', 'jpy_cash'].forEach(m => {
    assert.ok(NOW.indexOf(m) > 0, m + ' がありません');
  });
});

test('カートの全部で使える払い方だけ出す', () => {
  const i = NOW.indexOf('function payMethods()');
  assert.ok(i > 0, '払い方を絞るところがありません');
  const seg = NOW.slice(i, i + 300);
  assert.ok(seg.indexOf('rows.every(') > 0, '1つでも使えない商品があると、まとめて払えません');
});

/* イベントの当日に要るもの。 */

test('運営の画面から、商品を出せる', () => {
  assert.ok(NOW.indexOf('async function addProduct()') > 0, '商品を足せません');
  assert.ok(NOW.indexOf("call('/admin/products', { method: 'POST'") > 0, 'サーバーへ送っていません');
});

test('運営の画面から、ショップを出せる', () => {
  assert.ok(NOW.indexOf('async function addShop()') > 0, 'ショップを足せません');
  assert.ok(NOW.indexOf("call('/admin/shops', { method: 'POST'") > 0, 'サーバーへ送っていません');
  assert.equal(NOW.indexOf('SHOPS.push({id:Date.now()'), -1, '画面の中だけで足しています');
});

test('引換コードで探して、その場で渡せる', () => {
  assert.ok(NOW.indexOf('async function lookupCode()') > 0, 'コードで探せません');
  assert.ok(NOW.indexOf("/admin/orders?code=") > 0, 'サーバーに聞いていません');
  assert.ok(NOW.indexOf('async function fulfill(id)') > 0, '渡した記録が付けられません');
  assert.ok(NOW.indexOf('cash-paid') > 0, '会場の現金を受け取れません');
});

/* 開けること。 */

test('「準備中」で止めていない', () => {
  /* 止める作りは運営の4アドレス以外を全部はじく。
     開幕したので解除した。付いたままだとお客さんが1人も入れない。 */
  const guard = fs.readFileSync(path.join(root, 'frontend/public/maintenance-guard.js'), 'utf8');
  assert.ok(/var MAINTENANCE = false;/.test(guard), 'まだ止めています');
});

test('画面の側と、止める仕組みの側がそろっている', () => {
  /* 片方だけ開けると、押せるのに開いた先が「準備中」になる。 */
  const idx = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
  const i = idx.indexOf('const BRAND_MAINTENANCE = {');
  assert.ok(i > 0, 'ブランドの止め方が見つかりません');
  const seg = idx.slice(i, i + 700);
  assert.ok(/camellia:\s*false/.test(seg), 'Camellia が押せません');
  assert.ok(/emu:\s*false/.test(seg), 'Emu が止まっています');
});

test('ログインしていない人にも、売り場は見せる', () => {
  /* ショップと商品は証なしで読む。買うときだけログインが要る。 */
  assert.ok(NOW.indexOf("call('/shops', { auth: false })") > 0, 'ショップに証を求めています');
  assert.ok(NOW.indexOf("call('/products', { auth: false })") > 0, '商品に証を求めています');
});

test('買おうとしてログインしていなければ、そう伝える', () => {
  const i = NOW.indexOf('function purchase()');
  const seg = NOW.slice(i, i + 400);
  assert.ok(seg.indexOf('ログインが必要です') > 0, '黙って失敗します');
});
