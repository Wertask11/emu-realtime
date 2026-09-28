/* 証明書NFT・限定星の「受け取る」ボタンの入口を確かめる。

   ここが壊れると、連携済みの人が永久に受け取れない。
   実際に壊れていた：画面へ返る link には subject が無いのに、
   入口は subject だけを見ていたため、必ず「先に連携してください」に
   なっていた。同じ間違いを二度としないための試験。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');

/* 入口の3つ（取り出し・限定星・証明書）だけを切り出す。 */
const start = html.indexOf('/* パスポートに連携済みのウォレットを取り出す。');
const end = html.indexOf('/* ページをめくる。', start);
assert.ok(start > 0 && end > start, '受け取りボタンの関数が見つかりません');
const src = html.slice(start, end);

/* サーバーが画面へ返す形そのもの（backend/identity.js の publicView）。
   ウォレットの宛先は address に入り、subject は入らない。 */
function serverView(addr) {
  return { kind: 'wallet', provider: 'wallet', label: '連携ウォレット',
    address: addr, linkedAt: 1 };
}
/* Firestore の生の記録の形。宛先は subject に入る。 */
function rawRecord(addr) {
  return { linkId: 'wallet:' + addr, kind: 'wallet', provider: 'wallet',
    label: '連携ウォレット', subject: addr, linkedAt: 1 };
}

const WALLET = '0xdcc6000000000000000000000000000000001edf';

/* vm の中で作った配列は別realmのもので、deepEqual が素通りしない。
   中身だけを取り出して、こちら側の配列にして比べる。 */
function linked(ctx, p) { return Array.from(ctx._spLinkedWallets(p)); }

function setup(passport, fetchImpl) {
  const calls = [];
  const alerts = [];
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    alert: (m) => alerts.push(m),
    spPassportLoad: async () => passport,
    emuAuthHeaders: async () => ({}),
    fetch: fetchImpl || (async (url, opt) => {
      calls.push({ url, opt });
      return { ok: true, json: async () => ({ ok: true, tokenId: '7', txHash: '0xabc' }) };
    }),
    encodeURIComponent,
  });
  ctx.window = ctx;
  vm.runInContext(src, ctx);
  return { ctx, calls, alerts };
}

function fakeButton() {
  return { disabled: false, textContent: '証明書NFTを受け取る', isConnected: true };
}

/* ───────── 取り出しそのもの ───────── */

test('画面から返る形（address）でウォレットを取り出せる', () => {
  const { ctx } = setup({ spLive: true, spLinks: [serverView(WALLET)] });
  assert.deepEqual(linked(ctx, { spLinks: [serverView(WALLET)] }), [WALLET]);
});

test('生の記録の形（subject）でも取り出せる', () => {
  const { ctx } = setup({ spLive: true, spLinks: [] });
  assert.deepEqual(linked(ctx, { spLinks: [rawRecord(WALLET)] }), [WALLET]);
});

test('大文字で来ても小文字に揃える', () => {
  const { ctx } = setup({ spLive: true, spLinks: [] });
  assert.deepEqual(
    linked(ctx, { spLinks: [serverView(WALLET.toUpperCase().replace('0X', '0x'))] }),
    [WALLET]);
});

test('LINE・Google の連携はウォレットとして数えない', () => {
  const { ctx } = setup({ spLive: true, spLinks: [] });
  assert.deepEqual(linked(ctx, { spLinks: [
    { kind: 'fb', provider: 'line', label: 'LINE', address: '' },
    { kind: 'fb', provider: 'google', label: 'Google', address: '' },
  ] }), []);
});

test('アドレスの形をしていないものは捨てる', () => {
  const { ctx } = setup({ spLive: true, spLinks: [] });
  assert.deepEqual(linked(ctx, { spLinks: [
    { kind: 'wallet', address: '' },
    { kind: 'wallet', address: '0x123' },
    { kind: 'wallet', address: WALLET },
  ] }), [WALLET]);
});

test('spLinks が無くても落ちない', () => {
  const { ctx } = setup({ spLive: true, spLinks: [] });
  assert.deepEqual(linked(ctx, null), []);
  assert.deepEqual(linked(ctx, {}), []);
});

/* ───────── 証明書NFT ───────── */

test('連携済み（サーバーの形）なら証明書の受け取りが通る', async () => {
  const { ctx, calls, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] });
  const b = fakeButton();
  await ctx.spClaimQuestStar('general-quest-001', b);
  assert.equal(alerts.length, 0, alerts[0]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /general-quest-001\/certificate\/claim$/);
  assert.equal(b.textContent, '✓ 証明書NFTを受け取りました');
});

test('ブラウザにウォレット拡張が無くても受け取れる（電話・LINE）', async () => {
  const { ctx, calls } = setup({ spLive: true, spLinks: [serverView(WALLET)] });
  assert.equal(ctx.ethereum, undefined, 'この試験は window.ethereum 無しで動く');
  await ctx.spClaimQuestStar('general-quest-001', fakeButton());
  assert.equal(calls.length, 1);
});

test('ウォレット未連携なら、押す前に案内して止める', async () => {
  const { ctx, calls, alerts } = setup({ spLive: true, spLinks: [
    { kind: 'fb', provider: 'line', label: 'LINE' },
  ] });
  const b = fakeButton();
  await ctx.spClaimQuestStar('general-quest-001', b);
  assert.equal(calls.length, 0, 'サーバーを呼ばない');
  assert.match(alerts[0], /ウォレットを連携/);
  assert.match(alerts[0], /記録と星はそのまま残ります/);
  assert.equal(b.disabled, false, 'もう一度押せる');
});

test('サーバーに聞けていないとき（spLive=false）は止めない', async () => {
  const { ctx, calls } = setup({ spLive: false, spLinks: [] });
  await ctx.spClaimQuestStar('general-quest-001', fakeButton());
  assert.equal(calls.length, 1, '判断はサーバーに任せる');
});

/* ───────── 失敗の説明 ─────────
   どの失敗でも「残るもの」を必ず伝える。押した人が損をしたと
   思わないため。英語の符号をそのまま出さない。 */

const SERVER_ERRORS = ['WALLET_REQUIRED', 'PASSPORT_LINK_REQUIRED', 'NOT_COMPLETED',
  'STAR_NOT_GRANTED', 'CERTIFICATE_NOT_DEPLOYED', 'MINTER_NOT_AUTHORIZED',
  'MINTER_OUT_OF_GAS', 'CERTIFICATE_MINT_FAILED', '', 'SOMETHING_NEW'];

for (const code of SERVER_ERRORS) {
  test('符号「' + (code || '(空)') + '」を英語のまま出さない', async () => {
    const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
      async () => ({ ok: false, json: async () => ({ error: code }) }));
    await ctx.spClaimQuestStar('general-quest-001', fakeButton());
    assert.equal(alerts.length, 1);
    assert.doesNotMatch(alerts[0], /[A-Z_]{6,}/, alerts[0]);
    assert.match(alerts[0], /[ぁ-んァ-ヶ一-龠]/, alerts[0]);
  });
}

test('ウォレット未連携の返事は、連携を促す', async () => {
  const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
    async () => ({ ok: false, json: async () => ({ error: 'WALLET_REQUIRED' }) }));
  await ctx.spClaimQuestStar('general-quest-001', fakeButton());
  assert.match(alerts[0], /ウォレットを連携してから/);
  assert.match(alerts[0], /完走の記録と星はそのまま残ります/);
});

test('発行係に権限が無いときは、運営側の話だと分かるように出す', async () => {
  const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
    async () => ({ ok: false, json: async () => ({ error: 'MINTER_NOT_AUTHORIZED' }) }));
  await ctx.spClaimQuestStar('general-quest-001', fakeButton());
  assert.match(alerts[0], /権限がありません/);
  assert.match(alerts[0], /運営/);
});

test('手数料が足りないときも、運営側の話だと分かるように出す', async () => {
  const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
    async () => ({ ok: false, json: async () => ({ error: 'MINTER_OUT_OF_GAS' }) }));
  await ctx.spClaimQuestStar('general-quest-001', fakeButton());
  assert.match(alerts[0], /手数料/);
  assert.match(alerts[0], /運営/);
});

test('限定星の説明は、星空の星が残ることを言う', async () => {
  const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
    async () => ({ ok: false, json: async () => ({ error: 'MINTER_NOT_AUTHORIZED' }) }));
  await ctx.spClaimLimitedStar('bug-kaibou-2026',
    { disabled: false, textContent: 'NFTで受け取る', isConnected: true });
  assert.match(alerts[0], /星空の星はそのまま残ります/);
});

test('受け取り済みでも、ボタンは受け取り済みの表示になる', async () => {
  const { ctx, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] },
    async () => ({ ok: true, json: async () => ({ ok: true, alreadyMinted: true, tokenId: '3' }) }));
  const b = fakeButton();
  await ctx.spClaimQuestStar('general-quest-001', b);
  assert.equal(alerts.length, 0);
  assert.equal(b.textContent, '✓ 証明書NFTを受け取りました');
});

test('二度押ししても二回送らない', async () => {
  const { ctx, calls } = setup({ spLive: true, spLinks: [serverView(WALLET)] });
  const b = fakeButton();
  const first = ctx.spClaimQuestStar('general-quest-001', b);
  await ctx.spClaimQuestStar('general-quest-001', b);
  await first;
  assert.equal(calls.length, 1);
});

/* ───────── 限定星 ───────── */

test('連携済みなら限定星の受け取りが通る', async () => {
  const { ctx, calls, alerts } = setup({ spLive: true, spLinks: [serverView(WALLET)] });
  const b = { disabled: false, textContent: 'NFTで受け取る', isConnected: true };
  await ctx.spClaimLimitedStar('bug-kaibou-2026', b);
  assert.equal(alerts.length, 0, alerts[0]);
  assert.match(calls[0].url, /stars\/bug-kaibou-2026\/claim$/);
  assert.equal(b.textContent, '✓ NFTを受け取りました');
});

test('限定星も、未連携なら星が残ることを伝えて止める', async () => {
  const { ctx, calls, alerts } = setup({ spLive: true, spLinks: [] });
  await ctx.spClaimLimitedStar('bug-kaibou-2026',
    { disabled: false, textContent: 'NFTで受け取る', isConnected: true });
  assert.equal(calls.length, 0);
  assert.match(alerts[0], /星空の星はそのまま残ります/);
});

/* ───────── 二度と subject だけを見ないための番人 ───────── */

test('受け取りの入口は window.ethereum を要求しない', () => {
  assert.doesNotMatch(src, /window\.ethereum/,
    '受け取りの宛先はサーバーが決める。ブラウザの接続を条件にしない。');
});

test('受け取りの入口は address を先に見て、subject に落とす', () => {
  assert.match(src, /l\.address \|\| l\.subject/,
    'subject だけを見ると、画面へ返る形（address）で必ず空になる。');
  /* 入口の判定が、取り出しの関数を通さずに link を直接読んでいないこと。 */
  const guards = src.slice(src.indexOf('async function spClaimLimitedStar'));
  assert.doesNotMatch(guards, /\.subject/,
    '判定は _spLinkedWallets を通すこと。link を直に読まない。');
});

/* サーバーが返す形が変わっていないことも、ここで押さえる。 */
test('publicView はウォレットを address に入れ、subject は入れない', () => {
  const backend = fs.readFileSync(path.join(root, 'backend/identity.js'), 'utf8');
  const view = backend.slice(backend.indexOf('function publicView(identity)'),
    backend.indexOf('async function listDuplicates'));
  assert.match(view, /address:\s*l\.kind === "wallet"/,
    '画面へ返す形では、ウォレットの宛先は address に入る');
  assert.doesNotMatch(view, /subject:/,
    'subject をそのまま返すようになったら、入口の作りを見直すこと');
});
