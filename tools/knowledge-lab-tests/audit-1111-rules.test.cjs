"use strict";
/*
 * 11/11 の点検で見つかった穴を塞いだ Firestore ルールの見張り。
 *
 *   1. 受け皿：名前を挙げていないコレクションは、誰にも読めない・書けない
 *      （投稿の記録 emu_post_audit がログインなしで読めていた）
 *   2. 投稿：数の欄・題・本文に、数や文字でないものを入れて作れない
 *      （採用の数の欄に HTML を入れると、押した人の画面でスクリプトが動いた）
 *   3. 改善案：作るときに「採用済み・反映済み」を名乗れない。反映の記録は投稿した本人だけ
 *      （2つのアカウントで反映の報酬を何件でも作れた。正規の「反映を記録する」は逆に通らなかった）
 *   4. 「1人1回」の文書IDは小文字のアドレスだけ（書き方を変えて何票でも入れられた）
 *   5. 受けるときに周回の数を自分で入れられない（知恵カードを承認なしで何枚でも置けた）
 *   6. アプリ内EMUERの台帳は、本人が自分の分だけ読める（全員分を一覧できた）
 *   7. Camellia の前の Circle の置き場は、画面からは読めない・書けない
 *
 * 動かし方（Firestore エミュレーターを 127.0.0.1:8787 で）:
 *   firebase emulators:exec --config firebase.knowledge-lab.json --only firestore \
 *     "node --test tools/knowledge-lab-tests/audit-1111-rules.test.cjs"
 */
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("../quest-tests/node_modules/@firebase/rules-unit-testing");
const fb = require("../quest-tests/node_modules/firebase/firestore");

let env;
const AUTHOR = "0x" + "9".repeat(40);
const AUTHOR_CHES = "0x" + "8".repeat(40);          // 投稿した人の、アプリが作ったもう1つの名義
const MIXED = "0xAbCdEf" + "1".repeat(34);          // 大文字まじり（light の人のアドレスの別の書き方）
const users = {
  light: { addr: "0xabcdef" + "1".repeat(34), grant: "light" },
  other: { addr: "0x" + "3".repeat(40), grant: "light" },
  guest: { addr: "0x" + "4".repeat(40) },
  author: { addr: AUTHOR, ches: AUTHOR_CHES, grant: "light" },
};
let seq = 0;

before(async () => {
  const rules = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
  env = await initializeTestEnvironment({ projectId: "demo-emu-audit-1111", firestore: { host: "127.0.0.1", port: 8787, rules } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const [uid, u] of Object.entries(users)) {
      const acc = { walletAddress: u.addr, chesAddress: u.ches || u.addr };
      await fb.setDoc(fb.doc(db, "ches_verified_accounts", uid), acc);
      await fb.setDoc(fb.doc(db, "ches_accounts", uid), acc);
      if (u.grant) await fb.setDoc(fb.doc(db, "entitlements", uid), { plan: u.grant });
      await fb.setDoc(fb.doc(db, "emuer_offchain", u.addr), { address: u.addr, balance: 7, uid });
    }
    await fb.setDoc(fb.doc(db, "emu_post_audit", "p1"), { uid: "line:U123", userAgent: "x" });
    await fb.setDoc(fb.doc(db, "review_requests", "r1"), { uid: "light", comment: "運営のコメント" });
    await fb.setDoc(fb.doc(db, "camellia_users", "light"), { birthDate: "2000-01-01", agreedAt: "x", camelliaId: "CAM-AAAA-BBBB-CCCC" });
    await fb.setDoc(fb.doc(db, "camellia_community", "c1"), { uid: "other", text: "前の Circle の投稿", name: "n" });
    await fb.setDoc(fb.doc(db, "sp_votes", "v1"), { kind: "free", title: "t", options: ["a", "b"], createdBy: AUTHOR });
    await fb.setDoc(fb.doc(db, "sp_quests", "q1"), { title: "t", status: "OPEN", owner: AUTHOR });
    await fb.setDoc(fb.doc(db, "sp_guild_members", "learn"), {});
    await fb.setDoc(fb.doc(db, "sp_park", "k1"), { title: "t", by: AUTHOR, kind: "board" });
    await fb.setDoc(fb.doc(db, "sp_wisdom", "w1"), { author: AUTHOR, insight: "i", questId: "q1" });
  });
});
after(async () => { await env?.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function newPost(extra) {
  const id = "post-" + (++seq);
  await env.withSecurityRulesDisabled(async (c) => {
    await fb.setDoc(fb.doc(c.firestore(), "posts", id), Object.assign({
      address: AUTHOR, title: "t", body: "b", visibility: "public",
      goodCount: 0, changeCount: 0, goodUsers: [], changeUsers: [], acceptedChangeCount: 0, createdAt: new Date()
    }, extra || {}));
  });
  return id;
}
/* 画面（index.html の新規投稿）と同じ：投稿と、回数の記録を1つの一括書き込みで */
function publish(uid, extra, usage) {
  const db = as(uid), b = fb.writeBatch(db), me = users[uid].addr;
  const now = new Date(Date.now() + 9 * 3600000);
  const key = uid + "_r_m" + now.getUTCFullYear() + "-" + (now.getUTCMonth() + 1);
  b.set(fb.doc(fb.collection(db, "posts")), Object.assign({
    title: "題", body: "本文", tags: "a,b", userType: "free", address: me, displayName: "なまえ", userId: uid,
    updatedAt: new Date(), createdAt: new Date(), goodCount: 0, changeCount: 0
  }, extra || {}));
  b.set(fb.doc(db, "plan_usage", key), { post: usage || 1, updatedAt: new Date() }, { merge: true });
  return b.commit();
}
async function newChange(extra) {
  const id = "change-" + (++seq);
  await env.withSecurityRulesDisabled(async (c) => {
    await fb.setDoc(fb.doc(c.firestore(), "post_changes", id), Object.assign({
      postTitle: "t", postAuthor: AUTHOR, fromAddress: users.light.addr, proposal: "z", status: "pending", createdAt: new Date()
    }, extra));
  });
  return id;
}

test("受け皿：名前を挙げていないコレクションは、ログインしていても読めない・書けない", async () => {
  for (const db of [anon(), as("light")]) {
    await assertFails(fb.getDoc(fb.doc(db, "emu_post_audit", "p1")));
    await assertFails(fb.getDocs(fb.collection(db, "emu_post_audit")));
    await assertFails(fb.getDocs(fb.collection(db, "review_requests")));
    await assertFails(fb.setDoc(fb.doc(db, "review_requests", "r1"), { comment: "書き換え" }));
    await assertFails(fb.deleteDoc(fb.doc(db, "emu_post_audit", "p1")));
    await assertFails(fb.setDoc(fb.doc(db, "emu_client_errors", "x"), { a: 1 }));
    await assertFails(fb.setDoc(fb.doc(db, "sp_founder_history", "x"), { a: 1 }));
    await assertFails(fb.setDoc(fb.doc(db, "zz_new_collection_nobody_uses", "x"), { big: "x".repeat(1000) }));
    await assertFails(fb.getDocs(fb.collection(db, "camellia_activity")));
  }
});

test("混雑の表示（sp_active_users）は今までどおり：ログインなしでも自分の印を置けて、数を読める。時刻以外は置けない", async () => {
  const db = anon();
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_active_users", "client_k3j2h1g0f9"), { ts: Date.now() }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_active_users", "client_k3j2h1g0f9"), { ts: Date.now() + 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(as("light"), "sp_active_users", "wallet_" + users.light.addr), { ts: Date.now() }));
  await assertSucceeds(fb.getDocs(fb.query(fb.collection(db, "sp_active_users"), fb.where("ts", ">=", Date.now() - 600000), fb.limit(100))));
  await assertFails(fb.setDoc(fb.doc(db, "sp_active_users", "client_k3j2h1g0f9"), { ts: Date.now(), memo: "x".repeat(5000) }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_active_users", "なんでも"), { ts: Date.now() }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_active_users", "client_a"), { ts: "<img>" }));
  await assertFails(fb.deleteDoc(fb.doc(db, "sp_active_users", "client_k3j2h1g0f9")));
});

test("投稿：ふつうの投稿は今までどおり作れる。数の欄・題・本文に細工したものは作れない", async () => {
  await assertSucceeds(publish("light"));
  await assertSucceeds(publish("light", { imageUrl: "data:image/jpeg;base64,AAAA", acceptedChangeCount: 0 }, 2));
  const bad = [
    { acceptedChangeCount: "<img src=x onerror=alert(1)>" },
    { acceptedChangeCount: 5 },
    { reflectedChangeCount: "<b>" },
    { title: { a: 1 } },
    { body: 123 },
    { tags: ["a"] },
    { displayName: "x".repeat(81) },
    { body: "x".repeat(40001) },
  ];
  for (const extra of bad) await assertFails(publish("light", extra, 3));
});

test("投稿した本人は、題や本文を文字でないものには書き換えられない（文字なら今までどおり）", async () => {
  const id = await newPost();
  await assertSucceeds(fb.updateDoc(fb.doc(as("author"), "posts", id), { body: "直した本文", updatedAt: new Date() }));
  await assertFails(fb.updateDoc(fb.doc(as("author"), "posts", id), { title: { html: "<img>" } }));
  await assertFails(fb.updateDoc(fb.doc(as("author"), "posts", id), { acceptedChangeCount: "<img>" }));
});

test("改善案：作るときに「採用済み・反映済み」を名乗れない（ふつうの形は今までどおり）", async () => {
  const postId = await newPost();
  const base = { postId, postTitle: "t", postAuthor: AUTHOR, fromAddress: users.guest.addr, proposal: "z", createdAt: new Date() };
  const db = as("guest");
  await assertSucceeds(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "pending" }));
  await assertFails(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "accepted", reflectedBy: AUTHOR, reflectedAt: new Date() }));
  await assertFails(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "accepted" }));
  await assertFails(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "pending", reflectedAt: new Date() }));
  await assertFails(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "pending", reflectedBy: AUTHOR }));
  await assertFails(fb.addDoc(fb.collection(db, "post_changes"), { ...base, status: "pending", acceptedBy: AUTHOR }));
});

test("改善案：投稿した本人は、採用して、反映を1回だけ記録できる（画面の「反映を記録する」と同じ書き込み）", async () => {
  const postId = await newPost();
  const id = await newChange({ postId });
  const db = as("author");
  // 採用の前には反映を記録できない
  await assertFails(fb.updateDoc(fb.doc(db, "post_changes", id), { reflectedAt: new Date(), reflectedBy: AUTHOR, reflectionNote: "n" }));
  // 採用（画面と同じ一括書き込み）
  const b = fb.writeBatch(db);
  b.update(fb.doc(db, "post_changes", id), { status: "accepted", acceptedAt: new Date(), acceptedBy: AUTHOR });
  b.update(fb.doc(db, "posts", postId), { acceptedChangeCount: fb.increment(1), lastChangedAt: new Date() });
  await assertSucceeds(b.commit());
  // ほかの人は反映を記録できない・他人の名義では記録できない
  await assertFails(fb.updateDoc(fb.doc(as("light"), "post_changes", id), { reflectedAt: new Date(), reflectedBy: users.light.addr, reflectionNote: "" }));
  await assertFails(fb.updateDoc(fb.doc(db, "post_changes", id), { reflectedAt: new Date(), reflectedBy: users.light.addr, reflectionNote: "" }));
  await assertFails(fb.updateDoc(fb.doc(db, "post_changes", id), { reflectedAt: new Date(), reflectedBy: AUTHOR, reflectionNote: "x".repeat(1001) }));
  // 本人の反映（画面の順：改善案 → 投稿の数）
  await assertSucceeds(fb.updateDoc(fb.doc(db, "post_changes", id), { reflectedAt: new Date(), reflectedBy: AUTHOR, reflectionNote: "こう直した" }));
  await assertSucceeds(fb.updateDoc(fb.doc(db, "posts", postId), { reflectedChangeCount: fb.increment(1), lastChangedAt: new Date() }));
  // 2回目は記録できない・数を2つ増やすこともできない・ほかの人は数を増やせない
  await assertFails(fb.updateDoc(fb.doc(db, "post_changes", id), { reflectedAt: new Date(), reflectedBy: AUTHOR, reflectionNote: "もう一度" }));
  await assertFails(fb.updateDoc(fb.doc(db, "posts", postId), { reflectedChangeCount: fb.increment(2), lastChangedAt: new Date() }));
  await assertFails(fb.updateDoc(fb.doc(as("light"), "posts", postId), { reflectedChangeCount: fb.increment(1), lastChangedAt: new Date() }));
});

test("改善案：アプリが作った名義で書いた投稿でも、本人が採用できる（前はできなかった）", async () => {
  const postId = await newPost({ address: AUTHOR_CHES });
  const id = await newChange({ postId, postAuthor: AUTHOR_CHES });
  await assertFails(fb.updateDoc(fb.doc(as("other"), "post_changes", id), { status: "accepted", acceptedAt: new Date(), acceptedBy: users.other.addr }));
  await assertSucceeds(fb.updateDoc(fb.doc(as("author"), "post_changes", id), { status: "accepted", acceptedAt: new Date(), acceptedBy: AUTHOR }));
});

test("1人1回：文書のIDは小文字のアドレスだけ。大文字まじりに変えて2つ目は作れない", async () => {
  const db = as("light"), me = users.light.addr;
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_votes", "v1", "ballots", me), { optionId: "a", castAt: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_votes", "v1", "ballots", MIXED), { optionId: "a", castAt: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_guild_members", "learn", "joins", me), { name: "n", at: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_guild_members", "learn", "joins", MIXED), { name: "n", at: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_guild_members", "learn", "supports", me), { name: "n", at: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_guild_members", "learn", "supports", MIXED), { name: "n", at: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_park", "k1", "joins", me), { at: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_park", "k1", "joins", MIXED), { at: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_wisdom", "w1", "cites", me), { at: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_wisdom", "w1", "cites", MIXED), { at: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", me), { name: "n", tookAt: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", MIXED), { name: "n", tookAt: 1 }));
});

test("クエストを受けるとき、周回の数（approvedRounds）を自分で入れられない", async () => {
  const db = as("other"), me = users.other.addr;
  await assertFails(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", me), { name: "n", approvedRounds: 99 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", me), { name: "n", lastApprovedAt: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", me), { name: "n", approved: true }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "sp_quests", "q1", "commits", me), { name: "n", tookAt: 1 }));
});

test("アプリ内EMUERの台帳：本人は自分の分を読める。ほかの人の分・一覧・ログインなしは読めない", async () => {
  const me = users.light.addr;
  await assertSucceeds(fb.getDoc(fb.doc(as("light"), "emuer_offchain", me)));
  // まだ台帳が無い人が自分の分を見に行っても、断られずに「無い」と返る
  await assertSucceeds(fb.getDoc(fb.doc(as("author"), "emuer_offchain", AUTHOR_CHES)));
  await assertFails(fb.getDoc(fb.doc(as("light"), "emuer_offchain", users.other.addr)));
  await assertFails(fb.getDocs(fb.collection(as("light"), "emuer_offchain")));
  await assertFails(fb.getDoc(fb.doc(anon(), "emuer_offchain", me)));
  await assertFails(fb.getDocs(fb.collection(anon(), "emuer_offchain")));
  await assertFails(fb.setDoc(fb.doc(as("light"), "emuer_offchain", me), { balance: 999 }));
});

test("Camellia の前の Circle の置き場：自分で会員の文書を作っても、読めない・書けない。本人の記録は今までどおり", async () => {
  const db = as("guest");
  await assertSucceeds(fb.setDoc(fb.doc(db, "camellia_users", "guest"), { birthDate: "2000-01-01", agreedAt: "x", camelliaId: "" }));
  await assertSucceeds(fb.setDoc(fb.doc(db, "camellia_users", "guest", "daily", "2026-11-11"), { mood: 3 }));
  await assertSucceeds(fb.getDoc(fb.doc(db, "camellia_users", "guest")));
  await assertFails(fb.getDocs(fb.collection(db, "camellia_community")));
  await assertFails(fb.getDoc(fb.doc(db, "camellia_community", "c1")));
  await assertFails(fb.addDoc(fb.collection(db, "camellia_community"), { uid: "guest", text: "書き込み", name: "n" }));
  await assertFails(fb.addDoc(fb.collection(db, "camellia_reports"), { by: "guest", postId: "c1", reason: "r" }));
  await assertFails(fb.getDoc(fb.doc(as("light"), "camellia_users", "guest")));
});
