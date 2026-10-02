/* 「使えるEMUER」が、場所によって違う数字になっていた。

   10/2 の画面：
     今日のEmu「現在の報酬」     0 EMUER
     左タブの下                  0
     ウォレットの札「使えるEMUER」150（8）

   今日のEmu は updateEmuTodayHome を包んであるので v2 の残高
   （0x9c102cC…）に書き替わる。ウォレットの札（loadEmuWalletCard）は
   包んでいなかったので、旧コントラクト（0x4418d5…）＋サーバー台帳の
   数字がそのまま残っていた。同じ名前の欄に、別の数字。

   お金の画面で数字が二通りあるのは、どちらを信じてよいか分からない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(root, 'frontend/public/emuer-v2-public-copy.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');

/* 置き場所。index.html の札が動いたら、旧の行はどこにも出ない。 */
test('旧の行を入れる場所が、index.html にある', () => {
  assert.ok(INDEX.indexOf('eth-wallet-balance') > 0, '残高の囲みがありません');
  assert.ok(INDEX.indexOf('id="emuWalletPendingLine"') > 0, '差し込む目印がありません');
  assert.ok(SRC.indexOf('#emuValueProfile .eth-wallet-balance') > 0,
    '旧の行の置き場所が、残高の囲みを指していません');
});

test('ウォレットの札も、今日のEmuと同じように包む', () => {
  assert.ok(SRC.indexOf('function wrapWalletCard()') > 0, '札を包んでいません');
  const start = SRC.indexOf('async function start()');
  assert.ok(start > 0);
  const body = SRC.slice(start, start + 600);
  assert.ok(body.indexOf('wrapLegacyRender();') >= 0 && body.indexOf('wrapWalletCard();') >= 0,
    '始まりで両方を包んでいません');
  const load = SRC.slice(SRC.indexOf('window.addEventListener("load"'));
  assert.ok(load.indexOf('wrapWalletCard()') >= 0, '包み直しに札が入っていません');
});

test('二度包まない', () => {
  const i = SRC.indexOf('function wrapWalletCard()');
  const seg = SRC.slice(i, i + 500);
  assert.ok(seg.indexOf('__emuerV2PublicCopy') >= 0, '印がありません');
});

/* 実際に動かす。 */
function stage(opts) {
  const o = opts || {};
  const SEG = SRC.slice(SRC.indexOf('async function refreshBalance()'),
                        SRC.indexOf('async function refreshLoginButton()'));
  const seen = { texts: {}, inserted: [], appended: [], legacy: null, display: {} };
  const nodes = {};
  const make = (id) => {
    if (nodes[id]) return nodes[id];
    nodes[id] = { id, textContent: id === 'emuWalletBalance' ? (o.legacyText || '150（8）') : '',
      className: '', style: {}, parentNode: null };
    return nodes[id];
  };
  const box = {
    insertBefore: (n, b) => { seen.inserted.push([n.id, b && b.id]); n.parentNode = box; },
    appendChild: (n) => { seen.appended.push(n.id); n.parentNode = box; }
  };
  make('emuWalletPendingLine').parentNode = box;
  const ctx = vm.createContext({
    Number, String, Array, Boolean, Math,
    /* ABI は切り出した外にある。無いと new Contract が転んで、
       「読めなかった」側の道に落ちる。 */
    ABI: [],
    config: o.config === undefined ? { contract: '0xnew' } : o.config,
    account: () => o.account === undefined ? '0xme' : o.account,
    byId: (id) => (id === 'emuLegacyBalanceLine' && !seen.legacy) ? null : (id === 'emuLegacyBalanceLine' ? seen.legacy : make(id)),
    setText: (id, v) => { seen.texts[id] = v; make(id).textContent = v; },
    document: {
      querySelector: (sel) => sel === '#emuValueProfile .eth-wallet-balance' ? (o.noBox ? null : box) : null,
      createElement: () => { const n = { id: '', className: '', style: {}, textContent: '', parentNode: null };
        seen.legacy = n; return n; }
    },
    window: { ethereum: o.wallet === false ? null : {}, ethers: o.wallet === false ? null : {},
      loadEmuWalletCard: o.card === null ? null : (o.card || (async () => { seen.ran = true; return 'done'; })) },
    ethers: { providers: { Web3Provider: function () {} },
      Contract: function () { return { balanceOf: async () => { if (o.chainFails) throw new Error('rpc'); return 0n; } }; },
      utils: { formatUnits: () => '0' } }
  });
  ctx.window.ethers = o.wallet === false ? null : ctx.ethers;
  vm.runInContext(SEG, ctx);
  return { ctx, seen, nodes };
}

test('ウォレットがあれば、札の数字は v2 の残高になる', async () => {
  const s = stage({});
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(s.seen.texts.emuWalletBalance, '0', 'v2 の残高で上書きしていません');
  assert.equal(s.seen.texts.emuTodayBalance, '0', '今日のEmu とそろっていません');
});

test('上書きした旧の数字は、別の行に残す', async () => {
  const s = stage({ legacyText: '150（8）' });
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.ok(s.seen.legacy, '旧の行が作られていません');
  assert.ok(String(s.seen.legacy.textContent).indexOf('150（8）') >= 0,
    '旧の数字が消えています：' + s.seen.legacy.textContent);
  assert.ok(String(s.seen.legacy.textContent).indexOf('使えるEMUERとは別') >= 0,
    '別の記録だと言っていません');
  assert.equal(s.seen.legacy.id, 'emuLegacyBalanceLine');
});

test('旧の行は、使えるEMUERのすぐ下に入れる', async () => {
  const s = stage({});
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.deepEqual(Array.from(s.seen.inserted[0] || []), ['emuLegacyBalanceLine', 'emuWalletPendingLine']);
});

test('ウォレットが無ければ、上書きしないし、旧の行も出さない', async () => {
  const s = stage({ wallet: false });
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(s.seen.texts.emuWalletBalance, undefined, '上書きしています');
  assert.equal(s.seen.legacy, null, '同じ数字が二度出ます');
});

test('残高を読めなければ、上書きしないし、旧の行も出さない', async () => {
  const s = stage({ chainFails: true });
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(s.seen.texts.emuWalletBalance, undefined, '読めていないのに上書きしています');
  assert.equal(s.seen.legacy, null, '同じ数字が二度出ます');
});

test('v2 が止まっていれば、何も触らない', async () => {
  const s = stage({ config: null });
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(s.seen.texts.emuWalletBalance, undefined);
  assert.equal(s.seen.legacy, null);
});

test('元の札の描画は、そのまま通す', async () => {
  let ran = 0;
  const s = stage({ card: async function () { ran += 1; return 'original'; } });
  s.ctx.wrapWalletCard();
  const out = await s.ctx.window.loadEmuWalletCard();
  assert.equal(ran, 1, '元の描画を呼んでいません');
  assert.equal(out, 'original', '返りを変えています');
});

test('札が無ければ、包まない', () => {
  const s = stage({ card: null });
  s.ctx.wrapWalletCard();
  assert.equal(s.ctx.window.loadEmuWalletCard, null);
});

test('二度包んでも、描画は一度', async () => {
  let ran = 0;
  const s = stage({ card: async function () { ran += 1; } });
  s.ctx.wrapWalletCard();
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(ran, 1, '包みが二重になっています');
});

test('置き場所が無ければ、黙って何もしない', async () => {
  const s = stage({ noBox: true });
  s.ctx.wrapWalletCard();
  await s.ctx.window.loadEmuWalletCard();
  assert.equal(s.seen.texts.emuWalletBalance, '0', '上書きは続けます');
  assert.equal(s.seen.legacy, null);
});
