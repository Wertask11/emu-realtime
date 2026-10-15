"use strict";
const m = require("./model");

// Counts are derived from actual canonical-Passport bookmarks, never client inputs.
function createSavedMetrics({ db, ref, now = Date.now }) {
  const stateRef = () => ref("system", "save-counts-v2");
  async function status() {
    const s = await stateRef().get();
    return s.exists ? s.data() : { state: "not-started", processed: 0 };
  }
  async function updateCount(tx, postId, delta, snapshots) {
    const { metric, post } = snapshots;
    const count = Math.max(
      0,
      Number(metric.exists ? metric.data().savedCount || 0 : 0) + delta,
    );
    tx.set(
      ref("post_metrics", postId),
      { savedCount: count, updatedAtMs: now() },
      { merge: true },
    );
    if (post.exists) {
      // Re-read canonical publication state in the same transaction.
      tx.set(
        ref("search", postId),
        {
          ...m.indexPost(postId, post.data(), now()),
          savedCount: count,
        },
        { merge: true },
      );
    }
  }
  async function save(a, postId, on, cap = 1000) {
    m.id(postId);
    const savedRef = ref("saved", m.hash([a.spid, postId]));
    await db.runTransaction(async (tx) => {
      const [s, limits, metric, post] = await tx.getAll(
        savedRef, ref("limits", a.spid), ref("post_metrics", postId),
        db.collection("posts").doc(postId),
      );
      const count = Number(limits.exists ? limits.data().saved || 0 : 0);
      if (on && !s.exists) {
        if (count >= cap) m.fail("SAVED_LIMIT", 403);
        tx.set(savedRef, {
          authorSchoolParkId: a.spid,
          postId,
          createdAtMs: now(),
          metricsCounted: true,
        });
        tx.set(ref("limits", a.spid), { saved: count + 1 }, { merge: true });
        await updateCount(tx, postId, 1, { metric, post });
      } else if (on && s.exists && !s.data().metricsCounted) {
        tx.set(savedRef, { metricsCounted: true }, { merge: true });
        await updateCount(tx, postId, 1, { metric, post });
      } else if (!on && s.exists) {
        tx.delete(savedRef);
        tx.set(
          ref("limits", a.spid),
          { saved: Math.max(0, count - 1) },
          { merge: true },
        );
        if (s.data().metricsCounted)
          await updateCount(tx, postId, -1, { metric, post });
      }
    });
    return { ok: true };
  }
  async function migratePage(a) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    // Lease + per-record applied marker support retries and concurrent save/unsave.
    const lease = m.hash([a.spid, now(), Math.random()]);
    const previous = await db.runTransaction(async (tx) => {
      const s = await tx.get(stateRef()),
        p = s.exists ? s.data() : {};
      if (p.state === "ready") return p;
      if (p.leaseUntil > now()) m.fail("MIGRATION_BUSY", 409);
      tx.set(stateRef(), {
        ...p,
        state: "building",
        lease,
        leaseUntil: now() + 120000,
      });
      return p;
    });
    if (previous.state === "ready") return previous;
    try {
      let q = db
        .collection(ref("saved", "placeholder").parent.id)
        .orderBy("__name__")
        .limit(100);
      if (previous.cursor) q = q.startAfter(previous.cursor);
      const page = await q.get();
      for (const doc of page.docs) {
        await db.runTransaction(async (tx) => {
          const s = await tx.get(doc.ref);
          if (!s.exists || s.data().metricsCounted) return;
          const postId = m.id(s.data().postId);
          const [metric, post] = await tx.getAll(
            ref("post_metrics", postId), db.collection("posts").doc(postId),
          );
          tx.set(doc.ref, { metricsCounted: true }, { merge: true });
          await updateCount(tx, postId, 1, { metric, post });
        });
      }
      const result = {
        state: page.size < 100 ? "ready" : "building",
        cursor: page.docs.at(-1)?.id || previous.cursor || null,
        processed: (previous.processed || 0) + page.size,
        leaseUntil: 0,
        lease: null,
        updatedAtMs: now(),
      };
      await db.runTransaction(async (tx) => {
        const s = await tx.get(stateRef());
        if (s.data()?.lease !== lease) m.fail("MIGRATION_CHANGED", 409);
        tx.set(stateRef(), result);
      });
      return result;
    } catch (e) {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(stateRef());
        if (s.data()?.lease === lease)
          tx.set(stateRef(), { leaseUntil: 0, lease: null }, { merge: true });
      });
      throw e;
    }
  }
  return { save, status, migratePage };
}
module.exports = { createSavedMetrics };
