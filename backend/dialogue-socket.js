"use strict";

const { randomUUID } = require("node:crypto");

// Supplemental text chat for an existing booking. It never creates a booking,
// marks attendance, changes membership, or issues a reward.
function attachDialogueSocket(io, deps) {
  const { db, requireFirebaseUser, ownerAddresses = [] } = deps;
  const now = deps.now || Date.now;
  const history = new Map(), rates = new Map(), joinRates = new Map(), active = new Map();
  const TTL = 2 * 60 * 60 * 1000, MAX_SESSIONS = 50, MAX_MESSAGES = 100;
  const record = v => v && typeof v === "object" && !Array.isArray(v);
  const validId = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  const error = code => Object.assign(new Error(code), { data: { code } });
  const owner = a => [a.walletAddress, a.account?.chesAddress]
    .some(v => ownerAddresses.includes(String(v || "").toLowerCase()));

  function prune() {
    for (const [id, value] of history) {
      value.messages = value.messages.filter(m => m.timestamp > now() - TTL);
      if (value.updatedAt <= now() - TTL) history.delete(id);
    }
    for (const bucket of [rates, joinRates])
      for (const [id, value] of bucket) if (value.at <= now() - 60000) bucket.delete(id);
  }
  function takeRate(uid, bucket = rates, limit = 20) {
    prune();
    let r = bucket.get(uid);
    if (!r) {
      if (bucket.size >= 5000) throw error("RATE_LIMITED");
      bucket.set(uid, r = { at: now(), count: 0 });
    }
    if (++r.count > limit) throw error("RATE_LIMITED");
  }
  async function authorize(socket) {
    const a = socket.data.dialogueActor;
    if (!a || !socket.data.sessionId) throw error("AUTH_REQUIRED");
    if (!Number.isFinite(a.tokenExpiresAtMs) || a.tokenExpiresAtMs <= now()) throw error("AUTH_EXPIRED");
    const doc = await db.collection("dialogue_sessions").doc(socket.data.sessionId).get();
    if (!doc.exists) throw error("SESSION_NOT_FOUND");
    const s = doc.data();
    if (s.outcome !== "scheduled" || (s.uid !== a.uid && !owner(a))) throw error("SESSION_FORBIDDEN");
    return s;
  }
  function authenticate(socket) {
    return new Promise((resolve, reject) => {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token || token.length > 8192) return reject(error("AUTH_REQUIRED"));
      const req = { headers: { authorization: "Bearer " + token } };
      const res = { status() { return this; }, json(body) { reject(error(body.error || "AUTH_REQUIRED")); } };
      Promise.resolve(requireFirebaseUser(req, res, () => resolve(req.identity))).catch(() => reject(error("AUTH_REQUIRED")));
    });
  }
  io.use((socket, next) => {
    (async () => {
      if (!db || !validId(socket.handshake.auth?.sessionId)) throw error("SESSION_REQUIRED");
      socket.data.dialogueActor = await authenticate(socket);
      socket.data.sessionId = socket.handshake.auth.sessionId;
      takeRate(socket.data.dialogueActor.uid, joinRates, 12);
      await authorize(socket);
      if ((active.get(socket.data.dialogueActor.uid)?.size || 0) >= 4 ||
          [...active.values()].reduce((n, set) => n + set.size, 0) >= 200) throw error("DIALOGUE_CAPACITY");
    })().then(() => next(), e => next(error(e.data?.code || "AUTH_REQUIRED")));
  });
  io.on("connection", socket => {
    const uid = socket.data.dialogueActor.uid;
    const connections = active.get(uid) || new Set();
    // Check again after async authentication to close a concurrent-connection race.
    if (connections.size >= 4 || [...active.values()].reduce((n, set) => n + set.size, 0) >= 200) {
      socket.emit("room3 denied", { error: "DIALOGUE_CAPACITY" }); socket.disconnect(true); return;
    }
    active.set(uid, connections); connections.add(socket.id);
    socket.on("disconnect", () => { connections.delete(socket.id); if (!connections.size) active.delete(uid); });
    const room = "dialogue:" + socket.data.sessionId;
    const deny = (e, ack) => {
      const code = e.data?.code || "DIALOGUE_UNAVAILABLE";
      socket.emit("room3 denied", { error: code });
      if (typeof ack === "function") ack({ ok: false, error: code });
      if (["AUTH_REQUIRED", "AUTH_EXPIRED", "SESSION_FORBIDDEN", "SESSION_NOT_FOUND"].includes(code)) socket.disconnect(true);
    };
    const ready = (async () => {
      await authorize(socket);
      prune();
      if (!history.has(socket.data.sessionId)) {
        if (history.size >= MAX_SESSIONS) throw error("DIALOGUE_CAPACITY");
        history.set(socket.data.sessionId, { updatedAt: now(), messages: [] });
      }
      await socket.join(room);
      socket.emit("room3 history", { sessionId: socket.data.sessionId,
        messages: history.get(socket.data.sessionId).messages.map(({ authorUid, clientId, ...m }) => m) });
      socket.emit("room3 ready", { sessionId: socket.data.sessionId });
    })();
    ready.catch(e => { deny(e); socket.disconnect(true); });
    const expiry = setTimeout(() => socket.disconnect(true), Math.min(2147483647,
      Math.max(1, socket.data.dialogueActor.tokenExpiresAtMs - now())));
    expiry.unref?.();
    socket.on("disconnect", () => clearTimeout(expiry));
    // Old clients cannot select a wallet or join a different booking.
    socket.on("join room3", (_data, ack) => deny(error("SESSION_HANDSHAKE_REQUIRED"), ack));
    socket.on("room3 message", (data, ack) => {
      (async () => {
        if (!record(data) || typeof data.text !== "string" || !data.text.trim() || data.text.length > 2000
          || (data.replyTo != null && !validId(data.replyTo))
          || (data.clientId != null && !validId(data.clientId))) throw error("INVALID_MESSAGE");
        takeRate(socket.data.dialogueActor.uid);
        await ready;
        await authorize(socket); // Recheck cancellation/ownership on every send.
        if (!socket.connected) throw error("AUTH_REQUIRED");
        prune();
        let state = history.get(socket.data.sessionId);
        if (!state) {
          if (history.size >= MAX_SESSIONS) throw error("DIALOGUE_CAPACITY");
          history.set(socket.data.sessionId, state = { updatedAt: now(), messages: [] });
        }
        const duplicate = data.clientId && state.messages.find(m => m.authorUid === socket.data.dialogueActor.uid && m.clientId === data.clientId);
        if (duplicate) return typeof ack === "function" && ack({ ok: true, messageId: duplicate.messageId });
        const replied = data.replyTo && state.messages.find(m => m.messageId === data.replyTo);
        if (data.replyTo && !replied) throw error("REPLY_NOT_FOUND");
        const a = socket.data.dialogueActor;
        const message = { id: socket.id, sessionId: socket.data.sessionId, messageId: randomUUID(), text: data.text.trim(),
          timestamp: now(), replyTo: replied?.messageId || null, replyText: replied?.text || null };
        // Private dedup metadata is never sent to clients.
        state.messages.push({ ...message, authorUid: a.uid, clientId: data.clientId || null });
        state.messages = state.messages.slice(-MAX_MESSAGES); state.updatedAt = now();
        io.to(room).emit("room3 message", message);
        if (typeof ack === "function") ack({ ok: true, messageId: message.messageId });
      })().catch(e => deny(e, ack));
    });
  });
  const cleanup = setInterval(prune, 60000); cleanup.unref?.();
  io.on("close", () => clearInterval(cleanup));
  return { close: () => clearInterval(cleanup) };
}

module.exports = { attachDialogueSocket };
