"use strict";
const m = require("./model");
function createTaxonomyMigration({ db, service, now = Date.now }) {
  async function mapping(input) {
    const job = m.id(input.job),
      terms = await service.taxonomy();
    if (!terms.some((t) => t.id === job && t.axis === "job"))
      m.fail("LEGACY_JOB_REQUIRED");
    const value = await service.validateFacets({
      industry: input.industry,
      occupation: input.occupation,
    });
    if (!value.industry.length && !value.occupation.length)
      m.fail("MIGRATION_MAPPING_REQUIRED");
    return { job, industry: value.industry, occupation: value.occupation };
  }
  async function preview(a, input) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    const map = await mapping(input);
    let query = db.collection("posts").orderBy("__name__").limit(25);
    if (input.cursor) query = query.startAfter(m.id(input.cursor));
    const s = await query.get();
    return {
      mapping: map,
      items: s.docs
        .filter(
          (d) =>
            m.publicPost(d.data()) && m.facets(d.data()).job.includes(map.job),
        )
        .map((d) => ({
          id: d.id,
          title: String(d.data().title || ""),
          revision: d.data().knowledgeLab?.revision || 0,
          facets: m.facets(d.data()),
        })),
      next: s.size === 25 ? s.docs.at(-1).id : null,
      scanned: s.size,
    };
  }
  async function apply(a, input) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    if (input.confirmed !== true)
      m.fail("MIGRATION_CONFIRMATION_REQUIRED", 403);
    const map = await mapping(input),
      reason = m.text(input.reason, 500, true);
    if (!Array.isArray(input.posts) || input.posts.length > 25)
      m.fail("INVALID_MIGRATION_BATCH");
    const items = [];
    for (const entry of input.posts) {
      const id = m.id(entry.id);
      const result = await db.runTransaction(async (tx) => {
        const r = db.collection("posts").doc(id),
          s = await tx.get(r);
        if (!s.exists || !m.publicPost(s.data()))
          return { id, status: "unavailable" };
        const p = s.data(),
          facets = m.facets(p),
          revision = p.knowledgeLab?.revision || 0;
        if (!facets.job.includes(map.job))
          return { id, status: "legacy-term-absent" };
        if (
          map.industry.every((t) => facets.industry.includes(t)) &&
          map.occupation.every((t) => facets.occupation.includes(t))
        )
          return { id, status: "already-applied", revision };
        if (entry.revision !== revision) m.fail("REVISION_CONFLICT", 409);
        const nextFacets = {
          ...facets,
          industry: [...new Set([...facets.industry, ...map.industry])],
          occupation: [...new Set([...facets.occupation, ...map.occupation])],
        };
        const value = {
          ...p,
          knowledgeLab: {
            ...p.knowledgeLab,
            facets: nextFacets,
            revision: revision + 1,
            classificationSource: "operator",
            quality:
              p.knowledgeLab?.quality ||
              "投稿者の知識・分類は運営が付与（内容未検証）",
          },
        };
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
        tx.create(db.collection("knowledge_lab_audit").doc(), {
          kind: "legacy-job-classification",
          targetId: id,
          actorSchoolParkId: a.spid,
          mapping: map,
          reason,
          atMs: now(),
        });
        return { id, status: "applied", revision: revision + 1 };
      });
      items.push(result);
    }
    service.invalidate();
    return { items };
  }
  return { preview, apply };
}
module.exports = { createTaxonomyMigration };
