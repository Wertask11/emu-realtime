"use strict";
const ethers = require("ethers"),
  { hash, fail, day } = require("./config");
const { policy } = require("./polygon-config");
// One durable signing/broadcast slot. No user/administrator private key is accepted here.
function createOperator({ db, ref, rpc, env, now, signTransaction }) {
  const lock = ref("system", "polygon-operator-slot");
  async function remote(tx) {
    if (!env.ECONOMY_POLYGON_SIGNER_TOKEN)
      fail("POLYGON_SIGNER_UNCONFIGURED", 503);
    const r = await fetch(env.ECONOMY_POLYGON_SIGNER_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.ECONOMY_POLYGON_SIGNER_TOKEN,
      },
      body: JSON.stringify({
        transaction: tx,
        purpose: "schoolpark-emuer-service",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) fail("POLYGON_SIGNER_UNAVAILABLE", 503);
    const body = await r.text();
    if (body.length > 32000) fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
    return JSON.parse(body).signedTransaction;
  }
  async function ensure(q, method) {
    if (!["refundExchange", "markExchangeFulfilled"].includes(method))
      fail("POLYGON_OPERATION_INVALID", 400);
    if (policy(env).blockers.some((b) => b !== "POLYGON_ENABLED_REQUIRED"))
      fail("POLYGON_OPERATOR_UNCONFIGURED", 503);
    await rpc.assertContract();
    const live = await rpc.order(q.chainOrderId);
    if (!rpc.matches(live, q)) fail("POLYGON_PAYMENT_UNRESOLVED", 503);
    const opId = hash([rpc.chainId, rpc.token, q.chainOrderId, method]),
      or = ref("chain_ops", opId),
      operator = ethers.utils.getAddress(env.ECONOMY_POLYGON_OPERATOR_ADDRESS);
    async function finish(v) {
      await db.runTransaction(async (tx) => {
        const [l, o] = await Promise.all([tx.get(lock), tx.get(or)]);
        if (o.exists)
          tx.set(
            or,
            {
              ...v,
              state: "confirmed",
              rawTransaction: null,
              updatedAt: now(),
            },
            { merge: true },
          );
        if (l.data()?.active === opId) tx.set(lock, { active: null });
      });
      return v;
    }
    let o = (await or.get()).data();
    const completed =
      method === "refundExchange" ? live.refunded : live.fulfilled;
    if (completed) {
      const v = await rpc.verifyOperation(
        q,
        method,
        o?.transactionHash ||
          q[
            method === "refundExchange"
              ? "refundTransactionHash"
              : "fulfillmentTransactionHash"
          ],
      );
      if (v) return finish(v);
      fail("POLYGON_OPERATION_PENDING", 409);
    }
    if (live.refunded || live.fulfilled)
      fail("POLYGON_OPERATION_CONFLICT", 409);
    if (!o) {
      if (
        !(await rpc.contract.hasRole(ethers.utils.id("REFUND_ROLE"), operator))
      )
        fail("POLYGON_REFUND_NOT_READY", 503);
      const data = rpc.iface.encodeFunctionData(method, [q.chainOrderId]);
      const gas = await rpc.provider.estimateGas({
        from: operator,
        to: rpc.token,
        data,
        value: 0,
      });
      const gasPrice = await rpc.provider.getGasPrice(),
        cost = BigInt(gas.toString()) * BigInt(gasPrice.toString());
      if (cost > BigInt(env.ECONOMY_POLYGON_MAX_GAS_WEI))
        fail("POLYGON_GAS_CAP_EXCEEDED", 503);
      if ((await rpc.provider.getBalance(operator)).lt(gas.mul(gasPrice)))
        fail("POLYGON_OPERATOR_GAS_UNAVAILABLE", 503);
      const nonce = await rpc.provider.getTransactionCount(operator, "pending"),
        gasDay = day(now()),
        gr = ref("operator_gas", gasDay);
      await db.runTransaction(async (tx) => {
        const [s, l, g] = await Promise.all([
          tx.get(or),
          tx.get(lock),
          tx.get(gr),
        ]);
        if (s.exists) return;
        if (l.data()?.active && l.data().active !== opId)
          fail("POLYGON_OPERATOR_BUSY", 409);
        const reserved = BigInt(g.data()?.reservedWei || "0");
        if (reserved + cost > BigInt(env.ECONOMY_POLYGON_DAILY_GAS_WEI))
          fail("POLYGON_GAS_CAP_EXCEEDED", 503);
        tx.create(or, {
          chainOrderId: q.chainOrderId,
          method,
          state: "signing",
          createdAt: now(),
          updatedAt: now(),
          transaction: {
            chainId: rpc.chainId,
            to: rpc.token,
            data,
            value: "0x0",
            nonce,
            gasLimit: gas.toHexString(),
            gasPrice: gasPrice.toHexString(),
          },
          reservedGasWei: cost.toString(),
          gasDay,
        });
        tx.set(lock, { active: opId });
        tx.set(
          gr,
          { reservedWei: (reserved + cost).toString() },
          { merge: true },
        );
      });
      o = (await or.get()).data();
    }
    if (!o.transactionHash) {
      const raw = await (signTransaction || remote)(o.transaction);
      if (
        typeof raw !== "string" ||
        !/^0x[0-9a-f]+$/i.test(raw) ||
        raw.length > 32000
      )
        fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
      const p = ethers.utils.parseTransaction(raw),
        t = o.transaction;
      if (
        p.chainId !== rpc.chainId ||
        p.from?.toLowerCase() !== operator.toLowerCase() ||
        p.to?.toLowerCase() !== rpc.token.toLowerCase() ||
        p.data !== t.data ||
        !p.value.isZero() ||
        p.nonce !== t.nonce ||
        !p.gasLimit.eq(t.gasLimit) ||
        !p.gasPrice?.eq(t.gasPrice)
      )
        fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
      await db.runTransaction(async (tx) => {
        const s = (await tx.get(or)).data();
        if (!s.transactionHash)
          tx.set(
            or,
            {
              rawTransaction: raw,
              transactionHash: ethers.utils.keccak256(raw),
              state: "broadcast_pending",
              updatedAt: now(),
            },
            { merge: true },
          );
      });
      o = (await or.get()).data();
    }
    const verified = await rpc.verifyOperation(q, method, o.transactionHash);
    if (verified) {
      return finish(verified);
    }
    const receipt = await rpc.provider.getTransactionReceipt(o.transactionHash);
    if (receipt?.status === 0) fail("POLYGON_OPERATOR_TX_FAILED", 503);
    if (!receipt) {
      // The exact signed bytes/hash survive a timeout/restart. No replacement nonce or automatic gas bump.
      try {
        await rpc.provider.sendTransaction(o.rawTransaction);
      } catch (_) {
        fail("POLYGON_OPERATION_PENDING", 409);
      }
    }
    fail("POLYGON_OPERATION_PENDING", 409);
  }
  return { ensure };
}
module.exports = { createOperator };
