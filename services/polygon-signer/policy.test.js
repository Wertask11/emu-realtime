"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  ethers = require("ethers"),
  crypto = require("node:crypto");
const { makeFirestore } = require("../../backend/fake-firestore"),
  { createSigningPolicy, authenticate, TOKEN, PRODUCT } = require("./policy");
const { handler } = require("./server"),
  http = require("node:http");
const hash = (v) =>
  crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function fixture(method = "refundExchange") {
  const db = makeFirestore(),
    signer = ethers.Wallet.createRandom(),
    jobId = "a".repeat(40),
    orderId = "agent_" + jobId,
    chainOrderId = ethers.utils.id("emuer-economy:" + orderId);
  const i = new ethers.utils.Interface([
    "function refundExchange(bytes32)",
    "function markExchangeFulfilled(bytes32)",
    "function hasRole(bytes32,address) view returns(bool)",
    "function orders(bytes32) view returns(address buyer,bytes32 productId,uint256 paid,bool fulfilled,bool refunded)",
  ]);
  const transaction = {
      chainId: 137,
      to: TOKEN,
      value: "0x0",
      data: i.encodeFunctionData(method, [chainOrderId]),
      gasPrice: "0x64",
      gasLimit: "0x249f0",
      nonce: 0,
    },
    opId = hash([137, TOKEN, chainOrderId, method]),
    code = "0x60006000",
    address = "0x" + "2".repeat(40);
  const env = {
    POLYGON_SIGNER_ENABLED: "true",
    POLYGON_SIGNER_TOKEN: "synthetic-test-token-at-least-32-characters",
    ECONOMY_POLYGON_REFUND_GAS_LIMIT: "150000",
    ECONOMY_POLYGON_FULFILL_GAS_LIMIT: "150000",
    ECONOMY_POLYGON_MAX_FEE_WEI: "200",
  };
  const ref = (k, id) => db.collection("emuer_v2_agent_" + k).doc(id);
  await ref("system", "polygon-operator-control").set({
    enabled: true,
    revision: 1,
  });
  await ref("chain_ops", opId).set({
    orderId,
    jobId,
    chainOrderId,
    method,
    transaction,
    state: "signing",
  });
  await ref("system", "polygon-operator-slot").set({ active: opId });
  const o = {
    uid: "alice",
    passportId: "SP-TEST",
    serviceJobId: jobId,
    productId: PRODUCT,
    storeType: "agent_service",
    method: "emuer_chain",
    paymentSource: "polygon_wallet",
    amount: 5,
    amountWei: "5000000000000000000",
    chainId: 137,
    tokenAddress: TOKEN,
    chainOrderId,
    chainProductId: ethers.utils.id(PRODUCT),
    wallet: address,
    status: "paid",
  };
  await db.collection("mitemiru_orders").doc(orderId).set(o);
  await ref("jobs", jobId).set({
    uid: "alice",
    spid: "SP-TEST",
    walletAddress: address,
    paymentSource: "polygon_wallet",
    orderId,
    state: method === "refundExchange" ? "refund_pending" : "result_saved",
  });
  await ref("gas_reservations", orderId).set({
    state: "held",
    operatorAddress: signer.address.toLowerCase(),
    orderId,
    heldWei: "100000000",
  });
  await ref("artifacts", jobId).set({ ownerUid: "alice", jobId });
  const provider = {
    getNetwork: async () => ({ chainId: 137 }),
    getCode: async () => code,
    getTransactionCount: async () => 0,
    _isProvider: true,
    resolveName: async (x) => x,
    call: async ({ data }) => {
      const p = i.parseTransaction({ data });
      return p.name === "hasRole"
        ? i.encodeFunctionResult("hasRole", [true])
        : i.encodeFunctionResult("orders", [
            address,
            ethers.utils.id(PRODUCT),
            o.amountWei,
            false,
            false,
          ]);
    },
  };
  let signs = 0;
  const managed = {
    validate: async () => {},
    address: signer.address,
    signTransaction: async (t) => {
      signs++;
      return signer.signTransaction(t);
    },
  };
  const policy = createSigningPolicy({
    db,
    provider,
    signer: managed,
    codeHash: ethers.utils.keccak256(code),
    env,
    now: () => 1000,
  });
  const b = {
    version: 1,
    purpose: "schoolpark-emuer-service",
    operationId: opId,
    requestId: opId,
    expiresAtMs: 60000,
    transaction,
  };
  return {
    db,
    ref,
    policy,
    b,
    env,
    signs: () => signs,
    orderId,
    jobId,
    provider,
    managed,
  };
}
for (const method of ["refundExchange", "markExchangeFulfilled"])
  test(
    method + " owner/product/job/reserve validation; retry returns same bytes",
    async () => {
      const f = await fixture(method),
        raw = await f.policy.sign(f.b);
      assert.equal(await f.policy.sign(f.b), raw);
      assert.equal(f.signs(), 1);
      assert.equal(
        Object.keys(f.db._dump("emuer_v2_agent_signatures")).length,
        1,
      );
    },
  );
for (const patch of [
  { chainId: 1 },
  { to: "0x" + "3".repeat(40) },
  { value: 1 },
  { nonce: 1 },
  { gasPrice: "0xffff" },
  { gasLimit: "0xffffff" },
  { data: "0x12345678" },
])
  test("tampering rejected " + JSON.stringify(patch), async () => {
    const f = await fixture();
    await assert.rejects(
      f.policy.sign({ ...f.b, transaction: { ...f.b.transaction, ...patch } }),
    );
    assert.equal(f.signs(), 0);
  });
for (const [kind, patch] of [
  ["order", { storeType: "official_shop" }],
  ["order", { uid: "bob" }],
  ["order", { wallet: "0x" + "4".repeat(40) }],
  ["job", { state: "completed" }],
  ["reserve", { state: "settled" }],
])
  test(
    "foreign City/owner/job/reserve rejected " + JSON.stringify(patch),
    async () => {
      const f = await fixture(),
        r =
          kind === "order"
            ? f.db.collection("mitemiru_orders").doc(f.orderId)
            : f.ref(
                kind === "job" ? "jobs" : "gas_reservations",
                kind === "job" ? f.jobId : f.orderId,
              );
      await r.set(patch, { merge: true });
      await assert.rejects(f.policy.sign(f.b));
      assert.equal(f.signs(), 0);
    },
  );
test("expired request and wrong chain fail before signing", async () => {
  const f = await fixture();
  await assert.rejects(f.policy.sign({ ...f.b, expiresAtMs: 999 }));
  f.provider.getNetwork = async () => ({ chainId: 1 });
  await assert.rejects(f.policy.sign(f.b));
  assert.equal(f.signs(), 0);
});
test("server denies missing auth and excessive body", async () => {
  const f = await fixture(),
    server = http.createServer(handler(f.policy, f.env));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:" + server.address().port + "/sign";
    assert.equal(
      (await fetch(url, { method: "POST", body: "{}" })).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { authorization: "Bearer " + f.env.POLYGON_SIGNER_TOKEN },
          body: " ".repeat(8193),
        })
      ).status,
      503,
    );
    assert.equal(f.signs(), 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(authenticate("Bearer short", "short"), false);
});
test("durable nonce conflict and changed body cannot replay a signing slot", async () => {
  const f = await fixture();
  await f.ref("signer_nonces", "invalid").set({});
  const raw = await f.policy.sign(f.b),
    cache = Object.values(f.db._dump("emuer_v2_agent_signatures"))[0];
  assert(raw);
  assert(cache.fingerprint);
  const entries = Object.keys(
    f.db._dump("emuer_v2_agent_signer_nonces"),
  ).filter((k) => k !== "invalid");
  assert.equal(entries.length, 1);
  await f.ref("signer_nonces", entries[0]).set({ fingerprint: "different" });
  await assert.rejects(f.policy.sign(f.b));
  assert.equal(f.signs(), 1);
});
test("code replacement, missing result artifact and lost role reject signing", async () => {
  const a = await fixture();
  a.provider.getCode = async () => "0x6001";
  await assert.rejects(a.policy.sign(a.b));
  assert.equal(a.signs(), 0);
  const b = await fixture("markExchangeFulfilled");
  await b.ref("artifacts", b.jobId).delete();
  await assert.rejects(b.policy.sign(b.b));
  assert.equal(b.signs(), 0);
  const c = await fixture();
  const original = c.provider.call;
  c.provider.call = async (t) =>
    t.data.startsWith(ethers.utils.id("hasRole(bytes32,address)").slice(0, 10))
      ? ethers.utils.defaultAbiCoder.encode(["bool"], [false])
      : original(t);
  await assert.rejects(c.policy.sign(c.b));
  assert.equal(c.signs(), 0);
});
test("readiness validates fixed chain/operator; it does not sign", async () => {
  const f = await fixture();
  const r = await f.policy.ready();
  assert.equal(r.chainId, 137);
  assert.equal(r.tokenAddress, TOKEN);
  assert.equal(f.signs(), 0);
  f.env.POLYGON_SIGNER_ENABLED = "false";
  await assert.rejects(f.policy.ready());
});
test("cached signature is not returned after KMS is disabled or emergency control stops", async () => {
  const f = await fixture();
  await f.policy.sign(f.b);
  assert.equal(f.signs(), 1);
  f.managed.validate = async () => {
    throw Error("KMS disabled");
  };
  await assert.rejects(f.policy.sign(f.b), /KMS disabled/);
  assert.equal(f.signs(), 1);
  f.managed.validate = async () => {};
  await f
    .ref("system", "polygon-operator-control")
    .set({ enabled: true, halted: true });
  await assert.rejects(f.policy.sign(f.b));
  await assert.rejects(f.policy.ready());
  assert.equal(f.signs(), 1);
});
test("signing control is checked again inside durable transaction; missing control is closed", async () => {
  const f = await fixture();
  await f.ref("system", "polygon-operator-control").delete();
  await assert.rejects(f.policy.sign(f.b));
  assert.equal(f.signs(), 0);
});
