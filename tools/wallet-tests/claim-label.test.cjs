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

/* wsDone の宣言から取る。wsRewards がそれを使うので、const は
   VM の場では外から見えない以上、同じ塊ごと動かす。 */
const REWARDS = SRC.slice(SRC.indexOf('const wsDone=new Set();'),
                          SRC.indexOf('async function wsClaim(row){'));
assert.ok(REWARDS.length > 400, '未請求の報酬を出すところが見つかりません');

function stage(rows, ok) {
  const seen = { label: null, hidden: false, fn: null };
  const ctx = vm.createContext({
    EMUER_V2_API: 'https://x',
    Number, Array, String, Set,
    wsCanSign: () => true, wsOpenShop: () => {},
    encodeURIComponent,
    wsAccount: () => '0xme',
    wsHeaders: async () => ({}),
    wsBtn: () => ({ set hidden(v) { seen.hidden = v; } }),
    wsHideClaim: (why) => { seen.hidden = true; seen.why = why; },
    document: { getElementById: () => ({ set textContent(v) { seen.status = v; } }) },
    wsClaimLabel: (text, fn) => { seen.label = text; seen.fn = fn; },
    wsClaim: (row) => { seen.claimed = { one: row }; },
    wsClaimAll: (rows) => { seen.claimed = { all: rows }; },
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

test('1件なら、その1件を受け取る', async () => {
  const s = stage([{ claimId: 'only', amount: '100' }]);
  await s.run();
  assert.equal(typeof s.seen.fn, 'function', '押せるようになっていない');
  s.seen.fn();
  assert.equal(s.seen.claimed.one.claimId, 'only');
});

/* 1件ずつだと、そのたびに MetaMask の承認とガス代がかかっていた。 */
test('2件以上なら、まとめて1回で受け取る', async () => {
  const s = stage([{ claimId: 'first', amount: '100' }, { claimId: 'second', amount: '50' }]);
  await s.run();
  assert.match(s.seen.label, /150 EMUER（2件）をまとめて受け取る/, '出た文字: ' + s.seen.label);
  assert.doesNotMatch(s.seen.label, /うち1件/);
  s.seen.fn();
  assert.deepEqual(s.seen.claimed.all.map(x => x.claimId), ['first', 'second']);
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

/* ───────── まとめて受け取る ───────── */

const ALL = SRC.slice(SRC.indexOf('async function wsClaimAll(rows){'),
                      SRC.indexOf('async function claimEmuV2LoginReward(){'));
assert.ok(ALL.length > 400, 'まとめて受け取るところが見つかりません');

function stageAll(reply, { canSign = true } = {}) {
  const seen = { posted: null, sent: null, status: null, done: new Set(), alerts: [], reloaded: 0 };
  const ctx = vm.createContext({
    EMUER_V2_API: 'https://x', Number, String, JSON, wsDone: seen.done,
    wsCanSign: () => canSign, WS_NO_WALLET: 'MetaMask が要ります',
    wsAccount: () => '0xme', wsHeaders: async () => ({}),
    wsClaimLabel: () => {}, wsBalance: async () => {}, wsRewards: async () => { seen.reloaded++; },
    window: {}, alert: (m) => seen.alerts.push(m),
    emuerV2Config: { contract: '0xc' }, EMUER_V2_ABI: [],
    document: { getElementById: () => ({ set textContent(v) { seen.status = v; } }) },
    fetch: async (url, init) => { seen.posted = { url, body: JSON.parse(init.body) }; return { ok: reply.ok !== false, json: async () => reply.body }; },
    ethers: {
      providers: { Web3Provider: function () { return { getNetwork: async () => ({ chainId: 137 }), getSigner: () => ({}) }; } },
      Contract: function () { return { claimReward: async (...a) => { seen.sent = a; return { wait: async () => {} }; } }; }
    }
  });
  vm.runInContext(ALL, ctx);
  return { run: (rows) => ctx.wsClaimAll(rows), seen };
}

test('まとめた札を1回だけ送り、元の報酬もまとめた札も一覧から外す', async () => {
  const s = stageAll({ body: { ok: true, count: 2, amount: '150',
    reward: { claimId: '0xbundle', totalAmount: '150000000000000000000', deadline: 9, authorization: '0xsig' } } });
  await s.run([{ claimId: 'first' }, { claimId: 'second' }]);
  assert.equal(s.seen.posted.url, 'https://x/rewards/bundle');
  assert.deepEqual(s.seen.posted.body, { address: '0xme' });
  assert.deepEqual(s.seen.sent, ['0xbundle', '150000000000000000000', 9, '0xsig']);
  assert.equal(s.seen.status, '150 EMUER を受け取りました（2件）');
  assert.deepEqual([...s.seen.done].sort(), ['0xbundle', 'first', 'second']);
  assert.equal(s.seen.alerts.length, 0);
});

test('まとめられなかったときは、何も送らずに知らせて一覧を読み直す', async () => {
  const s = stageAll({ ok: false, body: { error: 'NOTHING_TO_BUNDLE' } });
  await s.run([{ claimId: 'first' }, { claimId: 'second' }]);
  assert.equal(s.seen.sent, null, '札が無いのに送っている');
  assert.equal(s.seen.alerts.length, 1);
  assert.equal(s.seen.reloaded, 1);
  assert.equal(s.seen.done.size, 0);
});

test('MetaMask が無いところでは、まとめる前に止める（まとめると、その札は署名の期限まで使えない）', async () => {
  const s = stageAll({ body: {} }, { canSign: false });
  await s.run([{ claimId: 'first' }, { claimId: 'second' }]);
  assert.equal(s.seen.posted, null, 'サーバーに頼まない');
  assert.deepEqual(s.seen.alerts, ['MetaMask が要ります']);
});
