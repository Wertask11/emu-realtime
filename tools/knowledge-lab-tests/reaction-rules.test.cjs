"use strict";
/*
 * 「役に立った」（Good）と改善案（Change）の Firestore ルール。
 *
 * 2026-10-24、light・公式パスの全員が改善案を送れなかった。
 * posts の update で、Good の分かれ道でも段（canWriteAs）を先に数えていたため、
 * Change を送ると段を2回数え、1回の書き込みで評価できる式の上限（1000）を超えていた。
 * どの欄を変えるか（changedOnly）を先に見る並びに直した。その回帰を見張る。
 *
 * 動かし方（Firestore エミュレーターを 127.0.0.1:8787 で）:
 *   firebase emulators:exec --config firebase.knowledge-lab.json --only firestore \
 *     "node --test tools/knowledge-lab-tests/reaction-rules.test.cjs"
 */
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("../quest-tests/node_modules/@firebase/rules-unit-testing");
const fb = require("../quest-tests/node_modules/firebase/firestore");

let env;
const AUTHOR = "0x" + "9".repeat(40);
const users = {
  light: { addr: "0x" + "1".repeat(40), grant: "light" },
  lightSpid: { addr: "0x" + "2".repeat(40), grant: "light", spid: "SP-RXN0-RXN0-RXN0-RXN1" },
  pass: { addr: "0x" + "3".repeat(40), pass: true },
  guest: { addr: "0x" + "4".repeat(40) },
  author: { addr: AUTHOR, grant: "light" },
};
let seq = 0;

before(async () => {
  const rules = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
  env = await initializeTestEnvironment({ projectId: "demo-emu-reaction-rules", firestore: { host: "127.0.0.1", port: 8787, rules } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const [uid, u] of Object.entries(users)) {
      const acc = Object.assign({ walletAddress: u.addr, chesAddress: u.addr }, u.spid ? { spid: u.spid } : {});
      await fb.setDoc(fb.doc(db, "ches_verified_accounts", uid), acc);
      await fb.setDoc(fb.doc(db, "ches_accounts", uid), acc);
      if (u.grant) await fb.setDoc(fb.doc(db, "entitlements", uid), { plan: u.grant });
      if (u.pass) await fb.setDoc(fb.doc(db, "paid_users", u.addr), { paid: true });
      if (u.spid) await fb.setDoc(fb.doc(db, "sp_identities", u.spid), { membershipSources: { grantUid: uid, subscriptionUid: uid } });
    }
  });
});
after(async () => { await env?.cleanup(); });

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
/* 画面（index.html の writeChange）と同じ一括書き込み */
function sendChange(uid, postId, opt) {
  const o = opt || {};
  const db = env.authenticatedContext(uid).firestore(), b = fb.writeBatch(db), me = o.as || users[uid].addr;
  b.set(fb.doc(fb.collection(db, "post_changes")), {
    postId, postTitle: "t", postAuthor: AUTHOR, fromAddress: me, target: "x", reason: "y",
    proposal: "z", suggestion: "z", status: "pending", createdAt: new Date()
  });
  b.update(fb.doc(db, "posts", postId), { changeCount: fb.increment(o.by || 1), changeUsers: fb.arrayUnion(me) });
  return b.commit();
}
function sendGood(uid, postId) {
  const db = env.authenticatedContext(uid).firestore();
  return fb.updateDoc(fb.doc(db, "posts", postId), { goodCount: fb.increment(1), goodUsers: fb.arrayUnion(users[uid].addr) });
}

for (const uid of ["light", "lightSpid", "pass"]) {
  test(uid + " は改善案と「役に立った」を送れる", async () => {
    await assertSucceeds(sendChange(uid, await newPost()));
    await assertSucceeds(sendGood(uid, await newPost()));
  });
}

test("見学（無料）は改善案も「役に立った」も送れない", async () => {
  await assertFails(sendChange("guest", await newPost()));
  await assertFails(sendGood("guest", await newPost()));
});

test("改善案は1人1回まで。2回目は断る", async () => {
  const id = await newPost();
  await assertSucceeds(sendChange("light", id));
  await assertFails(sendChange("light", id));
});

test("自分の投稿・他人の名義・件数の水増しは断る", async () => {
  await assertFails(sendChange("author", await newPost()));
  await assertFails(sendChange("light", await newPost(), { as: users.pass.addr }));
  await assertFails(sendChange("light", await newPost(), { by: 2 }));
});

test("公開でない投稿には送れない", async () => {
  await assertFails(sendChange("light", await newPost({ visibility: "private" })));
});

test("投稿者本人の本文の編集と、改善案の反映は今までどおりできる", async () => {
  const id = await newPost();
  const db = env.authenticatedContext("author").firestore();
  await assertSucceeds(fb.updateDoc(fb.doc(db, "posts", id), { body: "直した本文", updatedAt: new Date() }));
  await assertSucceeds(fb.updateDoc(fb.doc(db, "posts", id), { acceptedChangeCount: 1, lastChangedAt: new Date() }));
  await assertFails(fb.updateDoc(fb.doc(env.authenticatedContext("light").firestore(), "posts", id), { body: "他人が書き換え" }));
});
