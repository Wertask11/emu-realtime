"use strict";
/* 今月の学びの軌跡（GET /api/billing/journey）は、アカウントの2つの名義（ウォレット・CHES）を
   両方とも「自分」として数える（10/29）。片方だけだと、もう片方で書いた投稿・押した Good・
   答えた募集が数に入らない。自分の別の名義で押した Good は「役に立った人」に数えない。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createBillingRouter } = require("./billing");

const W = "0x" + "a".repeat(40), C = "0x" + "c".repeat(40), X = "0x" + "1".repeat(40), Y = "0x" + "2".repeat(40);
// 試験用の Firestore は Date を文字列にしてしまうので、日時は数で持つ（本物は Timestamp）
const at = s => Date.parse(s);

test("学びの軌跡は、ウォレットと CHES の両方の名義で数える", async () => {
  const db = makeFirestore({
    posts: {
      p1: { address: W, createdAt: at("2026-10-10T00:00:00Z"), goodCount: 2, goodUsers: [X, C] },
      p2: { address: C, createdAt: at("2026-10-20T00:00:00Z"), goodCount: 1, goodUsers: [Y] },
      p3: { address: W, createdAt: at("2026-09-20T00:00:00Z"), goodCount: 5, goodUsers: [X] },
      p4: { address: X, createdAt: at("2026-10-05T00:00:00Z"), goodUsers: [W] },
      p5: { address: Y, createdAt: at("2026-10-06T00:00:00Z"), goodUsers: [C] }
    },
    knowledge_answers: { a1: { answerAuthor: C, createdAt: at("2026-10-15T00:00:00Z") } }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/billing", createBillingRouter({
    db, rateLimit: () => (q, s, n) => n(), requireOwner: (q, s, n) => n(),
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u1", walletAddress: W, account: { walletAddress: W, chesAddress: C } }; next(); },
    entitlement: {
      getEntitlement: async () => ({ plan: "plus" }), enforcing: () => true, atLeast: () => true,
      usageWindow: async () => ({ start: new Date("2026-09-30T15:00:00Z"), end: new Date("2026-10-31T14:59:59Z") })
    }
  }).router);
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/api/billing/journey").then(x => x.json());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual({ posted: r.counts.posted, deliveredTo: r.counts.deliveredTo, answered: r.counts.answered, receivedTotal: r.counts.receivedTotal },
      { posted: 2, deliveredTo: 2, answered: 1, receivedTotal: 2 });
    assert.equal(r.sentence, "今月あなたは、2つの知識を届け、2人の役に立ち、1件の募集に答えました。\nこれまでに受け取った学びは 2 件です。");
  } finally { server.close(); }
});
