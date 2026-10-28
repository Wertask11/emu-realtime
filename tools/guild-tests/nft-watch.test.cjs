/* 受け取ったNFTを、どこに届いたか・MetaMaskに出す。

   10/28、証明書NFTを受け取ったのに MetaMask に出ず「届いていない」ように
   見えた。MetaMask は Polygon の NFT を自動では全部拾わないので、
   「NFTをインポート」で1枚ずつ手で足して、やっと見えた。
   それに、パスポートは完走したクエストを新しい10件しか出していなかったので、
   それより古い完走には「受け取る」が無く、受け取る手立てが無かった。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const start = html.indexOf('/* ───── 受け取ったNFTを、どこに届いたか・MetaMaskに出す ─────');
const end = html.indexOf('/* パスポートに連携済みのウォレットを取り出す。', start);
assert.ok(start > 0 && end > start, 'MetaMask に出すところが見つかりません');
const src = html.slice(start, end);

const WALLET = '0xdcc6800000000000000000000000000000006edf';
const OTHER = '0x195f0000000000000000000000000000000042ac';
const CONTRACT = '0xdcAe7317F4E64fef054bd8f6BA94f9C06fb1F8B6';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setup(ethereum) {
  const alerts = [];
  const ctx = vm.createContext({
    alert: m => alerts.push(m), escapeHtml: esc, console,
    document: { addEventListener() {} },
    emuAuthHeaders: async () => ({}),
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, contract: CONTRACT, certificates: [] }) })
  });
  ctx.window = ctx;
  if (ethereum) ctx.window.ethereum = ethereum;
  vm.runInContext(src, ctx);
  return { ctx, alerts };
}

function metamask({ account = WALLET, chain = '0x89', reject } = {}) {
  const calls = [];
  return { calls, request: async ({ method, params }) => {
    calls.push({ method, params: JSON.parse(JSON.stringify(params || null)) });
    if (method === 'eth_requestAccounts') return [account];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_watchAsset' && reject) throw reject;
    return true;
  } };
}

function button(ids, wallet = WALLET) {
  return { disabled: false, textContent: 'MetaMaskに追加',
    dataset: { watchNft: ids, watchContract: CONTRACT, watchWallet: wallet } };
}

test('受け取り済みなら、届いた先と「MetaMaskに追加」を出す（周回ぶんのトークン ID も）', () => {
  const { ctx } = setup();
  const certs = { contract: CONTRACT, certificates: [
    { questId: 'q1', round: 2, minted: true, tokenId: '12', wallet: WALLET },
    { questId: 'q1', round: 1, minted: true, tokenId: '5', wallet: WALLET },
    { questId: 'q2', round: 1, minted: true, tokenId: '6', wallet: WALLET }
  ] };
  const out = ctx._spCertMintedHtml(certs, 'q1', 2);
  assert.match(out, /✓ 証明書NFTを受け取り済み（0xdcc6…6edf に届きました）/);
  assert.match(out, /data-watch-nft="5,12"/, 'その周回のトークン ID を全部渡す');
  assert.match(out, new RegExp('data-watch-contract="' + CONTRACT + '"'));
  assert.match(out, />MetaMaskに追加</);
});

test('まだ受け取っていない周があれば、受け取り済みとして出さない（「受け取る」を残す）', () => {
  const { ctx } = setup();
  const certs = { contract: CONTRACT, certificates: [{ questId: 'q1', round: 1, minted: true, tokenId: '5', wallet: WALLET }] };
  assert.equal(ctx._spCertMintedHtml(certs, 'q1', 2), '');
  assert.equal(ctx._spCertMintedHtml(certs, 'q9', 1), '');
  assert.equal(ctx._spCertMintedHtml(null, 'q1', 1), '', '読めなかったときも「受け取る」を残す');
});

test('受け取った直後は「〇〇 に届きました」と追加ボタンを足す。コントラクトが分からなければボタンは出さない', () => {
  const { ctx } = setup();
  const added = [];
  ctx._spShowMinted({ insertAdjacentHTML: (_w, h) => added.push(h) }, { tokenId: '7', wallet: WALLET, contract: CONTRACT });
  assert.match(added[0], /0xdcc6…6edf に届きました/);
  assert.match(added[0], /data-watch-nft="7"/);
  assert.doesNotMatch(ctx._spMintedHtml('', WALLET, ['7'], ''), /data-watch-nft/);
  assert.doesNotMatch(ctx._spMintedHtml('', '<b>', ['7'], CONTRACT), /<b>/, 'アドレスでないものは出さない');
});

test('MetaMask に、コントラクトとトークン ID を入れた状態で1枚ずつ追加を頼む', async () => {
  const mm = metamask();
  const { ctx, alerts } = setup(mm);
  const b = button('5,12');
  await ctx.spWatchNft(b);
  const asks = mm.calls.filter(c => c.method === 'wallet_watchAsset').map(c => c.params);
  assert.deepEqual(asks, [
    { type: 'ERC721', options: { address: CONTRACT, tokenId: '5' } },
    { type: 'ERC721', options: { address: CONTRACT, tokenId: '12' } }
  ]);
  assert.equal(b.textContent, '✓ MetaMaskに追加しました');
  assert.equal(alerts.length, 0);
});

test('Polygon でなければ、先に切り替えを頼む', async () => {
  const mm = metamask({ chain: '0x1' });
  const { ctx } = setup(mm);
  await ctx.spWatchNft(button('5'));
  const i = mm.calls.findIndex(c => c.method === 'wallet_switchEthereumChain');
  assert.ok(i > 0, '切り替えを頼んでいない');
  assert.deepEqual(mm.calls[i].params, [{ chainId: '0x89' }]);
  assert.ok(mm.calls.findIndex(c => c.method === 'wallet_watchAsset') > i);
});

test('届いた先と違うアカウントを開いていたら、追加を頼まずに切り替えを案内する', async () => {
  const mm = metamask({ account: OTHER });
  const { ctx, alerts } = setup(mm);
  const b = button('5');
  await ctx.spWatchNft(b);
  assert.equal(mm.calls.some(c => c.method === 'wallet_watchAsset'), false);
  assert.match(alerts[0], /0xdcc6…6edf に届いています/);
  assert.match(alerts[0], /0x195f…42ac/);
  assert.match(alerts[0], new RegExp(CONTRACT), '手で入れるときの材料も出す');
  assert.equal(b.disabled, false, 'もう一度押せるように戻す');
});

test('MetaMask で断ったときは、何も言わずに戻す。もう追加してあるものは通す', async () => {
  let { ctx, alerts } = setup(metamask({ reject: Object.assign(new Error('User rejected'), { code: 4001 }) }));
  const b = button('5');
  await ctx.spWatchNft(b);
  assert.equal(alerts.length, 0);
  assert.equal(b.textContent, 'MetaMaskに追加');
  ({ ctx, alerts } = setup(metamask({ reject: new Error('Suggested NFT is already owned and added') })));
  const c = button('5');
  await ctx.spWatchNft(c);
  assert.equal(alerts.length, 0);
  assert.equal(c.textContent, '✓ MetaMaskに追加しました');
});

test('MetaMask が無ければ、手で入れる材料（アドレスとトークン ID）を出す', async () => {
  const { ctx, alerts } = setup();
  await ctx.spWatchNft(button('5,12'));
  assert.match(alerts[0], /MetaMask が見つかりませんでした/);
  assert.match(alerts[0], new RegExp(CONTRACT));
  assert.match(alerts[0], /5、12/);
});

test('完走したクエストは10件で切らない（古い完走にも「受け取る」を出す）', () => {
  const i = html.indexOf("doneHtml = _sppRow('SchoolPark｜完走したクエスト'");
  const body = html.slice(i, html.indexOf('/* 限定星。運営が配った', i));
  assert.doesNotMatch(body, /done\.slice\(0, 10\)/, '10件で切っている');
  assert.match(body, /done\.forEach\(/);
  assert.match(body, /data-done-more hidden/, '11件目からは畳んで出す');
  assert.match(body, /残り' \+ \(done\.length - DONE_FIRST\) \+ '件を見る/);
  assert.match(html, /\.spp-row\[hidden\] \{ display:none; \}/, '.spp-row の display が hidden を上書きしないように');
});
