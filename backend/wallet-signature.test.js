"use strict";
/* ウォレットの署名の確かめ（wallet-signature.js）。10/30 WalletConnect でスマホのウォレット
   （HashPort Wallet など）からも入れるようにしたときに作った。
   ふつうのウォレットは署名からアドレスが出る。スマートコントラクト型は Polygon のコントラクトに聞く（EIP-1271）。
   本物の Polygon には聞かない（試験用の返事）。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const ethers = require("ethers");
const { createWalletSignatureVerifier, EIP1271_MAGIC, ERC6492_SUFFIX } = require("./wallet-signature");

const MESSAGE = "SchoolPark / Emu にログインします。\nnonce: test";
const IFACE = new ethers.utils.Interface(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);

/* Polygon の代わり。code と isValidSignature の返事を決められる */
class FakePolygon extends ethers.providers.StaticJsonRpcProvider {
  constructor(handler) { super("http://127.0.0.1:9", { name: "matic", chainId: 137 }); this.handler = handler; this.calls = []; }
  async perform(method, params) { this.calls.push(method); return this.handler(method, params); }
}

test("ふつうのウォレット（MetaMask など）：署名から出るアドレスが本人なら通す。違えば通さない", async () => {
  const me = ethers.Wallet.createRandom(), other = ethers.Wallet.createRandom();
  const polygon = new FakePolygon(() => { throw new Error("聞かない"); });
  const verify = createWalletSignatureVerifier({ ethers, provider: polygon });
  assert.deepEqual(await verify(me.address.toLowerCase(), MESSAGE, await me.signMessage(MESSAGE)), { ok: true, kind: "eoa" });
  assert.equal(polygon.calls.length, 0, "ふつうのウォレットは Polygon に聞かない");
  const r = await createWalletSignatureVerifier({ ethers, provider: null })(me.address, MESSAGE, await other.signMessage(MESSAGE));
  assert.deepEqual(r, { ok: false, code: "INVALID_SIGNATURE" });
});

test("スマートコントラクト型：コントラクトが「有効」と答えたときだけ通す", async () => {
  const account = ethers.Wallet.createRandom().address;
  const owner = ethers.Wallet.createRandom();
  const sig = await owner.signMessage(MESSAGE);   // 中の鍵の署名。アドレスとは一致しない
  let answer = EIP1271_MAGIC, seenHash = null;
  const polygon = new FakePolygon((method, params) => {
    if (method === "getCode") return "0x6080604052";
    if (method === "call") {
      assert.equal(params.transaction.to.toLowerCase(), account.toLowerCase());
      seenHash = IFACE.decodeFunctionData("isValidSignature", params.transaction.data).hash;
      return IFACE.encodeFunctionResult("isValidSignature", [answer]);
    }
    throw new Error("unexpected " + method);
  });
  const verify = createWalletSignatureVerifier({ ethers, provider: polygon });
  assert.deepEqual(await verify(account, MESSAGE, sig), { ok: true, kind: "contract" });
  assert.equal(seenHash, ethers.utils.hashMessage(MESSAGE), "personal_sign と同じ形のハッシュで聞く");
  answer = "0xffffffff";
  assert.deepEqual(await verify(account, MESSAGE, sig), { ok: false, code: "INVALID_SIGNATURE" });
  // 長い署名（65バイトでない）もコントラクトに聞く
  answer = EIP1271_MAGIC;
  assert.deepEqual(await verify(account, MESSAGE, "0x" + "ab".repeat(200)), { ok: true, kind: "contract" });
});

test("コントラクトが無いアドレス・まだ置かれていないスマートコントラクト型・Polygon に聞けないとき", async () => {
  const account = ethers.Wallet.createRandom().address;
  const empty = createWalletSignatureVerifier({ ethers, provider: new FakePolygon(m => (m === "getCode" ? "0x" : null)) });
  assert.equal((await empty(account, MESSAGE, "0x" + "11".repeat(65))).code, "INVALID_SIGNATURE");
  assert.equal((await empty(account, MESSAGE, "0x" + "22".repeat(100) + ERC6492_SUFFIX)).code, "SMART_WALLET_NOT_DEPLOYED");
  const down = createWalletSignatureVerifier({ ethers, provider: new FakePolygon(() => { throw new Error("timeout"); }) });
  assert.equal((await down(account, MESSAGE, "0x" + "11".repeat(65))).code, "SIGNATURE_CHECK_UNAVAILABLE");
  assert.equal((await empty("not-an-address", MESSAGE, "0x11")).code, "INVALID_ADDRESS");
  assert.equal((await empty(account, MESSAGE, "hello")).code, "INVALID_SIGNATURE");
});
