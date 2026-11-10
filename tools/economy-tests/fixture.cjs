"use strict";
// Hard refusal to access anything except our dedicated local demo project.
const PROJECT = "demo-emu-economy-stage2",
  FIRESTORE = "127.0.0.1:8892",
  AUTH = "127.0.0.1:9292";
if (
  (process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE) ||
  (process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH)
)
  throw Error("DEDICATED_EMULATOR_ONLY");
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.GCLOUD_PROJECT = PROJECT;
const admin = require("../../backend/node_modules/firebase-admin"),
  express = require("../../backend/node_modules/express");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../..");
const authHeadersSource = require("../year-goals-tests/extract.cjs").grab(
  fs.readFileSync(path.join(ROOT, "frontend/public/index.html"), "utf8"),
  "emuAuthHeaders",
);
async function createFixture({
  port = 0,
  providerDown = false,
  providerStatus = null,
  providerFetcher = null,
  enabled = true,
  crossDomain = false,
  phase3 = false,
  phase4 = false,
} = {}) {
  const reset = await fetch(
    "http://" +
      FIRESTORE +
      "/emulator/v1/projects/" +
      PROJECT +
      "/databases/(default)/documents",
    { method: "DELETE" },
  );
  if (!reset.ok) throw Error("DEDICATED_EMULATOR_RESET_FAILED");
  const fb = admin.initializeApp(
      { projectId: PROJECT },
      "economy-" + Date.now(),
    ),
    db = fb.firestore();
  const identity = require("../../backend/identity").createIdentity({
    db,
    ethers: require("../../backend/node_modules/ethers"),
  });
  const entitlement = require("../../backend/entitlement").createEntitlement({
    db,
    identity,
  });
  const verified = require("../../backend/verified-platform");
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const from = source.indexOf("async function requireFirebaseUser("),
    to = source.indexOf('app.use("/api/auth"', from);
  const context = {
    firebaseAdmin: { auth: () => fb.auth() },
    db,
    ensureVerifiedAccount: verified.ensureVerifiedAccount,
    identityAccountCache: new Map(),
    IDENTITY_CACHE_MS: 300000,
    Date,
    Map,
    String,
    console,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(from, to), context);
  const f = require("../../backend/economy/fixture").fixture({
    db,
    providerDown,
    env: {
      ECONOMY_EXPLORER_ENABLED: enabled ? "true" : "false",
      ECONOMY_PHASE3_ENABLED: phase3 ? "true" : "false",
      ECONOMY_PHASE4_ENABLED: phase4 ? "true" : "false",
      ...(crossDomain
        ? {
            ECONOMY_CROSS_DOMAIN_ENABLED: "true",
            ECONOMY_PRIVATE_BALANCE_ENABLED: "true",
            ECONOMY_PRIVATE_ACHIEVEMENTS_ENABLED: "true",
            ...Object.fromEntries(
              Object.keys(
                require("../../backend/economy/search/profile").DOMAINS,
              ).map((d) => ["ECONOMY_SOURCE_" + d.toUpperCase(), "true"]),
            ),
          }
        : {}),
    },
  });
  // Replace test-header authentication and fake identities with actual production middleware, identity and entitlement.
  const { createService } = require("../../backend/knowledge-lab/service");
  const knowledge = createService({
    db,
    identity,
    entitlement,
    isOwner: () => false,
  });
  const commerce = require("../../backend/mitemiru").createMitemiruRouter({
    db,
    identity,
    entitlement,
    env: f.env,
    emuerEnabled: () => true,
    chain: {
      id: (v) => "0x" + require("../../backend/economy/config").hash(v),
      claimPaid: async () => 0n,
      balanceOf: async () => "17000000000000000000",
    },
    requireFirebaseUser: context.requireFirebaseUser,
    requireOwner: (req, res) => res.sendStatus(403),
  });
  const sources = require("../../backend/economy/sources").createSources({
    db,
    knowledge,
    env: f.env,
    payments: commerce.servicePayments,
  });
  const providerPayloads = [];
  const agent = require("../../backend/economy/agent").createAgent({
    env: f.env,
    config: () => require("../../backend/economy/config").configuration(f.env),
    fetcher: async (url, opts) => {
      if (providerFetcher) return providerFetcher(url, opts);
      if (url.endsWith(":countTokens"))
        return {
          ok: true,
          text: async () => JSON.stringify({ totalTokens: 100 }),
        };
      if (providerStatus) return { ok: false, status: providerStatus };
      if (providerDown) throw Error("isolated provider failure");
      const payload = JSON.parse(opts.body);
      providerPayloads.push(payload);
      const sources = JSON.parse(payload.contents[0].parts[0].text).sources;
      const cross = !!payload.generationConfig.responseSchema.properties.steps;
      const selected = sources.slice(0, cross ? 6 : 3);
      const work =
        JSON.parse(payload.contents[0].parts[0].text).workType || null;
      const action = (s) =>
        ["guild", "quest"].includes(s.kind)
          ? "review_activity"
          : ["city_product", "emuer_guide"].includes(s.kind)
            ? "review_conditions"
            : s.kind === "passport_guide"
              ? "check_profile"
              : s.kind === "activity_guide"
                ? "open_play_guide"
                : "read_source";
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 10,
              totalTokenCount: 110,
            },
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify(
                        work
                          ? require("./work-reply.cjs")(payload)
                          : {
                              matches: selected.map((s) => ({
                                key: s.key,
                                evidence: "summary",
                              })),
                              ...(cross
                                ? {
                                    steps: selected.map((s) => ({
                                      key: s.key,
                                      action: action(s),
                                    })),
                                    comparisons:
                                      selected.length > 1
                                        ? [
                                            {
                                              keys: selected
                                                .slice(0, 2)
                                                .map((s) => s.key),
                                              basis: "perspectives",
                                            },
                                          ]
                                        : [],
                                  }
                                : {}),
                            },
                      ),
                    },
                  ],
                },
              },
            ],
          }),
      };
    },
  });
  const economy = require("../../backend/economy/router").createEconomyRouter({
    startWorker: false,
    db,
    identity,
    entitlement,
    env: f.env,
    requireFirebaseUser: context.requireFirebaseUser,
    payments: commerce.servicePayments,
    sources,
    agent,
  });
  const { hash, SERVICE } = require("../../backend/economy/config");
  await economy.service.workerHealth(true);
  await db
    .collection("emuer_v2_agent_products")
    .doc("agent_schoolpark-explorer-v1")
    .set({
      name: SERVICE.name,
      status: "live",
      prices: { EMUER: 5 },
      stock: null,
      termsVersion: SERVICE.termsVersion,
    });
  const users = {};
  for (const role of ["alice", "bob", "guest", "light", "pro"]) {
    const email = role + "@economy.example.invalid",
      password = "Emulator-only-password-123";
    try {
      await fb.auth().createUser({ uid: "economy-" + role, email, password });
    } catch (e) {
      if (
        !["auth/uid-already-exists", "auth/email-already-exists"].includes(
          e.code,
        )
      )
        throw e;
    }
    const r = await fetch(
      "http://" +
        AUTH +
        "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!r.ok) throw Error("LOCAL_AUTH_FAILED");
    const token = (await r.json()).idToken;
    const decoded = await fb.auth().verifyIdToken(token),
      account = await verified.ensureVerifiedAccount(db, decoded),
      person = await identity.resolveForUid(decoded.uid);
    await db
      .collection("entitlements")
      .doc(decoded.uid)
      .set({
        plan: ["guest", "light", "pro"].includes(role) ? role : "plus",
        source: role === "light" ? "emu-gift" : "emulator-test",
        startsAt: new Date(0),
        ...(role === "light"
          ? { expiresAt: new Date(Date.now() + 7 * 86400000) }
          : {}),
      });
    await economy.service.ref("eligibility", hash(person.spid)).set({
      adultVerified: true,
      providerAllowed: true,
      validUntilMs: Date.now() + 86400000,
    });
    await db
      .collection("emuer_v2_rewards")
      .doc("0x" + hash("seed-" + role))
      .set({
        recipient: account.walletAddress.toLowerCase(),
        uid: decoded.uid,
        claimId: "0x" + hash("seed-" + role),
        status: "pending",
        amountWei: "100000000000000000000",
        createdAt: new Date(0),
      });
    users[role] = { uid: decoded.uid, token, account, spid: person.spid };
  }
  const publicPost = {
    title: "LOCAL検証用：コーヒーの学び",
    body: "コーヒーの抽出温度を比べる。個人を含まない検証用資料。",
    visibility: "public",
    createdAt: new Date(),
    knowledgeLab: { revision: 1, aiUseConsent: { allowed: true } },
  };
  await db.collection("posts").doc("economy-coffee-public").set(publicPost);
  await db
    .collection("posts")
    .doc("economy-private")
    .set({ ...publicPost, title: "非公開の秘密", visibility: "private" });
  await db.collection("room1_contents").doc("economy-text").set({
    title: "LOCAL検証用：コーヒーと学び",
    summary: "コーヒーを学ぶための検証教材。",
    body: "非公開情報は含みません。",
    theme: "yellow",
    subTheme: "検証用",
    createdAt: new Date().toISOString(),
  });
  await db.collection("sp_quests").doc("economy-quest").set({
    title: "LOCAL検証用：コーヒーの比較クエスト",
    brief: "コーヒーを比べて学ぶ検証。",
    status: "OPEN",
  });
  await db
    .collection("mitemiru_products")
    .doc("economy-item")
    .set({
      name: "LOCAL検証用：コーヒー体験チケット",
      description: "コーヒーを学ぶ模擬チケット。実販売なし。",
      shopId: "schoolpark-official",
      status: "live",
      prices: { EMUER: 5 },
      stock: 10,
    });
  await db
    .collection("knowledge_lab_system")
    .doc("index")
    .set({ state: "ready", finishedAtMs: Date.now() });
  const legacy = {
    title: "LOCAL公開知識：コーヒーを学ぶ",
    body: "コーヒーの淹れ方を記録して比べる公開知識。",
    visibility: "public",
    createdAt: new Date(),
    knowledgeLab: { aiUseConsent: { allowed: true } },
  };
  await db.collection("posts").doc("economy-legacy-public").set(legacy);
  await knowledge.syncPublicPost("economy-legacy-public");
  await knowledge.syncPublicPost("economy-coffee-public");
  const records = [
    ["knowledge:economy-legacy-public", legacy.title, legacy.body],
    ["knowledge_lab:economy-coffee-public", publicPost.title, publicPost.body],
    [
      "knowledge_text:economy-text",
      "LOCAL検証用：コーヒーと学び",
      "コーヒーを学ぶための検証教材。",
    ],
    [
      "quest:economy-quest",
      "LOCAL検証用：コーヒーの比較クエスト",
      "コーヒーを比べて学ぶ検証。",
    ],
    [
      "city_product:economy-item",
      "LOCAL検証用：コーヒー体験チケット",
      "コーヒーを学ぶ模擬チケット。実販売なし。",
    ],
  ];
  for (const g of require("../../frontend/public/schoolpark/guild-store")
    .OFFICIAL)
    records.push(["guild:" + g.id, g.name, g.concept]);
  for (const [key, title, summary] of records)
    await economy.service.ref("source_approvals", hash(key)).set({
      piiReviewed: true,
      aiUseApproved: true,
      purpose: SERVICE.termsVersion,
      contentHash: hash([title, summary]),
      validUntilMs: Date.now() + 86400000,
    });
  if (crossDomain) {
    await db.collection("sp_stars").doc("alice-star").set({
      spid: users.alice.spid,
      status: "minted",
      label: "LOCAL-PRIVATE-LABEL",
    });
    await db.collection("sp_stars").doc("bob-star").set({
      spid: users.bob.spid,
      status: "minted",
      label: "LOCAL-OTHER-PERSON",
    });
    await db
      .collection("sp_quest_certificates")
      .doc("alice-certificate")
      .set({ spid: users.alice.spid, status: "pending" });
    const a = await economy.service.actor({
      uid: users.alice.uid,
      account: users.alice.account,
      walletAddress: users.alice.account.walletAddress,
    });
    for (const adapter of Object.values(sources.cross.adapters))
      for (const source of await adapter.list(a)) {
        if (source.kind === "guild") continue;
        await economy.service.ref("source_approvals", hash(source.key)).set({
          piiReviewed: true,
          aiUseApproved: true,
          rightsVerified: true,
          authorPermissionConfirmed: true,
          purpose: require("../../backend/economy/search/profile").PURPOSE,
          contentHash: hash([source.title, source.summary]),
          originHash: source.originHash || null,
          validUntilMs: Date.now() + 86400000,
        });
      }
  }
  if (phase3 && crossDomain) {
    const a = await economy.service.actor({
      uid: users.alice.uid,
      account: users.alice.account,
      walletAddress: users.alice.account.walletAddress,
    });
    for (const adapter of Object.values(sources.cross.adapters))
      for (const source of await adapter.list(a)) {
        await economy.service.ref("source_approvals", hash(source.key)).set(
          {
            artifactUseApproved: true,
            artifactAllowedTasks: Object.keys(
              require("../../backend/economy/tasks").TASKS,
            ),
            artifactPurpose: require("../../backend/economy/tasks").VERSION,
          },
          { merge: true },
        );
      }
  }
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/economy", economy.router);
  app.use("/api/mitemiru", commerce.router);
  app.post("/test/legacy-artifact", async (req, res) => {
    // Dedicated demo fixture only; never mounted by the production server.
    const u = users[req.body?.role];
    if (!u) return res.sendStatus(400);
    const rows = await db
      .collection("emuer_v2_agent_artifacts")
      .where("ownerUid", "==", u.uid)
      .limit(1)
      .get();
    if (rows.empty) return res.sendStatus(404);
    await rows.docs[0].ref.set(
      {
        formatVersion: 1,
        document: null,
        content: "公開資料を比較してください。\n［本人が確認・記入］",
        sections: [{ title: "以前の構成", prompt: "内容を確認してください。" }],
      },
      { merge: true },
    );
    res.json({ ok: true });
  });
  app.post("/test/membership", async (req, res) => {
    const role = req.body?.role,
      plan = req.body?.plan;
    if (!users[role] || !["guest", "light", "plus", "pro"].includes(plan))
      return res.sendStatus(400);
    await db
      .collection("entitlements")
      .doc(users[role].uid)
      .set({
        plan,
        source: "emulator-test",
        startsAt: new Date(0),
        ...(req.body.expired ? { expiresAt: new Date(Date.now() - 1000) } : {}),
      });
    res.json({ ok: true });
  });
  app.get("/test/login", (req, res) => {
    const u = users[req.query.role];
    if (!u) return res.sendStatus(404);
    res.set("Cache-Control", "no-store").json({ uid: u.uid, token: u.token });
  });
  app.get("/test/reizo-shell", (req, res) =>
    res.type("html").send(require("./reizo-shell.cjs").reizoShell()),
  );
  app.get("/test/shell", (req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL ECONOMY ONLY</title><style>body{margin:0}iframe{display:block;width:100%;height:100dvh;border:0}</style><iframe title="EMUER・サービス" src="/economy/index.html"></iframe><script>window.auth={currentUser:null};${authHeadersSource};window.openSpRoom=(url)=>{document.querySelector('iframe').src=url};window.closeSpRoom=()=>{window.closedEconomy=true};window.testSignIn=async(role)=>{const r=await fetch('/test/login?role='+role),d=await r.json();window.auth.currentUser={uid:d.uid,getIdToken:async()=>d.token};};window.testSignIn('alice');</script></html>`,
      ),
  );
  app.use(express.static(path.join(ROOT, "frontend/public")));
  const server = app.listen(port, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  async function call(role, method, route, body) {
    const r = await fetch(base + "/api/economy" + route, {
      method,
      headers: {
        "content-type": "application/json",
        ...(users[role]
          ? { Authorization: "Bearer " + users[role].token }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  return {
    base,
    db,
    users,
    economy,
    commerce,
    knowledge,
    providerPayloads,
    env: f.env,
    call,
    close: async () => {
      economy.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await fb.delete();
    },
  };
}
if (require.main === module)
  createFixture({
    port: 4257,
    crossDomain: process.env.ECONOMY_TEST_CROSS === "true",
    phase3: process.env.ECONOMY_TEST_PHASE3 === "true",
    phase4: process.env.ECONOMY_TEST_PHASE4 === "true",
  })
    .then((f) => {
      setInterval(() => f.economy.tick(), 1000).unref();
      console.log("LOCAL isolated economy fixture: " + f.base + "/test/shell");
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { createFixture, PROJECT, FIRESTORE };
