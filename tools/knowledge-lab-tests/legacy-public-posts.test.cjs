"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createFixture, PROJECT } = require("./fixture.cjs");
const { ensureVerifiedAccount } = require("../../backend/verified-platform");
const { utils } = require("../../backend/node_modules/ethers");
let f, me, other;
const prefix = "legacy-list-" + Date.now() + "-";
const created = [];
async function user(role) {
  const uid = prefix + role,
    email = uid + "@example.invalid";
  await f.firebase
    .auth()
    .createUser({ uid, email, password: "Emulator-only-password-123" });
  const r = await fetch(
    "http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Emulator-only-password-123",
        returnSecureToken: true,
      }),
    },
  );
  const { idToken } = await r.json();
  const decoded = await f.firebase.auth().verifyIdToken(idToken);
  const account = await ensureVerifiedAccount(f.db, decoded);
  const { spid } = await f.identity.resolveForUid(uid);
  await f.db
    .collection("entitlements")
    .doc(uid)
    .set({ plan: "plus", source: "emulator-only", startsAt: new Date(0) });
  f.users[role] = { uid, token: idToken, account, spid };
  return {
    uid,
    account,
    spid,
    walletAddress: account.walletAddress.toLowerCase(),
  };
}
async function put(suffix, extra = {}) {
  const id = prefix + suffix;
  await f.db
    .collection("posts")
    .doc(id)
    .set({
      title: "エミュレーター内の旧投稿",
      body: "以前のEmuで書いた内容を同じ投稿のまま編集します。",
      address: me.walletAddress,
      createdAt: new Date(),
      ...extra,
    });
  created.push(id);
  return id;
}
async function own(role = "legacyAuthor") {
  const items = [];
  let cursor;
  do {
    const r = await f.call(
      "GET",
      "/me/public-posts" + (cursor ? "?cursor=" + cursor : ""),
      role,
    );
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 20);
    items.push(...r.body.items);
    cursor = r.body.next;
    assert.ok(items.length < 100);
  } while (cursor);
  return items;
}
before(async () => {
  assert.equal(PROJECT, "demo-emu-knowledge-lab");
  // Preserve previous live-Gemini receipts. Only this run's synthetic posts are removed.
  f = await createFixture({ reset: false });
  me = await user("legacyAuthor");
  other = await user("legacyOther");
});
after(async () => {
  if (f) {
    for (const id of created) {
      await f.db.collection("posts").doc(id).delete();
      await f.api.service.ref("search", id).delete();
      await f.api.service.ref("semantic_queue", id).delete();
    }
    await f.close();
  }
});
test("legacy address, checksum, CHES, owner and author names appear alongside canonical Passport posts", async () => {
  const ids = [];
  ids.push(await put("lower"));
  ids.push(
    await put("checksum", { address: utils.getAddress(me.walletAddress) }),
  );
  ids.push(await put("ches", { address: me.account.chesAddress }));
  ids.push(await put("owner", { address: "", owner: me.walletAddress }));
  ids.push(await put("author", { address: "", author: me.walletAddress }));
  ids.push(
    await put("passport", {
      address: other.walletAddress,
      authorSchoolParkId: me.spid,
      visibility: "public",
    }),
  );
  const rows = await own();
  assert.deepEqual(rows.map((p) => p.id).sort(), ids.sort());
  assert.ok(rows.every((p) => p.editable));
  assert.deepEqual(await own("legacyOther"), []);
});
test("other Passport attribution, private and archived posts are excluded; Owner sees only own posts", async () => {
  const ids = [];
  ids.push(
    await put("conflict", {
      authorSchoolParkId: other.spid,
      visibility: "public",
    }),
  );
  ids.push(await put("private", { visibility: "private" }));
  ids.push(await put("archived", { visibility: "archived" }));
  ids.push(await put("foreign", { address: other.walletAddress }));
  assert.ok((await own()).every((p) => !ids.includes(p.id)));
  assert.ok((await own("owner")).every((p) => !created.includes(p.id)));
  const denied = await f.call("PUT", "/posts", "legacyAuthor", {
    id: ids[0],
    revision: 0,
    key: "conflict",
    title: "編集拒否",
    body: "所有者を変えない",
    visibility: "public",
    facets: {},
  });
  assert.equal(denied.status, 403);
});
test("the actual author edits a legacy post in place, retaining its ID and assigning canonical Passport", async () => {
  const id = prefix + "checksum";
  const result = await f.call("PUT", "/posts", "legacyAuthor", {
    id,
    revision: 0,
    key: "legacy-edit",
    title: "過去投稿を編集",
    body: "作り直さず同じ投稿を更新しました。",
    visibility: "public",
    facets: { field: ["field-it"] },
    aiUseConsent: false,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.id, id);
  const record = (await f.db.collection("posts").doc(id).get()).data();
  assert.equal(record.authorSchoolParkId, me.spid);
  assert.equal(record.address, utils.getAddress(me.walletAddress));
  assert.equal((await own()).filter((p) => p.id === id).length, 1);
  assert.equal(
    (
      await f.call("PUT", "/posts", "legacyOther", {
        id,
        revision: 1,
        key: "other-edit",
        title: "拒否",
        body: "他人",
        visibility: "public",
        facets: {},
      })
    ).status,
    403,
  );
});
test("mixed legacy and Passport queries paginate without duplicates or lost posts", async () => {
  for (let i = 0; i < 25; i++)
    await put(
      "page-" + String(i).padStart(2, "0"),
      i % 2
        ? { authorSchoolParkId: me.spid, visibility: "public" }
        : { address: utils.getAddress(me.walletAddress) },
    );
  const rows = await own(),
    ids = rows.map((p) => p.id);
  assert.equal(ids.length, 31);
  assert.equal(new Set(ids).size, 31);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal((await f.call("GET", "/me/public-posts")).status, 401);
});
