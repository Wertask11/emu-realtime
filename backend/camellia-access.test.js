"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), http = require("node:http"), express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createCamelliaAuthRouter } = require("./camellia-auth");
const { createCamelliaAccessAdminRouter, normalizeCode, normalizeLabel } = require("./camellia-access");

/* 利用者は token の文字列がそのまま uid。"anon:" で始まるとゲスト（匿名）。 */
async function setup() {
  const db = makeFirestore();
  const firebaseAdmin = { auth: () => ({ verifyIdToken: async (t) => ({ uid: t, firebase: { sign_in_provider: t.startsWith("anon:") ? "anonymous" : "custom" } }) }) };
  const buckets = new Map();
  const rateLimit = ({ max, key }) => (req, res, next) => {
    const k = key + ":" + (req.identity && req.identity.uid);
    buckets.set(k, (buckets.get(k) || 0) + 1);
    return buckets.get(k) > max ? res.status(429).json({ error: "RATE_LIMITED" }) : next();
  };
  const requireOwner = (req, res, next) => (req.headers["x-test-owner"] === "1" ? (req.identity = { uid: "owner" }, next()) : res.status(403).json({ error: "OWNER_ONLY" }));
  const app = express();
  app.use(express.json());
  app.use("/auth", createCamelliaAuthRouter({ db, firebaseAdmin, identity: {}, requireFirebaseUser: (req, res, next) => next(), rateLimit }).router);
  app.use("/admin", createCamelliaAccessAdminRouter({ db, requireOwner, rateLimit }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, user, owner } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(owner ? { "x-test-owner": "1" } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    });
    return { status: r.status, body: await r.json() };
  };
  return { db, server, call };
}
const profile = (db, uid, extra) => db.collection("camellia_users").doc(uid).set({ birthDate: "2000-01-01", agreedAt: "2026-10-01T00:00:00Z", ...(extra || {}) });

test("code and label are normalized; ambiguous letters are refused", () => {
  assert.equal(normalizeCode("k7qm-2xpa"), "K7QM2XPA");
  assert.equal(normalizeCode("K7QM 2XPA"), "K7QM2XPA");
  assert.equal(normalizeCode("K7QM2XP0"), "", "0 is never in a code");
  assert.equal(normalizeCode("SHORT"), "");
  assert.equal(normalizeLabel(" Instagram_1027 "), "instagram_1027");
  assert.equal(normalizeLabel("営業"), "");
  assert.equal(normalizeLabel("a".repeat(33)), "");
  assert.equal(normalizeLabel("1027_instagram"), "", "must start with a letter");
  assert.equal(normalizeLabel("line_20261101"), "", "seven digits in a row are dropped by Camellia analytics");
  assert.equal(normalizeLabel("line_261101"), "line_261101");
});

test("while invites are off nobody is stopped; turning them on keeps everyone who was already in", async () => {
  const s = await setup();
  try {
    let now = 1_000;
    s.db._setNow(() => now);
    await profile(s.db, "camellia:before");
    const off = await s.call("GET", "/auth/access", { user: "camellia:new" });
    assert.equal(off.status, 200);
    assert.equal(off.body.needsInvite, false);
    assert.equal(off.body.inviteRequired, false);

    assert.equal((await s.call("POST", "/admin/config", { body: { inviteRequired: true } })).status, 403, "only the owner");
    now = 2_000;
    const on = await s.call("POST", "/admin/config", { owner: true, body: { inviteRequired: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.config.inviteRequired, true);
    assert.ok(on.body.config.requiredSince > 0);

    const before = await s.call("GET", "/auth/access", { user: "camellia:before" });
    assert.equal(before.body.needsInvite, false);
    assert.equal(before.body.via, "existing");
    now = Date.now() + 10_000;
    await profile(s.db, "camellia:after");
    const after = await s.call("GET", "/auth/access", { user: "camellia:after" });
    assert.equal(after.body.needsInvite, true, "a record made after the switch does not let you in by itself");
    const guest = await s.call("GET", "/auth/access", { user: "anon:guest" });
    assert.equal(guest.body.needsInvite, true);
    assert.equal(guest.body.signedIn, false);
  } finally { s.server.close(); }
});

test("an operator invite admits people up to its limit, once each, and never a guest", async () => {
  const s = await setup();
  try {
    await s.call("POST", "/admin/config", { owner: true, body: { inviteRequired: true } });
    assert.equal((await s.call("POST", "/admin/invites", { owner: true, body: { label: "営業", maxUses: 2 } })).body.error, "LABEL_INVALID");
    const made = await s.call("POST", "/admin/invites", { owner: true, body: { label: "instagram_1027", maxUses: 2, expiresInDays: 30 } });
    assert.equal(made.status, 200);
    const { code, url } = made.body.invite;
    assert.match(code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.equal(new URL(url).searchParams.get("invite"), code);
    assert.equal(new URL(url).searchParams.get("utm_campaign"), "instagram_1027");

    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "anon:guest", body: { code } })).status, 403);
    const first = await s.call("POST", "/auth/invite/redeem", { user: "camellia:a", body: { code: code.toLowerCase().slice(0, 4) + "-" + code.slice(4) } });
    assert.equal(first.status, 200);
    assert.deepEqual([first.body.kind, first.body.label, first.body.already], ["operator", "instagram_1027", false]);
    const again = await s.call("POST", "/auth/invite/redeem", { user: "camellia:a", body: { code } });
    assert.equal(again.body.already, true, "using it twice does not use it up");
    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "camellia:b", body: { code } })).status, 200);
    const full = await s.call("POST", "/auth/invite/redeem", { user: "camellia:c", body: { code } });
    assert.equal(full.status, 410);
    assert.equal(full.body.error, "INVITE_USED_UP");
    assert.equal((await s.call("GET", "/auth/access", { user: "camellia:a" })).body.needsInvite, false);
    assert.equal((await s.call("GET", "/auth/access", { user: "camellia:c" })).body.needsInvite, true);
    const record = s.db._dump("camellia_users/camellia:a/admin").access;
    assert.equal(record.inviteLabel, "instagram_1027");
    assert.equal(record.invitedBy, "owner");

    const listed = await s.call("GET", "/admin/", { owner: true });
    assert.equal(listed.body.invites[0].uses, 2);
    await s.call("POST", "/admin/invites/revoke", { owner: true, body: { code } });
    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "camellia:d", body: { code } })).body.error, "INVITE_REVOKED");
    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "camellia:d", body: { code: "ZZZZZZZZ" } })).status, 404);
  } finally { s.server.close(); }
});

test("guessing codes is rate limited", async () => {
  const s = await setup();
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await s.call("POST", "/auth/invite/redeem", { user: "camellia:guess", body: { code: "ZZZZZZZZ" } });
    assert.equal(last.status, 429);
  } finally { s.server.close(); }
});

test("a member who declared herself a woman can invite three friends, but not herself", async () => {
  const s = await setup();
  try {
    await profile(s.db, "camellia:member");
    assert.equal((await s.call("POST", "/auth/invite/mine", { user: "camellia:member" })).body.error, "PROFILE_REQUIRED", "the self-declaration comes first");
    await profile(s.db, "camellia:member", { womanSelfDeclared: true });
    assert.equal((await s.call("GET", "/auth/invite/mine", { user: "camellia:member" })).body.invite, null, "reading does not create one");
    const mine = await s.call("POST", "/auth/invite/mine", { user: "camellia:member" });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.invite.maxUses, 3);
    assert.equal(new URL(mine.body.invite.url).searchParams.get("utm_source"), "member_invite");
    assert.equal(new URL(mine.body.invite.url).searchParams.get("utm_campaign"), null, "nothing about the member goes into the link");
    const same = await s.call("POST", "/auth/invite/mine", { user: "camellia:member" });
    assert.equal(same.body.invite.code, mine.body.invite.code, "one code per member");

    await s.call("POST", "/admin/config", { owner: true, body: { inviteRequired: true } });
    const code = mine.body.invite.code;
    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "camellia:member", body: { code } })).body.already, true, "she is already in");
    const friend = await s.call("POST", "/auth/invite/redeem", { user: "camellia:friend", body: { code } });
    assert.equal(friend.body.kind, "member");
    assert.equal(s.db._dump("camellia_users/camellia:friend/admin").access.invitedBy, "camellia:member");
    assert.equal((await s.call("POST", "/auth/invite/mine", { user: "camellia:outsider" })).body.error, "INVITE_REQUIRED");
  } finally { s.server.close(); }
});

test("a stopped person cannot redeem or invite, and the owner can restore her", async () => {
  const s = await setup();
  try {
    await profile(s.db, "camellia:x", { womanSelfDeclared: true, camelliaId: "CAM-ABCD-EFGH-JKLM" });
    assert.equal((await s.call("POST", "/admin/suspend", { owner: true, body: { user: "camellia:x", reason: "because" } })).body.error, "REASON_INVALID");
    assert.equal((await s.call("POST", "/admin/suspend", { owner: true, body: { user: "camellia:nobody", reason: "terms" } })).status, 404);
    const stopped = await s.call("POST", "/admin/suspend", { owner: true, body: { user: "cam-abcd-efgh-jklm", reason: "not_eligible" } });
    assert.equal(stopped.status, 200, "found by Camellia ID");
    assert.equal(stopped.body.user.suspended, true);
    assert.equal((await s.call("GET", "/auth/access", { user: "camellia:x" })).body.suspended, true);
    assert.equal((await s.call("POST", "/auth/invite/mine", { user: "camellia:x" })).body.error, "SUSPENDED");
    const made = await s.call("POST", "/admin/invites", { owner: true, body: { label: "line", maxUses: 5 } });
    assert.equal((await s.call("POST", "/auth/invite/redeem", { user: "camellia:x", body: { code: made.body.invite.code } })).body.error, "SUSPENDED");
    const listed = await s.call("GET", "/admin/", { owner: true });
    assert.deepEqual(listed.body.suspended.map((r) => [r.uid, r.camelliaId, r.reason]), [["camellia:x", "CAM-ABCD-EFGH-JKLM", "not_eligible"]]);
    await s.call("POST", "/admin/restore", { owner: true, body: { user: "camellia:x" } });
    assert.equal((await s.call("GET", "/auth/access", { user: "camellia:x" })).body.suspended, false);
    assert.deepEqual((await s.call("GET", "/admin/", { owner: true })).body.suspended, []);
    const auditLog = Object.values(s.db._dump("camellia_admin/release_phase1/access_audit")).map((e) => e.action);
    assert.deepEqual(auditLog.filter((a) => a.startsWith("user.")), ["user.suspend", "user.restore"]);
  } finally { s.server.close(); }
});
