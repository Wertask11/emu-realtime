"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const WS = require("ws"),
  { providers } = require("ethers");
test("patched ethers WebSocket transport preserves local Polygon RPC client compatibility", async () => {
  assert.equal(
    require("node:module").createRequire(
      require.resolve("@ethersproject/providers"),
    )("ws/package.json").version,
    "8.21.3",
  );
  const server = new WS.Server({ host: "127.0.0.1", port: 0 });
  await new Promise((r) => server.once("listening", r));
  server.on("connection", (socket) =>
    socket.on("message", (data) => {
      const q = JSON.parse(data.toString());
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: q.id,
          result:
            q.method === "eth_chainId"
              ? "0x89"
              : q.method === "net_version"
                ? "137"
                : "0x7b",
        }),
      );
    }),
  );
  const client = new providers.WebSocketProvider(
    "ws://127.0.0.1:" + server.address().port,
  );
  try {
    assert.equal((await client.getNetwork()).chainId, 137);
    assert.equal(await client.getBlockNumber(), 123);
  } finally {
    await client.destroy();
    for (const c of server.clients) c.terminate();
    await new Promise((r) => server.close(r));
  }
});
