"use strict";
// Transport faults are simulated; emulator guard tests separately check actual Rules.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const {
  nativeProbe,
  createProbeTransport,
  boundedChecks,
  MAX_RESPONSE,
} = require("../../backend/knowledge-lab/probe-transport");
const URL =
  "https://firestore.googleapis.com/v1/projects/example/databases/(default)/documents/knowledge_lab_notes/probe";
function socket(responseBody, captured, { oversize = false } = {}) {
  return (_url, options, callback) => {
    captured.options = options;
    const req = new EventEmitter();
    req.write = (b) => {
      captured.body = b;
    };
    req.destroy = (e) => req.emit("error", e);
    req.end = () =>
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = 403;
        res.headers = { "content-type": "application/json" };
        callback(res);
        res.emit(
          "data",
          oversize ? Buffer.alloc(MAX_RESPONSE + 1) : Buffer.from(responseBody),
        );
        res.emit("end");
      });
    return req;
  };
}
test("direct anonymous transport pins IPv4, reuses a bounded pool and preserves TLS verification", async () => {
  const captured = {};
  const r = await nativeProbe(
    URL,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"fields":{"probe":{"stringValue":"lab-1"}}}',
    },
    socket('{"error":{"status":"PERMISSION_DENIED"}}', captured),
  );
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.status, "PERMISSION_DENIED");
  assert.equal(captured.options.family, 4);
  assert.equal(captured.options.rejectUnauthorized, true);
  assert.equal(captured.options.agent.maxSockets, 4);
  assert.equal(captured.options.agent.keepAlive, true);
  assert.equal(captured.options.headers.Authorization, undefined);
  assert.equal(captured.options.headers["x-goog-api-key"], undefined);
  assert.match(captured.body, /lab-1/);
});
test("native transport rejects foreign hosts and credential-bearing URLs before any request", async () => {
  let called = false;
  const request = () => {
    called = true;
    throw Error("MUST_NOT_CALL");
  };
  for (const url of [
    "http://firestore.googleapis.com/",
    "https://elsewhere.example/",
    "https://user:secret@firestore.googleapis.com/",
    URL + "?key=secret",
  ])
    await assert.rejects(
      nativeProbe(url, {}, request),
      /INVALID_PROBE_DESTINATION/,
    );
  assert.equal(called, false);
});
test("native responses have a hard byte bound", async () => {
  await assert.rejects(
    nativeProbe(URL, {}, socket("", {}, { oversize: true })),
    /PROBE_RESPONSE_LIMIT/,
  );
});
test("configured proxy keeps the ordinary fetch path without choosing direct sockets", async () => {
  let calls = 0;
  const transport = createProbeTransport({
    env: { HTTPS_PROXY: "http://proxy.example.invalid:8080" },
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, URL);
      assert.ok(options.signal);
      return new Response('{"error":{"status":"PERMISSION_DENIED"}}', {
        status: 403,
      });
    },
    requester: () => {
      throw Error("DIRECT_PATH_MUST_NOT_RUN");
    },
  });
  assert.equal((await transport(URL)).status, 403);
  assert.equal(calls, 1);
});
test("emulator probes keep loopback fetch and never use production HTTPS transport", async () => {
  let url;
  const transport = createProbeTransport({
    env: {},
    fetcher: async (u) => {
      url = u;
      return new Response("{}", { status: 403 });
    },
    requester: () => {
      throw Error("DIRECT_PATH_MUST_NOT_RUN");
    },
  });
  await transport(
    "http://127.0.0.1:8787/v1/projects/demo-test/databases/(default)/documents/knowledge_lab_notes/probe",
  );
  assert.match(url, /127\.0\.0\.1:8787/);
});
test("collection checks run at most two at once and require every collection to succeed", async () => {
  let active = 0,
    peak = 0;
  const seen = [];
  const result = await boundedChecks(
    ["a", "b", "c", "d", "e"],
    2,
    async (name) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(name);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return true;
    },
  );
  assert.equal(peak, 2);
  assert.equal(seen.length, 5);
  assert.deepEqual(result, [true, true, true, true, true]);
});
test("a failed check stops new probes and unchecked collections can never count as success", async () => {
  const seen = [];
  const result = await boundedChecks(["a", "b", "c", "d"], 2, async (name) => {
    seen.push(name);
    return name !== "a";
  });
  assert.ok(seen.length <= 2);
  assert.equal(result.every(Boolean), false);
  assert.equal(result.length, 4);
  assert.equal(result[3], false);
});
