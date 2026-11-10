"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createGasBudget } = require("./polygon-gas");
function fixture() {
  const db = makeFirestore(),
    ref = (c, id) => db.collection(c).doc(id);
  let time = Date.parse("2026-11-10T14:59:00Z"),
    balance = "1000000000000000000",
    fee = "100";
  const env = Object.fromEntries(
    Object.entries({
      MAX_FEE_WEI: "200",
      REFUND_GAS_LIMIT: "150000",
      FULFILL_GAS_LIMIT: "100000",
      MAX_GAS_WEI: "50000000",
      DAILY_GAS_WEI: "100000000",
      TRIAL_GAS_WEI: "200000000",
      OPERATOR_ADDRESS: "0x" + "1".repeat(40),
    }).map(([k, v]) => ["ECONOMY_POLYGON_" + k, v]),
  );
  const rpc = {
    provider: {
      getBlockNumber: async () => 100,
      getBalance: async () => ethers.BigNumber.from(balance),
      getGasPrice: async () => ethers.BigNumber.from(fee),
    },
  };
  const g = createGasBudget({
    db,
    ref,
    rpc,
    env,
    now: () => time,
    estimate: async () => ({
      refundExchange: "110697",
      markExchangeFulfilled: "74058",
    }),
  });
  const reserve = async (id) => {
    const s = await g.snapshot();
    return db.runTransaction(async (tx) => {
      const commit = await g.reserve(tx, id, s);
      commit();
    });
  };
  return {
    db,
    ref,
    env,
    g,
    reserve,
    advance: (n) => (time += n),
    balance: (v) => (balance = v),
    fee: (v) => (fee = v),
  };
}
test("atomic POL coverage stops concurrent third order; daily holds include prior days", async () => {
  const f = fixture();
  const r = await Promise.allSettled([
    f.reserve("a"),
    f.reserve("b"),
    f.reserve("c"),
  ]);
  assert.equal(r.filter((v) => v.status === "fulfilled").length, 2);
  assert.equal(
    (await f.ref("system", "polygon-gas-coverage").get()).data().heldWei,
    "100000000",
  );
  f.advance(120000);
  await assert.rejects(f.reserve("d"), /POLYGON_GAS_CAP_EXCEEDED/);
});
test("actual POL shortage and fee spike stop admission before order/signature", async () => {
  const f = fixture();
  f.balance("49999999");
  await assert.rejects(f.reserve("a"), /POLYGON_REFUND_RESERVE_INSUFFICIENT/);
  assert.deepEqual(f.db._dump("gas_reservations"), {});
  f.fee("161");
  await assert.rejects(f.reserve("b"), /POLYGON_GAS_PRICE_HIGH/);
});
test("terminal receipt settles once on mined JST day; recovery ignores new-intake day cap", async () => {
  const f = fixture();
  await f.reserve("a");
  f.env.ECONOMY_POLYGON_DAILY_GAS_WEI = "1";
  await f.db.runTransaction((tx) => f.g.authorize(tx, "a", 1000n));
  const proof = {
    gasPayer: f.env.ECONOMY_POLYGON_OPERATOR_ADDRESS,
    gasCostWei: "1000",
    minedAtMs: Date.parse("2026-11-10T15:01:00Z"),
    blockNumber: 100,
    transactionHash: "0x" + "1".repeat(64),
  };
  for (let i = 0; i < 2; i++)
    await f.db.runTransaction(async (tx) =>
      (await f.g.release(tx, "a", proof))(),
    );
  assert.equal(
    (await f.ref("operator_gas", "2026-11-11").get()).data().spentWei,
    "1000",
  );
  const b = (await f.ref("system", "polygon-gas-coverage").get()).data();
  assert.equal(b.heldWei, "0");
  assert.equal(b.spentWei, "1000");
});
test("unpaid finalized expiry releases hold, overspending and missing reserves fail closed", async () => {
  const f = fixture();
  await f.reserve("a");
  await assert.rejects(
    f.db.runTransaction((tx) => f.g.authorize(tx, "a", 50000001n)),
    /RESERVE_UNAVAILABLE/,
  );
  await f.db.runTransaction(async (tx) => (await f.g.release(tx, "a"))());
  await assert.rejects(f.g.check("a"), /RESERVE_UNAVAILABLE/);
  assert.equal(
    (await f.ref("system", "polygon-gas-coverage").get()).data().heldWei,
    "0",
  );
});
test("stale balance snapshot cannot reuse funds after a later settlement block", async () => {
  const f = fixture(),
    s = await f.g.snapshot();
  await f.ref("system", "polygon-gas-coverage").set({ settledBlock: 101 });
  await assert.rejects(
    f.db.runTransaction((tx) => f.g.reserve(tx, "a", s)),
    /SNAPSHOT_STALE/,
  );
});
test("trial cumulative spent cannot be reset via day rollover", async () => {
  const f = fixture();
  await f.ref("system", "polygon-gas-coverage").set({ spentWei: "150000001" });
  await assert.rejects(f.reserve("a"), /GAS_CAP_EXCEEDED/);
});
test("changing operator with outstanding holds cannot authorize old reserves", async () => {
  const f = fixture();
  await f.reserve("a");
  f.env.ECONOMY_POLYGON_OPERATOR_ADDRESS = "0x" + "2".repeat(40);
  await assert.rejects(f.reserve("b"), /OPERATOR_ROTATION_PENDING/);
  await assert.rejects(
    f.db.runTransaction((tx) => f.g.authorize(tx, "a", 1000n)),
    /RESERVE_UNAVAILABLE/,
  );
});
