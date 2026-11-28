"use strict";
/* 応援・協賛・投票（11/10）。未変換の EMUER（emuer_offchain）だけを動かす。
   見ること：残高が足りないと動かない・無から作らない・自分には贈れない・押し直しで二重にならない・
   1日100まで・協賛の袋は完走した人だけが1回受け取れる・投票は1人1票・額はサーバーの選択肢だけ。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createGiftsRouter, DAILY_LIMIT, SPONSOR_BONUS } = require("./emuer-gifts");

const { ethers } = require("ethers");
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40);
const D = "0x" + "d".repeat(40), E = "0x" + "e".repeat(40);   // だいち：ウォレットでログイン（D）。アプリが作ったアドレスは E
const USERS = {
  alice: { uid: "ua", walletAddress: A, account: { displayName: "ありす", spid: "SP-A" } },
  bob: { uid: "ub", walletAddress: B, account: { displayName: "ぼぶ", spid: "SP-B" } },
  carol: { uid: "uc", walletAddress: C, account: { displayName: "きゃろる", spid: "SP-C" } },
  daichi: { uid: "ud", walletAddress: D, account: { displayName: "だいち", spid: "SP-D", chesAddress: ethers.utils.getAddress(E) } }
};
async function serve(seed, { t = Date.UTC(2026, 10, 10, 3), chain = null } = {}) {
  const db = makeFirestore(seed);
  let clock = t;
  const app = express();
  const requireFirebaseUser = (req, res, next) => { const u = USERS[req.headers["x-user"]]; if (!u) return res.status(401).end(); req.identity = u; next(); };
  const requireOwner = (req, res, next) => requireFirebaseUser(req, res, () => (req.identity.uid === "ua" ? next() : res.status(403).end()));
  app.use("/g", createGiftsRouter({ db, requireFirebaseUser, requireOwner, now: () => clock, chain }));
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

test("運営：協賛の袋と応援の合計を見られる（運営でない人は見られない）", async () => {
  const s = await serve(seed());
  try {
    await s.call("POST", "/sponsor", "alice", { questId: "q1", amount: 30, requestId: "spon-0101" });
    await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 5, requestId: "req-00101" });
    await s.call("POST", "/sponsor/q1/claim", "carol");
    const r = await s.call("GET", "/admin/summary", "alice");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sponsor.pots.map((p) => [p.questId, p.title, p.total, p.pot, p.sponsors, p.paidOut]), [["q1", "一般 #001 入門", 30, 20, 1, 10]]);
    assert.deepEqual([r.body.sponsor.total, r.body.sponsor.paidOut], [30, 10]);
    assert.deepEqual([r.body.cheer.posts, r.body.cheer.total], [1, 5]);
    assert.deepEqual(r.body.cheer.top, [{ postId: "p1", title: "朝の音読", total: 5, people: 1 }]);
    assert.equal(JSON.stringify(r.body).includes(A), false, "贈った人のアドレスは出さない");
    assert.equal((await s.call("GET", "/admin/summary", "bob")).status, 403);
  } finally { await s.close(); }
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

test("もらった側：アプリが作ったアドレスの名義の投稿でも、ログインの名義に届いて使える。自分の投稿には贈れない", async () => {
  const s = await serve({ ...seed(),
    emuer_offchain: { [A]: { balance: 200 }, [D]: { balance: 0 }, [E]: { balance: 4, giftIn: 3, giftOut: 0, bountyBalance: 1 } },
    posts: { ...seed().posts, p3: { title: "だいちの知恵", address: ethers.utils.getAddress(E) } },
    ches_accounts: { ud: { walletAddress: ethers.utils.getAddress(D), chesAddress: ethers.utils.getAddress(E) } },
    emuer_v2_gift_events: { ["cheer-" + "1".repeat(40)]: { kind: "cheer", to: E, amount: 3, fromName: "まえのひと", postTitle: "だいちの知恵", seen: false, createdAtMs: 1 } } });
  try {
    const ok = await s.call("POST", "/cheer", "alice", { postId: "p3", amount: 5, requestId: "req-10001" });
    assert.equal(ok.status, 200);
    assert.equal(bal(s.db, D), 5, "ログインの名義の台帳に入る");
    assert.equal((await s.call("POST", "/cheer", "daichi", { postId: "p3", amount: 1, requestId: "req-10002" })).body.error, "OWN_POST");

    const inbox = await s.call("GET", "/inbox", "daichi");
    assert.equal(inbox.body.items.length, 2, "前にアプリのアドレスへ届いていた分も知らせる");
    assert.equal(inbox.body.total, 8);
    const seen = await s.call("POST", "/inbox/seen", "daichi", { ids: inbox.body.items.map((x) => x.id) });
    assert.equal(seen.body.moved, 3, "応援で受け取った分だけを移す（懸賞の分は動かさない）");
    assert.equal(seen.body.balance, 8);
    assert.equal(bal(s.db, E), 1);
    assert.equal(bal(s.db, A) + bal(s.db, D) + bal(s.db, E), 204, "合計は増えも減りもしない");
    assert.equal((await s.call("GET", "/inbox", "daichi")).body.items.length, 0);
    assert.equal((await s.call("POST", "/inbox/seen", "daichi", { ids: [] })).body.moved, 0, "2回目は動かさない");

    const spend = await s.call("POST", "/cheer", "daichi", { postId: "p1", amount: 5, requestId: "req-10003" });
    assert.equal(spend.status, 200, "もらったEMUERで、すぐ応援できる");
    assert.equal(spend.body.balance, 3);
  } finally { await s.close(); }
});

test("もらった側：20秒ごとの確認は、何も届いていなければ台帳を読まずに返す。届いたらすぐ出す。5分たったら必ず調べる", async () => {
  const s = await serve(seed());
  try {
    assert.equal((await s.call("GET", "/inbox?quick=1", "bob")).body.quick, undefined, "はじめは必ず調べる");
    assert.equal((await s.call("GET", "/inbox?quick=1", "bob")).body.quick, true);
    s.setNow(Date.UTC(2026, 10, 10, 3, 0, 20));
    await s.call("POST", "/cheer", "alice", { postId: "p1", amount: 3, requestId: "req-20001" });
    s.setNow(Date.UTC(2026, 10, 10, 3, 0, 30));
    const got = await s.call("GET", "/inbox?quick=1", "bob");
    assert.equal(got.body.quick, undefined);
    assert.equal(got.body.items.length, 1, "届いたら次の確認で出る");
    s.setNow(Date.UTC(2026, 10, 10, 3, 0, 40));
    assert.equal((await s.call("GET", "/inbox?quick=1", "bob")).body.quick, true);
    s.setNow(Date.UTC(2026, 10, 10, 3, 6));
    assert.equal((await s.call("GET", "/inbox?quick=1", "bob")).body.quick, undefined, "5分たったら調べ直す");
  } finally { await s.close(); }
});

/* 11/13：ログインの記録に名前が無い人の応援が「Emuerさんから」と届き、誰からか分からなかった。
   画面で付けた名前（user_profiles）を、本人の2つのアドレスの順に引く。前に届いた分も、いまの名前で出す。 */
test("応援：送った人の名前は、画面で付けた名前（user_profiles）で届く。前に「Emuer」で届いた分も名前で出す", async () => {
  const noName = { uid: "un", walletAddress: C, account: { spid: "SP-N", chesAddress: ethers.utils.getAddress(E) } };
  const s = await serve({ ...seed(),
    emuer_offchain: { [A]: { balance: 200 }, [B]: { balance: 3 }, [C]: { balance: 50 } },
    user_profiles: { [E]: { address: E, displayName: "メンマ" }, [D]: { address: D, displayName: "だいちのなまえ" } },
    emuer_v2_gift_events: { ["cheer-" + "f".repeat(40)]: { kind: "cheer", from: D, to: B, amount: 3, postId: "p1", postTitle: "朝の音読", fromName: "Emuer", seen: false, createdAtMs: 1 } } });
  USERS.noname = noName;
  try {
    const ok = await s.call("POST", "/cheer", "noname", { postId: "p1", amount: 1, requestId: "req-name-01" });
    assert.equal(ok.status, 200);
    const inbox = await s.call("GET", "/inbox", "bob");
    const names = inbox.body.items.map((x) => x.fromName).sort();
    assert.deepEqual(names, ["だいちのなまえ", "メンマ"], "アプリが作ったアドレス側の名前も使う・前の分も名前で出す");
    assert.ok(!JSON.stringify(inbox.body).includes(C) && !JSON.stringify(inbox.body).includes(D), "相手のアドレスは見せない");
  } finally { delete USERS.noname; await s.close(); }
});

/* 11/15 オーナー「1つにまとめていいよ」：応援・協賛・投票も、受け取る前の報酬（公式ショップ・みてみるで使うEMUER）から払える。 */
const W = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
const reward = (recipient, amount, extra = {}) => ({ schema: "emuer-v2-reward-v1", kind: "daily-login", recipient, amountWei: W(amount),
  amount: String(amount), status: "pending", claimId: extra.claimId, createdAt: new Date(Date.UTC(2026, 10, 1)), ...extra });
const paidChain = (paid = {}) => ({ claimPaid: async (id) => BigInt(paid[id] || "0") });
const rewardsOf = (db, addr) => Object.entries(db._dump("emuer_v2_rewards")).filter(([, r]) => r.recipient === addr);

test("ひとつのアプリ内EMUER：台帳で足りないぶんは受け取る前の報酬から払う。受け取った人には報酬として入り、台帳の giftIn/giftOut は台帳のぶんだけ", async () => {
  const s = await serve({ ...seed(), emuer_offchain: { [C]: { balance: 2 } },
    emuer_v2_rewards: { r1: reward(C, 2, { createdAt: new Date(Date.UTC(2026, 10, 1)) }), r2: reward(C, 3, { createdAt: new Date(Date.UTC(2026, 10, 2)) }) } },
    { chain: paidChain() });
  try {
    const me = await s.call("GET", "/me", "carol");
    assert.equal(me.body.balance, 7, "台帳2＋報酬5を1つの残高として見せる");
    assert.equal(me.body.ledger, 2);
    assert.equal(me.body.rewards, 5);
    const ok = await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 5, requestId: "mix-00001" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.balance, 2, "7−5");
    const l = s.db._dump("emuer_offchain");
    assert.equal(l[C].balance, 0);
    assert.equal(l[C].giftOut, 2, "giftOut は台帳から出たぶんだけ（照合バッチが数え直せるように）");
    assert.equal(l[B].giftIn, 2);
    assert.equal(l[B].balance, 2, "台帳から出たぶんは相手の台帳へ");
    const rw = s.db._dump("emuer_v2_rewards");
    assert.equal(rw.r1.status, "spent", "古い報酬から使う");
    assert.equal(rw.r2.status, "spent");
    const mine = rewardsOf(s.db, C).filter(([, r]) => r.status === "pending");
    assert.equal(mine.length, 1);
    assert.equal(mine[0][1].kind, "gift-change");
    assert.equal(mine[0][1].amountWei, W(2), "5−3=2 のおつり");
    assert.equal(mine[0][0], ethers.utils.id(mine[0][1].key), "おつりも鎖で受け取れる claimId");
    const got = rewardsOf(s.db, B);
    assert.equal(got.length, 1);
    assert.equal(got[0][1].kind, "gift-received");
    assert.equal(got[0][1].amountWei, W(3), "報酬から出たぶんは、相手の受け取る前の報酬へ（公式ショップ・ウォレットで使える）");
    assert.equal(got[0][1].status, "pending");
    assert.equal((await s.call("GET", "/me", "carol")).body.balance, 2);
    assert.equal((await s.call("GET", "/me", "bob")).body.balance, 5);
    const again = await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 5, requestId: "mix-00001" });
    assert.equal(again.body.already, true);
    assert.equal(rewardsOf(s.db, B).length, 1, "押し直しで二重にならない");
  } finally { await s.close(); }
});

test("ひとつのアプリ内EMUER：鎖で受け取り済み・受け取りの署名を出したばかりの報酬は使わない。鎖に聞けなければ止める", async () => {
  const t = Date.UTC(2026, 10, 10, 3);
  const seedR = () => ({ ...seed(), emuer_offchain: {},
    emuer_v2_rewards: { r1: reward(C, 5, { claimId: "r1" }), r2: reward(C, 5, { claimId: "r2", authorizedUntilMs: t + 1000 }), r3: reward(C, 5, { claimId: "r3" }) } });
  let s = await serve(seedR(), { chain: paidChain({ r1: W(5) }) });
  try {
    assert.equal((await s.call("GET", "/me", "carol")).body.balance, 10, "署名を出したばかりの r2 は数えない");
    const ok = await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 5, requestId: "skip-0001" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const rw = s.db._dump("emuer_v2_rewards");
    assert.equal(rw.r1.status, "claimed", "鎖で受け取り済みは受け取り済みにする");
    assert.equal(rw.r2.status, "pending");
    assert.equal(rw.r3.status, "spent");
    const no = await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 5, requestId: "skip-0002" });
    assert.equal(no.body.error, "INSUFFICIENT_EMUER", "無から作らない");
  } finally { await s.close(); }
  s = await serve(seedR(), { chain: { claimPaid: async () => { throw new Error("rpc down"); } } });
  try {
    const down = await s.call("POST", "/cheer", "carol", { postId: "p1", amount: 5, requestId: "down-0001" });
    assert.equal(down.status, 503);
    assert.equal(down.body.error, "CHAIN_UNAVAILABLE");
    assert.equal(s.db._dump("emuer_v2_rewards").r1.status, "pending", "止めたときは何も動かさない");
  } finally { await s.close(); }
});

test("ひとつのアプリ内EMUER：協賛と投票も報酬から払える（相手のいない支払いは使って消える／袋に入る）", async () => {
  const s = await serve({ ...seed(), emuer_offchain: {},
    emuer_v2_rewards: { r1: reward(C, 10, { claimId: "r1" }) },
    emuer_v2_polls: { pl: { visible: true, status: "open", cost: 1, options: [{ id: "x", label: "X" }], tallies: {}, votes: 0 } } },
    { chain: paidChain() });
  try {
    const sp = await s.call("POST", "/sponsor", "carol", { questId: "q1", amount: 5, requestId: "spr-00001" });
    assert.equal(sp.status, 200, JSON.stringify(sp.body));
    assert.equal(sp.body.balance, 5);
    const v = await s.call("POST", "/polls/pl/vote", "carol", { option: "x" });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.balance, 4);
    assert.equal((await s.call("GET", "/me", "carol")).body.balance, 4);
    const pending = rewardsOf(s.db, C).filter(([, r]) => r.status === "pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0][1].amountWei, W(4));
    assert.equal((s.db._dump("emuer_offchain")[C] || {}).giftOut || 0, 0, "台帳には何も書かない");
  } finally { await s.close(); }
});
