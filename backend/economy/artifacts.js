"use strict";
const { hash, fail } = require("./config");
const { TASKS } = require("./tasks");
function createArtifacts({ db, ref, sources, payments, now }) {
  const index = (uid) =>
    db
      .collection("emuer_v2_agent_artifact_owners")
      .doc(hash(uid))
      .collection("items");
  function record(jobId, j, artifact) {
    if (!TASKS[artifact?.artifactType] || !artifact.references?.length)
      fail("ARTIFACT_INVALID_OUTPUT", 502);
    return {
      ownerUid: j.uid,
      spid: j.spid,
      jobId,
      artifactType: artifact.artifactType,
      title: artifact.title,
      content: artifact.content,
      references: artifact.references,
      sections: artifact.sections,
      createdAt: now(),
      updatedAt: now(),
      status: "draft",
      revision: 1,
      deleteAfterMs: j.createdAtMs + 30 * 86400000,
      searchProfile: j.searchProfile,
      contextPermissions: j.contextPermissions,
    };
  }
  function save(tx, id, value) {
    tx.create(ref("artifacts", id), value);
    // Owner-scoped, single-field indexed listing; no scan across users or per-row citation reads.
    tx.create(index(value.ownerUid).doc(id), {
      artifactType: value.artifactType,
      createdAt: value.createdAt,
      jobId: value.jobId,
    });
  }
  async function owned(a, id) {
    if (!/^[a-f0-9]{40}$/.test(String(id))) fail("ARTIFACT_NOT_FOUND", 404);
    const v = (await ref("artifacts", id).get()).data();
    if (!v || v.ownerUid !== a.uid || v.spid !== a.spid)
      fail("ARTIFACT_NOT_FOUND", 404);
    return v;
  }
  async function checked(a, id) {
    const v = await owned(a, id);
    const j = (await ref("jobs", v.jobId).get()).data();
    if (
      !j ||
      j.uid !== a.uid ||
      j.spid !== a.spid ||
      j.artifactId !== id ||
      j.state !== "completed"
    )
      fail("ARTIFACT_NOT_READY", 409);
    const order = await payments.get(j.orderId);
    if (order?.status !== "fulfilled") fail("ARTIFACT_NOT_READY", 409);
    if (v.status === "expired" || v.deleteAfterMs <= now())
      return { v, valid: false, status: "expired", references: [] };
    const current =
      sources.cross &&
      (await sources.cross.current(
        a,
        v.references,
        v.searchProfile,
        v.contextPermissions,
        { history: true, checkPrivate: false },
      ));
    const refs = (current?.sources || []).filter(
      (s) =>
        s.permission.artifactUseApproved === true &&
        s.permission.artifactAllowedTasks.includes(v.artifactType),
    );
    const valid = refs.length === v.references.length && refs.length > 0;
    return {
      v,
      valid,
      status: valid ? v.status : "references_unavailable",
      references: refs,
    };
  }
  async function view(a, id) {
    const c = await checked(a, id),
      v = c.v;
    return {
      id,
      jobId: v.jobId,
      artifactType: v.artifactType,
      title: c.valid ? v.title : TASKS[v.artifactType].label,
      content: c.valid ? v.content : null,
      status: c.status,
      revision: v.revision,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      expiresAt: v.deleteAfterMs,
      references: c.references.map((s) => ({
        kind: s.kind,
        id: s.id,
        title: s.title,
        evidence: s.summary,
        target: s.target,
      })),
      notice: c.valid
        ? "AIの提案・記入用下書きです。内容を確認してからコピー・編集し、公開は既存画面で別途行ってください。"
        : "期限・公開状態・許諾・資料内容が変わったため、成果物本文を表示していません。",
    };
  }
  async function list(a) {
    const rows = await index(a.uid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();
    return rows.docs.map((d) => ({
      id: d.id,
      jobId: d.data().jobId,
      artifactType: d.data().artifactType,
      title: TASKS[d.data().artifactType]?.label || "保存済み成果物",
      createdAt: d.data().createdAt,
    }));
  }
  async function edit(a, id, b) {
    if (b?.editConsent !== true) fail("ARTIFACT_EDIT_CONSENT_REQUIRED", 400);
    if (
      Object.keys(b).some(
        (k) => !["editConsent", "revision", "title", "content"].includes(k),
      )
    )
      fail("INVALID_INPUT", 400);
    const { safeText } = require("./agent");
    const title = safeText(b.title, 100),
      content = safeText(b.content, 12000);
    if (!Number.isSafeInteger(b.revision))
      fail("ARTIFACT_VERSION_CONFLICT", 409);
    const c = await checked(a, id);
    if (!c.valid) fail("ARTIFACT_REFERENCES_UNAVAILABLE", 409);
    await db.runTransaction(async (tx) => {
      const r = ref("artifacts", id),
        snap = await tx.get(r),
        v = snap.data();
      if (!v || v.ownerUid !== a.uid || v.spid !== a.spid)
        fail("ARTIFACT_NOT_FOUND", 404);
      if (v.revision !== b.revision || v.deleteAfterMs <= now())
        fail("ARTIFACT_VERSION_CONFLICT", 409);
      tx.set(
        r,
        {
          title,
          content,
          revision: v.revision + 1,
          status: "edited",
          updatedAt: now(),
        },
        { merge: true },
      );
    });
    return view(a, id);
  }
  function expire(tx, id, uid) {
    tx.set(
      ref("artifacts", id),
      {
        title: null,
        content: null,
        sections: null,
        references: [],
        status: "expired",
        updatedAt: now(),
      },
      { merge: true },
    );
    tx.delete(index(uid).doc(id));
  }
  return { record, save, view, list, edit, expire };
}
module.exports = { createArtifacts };
