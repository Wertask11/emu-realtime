const { test, before, after } = require("node:test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs"),
  path = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
} = require("../quest-tests/node_modules/@firebase/rules-unit-testing");
const fb = require("../quest-tests/node_modules/firebase/firestore");
let env;
const id = randomUUID();
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-emu-knowledge-lab-passport2",
    firestore: {
      host: "127.0.0.1",
      port: 8787,
      rules: fs.readFileSync(
        path.join(__dirname, "../../firestore.rules"),
        "utf8",
      ),
    },
  });
});
after(async () => {
  await env.cleanup();
});
for (const role of ["anonymous", "alice", "bob", "owner"])
  test("Passport server-only namespace: " + role, async () => {
    const db =
      role === "anonymous"
        ? env.unauthenticatedContext().firestore()
        : env
            .authenticatedContext("lab-" + role, {
              firebase: { sign_in_provider: "password" },
            })
            .firestore();
    for (const col of [
      "passport_v2_accounts",
      "passport_v2_status",
      "passport_v2_tickets",
      "passport_v2_future",
    ]) {
      const ref = fb.doc(db, col, id);
      await assertFails(fb.getDoc(ref));
      await assertFails(fb.getDocs(fb.collection(db, col)));
      await assertFails(fb.setDoc(ref, { selfIssued: true }));
      await assertFails(fb.deleteDoc(ref));
      await assertFails(
        fb.setDoc(fb.doc(db, col, id, "nested", "entry"), { selfIssued: true }),
      );
    }
  });
