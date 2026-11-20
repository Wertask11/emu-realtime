"use strict";
const { test, before, after } = require("node:test"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} = require("firebase/firestore");
let env;
const A = "SP-AAAA-AAAA-AAAA-AAAA";
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-city-room-rules",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: fs.readFileSync(
        path.join(__dirname, "../../firestore.rules"),
        "utf8",
      ),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "city_rooms", A), {
      ownerUid: "alice",
      schoolParkId: A,
      visibility: "public",
      layout: { placements: [] },
    });
  });
});
after(async () => env?.cleanup());
for (const role of ["anonymous", "alice", "bob", "owner"])
  test(`Room Rules: ${role} cannot bypass server auth, inventory or public projection`, async () => {
    const db = (
      role === "anonymous"
        ? env.unauthenticatedContext()
        : env.authenticatedContext(role)
    ).firestore();
    for (const p of [
      "city_rooms/" + A,
      "city_rooms/_public/ids/AAAAAAAAAAAAAAAAAAAAAA",
      "city_rooms/" + A + "/likes/a",
      "city_rooms/" + A + "/city_room_reports/a",
      "city_rooms/" + A + "/city_room_requests/a",
    ]) {
      const ref = doc(db, p);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { visibility: "public", ownerUid: role }));
      await assertFails(updateDoc(ref, { visibility: "public" }));
      await assertFails(deleteDoc(ref));
    }
    await assertFails(getDocs(collection(db, "city_rooms")));
  });
