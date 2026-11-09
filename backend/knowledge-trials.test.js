"use strict";
/* 返り道（11/9）：投稿ごとの「やってみた人・知恵カード・クエスト」の数。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createKnowledgeTrialsRouter } = require("./knowledge-trials");

async function seed() {
  const db = makeFirestore();
  await db.collection("sp_quests").doc("q1").set({ series: "general", questNumber: 1 });
  await db.collection("sp_quests").doc("q9").set({ series: "general", questNumber: 9, fromPostId: "postB" });
  await db.collection("sp_quests").doc("founder-quest-000").set({ fromPostId: "postZ" });
  const logs = db.collection("sp_quests").doc("q1").collection("logs");
  await logs.doc("l1").set({ author: "0xAAA", kind: "やってみた", fromPostId: "postA", images: ["data:image/jpeg;base64,AA"] });
  await logs.doc("l2").set({ author: "0xaaa", kind: "やってみた", fromPostId: "postA" });   // 同じ人の2回目
  await logs.doc("l3").set({ author: "0xbbb", kind: "やってみた", fromPostId: "postA" });
  await logs.doc("l4").set({ author: "0xccc", kind: "気づいた", fromPostId: "postA" });       // やってみた以外は数えない
  await logs.doc("l5").set({ author: "0xddd", kind: "やってみた", fromPostId: "../bad" });    // 形の悪い番号は捨てる
  await db.collection("sp_wisdom").doc("w1").set({ fromPostId: "postA", author: "0xaaa" });
  await db.collection("sp_wisdom").doc("w2").set({ fromPostId: "", author: "0xbbb" });
  return db;
}

test("投稿ごとに、やってみた人（重複なし）・知恵カード・クエストを数える。名前や本文は返さない", async () => {
  const db = await seed();
  const { read } = createKnowledgeTrialsRouter({ db });
  const { posts } = await read();
  assert.deepEqual(posts, {
    postA: { tried: 2, wisdom: 1, quests: 0 },
    postB: { tried: 0, wisdom: 0, quests: 1 }
  });
  assert.ok(!("postZ" in posts), "#000 は数えない");
  assert.ok(!JSON.stringify(posts).includes("0x"), "誰がやったかは返さない");
});

test("1時間は数え直さず、失敗したら前の結果を返す", async () => {
  const db = await seed();
  let t = 0;
  const api = createKnowledgeTrialsRouter({ db, now: () => t });
  await api.read();
  await db.collection("sp_wisdom").doc("w3").set({ fromPostId: "postA" });
  t = 30 * 60 * 1000;
  assert.equal((await api.read()).posts.postA.wisdom, 1, "1時間以内は覚えた結果");
  t = 61 * 60 * 1000;
  assert.equal((await api.read()).posts.postA.wisdom, 2, "1時間を過ぎたら数え直す");
  const original = db.collection.bind(db);
  db.collection = () => { throw Object.assign(new Error("8 RESOURCE_EXHAUSTED"), { code: 8 }); };
  t = 200 * 60 * 1000;
  const stale = await api.read();
  assert.equal(stale.stale, true);
  assert.equal(stale.posts.postA.wisdom, 2);
  db.collection = original;
});

test("GET は数だけを返す", async () => {
  const db = await seed();
  const app = express();
  app.use("/api/emu/knowledge-trials", createKnowledgeTrialsRouter({ db }).router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/api/emu/knowledge-trials");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.posts.postA, { tried: 2, wisdom: 1, quests: 0 });
  } finally { await new Promise((r) => server.close(r)); }
});
