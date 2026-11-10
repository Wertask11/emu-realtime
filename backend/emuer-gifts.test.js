"use strict";
/* 応援・協賛・投票（11/10）。未変換の EMUER（emuer_offchain）だけを動かす。
   見ること：残高が足りないと動かない・無から作らない・自分には贈れない・押し直しで二重にならない・
   1日100まで・協賛の袋は完走した人だけが1回受け取れる・投票は1人1票・額はサーバーの選択肢だけ。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createGiftsRouter, DAILY_LIMIT, SPONSOR_BONUS } = require("./emuer-gifts");

const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40);
const USERS = {
  alice: { uid: "ua", walletAddress: A, account: { displayName: "ありす", spid: "SP-A" } },
  bob: { uid: "ub", walletAddress: B, account: { displayName: "ぼぶ", spid: "SP-B" } },
  carol: { uid: "uc", walletAddress: C, account: { displayName: "きゃろる", spid: "SP-C" } }
};
async function serve(seed, { t = Date.UTC(2026, 10, 10, 3) } = {}) {
  const db = makeFirestore(seed);
  let clock = t;
  const app = express();
  const requireFirebaseUser = (req, res, next) => { const u = USERS[req.headers["x-user"]]; if (!u) return res.status(401).end(); req.identity = u; next(); };
  const requireOwner = (req, res, next) => requireFirebaseUser(req, res, () => (req.identity.uid === "ua" ? next() : res.status(403).end()));
  app.use("/g", createGiftsRouter({ db, requireFirebaseUser, requireOwner, now: () => clock }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/g";
  const call = async (method, path, user, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { db, call, setNow: (v) => { clock = v; }, close: () => new Promise((r) => server.close(r)) };
}
const bal = (db, addr) => (db._dump("emuer_offchain")[addr] || {}).balance || 0;
const seed = () => ({
  emuer_offchain: { [A]: { balance: 200 }, [B]: { balance: 3 } },
  posts: { p1: { title: "朝の音読", address: B }, p2: { title: "自分の投稿", address: A } },
  sp_quests: { q1: { title: "一般 #001 入門" }, "founder-quest-000": { title: "#000" } },
  sp_quest_certificates: { c1: { questId: "q1", spid: "SP-C" } }
});

test("応援：贈った分だけ相手の未変換EMUERに入る。足りない・自分の投稿・決まっていない額は動かない。押し直しで二重にならない", async () => {
  const s = await serve(seed());
  try {
    const ok = await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 5, requestId: "req-00001" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.people, 1);
    assert.equal(ok.body.total, 5);
    assert.equal(bal(s.db, A), 195);
    assert.equal(bal(s.db, B), 8);
    assert.equal(s.db._dump("emuer_offchain")[B].giftIn, 5);
    assert.equal(s.db._dump("emuer_offchain")[A].giftOut, 5);
    const again = await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 5, requestId: "req-00001" });
    assert.equal(again.body.already, true);
    assert.equal(bal(s.db, A), 195, "同じ requestId は1回だけ");
    const second = await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 1, requestId: "req-00002" });
    assert.equal(second.body.people, 1, "同じ人は人数に数え直さない");
    assert.equal(second.body.total, 6);

    assert.equal((await s.call("POST", "/cheer", "bob", { postId: "p2", amount: 10, requestId: "req-00003" })).body.error, "INSUFFICIENT_EMUER");
    assert.equal((await s.call("POST", "/cheer", "alice", { postId: "p2", amount: 1, requestId: "req-00004" })).body.error, "OWN_POST");
    assert.equal((await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 7, requestId: "req-00005" })).body.error, "INVALID_AMOUNT");
    assert.equal((await s.call("POST", "/cheer", "alice", { postId: "nope", amount: 1, requestId: "req-00006" })).status, 404);
    assert.equal((await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 1, requestId: "req-00007" })).body.error, "INSUFFICIENT_EMUER", "残高の記録が無い人は0として扱う");
    assert.equal(bal(s.db, A) + bal(s.db, B), 203, "合計は増えも減りもしない");

    const counts = await s.call("GET", "/cheers?ids=p1,p2,bad id");
    assert.deepEqual(counts.body.counts, { p1: { people: 1, total: 6 } });
    const inbox = await s.call("GET", "/inbox", "bob");
    assert.equal(inbox.body.items.length, 2);
    assert.equal(inbox.body.total, 6);
    assert.equal(inbox.body.items[0].fromName, "ありす");
    assert.ok(!JSON.stringify(inbox.body).includes(A), "相手のアドレスは見せない");
    await s.call("POST", "/inbox/seen", "bob", { ids: inbox.body.items.map((x) => x.id) });
    assert.equal((await s.call("GET", "/inbox", "bob")).body.items.length, 0);
    assert.ok(Object.keys(s.db._dump("emuer_offchain_ledger")).length >= 2, "監査の記録を残す");
  } finally { await s.close(); }
});

test("応援と協賛は合わせて1日100まで。日本時間で日が変わると戻る", async () => {
  const s = await serve({ ...seed(), emuer_offchain: { [A]: { balance: 1000 } } });
  try {
    let n = 0;
    for (let i = 0; i < 9; i++) assert.equal((await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 10, requestId: "day-0000" + i })).status, 200), n += 10;
    assert.equal((await s.call("POST", "/sponsor", "alice", { questId: "q1", amount: 10, requestId: "day-sp-01" })).status, 200);
    const over = await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 1, requestId: "day-over-1" });
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "DAILY_LIMIT");
    assert.equal(DAILY_LIMIT, 100);
    s.setNow(Date.UTC(2026, 10, 10, 15, 1));
    assert.equal((await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 1, requestId: "day-next-1" })).status, 200);
  } finally { await s.close(); }
});

test("協賛：袋に積む。完走した人だけが1人10ずつ1回受け取れる。袋が空なら受け取れない", async () => {
  const s = await serve(seed());
  try {
    const sp = await s.call("POST", "/sponsor", "alice", { questId: "q1", amount: 30, requestId: "spon-0001" });
    assert.equal(sp.status, 200);
    assert.equal(sp.body.pot, 30);
    assert.equal(sp.body.sponsors, 1);
    assert.equal(sp.body.peopleLeft, 3);
    assert.equal(bal(s.db, A), 170);
    assert.equal((await s.call("POST", "/sponsor", "alice", { questId: "founder-quest-000", amount: 5, requestId: "spon-0002" })).status, 404, "#000 には協賛しない");
    assert.equal((await s.call("POST", "/sponsor", "alice", { questId: "q1", amount: 1, requestId: "spon-0003" })).body.error, "INVALID_AMOUNT");

    assert.equal((await s.call("POST", "/sponsor/q1/claim", "bob")).body.error, "NOT_COMPLETED");
    const mine = await s.call("GET", "/sponsor/q1/mine", "carol");
    assert.deepEqual([mine.body.completed, mine.body.claimed], [true, false]);
    const claim = await s.call("POST", "/sponsor/q1/claim", "carol");
    assert.equal(claim.status, 200);
    assert.equal(claim.body.amount, SPONSOR_BONUS);
    assert.equal(claim.body.pot, 20);
    assert.equal(bal(s.db, C), 10);
    assert.equal((await s.call("POST", "/sponsor/q1/claim", "carol")).body.already, true, "1人1回");
    assert.equal(bal(s.db, C), 10);
    const pot = await s.call("GET", "/sponsor/q1");
    assert.deepEqual([pot.body.pot, pot.body.paidOut, pot.body.bonusCount, pot.body.total], [20, 10, 1, 30]);
  } finally { await s.close(); }
  const empty = await serve(seed());
  try { assert.equal((await empty.call("POST", "/sponsor/q1/claim", "carol")).body.error, "POT_EMPTY"); } finally { await empty.close(); }
});

test("投票：運営が作る。1人1票。決めた分の EMUER を使う。締めたら入れられない", async () => {
  const s = await serve(seed());
  try {
    assert.equal((await s.call("POST", "/admin/polls", "bob", { question: "x", options: ["a", "b"], cost: 1, days: 7 })).status, 403);
    assert.equal((await s.call("POST", "/admin/polls", "alice", { question: "次のグッズは？", options: ["ステッカー"], cost: 1, days: 7 })).body.error, "OPTIONS_2_TO_6");
    const made = await s.call("POST", "/admin/polls", "alice", { question: "次のグッズは？", options: ["ステッカー", "マグ", "トート"], cost: 2, days: 7 });
    assert.equal(made.status, 200);
    const id = made.body.poll.id;
    const v = await s.call("POST", "/polls/" + id + "/vote", "bob", { option: "o2" });
    assert.equal(v.status, 200);
    assert.equal(v.body.poll.myVote, "o2");
    assert.equal(v.body.poll.options[1].votes, 1);
    assert.equal(bal(s.db, B), 1, "決めた分を使う");
    assert.equal((await s.call("POST", "/polls/" + id + "/vote", "bob", { option: "o1" })).body.error, "ALREADY_VOTED");
    assert.equal((await s.call("POST", "/polls/" + id + "/vote", "carol", { option: "o1" })).body.error, "INSUFFICIENT_EMUER");
    assert.equal((await s.call("POST", "/polls/" + id + "/vote", "alice", { option: "o9" })).body.error, "INVALID_OPTION");
    const list = await s.call("GET", "/polls/mine", "bob");
    assert.equal(list.body.polls[0].myVote, "o2");
    await s.call("POST", "/admin/polls/" + id + "/close", "alice", {});
    assert.equal((await s.call("POST", "/polls/" + id + "/vote", "alice", { option: "o1" })).body.error, "POLL_CLOSED");
    assert.equal((await s.call("GET", "/polls")).body.polls[0].open, false);
  } finally { await s.close(); }
});
