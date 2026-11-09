"use strict";
// Manual, private practice only. This module has no payment or model dependency.
const { hash, fail } = require("./config");
const { TASKS } = require("./tasks");
const DAY = 86400000;
const STATES = ["not_started", "in_progress", "done", "on_hold"];
const OBSERVATIONS = [
  "actions",
  "method",
  "result",
  "failures",
  "insights",
  "next",
];
const REFLECTIONS = [
  "goal",
  "actual",
  "success",
  "failure",
  "learning",
  "next",
];
const settings = (env) => ({
  enabled: env.ECONOMY_PHASE4_ENABLED === "true",
  additionalPrice: 0,
  retentionDays: 30,
  additionalGenerationEnabled: false,
});
function text(value, max = 3000) {
  if (typeof value !== "string" || value.length > max || /\u0000/.test(value))
    fail("INVALID_INPUT", 400);
  return value.trim();
}
function fields(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail("INVALID_INPUT", 400);
  return Object.fromEntries(keys.map((k) => [k, text(value[k] ?? "")]));
}
function draft(s) {
  // Only the owner's explicitly entered facts. Never turn source/AI suggestions into experience.
  const r = s.reflections,
    o = s.observations,
    missing = [];
  const part = (name, value) => {
    if (!value) missing.push(name);
    return value || "［未記入］";
  };
  return {
    title: s.postTitle || "実践して学んだこと",
    content: [
      "# " + (s.postTitle || "実践して学んだこと"),
      "## 目指したこと\n" + part("目標", r.goal),
      "## 実際に行ったこと\n" + part("実践内容", o.actions || r.actual),
      "## 方法・手順\n" + part("方法", o.method),
      "## 結果\n" + part("結果", o.result),
      "## うまくいったこと\n" + part("うまくいったこと", r.success),
      "## 失敗・注意点\n" + part("失敗・注意点", o.failures || r.failure),
      "## 学んだこと\n" + part("学び", r.learning || o.insights),
      "## 次に試すこと\n" + part("次の行動", r.next || o.next),
      "## 次の人へのアドバイス\n" + part("アドバイス", s.advice),
    ].join("\n\n"),
    missing,
  };
}
function createPractice({ db, ref, artifacts, requireAccess, env, now }) {
  const verifyArtifact = artifacts.viewAfterQualification || artifacts.view;
  const index = (uid) =>
    db
      .collection("emuer_v2_agent_practice_owners")
      .doc(hash(uid))
      .collection("items");
  async function access(a) {
    if (!settings(env).enabled) fail("PRACTICE_DISABLED", 503);
    await requireAccess(a);
  }
  async function owned(a, id) {
    if (!/^[a-f0-9]{40}$/.test(String(id))) fail("PRACTICE_NOT_FOUND", 404);
    const s = (await ref("practice", id).get()).data();
    if (!s || s.ownerUid !== a.uid || s.spid !== a.spid)
      fail("PRACTICE_NOT_FOUND", 404);
    if (s.deleteAfterMs <= now()) fail("PRACTICE_EXPIRED", 410);
    return s;
  }
  const progress = (items) => ({
    done: items.filter((x) => x.state === "done").length,
    total: items.length,
  });
  async function original(a, id) {
    try {
      return await verifyArtifact(a, id);
    } catch (e) {
      if (["ARTIFACT_NOT_FOUND", "ARTIFACT_NOT_READY"].includes(e.message))
        return { content: null, references: [] };
      throw e;
    }
  }
  async function present(a, id, s, source = null) {
    // The source is revalidated, never snapshotted as the owner's experience.
    const sourceView = source || (await original(a, s.sourceArtifactId));
    const available = !!sourceView.content;
    const labels = new Map(
      (sourceView.document?.checklist || []).map((c) => [c.id, c.text]),
    );
    const { ownerUid, spid, lastMutation, ...publicValue } = s;
    return {
      ...publicValue,
      id,
      sourceAvailable: available,
      checklistItems: s.checklistItems.map((c) => ({
        ...c,
        text: c.manual
          ? c.manual
          : available
            ? labels.get(c.id) || "元の計画で確認"
            : "元資料の許諾・期限を確認できません",
      })),
      sourceTitle: available
        ? sourceView.title
        : "元の計画は現在利用できません",
      references: available ? sourceView.references : [],
      postingDraft: draft(s),
      missingReflection: REFLECTIONS.filter((k) => !s.reflections[k]),
      notice:
        "本人専用・追加料金なし。記録は開始から30日間。外部モデルには送りません。公開は投稿画面で本人が行います。",
    };
  }
  async function start(a, b) {
    await access(a);
    if (
      !b ||
      Object.keys(b).some(
        (k) => !["sourceArtifactId", "manualItems"].includes(k),
      )
    )
      fail("INVALID_INPUT", 400);
    const source = await verifyArtifact(a, b.sourceArtifactId);
    if (!source.content) fail("ARTIFACT_REFERENCES_UNAVAILABLE", 409);
    const id = hash([a.uid, a.spid, b.sourceArtifactId]).slice(0, 40);
    let items = (source.document?.checklist || []).map((c) => ({ id: c.id }));
    if (!items.length) {
      if (
        !Array.isArray(b.manualItems) ||
        !b.manualItems.length ||
        b.manualItems.length > 20
      )
        fail("PRACTICE_MANUAL_ITEMS_REQUIRED", 400);
      items = b.manualItems.map((v, i) => ({
        id: "manual-" + (i + 1),
        manual: text(v, 300),
      }));
      if (items.some((x) => !x.manual)) fail("INVALID_INPUT", 400);
    } else if (b.manualItems?.length) fail("INVALID_INPUT", 400);
    let value;
    await db.runTransaction(async (tx) => {
      const target = ref("practice", id),
        existing = (await tx.get(target)).data();
      if (existing) {
        if (existing.ownerUid !== a.uid || existing.spid !== a.spid)
          fail("PRACTICE_NOT_FOUND", 404);
        if (existing.deleteAfterMs <= now()) fail("PRACTICE_EXPIRED", 410);
        value = existing;
        return;
      }
      const t = now();
      value = {
        ownerUid: a.uid,
        spid: a.spid,
        sourceArtifactId: source.id,
        sessionId: id,
        artifactType: source.artifactType,
        status: "active",
        checklistItems: items.map((c) => ({
          ...c,
          state: "not_started",
          note: "",
          performedAt: null,
          updatedAt: t,
        })),
        progress: { done: 0, total: items.length },
        notes: "",
        observations: fields({}, OBSERVATIONS),
        reflections: fields({}, REFLECTIONS),
        postTitle: "",
        advice: "",
        postingChecks: [],
        createdAt: t,
        updatedAt: t,
        completedAt: null,
        deleteAfterMs: t + 30 * DAY,
        revision: 1,
        lastMutation: null,
      };
      tx.create(target, value);
      tx.create(index(a.uid).doc(id), {
        artifactType: source.artifactType,
        createdAt: t,
        deleteAfterMs: value.deleteAfterMs,
      });
    });
    return present(a, id, value, source);
  }
  async function view(a, id) {
    await access(a);
    return present(a, id, await owned(a, id));
  }
  async function list(a) {
    await access(a);
    const rows = await index(a.uid)
      .where("deleteAfterMs", ">", now())
      .limit(20)
      .get();
    return rows.docs.map((d) => ({
      id: d.id,
      label: TASKS[d.data().artifactType]?.label || "保存した実践",
      createdAt: d.data().createdAt,
      expiresAt: d.data().deleteAfterMs,
    }));
  }
  async function edit(a, id, b) {
    await access(a);
    const s = await owned(a, id);
    if (
      !b ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(b.requestId || "") ||
      !Number.isSafeInteger(b.revision) ||
      Object.keys(b).some(
        (k) =>
          ![
            "requestId",
            "revision",
            "status",
            "checklistItems",
            "notes",
            "observations",
            "reflections",
            "postTitle",
            "advice",
            "confirmIncomplete",
            "postingChecks",
          ].includes(k),
      )
    )
      fail("INVALID_INPUT", 400);
    const sourceView = await original(a, s.sourceArtifactId);
    const patch = {};
    if (Object.hasOwn(b, "postingChecks")) {
      if (
        !Array.isArray(b.postingChecks) ||
        b.postingChecks.length > 3 ||
        new Set(b.postingChecks).size !== b.postingChecks.length ||
        b.postingChecks.some(
          (x) => !["experience", "privacy", "rights"].includes(x),
        )
      )
        fail("INVALID_INPUT", 400);
      patch.postingChecks = b.postingChecks;
    }
    for (const key of ["notes", "advice", "postTitle"])
      if (Object.hasOwn(b, key))
        patch[key] = text(b[key], key === "postTitle" ? 100 : 3000);
    for (const [key, keys] of [
      ["observations", OBSERVATIONS],
      ["reflections", REFLECTIONS],
    ])
      if (Object.hasOwn(b, key)) patch[key] = fields(b[key], keys);
    if (Object.hasOwn(b, "checklistItems")) {
      if (
        !Array.isArray(b.checklistItems) ||
        b.checklistItems.some(
          (c) => !c || typeof c !== "object" || Array.isArray(c),
        ) ||
        b.checklistItems.length !== s.checklistItems.length ||
        new Set(b.checklistItems.map((c) => c.id)).size !==
          s.checklistItems.length
      )
        fail("INVALID_INPUT", 400);
      patch.checklistItems = s.checklistItems.map((c) => {
        const input = b.checklistItems.find((x) => x.id === c.id);
        if (
          !input ||
          Object.keys(input).some(
            (k) => !["id", "state", "note"].includes(k),
          ) ||
          !STATES.includes(input.state)
        )
          fail("INVALID_INPUT", 400);
        if (!sourceView.content && input.state !== c.state)
          fail("ARTIFACT_REFERENCES_UNAVAILABLE", 409);
        const note = text(input.note, 1000),
          changed = input.state !== c.state || note !== c.note;
        return {
          ...c,
          state: input.state,
          note,
          updatedAt: changed ? now() : c.updatedAt,
          performedAt:
            input.state === "done" && c.state !== "done"
              ? now()
              : c.performedAt,
        };
      });
      patch.progress = progress(patch.checklistItems);
    }
    if (Object.hasOwn(b, "status")) {
      const transitions = {
        active: ["active", "paused", "completed", "cancelled"],
        paused: ["paused", "active", "cancelled"],
        completed: ["completed"],
        cancelled: ["cancelled"],
      };
      if (!transitions[s.status]?.includes(b.status))
        fail("PRACTICE_INVALID_TRANSITION", 409);
      const p = patch.progress || s.progress;
      if (
        b.status === "completed" &&
        p.done !== p.total &&
        b.confirmIncomplete !== true
      )
        fail("PRACTICE_COMPLETION_CONFIRMATION_REQUIRED", 409);
      patch.status = b.status;
      if (b.status === "completed" && s.status !== "completed")
        patch.completedAt = now();
    }
    if (!Object.keys(patch).length) fail("INVALID_INPUT", 400);
    if (
      s.status === "completed" &&
      patch.progress &&
      patch.progress.done !== s.progress.done &&
      (patch.progress || s.progress).done !== s.progress.total &&
      b.confirmIncomplete !== true
    )
      fail("PRACTICE_COMPLETION_CONFIRMATION_REQUIRED", 409);
    const fingerprint = hash(b);
    let value;
    await db.runTransaction(async (tx) => {
      const target = ref("practice", id),
        current = (await tx.get(target)).data();
      if (!current || current.ownerUid !== a.uid || current.spid !== a.spid)
        fail("PRACTICE_NOT_FOUND", 404);
      if (current.deleteAfterMs <= now()) fail("PRACTICE_EXPIRED", 410);
      if (current.lastMutation?.id === b.requestId) {
        if (current.lastMutation.fingerprint !== fingerprint)
          fail("PRACTICE_REQUEST_CONFLICT", 409);
        value = current;
        return;
      }
      if (current.revision !== b.revision)
        fail("PRACTICE_VERSION_CONFLICT", 409);
      value = {
        ...current,
        ...patch,
        revision: current.revision + 1,
        updatedAt: now(),
        lastMutation: { id: b.requestId, fingerprint },
      };
      tx.set(target, value);
    });
    return present(a, id, value, sourceView);
  }
  async function purge() {
    // Runs with the existing hourly cleanup: one indexed empty query/hour, no new polling.
    const rows = await db
      .collection("emuer_v2_agent_practice")
      .where("deleteAfterMs", "<=", now())
      .limit(100)
      .get();
    for (const d of rows.docs)
      await db.runTransaction(async (tx) => {
        const v = (await tx.get(d.ref)).data();
        if (!v || v.deleteAfterMs > now()) return;
        tx.delete(d.ref);
        tx.delete(index(v.ownerUid).doc(d.id));
      });
  }
  return { start, view, list, edit, purge };
}
module.exports = { createPractice, settings, draft, OBSERVATIONS, REFLECTIONS };
