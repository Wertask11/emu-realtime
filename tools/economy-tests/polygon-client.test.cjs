"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const source = fs.readFileSync(
  require("node:path").join(
    __dirname,
    "../../frontend/public/economy/polygon.js",
  ),
  "utf8",
);
const TOKEN = "0x9c102cC3016C70767082b60196565878D9314864",
  wallet = "0x" + "1".repeat(40),
  hash = "0x" + "a".repeat(64);
const manifest = () => ({
  chainId: 137,
  to: TOKEN,
  tokenAddress: TOKEN,
  amountWei: "5000000000000000000",
  value: "0x0",
  method: "exchange",
  approvalRequired: false,
  data:
    "0x53c13aa1" +
    "0".repeat(128) +
    BigInt("5000000000000000000").toString(16).padStart(64, "0") +
    (Math.floor(Date.now() / 1000) + 600).toString(16).padStart(64, "0"),
  walletAddress: wallet,
  deadline: Math.floor(Date.now() / 1000) + 600,
});
function fixture(overrides = {}) {
  let calls = [];
  const values = {
    eth_accounts: [wallet],
    eth_requestAccounts: [wallet],
    eth_chainId: "0x89",
    eth_estimateGas: "0x5208",
    eth_gasPrice: "0x3b9aca00",
    eth_getBalance: "0xde0b6b3a7640000",
    eth_call: "0x" + (10n ** 20n).toString(16),
    eth_sendTransaction: hash,
    personal_sign: "0x" + "1".repeat(130),
    ...overrides,
  };
  const window = {
    ethereum: {
      request: async (q) => {
        calls.push(q);
        if (values[q.method] instanceof Error) throw values[q.method];
        return values[q.method];
      },
    },
  };
  window.parent = window;
  vm.runInNewContext(source, { window, TextEncoder, Date, BigInt });
  return { api: window.ReizoPolygon, calls };
}
test("wallet gas comes from actual provider, 5 EMUER separate, no approve or implicit broadcast", async () => {
  const f = fixture(),
    e = await f.api.estimate(manifest(), () => {});
  assert.equal(e.gasPOL, "0.000021");
  assert.equal(
    f.calls.filter((x) => x.method === "eth_sendTransaction").length,
    0,
  );
  assert.equal(
    f.calls.some((x) => /approve|transfer/.test(JSON.stringify(x))),
    false,
  );
  assert.equal(await f.api.broadcast(manifest(), e, () => {}), hash);
  assert.equal(
    f.calls.filter((x) => x.method === "eth_sendTransaction").length,
    1,
  );
});
for (const [label, override, error] of [
  ["wrong chain", { eth_chainId: "0x1" }, /POLYGON_WRONG_CHAIN/],
  [
    "wrong wallet",
    { eth_accounts: ["0x" + "2".repeat(40)] },
    /POLYGON_WALLET_CHANGED/,
  ],
  ["gas insufficient", { eth_getBalance: "0x0" }, /POLYGON_GAS_INSUFFICIENT/],
  ["token insufficient", { eth_call: "0x0" }, /POLYGON_INSUFFICIENT_EMUER/],
])
  test(label + " cannot broadcast", async () => {
    const f = fixture(override);
    await assert.rejects(
      f.api.estimate(manifest(), () => {}),
      error,
    );
    assert.equal(
      f.calls.some((x) => x.method === "eth_sendTransaction"),
      false,
    );
  });
test("expired, wrong token, changed amount/value and unrestricted allowance manifests rejected", async () => {
  for (const change of [
    { deadline: 1 },
    { chainId: 1 },
    { to: wallet },
    { tokenAddress: wallet },
    { amountWei: "1" },
    { value: "0x1" },
    { approvalRequired: true },
    { method: "transfer" },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.api.estimate({ ...manifest(), ...change }, () => {}),
      /POLYGON_PAYMENT_CLOSED/,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("user rejection/account switch never broadcasts or retries; nonce proof is purpose-bound server message", async () => {
  const f = fixture({
    personal_sign: Object.assign(Error("denied"), { code: 4001 }),
  });
  let sent;
  await assert.rejects(
    f.api.proof(
      async () => ({
        challenge: {
          message: "One purpose-bound server nonce",
          walletAddress: wallet,
          nonce: "nonce",
        },
      }),
      () => {},
    ),
    /denied/,
  );
  assert.equal(
    f.calls.some((x) => x.method === "eth_sendTransaction"),
    false,
  );
  const g = fixture();
  await assert.rejects(
    g.api.estimate(manifest(), () => {
      throw Error("AUTH_REQUIRED");
    }),
    /AUTH_REQUIRED/,
  );
  assert.equal(
    g.calls.some((x) => x.method === "eth_sendTransaction"),
    false,
  );
});
