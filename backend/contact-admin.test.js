"use strict";

/* 運営画面の「お問い合わせ」（contact-admin.js）。
   オーナーだけが読めて、印を付けられること。本文や連絡先は書き換えないこと。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createContactAdminRouter } = require("./contact-admin");

async function setup() {
  const db = makeFirestore();
  const requireOwner = (req, res, next) => req.headers["x-test-owner"] === "1"
    ? (req.identity = { uid: "owner" }, next()) : res.status(403).json({ error: "OWNER_ONLY" });
  const app = express();
  app.use(express.json());
  app.use("/admin", createContactAdminRouter({ db, requireOwner, now: () => Date.parse("2026-10-28T10:00:00Z") }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { owner, body } = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(owner ? { "x-test-owner": "1" } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, close: () => server.close() };
}

test("only the owner can read; newest first; old records without a mark count as open", async () => {
  const t = await setup();
  try {
    await t.db.collection("contact_submissions").doc("a1").set({ type: "general", name: "古い", email: "a@example.com", message: "前の相談", submittedAt: "2026-10-01T00:00:00.000Z" });
    await t.db.collection("contact_submissions").doc("b2").set({ type: "event", name: "店舗", company: "カフェ", email: "b@example.com", message: "イベントの相談", topic: "店舗提携", submittedAt: "2026-10-27T00:00:00.000Z", secretField: "x" });
    assert.equal((await t.call("GET", "/admin")).status, 403);
    const r = await t.call("GET", "/admin", { owner: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.rows.map(x => x.id), ["b2", "a1"], "newest first");
    assert.equal(r.body.rows[0].company, "カフェ"); assert.equal(r.body.rows[0].topic, "店舗提携");
    assert.equal(r.body.rows[0].secretField, undefined, "only known fields are returned");
    assert.deepEqual(r.body.counts, { open: 2, done: 0 });
  } finally { t.close(); }
});

test("marking done / open changes only the mark, and lists follow it", async () => {
  const t = await setup();
  try {
    await t.db.collection("contact_submissions").doc("c3").set({ type: "general", email: "c@example.com", message: "本文", submittedAt: "2026-10-27T00:00:00.000Z" });
    assert.equal((await t.call("POST", "/admin/c3/status", { body: { status: "done" } })).status, 403, "people cannot mark");
    const ok = await t.call("POST", "/admin/c3/status", { owner: true, body: { status: "done" } });
    assert.equal(ok.status, 200);
    const doc = (await t.db.collection("contact_submissions").doc("c3").get()).data();
    assert.equal(doc.status, "done"); assert.equal(doc.message, "本文"); assert.equal(doc.email, "c@example.com");
    assert.equal((await t.call("GET", "/admin", { owner: true })).body.rows.length, 0, "open list is empty");
    assert.equal((await t.call("GET", "/admin?status=done", { owner: true })).body.rows.length, 1);
    await t.call("POST", "/admin/c3/status", { owner: true, body: { status: "open" } });
    assert.equal((await t.call("GET", "/admin", { owner: true })).body.rows.length, 1, "back to open");
    assert.equal((await t.call("POST", "/admin/c3/status", { owner: true, body: { status: "deleted" } })).status, 400);
    assert.equal((await t.call("POST", "/admin/nope/status", { owner: true, body: { status: "done" } })).status, 404);
  } finally { t.close(); }
});
