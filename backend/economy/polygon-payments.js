"use strict";
const ethers = require("ethers");
const { randomUUID } = require("node:crypto");
const { hash, fail } = require("./config");
const { AMOUNT, TERMS, policy } = require("./polygon-config");
const { createPolygonRPC } = require("./polygon-rpc");
const { createOperator } = require("./polygon-operator");
// Shares Mitemiru orders and the existing economy jobs; no second balance/ledger.
function createPolygonPayments({
  db,
  ref,
  base,
  identity,
  env,
  now,
  requireAccess,
  requireIntake,
  rpc: injectedRPC,
  signTransaction,
}) {
  let rpc = injectedRPC;
  const walletSlots = ref("system", "polygon-wallet-slots");
  async function admission() {
    if (((await walletSlots.get()).data()?.active || []).length >= 2)
      fail("POLYGON_WALLET_BUSY", 429);
  }
  const releaseSlot = (tx, s, id) =>
    tx.set(walletSlots, {
      active: (s.data()?.active || []).filter((v) => v !== id),
    });
  const orderRef = (id) => db.collection("mitemiru_orders").doc(id);
  function chain() {
    if (!rpc) {
      if (!env.POLYGON_RPC_URL || !env.EMUER_V2_AUTHORIZER_PRIVATE_KEY)
        fail("POLYGON_UNCONFIGURED", 503);
      const provider = new ethers.providers.JsonRpcProvider(
        env.POLYGON_RPC_URL,
      );
      rpc = createPolygonRPC({
        provider,
        signer: new ethers.Wallet(env.EMUER_V2_AUTHORIZER_PRIVATE_KEY),
        codeHash: env.ECONOMY_POLYGON_CODE_HASH,
      });
    }
    return rpc;
  }
  async function ready(a) {
    if (!policy(env).enabled) fail("PAYMENT_METHOD_DISABLED", 503);
    await requireAccess(a);
    if ((await ref("system", "polygon-safety").get()).data()?.stopped)
      fail("POLYGON_SAFETY_STOPPED", 503);
    const wallet = String(a.walletAddress || "").toLowerCase();
    if (
      !/^0x[0-9a-f]{40}$/.test(wallet) ||
      (await identity.findByAddress(wallet)) !== a.spid
    )
      fail("POLYGON_WALLET_NOT_LINKED", 403);
    const r = chain();
    await r.ready(env.ECONOMY_POLYGON_OPERATOR_ADDRESS);
    if ((await r.provider.getCode(wallet)) !== "0x")
      fail("POLYGON_EOA_REQUIRED", 403);
    return wallet;
  }
  async function status() {
    const p = policy(env);
    if (!p.enabled) return p;
    if ((await ref("system", "polygon-safety").get()).data()?.stopped)
      return { ...p, enabled: false, blockers: ["POLYGON_SAFETY_STOPPED"] };
    try {
      await chain().ready(env.ECONOMY_POLYGON_OPERATOR_ADDRESS);
      return p;
    } catch (_) {
      return {
        ...p,
        enabled: false,
        blockers: ["POLYGON_READINESS_UNVERIFIED"],
      };
    }
  }
  async function purge() {
    const s = await db
      .collection("emuer_v2_agent_wallet_challenges")
      .where("deleteAfter", "<=", new Date(now()))
      .limit(100)
      .get();
    for (const d of s.docs) await d.ref.delete();
  }
  async function challenge(a) {
    if (requireIntake) await requireIntake(a);
    const wallet = await ready(a),
      nonce = randomUUID(),
      expiresAtMs = now() + 300000;
    const message = [
      "Emu for SchoolPark: 冷蔵庫くんに頼む",
      "Origin: https://emu-for-schoolpark.vercel.app",
      "Purpose: bind one 5 EMUER exchange order (not a transfer)",
      "Chain: " + chain().chainId,
      "Token: " + chain().token,
      "Wallet: " + wallet,
      "Subject: " + hash([a.uid, a.spid]),
      "Nonce: " + nonce,
      "Expires: " + new Date(expiresAtMs).toISOString(),
    ].join("\n");
    await ref("wallet_challenges", hash([a.uid, nonce])).create({
      uid: a.uid,
      spid: a.spid,
      wallet,
      message,
      expiresAtMs,
      usedBy: null,
      deleteAfter: new Date(now() + 86400000),
    });
    return {
      nonce,
      message,
      walletAddress: wallet,
      chainId: chain().chainId,
      expiresAtMs,
    };
  }
  async function proof(tx, a, b, jobId) {
    if (
      !/^[a-f0-9-]{36}$/.test(b.walletNonce || "") ||
      !/^0x[0-9a-f]{130}$/i.test(b.walletSignature || "")
    )
      fail("POLYGON_OWNERSHIP_REQUIRED", 400);
    const r = ref("wallet_challenges", hash([a.uid, b.walletNonce])),
      v = (await tx.get(r)).data();
    if (
      !v ||
      v.uid !== a.uid ||
      v.spid !== a.spid ||
      v.wallet !== String(a.walletAddress).toLowerCase() ||
      v.expiresAtMs <= now() ||
      (v.usedBy && v.usedBy !== jobId)
    )
      fail("POLYGON_OWNERSHIP_EXPIRED", 403);
    let address;
    try {
      address = ethers.utils
        .verifyMessage(v.message, b.walletSignature)
        .toLowerCase();
    } catch (_) {
      fail("POLYGON_OWNERSHIP_REQUIRED", 403);
    }
    if (address !== v.wallet) fail("POLYGON_OWNERSHIP_REQUIRED", 403);
    return () => tx.set(r, { usedBy: jobId }, { merge: true });
  }
  function own(o, a, id) {
    if (
      !o ||
      o.uid !== a.uid ||
      o.passportId !== a.spid ||
      o.serviceJobId !== id ||
      o.method !== "emuer_chain"
    )
      fail("JOB_NOT_FOUND", 404);
  }
  const operator = () =>
    createOperator({ db, ref, rpc: chain(), env, now, signTransaction });
  async function pay(args) {
    if (args.paymentSource !== "polygon_wallet") return base.pay(args);
    const { id, actor: a, jobId, productId, gate } = args;
    if (
      !/^agent_[a-f0-9]{40}$/.test(id) ||
      productId !== "agent_schoolpark-explorer-v1"
    )
      fail("INVALID_SERVICE_ORDER", 400);
    const wallet = await ready(a),
      r = chain(),
      createdBlock = await r.provider.getBlockNumber();
    const metadata = {
      wallet,
      chainId: r.chainId,
      tokenAddress: r.token,
      amountWei: AMOUNT,
      chainOrderId: ethers.utils.id("emuer-economy:" + id),
      chainProductId: ethers.utils.id(productId),
      createdBlock,
      deadline: Math.floor(
        Math.min(args.paymentUntilMs, args.trialEndMs) / 1000,
      ),
    };
    const pr = ref("products", productId),
      or = orderRef(id);
    await db.runTransaction(async (tx) => {
      const [os, ps, js, slots] = await Promise.all([
        tx.get(or),
        tx.get(pr),
        tx.get(gate.ref),
        tx.get(walletSlots),
      ]);
      if (os.exists) {
        own(os.data(), a, jobId);
        return;
      }
      const active = slots.data()?.active || [];
      if (active.length >= 2) fail("POLYGON_WALLET_BUSY", 429);
      gate.validate(js, ps);
      if (ps.data()?.status !== "live" || ps.data()?.prices?.EMUER !== 5)
        fail("SERVICE_PRICE_UNAVAILABLE", 409);
      tx.create(or, {
        ...metadata,
        uid: a.uid,
        passportId: a.spid,
        serviceJobId: jobId,
        productId,
        productName: "冷蔵庫くんに頼む",
        amount: 5,
        currency: "EMUER",
        paymentSource: "polygon_wallet",
        method: "emuer_chain",
        storeType: "agent_service",
        status: "pending_payment",
        paymentStatus: "pending",
        refundStatus: "none",
        createdAtMs: now(),
        updatedAtMs: now(),
        // Shop reservation sweeper must not expire a possibly broadcast payment.
        // Only finalized chain time + an empty order can close this intent.
        walletPaymentUntilMs: args.paymentUntilMs,
        paymentTermsVersion: TERMS,
      });
      tx.set(gate.ref, gate.patch, { merge: true });
      tx.set(walletSlots, { active: [...active, id] });
    });
    return base.get(id);
  }
  async function manifest(a, id, j) {
    if (requireIntake) await requireIntake(a);
    await ready(a);
    const o = await base.get(j.orderId);
    own(o, a, id);
    if (o.wallet !== String(a.walletAddress).toLowerCase())
      fail("POLYGON_WALLET_CHANGED", 403);
    if (
      j.state !== "awaiting_wallet_payment" ||
      o.status !== "pending_payment" ||
      o.deadline * 1000 <= now()
    )
      fail("POLYGON_PAYMENT_CLOSED", 409);
    return {
      orderId: j.orderId,
      jobId: id,
      walletAddress: o.wallet,
      deadline: o.deadline,
      price: 5,
      refund: policy(env).refund,
      paymentTermsVersion: TERMS,
      ...(await chain().authorization(o)),
    };
  }
  async function attach(a, id, j, b) {
    await requireAccess(a);
    const or = orderRef(j.orderId),
      o = (await or.get()).data();
    own(o, a, id);
    if (!/^0x[a-f0-9]{64}$/i.test(b.transactionHash || ""))
      fail("POLYGON_INVALID_TX_HASH", 400);
    if (o.wallet !== String(a.walletAddress).toLowerCase())
      fail("POLYGON_WALLET_CHANGED", 403);
    // A hint never proves payment; canonical event/order discovery recovers replaced/missing hashes.
    if (!o.transactionHash)
      await or.set(
        {
          transactionHint: b.transactionHash.toLowerCase(),
          updatedAtMs: now(),
        },
        { merge: true },
      );
  }
  async function reconcile(id, j) {
    const or = orderRef(j.orderId),
      o = (await or.get()).data();
    if (!o || o.serviceJobId !== id || o.paymentSource !== "polygon_wallet")
      fail("INVALID_SERVICE_ORDER", 409);
    const v = await chain().verifyPayment(
      o,
      o.transactionHash || o.transactionHint,
    );
    if (!["paid", "expired"].includes(v.state)) return;
    const jr = ref("jobs", id),
      used =
        v.state === "paid"
          ? db
              .collection("mitemiru_chain_payments")
              .doc(
                hash([
                  o.chainId,
                  o.tokenAddress.toLowerCase(),
                  v.transactionHash,
                ]),
              )
          : null;
    await db.runTransaction(async (tx) => {
      const [os, js, us, slots] = await Promise.all([
        tx.get(or),
        tx.get(jr),
        used ? tx.get(used) : null,
        tx.get(walletSlots),
      ]);
      if (js.data()?.state !== "awaiting_wallet_payment") return;
      if (
        os.data()?.serviceJobId !== id ||
        os.data()?.wallet !== j.walletAddress
      )
        fail("POLYGON_PAYMENT_MISMATCH", 409);
      if (us?.exists && us.data().orderId !== j.orderId)
        fail("POLYGON_TX_ALREADY_USED", 409);
      const state = v.state === "paid" ? "queued" : "expired";
      if (v.state === "expired") releaseSlot(tx, slots, j.orderId);
      if (used && !us.exists)
        tx.create(used, {
          orderId: j.orderId,
          kind: "agent-emuer-exchange",
          createdAtMs: now(),
        });
      tx.set(
        or,
        {
          ...(v.state === "paid" ? v : {}),
          status: v.state === "paid" ? "paid" : "expired",
          paymentStatus: v.state,
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(
        jr,
        {
          state,
          updatedAtMs: now(),
          ...(v.state === "paid" ? { paidAtMs: now() } : {}),
          events: [...(js.data().events || []), { state, atMs: now() }],
        },
        { merge: true },
      );
    });
  }
  async function beforeWork(j) {
    if (j.paymentSource !== "polygon_wallet") return;
    const o = await base.get(j.orderId),
      r = chain(),
      v = await r.verifyPayment(o, o.transactionHash);
    if (
      v.state !== "paid" ||
      (o.transactionHash && v.transactionHash !== o.transactionHash) ||
      v.live.refunded ||
      v.live.fulfilled
    )
      fail("POLYGON_PAYMENT_NOT_FINAL", 409);
    if ((await identity.findByAddress(o.wallet)) !== j.spid)
      fail("POLYGON_WALLET_CHANGED", 403);
  }
  async function finish(id, jobId, method) {
    const o = await base.get(id);
    if (o?.method !== "emuer_chain")
      return method === "refundExchange"
        ? base.refund(id, jobId)
        : base.fulfill(id, jobId);
    if (o.serviceJobId !== jobId || o.storeType !== "agent_service")
      fail("INVALID_SERVICE_ORDER", 409);
    const isRefund = method === "refundExchange",
      status = isRefund ? "refunded" : "fulfilled";
    if (o.status === status) return o;
    const j = (await ref("jobs", jobId).get()).data();
    if (!j || j.state !== (isRefund ? "refund_pending" : "result_saved"))
      fail("POLYGON_OPERATION_CONFLICT", 409);
    if (isRefund)
      await orderRef(id).set({ refundStatus: "pending" }, { merge: true });
    let v;
    try {
      if (!isRefund) {
        const p = await chain().verifyPayment(o, o.transactionHash);
        if (
          p.state !== "paid" ||
          p.live.refunded ||
          p.transactionHash !== o.transactionHash
        )
          fail("POLYGON_PAYMENT_NOT_FINAL", 409);
      }
      v = await operator().ensure(o, method);
    } catch (e) {
      if (
        !["POLYGON_OPERATION_PENDING", "POLYGON_OPERATOR_BUSY"].includes(
          e.message,
        )
      )
        await ref("system", "polygon-safety").set(
          {
            stopped: true,
            reason: "POLYGON_OPERATOR_REVIEW_REQUIRED",
            atMs: now(),
          },
          { merge: true },
        );
      throw e;
    }
    await db.runTransaction(async (tx) => {
      const [os, slots] = await Promise.all([
        tx.get(orderRef(id)),
        tx.get(walletSlots),
      ]);
      const s = os.data();
      if (s.status === status) return;
      if (s.status !== "paid") fail("POLYGON_OPERATION_CONFLICT", 409);
      releaseSlot(tx, slots, id);
      tx.set(
        orderRef(id),
        {
          status,
          paymentStatus: isRefund ? "refunded" : "fulfilled",
          refundStatus: isRefund ? "confirmed" : "none",
          [isRefund ? "refundTransactionHash" : "fulfillmentTransactionHash"]:
            v.transactionHash,
          [isRefund ? "refundConfirmation" : "fulfillmentConfirmation"]: v,
          updatedAtMs: now(),
        },
        { merge: true },
      );
    });
    return base.get(id);
  }
  return {
    ...base,
    get: (id) => base.get(id),
    pay,
    refund: (id, j) => finish(id, j, "refundExchange"),
    fulfill: (id, j) => finish(id, j, "markExchangeFulfilled"),
    beforeWork,
    polygon: {
      admission,
      policy: () => policy(env),
      status,
      purge,
      ready,
      challenge,
      proof,
      manifest,
      attach,
      reconcile,
      chain,
    },
  };
}
module.exports = { createPolygonPayments };
