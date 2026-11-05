import { test } from "node:test";
import assert from "node:assert/strict";
import { firestoreStore } from "./storage.cjs";
function database() {
  const docs = new Map();
  const get = (ref) => ({
    exists: docs.has(ref.path),
    data: () => structuredClone(docs.get(ref.path)),
  });
  return {
    docs,
    collection: (name) => ({
      doc: (id) => ({
        path: name + "/" + id,
        async get() {
          return get(this);
        },
      }),
    }),
    async runTransaction(fn) {
      return fn({
        get: async (r) => get(r),
        set: (r, d) => docs.set(r.path, structuredClone(d)),
        delete: (r) => docs.delete(r.path),
      });
    },
  };
}
test("fresh post-Rules storage realm rejects pre-seeded grants and isolates status/account records", async () => {
  const db = database(),
    old = firestoreStore(db),
    a = firestoreStore(db, { realm: "a".repeat(64) }),
    b = firestoreStore(db, { realm: "b".repeat(64) });
  await old.ticket("malicious-preseed", () => ({
    next: { owner: "victim", expires: Date.now() + 1000000 },
    result: true,
  }));
  assert.equal(
    await a.ticket("malicious-preseed", (g) => ({ next: g, result: g })),
    null,
  );
  await a.run("same-owner", (account, status) => {
    status.revoked.push(7);
    account.history.push({ type: "test" });
  });
  assert.deepEqual((await b.status()).revoked, []);
  assert.deepEqual((await a.status()).revoked, [7]);
  assert.equal(
    (await b.run("same-owner", (account) => account.history)).length,
    0,
  );
});
