"use strict";
// Real OS restart test, strictly dedicated local demo storage; no production assets or provider.
const host = "127.0.0.1:8892",
  project = "demo-emu-economy-stage2";
if (process.env.FIRESTORE_EMULATOR_HOST !== host)
  throw Error("LOCAL_EMULATOR_ONLY");
process.env.GCLOUD_PROJECT = project;
process.on("message", async ({ env, jobId, mode }) => {
  let app, e;
  try {
    const admin = require("../../backend/node_modules/firebase-admin");
    app = admin.initializeApp({ projectId: project });
    const db = app.firestore();
    const identity = require("../../backend/identity").createIdentity({
      db,
      ethers: require("../../backend/node_modules/ethers"),
    });
    const entitlement = require("../../backend/entitlement").createEntitlement({
      db,
      identity,
    });
    const knowledge =
      require("../../backend/knowledge-lab/service").createService({
        db,
        identity,
        entitlement,
        isOwner: () => false,
      });
    const { hash } = require("../../backend/economy/config");
    const commerce = require("../../backend/mitemiru").createMitemiruRouter({
      db,
      identity,
      entitlement,
      env,
      emuerEnabled: () => true,
      chain: { id: (s) => "0x" + hash(s), claimPaid: async () => 0n },
      requireFirebaseUser: (q, r) => r.sendStatus(403),
      requireOwner: (q, r) => r.sendStatus(403),
    });
    let generations = 0;
    e = require("../../backend/economy/router").createEconomyRouter({
      db,
      identity,
      entitlement,
      env,
      startWorker: false,
      payments: commerce.servicePayments,
      knowledge,
      requireFirebaseUser: (q, r) => r.sendStatus(403),
      agent: async () => {
        generations++;
        process.send({ event: "generation_started" });
        if (mode === "hang") await new Promise(() => {});
        throw Error("MUST_NOT_REGENERATE");
      },
    });
    await e.tick();
    const j = (
        await db.collection("emuer_v2_agent_jobs").doc(jobId).get()
      ).data(),
      o = await commerce.servicePayments.get(j.orderId);
    process.send({
      event: "done",
      state: j.state,
      payment: o.status,
      generations,
    });
    e.close();
    await app.delete();
    process.disconnect();
  } catch (error) {
    process.send({
      event: "failed",
      code: typeof error.code === "number" ? error.code : "WORKER_TEST_FAILED",
    });
    e?.close();
    if (app) await app.delete();
    process.disconnect();
    process.exitCode = 1;
  }
});
