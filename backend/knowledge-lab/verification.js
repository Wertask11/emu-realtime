"use strict";
const m = require("./model");
function createVerification({ db, service, identity, now = Date.now }) {
  async function confirm(a, id, input) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    m.id(id);
    if (input.reviewed !== true) m.fail("REVIEW_CONFIRMATION_REQUIRED", 403);
    const summary = m.text(input.summary, 1000, true),
      evidence = m.text(input.evidence, 1500, true);
    if (evidence.length < 20) m.fail("REVIEW_EVIDENCE_REQUIRED");
    const result = await db.runTransaction(async (tx) => {
      const r = db.collection("posts").doc(id),
        s = await tx.get(r);
      if (!s.exists || !m.publicPost(s.data())) m.fail("NOT_FOUND", 404);
      const p = s.data();
      const author = await identity.knowledgeParticipant(
        p.address,
        p.authorSchoolParkId,
      );
      if (!author) m.fail("IDENTITY_REVIEW_REQUIRED", 409);
      if (author === a.spid) m.fail("SELF_VERIFICATION", 403);
      const revision = p.knowledgeLab?.revision || 0;
      if (revision !== input.revision) m.fail("REVISION_CONFLICT", 409);
      const recordId = id + "-" + (revision + 1),
        record = {
          postId: id,
          authorSchoolParkId: author,
          reviewerSchoolParkId: a.spid,
          summary,
          evidence,
          atMs: now(),
          confirmedRevision: revision + 1,
        };
      const value = {
        ...p,
        knowledgeLab: {
          ...p.knowledgeLab,
          revision: revision + 1,
          thirdPartyConfirmation: {
            recordId,
            summary,
            atMs: record.atMs,
            reviewerSchoolParkId: a.spid,
            confirmedRevision: revision + 1,
          },
        },
      };
      tx.create(service.ref("verification", recordId), record);
      tx.set(service.ref("history", id + "-" + revision), {
        postId: id,
        previous: p,
        next: value,
        changedBy: a.spid,
        changedAtMs: now(),
      });
      tx.set(r, value);
      service.queueSemantic(tx, id, value);
      tx.set(service.ref("search", id), m.indexPost(id, value, now()), {
        merge: true,
      });
      return {
        id,
        revision: revision + 1,
        confirmation: value.knowledgeLab.thirdPartyConfirmation,
      };
    });
    service.invalidate();
    return result;
  }
  async function records(a, id) {
    const p = await service.rawPost(m.id(id), a);
    if (!m.owner(p, a) && !a.owner) m.fail("NOT_OWNER", 403);
    const s = await db
      .collection("knowledge_lab_verification")
      .where("postId", "==", id)
      .orderBy("__name__")
      .limit(21)
      .get();
    return {
      items: s.docs.slice(0, 20).map((d) => ({ id: d.id, ...d.data() })),
      next: s.size > 20 ? s.docs[19].id : null,
    };
  }
  return { confirm, records };
}
module.exports = { createVerification };
