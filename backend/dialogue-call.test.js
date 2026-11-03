"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createDialogueRouter } = require("./dialogue");

test("F06: voice-call offers/repair preserve booking records; chat alone cannot record attendance", async t => {
  const rows = new Map([["dialogue_sessions/old", { uid: "alice", outcome: "scheduled", venue: "emu", wantsAgain: true, scheduledAt: 123 }]]);
  const ref = (col, id) => ({ id,
    get: async () => ({ id, exists: rows.has(col + "/" + id), data: () => rows.get(col + "/" + id) }),
    update: async data => rows.set(col + "/" + id, { ...rows.get(col + "/" + id), ...data }) });
  const db = { collection: col => ({ doc: id => ref(col, id), add: async data => {
    const id = "new-" + rows.size; rows.set(col + "/" + id, data); return { id };
  } }) };
  function requireFirebaseUser(req, res, next) {
    const uid = req.headers.authorization;
    if (!["alice", "bob", "owner"].includes(uid)) return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = { uid }; next();
  }
  function requireOwner(req, res, next) { requireFirebaseUser(req, res, () => req.identity.uid === "owner" ? next() : res.status(403).json({ error: "OWNER_ONLY" })); }
  const app = express(); app.use(express.json()); app.use(createDialogueRouter({ db, requireFirebaseUser, requireOwner, rateLimit: () => (req, res, next) => next() }).router);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const call = async (path, uid = "owner", body) => {
    const r = await fetch("http://127.0.0.1:" + server.address().port + path, { method: body ? "POST" : "GET", headers: { Authorization: uid, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await call("/old/access", "bob")).status, 403);
  assert.equal((await call("/old/access", "alice")).data.session.id, "old");
  assert.equal((await call("/old/access", "owner")).status, 200);
  assert.equal((await call("/admin/offer", "owner", { uid: "alice", scheduledAt: "2026-11-04", venue: "emu" })).data.error, "VOICE_LINK_REQUIRED");
  assert.equal((await call("/admin/old/record", "owner", { outcome: "held" })).data.error, "VOICE_LINK_REQUIRED");
  assert.equal((await call("/admin/old/call", "alice", { meetingUrl: "https://zoom.example.invalid/call" })).status, 403);
  assert.equal((await call("/admin/old/call", "owner", { meetingUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await call("/admin/old/call", "owner", { meetingUrl: "https://zoom.example.invalid/call" })).status, 200);
  assert.deepEqual(rows.get("dialogue_sessions/old"), { uid: "alice", outcome: "scheduled", venue: "zoom", wantsAgain: true, scheduledAt: 123, meetingUrl: "https://zoom.example.invalid/call" });
  assert.equal((await call("/admin/old/record", "owner", { outcome: "held" })).status, 200);
  assert.equal((await call("/old/access", "alice")).status, 409);
  assert.equal((await call("/admin/offer", "owner", { uid: "alice", scheduledAt: "2026-11-04", venue: "zoom", meetingUrl: "https://zoom.example.invalid/new" })).status, 200);
});
