"use strict";
/* 「NFTを配れる状態か」を、本当に確かめられているかの試験。

   env に2つ入っているだけで ready:true を返していた。
   コントラクトを置いたのは運営のウォレットで、MINTER_ROLE もそこに付く。
   サーバーの発行係は別の住所なので、役をもらっていなければ、
   押しても必ず失敗する。それが「準備OK」に見えていた。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

/* 鎖のふるまいを、試験ごとに差し替えられるようにしておく。 */
const chain = {
  minterRole: "0x9f2d",
  hasRole: true,
  balanceWei: 10n ** 18n,          /* 1 MATIC */
  tokenId: 0n,
  mintThrows: null,
  reachable: true,
  roleCalls: 0
};

const BN = (v) => ({
  _v: BigInt(v),
  gte(o) { return this._v >= BigInt(o._v !== undefined ? o._v : o); },
  isZero() { return this._v === 0n; },
  toString() { return this._v.toString(); }
});

const routes = [];
const original = Module._load;
Module._load = function (name, parent, main) {
  if (name === "express") return { Router: () => ({
    post: (path, ...h) => routes.push({ path, method: "post", handler: h.at(-1) }),
    get:  (path, ...h) => routes.push({ path, method: "get",  handler: h.at(-1) })
  }) };
  if (name === "ethers") {
    const utils = {
      isAddress: v => /^0x[0-9a-f]{40}$/i.test(String(v)),
      toUtf8Bytes: v => Buffer.from(v),
      keccak256: v => "0x" + crypto.createHash("sha256").update(v).digest("hex"),
      parseEther: v => BN(BigInt(Math.round(Number(v) * 1e6)) * 10n ** 12n),
      formatEther: b => (Number(b._v) / 1e18).toString()
    };
    function Wallet(key) {
      if (!/^0x[0-9a-f]{64}$/i.test(String(key))) throw new Error("invalid key");
      this.address = "0x" + "c".repeat(40);
    }
    function Contract() {
      this.MINTER_ROLE = async () => {
        chain.roleCalls += 1;
        if (!chain.reachable) throw new Error("could not detect network");
        return chain.minterRole;
      };
      this.hasRole = async () => chain.hasRole;
      this.tokenForCompletion = async () => BN(chain.tokenId);
      this.ownerOf = async () => "0x" + "b".repeat(40);
      this.mint = async () => {
        if (chain.mintThrows) throw chain.mintThrows;
        chain.tokenId = 5n;
        return { hash: "0xtx", wait: async () => ({}) };
      };
    }
    function JsonRpcProvider() {
      this.getBalance = async () => {
        if (!chain.reachable) throw new Error("could not detect network");
        return BN(chain.balanceWei);
      };
    }
    return { utils, Wallet, Contract, providers: { JsonRpcProvider } };
  }
  return original.call(this, name, parent, main);
};
const { createQuestCompletionRouter } = require("./quest-completion");
Module._load = original;

const CONTRACT = "0x" + "d".repeat(40);
const KEY = "0x" + "1".repeat(64);
const WALLET = "0x" + "b".repeat(40);

const records = new Map();
function snapshot(path) {
  const data = records.get(path);
  return { id: path.split("/").at(-1), exists: !!data, data: () => data, ref: doc(path) };
}
function doc(path) {
  return { id: path.split("/").at(-1), path, get: async () => snapshot(path),
    set: async v => records.set(path, { ...(records.get(path) || {}), ...v }) };
}
function collection(path) { return { doc: id => doc(path + "/" + id) }; }
const db = { collection };

function build(env) {
  routes.length = 0;
  createQuestCompletionRouter({ db, requireOwner: (_q, _s, n) => n(),
    requireFirebaseUser: (_q, _s, n) => n(), env });
  const find = p => (routes.find(r => r.path === p) || {}).handler;
  return { config: find("/certificate/config"),
    claim: find("/:questId/certificate/claim") };
}
function reply() {
  const result = { status: 200 };
  return { result, res: {
    set() { return this; },
    status(c) { result.status = c; return this; },
    json(v) { result.body = v; return result; } } };
}
async function callConfig(h) { const { result, res } = reply(); await h({}, res); return result.body; }

function resetChain(over) {
  Object.assign(chain, { minterRole: "0x9f2d", hasRole: true, balanceWei: 10n ** 18n,
    tokenId: 0n, mintThrows: null, reachable: true, roleCalls: 0 }, over || {});
}

/* ───────── 準備ができているかの判定 ───────── */

test("env が空なら、未設置として返す", async () => {
  resetChain();
  const body = await callConfig(build({}).config);
  assert.equal(body.ready, false);
  assert.equal(body.reason, "NOT_DEPLOYED");
  assert.equal(body.contract, null);
});

test("鍵が壊れていれば、鍵の問題だと返す", async () => {
  resetChain();
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: "not-a-key" }).config);
  assert.equal(body.ready, false);
  assert.equal(body.reason, "BAD_MINTER_KEY");
});

test("役もガスもあれば、準備できていると返す", async () => {
  resetChain();
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, true);
  assert.equal(body.reason, "");
  assert.equal(body.canMint, true);
  assert.equal(body.contract, CONTRACT);
});

test("発行係に MINTER_ROLE が無ければ、準備できていないと返す", async () => {
  resetChain({ hasRole: false });
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, false, "役が無いのに準備OKと言ってはいけない");
  assert.equal(body.reason, "MINTER_NOT_AUTHORIZED");
  assert.equal(body.canMint, false);
});

test("ガス代が足りなければ、準備できていないと返す", async () => {
  resetChain({ balanceWei: 10n ** 15n });   /* 0.001 MATIC */
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, false);
  assert.equal(body.reason, "MINTER_LOW_GAS");
});

test("鎖に届かないときは、届かなかったとだけ返す", async () => {
  resetChain({ reachable: false });
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, false);
  assert.equal(body.reason, "CHAIN_UNREACHABLE",
    "届かないだけなら、設定が悪いとは言わない");
});

test("発行係の住所は返すが、秘密鍵は返さない", async () => {
  resetChain();
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.match(body.minter, /^0x[0-9a-f]{40}$/i, "役を与えるために住所は要る");
  assert.doesNotMatch(JSON.stringify(body), /1111111111/, "鍵は絶対に出さない");
});

test("答えは60秒取っておく（鎖を毎回叩かない）", async () => {
  resetChain();
  const { config } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  await callConfig(config);
  const after = chain.roleCalls;
  await callConfig(config);
  await callConfig(config);
  assert.equal(chain.roleCalls, after, "続けて聞かれても、鎖には1度だけ");
});

/* ───────── 失敗の理由を言葉にする ───────── */

function seedCompleted() {
  records.clear();
  records.set("ches_accounts/user-a", { spid: "spid-a" });
  records.set("sp_identities/spid-a", { links: [{ kind: "wallet", subject: WALLET }] });
}
async function callClaim(h, key) {
  seedCompleted();
  records.set("sp_quest_certificates/" + key, { status: "granted", spid: "spid-a" });
  const { result, res } = reply();
  await h({ params: { questId: "quest-001" },
    identity: { account: { spid: "spid-a" }, uid: "user-a" } }, res);
  return result;
}

test("役が無くて発行に失敗したら、その理由で返す", async () => {
  resetChain({ hasRole: false, mintThrows:
    Object.assign(new Error("execution reverted"),
      { error: { data: "0xe2517d3f0000" } }) });
  const { claim, config } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const crypto2 = require("node:crypto");
  const key = "0x" + crypto2.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  const out = await callClaim(claim, key);
  assert.equal(out.status, 503);
  assert.equal(out.body.error, "MINTER_NOT_AUTHORIZED",
    "「失敗しました」では、何を直せばよいか分からない");
  /* 失敗したら、次に聞かれたときは取り置きを使わず見に行く。 */
  const before = chain.roleCalls;
  await callConfig(config);
  assert.ok(chain.roleCalls > before, "失敗のあとは状態を見直す");
});

test("ガス切れで発行に失敗したら、その理由で返す", async () => {
  resetChain({ mintThrows: Object.assign(new Error("insufficient funds for gas"),
    { code: "INSUFFICIENT_FUNDS" }) });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const key = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  const out = await callClaim(claim, key);
  assert.equal(out.body.error, "MINTER_OUT_OF_GAS");
});

test("理由の分からない失敗は、今までどおりの符号で返す", async () => {
  resetChain({ mintThrows: new Error("something else went wrong") });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const key = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  const out = await callClaim(claim, key);
  assert.equal(out.body.error, "CERTIFICATE_MINT_FAILED");
});

test("うまくいけば発行され、記録に残る（失敗の試験が本当にmintまで来ている証）", async () => {
  resetChain();
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const key = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  const out = await callClaim(claim, key);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.ok, true);
  assert.equal(out.body.tokenId, "5");
  assert.equal(records.get("sp_quest_certificates/" + key).status, "minted");
});

test("受け取り済みなら、二度目は発行しないでそのまま返す", async () => {
  resetChain();
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const key = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  seedCompleted();
  records.set("sp_quest_certificates/" + key,
    { status: "minted", spid: "spid-a", tokenId: "9", txHash: "0xold" });
  const { result, res } = reply();
  await claim({ params: { questId: "quest-001" },
    identity: { account: { spid: "spid-a" }, uid: "user-a" } }, res);
  assert.equal(result.body.alreadyMinted, true);
  assert.equal(result.body.tokenId, "9");
});

test("ウォレット未連携なら、記録に触らず WALLET_REQUIRED", async () => {
  resetChain();
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const key = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark", "quest-001", "spid-a"]))).digest("hex");
  seedCompleted();
  records.set("sp_identities/spid-a", { links: [{ kind: "fb", provider: "line" }] });
  records.set("sp_quest_certificates/" + key, { status: "granted", spid: "spid-a" });
  const { result, res } = reply();
  await claim({ params: { questId: "quest-001" },
    identity: { account: { spid: "spid-a" }, uid: "user-a" } }, res);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "WALLET_REQUIRED");
  assert.equal(records.get("sp_quest_certificates/" + key).status, "granted", "記録はそのまま");
});

test("役の値を返す（運営画面が grantRole にそのまま貼れるように）", async () => {
  resetChain({ hasRole: false });
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.reason, "MINTER_NOT_AUTHORIZED");
  assert.equal(body.role, chain.minterRole,
    "コントラクトから読んだ値をそのまま返すこと（書き写させない）");
  assert.doesNotMatch(JSON.stringify(body), /1111111111/, "鍵は絶対に出さない");
});

test("役が読めないときも、欄そのものは返す", async () => {
  resetChain({ reachable: false });
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.role, "", "読めないときは空。前の値を出さない");
});
