"use strict";
// Dedicated Auth/Firestore demo project only; RPC is an explicit isolated double.
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
const ethers = require("../../backend/node_modules/ethers");
const { createGasBudget } = require("../../backend/economy/polygon-gas");
test("native Firestore serializes POL holds before payment and settles actual cost once", async () => {
  const f = await createFixture();
  try {
    const env = Object.fromEntries(
      Object.entries({
        OPERATOR_ADDRESS: "0x" + "1".repeat(40),
        MAX_FEE_WEI: "200",
        REFUND_GAS_LIMIT: "150000",
        FULFILL_GAS_LIMIT: "100000",
        MAX_GAS_WEI: "50000000",
        DAILY_GAS_WEI: "100000000",
        TRIAL_GAS_WEI: "200000000",
      }).map(([k, v]) => ["ECONOMY_POLYGON_" + k, v]),
    );
    const ref = f.economy.service.ref,
      now = () => Date.parse("2026-11-10T14:00:00Z"),
      rpc = {
        provider: {
          getBlockNumber: async () => 100,
          getGasPrice: async () => ethers.BigNumber.from(100),
          getBalance: async () => ethers.BigNumber.from(200000000),
        },
      };
    const g = createGasBudget({
      db: f.db,
      ref,
      env,
      rpc,
      now,
      estimate: async () => ({
        refundExchange: "110697",
        markExchangeFulfilled: "74058",
      }),
    });
    const snapshot = await g.snapshot();
    const results = await Promise.allSettled(
      ["a", "b", "c"].map((id) =>
        f.db.runTransaction(async (tx) =>
          (await g.reserve(tx, id, snapshot))(),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    assert.match(
      results.find((r) => r.status === "rejected").reason.message,
      /POLYGON_GAS_CAP_EXCEEDED/,
    );
    assert.equal(
      (await ref("system", "polygon-gas-coverage").get()).data().heldWei,
      "100000000",
    );
    const docs = await f.db.collection("emuer_v2_agent_gas_reservations").get(),
      id = docs.docs[0].id;
    const proof = {
      gasPayer: env.ECONOMY_POLYGON_OPERATOR_ADDRESS,
      gasCostWei: "1000",
      minedAtMs: now(),
      blockNumber: 100,
      transactionHash: "0x" + "1".repeat(64),
    };
    await Promise.all(
      [0, 1].map(() =>
        f.db.runTransaction(async (tx) => (await g.release(tx, id, proof))()),
      ),
    );
    const b = (await ref("system", "polygon-gas-coverage").get()).data();
    assert.equal(b.heldWei, "50000000");
    assert.equal(b.spentWei, "1000");
    assert.equal((await f.db.collection("mitemiru_orders").get()).size, 0);
  } finally {
    await f.close();
  }
});
