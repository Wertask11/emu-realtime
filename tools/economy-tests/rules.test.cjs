"use strict";
const { test, before, after } = require("node:test"),
  fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
} = require("firebase/firestore");
let env;
const cols = [
  "artifacts",
  "artifact_owners",
  "practice",
  "practice_owners",
  "products",
  "quotes",
  "jobs",
  "usage",
  "free_usage",
  "system",
  "eligibility",
  "source_approvals",
  "quote_usage",
  "wallet_challenges",
  "chain_ops",
  "operator_gas",
  "gas_reservations",
  "signatures",
  "signer_nonces",
];
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-emu-economy-stage2-rules",
    firestore: {
      host: "127.0.0.1",
      port: 8892,
      rules: fs.readFileSync(
        require("node:path").join(__dirname, "../../firestore.rules"),
        "utf8",
      ),
    },
  });
});
after(async () => env?.cleanup());
for (const role of ["anonymous", "alice", "bob", "owner"])
  test(
    "Rules: " + role + "が新しい経済・AI制御文書を直接読書きできない",
    async () => {
      const db =
        role === "anonymous"
          ? env.unauthenticatedContext().firestore()
          : env.authenticatedContext(role).firestore();
      for (const name of cols) {
        const col = "emuer_v2_agent_" + name;
        await assertFails(getDoc(doc(db, col, "test")));
        await assertFails(getDocs(collection(db, col)));
        await assertFails(
          setDoc(doc(db, col, "test"), { price: 1, adultVerified: true }),
        );
        await assertFails(
          setDoc(doc(db, col, "test", "nested", "test"), { enabled: true }),
        );
      }
    },
  );
