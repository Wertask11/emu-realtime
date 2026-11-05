import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedRateLimit } from "./rate-limit.mjs";
function database() {
  const rows = new Map();
  let queue = Promise.resolve();
  return {
    rows,
    collection: (name) => ({ doc: (id) => name + "/" + id }),
    runTransaction(fn) {
      const p = queue.then(() =>
        fn({
          get: async (ref) => ({
            exists: rows.has(ref),
            data: () => rows.get(ref),
          }),
          set: (ref, data) => rows.set(ref, data),
        }),
      );
      queue = p.catch(() => {});
      return p;
    },
  };
}
test("two worker limiters share atomic budget, rotate windows, and never store raw IP", async () => {
  const db = database(),
    cfg = {
      db,
      realm: "a".repeat(64),
      hmacKey: new Uint8Array(32).fill(7),
      limit: 20,
      clock: () => now,
    };
  let now = 100000;
  const a = sharedRateLimit(cfg),
    b = sharedRateLimit(cfg);
  const outcomes = await Promise.all(
    Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b)("192.0.2.1")),
  );
  assert.equal(outcomes.filter(Boolean).length, 20);
  assert.ok(!JSON.stringify([...db.rows]).includes("192.0.2.1"));
  now += 60000;
  assert.equal(await a("192.0.2.1"), true);
});
test("shared budget fails closed on storage failure or malformed counters", async () => {
  const db = database(),
    cfg = { db, realm: "b".repeat(64), hmacKey: new Uint8Array(32) };
  const f = sharedRateLimit(cfg);
  await f("test");
  for (const k of db.rows.keys()) db.rows.set(k, { count: -1 });
  await assert.rejects(f("test"));
  db.runTransaction = async () => {
    throw Error("STORAGE_DOWN");
  };
  await assert.rejects(f("test"));
  assert.throws(() => sharedRateLimit({ ...cfg, hmacKey: new Uint8Array(2) }));
});
