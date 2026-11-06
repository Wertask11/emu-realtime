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
async function createFixture({
  port = 0,
  providerDown = false,
  enabled = true,
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
    env: { ECONOMY_EXPLORER_ENABLED: enabled ? "true" : "false" },
  });
  // Replace test-header authentication and fake identities with actual production middleware, identity and entitlement.
  const { createService } = require("../../backend/knowledge-lab/service");
  const knowledge = createService({
    db,
    identity,
    entitlement,
    isOwner: () => false,
  });
  const sources = require("../../backend/economy/sources").createSources({
    db,
    knowledge,
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
  const agent = require("../../backend/economy/agent").createAgent({
    env: f.env,
    config: () => require("../../backend/economy/config").configuration(f.env),
    fetcher: async (url, opts) => {
      if (url.endsWith(":countTokens"))
        return {
          ok: true,
          text: async () => JSON.stringify({ totalTokens: 100 }),
        };
      if (providerDown) throw Error("isolated provider failure");
      const sources = JSON.parse(
        JSON.parse(opts.body).contents[0].parts[0].text,
      ).sources;
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
                      text: JSON.stringify({
                        matches: sources
                          .slice(0, 3)
                          .map((s) => ({ key: s.key, evidence: "summary" })),
                      }),
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
  for (const role of ["alice", "bob"]) {
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
      .set({ plan: "plus", source: "emulator-test", startsAt: new Date(0) });
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
      purpose: SERVICE.termsVersion,
      contentHash: hash([title, summary]),
      validUntilMs: Date.now() + 86400000,
    });
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  app.use("/api/economy", economy.router);
  app.use("/api/mitemiru", commerce.router);
  app.get("/test/login", (req, res) => {
    const u = users[req.query.role];
    if (!u) return res.sendStatus(404);
    res.set("Cache-Control", "no-store").json({ uid: u.uid, token: u.token });
  });
  app.get("/test/shell", (req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL ECONOMY ONLY</title><style>body{margin:0}iframe{display:block;width:100%;height:100dvh;border:0}</style><iframe title="EMUER・サービス" src="/economy/index.html"></iframe><script>window.auth={currentUser:null};let token;window.emuAuthHeaders=async()=>{if(!token)throw Error('AUTH_REQUIRED');return {Authorization:'Bearer '+token}};window.openSpRoom=(url)=>{document.querySelector('iframe').src=url};window.closeSpRoom=()=>{window.closedEconomy=true};window.testSignIn=async(role)=>{const r=await fetch('/test/login?role='+role),d=await r.json();token=d.token;window.auth.currentUser={uid:d.uid};};window.testSignIn('alice');</script></html>`,
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
  createFixture({ port: 4257 })
    .then((f) => {
      setInterval(() => f.economy.tick(), 1000).unref();
      console.log("LOCAL isolated economy fixture: " + f.base + "/test/shell");
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { createFixture, PROJECT, FIRESTORE };
