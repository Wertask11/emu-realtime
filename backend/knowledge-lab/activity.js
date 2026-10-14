"use strict";
const m = require("./model");
const KINDS = {
  "experience-posted": "経験知を届けた",
  "knowledge-answered": "知識募集に回答した",
  "research-created": "研究ノートを作った",
  "research-contributed": "研究に追記・改善した",
  "hypothesis-practiced": "仮説を試した（自己申告）",
  "practice-reported": "実践結果を報告した（自己申告）",
  "knowledge-improved": "他者の知識を改善した",
};
function createActivity({ db, ref, now = Date.now }) {
  // Preparing reads happens before existing quota/revision writes in the enclosing transaction.
  async function prepare(tx, a, events) {
    const countsRef = ref("activity_counts", a.spid);
    const counts = await tx.get(countsRef);
    const snapshots = await Promise.all(
      events.map((e) =>
        tx.get(ref("activity", m.hash([a.spid, e.kind, e.targetId]))),
      ),
    );
    return () => {
      const values = { ...(counts.data() || {}) };
      for (let i = 0; i < events.length; i++) {
        const e = events[i],
          s = snapshots[i];
        if (!KINDS[e.kind]) m.fail("INVALID_ACTIVITY");
        if (e.existingOnly && !s.exists) continue;
        if (!s.exists) values[e.kind] = (values[e.kind] || 0) + 1;
        tx.set(s.ref, {
          authorSchoolParkId: a.spid,
          kind: e.kind,
          targetId: m.id(e.targetId),
          createdAtMs: s.exists ? s.data().createdAtMs : now(),
          updatedAtMs: now(),
          visibility: e.visibility || "private",
        });
      }
      tx.set(countsRef, values);
    };
  }
  async function own(a, q = {}) {
    let query = db
      .collection("knowledge_lab_activity")
      .where("authorSchoolParkId", "==", a.spid)
      .orderBy("__name__")
      .limit(21);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const [s, counts] = await Promise.all([
      query.get(),
      ref("activity_counts", a.spid).get(),
    ]);
    return {
      schoolParkId: a.spid,
      counts: Object.fromEntries(
        Object.entries(KINDS).map(([kind, label]) => [
          kind,
          { label, count: counts.data()?.[kind] || 0 },
        ]),
      ),
      items: s.docs
        .slice(0, 20)
        .map((d) => ({ id: d.id, ...d.data(), label: KINDS[d.data().kind] })),
      next: s.size > 20 ? s.docs[19].id : null,
      definition:
        "Passportごと・活動種別ごと・元データごとに1件。非公開を含む本人専用の活動履歴。保管後も過去の活動は残します。EMUER・NFTの付与はありません。",
    };
  }
  return { prepare, own };
}
module.exports = { createActivity, KINDS };
