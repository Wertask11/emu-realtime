"use strict";
const ethers = require("ethers"),
  { hash, fail } = require("./config");
const { policy } = require("./polygon-config");
// One durable signing/broadcast slot. No user/administrator private key is accepted here.
function createOperator({
  db,
  ref,
  rpc,
  env,
  now,
  signTransaction,
  signerReady,
  gasBudget,
}) {
  const lock = ref("system", "polygon-operator-slot");
  async function remote(tx, context) {
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
        version: 1,
        ...context,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) fail("POLYGON_SIGNER_UNAVAILABLE", 503);
    const body = await r.text();
    if (body.length > 32000) fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
    return JSON.parse(body).signedTransaction;
  }
  async function control() {
    const v = (await ref("system", "polygon-operator-control").get()).data();
    if (v?.enabled !== true || v.halted === true)
      fail("POLYGON_OPERATOR_STOPPED", 503);
  }
  async function ready() {
    await control();
    if (signerReady) return signerReady();
    if (signTransaction) return; // Isolated test injection only; production has no local signer.
    const url = new URL(env.ECONOMY_POLYGON_SIGNER_URL);
    url.pathname = "/ready";
    const r = await fetch(url, {
      redirect: "error",
      headers: { Authorization: "Bearer " + env.ECONOMY_POLYGON_SIGNER_TOKEN },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) fail("POLYGON_SIGNER_UNAVAILABLE", 503);
    const text = await r.text();
    if (text.length > 2000) fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
    const body = JSON.parse(text);
    if (
      body.ready !== true ||
      body.chainId !== rpc.chainId ||
      body.tokenAddress?.toLowerCase() !== rpc.token.toLowerCase() ||
      body.operatorAddress?.toLowerCase() !==
        env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase()
    )
      fail("POLYGON_SIGNER_INVALID_RESPONSE", 503);
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
      // A separately approved administrator may have settled a stuck obligation.
      // A private hint is only evidence to verify, never proof of returned funds.
      const manual =
        q[
          method === "refundExchange"
            ? "refundTransactionHash"
            : "fulfillmentTransactionHash"
        ];
      const hint = manual || o?.transactionHash;
      const v = await rpc.verifyOperation(q, method, hint);
      if (v) return finish(v);
      fail("POLYGON_OPERATION_PENDING", 409);
    }
    if (live.refunded || live.fulfilled)
      fail("POLYGON_OPERATION_CONFLICT", 409);
    if (!o) {
      await control();
      if (
        !(await rpc.contract.hasRole(ethers.utils.id("REFUND_ROLE"), operator))
      )
        fail("POLYGON_REFUND_NOT_READY", 503);
      const data = rpc.iface.encodeFunctionData(method, [q.chainOrderId]);
      const estimated = await rpc.provider.estimateGas({
        from: operator,
        to: rpc.token,
        data,
        value: 0,
      });
      const gas = estimated.mul(125).add(99).div(100);
      const gasPrice = await rpc.provider.getGasPrice(),
        cost = BigInt(gas.toString()) * BigInt(gasPrice.toString());
      const gasLimitCap = gasBudget.config(
        method === "refundExchange" ? "REFUND_GAS_LIMIT" : "FULFILL_GAS_LIMIT",
      );
      if (
        BigInt(gas.toString()) > gasLimitCap ||
        BigInt(gasPrice.toString()) > gasBudget.config("MAX_FEE_WEI") ||
        cost > BigInt(env.ECONOMY_POLYGON_MAX_GAS_WEI)
      )
        fail("POLYGON_GAS_CAP_EXCEEDED", 503);
      if ((await rpc.provider.getBalance(operator)).lt(gas.mul(gasPrice)))
        fail("POLYGON_OPERATOR_GAS_UNAVAILABLE", 503);
      const nonce = await rpc.provider.getTransactionCount(operator, "pending");
      await db.runTransaction(async (tx) => {
        const [s, l] = await Promise.all([tx.get(or), tx.get(lock)]);
        if (s.exists) return;
        if (l.data()?.active && l.data().active !== opId)
          fail("POLYGON_OPERATOR_BUSY", 409);
        await gasBudget.authorize(
          tx,
          "agent_" + q.serviceJobId,
          cost,
        );
        tx.create(or, {
          chainOrderId: q.chainOrderId,
          orderId: "agent_" + q.serviceJobId,
          jobId: q.serviceJobId,
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
        });
        tx.set(lock, { active: opId });
      });
      o = (await or.get()).data();
    }
    if (!o.transactionHash) {
      await ready();
      const raw = await (signTransaction || remote)(o.transaction, {
        operationId: opId,
        requestId: opId,
        expiresAtMs: now() + 60000,
      });
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
    if (receipt?.status === 0) {
      if (!(await rpc.mature(receipt))) fail("POLYGON_OPERATION_PENDING", 409);
      if (
        !receipt.effectiveGasPrice ||
        receipt.transactionHash.toLowerCase() !==
          o.transactionHash.toLowerCase() ||
        receipt.from?.toLowerCase() !== operator.toLowerCase() ||
        receipt.to?.toLowerCase() !== rpc.token.toLowerCase() ||
        receipt.gasUsed.gt(o.transaction.gasLimit) ||
        !receipt.effectiveGasPrice.eq(o.transaction.gasPrice)
      )
        fail("POLYGON_GAS_RECEIPT_UNAVAILABLE", 503);
      const block = await rpc.provider.getBlock(receipt.blockNumber);
      const proof = {
        transactionHash: receipt.transactionHash.toLowerCase(),
        gasPayer: operator.toLowerCase(),
        gasCostWei: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        minedAtMs: block.timestamp * 1000,
      };
      await db.runTransaction(async (tx) => {
        await tx.get(or);
        const commit = await gasBudget.recordFailure(
          tx,
          "agent_" + q.serviceJobId,
          proof,
        );
        commit();
        tx.set(
          or,
          {
            state: "failed",
            failedReceipt: proof,
            rawTransaction: null,
            updatedAt: now(),
          },
          { merge: true },
        );
      });
      // Never free the nonce slot, recreate a tx or claim a refund after a mined failure.
      fail("POLYGON_OPERATOR_TX_FAILED", 503);
    }
    if (!receipt) {
      await ready();
      // A durable signature is not proof the role still exists after an incident.
      if (
        !(await rpc.contract.hasRole(ethers.utils.id("REFUND_ROLE"), operator))
      )
        fail("POLYGON_REFUND_NOT_READY", 503);
      // The exact signed bytes/hash survive a timeout/restart. No replacement nonce or automatic gas bump.
      try {
        await rpc.provider.sendTransaction(o.rawTransaction);
      } catch (_) {
        fail("POLYGON_OPERATION_PENDING", 409);
      }
    }
    fail("POLYGON_OPERATION_PENDING", 409);
  }
  return { ensure, ready };
}
module.exports = { createOperator };
