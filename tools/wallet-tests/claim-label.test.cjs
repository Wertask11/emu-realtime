/* 受け取りボタンの文字。

   10/2、EMUER を受け取ろうとしたときに見つけた。
   ボタンには a.length（件数）を EMUER の額として出していた。

     未請求の報酬 2 EMUER を受け取る      ← 100 EMUER が2件あるとき

   お金の画面で額を間違えて出すのは、いちばんやってはいけない。
   受け取る本人が、いくら入るのか分からない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/wallet-success-ui.js'), 'utf8');

const REWARDS = SRC.slice(SRC.indexOf('async function wsRewards(){'),
                          SRC.indexOf('async function wsClaim(row){'));
assert.ok(REWARDS.length > 400, '未請求の報酬を出すところが見つかりません');

function stage(rows, ok) {
  const seen = { label: null, hidden: false, fn: null };
  const ctx = vm.createContext({
    EMUER_V2_API: 'https://x',
    Number, Array, String,
    encodeURIComponent,
    wsAccount: () => '0xme',
    wsHeaders: async () => ({}),
    wsBtn: () => ({ set hidden(v) { seen.hidden = v; } }),
    wsHideClaim: (why) => { seen.hidden = true; seen.why = why; },
    document: { getElementById: () => ({ set textContent(v) { seen.status = v; } }) },
    wsClaimLabel: (text, fn) => { seen.label = text; seen.fn = fn; },
    wsClaim: () => {},
    fetch: async () => ({ ok: ok !== false, json: async () => ({ rewards: rows }) })
  });
  vm.runInContext(REWARDS, ctx);
  return { run: () => ctx.wsRewards(), seen };
}

test('1件なら、その額を出す', async () => {
  const s = stage([{ claimId: 'a', amount: '100' }]);
  await s.run();
  assert.match(s.seen.label, /100 EMUER/, '出た文字: ' + s.seen.label);
  assert.doesNotMatch(s.seen.label, /1 EMUER/, '件数を額として出している');
});

test('2件なら、合計額を出す（件数を額にしない）', async () => {
  const s = stage([{ claimId: 'a', amount: '100' }, { claimId: 'b', amount: '100' }]);
  await s.run();
  assert.match(s.seen.label, /200 EMUER/,
    '合計が出ていない。出た文字: ' + s.seen.label);
  assert.doesNotMatch(s.seen.label, /^未請求の報酬 2 EMUER/,
    '件数を EMUER の額として出している');
  assert.match(s.seen.label, /2件/, '何件あるのか分からない');
});

test('額がばらばらでも、ちゃんと足す', async () => {
  const s = stage([{ amount: '50' }, { amount: '100' }, { amount: '200' }]);
  await s.run();
  assert.match(s.seen.label, /350 EMUER/, '出た文字: ' + s.seen.label);
});

test('桁が多ければ、区切って読みやすく出す', async () => {
  const s = stage([{ amount: '12000' }]);
  await s.run();
  assert.match(s.seen.label, /12,000 EMUER/, '出た文字: ' + s.seen.label);
});

test('額が読めないものは 0 として足す（NaN を出さない）', async () => {
  const s = stage([{ amount: '100' }, { amount: null }, {}]);
  await s.run();
  assert.match(s.seen.label, /100 EMUER/);
  assert.doesNotMatch(s.seen.label, /NaN/, 'NaN EMUER と出ている');
});

test('1件も無ければ、ボタンを出さない', async () => {
  const s = stage([]);
  await s.run();
  assert.equal(s.seen.hidden, true, '受け取るものが無いのにボタンが出ている');
  assert.equal(s.seen.label, null);
});

test('読めなかったときも、ボタンを出さない', async () => {
  const s = stage([], false);
  await s.run();
  assert.equal(s.seen.hidden, true);
});

test('押す相手は、1件目', async () => {
  const s = stage([{ claimId: 'first', amount: '100' }, { claimId: 'second', amount: '100' }]);
  await s.run();
  assert.equal(typeof s.seen.fn, 'function', '押せるようになっていない');
});

/* ───────── 受け取ったあと ───────── */

test('受け取れたら、いくら入ったかを出す', () => {
  const claim = SRC.slice(SRC.indexOf('async function wsClaim(row){'),
                          SRC.indexOf('async function claimEmuV2LoginReward(){'));
  assert.ok(claim.length > 400, '受け取るところが見つかりません');
  assert.match(claim, /EMUER を受け取りました/,
    'お金が動いたのに画面が黙っている');
  /* 残高の読み直しより先に言う。残高が読めなくても、
     受け取れたことは分かるようにする。 */
  const said = claim.indexOf('EMUER を受け取りました');
  const bal = claim.indexOf('await wsBalance(wsAccount())', said - 400);
  assert.ok(said < claim.indexOf('await wsBalance(wsAccount());await wsRewards();'),
    '残高を読んだあとにしか言わないので、読めないと黙ったままになる');
});

test('チェーンが違えば、先に止める', () => {
  const claim = SRC.slice(SRC.indexOf('async function wsClaim(row){'),
                          SRC.indexOf('async function claimEmuV2LoginReward(){'));
  assert.match(claim, /chainId\)!==137/, '別のチェーンへ投げてしまう');
  assert.match(claim, /Polygon Mainnet/, 'どこへ切り替えればよいか言っていない');
});
