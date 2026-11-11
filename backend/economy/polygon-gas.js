"use strict";
const ethers = require("ethers");
const { fail, day } = require("./config");
const { AMOUNT } = require("./polygon-config");
const bn = (v) => BigInt(v.toString());
const word = (v) =>
  ethers.utils.hexZeroPad(ethers.BigNumber.from(v).toHexString(), 32);
// Read-only EVM state overrides. Slots are from the audited Solidity 0.8.27
// layout; never use this probe to attest a different/unknown runtime.
async function estimateTerminalGas(rpc, operator) {
  const orderId = ethers.utils.id("schoolpark-read-only-gas-probe-v1");
  const slot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(["bytes32", "uint256"], [orderId, 17]),
  );
  const balanceSlot = (a) =>
    ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [a, 0]),
    );
  const buyer = "0x000000000000000000000000000000000000dEaD";
  const stateDiff = {
    [slot]: word(buyer),
    [word(bn(slot) + 1n)]: ethers.utils.id("agent_schoolpark-explorer-v1"),
    [word(bn(slot) + 2n)]: word(AMOUNT),
    [word(bn(slot) + 3n)]: word(0),
    [word(16)]: word(bn(AMOUNT) * 2n),
    [balanceSlot(rpc.treasury)]: word(bn(AMOUNT) * 2n),
    [balanceSlot(buyer)]: word(0),
  };
  const estimates = {};
  for (const method of ["refundExchange", "markExchangeFulfilled"]) {
    estimates[method] = (
      await rpc.provider.send("eth_estimateGas", [
        {
          from: operator,
          to: rpc.token,
          value: "0x0",
          data: rpc.iface.encodeFunctionData(method, [orderId]),
        },
        "latest",
        { [rpc.token]: { stateDiff } },
      ])
    ).toString();
  }
  return estimates;
}
function createGasBudget({
  db,
  ref,
  rpc,
  env,
  now,
  estimate = estimateTerminalGas,
}) {
  const budgetRef = ref("system", "polygon-gas-coverage");
  const reservation = (id) => ref("gas_reservations", id);
  const config = (k) => {
    const v = env["ECONOMY_POLYGON_" + k];
    if (!/^[1-9][0-9]{0,29}$/.test(v || ""))
      fail("POLYGON_GAS_BUDGET_UNCONFIGURED", 503);
    return BigInt(v);
  };
  async function balances() {
    const finalized = await rpc.finalized();
    if (!finalized?.hash || !Number.isSafeInteger(finalized.number))
      fail("POLYGON_FINALITY_UNAVAILABLE", 503);
    const address = env.ECONOMY_POLYGON_OPERATOR_ADDRESS;
    const [confirmed, latest] = await Promise.all([
      rpc.provider.getBalance(address, finalized.number),
      rpc.provider.getBalance(address, "latest"),
    ]);
    // Never rely on an unfinalized deposit; include newer outgoing spend conservatively.
    return { finalized, balance: confirmed.lt(latest) ? confirmed : latest };
  }
  async function snapshot() {
    const [{ finalized, balance }, fee, estimates] = await Promise.all([
      balances(),
      rpc.provider.getGasPrice(),
      estimate(rpc, env.ECONOMY_POLYGON_OPERATOR_ADDRESS),
    ]);
    const blockNumber = finalized.number;
    const ceiling = config("MAX_FEE_WEI");
    // Current network fee +25% must fit the explicitly approved ceiling.
    if ((bn(fee) * 125n + 99n) / 100n > ceiling)
      fail("POLYGON_GAS_PRICE_HIGH", 503);
    for (const [m, k] of [
      ["refundExchange", "REFUND_GAS_LIMIT"],
      ["markExchangeFulfilled", "FULFILL_GAS_LIMIT"],
    ])
      if ((bn(estimates[m]) * 125n + 99n) / 100n > config(k))
        fail("POLYGON_GAS_ESTIMATE_EXCEEDED", 503);
    // Reserve both paths conservatively, including a possible failed terminal tx.
    const held =
      (config("REFUND_GAS_LIMIT") + config("FULFILL_GAS_LIMIT")) * ceiling;
    if (held > config("MAX_GAS_WEI")) fail("POLYGON_GAS_CAP_EXCEEDED", 503);
    return {
      blockNumber,
      blockHash: finalized.hash,
      balanceWei: balance.toString(),
      feeWei: fee.toString(),
      heldWei: held.toString(),
      operatorAddress: env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase(),
      atMs: now(),
    };
  }
  async function reserve(tx, id, s) {
    const rr = reservation(id),
      dr = ref("operator_gas", day(now())),
      mr = ref("operator_month_gas", day(now()).slice(0, 7));
    const [r, b, d, m] = await Promise.all([
      tx.get(rr),
      tx.get(budgetRef),
      tx.get(dr),
      tx.get(mr),
    ]);
    if (r.exists) fail("POLYGON_GAS_RESERVATION_EXISTS", 409);
    if (now() - s.atMs > 15000 || s.blockNumber < (b.data()?.settledBlock || 0))
      fail("POLYGON_GAS_SNAPSHOT_STALE", 503);
    if (
      BigInt(b.data()?.heldWei || "0") > 0n &&
      b.data().operatorAddress !== s.operatorAddress
    )
      fail("POLYGON_OPERATOR_ROTATION_PENDING", 503);
    const held = BigInt(b.data()?.heldWei || "0") + BigInt(s.heldWei);
    if (BigInt(s.balanceWei) < held)
      fail("POLYGON_REFUND_RESERVE_INSUFFICIENT", 503);
    // Include ALL outstanding holds, including previous days and unmined txs.
    if (
      BigInt(d.data()?.spentWei || "0") + held > config("DAILY_GAS_WEI") ||
      BigInt(m.data()?.spentWei || "0") + held > config("MONTHLY_GAS_WEI") ||
      BigInt(b.data()?.spentWei || "0") + held > config("TRIAL_GAS_WEI")
    )
      fail("POLYGON_GAS_CAP_EXCEEDED", 503);
    return () => {
      tx.create(rr, { orderId: id, state: "held", ...s, createdAtMs: now() });
      tx.set(
        budgetRef,
        {
          heldWei: held.toString(),
          operatorAddress: s.operatorAddress,
          updatedAtMs: now(),
        },
        { merge: true },
      );
    };
  }
  async function authorize(tx, id, cost) {
    const r = (await tx.get(reservation(id))).data();
    if (
      !r ||
      r.operatorAddress !==
        env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase() ||
      r.state !== "held" ||
      cost > BigInt(r.heldWei)
    )
      fail("POLYGON_REFUND_RESERVE_UNAVAILABLE", 503);
    // Recovery does not depend on today's new-intake cap or the ENABLED flag.
  }
  async function check(id) {
    const r = (await reservation(id).get()).data();
    if (
      !r ||
      r.operatorAddress !==
        env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase() ||
      r.state !== "held"
    )
      fail("POLYGON_REFUND_RESERVE_UNAVAILABLE", 503);
    const [b, fee, coverage] = await Promise.all([
      balances(),
      rpc.provider.getGasPrice(),
      budgetRef.get(),
    ]);
    if (
      bn(b.balance) < BigInt(coverage.data()?.heldWei || "0") ||
      bn(fee) > config("MAX_FEE_WEI")
    )
      fail("POLYGON_REFUND_RESERVE_UNAVAILABLE", 503);
  }
  async function recordFailure(tx, id, proof) {
    if (
      proof.gasPayer?.toLowerCase() !==
        env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase() ||
      !/^[0-9]+$/.test(proof.gasCostWei || "") ||
      !/^0x[a-f0-9]{64}$/i.test(proof.transactionHash || "") ||
      !Number.isSafeInteger(proof.minedAtMs)
    )
      fail("POLYGON_GAS_RECEIPT_UNAVAILABLE", 503);
    const rr = reservation(id),
      sr = ref("operator_gas_spend", proof.transactionHash.toLowerCase()),
      dr = ref("operator_gas", day(proof.minedAtMs)),
      mr = ref("operator_month_gas", day(proof.minedAtMs).slice(0, 7));
    const [r, b, s, d, m] = await Promise.all([
      tx.get(rr),
      tx.get(budgetRef),
      tx.get(sr),
      tx.get(dr),
      tx.get(mr),
    ]);
    if (s.exists) {
      if (s.data().orderId !== id) fail("POLYGON_GAS_SETTLEMENT_INVALID", 503);
      return () => {};
    }
    const cost = BigInt(proof.gasCostWei);
    if (
      r.data()?.state !== "held" ||
      BigInt(r.data().heldWei) < cost ||
      BigInt(b.data()?.heldWei || "0") < cost
    )
      fail("POLYGON_GAS_SETTLEMENT_INVALID", 503);
    return () => {
      tx.create(sr, {
        orderId: id,
        ...proof,
        state: "failed",
        createdAtMs: now(),
      });
      tx.set(
        rr,
        {
          heldWei: (BigInt(r.data().heldWei) - cost).toString(),
          failedGasWei: (
            BigInt(r.data().failedGasWei || "0") + cost
          ).toString(),
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(
        budgetRef,
        {
          heldWei: (BigInt(b.data().heldWei) - cost).toString(),
          spentWei: (BigInt(b.data()?.spentWei || "0") + cost).toString(),
          settledBlock: Math.max(
            b.data()?.settledBlock || 0,
            proof.blockNumber,
          ),
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(
        dr,
        { spentWei: (BigInt(d.data()?.spentWei || "0") + cost).toString() },
        { merge: true },
      );
      tx.set(
        mr,
        { spentWei: (BigInt(m.data()?.spentWei || "0") + cost).toString() },
        { merge: true },
      );
    };
  }
  async function release(tx, id, proof = null) {
    if (
      proof &&
      (!Number.isSafeInteger(proof.minedAtMs) ||
        !/^0x[a-f0-9]{40}$/i.test(proof.gasPayer || "") ||
        !/^[0-9]+$/.test(proof.gasCostWei || ""))
    )
      fail("POLYGON_GAS_RECEIPT_UNAVAILABLE", 503);
    const rr = reservation(id),
      dr = ref("operator_gas", proof ? day(proof.minedAtMs) : day(now())),
      mr = ref(
        "operator_month_gas",
        (proof ? day(proof.minedAtMs) : day(now())).slice(0, 7),
      );
    const [r, b, d, m] = await Promise.all([
      tx.get(rr),
      tx.get(budgetRef),
      tx.get(dr),
      tx.get(mr),
    ]);
    if (!r.exists || r.data().state !== "held") return () => {};
    const cost =
      proof &&
      proof.gasPayer?.toLowerCase() ===
        env.ECONOMY_POLYGON_OPERATOR_ADDRESS.toLowerCase()
        ? BigInt(proof.gasCostWei)
        : 0n;
    if (cost > BigInt(r.data().heldWei))
      fail("POLYGON_GAS_SETTLEMENT_INVALID", 503);
    const held = BigInt(b.data()?.heldWei || "0") - BigInt(r.data().heldWei);
    if (held < 0n) fail("POLYGON_GAS_SETTLEMENT_INVALID", 503);
    return () => {
      tx.set(
        rr,
        {
          state: proof ? "settled" : "unpaid_expired",
          costWei: (BigInt(r.data().failedGasWei || "0") + cost).toString(),
          terminalGasWei: cost.toString(),
          transactionHash: proof?.transactionHash || null,
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(
        budgetRef,
        {
          heldWei: held.toString(),
          spentWei: (BigInt(b.data()?.spentWei || "0") + cost).toString(),
          settledBlock: Math.max(
            b.data()?.settledBlock || 0,
            proof?.blockNumber || 0,
          ),
          updatedAtMs: now(),
        },
        { merge: true },
      );
      if (proof) {
        tx.set(
          mr,
          { spentWei: (BigInt(m.data()?.spentWei || "0") + cost).toString() },
          { merge: true },
        );
        tx.set(
          dr,
          { spentWei: (BigInt(d.data()?.spentWei || "0") + cost).toString() },
          { merge: true },
        );
      }
    };
  }
  return {
    snapshot,
    reserve,
    authorize,
    check,
    release,
    recordFailure,
    config,
  };
}
module.exports = { createGasBudget, estimateTerminalGas };
