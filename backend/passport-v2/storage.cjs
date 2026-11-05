const { createHash } = require("node:crypto");
const ownerKey = (spid) =>
  createHash("sha256")
    .update("passport-v2-owner:" + spid)
    .digest("hex");
// One transaction serializes account changes, consent consumption and status updates.
function firestoreStore(db, { realm = "" } = {}) {
  if (realm && !/^[a-f0-9]{64}$/.test(realm))
    throw Error("INVALID_STORAGE_REALM");
  const scoped = (id) => (realm ? realm + "-" + id : id);
  return {
    async run(owner, fn) {
      return db.runTransaction(async (tx) => {
        const ar = db
          .collection("passport_v2_accounts")
          .doc(scoped(ownerKey(owner)));
        const sr = db
          .collection("passport_v2_status")
          .doc(scoped("account-v1"));
        const [a, s] = await Promise.all([tx.get(ar), tx.get(sr)]);
        const account = a.exists
          ? a.data()
          : { credentials: [], history: [], requests: {}, grants: {} };
        const status = s.exists ? s.data() : { used: [], revoked: [] };
        const out = await fn(account, status);
        tx.set(ar, account);
        tx.set(sr, status);
        return out;
      });
    },
    async ticket(id, fn) {
      return db.runTransaction(async (tx) => {
        const ref = db.collection("passport_v2_tickets").doc(scoped(id)),
          snap = await tx.get(ref);
        const { next, result } = await fn(snap.exists ? snap.data() : null);
        if (next)
          tx.set(ref, { ...next, expiresAt: new Date(next.expires), realm });
        else tx.delete(ref);
        return result;
      });
    },
    async status() {
      const s = await db
        .collection("passport_v2_status")
        .doc(scoped("account-v1"))
        .get();
      return s.exists ? s.data() : { used: [], revoked: [] };
    },
  };
}
module.exports = { firestoreStore, ownerKey };
