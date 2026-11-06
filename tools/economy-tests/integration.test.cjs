"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
let f;
before(async () => {
  f = await createFixture();
});
after(async () => {
  await f?.close();
});
async function quote(role = "alice", goal = "コーヒーを学びたい") {
  const r = await f.call(role, "POST", "/quotes", { goal });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.quote;
}
async function submit(role, q, key) {
  return f.call(role, "POST", "/jobs", {
    quoteId: q.id,
    termsVersion: q.termsVersion,
    requestId: key,
    paymentConsent: true,
    aiConsent: true,
  });
}
test("実Firebase Auth検証＋既存Passport連携、認証なし/偽Bearerを拒否", async () => {
  assert.equal((await f.call(null, "GET", "/me")).status, 401);
  const r = await fetch(f.base + "/api/economy/me", {
    headers: { Authorization: "Bearer fabricated" },
  });
  assert.equal(r.status, 401);
  const me = await f.call("alice", "GET", "/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.balances.wallet, "17");
  assert.equal(me.headers.get("cache-control"), "private, no-store");
});
test("実Firestoreの公開知識・Text・Quest・Cityを探索、余分な人物属性を送信対象に含めない", async () => {
  const auth = {
    uid: f.users.alice.uid,
    account: f.users.alice.account,
    walletAddress: f.users.alice.account.walletAddress,
  };
  const a = await f.economy.service.actor(auth),
    c = await f.economy.service.sources.candidates(a, "コーヒーを学びたい");
  assert.deepEqual(
    new Set(c.map((s) => s.kind)),
    new Set([
      "knowledge",
      "knowledge_lab",
      "knowledge_text",
      "quest",
      "city_product",
    ]),
  );
  assert.ok(
    c.every(
      (s) =>
        !Object.keys(s).some((k) =>
          /uid|wallet|author|member|email|passport/i.test(k),
        ),
    ),
  );
  assert.ok(c.every((s) => s.id !== "economy-private"));
  const guild = await f.economy.service.sources.candidates(a, "知識を学ぶ");
  assert.ok(
    guild.some((s) => s.kind === "guild" && s.target.endsWith("=learn")),
  );
});
test("native transactionの競合時も一注文・一請求、workerで実データIDへ結果保存", async () => {
  const q = await quote(),
    key = "native-idempotent-key-" + Date.now();
  const jobs = await Promise.all(
    Array.from({ length: 4 }, () => submit("alice", q, key)),
  );
  assert.ok(
    jobs.every((r) => r.status === 200),
    JSON.stringify(jobs),
  );
  const id = jobs[0].body.job.id;
  assert.equal(new Set(jobs.map((r) => r.body.job.id)).size, 1);
  await f.economy.tick();
  const got = await f.call("alice", "GET", "/jobs/" + id);
  assert.equal(got.body.job.state, "completed");
  assert.ok(got.body.job.result.results.length > 0);
  const orders = await f.db
    .collection("mitemiru_orders")
    .where("serviceJobId", "==", id)
    .get();
  assert.equal(orders.size, 1);
  assert.equal(orders.docs[0].data().amount, 5);
  const usage = await f.db.collection("emuer_v2_access_usage").get();
  assert.equal(usage.size, 0);
  assert.equal((await f.call("bob", "GET", "/jobs/" + id)).status, 404);
  assert.deepEqual((await f.call("bob", "GET", "/jobs")).body.jobs, []);
});
test("公開撤回・資料編集で既存結果からも削除し、再承認なしに外部へ送らない", async () => {
  const alice = await f.economy.service.actor({
    uid: f.users.alice.uid,
    account: f.users.alice.account,
  });
  await f.db
    .collection("posts")
    .doc("economy-coffee-public")
    .set({ visibility: "private" }, { merge: true });
  await f.db
    .collection("room1_contents")
    .doc("economy-text")
    .set({ summary: "変更後は再承認が必要" }, { merge: true });
  const c = await f.economy.service.sources.candidates(alice, "コーヒーを学ぶ");
  assert.ok(
    !c.some((s) => ["economy-coffee-public", "economy-text"].includes(s.id)),
  );
  const jobs = (await f.call("alice", "GET", "/jobs")).body.jobs;
  assert.ok(
    jobs.every((j) =>
      (j.result?.results || []).every(
        (r) => !["economy-coffee-public", "economy-text"].includes(r.id),
      ),
    ),
  );
});
test("実FirestoreでAI失敗→返却待ち→再起動照合で元台帳へ全額返却", async () => {
  const original = f.economy.service.payments.refund;
  f.economy.service.payments.refund = async () => {
    throw Error("isolated refund failure");
  };
  // Force a current source dependency failure after payment. Nothing is generated from stale data.
  const read = f.economy.service.sources.candidates;
  f.economy.service.sources.candidates = async () => {
    throw Error("source offline");
  };
  const q = await quote("bob"),
    r = await submit("bob", q, "native-refund-key-" + Date.now());
  assert.equal(r.status, 200);
  await f.economy.tick();
  assert.equal(
    (await f.call("bob", "GET", "/jobs/" + r.body.job.id)).body.job.state,
    "refund_pending",
  );
  f.economy.service.payments.refund = original;
  f.economy.service.sources.candidates = read;
  await f.economy.tick();
  const done = (await f.call("bob", "GET", "/jobs/" + r.body.job.id)).body.job;
  assert.equal(done.state, "refunded");
  assert.equal(done.payment.refunded, true);
  const reward = await f.db
    .collection("emuer_v2_rewards")
    .where("orderId", "==", "agent_" + r.body.job.id)
    .where("kind", "==", "mitemiru-refund")
    .get();
  assert.equal(reward.size, 1);
  assert.equal(reward.docs[0].data().amountWei, "5000000000000000000");
});
test("30日後は目的・結果のみ削除し、決済・返却監査は保持する", async () => {
  const jobs = await f.db
    .collection("emuer_v2_agent_jobs")
    .where("state", "==", "completed")
    .get();
  assert.ok(jobs.size > 0);
  const j = jobs.docs[0],
    orderId = j.data().orderId;
  await j.ref.set({ deleteAfter: new Date(0) }, { merge: true });
  await f.economy.service.purge();
  const after = (await j.ref.get()).data();
  assert.equal(after.goal, null);
  assert.equal(after.result, null);
  assert.equal(after.state, "completed");
  assert.ok(
    (await f.db.collection("mitemiru_orders").doc(orderId).get()).exists,
  );
  assert.ok(after.events.length >= 4);
});
test("Cityの汎用購入APIからAI商品を直接支払う迂回を拒否する", async () => {
  const before = (await f.db.collection("mitemiru_orders").get()).size;
  const r = await fetch(f.base + "/api/mitemiru/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer " + f.users.alice.token,
    },
    body: JSON.stringify({
      productId: "agent_schoolpark-explorer-v1",
      method: "emuer_ledger",
      amount: 1,
      requestId: "bypass-service-order-0001",
    }),
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "SERVICE_CHECKOUT_REQUIRED");
  assert.equal((await f.db.collection("mitemiru_orders").get()).size, before);
});
