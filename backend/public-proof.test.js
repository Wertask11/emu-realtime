"use strict";
/* 完走証明ページ（11/9）：本人が選んだ完走だけを公開し、ウォレットや ID は出さない。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createPublicProofRouter } = require("./public-proof");

const KEY_A = "0x" + "a".repeat(64);
const KEY_B = "0x" + "b".repeat(64);
const KEY_OTHER = "0x" + "c".repeat(64);

async function setup() {
  const db = makeFirestore();
  await db.collection("sp_quest_certificates").doc(KEY_A).set({
    questId: "q1", spid: "SP-ME", address: "0x1111111111111111111111111111111111111111",
    questLabel: "一般 #001", questTitle: "Emuの知識を、やってみる", guildId: "learn", guildColor: "#2E7D5B",
    round: 1, completedAt: 1762000000000, status: "minted", tokenId: "7", mintedTo: "0x2222222222222222222222222222222222222222" });
  await db.collection("sp_quest_certificates").doc(KEY_B).set({
    questId: "q1", spid: "SP-ME", round: 2, completedAt: 1762500000000, status: "pending", questTitle: "Emuの知識を、やってみる" });
  await db.collection("sp_quest_certificates").doc(KEY_OTHER).set({ questId: "q1", spid: "SP-OTHER", round: 1 });
  await db.collection("sp_wisdom").doc("w1").set({ questId: "q1", spid: "SP-ME", createdAt: 1, knowledge: "朝の音読", experiment: "14日間、毎朝5分", insight: "声を出すと、緊張が先に抜ける", fromPostTitle: "朝5分の音読" });
  await db.collection("sp_wisdom").doc("w2").set({ questId: "q1", spid: "SP-ME", createdAt: 2, insight: "2周目の一文" });
  await db.collection("sp_wisdom").doc("w3").set({ questId: "q1", spid: "SP-OTHER", createdAt: 0, insight: "他人の一文" });
  let who = "SP-ME";
  const requireFirebaseUser = (req, _res, next) => { req.identity = { account: { spid: who } }; next(); };
  const app = express();
  app.use("/api/schoolpark/proofs", createPublicProofRouter({ db, requireFirebaseUser, contract: "0x3333333333333333333333333333333333333333" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/schoolpark/proofs";
  const call = async (path, body) => {
    const r = await fetch(base + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: r.status, body: await r.json() };
  };
  return { db, call, as: (s) => { who = s; }, close: () => new Promise((r) => server.close(r)) };
}

test("公開した1周だけが見られ、ウォレット・ID・ほかの完走は出ない", async () => {
  const t = await setup();
  try {
    const mine = await t.call("/mine");
    assert.equal(mine.body.proofs.length, 2, "自分の完走だけ");
    assert.ok(mine.body.proofs.every((p) => !p.token), "最初は何も公開していない");

    const pub = await t.call("/" + KEY_A + "/publish", { showName: true, name: "つばき<script>", withWisdom: true });
    assert.equal(pub.status, 200);
    const view = await t.call("/view/" + pub.body.token);
    assert.equal(view.status, 200);
    const p = view.body.proof;
    assert.equal(p.questTitle, "Emuの知識を、やってみる");
    assert.equal(p.round, 1);
    assert.equal(p.name, "つばきscript", "名前の記号は落とす");
    assert.equal(p.wisdom.insight, "声を出すと、緊張が先に抜ける", "1周目の知恵カード");
    assert.deepEqual(p.nft, { tokenId: "7", contract: "0x3333333333333333333333333333333333333333" });
    const raw = JSON.stringify(view.body);
    assert.ok(!raw.includes("0x1111") && !raw.includes("0x2222") && !raw.includes("SP-ME"), "アドレスと ID は出さない");

    const pub2 = await t.call("/" + KEY_B + "/publish", { showName: false, withWisdom: true });
    const p2 = (await t.call("/view/" + pub2.body.token)).body.proof;
    assert.equal(p2.name, "", "名前を出さない選択");
    assert.equal(p2.wisdom.insight, "2周目の一文", "2周目は2枚目の知恵カード");
    assert.notEqual(pub2.body.token, pub.body.token);

    const again = await t.call("/" + KEY_A + "/publish", { showName: false, withWisdom: false });
    assert.equal(again.body.token, pub.body.token, "選び直しても同じURL");
    const p3 = (await t.call("/view/" + pub.body.token)).body.proof;
    assert.equal(p3.name, "");
    assert.equal(p3.wisdom, null);

    assert.equal((await t.call("/" + KEY_A + "/unpublish", {})).status, 200);
    assert.equal((await t.call("/view/" + pub.body.token)).status, 404, "やめたらすぐ見られない");
    assert.ok(await t.db.collection("sp_quest_certificates").doc(KEY_A).get().then((s) => s.exists), "記録そのものは残る");
  } finally { await t.close(); }
});

test("他人の完走は公開できない・形の悪いURLは見つからない", async () => {
  const t = await setup();
  try {
    assert.equal((await t.call("/" + KEY_OTHER + "/publish", { withWisdom: true })).status, 404);
    assert.equal((await t.call("/not-a-key/publish", {})).status, 400);
    assert.equal((await t.call("/view/short")).status, 404);
    assert.equal((await t.call("/view/" + "x".repeat(22))).status, 404);
    t.as("");
    assert.equal((await t.call("/" + KEY_A + "/publish", {})).status, 409, "パスポート未連携");
  } finally { await t.close(); }
});
