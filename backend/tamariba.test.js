"use strict";
/* たまり場（backend/tamariba.js）。本物の Firebase は使わない（テスト用の Firestore の代わり）。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createTamaribaRouter, ROOMS, authorKeyOf } = require("./tamariba");
const { createIdentity } = require("./identity");
const { makeFirestore } = require("./fake-firestore");

const A = "SP-AAAA-AAAA-AAAA-AAAA", B = "SP-BBBB-BBBB-BBBB-BBBB", C = "SP-CCCC-CCCC-CCCC-CCCC", D = "SP-DDDD-DDDD-DDDD-DDDD";
const owner = "0x" + "f".repeat(40);
const startAt = Date.parse("2026-11-19T03:00:00Z");

async function fixture() {
  let clock = startAt;
  const db = makeFirestore({
    ches_accounts: {
      alice: { walletAddress: "alice", pass: true, displayName: "LINEの名前" },
      bob: { walletAddress: "bob", pass: true },
      carol: { walletAddress: "carol", pass: true },
      dave: { walletAddress: "dave", pass: true },
      boss: { walletAddress: owner, pass: true },
      unlinked: { walletAddress: "unlinked", pass: true }
    },
    user_profiles: { alice: { displayName: "ありす" } },
    sp_auth_links: { "fb:alice": { spid: A }, "fb:bob": { spid: B }, "fb:carol": { spid: C }, "fb:dave": { spid: D }, "fb:boss": { spid: D } },
    sp_identities: { [A]: { spid: A, status: "active" }, [B]: { spid: B, status: "active" }, [C]: { spid: C, status: "active" }, [D]: { spid: D, status: "active" } }
  });
  /* 部屋の一覧で使う、並べて数を絞る読み方だけ足す（City のテストと同じ考え方） */
  const collection = db.collection;
  db.collection = path => {
    const col = collection(path);
    const sorted = (conds, field, dir) => ({ limit: n => ({ get: async () => {
      const snap = await col.get();
      const docs = snap.docs.filter(d => conds.every(c => c.op === "<" ? d.data()[c.f] < c.v : true))
        .sort((a, b) => (a.data()[field] - b.data()[field]) * (dir === "desc" ? -1 : 1)).slice(0, n);
      return { docs };
    } }) });
    col.orderBy = (field, dir) => sorted([], field, dir);
    col.where = (f, op, v) => ({ orderBy: (field, dir) => sorted([{ f, op, v }], field, dir) });
    return col;
  };
  const app = express();
  app.use(express.json());
  app.use("/t", createTamaribaRouter({ db, identity: createIdentity({ db }),
    entitlement: { holdsOfficialPass: async (_uid, account) => account.pass === true },
    ownerAddresses: [owner], now: () => (clock += 1000),
    requireFirebaseUser(req, res, next) {
      if (!req.headers["x-test-uid"]) return res.status(401).json({ error: "AUTH_REQUIRED" });
      req.identity = { uid: req.headers["x-test-uid"] }; next();
    },
    rateLimit: () => (_req, _res, next) => next()
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/t";
  const call = async (uid, method, path, body) => {
    const r = await fetch(base + path, { method, headers: Object.assign({ "content-type": "application/json" }, uid ? { "x-test-uid": uid } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  return { db, call, close: () => new Promise(r => server.close(r)) };
}

test("入れるのはログインしてパスポートが連携された人だけ。部屋は決まった5つ", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("", "GET", "/rooms")).status, 401);
    assert.equal((await f.call("unlinked", "GET", "/rooms")).json.error, "PASSPORT_LINK_REQUIRED");
    const r = await f.call("alice", "GET", "/rooms");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.rooms.map(x => x.id), ROOMS.map(x => x.id));
    assert.equal(r.json.me.name, "ありす", "本人が付けた名前を使う");
    assert.equal(r.json.me.isOwner, false);
    assert.equal((await f.call("alice", "GET", "/rooms/nope/posts")).status, 404);
  } finally { await f.close(); }
});

test("書き込み・返信。出すのは名前だけで、パスポート番号やアドレスは出さない", async () => {
  const f = await fixture();
  try {
    const w = await f.call("alice", "POST", "/rooms/today/posts", { body: "  今日は公園を歩いた​  " });
    assert.equal(w.status, 200);
    const list = await f.call("bob", "GET", "/rooms/today/posts");
    assert.equal(list.json.posts.length, 1);
    const p = list.json.posts[0];
    assert.equal(p.body, "今日は公園を歩いた", "前後の空白と見えない文字は落とす");
    assert.equal(p.name, "ありす");
    assert.equal(p.mine, false);
    const text = JSON.stringify(list.json);
    assert.ok(!text.includes(A) && !text.includes("alice"), "番号・アドレスが漏れていない");
    assert.equal((await f.call("bob", "POST", "/rooms/today/posts/" + p.id + "/replies", { body: "いいね" })).status, 200);
    const replies = await f.call("alice", "GET", "/rooms/today/posts/" + p.id + "/replies");
    assert.equal(replies.json.replies.length, 1);
    assert.equal(replies.json.replies[0].name, "メンバーBBBB", "名前が無い人は番号の末尾だけ");
    const rooms = await f.call("alice", "GET", "/rooms");
    assert.equal(rooms.json.rooms.find(x => x.id === "today").count, 1);
    const again = await f.call("alice", "GET", "/rooms/today/posts");
    assert.equal(again.json.posts[0].replyCount, 1);
    assert.equal(again.json.posts[0].mine, true);
  } finally { await f.close(); }
});

test("空・長すぎる文は断る。1日の書き込みは10件まで", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("alice", "POST", "/rooms/today/posts", { body: "   " })).json.error, "BODY_REQUIRED");
    assert.equal((await f.call("alice", "POST", "/rooms/today/posts", { body: "あ".repeat(401) })).json.error, "BODY_TOO_LONG");
    assert.equal((await f.call("alice", "POST", "/rooms/today/posts", { body: "あ".repeat(400) })).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await f.call("alice", "POST", "/rooms/hobby/posts", { body: "好き" + i })).status, 200);
    const over = await f.call("alice", "POST", "/rooms/hobby/posts", { body: "11件目" });
    assert.equal(over.status, 429);
    assert.equal(over.json.error, "DAILY_LIMIT");
  } finally { await f.close(); }
});

test("通報：同じ人は1回だけ。自分のものは通報できない。ちがう3人で隠れ、運営が戻せる", async () => {
  const f = await fixture();
  try {
    const id = (await f.call("alice", "POST", "/rooms/together/posts", { body: "一緒に何かしよう" })).json.id;
    const path = "/rooms/together/posts/" + id + "/report";
    assert.equal((await f.call("alice", "POST", path, { reason: "spam" })).status, 403, "自分のものは通報できない");
    assert.equal((await f.call("bob", "POST", path, { reason: "spam" })).json.already, false);
    assert.equal((await f.call("bob", "POST", path, { reason: "spam" })).json.already, true, "同じ人の2回目は数えない");
    await f.call("carol", "POST", path, { reason: "harass" });
    assert.equal((await f.call("bob", "GET", "/rooms/together/posts")).json.posts.length, 1, "2人ではまだ隠れない");
    await f.call("unlinked", "POST", path, { reason: "spam" });
    await f.call("boss", "POST", path, { reason: "other" });
    assert.equal((await f.call("bob", "GET", "/rooms/together/posts")).json.posts.length, 0, "3人で隠れる");
    const mine = (await f.call("alice", "GET", "/rooms/together/posts")).json.posts;
    assert.equal(mine.length, 1, "書いた本人には見える");
    assert.equal(mine[0].hidden, true);
    const reports = await f.call("boss", "GET", "/admin/reports");
    assert.equal(reports.status, 200);
    assert.equal(reports.json.reports.length, 3);
    assert.ok(!JSON.stringify(reports.json).includes(B), "通報した人の番号は運営の一覧にも出さない");
    assert.equal((await f.call("bob", "GET", "/admin/reports")).status, 403, "運営だけ");
    assert.equal((await f.call("boss", "POST", "/admin/hide", { room: "together", postId: id, hidden: false })).status, 200);
    assert.equal((await f.call("bob", "GET", "/rooms/together/posts")).json.posts.length, 1, "運営が戻した");
  } finally { await f.close(); }
});

test("ブロックした人の書き込みと返信は、自分にだけ出ない", async () => {
  const f = await fixture();
  try {
    const id = (await f.call("bob", "POST", "/rooms/learnwork/posts", { body: "相談です" })).json.id;
    await f.call("alice", "POST", "/rooms/learnwork/posts", { body: "わたしも" });
    await f.call("bob", "POST", "/rooms/learnwork/posts/" + id + "/replies", { body: "追記" });
    const key = authorKeyOf(B);
    assert.equal((await f.call("alice", "POST", "/blocks", { authorKey: key })).status, 200);
    assert.equal((await f.call("alice", "POST", "/blocks", { authorKey: authorKeyOf(A) })).status, 400, "自分はブロックできない");
    const seen = (await f.call("alice", "GET", "/rooms/learnwork/posts")).json.posts;
    assert.deepEqual(seen.map(p => p.body), ["わたしも"]);
    assert.equal((await f.call("carol", "GET", "/rooms/learnwork/posts")).json.posts.length, 2, "ほかの人には出る");
    assert.deepEqual((await f.call("alice", "GET", "/blocks")).json.keys, [key]);
    await f.call("alice", "POST", "/blocks/remove", { authorKey: key });
    assert.equal((await f.call("alice", "GET", "/rooms/learnwork/posts")).json.posts.length, 2, "外すと出る");
  } finally { await f.close(); }
});

test("消す：自分のものだけ（運営はどれでも）。中身は消えて「消した」印だけ残る", async () => {
  const f = await fixture();
  try {
    const id = (await f.call("alice", "POST", "/rooms/tech/posts", { body: "消す予定" })).json.id;
    assert.equal((await f.call("bob", "POST", "/rooms/tech/posts/" + id + "/delete", {})).status, 403);
    assert.equal((await f.call("alice", "POST", "/rooms/tech/posts/" + id + "/delete", {})).status, 200);
    const p = (await f.call("bob", "GET", "/rooms/tech/posts")).json.posts[0];
    assert.equal(p.deleted, true);
    assert.equal(p.body, "");
    assert.equal((await f.call("bob", "POST", "/rooms/tech/posts/" + id + "/replies", { body: "返信" })).status, 404, "消したものには返信できない");
    const id2 = (await f.call("bob", "POST", "/rooms/tech/posts", { body: "運営が消す" })).json.id;
    assert.equal((await f.call("boss", "POST", "/rooms/tech/posts/" + id2 + "/delete", {})).status, 200);
  } finally { await f.close(); }
});

test("新しい順に20件ずつ。続きは before で読む", async () => {
  const f = await fixture();
  try {
    const users = ["alice", "bob", "carol"];
    for (let i = 0; i < 25; i++) await f.call(users[i % 3], "POST", "/rooms/hobby/posts", { body: "n" + i });
    const first = await f.call("dave", "GET", "/rooms/hobby/posts");
    assert.equal(first.json.posts.length, 20);
    assert.equal(first.json.posts[0].body, "n24");
    assert.ok(first.json.next);
    const second = await f.call("dave", "GET", "/rooms/hobby/posts?before=" + first.json.next);
    assert.equal(second.json.posts.length, 5);
    assert.equal(second.json.posts[4].body, "n0");
    assert.equal(second.json.next, null);
  } finally { await f.close(); }
});
