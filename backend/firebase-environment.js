"use strict";

const PRODUCTION_FIREBASE_PROJECT_ID = "emusch-2a111";

function resolveFirebaseConfig({
  deploymentEnv,
  configuredProjectId,
  configuredStorageBucket,
  serviceAccount
}) {
  if (!serviceAccount || typeof serviceAccount.project_id !== "string" || !serviceAccount.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_PROJECT_REQUIRED");
  }

  const environment = String(deploymentEnv || "production").trim().toLowerCase();
  const projectId = String(configuredProjectId || serviceAccount.project_id).trim();
  if (environment === "staging" && !configuredProjectId) {
    throw new Error("STAGING_FIREBASE_PROJECT_ID_REQUIRED");
  }
  if (projectId !== serviceAccount.project_id) {
    throw new Error("FIREBASE_PROJECT_MISMATCH");
  }
  if (environment === "staging" && projectId === PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error("STAGING_CANNOT_USE_PRODUCTION_FIREBASE");
  }

  return {
    projectId,
    storageBucket: String(configuredStorageBucket || (projectId + ".firebasestorage.app")).trim()
  };
}

module.exports = { PRODUCTION_FIREBASE_PROJECT_ID, resolveFirebaseConfig };
