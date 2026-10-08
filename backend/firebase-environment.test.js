"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PRODUCTION_FIREBASE_PROJECT_ID, resolveFirebaseConfig } = require("./firebase-environment");

function account(project_id) { return { project_id, private_key: "test-only" }; }

test("production config keeps the service-account project and current bucket default", () => {
  assert.deepEqual(resolveFirebaseConfig({
    serviceAccount: account(PRODUCTION_FIREBASE_PROJECT_ID)
  }), {
    projectId: PRODUCTION_FIREBASE_PROJECT_ID,
    storageBucket: PRODUCTION_FIREBASE_PROJECT_ID + ".firebasestorage.app"
  });
});

test("staging requires an explicit non-production project matching its service account", () => {
  assert.throws(() => resolveFirebaseConfig({
    deploymentEnv: "staging",
    serviceAccount: account("schoolpark-staging")
  }), /STAGING_FIREBASE_PROJECT_ID_REQUIRED/);
  assert.throws(() => resolveFirebaseConfig({
    deploymentEnv: "staging",
    configuredProjectId: PRODUCTION_FIREBASE_PROJECT_ID,
    serviceAccount: account(PRODUCTION_FIREBASE_PROJECT_ID)
  }), /STAGING_CANNOT_USE_PRODUCTION_FIREBASE/);
  assert.throws(() => resolveFirebaseConfig({
    deploymentEnv: "staging",
    configuredProjectId: "schoolpark-staging",
    serviceAccount: account(PRODUCTION_FIREBASE_PROJECT_ID)
  }), /FIREBASE_PROJECT_MISMATCH/);
  assert.deepEqual(resolveFirebaseConfig({
    deploymentEnv: "staging",
    configuredProjectId: "schoolpark-staging",
    configuredStorageBucket: "schoolpark-staging.firebasestorage.app",
    serviceAccount: account("schoolpark-staging")
  }), {
    projectId: "schoolpark-staging",
    storageBucket: "schoolpark-staging.firebasestorage.app"
  });
});
