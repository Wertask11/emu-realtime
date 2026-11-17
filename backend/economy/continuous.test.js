"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fixture } = require("./fixture"),
  { configuration, hash } = require("./config"),
  auth = require("./continuous-authorization");
const { crossFixture } = require("./search/test-support"),
  reply = require("../../tools/economy-tests/work-reply.cjs");
const ENV = {
  ECONOMY_SERVICE_MODE: "continuous",
  ECONOMY_CONTINUOUS_START: "2026-11-01T00:00:00Z",
  ECONOMY_CONTINUOUS_APPROVAL_REF: "isolated_continuous_approval",
  ECONOMY_INTAKE_ENABLED: "true",
  ECONOMY_EXPLORER_TRIAL_START: "2026-10-01T00:00:00Z",
};
async function offer(f) {
  const c = f.economy.service.config();
  await f.economy.service.ref("products", "agent_schoolpark-explorer-v1").set(
    {
      offering: {
        version: 1,
        mode: "continuous",
        approvalRef: c.continuousApprovalRef,
        startedAtMs: c.offering.startedAtMs,
        intakeEnabled: true,
      },
    },
    { merge: true },
  );
}
async function setup(options = {}) {
  const f = fixture({ ...options, env: { ...ENV, ...options.env } });
  await f.seed();
  await offer(f);
  f.a = await f.actor();
  return f;
}
async function request(f, key = "continuous-request-0001") {
  const q = await f.economy.service.quote(f.a, { goal: "コーヒーを学びたい" });
  return {
    quoteId: q.id,
    termsVersion: q.termsVersion,
    requestId: key,
    paymentConsent: true,
    aiConsent: true,
  };
}
test("continuous mode is independent of the unchanged historical trial and requires explicit policy/product approval", async () => {
  const f = await setup();
  try {
    const c = f.economy.service.config();
    assert.equal(c.trialEndMs, Date.parse("2026-10-08T00:00:00Z"));
    assert.ok(c.trialEndMs < f.now());
    assert.equal((await f.economy.service.status()).service.enabled, true);
    assert.deepEqual(
      [
        c.price,
        c.personDaily,
        c.globalDaily,
        c.concurrency,
        c.tokenBudget,
        c.reserveTokens,
      ],
      [5, 3, 20, 2, 100000, 5000],
    );
    for (const key of [
      "ECONOMY_CONTINUOUS_START",
      "ECONOMY_CONTINUOUS_APPROVAL_REF",
    ]) {
      const e = { ...f.env, [key]: "" };
      assert.equal(configuration(e, f.now()).enabled, false);
    }
    assert.equal(
      configuration({ ...f.env, ECONOMY_SERVICE_MODE: "guess" }, f.now())
        .enabled,
      false,
    );
    await f.economy.service
      .ref("products", "agent_schoolpark-explorer-v1")
      .set({ offering: null }, { merge: true });
    await assert.rejects(request(f), /SERVICE_DISABLED/);
    assert.equal(f.db._count("mitemiru_orders"), 0);
  } finally {
    f.economy.close();
  }
});
test("operator intake pause blocks new work but completes an already paid job and allows idempotent replay", async () => {
  const f = await setup();
  try {
    const b = await request(f),
      j = await f.economy.service.submit(f.a, b);
    f.env.ECONOMY_INTAKE_ENABLED = "false";
    await f.economy.service.ref("products", "agent_schoolpark-explorer-v1").set(
      {
        offering: {
          version: 1,
          mode: "continuous",
          approvalRef: ENV.ECONOMY_CONTINUOUS_APPROVAL_REF,
          startedAtMs: Date.parse(ENV.ECONOMY_CONTINUOUS_START),
          intakeEnabled: false,
        },
      },
      { merge: true },
    );
    await assert.rejects(
      request(f, "paused-new-request-0001"),
      /SERVICE_DISABLED/,
    );
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
    await f.economy.service.submit(f.a, b);
    assert.equal(f.calls(), 1);
    assert.equal(f.db._count("mitemiru_orders"), 1);
    assert.equal(
      (await f.commerce.servicePayments.balances(f.auth().walletAddress))
        .spendable,
      "95",
    );
  } finally {
    f.economy.close();
  }
});
test("intake pause does not stop existing full refunds", async () => {
  const f = await setup({ providerDown: true });
  try {
    const j = await f.economy.service.submit(f.a, await request(f));
    f.env.ECONOMY_INTAKE_ENABLED = "false";
    await f.economy.tick();
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(
      (await f.commerce.servicePayments.balances(f.auth().walletAddress))
        .spendable,
      "100",
    );
    assert.equal(f.db._count("mitemiru_orders"), 1);
  } finally {
    f.economy.close();
  }
});
test("a product pause between quote/admission check and transaction never charges", async () => {
  const f = await setup();
  try {
    const b = await request(f),
      run = f.db.runTransaction.bind(f.db);
    f.db.runTransaction = async (fn) => {
      const p = f.economy.service.ref(
          "products",
          "agent_schoolpark-explorer-v1",
        ),
        v = (await p.get()).data();
      await p.set(
        { offering: { ...v.offering, intakeEnabled: false } },
        { merge: true },
      );
      return run(fn);
    };
    await assert.rejects(f.economy.service.submit(f.a, b), /SERVICE_DISABLED/);
    assert.equal(f.db._count("mitemiru_orders"), 0);
    assert.equal(
      (await f.commerce.servicePayments.balances(f.auth().walletAddress))
        .spendable,
      "100",
    );
  } finally {
    f.economy.close();
  }
});
for (const plan of ["guest", "light", "plus", "pro"])
  test("continuous membership gate: " + plan, async () => {
    const f = await setup();
    try {
      f.entitlement.getEntitlement = async () => ({ plan });
      if (["plus", "pro"].includes(plan)) {
        assert.equal(
          (await f.economy.service.quote(f.a, { goal: "学ぶ" })).price,
          5,
        );
      } else {
        await assert.rejects(request(f), /SERVICE_NOT_ELIGIBLE/);
        assert.equal(f.db._count("mitemiru_orders"), 0);
      }
    } finally {
      f.economy.close();
    }
  });
for (const type of Object.keys(require("./tasks").TASKS))
  test(
    "continuous " +
      type +
      ": 5 EMUER, one saved artifact and Polygon remains OFF",
    async () => {
      const f = await crossFixture({
        env: { ...ENV, ECONOMY_PHASE3_ENABLED: "true" },
        providerReply: reply,
      });
      try {
        await offer(f);
        for (const id of Object.keys(
          f.db._dump("emuer_v2_agent_source_approvals"),
        ))
          await f.economy.service.ref("source_approvals", id).set(
            {
              artifactUseApproved: true,
              artifactPurpose: require("./tasks").VERSION,
              artifactAllowedTasks: Object.keys(require("./tasks").TASKS),
            },
            { merge: true },
          );
        const q = await f.economy.service.quote(f.a, {
            goal: "コーヒーの経験とWeb3クエスト・ギルド・City商品を比較したい",
            taskType: type,
          }),
          b = {
            quoteId: q.id,
            termsVersion: q.termsVersion,
            requestId: "continuous-work-request-0001",
            paymentConsent: true,
            aiConsent: true,
            searchConsentVersion: q.searchProfile.version,
            workConsentVersion: q.workConsentVersion,
          };
        assert.equal(q.price, 5);
        const j = await f.economy.service.submit(f.a, b);
        await f.economy.tick();
        assert.equal(
          (await f.economy.service.view(f.a, j.id)).state,
          "completed",
        );
        assert.equal(
          (await f.economy.service.artifacts.view(f.a, j.id)).artifactType,
          type,
        );
        await f.economy.service.submit(f.a, b);
        assert.equal(f.calls(), 1);
        assert.equal(f.db._count("mitemiru_orders"), 1);
        assert.equal(
          (await f.economy.service.status()).walletPayment.enabled,
          false,
        );
      } finally {
        f.economy.close();
      }
    },
  );
test("continuous authorizations preserve historical expiry, bind an existing qualified subject and reject new/unverified grants", async () => {
  const f = await setup();
  try {
    const end = configuration(f.env, f.now()).trialEndMs,
      r = {
        adultVerified: true,
        providerAllowed: true,
        verifiedAtMs: end - 1000,
        validUntilMs: end,
      },
      a = {
        version: 1,
        approved: true,
        approvalRef: ENV.ECONOMY_CONTINUOUS_APPROVAL_REF,
        authorizedAtMs: f.now(),
        subjectHash: hash(f.a.spid),
        sourceGrantHash: auth.eligibilityGrantHash(r),
      };
    r.continuousAuthorization = a;
    assert.equal(auth.eligibilityCurrent(r, f.a.spid, f.env, f.now()), true);
    assert.equal(r.validUntilMs, end);
    for (const bad of [
      { ...r, adultVerified: false },
      { ...r, providerAllowed: false },
      { ...r, revokedAtMs: 1 },
      { ...r, verifiedAtMs: 0 },
      { ...r, validUntilMs: end - 1 },
      { ...r, continuousAuthorization: { ...a, approvalRef: "different" } },
    ])
      assert.equal(
        auth.eligibilityCurrent(bad, f.a.spid, f.env, f.now()),
        false,
      );
    assert.equal(
      auth.eligibilityCurrent(r, "other-subject", f.env, f.now()),
      false,
    );
  } finally {
    f.economy.close();
  }
});
test("only exact original official materials can continue: third-party posts, source edits, revocation and actual deadlines reject", async () => {
  const f = await setup();
  try {
    const g = require("../../frontend/public/schoolpark/guild-store")
        .OFFICIAL[0],
      s = {
        kind: "guild",
        id: g.id,
        key: "guild:" + g.id,
        title: g.name,
        summary: g.concept,
        originHash: null,
      },
      r = {
        piiReviewed: true,
        aiUseApproved: true,
        contentHash: hash([s.title, s.summary]),
        validUntilMs: configuration(f.env, f.now()).trialEndMs,
      },
      a = {
        version: 1,
        approved: true,
        category: "A",
        approvalRef: ENV.ECONOMY_CONTINUOUS_APPROVAL_REF,
        authorizedAtMs: f.now(),
        sourceKey: s.key,
        contentHash: r.contentHash,
        originHash: null,
        sourceGrantHash: auth.sourceGrantHash(r),
        proofKind: "operator-original-guild-text",
      };
    r.continuousAuthorization = a;
    assert.equal(auth.sourceCurrent(r, s, f.env, f.now()), true);
    for (const bad of [
      { ...s, kind: "knowledge_lab" },
      { ...s, title: "changed" },
      { ...s, id: "nonofficial" },
      { ...s, facts: { deadlineMs: f.now() - 1 } },
    ])
      assert.equal(auth.sourceCurrent(r, bad, f.env, f.now()), false);
    for (const bad of [
      { ...r, aiUseApproved: false },
      { ...r, piiReviewed: false },
      { ...r, revokedAtMs: 1 },
      { ...r, continuousAuthorization: { ...a, approvalRef: "different" } },
      { ...r, continuousAuthorization: { ...a, originHash: "changed" } },
    ])
      assert.equal(auth.sourceCurrent(bad, s, f.env, f.now()), false);
  } finally {
    f.economy.close();
  }
});

test("same owned request coalesces in-flight retries before payment and rejects different content", async () => {
  const f = await setup();
  try {
    const b = await request(f),
      pay = f.economy.service.payments.pay;
    let attempts = 0;
    f.economy.service.payments.pay = async (...args) => {
      attempts++;
      return pay(...args);
    };
    const first = f.economy.service.submit(f.a, b),
      replays = Array.from({ length: 7 }, () =>
        f.economy.service.submit(f.a, b),
      );
    await assert.rejects(
      f.economy.service.submit(f.a, { ...b, quoteId: "different" }),
      /IDEMPOTENCY_KEY_CONFLICT/,
    );
    const jobs = await Promise.all([first, ...replays]);
    assert.equal(new Set(jobs.map((j) => j.id)).size, 1);
    assert.equal(attempts, 1);
    assert.equal(f.db._count("mitemiru_orders"), 1);
    assert.equal(
      (await f.commerce.servicePayments.balances(f.auth().walletAddress))
        .spendable,
      "95",
    );
  } finally {
    f.economy.close();
  }
});

for (const committed of [true, false])
  test(
    "closed-transaction recovery requires an exact owned durable commit: " +
      committed,
    async () => {
      const f = await setup();
      try {
        const b = await request(f),
          run = f.db.runTransaction.bind(f.db);
        let first = true;
        f.db.runTransaction = async (fn) => {
          if (!first) return run(fn);
          first = false;
          if (committed) await run(fn);
          throw Object.assign(Error("transaction closed"), {
            code: 3,
            details: "Transaction is invalid or closed.",
          });
        };
        if (committed) {
          const j = await f.economy.service.submit(f.a, b);
          assert.equal(j.state, "queued");
          assert.equal(f.db._count("mitemiru_orders"), 1);
        } else {
          await assert.rejects(
            f.economy.service.submit(f.a, b),
            /transaction closed/,
          );
          assert.equal(f.db._count("mitemiru_orders"), 0);
        }
      } finally {
        f.economy.close();
      }
    },
  );
test("a generic INVALID_ARGUMENT is never turned into a successful submission", async () => {
  const f = await setup();
  try {
    const b = await request(f);
    f.db.runTransaction = async () => {
      throw Object.assign(Error("invalid field"), {
        code: 3,
        details: "Invalid field value",
      });
    };
    await assert.rejects(f.economy.service.submit(f.a, b), /invalid field/);
    assert.equal(f.db._count("mitemiru_orders"), 0);
  } finally {
    f.economy.close();
  }
});
