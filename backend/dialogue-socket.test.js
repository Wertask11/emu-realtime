"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { Server } = require("socket.io");
const { io: client } = require("socket.io-client");
const { attachDialogueSocket } = require("./dialogue-socket");

async function fixture(t) {
  let clock = Date.now();
  const sessions = new Map([["alice-booking", { uid: "alice", outcome: "scheduled" }],
    ["bob-booking", { uid: "bob", outcome: "scheduled" }]]);
  const server = http.createServer((req, res) => res.end("healthy"));
  const io = new Server(server, { maxHttpBufferSize: 16384 });
  const chat = attachDialogueSocket(io, {
    db: { collection: () => ({ doc: id => ({ get: async () => ({ exists: sessions.has(id), data: () => sessions.get(id) }) }) }) },
    ownerAddresses: ["owner-wallet"], now: () => clock,
    requireFirebaseUser: (req, res, next) => {
      const uid = req.headers.authorization.replace("Bearer ", "");
      if (!["alice", "bob", "owner"].includes(uid)) return res.status(401).json({ error: "INVALID_AUTH_TOKEN" });
      req.identity = { uid, walletAddress: uid + "-wallet", tokenExpiresAtMs: clock + 3600000 }; next();
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.disconnect()); chat.close(); await new Promise(resolve => io.close(resolve)); });
  function connect(token, sessionId) {
    const s = client(url, { auth: { token, sessionId }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s); return s;
  }
  async function ready(token = "alice", id = "alice-booking") {
    const s = connect(token, id); const received = once(s, "room3 history"); await once(s, "room3 ready");
    const envelope = (await received)[0]; assert.equal(envelope.sessionId, id);
    return { socket: s, history: envelope.messages };
  }
  const send = (s, value) => s.timeout(2000).emitWithAck("room3 message", value);
  return { connect, ready, send, sessions, url, advance: ms => { clock += ms; } };
}

test("F01/F02/F04: reject missing/forged auth and booking, never send anonymous history", async t => {
  const f = await fixture(t);
  for (const [token, id] of [[null, "alice-booking"], ["forged-owner-wallet", "alice-booking"], ["alice", "../x"], ["bob", "alice-booking"]]) {
    const s = f.connect(token, id); let histories = 0; s.on("room3 history", () => histories++);
    const [e] = await once(s, "connect_error"); assert.ok(e.data.code); assert.equal(histories, 0);
  }
  const { socket } = await f.ready();
  for (const payload of [null, [], {}, { text: 2 }, { text: "x".repeat(2001) }, { text: "x", replyTo: {} }]) {
    assert.equal((await f.send(socket, payload)).error, "INVALID_MESSAGE");
  }
  assert.equal((await socket.timeout(2000).emitWithAck("join room3", null)).ok, false);
  assert.equal((await fetch(f.url)).status, 200); // Malformed events never kill the HTTP server.
  assert.equal((await f.send(socket, { text: "still works" })).ok, true);
});

test("F03: live/history/replies isolated by booking; owner uses verified identity", async t => {
  const f = await fixture(t), a = await f.ready(), b = await f.ready("bob", "bob-booking"), owner = await f.ready("owner");
  const live = once(owner.socket, "room3 message"); let leaked = 0;
  b.socket.on("room3 message", () => leaked++);
  const result = await f.send(a.socket, { text: "private A", clientId: "first" });
  const [m] = await live; assert.equal(m.text, "private A"); assert.equal(m.wallet, undefined); assert.equal(m.authorUid, undefined);
  const same = await f.send(a.socket, { text: "private A", clientId: "first" }); assert.equal(same.messageId, result.messageId);
  const anew = await f.ready(); assert.equal(anew.history.length, 1); assert.equal(anew.history[0].authorUid, undefined);
  const bnew = await f.ready("bob", "bob-booking"); assert.equal(bnew.history.length, 0);
  assert.equal((await f.send(b.socket, { text: "try reply", replyTo: m.messageId })).error, "REPLY_NOT_FOUND");
  assert.equal(leaked, 0);
  f.sessions.get("alice-booking").outcome = "held";
  assert.equal((await f.send(a.socket, { text: "after completion" })).error, "SESSION_FORBIDDEN");
});

test("F11: bound sends, retained history count and retention; expire authentication", async t => {
  const f = await fixture(t), a = await f.ready();
  for (let i = 0; i < 20; i++) assert.equal((await f.send(a.socket, { text: "bounded " + i })).ok, true);
  assert.equal((await f.send(a.socket, { text: "limit" })).error, "RATE_LIMITED");
  for (let batch = 0; batch < 5; batch++) {
    f.advance(60001);
    for (let i = 0; i < 20; i++) assert.equal((await f.send(a.socket, { text: "batch " + batch + " " + i })).ok, true);
  }
  assert.equal((await f.ready()).history.length, 100);
  f.advance(2 * 3600000 + 1);
  assert.equal((await f.ready()).history.length, 0);
  assert.equal((await f.send(a.socket, { text: "expired" })).error, "AUTH_EXPIRED");
});

test("F11: a verified user cannot open unbounded simultaneous sockets", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) await f.ready();
  const extra = f.connect("alice", "alice-booking");
  const [e] = await once(extra, "connect_error");
  assert.equal(e.data.code, "DIALOGUE_CAPACITY");
  assert.equal((await fetch(f.url)).status, 200);
});
