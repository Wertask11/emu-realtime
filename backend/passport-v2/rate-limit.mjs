import { createHmac } from "node:crypto";
import { fail } from "./crypto.mjs";

// One shared Firestore transaction per request. No raw address/UID is persisted.
export function sharedRateLimit({
  db,
  realm,
  hmacKey,
  limit = 60,
  windowMs = 60000,
  clock = Date.now,
}) {
  if (
    !db ||
    !/^[a-f0-9]{64}$/.test(realm || "") ||
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.length < 32 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(windowMs) ||
    windowMs < 1000
  )
    fail("RATE_CONFIGURATION_REQUIRED");
  return async (subject) => {
    if (typeof subject !== "string" || !subject || subject.length > 512)
      fail("RATE_SUBJECT_REQUIRED");
    const window = Math.floor(clock() / windowMs);
    const id = createHmac("sha256", hmacKey)
      .update(realm + ":" + window + ":" + subject)
      .digest("hex");
    const ref = db.collection("passport_v2_rate_limits").doc(realm + "-" + id);
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref),
        count = snap.exists ? snap.data().count : 0;
      if (!Number.isSafeInteger(count) || count < 0) fail("RATE_STATE_INVALID");
      if (count >= limit) return false;
      tx.set(ref, {
        count: count + 1,
        realm,
        expiresAt: new Date((window + 2) * windowMs),
      });
      return true;
    });
    return allowed;
  };
}
