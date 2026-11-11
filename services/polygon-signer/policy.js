"use strict";
const ethers = require("ethers");
const crypto = require("node:crypto");
const TOKEN = "0x9c102cC3016C70767082b60196565878D9314864";
const PRODUCT = "agent_schoolpark-explorer-v1";
const iface = new ethers.utils.Interface([
  "function refundExchange(bytes32)",
  "function markExchangeFulfilled(bytes32)",
]);
const hash = (x) =>
  crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const reject = () => {
  throw Error("SIGNING_POLICY_DENIED");
};
function authenticate(header, secret) {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof header !== "string"
  )
    return false;
  const a = Buffer.from(header),
    b = Buffer.from("Bearer " + secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Defense in depth only. The existing on-chain REFUND_ROLE is global, not order-scoped.
function createSigningPolicy({
  db,
  provider,
  signer,
  codeHash,
  env,
  now = Date.now,
}) {
  const ref = (k, id) => db.collection("emuer_v2_agent_" + k).doc(id);
  const unsigned = (t) =>
    ethers.utils.serializeTransaction(
      Object.fromEntries(
        ["chainId", "to", "data", "value", "nonce", "gasLimit", "gasPrice"].map(
          (k) => [k, t[k]],
        ),
      ),
    );
  function request(b) {
    if (
      env.POLYGON_SIGNER_ENABLED !== "true" ||
      b?.version !== 1 ||
      b.purpose !== "schoolpark-emuer-service" ||
      !/^[a-f0-9]{64}$/.test(b.operationId || "") ||
      b.requestId !== b.operationId ||
      !Number.isSafeInteger(b.expiresAtMs) ||
      b.expiresAtMs <= now() ||
      b.expiresAtMs > now() + 60000
    )
      reject();
    const t = b.transaction;
    if (
      !t ||
      Object.keys(t).some(
        (k) =>
          ![
            "chainId",
            "to",
            "data",
            "value",
            "nonce",
            "gasLimit",
            "gasPrice",
          ].includes(k),
      ) ||
      t.chainId !== 137 ||
      t.to?.toLowerCase() !== TOKEN.toLowerCase() ||
      !ethers.BigNumber.from(t.value).isZero() ||
      !Number.isSafeInteger(t.nonce) ||
      t.nonce < 0
    )
      reject();
    let parsed;
    try {
      parsed = iface.parseTransaction({ data: t.data });
    } catch (_) {
      reject();
    }
    if (
      iface.encodeFunctionData(parsed.name, [parsed.args[0]]) !== t.data ||
      hash([137, TOKEN, parsed.args[0], parsed.name]) !== b.operationId
    )
      reject();
    for (const [v, k] of [
      [
        t.gasLimit,
        parsed.name === "refundExchange"
          ? "REFUND_GAS_LIMIT"
          : "FULFILL_GAS_LIMIT",
      ],
      [t.gasPrice, "MAX_FEE_WEI"],
    ])
      if (
        !/^[1-9][0-9]{0,29}$/.test(env["ECONOMY_POLYGON_" + k] || "") ||
        ethers.BigNumber.from(v).lte(0) ||
        ethers.BigNumber.from(v).gt(env["ECONOMY_POLYGON_" + k])
      )
        reject();
    return {
      t,
      method: parsed.name,
      chainOrderId: parsed.args[0],
      fingerprint: ethers.utils.keccak256(unsigned(t)),
    };
  }
  async function inspect(tx, b, p) {
    const opRef = ref("chain_ops", b.operationId),
      cacheRef = ref("signatures", b.operationId),
      lockRef = ref("system", "polygon-operator-slot"),
      nonceRef = ref(
        "signer_nonces",
        signer.address.toLowerCase() + "_" + p.t.nonce,
      );
    const [os, cache, lock, nonce, control] = await Promise.all([
      tx.get(opRef),
      tx.get(cacheRef),
      tx.get(lockRef),
      tx.get(nonceRef),
      tx.get(ref("system", "polygon-operator-control")),
    ]);
    const op = os.data();
    if (
      control.data()?.enabled !== true ||
      control.data()?.halted === true ||
      !op ||
      lock.data()?.active !== b.operationId ||
      op.method !== p.method ||
      op.chainOrderId !== p.chainOrderId ||
      unsigned(op.transaction) !== unsigned(p.t) ||
      !/^agent_[a-f0-9]{40}$/.test(op.orderId || "") ||
      op.orderId !== "agent_" + op.jobId
    )
      reject();
    const [order, job, reserve, artifact] = await Promise.all([
      tx.get(db.collection("mitemiru_orders").doc(op.orderId)),
      tx.get(ref("jobs", op.jobId)),
      tx.get(ref("gas_reservations", op.orderId)),
      tx.get(ref("artifacts", op.jobId)),
    ]);
    const o = order.data(),
      j = job.data(),
      r = reserve.data();
    if (
      !o ||
      !j ||
      !r ||
      o.productId !== PRODUCT ||
      o.storeType !== "agent_service" ||
      o.method !== "emuer_chain" ||
      o.paymentSource !== "polygon_wallet" ||
      o.amount !== 5 ||
      o.amountWei !== "5000000000000000000" ||
      o.chainId !== 137 ||
      o.tokenAddress?.toLowerCase() !== TOKEN.toLowerCase() ||
      o.chainOrderId !== p.chainOrderId ||
      o.chainOrderId !== ethers.utils.id("emuer-economy:" + op.orderId) ||
      o.chainProductId !== ethers.utils.id(PRODUCT) ||
      o.serviceJobId !== op.jobId ||
      o.uid !== j.uid ||
      o.passportId !== j.spid ||
      o.wallet !== j.walletAddress ||
      j.paymentSource !== "polygon_wallet" ||
      j.orderId !== op.orderId ||
      o.status !== "paid" ||
      r.operatorAddress !== signer.address.toLowerCase() ||
      r.state !== "held" ||
      r.orderId !== op.orderId ||
      ethers.BigNumber.from(p.t.gasLimit).mul(p.t.gasPrice).gt(r.heldWei)
    )
      reject();
    if (
      j.state !==
      (p.method === "refundExchange" ? "refund_pending" : "result_saved")
    )
      reject();
    if (
      p.method === "markExchangeFulfilled" &&
      (!artifact.exists ||
        artifact.data().ownerUid !== j.uid ||
        artifact.data().jobId !== op.jobId)
    )
      reject();
    if (nonce.exists && nonce.data().fingerprint !== p.fingerprint) reject();
    if (cache.exists && cache.data().fingerprint !== p.fingerprint) reject();
    return { op, o, cache: cache.data(), cacheRef, nonceRef };
  }
  async function sign(b) {
    const p = request(b);
    await ready();
    if (
      !/^0x[a-f0-9]{64}$/i.test(codeHash || "") ||
      (await provider.getNetwork()).chainId !== 137 ||
      ethers.utils.keccak256(await provider.getCode(TOKEN)) !== codeHash
    )
      reject();
    let ctx;
    await db.runTransaction(async (tx) => {
      ctx = await inspect(tx, b, p);
      if (!ctx.cache)
        tx.set(ctx.nonceRef, {
          fingerprint: p.fingerprint,
          operationId: b.operationId,
        });
    });
    if (ctx.cache) return ctx.cache.rawTransaction;
    const c = new ethers.Contract(
      TOKEN,
      [
        "function hasRole(bytes32,address) view returns(bool)",
        "function orders(bytes32) view returns(address buyer,bytes32 productId,uint256 paid,bool fulfilled,bool refunded)",
      ],
      provider,
    );
    const live = await c.orders(p.chainOrderId);
    if (
      !(await c.hasRole(ethers.utils.id("REFUND_ROLE"), signer.address)) ||
      live.buyer.toLowerCase() !== ctx.o.wallet ||
      live.productId !== ctx.o.chainProductId ||
      live.paid.toString() !== ctx.o.amountWei ||
      live.fulfilled ||
      live.refunded ||
      (await provider.getTransactionCount(signer.address, "pending")) !==
        p.t.nonce
    )
      reject();
    const raw = await signer.signTransaction(p.t);
    if (
      ethers.utils.parseTransaction(raw).from !== signer.address ||
      unsigned(ethers.utils.parseTransaction(raw)) !== unsigned(p.t)
    )
      reject();
    request(b);
    let saved;
    await db.runTransaction(async (tx) => {
      const x = await inspect(tx, b, p);
      saved = x.cache?.rawTransaction || raw;
      if (!x.cache)
        tx.create(x.cacheRef, {
          fingerprint: p.fingerprint,
          rawTransaction: raw,
          transactionHash: ethers.utils.keccak256(raw),
          createdAtMs: now(),
          keyAddress: signer.address,
        });
    });
    return saved;
  }
  async function ready() {
    if (
      env.POLYGON_SIGNER_ENABLED !== "true" ||
      !/^0x[a-f0-9]{64}$/i.test(codeHash || "")
    )
      reject();
    const control = (
      await ref("system", "polygon-operator-control").get()
    ).data();
    if (control?.enabled !== true || control.halted === true) reject();
    await signer.validate();
    if (
      (await provider.getNetwork()).chainId !== 137 ||
      ethers.utils.keccak256(await provider.getCode(TOKEN)) !== codeHash
    )
      reject();
    const contract = new ethers.Contract(
      TOKEN,
      ["function hasRole(bytes32,address) view returns(bool)"],
      provider,
    );
    if (
      !(await contract.hasRole(ethers.utils.id("REFUND_ROLE"), signer.address))
    )
      reject();
    return {
      ready: true,
      chainId: 137,
      tokenAddress: TOKEN,
      operatorAddress: signer.address,
    };
  }
  return { sign, request, ready };
}
module.exports = { createSigningPolicy, authenticate, TOKEN, PRODUCT };
