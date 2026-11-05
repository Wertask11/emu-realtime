import { fail } from "./crypto.mjs";
export function trustRegistry({
  issuers,
  verifiers,
  readControl,
  audit,
  clock = Date.now,
}) {
  const trustedIssuers = structuredClone(issuers),
    trustedVerifiers = structuredClone(verifiers);
  async function current() {
    const state = await readControl();
    if (
      !state ||
      state.emergencyStop !== false ||
      !Array.isArray(state.compromisedKeyIds) ||
      state.compromisedKeyIds.some((id) => typeof id !== "string")
    )
      fail("PASSPORT_EMERGENCY_STOP");
    return state;
  }
  async function key(id) {
    const state = await current();
    const entry = trustedIssuers
      .flatMap((i) => i.keys.map((k) => ({ ...k, issuer: i.id })))
      .find((k) => k.publicKey.id === id);
    if (
      !entry ||
      state.compromisedKeyIds?.includes(id) ||
      !Number.isFinite(Date.parse(entry.validFrom)) ||
      !Number.isFinite(Date.parse(entry.validUntil)) ||
      Date.parse(entry.validFrom) > clock() ||
      Date.parse(entry.validUntil) <= clock()
    )
      fail("UNTRUSTED_ISSUER_KEY");
    return structuredClone(entry);
  }
  return {
    assertOperational: key,
    async publicKeys() {
      const keys = [];
      for (const i of trustedIssuers)
        for (const k of i.keys) {
          try {
            await key(k.publicKey.id);
            keys.push(k.publicKey);
          } catch (e) {
            if (e.code === "PASSPORT_EMERGENCY_STOP") throw e;
          }
        }
      return structuredClone(keys);
    },
    async verifier(id) {
      await current();
      const v = trustedVerifiers.find((v) => v.id === id);
      if (
        !v ||
        v.trusted !== true ||
        !(
          /^https:\/\//.test(v.clientId) ||
          v.clientId === "redirect_uri:" + v.responseUri
        ) ||
        !/^https:\/\//.test(v.responseUri) ||
        !v.legalName ||
        !v.retentionNotice
      )
        fail("UNTRUSTED_VERIFIER");
      return structuredClone(v);
    },
    async record(event) {
      if (
        ![
          "issuer_sign",
          "key_rotation",
          "key_compromise",
          "emergency_stop",
          "recovery",
        ].includes(event.event)
      )
        fail("INVALID_AUDIT_EVENT");
      await audit({
        event: event.event,
        keyId: event.keyId || "",
        outcome: event.outcome || "success",
      });
    },
  };
}
export function firestoreOperations(
  db,
  { clock = Date.now, auditDays = 90, realm = "" } = {},
) {
  return {
    async readControl() {
      const s = await db
        .collection("passport_v2_controls")
        .doc(realm ? realm + "-issuer" : "issuer")
        .get();
      return s.exists ? s.data() : null;
    },
    async audit(e) {
      if (
        Object.keys(e).some((k) => !["event", "keyId", "outcome"].includes(k))
      )
        fail("INVALID_AUDIT_EVENT");
      await db.collection("passport_v2_audit").add({
        ...e,
        realm,
        at: new Date(clock()),
        expiresAt: new Date(clock() + auditDays * 86400000),
      });
    },
    async cleanup({ limit = 100, dryRun = true } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        fail("INVALID_LIMIT");
      let removed = 0;
      for (const col of ["passport_v2_tickets", "passport_v2_audit", "passport_v2_rate_limits"]) {
        const snap = await db
          .collection(col)
          .where("realm", "==", realm)
          .where("expiresAt", "<=", new Date(clock()))
          .limit(limit)
          .get();
        if (!dryRun) {
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        removed += snap.size;
      }
      return { dryRun, records: removed };
    },
  };
}
