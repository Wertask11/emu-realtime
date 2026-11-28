/* Knowledge Text の「役に立った」（room1-helpful.js）。本物の express を立て、Firestore だけ手元の偽物にして確かめる。 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createRoom1HelpfulRouter } = require("./room1-helpful");

function fakeDb(contents) {
  const store = new Map();   // "col/id" -> data
  contents.forEach((id) => store.set("room1_contents/" + id, { theme: "money" }));
  const ref = (col, id) => ({
    key: col + "/" + id,
    get: async () => snap(col + "/" + id),
  });
  const snap = (key) => ({ exists: store.has(key), data: () => store.get(key) });
  const merge = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) {
      if (v && v.__inc) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = merge(out[k], v);
      else out[k] = v;
    }
    return out;
  };
  return {
    store,
    collection: (col) => ({
      doc: (id) => ref(col, id),
      where: (field, op, value) => ({
        limit: () => ({
          get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(col + "/") && v[field] === value).map(([k, v]) => ({ id: k, data: () => v })) }),
        }),
      }),
    }),
    runTransaction: async (fn) => {
      const writes = [];
      const out = await fn({
        get: async (r) => snap(r.key),
        set: (r, data, opt) => writes.push([r.key, data, opt]),
      });
      for (const [key, data, opt] of writes) store.set(key, opt && opt.merge ? merge(store.get(key), data) : data);
      return out;
    },
  };
}
const firebaseAdmin = {
  firestore: { FieldValue: { increment: (n) => ({ __inc: n }) } },
  auth: () => ({ verifyIdToken: async (t) => { if (!t.startsWith("u-")) throw new Error("bad"); return { uid: t }; } }),
};
function requireFirebaseUser(req, res, next) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer u-")) return res.status(401).json({ error: "AUTH_REQUIRED" });
  req.identity = { uid: h.slice(7) };
  next();
}
async function serve(db) {
  const app = express();
  app.use(express.json());
  app.use("/api/room1", createRoom1HelpfulRouter({ express, db, firebaseAdmin, requireFirebaseUser }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/room1";
  const call = async (method, path, uid) => {
    const r = await fetch(base + path, { method, headers: uid ? { Authorization: "Bearer " + uid } : {} });
    return { status: r.status, body: await r.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test("ログインした人が押すと数が1増える。同じ人がもう一度押しても増えない（取り消しは無し）", async () => {
  const db = fakeDb(["c1", "c2"]);
  const s = await serve(db);
  try {
    let r = await s.call("POST", "/contents/c1/helpful", "u-alice");
    assert.deepEqual(r.body, { ok: true, already: false, count: 1 });
    r = await s.call("POST", "/contents/c1/helpful", "u-alice");
    assert.deepEqual(r.body, { ok: true, already: true, count: 1 });
    r = await s.call("POST", "/contents/c1/helpful", "u-bob");
    assert.equal(r.body.count, 2);
    r = await s.call("GET", "/helpful", "u-alice");
    assert.deepEqual(r.body, { counts: { c1: 2 }, mine: ["c1"] });
    r = await s.call("GET", "/helpful");
    assert.deepEqual(r.body, { counts: { c1: 2 }, mine: [] }, "数はだれでも見られる。自分が押したかはログインしているときだけ");
  } finally { await s.close(); }
});

test("ログインしていない・無いコンテンツ・形の悪いIDは断る。記録は増えない", async () => {
  const db = fakeDb(["c1"]);
  const s = await serve(db);
  try {
    assert.equal((await s.call("POST", "/contents/c1/helpful")).status, 401);
    assert.equal((await s.call("POST", "/contents/nope/helpful", "u-alice")).status, 404);
    assert.equal((await s.call("POST", "/contents/" + encodeURIComponent("a/b") + "/helpful", "u-alice")).status, 400);
    assert.equal((await s.call("POST", "/contents/" + encodeURIComponent("x y") + "/helpful", "u-alice")).status, 400);
    assert.equal([...db.store.keys()].filter((k) => k.startsWith("room1_helpful/")).length, 0);
    assert.deepEqual((await s.call("GET", "/helpful", "bad-token")).body, { counts: {}, mine: [] });
  } finally { await s.close(); }
});

test("サーバーの組み込み：/api/room1 に付ける。Firebase が無いときは押すと 503（起動は止めない）", async () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "server.js"), "utf8");
  assert.ok(src.includes('const { createRoom1HelpfulRouter } = require("./room1-helpful");') && src.includes('app.use("/api/room1", createRoom1HelpfulRouter({ express, db, firebaseAdmin, requireFirebaseUser, rateLimit }));'));
  const app = express();
  app.use("/api/room1", createRoom1HelpfulRouter({ express, db: null, firebaseAdmin: null, requireFirebaseUser }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const base = "http://127.0.0.1:" + server.address().port + "/api/room1";
    assert.equal((await fetch(base + "/contents/c1/helpful", { method: "POST", headers: { Authorization: "Bearer u-a" } })).status, 503);
    assert.deepEqual(await (await fetch(base + "/helpful")).json(), { counts: {}, mine: [] });
  } finally { await new Promise((r) => server.close(r)); }
});
