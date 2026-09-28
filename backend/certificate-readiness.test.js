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
  roleCalls: 0,
  baseFeeWei: 50n * 10n ** 9n,     /* 基礎手数料 50 gwei */
  chainTipWei: 15n * 10n ** 8n,    /* ethers の決め打ち 1.5 gwei */
  feeDataThrows: false,
  lastOverrides: null
};

const BN = (v) => ({
  _v: BigInt(v),
  gte(o) { return this._v >= BigInt(o._v !== undefined ? o._v : o); },
  gt(o) { return this._v > BigInt(o._v !== undefined ? o._v : o); },
  mul(n) { return BN(this._v * BigInt(n._v !== undefined ? n._v : n)); },
  add(o) { return BN(this._v + BigInt(o._v !== undefined ? o._v : o)); },
  isZero() { return this._v === 0n; },
  toString() { return this._v.toString(); }
});
const GWEI = 10n ** 9n;

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
      parseUnits: (v, unit) => {
        const exp = unit === "gwei" ? 9n : (unit === "ether" ? 18n : BigInt(unit || 0));
        return BN(BigInt(Math.round(Number(v) * 1e6)) * 10n ** (exp - 6n));
      },
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
      this.mint = async (_to, _key, _uri, overrides) => {
        chain.lastOverrides = overrides || null;
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
      /* ethers v5 が実際に返すのと同じ形。tip は 1.5 gwei の決め打ち。 */
      this.getFeeData = async () => {
        if (chain.feeDataThrows) throw new Error("no fee data");
        return {
          lastBaseFeePerGas: chain.baseFeeWei === null ? null : BN(chain.baseFeeWei),
          maxPriorityFeePerGas: BN(chain.chainTipWei),
          maxFeePerGas: BN(chain.baseFeeWei || 0n) , gasPrice: BN(0)
        };
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
    collection: name => collection(path + "/" + name),
    /* 本物と同じで、すでにあるところへは作れない。
       受け取りの側は、この失敗を握りつぶして先へ進む作りにしてある。 */
    create: async v => {
      if (records.has(path)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; }
      records.set(path, v);
    },
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
    tokenId: 0n, mintThrows: null, reachable: true, roleCalls: 0,
    baseFeeWei: 50n * 10n ** 9n, chainTipWei: 15n * 10n ** 8n,
    feeDataThrows: false, lastOverrides: null }, over || {});
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

/* ───────── 証明書の取りこぼしを、受け取りのときに作り直す ─────────

   10/1 までサーバーは承認を NOT_STARTED で断る。運営画面は逃げ道を通り、
   commits に approved と approvedRounds だけを書く。証明書は作られない。
   あとから認め直しても NO_NEW_ROUND で断られるので、直さないかぎり
   その完走の証明書は永久に出ない。 */

const ADDR = "0x" + "a".repeat(40);
const certKeyOf = (questId, spid, r) => "0x" + crypto.createHash("sha256")
  .update(Buffer.from(JSON.stringify(["schoolpark", questId, spid, ...(r > 1 ? [r] : [])])))
  .digest("hex");

/* 運営画面の逃げ道が書いたのと同じ形。証明書は無い。 */
function seedFallbackApproval(rounds) {
  records.clear();
  records.set("sp_identities/spid-a", {
    addresses: [ADDR], links: [{ kind: "wallet", subject: WALLET }] });
  records.set("sp_quests/quest-001", { series: "general", questNumber: 1,
    guildId: "learn", title: "Emuの知識を、やってみる" });
  records.set("sp_quests/quest-001/commits/" + ADDR,
    { approved: true, approvedRounds: rounds, approvedAt: 1759000000000 });
}
async function claimOnce(claim) {
  const { result, res } = reply();
  await claim({ params: { questId: "quest-001" },
    identity: { account: { spid: "spid-a" }, uid: "user-a" } }, res);
  return result;
}

test("証明書が無くても、完走が認めてあれば作って発行する", async () => {
  resetChain();
  seedFallbackApproval(1);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const out = await claimOnce(claim);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const row = records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 1));
  assert.ok(row, "証明書が作られていません");
  assert.equal(row.status, "minted");
  assert.equal(row.backfilled, true, "あとから作った印を残すこと");
});

test("あとから作った証明書に、渡していない EMUER を書かない", async () => {
  resetChain();
  seedFallbackApproval(1);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  await claimOnce(claim);
  const row = records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 1));
  assert.equal(row.amountEmuer, 0, "EMUERは動いていない。0のままにすること");
});

test("2周ぶん認めてあれば、2枚とも作って1回ずつ受け取れる", async () => {
  resetChain();
  seedFallbackApproval(2);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });

  const first = await claimOnce(claim);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.alreadyMinted, undefined, "1回目は新しく発行する");

  chain.tokenId = 0n;                       /* 次の発行はまだ無い */
  const second = await claimOnce(claim);
  assert.equal(second.status, 200, JSON.stringify(second.body));

  const r1 = records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 1));
  const r2 = records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 2));
  assert.equal(r1.status, "minted", "1周目が発行されていない");
  assert.equal(r2.status, "minted", "2周目が発行されていない");
  assert.equal(r1.round, 1);
  assert.equal(r2.round, 2);
});

test("2周目の証明書は、名前で見分けられる", async () => {
  resetChain();
  seedFallbackApproval(2);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  await claimOnce(claim);
  const r2 = records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 2));
  assert.equal(r2.questLabel, "一般 #001", "承認のときと同じ名前の作り方にすること");
  assert.equal(r2.guildId, "learn");
  assert.equal(r2.guildColor, "#0F5C3F", "星空の星と同じ色にすること");
});

/* ───────── 勝手に完走を名乗れないこと ───────── */

test("認められていない参加では、証明書を作らない", async () => {
  resetChain();
  seedFallbackApproval(1);
  records.set("sp_quests/quest-001/commits/" + ADDR, { approved: false, approvedRounds: 3 });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const out = await claimOnce(claim);
  assert.equal(out.status, 404);
  assert.equal(out.body.error, "NOT_COMPLETED");
  assert.equal(records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 1)), undefined);
});

test("受けてもいないクエストでは、証明書を作らない", async () => {
  resetChain();
  seedFallbackApproval(1);
  records.delete("sp_quests/quest-001/commits/" + ADDR);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const out = await claimOnce(claim);
  assert.equal(out.status, 404);
  assert.equal(out.body.error, "NOT_COMPLETED");
});

test("自分のパスポートに無いアドレスの完走は、持ってこられない", async () => {
  resetChain();
  seedFallbackApproval(1);
  /* 完走しているのは他人のアドレス。自分の名義には入っていない。 */
  records.set("sp_identities/spid-a", {
    addresses: ["0x" + "e".repeat(40)], links: [{ kind: "wallet", subject: WALLET }] });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  const out = await claimOnce(claim);
  assert.equal(out.status, 404, "他人の完走で証明書が出てはいけない");
  assert.equal(records.get("sp_quest_certificates/" + certKeyOf("quest-001", "spid-a", 1)), undefined);
});

test("周回の数が壊れていても、20枚を超えて作らない", async () => {
  resetChain();
  seedFallbackApproval(9999);
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  await claimOnce(claim);
  const made = [...records.keys()].filter(k => k.startsWith("sp_quest_certificates/")).length;
  assert.equal(made, 20, "上限（ROUND_SCAN_MAX）で止めること");
});

test("すでに正しく作られている証明書は、作り直さない", async () => {
  resetChain();
  seedFallbackApproval(1);
  const key = certKeyOf("quest-001", "spid-a", 1);
  records.set("sp_quest_certificates/" + key,
    { status: "pending", spid: "spid-a", round: 1, amountEmuer: 100, questLabel: "一般 #001" });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  await claimOnce(claim);
  const row = records.get("sp_quest_certificates/" + key);
  assert.equal(row.amountEmuer, 100, "もとの記録を上書きしてはいけない");
  assert.equal(row.backfilled, undefined, "作り直した印は付かない");
  assert.equal(row.status, "minted");
});

/* ───────── 失敗の理由を、もっと細かく分ける ─────────

   「発行が途中で止まりました」しか出ないと、RPC が落ちているのか
   コントラクトが断っているのか、運営にも分からない。 */

test("鎖に届かないだけのときは、そう返す", async () => {
  for (const err of [
    Object.assign(new Error("could not detect network"), { code: "NETWORK_ERROR" }),
    Object.assign(new Error("missing response"), { code: "SERVER_ERROR" }),
    Object.assign(new Error("timeout exceeded"), { code: "TIMEOUT" }),
    Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), {}),
    Object.assign(new Error("socket hang up"), {}),
  ]) {
    resetChain({ mintThrows: err });
    const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
      SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
    seedFallbackApproval(1);
    const out = await claimOnce(claim);
    assert.equal(out.body.error, "CHAIN_UNREACHABLE", err.message);
  }
});

test("すでに発行されていたら、失敗にせず記録を合わせる", async () => {
  resetChain({ mintThrows: new Error("execution reverted: AlreadyIssued") });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  /* 鎖の上にはもう在る、という状態にする。
     mint は断るが、読み直せば番号が返る。 */
  let reads = 0;
  const origTokenId = chain.tokenId;
  Object.defineProperty(chain, "tokenId", {
    configurable: true,
    get() { reads += 1; return reads > 1 ? 7n : origTokenId; },
    set() {}
  });
  const out = await claimOnce(claim);
  delete chain.tokenId; chain.tokenId = 0n;
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.tokenId, "7", "鎖に在る番号を拾って記録を合わせること");
});

test("役とガスの見分けは、今までどおり効いている", async () => {
  for (const [err, want] of [
    [Object.assign(new Error("reverted"), { error: { data: "0xe2517d3f00" } }), "MINTER_NOT_AUTHORIZED"],
    [Object.assign(new Error("insufficient funds for gas"), {}), "MINTER_OUT_OF_GAS"],
    [new Error("何だか分からない"), "CERTIFICATE_MINT_FAILED"],
  ]) {
    resetChain({ mintThrows: err });
    const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
      SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
    seedFallbackApproval(1);
    const out = await claimOnce(claim);
    assert.equal(out.body.error, want, err.message);
  }
});

/* ───────── Polygon の手数料の下限 ─────────

   Polygon は優先手数料の下限が 25 gwei。ethers v5 はチェーンに
   関係なく 1.5 gwei を決め打ちで入れるので、そのまま送ると
     transaction gas price below minimum:
     gas tip cap 1500000000, minimum needed 25000000000
   と断られる。実際にこれで発行が止まっていた。 */

const MIN_TIP = 25n * GWEI;          /* Polygon が要求する下限 */
const ETHERS_DEFAULT = 15n * 10n ** 8n;  /* ethers の決め打ち 1.5 gwei */

test("Polygon の下限（25 gwei）を満たす tip で送る", async () => {
  resetChain();
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  await claimOnce(claim);
  const ov = chain.lastOverrides;
  assert.ok(ov, "手数料を指定せずに送っている（ethers 任せでは通らない）");
  const tip = BigInt(ov.maxPriorityFeePerGas.toString());
  assert.ok(tip >= MIN_TIP, "tip が " + tip + " で下限 " + MIN_TIP + " に届いていない");
  assert.notEqual(tip, ETHERS_DEFAULT, "ethers の決め打ちのまま送っている");
});

test("上限（maxFee）は tip 以上で、基礎手数料の跳ねを見込む", async () => {
  resetChain({ baseFeeWei: 50n * GWEI });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  await claimOnce(claim);
  const ov = chain.lastOverrides;
  const tip = BigInt(ov.maxPriorityFeePerGas.toString());
  const max = BigInt(ov.maxFeePerGas.toString());
  assert.ok(max >= tip, "上限が tip を下回ると、そもそも送れない");
  assert.equal(max, 50n * GWEI * 2n + tip, "基礎の2倍＋tip にすること");
});

test("チェーンが下限より高い tip を言うなら、そちらに従う", async () => {
  resetChain({ chainTipWei: 80n * GWEI });   /* 混んでいる */
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  await claimOnce(claim);
  assert.equal(BigInt(chain.lastOverrides.maxPriorityFeePerGas.toString()), 80n * GWEI,
    "混んでいるときに床のまま送ると、いつまでも取り込まれない");
});

test("手数料を聞けなくても、床の額で送る", async () => {
  resetChain({ feeDataThrows: true });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  const out = await claimOnce(claim);
  assert.equal(out.status, 200, "聞けないだけで発行をあきらめてはいけない");
  const tip = BigInt(chain.lastOverrides.maxPriorityFeePerGas.toString());
  assert.ok(tip >= MIN_TIP, "床の額が下限に届いていない");
});

test("それでも下限に届かなかったときは、そう分かる符号を返す", async () => {
  resetChain({ mintThrows: Object.assign(
    new Error("transaction gas price below minimum: gas tip cap 1500000000, "
      + "minimum needed 25000000000"), { code: "SERVER_ERROR" }) });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  const out = await claimOnce(claim);
  assert.equal(out.body.error, "MINTER_GAS_PRICE_TOO_LOW",
    "残高はあるのに送れない。ガス切れとは別の話として出すこと");
});

test("限定星も同じ手数料で送る", async () => {
  resetChain();
  routes.length = 0;
  createQuestCompletionRouterForStars();
  function createQuestCompletionRouterForStars() {
    build({ SP_QUEST_STAR_CONTRACT: CONTRACT, SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  }
  const claimStar = (routes.find(r => r.path === "/stars/:starId/claim") || {}).handler;
  assert.ok(claimStar, "限定星の受け取りの口が見つかりません");
  records.clear();
  records.set("sp_identities/spid-a", { addresses: [ADDR],
    links: [{ kind: "wallet", subject: WALLET }] });
  const starKey = "0x" + crypto.createHash("sha256")
    .update(Buffer.from(JSON.stringify(["schoolpark-star", "fes-2026-10", "spid-a"])))
    .digest("hex");
  records.set("sp_stars/" + starKey, { status: "granted", spid: "spid-a", starId: "fes-2026-10" });
  const { result, res } = reply();
  await claimStar({ params: { starId: "fes-2026-10" },
    identity: { account: { spid: "spid-a" }, uid: "user-a" } }, res);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const tip = BigInt(chain.lastOverrides.maxPriorityFeePerGas.toString());
  assert.ok(tip >= MIN_TIP, "限定星だけ手数料の指定が漏れている");
});

test("本番で実際に出たエラーを、手数料の問題として見分ける", async () => {
  /* Render のログからそのまま取ったもの。code は SERVER_ERROR なので、
     並び順を間違えると「鎖に届かない」として片付けてしまう。 */
  const real = Object.assign(new Error(
    'processing response error (body="{\\"jsonrpc\\":\\"2.0\\",\\"id\\":55,'
    + '\\"error\\":{\\"code\\":-32000,\\"message\\":\\"transaction gas price below '
    + 'minimum: gas tip cap 1500000000, minimum needed 25000000000\\"}}", '
    + 'code=SERVER_ERROR, version=web/5.8.0)'), { code: "SERVER_ERROR" });
  resetChain({ mintThrows: real });
  const { claim } = build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY });
  seedFallbackApproval(1);
  const out = await claimOnce(claim);
  assert.equal(out.body.error, "MINTER_GAS_PRICE_TOO_LOW");
});

test("ガスの下限は、混んでいるときの1回ぶんを賄える額にする", async () => {
  /* 2026-09-28 に実際に1枚発行したときの手数料は 0.0717 POL。
     下限がそれを下回ると「発行できます」と言ってから失敗する。 */
  const REAL_MINT_COST = 0.0717;
  resetChain({ balanceWei: BigInt(Math.round(REAL_MINT_COST * 1e6)) * 10n ** 12n });
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, false,
    "1回ぶんちょうどでは足りない。次の1回で詰まる");
  assert.equal(body.reason, "MINTER_LOW_GAS");
});

test("1回ぶんを十分に上回っていれば、発行できると答える", async () => {
  resetChain({ balanceWei: 10n ** 18n });   /* 1 POL */
  const body = await callConfig(build({ SP_QUEST_STAR_CONTRACT: CONTRACT,
    SP_QUEST_STAR_MINTER_PRIVATE_KEY: KEY }).config);
  assert.equal(body.ready, true);
});
