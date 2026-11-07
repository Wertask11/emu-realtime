"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fixture, SPID } = require("./fixture");
const { hash, SERVICE } = require("./config");
async function ready(options) {
  const f = fixture(options);
  await f.seed();
  f.a = await f.actor();
  return f;
}
async function request(f, key = "test-request-key-0001", extra = {}) {
  const q = await f.economy.service.quote(f.a, { goal: "コーヒーを学びたい" });
  return {
    requestId: key,
    quoteId: q.id,
    termsVersion: q.termsVersion,
    paymentConsent: true,
    aiConsent: true,
    ...extra,
  };
}
async function submit(f, key) {
  return f.economy.service.submit(f.a, await request(f, key));
}
function rewards(f) {
  return (
    Object.values(f.db._dump("emuer_v2_rewards"))
      .filter((r) => r.status === "pending")
      .reduce((n, r) => n + BigInt(r.amountWei), 0n) /
    10n ** 18n
  );
}
test("5 EMUER・台帳支払いとqueuedが不可分、完了・履歴・商品枠は独立", async () => {
  const f = await ready(),
    j = await submit(f);
  assert.equal(j.state, "queued");
  assert.equal(rewards(f), 95n);
  assert.equal(j.payment.amount, 5);
  assert.equal(f.calls(), 0);
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.equal(done.result.results[0].id, "coffee");
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.db._dump("emuer_v2_access_usage"), {});
  assert.equal((await f.economy.service.history(f.a)).length, 1);
});
test("同じ依頼の並行再送と再起動で二重請求・AI再実行なし", async () => {
  const f = await ready(),
    b = await request(f);
  const jobs = await Promise.all(
    Array.from({ length: 5 }, () => f.economy.service.submit(f.a, b)),
  );
  assert.equal(new Set(jobs.map((j) => j.id)).size, 1);
  assert.equal(rewards(f), 95n);
  await Promise.all([f.economy.tick(), f.economy.tick()]);
  assert.equal(f.calls(), 1);
  await f.economy.tick();
  assert.equal(f.calls(), 1);
  assert.equal((await f.economy.service.submit(f.a, b)).state, "completed");
});
test("同じキーで違うquote・内容は409、同じquoteの別キー消費も拒否", async () => {
  const f = await ready(),
    b = await request(f);
  await f.economy.service.submit(f.a, b);
  await assert.rejects(
    f.economy.service.submit(f.a, await request(f)),
    /IDEMPOTENCY_KEY_CONFLICT/,
  );
  await assert.rejects(
    f.economy.service.submit(f.a, {
      ...b,
      requestId: "second-request-key-001",
    }),
    /QUOTE_EXPIRED_OR_CHANGED/,
  );
  assert.equal(rewards(f), 95n);
});
test("明示的な決済同意・AI同意・条件バージョンのない依頼を拒否", async () => {
  const f = await ready(),
    b = await request(f);
  for (const patch of [
    { aiConsent: false },
    { paymentConsent: false },
    { termsVersion: "old" },
  ])
    await assert.rejects(
      f.economy.service.submit(f.a, { ...b, ...patch }),
      /CONSENT_REQUIRED|QUOTE_EXPIRED_OR_CHANGED/,
    );
  assert.equal(rewards(f), 100n);
});
test("残高不足は課金なし・RPC不通は決済待ち、期限後復旧で無断課金しない", async () => {
  const f = await ready({ balance: 4 }),
    j = await submit(f);
  assert.equal(j.state, "failed");
  assert.equal(rewards(f), 4n);
  const down = await ready({ rpcDown: true }),
    pending = await submit(down);
  assert.equal(pending.state, "awaiting_payment");
  down.advance(11 * 60000);
  await down.economy.tick();
  assert.equal(
    (await down.economy.service.view(down.a, pending.id)).state,
    "expired",
  );
  assert.equal(rewards(down), 100n);
  assert.equal(down.calls(), 0);
});
test("AI失敗は既存Mitemiruで全額返却、二度返却しない", async () => {
  const f = await ready({ providerDown: true }),
    j = await submit(f);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(rewards(f), 100n);
  await f.economy.tick();
  assert.equal(rewards(f), 100n);
  assert.equal(f.calls(), 1);
});
test("返却失敗は返却待ち、worker再作成後に同じ注文を照合して回復", async () => {
  const f = await ready({ providerDown: true }),
    real = f.commerce.servicePayments.refund;
  f.commerce.servicePayments.refund = async () => {
    throw Error("offline");
  };
  const j = await submit(f);
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "refund_pending",
  );
  const restarted = fixture({ db: f.db, providerDown: true });
  f.commerce.servicePayments.refund = real;
  await restarted.economy.tick();
  assert.equal(
    (await restarted.economy.service.view(f.a, j.id)).state,
    "refunded",
  );
  assert.equal(rewards(f), 100n);
});
test("running中断は再生成せず返却、保存済み結果は再生成せず引渡しのみ復旧", async () => {
  const f = await ready(),
    j = await submit(f);
  await f.economy.service
    .ref("jobs", j.id)
    .set(
      { state: "running", leaseToken: "dead", leaseUntilMs: f.now() - 1 },
      { merge: true },
    );
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(f.calls(), 0);
  const f2 = await ready(),
    j2 = await submit(f2);
  await f2.economy.service
    .ref("jobs", j2.id)
    .set({ state: "result_saved", result: { results: [] } }, { merge: true });
  await f2.economy.tick();
  assert.equal((await f2.economy.service.view(f2.a, j2.id)).state, "completed");
  assert.equal(f2.calls(), 0);
});
test("存在する資料がない場合は架空の候補も外部AI呼出しもない", async () => {
  const f = await ready({ empty: true }),
    j = await submit(f);
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.equal(done.result.outcome, "no_data");
  assert.deepEqual(done.result.results, []);
  assert.equal(f.calls(), 0);
});
test("モデルが架空ID/URL/根拠を返したら結果不採用・返却", async () => {
  for (const invalidOutput of [
    { matches: [{ key: "quest:fake", evidence: "summary" }] },
    {
      matches: [
        { key: "knowledge:coffee", evidence: "summary", url: "https://evil" },
      ],
    },
  ]) {
    const f = await ready({ invalidOutput }),
      j = await submit(f);
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(rewards(f), 100n);
  }
});
test("本人3件/日本時間日・ログイン切替でも同じSchoolPark ID枠、別人は履歴不可", async () => {
  const f = await ready();
  for (let i = 0; i < 3; i++) {
    if (i === 2) f.advance(60001); // Short-term admission is separate from the daily quota.
    await submit(f, "request-person-key-" + i);
    await f.economy.tick();
  }
  f.a = await f.actor("google-alias");
  await assert.rejects(submit(f, "request-person-key-4"), /AI_DAILY_LIMIT/);
  const bob = await f.actor("bob"),
    id = Object.keys(f.db._dump("emuer_v2_agent_jobs"))[0];
  await assert.rejects(f.economy.service.view(bob, id), /JOB_NOT_FOUND/);
  assert.deepEqual(await f.economy.service.history(bob), []);
  f.advance(86400000);
  await assert.rejects(
    submit(f, "request-person-key-5"),
    /AI_AUDIENCE_NOT_VERIFIED/,
  );
});
test("全体20件/日・費用上限は決済前に強制", async () => {
  const f = await ready();
  await f.economy.service.ref("usage", "2026-11-06").set({ count: 20 });
  await assert.rejects(submit(f), /AI_DAILY_LIMIT/);
  assert.equal(rewards(f), 100n);
  await f.economy.service
    .ref("usage", "2026-11-06")
    .set({ count: 0, reservedTokens: 100000 });
  await assert.rejects(submit(f), /AI_BUDGET_LIMIT/);
  assert.equal(rewards(f), 100n);
});
test("同時worker上限2件は永続トランザクションで強制", async () => {
  let release;
  const waiting = new Promise((r) => {
    release = r;
  });
  const f = await ready({ providerWait: () => waiting }),
    jobs = [];
  for (let i = 0; i < 3; i++) {
    if (i === 2) f.advance(60001);
    jobs.push(await submit(f, "request-concurrent-" + i));
  }
  const all = Promise.all(jobs.map((j) => f.economy.service.work(j.id)));
  for (let i = 0; i < 100 && f.calls() < 2; i++)
    await new Promise((r) => setTimeout(r, 1));
  assert.equal(f.calls(), 2);
  assert.equal(
    Object.values(f.db._dump("emuer_v2_agent_jobs")).filter(
      (j) => j.state === "running",
    ).length,
    2,
  );
  release();
  await all;
  f.advance(60001); // Third generation waits for a new provider minute.
  await f.economy.tick();
  assert.equal(f.calls(), 3);
});
test("停止・未成年条件未確認・資格なし・個人情報入力は決済前に拒否", async () => {
  const f = await ready({ env: { ECONOMY_EXPLORER_ENABLED: "false" } });
  await assert.rejects(request(f), /SERVICE_DISABLED/);
  const g = await ready();
  await g.economy.service
    .ref("eligibility", hash(SPID))
    .set({ adultVerified: false });
  await assert.rejects(request(g), /AI_AUDIENCE_NOT_VERIFIED/);
  const h = await ready();
  h.a = await h.actor("guest");
  await assert.rejects(request(h), /SERVICE_NOT_ELIGIBLE/);
  h.a = await h.actor();
  for (const goal of [
    "私のメール test@example.com",
    "Bearer eyJ12345678901234567890.token",
    "連絡先 090-1234-5678",
    "0x" + "a".repeat(40),
  ])
    await assert.rejects(
      h.economy.service.quote(h.a, { goal }),
      /SENSITIVE_INPUT/,
    );
});
test("chain払いは設定でONに見せず、台帳とウォレット・拘束を分離", async () => {
  const f = await ready();
  assert.equal(
    (await f.economy.service.status()).service.chainPaymentEnabled,
    false,
  );
  const b = await f.commerce.servicePayments.balances(f.auth().walletAddress);
  assert.equal(b.wallet, "17");
  assert.equal(b.pending, "100");
  assert.equal(b.spendable, "100");
  assert.equal(b.held, "0");
});
test("外部交換mockは移転制限で停止、レート・署名・送金を生成しない", () => {
  const e = require("./external"),
    r = e.simulate({ chainId: 137, token: "EMUER", amount: "5" });
  assert.equal(r.outcome, "blocked");
  assert.equal(r.quote, null);
  assert.equal(r.executable, false);
  assert.equal(e.capability.reason, "TRANSFER_RESTRICTED");
  assert.equal(e.simulate({ chainId: 1 }).reason, "INVALID_REQUEST");
});
test("失効workerの遅い応答は結果や返却確定を上書きしない", async () => {
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  const f = await ready({ providerWait: () => wait }),
    j = await submit(f);
  const worker = f.economy.service.work(j.id);
  for (let i = 0; i < 100 && !f.calls(); i++)
    await new Promise((r) => setTimeout(r, 1));
  assert.equal(f.calls(), 1);
  f.advance(301000);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  release();
  await worker;
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "refunded");
  assert.equal(done.result, null);
  assert.equal(rewards(f), 100n);
});
test("署名拘束中残高は支払不可、chain払いをクライアントが指定しても拒否", async () => {
  const f = await ready(),
    rid = "0x" + "1".repeat(64);
  await f.db
    .collection("emuer_v2_rewards")
    .doc(rid)
    .set({ authorizedUntilMs: f.now() + 900000 }, { merge: true });
  const b = await f.commerce.servicePayments.balances(f.auth().walletAddress);
  assert.equal(b.held, "100");
  assert.equal(b.spendable, "0");
  assert.equal((await submit(f)).state, "failed");
  const requestBody = await request(f, "different-request-0001");
  await assert.rejects(
    f.economy.service.submit(f.a, { ...requestBody, method: "emuer_chain" }),
    /PAYMENT_METHOD_DISABLED/,
  );
});
test("再起動後に提供条件が未確認なら決済済み依頼を実行せず全額返却", async () => {
  const f = await ready(),
    j = await submit(f);
  f.env.ECONOMY_AI_TERMS_ATTESTED = "false";
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(f.calls(), 0);
  assert.equal(rewards(f), 100n);
});
test("異なるログインUIDでもquoteの過剰作成をSchoolPark ID単位で防ぐ", async () => {
  const f = await ready();
  for (let i = 0; i < 6; i++) await request(f);
  f.a = await f.actor("line-alias");
  await assert.rejects(request(f), /QUOTE_RATE_LIMIT/);
});
test("失敗理由や提供者の生レスポンスは履歴へ残さない", async () => {
  const f = await ready({ providerDown: true }),
    j = await submit(f);
  await f.economy.tick();
  const saved = JSON.stringify(f.db._dump("emuer_v2_agent_jobs"));
  assert.ok(!saved.includes("provider secret"));
  const result = await f.economy.service.view(f.a, j.id);
  assert.deepEqual(
    result.events.map((e) => e.state),
    ["awaiting_payment", "queued", "running", "refund_pending", "refunded"],
  );
});
test("価格設定が支払い直前に変わった場合は古いquoteで決済しない", async () => {
  const f = await ready();
  f.chain.claimPaid = async () => {
    await f.economy.service
      .ref("products", "agent_schoolpark-explorer-v1")
      .set({ prices: { EMUER: 6 } }, { merge: true });
    return 0n;
  };
  const j = await submit(f);
  assert.equal(j.state, "awaiting_payment");
  assert.equal(j.payment, null);
  assert.equal(rewards(f), 100n);
});
