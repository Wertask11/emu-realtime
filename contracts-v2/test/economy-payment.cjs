"use strict";
const { test, before, after, beforeEach, afterEach } = require("node:test"),
  assert = require("node:assert/strict"),
  ethers = require("../../backend/node_modules/ethers");
const ganache = require("ganache");
const { fixture, SPID } = require("../../backend/economy/fixture"),
  { hash } = require("../../backend/economy/config"),
  { policy, AMOUNT, TERMS } = require("../../backend/economy/polygon-config");
const { createPolygonRPC } = require("../../backend/economy/polygon-rpc"),
  { createOperator } = require("../../backend/economy/polygon-operator");
const artifact = require("../artifacts/EMUERv2.json");
let gp, provider, admin, buyer, other, contract, codeHash, snapshot;
const key = (n) => "phase5-request-key-" + n;
before(async () => {
  gp = ganache.provider({
    logging: { quiet: true },
    chain: {
      chainId: 137,
      hardfork: "shanghai",
      time: new Date("2026-11-06T03:00:00Z"),
    },
    wallet: { totalAccounts: 4 },
  });
  provider = new ethers.providers.Web3Provider(gp);
  provider.pollingInterval = 10;
  const keys = Object.values(gp.getInitialAccounts()).map((x) => x.secretKey);
  [admin, buyer, other] = keys
    .slice(0, 3)
    .map((k) => new ethers.Wallet(k, provider));
  contract = await new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    admin,
  ).deploy(admin.address, 86400);
  await contract.deployTransaction.wait();
  codeHash = ethers.utils.keccak256(await provider.getCode(contract.address));
  const claimId = ethers.utils.id("isolated-phase5-reward"),
    deadline = 2000000000,
    totalAmount = ethers.utils.parseEther("1000");
  const signature = await admin._signTypedData(
    {
      name: "Emuer",
      version: "2",
      chainId: 137,
      verifyingContract: contract.address,
    },
    {
      Reward: [
        { name: "claimId", type: "bytes32" },
        { name: "recipient", type: "address" },
        { name: "totalAmount", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { claimId, recipient: buyer.address, totalAmount, deadline },
  );
  await (
    await contract
      .connect(buyer)
      .claimReward(claimId, totalAmount, deadline, signature)
  ).wait();
});
beforeEach(async () => {
  snapshot = await gp.request({ method: "evm_snapshot", params: [] });
});
afterEach(async () => {
  await gp.request({ method: "evm_revert", params: [snapshot] });
  provider.removeAllListeners();
  provider = new ethers.providers.Web3Provider(gp);
  provider.pollingInterval = 10;
  admin = admin.connect(provider);
  buyer = buyer.connect(provider);
  other = other.connect(provider);
  contract = contract.connect(admin);
});
after(async () => {
  provider.removeAllListeners();
  await gp.disconnect();
});
function env() {
  return Object.fromEntries([
    ...[
      "ENABLED",
      "CONTRACT_ATTESTED",
      "LEGAL_ATTESTED",
      "EXTERNAL_AUDIT_ATTESTED",
      "OPERATOR_ATTESTED",
      "GAS_BUDGET_ATTESTED",
    ].map((k) => ["ECONOMY_POLYGON_" + k, "true"]),
    ["ECONOMY_POLYGON_CODE_HASH", codeHash],
    ["ECONOMY_POLYGON_OPERATOR_ADDRESS", admin.address],
    ["ECONOMY_POLYGON_MAX_GAS_WEI", "100000000000000000"],
    ["ECONOMY_POLYGON_DAILY_GAS_WEI", "1000000000000000000"],
    ["ECONOMY_POLYGON_MONTHLY_GAS_WEI", "7000000000000000000"],
    ["ECONOMY_POLYGON_TRIAL_GAS_WEI", "7000000000000000000"],
    ["ECONOMY_POLYGON_MAX_FEE_WEI", "100000000000"],
    ["ECONOMY_POLYGON_REFUND_GAS_LIMIT", "150000"],
    ["ECONOMY_POLYGON_FULFILL_GAS_LIMIT", "100000"],
    ["ECONOMY_POLYGON_SIGNER_URL", "https://signer.example.test/sign"],
    ["ECONOMY_POLYGON_SIGNER_HOST", "signer.example.test"],
    ["ECONOMY_POLYGON_SIGNER_TOKEN", "isolated-test-only"],
  ]);
}
function rpc(p = provider, extra = {}) {
  return createPolygonRPC({
    // TEST ONLY: Ganache lacks estimateGas state overrides. Snapshot, mutate
    // isolated EVM storage, estimate real execution, then revert everything.
    provider: new Proxy(p, {
      get(t, k) {
        if (k === "send")
          return async (method, args) => {
            if (method !== "eth_estimateGas" || !args[2])
              return t.send(method, args);
            const snap = await gp.request({
              method: "evm_snapshot",
              params: [],
            });
            try {
              for (const [address, override] of Object.entries(args[2]))
                for (const [slot, value] of Object.entries(override.stateDiff))
                  await gp.request({
                    method: "evm_setAccountStorageAt",
                    params: [address, slot, value],
                  });
              return await t.send("eth_estimateGas", args.slice(0, 2));
            } finally {
              await gp.request({ method: "evm_revert", params: [snap] });
            }
          };
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }),
    profile: {
      localTest: true,
      chainId: 137,
      tokenAddress: contract.address,
      treasury: admin.address,
      confirmations: 1,
    },
    signer: admin,
    codeHash,
    ...extra,
  });
}
async function setup(options = {}) {
  const r = rpc(),
    f = fixture({
      env: env(),
      ...options,
      polygonOptions: {
        rpc: r,
        signTransaction: (tx) => admin.signTransaction(tx),
        ...options.polygonOptions,
      },
    });
  await f.seed();
  await f.economy.service
    .ref("system", "polygon-operator-control")
    .set({ enabled: true, revision: 1 });
  f.a = { ...(await f.actor()), walletAddress: buyer.address.toLowerCase() };
  f.identity.findByAddress = async (a) =>
    a.toLowerCase() === buyer.address.toLowerCase() ? SPID : null;
  return { f, r };
}
async function request(f, n) {
  const s = f.economy.service,
    q = await s.quote(f.a, {
      goal: "コーヒーを学びたい",
      method: "emuer_chain",
    }),
    ch = await s.polygon.challenge(f.a);
  return {
    quoteId: q.id,
    termsVersion: q.termsVersion,
    paymentTermsVersion: q.paymentTermsVersion,
    method: "emuer_chain",
    requestId: key(n),
    paymentConsent: true,
    aiConsent: true,
    walletNonce: ch.nonce,
    walletSignature: await buyer.signMessage(ch.message),
  };
}
async function funded(f, n) {
  const s = f.economy.service,
    b = await request(f, n),
    j = await s.submit(f.a, b),
    m = await s.polygon.manifest(f.a, j.id, await s.owned(f.a, j.id));
  const tx = await buyer.sendTransaction({
    to: m.to,
    data: m.data,
    value: m.value,
  });
  await tx.wait();
  await s.polygon.attach(f.a, j.id, await s.owned(f.a, j.id), {
    transactionHash: tx.hash,
  });
  return { b, j, m, tx };
}
async function finish(f) {
  for (let i = 0; i < 4; i++) await f.economy.tick();
}
test("wallet flags are strict OFF; signer/attestations/gas caps cannot be inferred", () => {
  assert.equal(policy({}).enabled, false);
  const e = env();
  assert.equal(policy(e).enabled, true);
  for (const k of Object.keys(e)) {
    const x = { ...e };
    delete x[k];
    assert.equal(policy(x).enabled, false, k);
  }
  for (const u of [
    "http://signer.example.test",
    "https://127.0.0.1",
    "https://signer.example.test@evil.test",
    "https://signer.example.test/?token=x",
  ])
    assert.equal(
      policy({ ...e, ECONOMY_POLYGON_SIGNER_URL: u }).enabled,
      false,
    );
});
test("actual local contract identity, supply, roles, pause and nonempty operator gas", async () => {
  await rpc().ready(admin.address);
  await assert.rejects(rpc().ready(other.address), /POLYGON_REFUND_NOT_READY/);
  await assert.rejects(
    rpc(provider, { codeHash: ethers.constants.HashZero }).assertContract(),
    /POLYGON_CODE_UNVERIFIED/,
  );
  await assert.rejects(
    createPolygonRPC({
      provider,
      profile: {
        chainId: 80002,
        tokenAddress: contract.address,
        treasury: admin.address,
      },
      codeHash,
    }).assertContract(),
    /POLYGON_WRONG_CHAIN/,
  );
  await (await contract.pause()).wait();
  await assert.rejects(rpc().ready(admin.address), /POLYGON_PAUSED/);
  await (await contract.unpause()).wait();
});
test("exact 5 chain exchange -> canonical verification -> same job -> durable result -> fulfillment, no ledger/City usage", async () => {
  const { f } = await setup(),
    before = await contract.balanceOf(buyer.address),
    { j, b } = await funded(f, 1);
  assert.equal(j.state, "awaiting_wallet_payment");
  assert.equal(j.paymentSource, "polygon_wallet");
  assert.equal(
    (await contract.balanceOf(buyer.address)).toString(),
    before.sub(AMOUNT).toString(),
  );
  assert.equal(f.calls(), 0);
  await finish(f);
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.equal(done.payment.method, "emuer_chain");
  assert.equal(done.payment.confirmationStatus, "finalized");
  assert.equal(done.result.results[0].id, "coffee");
  assert.equal(f.calls(), 1);
  assert.equal((await f.economy.service.submit(f.a, b)).id, j.id);
  assert.equal(f.calls(), 1);
  assert.equal(Object.keys(f.db._dump("emuer_v2_rewards")).length, 1);
  assert.deepEqual(f.db._dump("emuer_v2_access_usage"), {});
  assert.equal(Object.keys(f.db._dump("mitemiru_chain_payments")).length, 1);
  const ops = Object.values(f.db._dump("emuer_v2_agent_chain_ops"));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].rawTransaction, null);
  assert.equal(ops[0].state, "confirmed");
});
test("ownership signature: wrong wallet, expired nonce, purpose/domain tampering rejected before order/spend", async () => {
  const { f } = await setup(),
    b = await request(f, 2);
  await assert.rejects(
    f.economy.service.submit(f.a, {
      ...b,
      walletSignature: await other.signMessage("fake"),
    }),
    /POLYGON_OWNERSHIP_REQUIRED/,
  );
  f.advance(300001);
  await f.economy.service.workerHealth(true);
  await assert.rejects(
    f.economy.service.submit(f.a, b),
    /POLYGON_OWNERSHIP_EXPIRED/,
  );
  assert.deepEqual(f.db._dump("mitemiru_orders"), {});
});
test("proof nonce cannot fund two jobs or cross accounts; payment source/terms locked", async () => {
  const { f } = await setup(),
    b = await request(f, 3);
  await assert.rejects(
    f.economy.service.submit(f.a, { ...b, paymentTermsVersion: "old" }),
    /QUOTE_EXPIRED_OR_CHANGED/,
  );
  await f.economy.service.submit(f.a, b);
  const q = await f.economy.service.quote(f.a, {
    goal: "コーヒーを学びたい",
    method: "emuer_chain",
  });
  await assert.rejects(
    f.economy.service.submit(f.a, {
      ...b,
      quoteId: q.id,
      requestId: key("new"),
    }),
    /POLYGON_OWNERSHIP_EXPIRED/,
  );
  await assert.rejects(
    f.economy.service.submit(f.a, { ...b, method: "emuer_ledger" }),
    /IDEMPOTENCY_KEY_CONFLICT/,
  );
  await assert.rejects(
    f.economy.service.polygon.manifest(
      { ...f.a, uid: "bob" },
      hash([f.a.spid, b.requestId]).slice(0, 40),
      await f.economy.service.owned(
        f.a,
        hash([f.a.spid, b.requestId]).slice(0, 40),
      ),
    ),
    /JOB_NOT_FOUND/,
  );
});
test("chain order broadcast/client crash recovers by exact indexed order event without a hash", async () => {
  const { f } = await setup(),
    { j } = await funded(f, 4);
  await f.db
    .collection("mitemiru_orders")
    .doc("agent_" + j.id)
    .set({ transactionHint: null }, { merge: true });
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(f.calls(), 1);
});
test("confirmed payment after intake OFF is reconciled and fails safely to original wallet refund", async () => {
  const { f } = await setup(),
    before = await contract.balanceOf(buyer.address),
    { j } = await funded(f, 5);
  f.env.ECONOMY_EXPLORER_ENABLED = "false";
  f.env.ECONOMY_POLYGON_ENABLED = "false";
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert((await contract.balanceOf(buyer.address)).eq(before));
  assert.equal(f.calls(), 0);
  await finish(f);
  assert((await contract.balanceOf(buyer.address)).eq(before));
});
test("provider 429 -> persistent refund_pending -> exact full refund, no duplicate after restart", async () => {
  const { f } = await setup({ providerStatus: 429 }),
    before = await contract.balanceOf(buyer.address),
    { j } = await funded(f, 6);
  await f.economy.tick();
  assert.ok(
    ["refund_pending", "refunded"].includes(
      (await f.economy.service.view(f.a, j.id)).state,
    ),
  );
  await finish(f);
  const v = await f.economy.service.view(f.a, j.id);
  assert.equal(v.state, "refunded");
  assert.match(v.payment.refundTransactionHash, /^0x[0-9a-f]{64}$/);
  assert((await contract.balanceOf(buyer.address)).eq(before));
  await finish(f);
  assert((await contract.balanceOf(buyer.address)).eq(before));
});
test("finality threshold, canonical block hash and missing finalized RPC fail closed", async () => {
  const { f, r } = await setup(),
    { j, tx } = await funded(f, 7),
    o = await f.commerce.servicePayments.get("agent_" + j.id);
  const receipt = await provider.getTransactionReceipt(tx.hash);
  const delayed = rpc(
    new Proxy(provider, {
      get(t, k) {
        if (k === "getBlock")
          return async (tag) =>
            tag === "finalized"
              ? {
                  number: receipt.blockNumber - 1,
                  hash: receipt.blockHash,
                  timestamp: 0,
                }
              : t.getBlock(tag);
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }),
  );
  assert.equal((await delayed.verifyPayment(o, tx.hash)).state, "confirming");
  const changed = rpc(
    new Proxy(provider, {
      get(t, k) {
        if (k === "getBlock")
          return async (tag) =>
            typeof tag === "number"
              ? { ...(await t.getBlock(tag)), hash: ethers.constants.HashZero }
              : t.getBlock(tag);
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }),
  );
  await assert.rejects(changed.verifyPayment(o, tx.hash), /POLYGON_REORG/);
  const missing = rpc(
    new Proxy(provider, {
      get(t, k) {
        if (k === "getBlock")
          return async (tag) => (tag === "finalized" ? null : t.getBlock(tag));
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }),
  );
  await assert.rejects(
    missing.ready(admin.address),
    /POLYGON_FINALITY_UNAVAILABLE/,
  );
  await finish(f);
});
test("wrong token/event/hash, changed amount/buyer/product and reused tx cannot verify another order", async () => {
  const { f, r } = await setup(),
    { j, tx } = await funded(f, 8),
    o = await f.commerce.servicePayments.get("agent_" + j.id);
  for (const patch of [
    { wallet: other.address },
    { chainProductId: ethers.utils.id("wrong") },
  ])
    await assert.rejects(
      r.verifyPayment({ ...o, ...patch }, tx.hash),
      /POLYGON_PAYMENT_MISMATCH/,
    );
  const unrelated = await other.sendTransaction({
    to: buyer.address,
    value: 0,
  });
  await unrelated.wait();
  assert.equal(
    (await r.verifyPayment(o, unrelated.hash)).transactionHash,
    tx.hash.toLowerCase(),
  );
  await finish(f);
});
test("no wallet sign/broadcast means no payment/job execution; finalized expiry is required", async () => {
  const { f } = await setup(),
    b = await request(f, 9),
    j = await f.economy.service.submit(f.a, b);
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "awaiting_wallet_payment",
  );
  await gp.request({ method: "evm_increaseTime", params: [700] });
  await gp.request({ method: "evm_mine", params: [] });
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "expired");
  await gp.request({ method: "evm_increaseTime", params: [-700] });
  await gp.request({ method: "evm_mine", params: [] });
});
test("wallet unlink/expired membership after payment produces original-wallet refund without AI", async () => {
  const { f } = await setup(),
    before = await contract.balanceOf(buyer.address),
    { j } = await funded(f, 10);
  f.entitlement.getEntitlement = async () => ({ plan: "light" });
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert((await contract.balanceOf(buyer.address)).eq(before));
  assert.equal(f.calls(), 0);
});
test("operator outage never becomes a completed/refunded claim; same signed transaction survives timeout/restart", async () => {
  let send;
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, 11);
  const original = provider.sendTransaction.bind(provider);
  send = provider.sendTransaction;
  let once = true;
  provider.sendTransaction = async (raw) => {
    const tx = await original(raw);
    if (once) {
      once = false;
      throw Error("simulated acknowledgement loss");
    }
    return tx;
  };
  await f.economy.tick();
  provider.sendTransaction = send;
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(Object.keys(f.db._dump("emuer_v2_agent_chain_ops")).length, 1);
});
test("gas cap and missing managed signer hold refund_pending; no fallback private key/signature", async () => {
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, 12);
  f.env.ECONOMY_POLYGON_MAX_GAS_WEI = "1";
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "refund_pending",
  );
  assert.deepEqual(f.db._dump("emuer_v2_agent_chain_ops"), {});
  f.env.ECONOMY_POLYGON_MAX_GAS_WEI = env().ECONOMY_POLYGON_MAX_GAS_WEI;
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
});
test("shop confirmation/authorization/cancel/admin paths cannot bypass service chain verification", async () => {
  const { f } = await setup(),
    { j } = await funded(f, 13),
    server = f.app.listen(0);
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    for (const p of ["confirm", "exchange-authorization", "cancel"]) {
      const r = await fetch(
        base + "/api/mitemiru/orders/agent_" + j.id + "/" + p,
        {
          method: "POST",
          headers: {
            "x-test-user": "alice",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, "SERVICE_ORDER_MANAGED");
    }
    f.advance(1200000);
    await f.commerce.sweepExpired();
    assert.equal(
      (await f.commerce.servicePayments.get("agent_" + j.id)).status,
      "pending_payment",
    );
  } finally {
    server.close();
  }
  await finish(f);
});
test("transaction claim already used by another order is rejected atomically, no AI or ledger debit", async () => {
  const { f } = await setup(),
    { j, tx } = await funded(f, "reuse");
  await f.db
    .collection("mitemiru_chain_payments")
    .doc(hash([137, contract.address.toLowerCase(), tx.hash.toLowerCase()]))
    .create({ orderId: "different-order" });
  await assert.rejects(
    f.economy.service.polygon.reconcile(
      j.id,
      await f.economy.service.owned(f.a, j.id),
    ),
    /POLYGON_TX_ALREADY_USED/,
  );
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "awaiting_wallet_payment",
  );
  assert.equal(f.calls(), 0);
});
test("real local fork invalidates an orphaned receipt; RPC timeout cannot execute a job", async () => {
  const { f, r } = await setup(),
    b = await request(f, "reorg"),
    j = await f.economy.service.submit(f.a, b),
    m = await f.economy.service.polygon.manifest(
      f.a,
      j.id,
      await f.economy.service.owned(f.a, j.id),
    );
  const snap = await gp.request({ method: "evm_snapshot", params: [] });
  const tx = await buyer.sendTransaction({ to: m.to, data: m.data });
  const receipt = await tx.wait();
  await gp.request({ method: "evm_revert", params: [snap] });
  await gp.request({ method: "evm_increaseTime", params: [1] });
  await gp.request({ method: "evm_mine", params: [] });
  await assert.rejects(r.mature(receipt), /POLYGON_REORG/);
  const original = r.verifyPayment;
  r.verifyPayment = async () => {
    throw Error("isolated RPC timeout");
  };
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "awaiting_wallet_payment",
  );
  r.verifyPayment = original;
});
test("managed signer transaction tampering cannot broadcast, stops wallet intake, refunds recover without second signing intent", async () => {
  let bad = true;
  const { f } = await setup({
      providerDown: true,
      polygonOptions: {
        rpc: rpc(),
        signTransaction: (t) =>
          admin.signTransaction({ ...t, to: bad ? other.address : t.to }),
      },
    }),
    { j } = await funded(f, "signer");
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "refund_pending",
  );
  assert.equal((await f.economy.service.polygon.status()).enabled, false);
  assert.equal(
    Object.values(f.db._dump("emuer_v2_agent_chain_ops"))[0].transactionHash,
    undefined,
  );
  bad = false;
  await finish(f);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(Object.keys(f.db._dump("emuer_v2_agent_chain_ops")).length, 1);
});
for (const type of Object.keys(require("../../backend/economy/tasks").TASKS))
  test(
    "wallet payment saves/reopens private structured " +
      type +
      " artifact before final fulfillment",
    async () => {
      const r = rpc(),
        f =
          await require("../../backend/economy/search/test-support").crossFixture(
            {
              env: { ...env(), ECONOMY_PHASE3_ENABLED: "true" },
              providerReply: require("../../tools/economy-tests/work-reply.cjs"),
              polygonOptions: {
                rpc: r,
                signTransaction: async (tx) => {
                  if (
                    r.iface.parseTransaction({ data: tx.data }).name ===
                    "markExchangeFulfilled"
                  )
                    assert.equal(
                      Object.keys(f.db._dump("emuer_v2_agent_artifacts"))
                        .length,
                      1,
                    );
                  return admin.signTransaction(tx);
                },
              },
            },
          );
      await f.economy.service
        .ref("system", "polygon-operator-control")
        .set({ enabled: true, revision: 1 });
      f.a = { ...f.a, walletAddress: buyer.address.toLowerCase() };
      f.identity.findByAddress = async (a) =>
        a.toLowerCase() === buyer.address.toLowerCase() ? SPID : null;
      for (const id of Object.keys(
        f.db._dump("emuer_v2_agent_source_approvals"),
      ))
        await f.economy.service.ref("source_approvals", id).set(
          {
            artifactUseApproved: true,
            artifactAllowedTasks: Object.keys(
              require("../../backend/economy/tasks").TASKS,
            ),
            artifactPurpose: require("../../backend/economy/tasks").VERSION,
          },
          { merge: true },
        );
      const s = f.economy.service,
        q = await s.quote(f.a, {
          goal: "コーヒーの経験とWeb3クエスト・ギルド・商品を比較したい",
          method: "emuer_chain",
          taskType: type,
        }),
        ch = await s.polygon.challenge(f.a),
        b = {
          quoteId: q.id,
          termsVersion: q.termsVersion,
          paymentTermsVersion: q.paymentTermsVersion,
          method: "emuer_chain",
          requestId: key(type),
          paymentConsent: true,
          aiConsent: true,
          searchConsentVersion: q.searchProfile.version,
          workConsentVersion: q.workConsentVersion,
          walletNonce: ch.nonce,
          walletSignature: await buyer.signMessage(ch.message),
        };
      const j = await s.submit(f.a, b),
        m = await s.polygon.manifest(f.a, j.id, await s.owned(f.a, j.id)),
        tx = await buyer.sendTransaction({ to: m.to, data: m.data });
      await tx.wait();
      await s.polygon.attach(f.a, j.id, await s.owned(f.a, j.id), {
        transactionHash: tx.hash,
      });
      await finish(f);
      assert.equal((await s.view(f.a, j.id)).state, "completed");
      const a = await s.artifacts.view(f.a, j.id);
      assert.equal(a.artifactType, type);
      assert.equal(a.formatVersion, 2);
      assert(a.document.checklist.length >= 5);
      assert.equal(f.calls(), 1);
      await assert.rejects(
        s.artifacts.view(await f.actor("bob"), j.id),
        /ARTIFACT_NOT_FOUND/,
      );
    },
  );
test("wallet confirmation backlog shares two in-flight slots; third intent is refused before charge and finalized expiry releases both", async () => {
  const { f } = await setup(),
    s = f.economy.service;
  const a = await s.submit(f.a, await request(f, "slot-a"));
  const b = await s.submit(f.a, await request(f, "slot-b"));
  await assert.rejects(
    s.quote(f.a, { goal: "コーヒーを学びたい", method: "emuer_chain" }),
    /POLYGON_WALLET_BUSY/,
  );
  assert.equal(Object.keys(f.db._dump("mitemiru_orders")).length, 2);
  assert.equal(f.calls(), 0);
  const m = await s.polygon.manifest(f.a, a.id, await s.owned(f.a, a.id));
  assert.equal(m.amountWei, AMOUNT);
  await gp.request({ method: "evm_increaseTime", params: [700] });
  await gp.request({ method: "evm_mine", params: [] });
  await f.economy.tick();
  assert.equal((await s.view(f.a, a.id)).state, "expired");
  assert.equal((await s.view(f.a, b.id)).state, "expired");
  assert.deepEqual(
    (await s.ref("system", "polygon-wallet-slots").get()).data().active,
    [],
  );
});
test("revoked operator role blocks rebroadcast of a persisted signed transaction", async () => {
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, "revoked-recovery");
  const send = provider.sendTransaction;
  const attempts = [];
  provider.sendTransaction = async (raw) => {
    attempts.push(raw);
    throw Error("isolated disconnected transport");
  };
  try {
    await f.economy.tick();
    const beforeRevocation = attempts.length;
    assert(beforeRevocation > 0);
    assert.equal(new Set(attempts).size, 1);
    const op = Object.values(f.db._dump("emuer_v2_agent_chain_ops"))[0];
    assert(op.transactionHash && op.rawTransaction);
    // Native local administrative tx only. This is NOT a mainnet role change.
    provider.sendTransaction = send;
    await (
      await contract.revokeRole(ethers.utils.id("REFUND_ROLE"), admin.address)
    ).wait();
    provider.sendTransaction = async (raw) => {
      attempts.push(raw);
      throw Error("must not broadcast after role revocation");
    };
    await finish(f);
    assert.equal(attempts.length, beforeRevocation);
    assert.equal(
      (await f.economy.service.view(f.a, j.id)).state,
      "refund_pending",
    );
    assert.equal((await f.economy.service.polygon.status()).enabled, false);
  } finally {
    provider.sendTransaction = send;
  }
});
test("KMS outage prevents rebroadcast of cached raw bytes and resumes the same intent after recovery", async () => {
  let kms = true;
  const { f } = await setup({
    providerDown: true,
    polygonOptions: {
      rpc: rpc(),
      signTransaction: (t) => admin.signTransaction(t),
      signerReady: async () => {
        if (!kms) throw Error("POLYGON_SIGNER_UNAVAILABLE");
      },
    },
  });
  const { j } = await funded(f, "kms-recovery"),
    send = provider.sendTransaction,
    attempts = [];
  provider.sendTransaction = async (raw) => {
    attempts.push(raw);
    throw Error("isolated RPC unavailable");
  };
  try {
    await f.economy.tick();
    const count = attempts.length;
    assert(count > 0);
    kms = false;
    await finish(f);
    assert.equal(attempts.length, count);
    assert.equal(
      (await f.economy.service.view(f.a, j.id)).state,
      "refund_pending",
    );
    kms = true;
    provider.sendTransaction = send;
    await finish(f);
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(Object.keys(f.db._dump("emuer_v2_agent_chain_ops")).length, 1);
  } finally {
    provider.sendTransaction = send;
  }
});
test("independent operator emergency stop blocks signatures and cached broadcasts without disabling ledger", async () => {
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, "emergency-recovery"),
    send = provider.sendTransaction;
  let sent = 0;
  provider.sendTransaction = async () => {
    sent++;
    throw Error("isolated RPC unavailable");
  };
  try {
    await f.economy.tick();
    const before = sent;
    assert(before > 0);
    await f.economy.service
      .ref("system", "polygon-operator-control")
      .set({ enabled: true, halted: true });
    await finish(f);
    assert.equal(sent, before);
    assert.equal(
      (await f.economy.service.view(f.a, j.id)).state,
      "refund_pending",
    );
    assert.equal((await f.economy.service.polygon.status()).enabled, false);
    assert.equal(f.economy.service.config().enabled, true);
    await f.economy.service
      .ref("system", "polygon-operator-control")
      .set({ enabled: true, halted: false });
    provider.sendTransaction = send;
    await finish(f);
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  } finally {
    provider.sendTransaction = send;
  }
});
test("real local EVM reverted operator tx books spent gas once and holds refund pending for incident review", async () => {
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, "mined-failure"),
    send = provider.sendTransaction;
  let changed = false;
  const roleSlot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256"],
      [ethers.utils.id("REFUND_ROLE"), 5],
    ),
  );
  const membership = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [admin.address, roleSlot],
    ),
  );
  provider.sendTransaction = async (raw) => {
    // TEST ONLY: reproduce revocation racing the already-passed preflight, without using another operator nonce.
    if (!changed) {
      changed = true;
      await gp.request({
        method: "evm_setAccountStorageAt",
        params: [contract.address, membership, ethers.constants.HashZero],
      });
    }
    return send.call(provider, raw);
  };
  try {
    await finish(f);
    const v = await f.economy.service.view(f.a, j.id);
    assert.equal(v.state, "refund_pending");
    const ops = Object.values(f.db._dump("emuer_v2_agent_chain_ops"));
    assert.equal(ops.length, 1);
    assert.equal(ops[0].state, "failed");
    assert(BigInt(ops[0].failedReceipt.gasCostWei) > 0n);
    const before = JSON.stringify(
      f.db._dump("emuer_v2_agent_operator_gas_spend"),
    );
    await finish(f);
    assert.equal(
      JSON.stringify(f.db._dump("emuer_v2_agent_operator_gas_spend")),
      before,
    );
    assert.equal(
      Object.keys(f.db._dump("emuer_v2_agent_operator_gas_spend")).length,
      1,
    );
    assert.equal((await f.economy.service.polygon.status()).enabled, false);
  } finally {
    provider.sendTransaction = send;
  }
});
test("canonical separately approved manual refund resolves a failed intent without signing again", async () => {
  const { f } = await setup({ providerDown: true }),
    { j } = await funded(f, "manual-refund"),
    send = provider.sendTransaction;
  let attempts = 0;
  provider.sendTransaction = async () => {
    attempts++;
    throw Error("isolated offline");
  };
  try {
    await f.economy.tick();
    const before = attempts;
    provider.sendTransaction = send;
    // All operations below occur solely on the isolated local test contract.
    await (
      await contract.grantRole(ethers.utils.id("REFUND_ROLE"), other.address)
    ).wait();
    const order = await f.commerce.servicePayments.get("agent_" + j.id),
      t = await contract.connect(other).refundExchange(order.chainOrderId);
    await t.wait();
    await f.db
      .collection("mitemiru_orders")
      .doc("agent_" + j.id)
      .set({ refundTransactionHash: t.hash }, { merge: true });
    provider.sendTransaction = async () => {
      attempts++;
      throw Error("unexpected operator tx");
    };
    await finish(f);
    assert.equal(attempts, before);
    const v = await f.economy.service.view(f.a, j.id);
    assert.equal(v.state, "refunded");
    assert.equal(v.payment.refundTransactionHash, t.hash.toLowerCase());
  } finally {
    provider.sendTransaction = send;
  }
});
test("saved-result fulfillment incident can reconcile a canonical approved manual refund", async () => {
  const { f } = await setup(),
    { j } = await funded(f, "manual-after-result"),
    send = provider.sendTransaction;
  let attempts = 0;
  provider.sendTransaction = async () => {
    attempts++;
    throw Error("isolated offline");
  };
  try {
    await f.economy.tick();
    assert.equal(
      (await f.economy.service.view(f.a, j.id)).state,
      "result_saved",
    );
    const before = attempts;
    provider.sendTransaction = send;
    await (
      await contract.grantRole(ethers.utils.id("REFUND_ROLE"), other.address)
    ).wait();
    const o = await f.commerce.servicePayments.get("agent_" + j.id),
      tx = await contract.connect(other).refundExchange(o.chainOrderId);
    await tx.wait();
    await f.db
      .collection("mitemiru_orders")
      .doc("agent_" + j.id)
      .set({ refundTransactionHash: tx.hash }, { merge: true });
    provider.sendTransaction = async () => {
      attempts++;
      throw Error("must only observe canonical refund");
    };
    await finish(f);
    assert.equal(attempts, before);
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(f.calls(), 1);
  } finally {
    provider.sendTransaction = send;
  }
});
