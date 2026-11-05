"use strict";
// Local-only fixture: actual app, Firebase/Auth emulators and existing auth middleware.
process.env.LAB_EMULATOR_PROJECT = "demo-emu-knowledge-lab-passport2";
process.env.LAB_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const { main } = require("../knowledge-lab-tests/native-fixture.cjs");
async function start() {
  const f = await main({ port: 4240, reset: false });
  const router = require("../../backend/passport-v2/router.cjs").createRouter({
    db: f.db,
    identity: f.identity,
    requireFirebaseUser: f.middleware.requireFirebaseUser,
    env: {
      PASSPORT_V2_ENABLED: "true",
      PASSPORT_V2_SANDBOX: "true",
      APP_ENV: "local",
      GCLOUD_PROJECT: "demo-emu-knowledge-lab-passport2",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
      PASSPORT_V2_SANDBOX_BASE: f.base + "/api/passport-v2",
    },
  });
  f.app.use("/api/passport-v2", router);
  const layer = f.app.router.stack.pop();
  f.app.router.stack.unshift(layer);
  console.log("PASSPORT_SANDBOX_READY " + f.base + "/test/native.html");
  return f;
}
if (require.main === module)
  start().catch(() => {
    console.error("LOCAL_FIXTURE_FAILED");
    process.exitCode = 1;
  });
module.exports = { start };
