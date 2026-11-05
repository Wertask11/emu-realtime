// Deployable one-shot maintenance entry, never imported or scheduled by server.js.
// Default is read-only; writing is restricted to a demo Firestore emulator here.
import admin from "../../backend/node_modules/firebase-admin/lib/index.js";
import { firestoreOperations } from "../../backend/passport-v2/trust.mjs";
const realm = process.env.PASSPORT_STORAGE_REALM,
  project = process.env.GCLOUD_PROJECT;
if (
  !/^[a-f0-9]{64}$/.test(realm || "") ||
  !/^demo-/.test(project || "") ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")
)
  throw Error("ISOLATED_MAINTENANCE_CONFIGURATION_REQUIRED");
const dryRun = process.argv.includes("--apply") ? false : true;
const app = admin.initializeApp({ projectId: project });
try {
  console.log(
    JSON.stringify(
      await firestoreOperations(app.firestore(), { realm }).cleanup({
        limit: 100,
        dryRun,
      }),
    ),
  );
} finally {
  await app.delete();
}
