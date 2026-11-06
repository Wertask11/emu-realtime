"use strict";
const model = require("../knowledge-lab/model");
const { safeText } = require("./agent");
const { hash, SERVICE } = require("./config");
const guilds = require("../../frontend/public/schoolpark/guild-store");
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const publicRow = (p) =>
  p &&
  !p.archived &&
  !p.draft &&
  p.private !== true &&
  p.isPublic !== false &&
  !["draft", "private", "archived", "withdrawn", "deleted"].includes(
    p.status,
  ) &&
  (!p.visibility || p.visibility === "public");
function createSources({ db, knowledge, now = Date.now }) {
  function row(kind, id, title, summary, target) {
    if (!ID.test(id)) return null;
    try {
      title = safeText(title, 160);
      summary = safeText(String(summary || title).slice(0, 400), 400);
    } catch (_) {
      return null;
    }
    return { key: kind + ":" + id, kind, id, title, summary, target };
  }
  async function candidates(actor, goal) {
    const terms = Array.from(
      new Set(
        (
          goal
            .normalize("NFKC")
            .toLowerCase()
            .match(/[\p{L}\p{N}]{2,}/gu) || []
        ).flatMap((w) =>
          w.length > 3
            ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
            : [w],
        ),
      ),
    );
    const score = (content) =>
      terms.reduce(
        (n, t) => n + (String(content).toLowerCase().includes(t) ? 1 : 0),
        0,
      );
    const [catalog, plan, text, gs, qs, ps] = await Promise.all([
      knowledge.catalog(),
      knowledge.readerPlan(actor),
      db.collection("room1_contents").limit(60).get(),
      db.collection("sp_guilds").limit(60).get(),
      db.collection("sp_quests").limit(100).get(),
      db
        .collection("mitemiru_products")
        .where("status", "==", "live")
        .limit(100)
        .get(),
    ]);
    const out = [];
    const scope = catalog
      .filter((p) => p.active)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    const posts = (plan.guest ? scope.slice(0, 20) : scope)
      .map((p) => ({ ...p, score: score(p.text || p.title) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    for (const p of posts) {
      let raw;
      try {
        raw = await knowledge.rawPost(p.postId, actor);
      } catch (e) {
        if (["NOT_FOUND", "READER_PLAN_REQUIRED"].includes(e.message)) continue;
        throw e;
      }
      if (
        !model.publicPost(raw) ||
        raw.knowledgeLab?.aiUseConsent?.allowed !== true
      )
        continue;
      out.push(
        row(
          Number.isInteger(raw.knowledgeLab?.revision)
            ? "knowledge_lab"
            : "knowledge",
          p.postId,
          raw.title,
          raw.body,
          "/?lab=library&labPost=" + encodeURIComponent(p.postId),
        ),
      );
    }
    for (const d of text.docs) {
      const p = d.data();
      if (publicRow(p))
        out.push(
          row(
            "knowledge_text",
            d.id,
            p.title,
            p.summary || p.title,
            "/admin/room1/index.html?contentId=" + encodeURIComponent(d.id),
          ),
        );
    }
    const hiddenGuilds = new Set(
      gs.docs.filter((d) => !publicRow(d.data())).map((d) => d.id),
    );
    for (const p of guilds
      .merge(
        gs.docs
          .filter((d) => publicRow(d.data()))
          .map((d) => ({ ...d.data(), id: d.id })),
      )
      .filter((g) => !hiddenGuilds.has(g.id)))
      out.push(
        row(
          "guild",
          p.id,
          p.name,
          p.concept || p.body,
          "/schoolpark/dao.html?screen=experiments&explorerGuild=" +
            encodeURIComponent(p.id),
        ),
      );
    for (const d of qs.docs) {
      const p = d.data();
      if (publicRow(p) && ["OPEN", "RUNNING"].includes(p.status || "OPEN"))
        out.push(
          row(
            "quest",
            d.id,
            p.title,
            p.brief || p.given || p.title,
            "/schoolpark/dao.html?screen=experiments&explorerQuest=" +
              encodeURIComponent(d.id),
          ),
        );
    }
    for (const d of ps.docs) {
      const p = d.data();
      // Only the existing official catalog; a draft/nonexistent partner is not a real merchant.
      if (
        p.shopId === "schoolpark-official" &&
        publicRow(p) &&
        (!p.orderDeadlineMs || p.orderDeadlineMs > now()) &&
        (p.stock == null || p.stock > (p.sold || 0) + (p.reserved || 0))
      )
        out.push(
          row(
            "city_product",
            d.id,
            p.name,
            p.description || p.fulfillment,
            "/schoolpark/dao.html?screen=city&productId=" +
              encodeURIComponent(d.id),
          ),
        );
    }
    const approved = [];
    for (const s of out.filter(Boolean)) {
      if (!score(s.title + s.summary)) continue;
      const approval = (
        await db
          .collection("emuer_v2_agent_source_approvals")
          .doc(hash(s.key))
          .get()
      ).data();
      // A separate, server-owned review is required for this new AI purpose.
      // Exact content hash makes edits revoke the review automatically. No private identifiers go to AI.
      if (
        approval?.piiReviewed !== true ||
        approval.purpose !== SERVICE.termsVersion ||
        approval.contentHash !== hash([s.title, s.summary]) ||
        !(approval.validUntilMs > now())
      )
        continue;
      approved.push(s);
    }
    return approved
      .sort((a, b) => score(b.title + b.summary) - score(a.title + a.summary))
      .slice(0, 20);
  }
  async function revalidate(actor, goal, results) {
    // Reapply current plan, visibility, source consent, stock and existence before display.
    const current = new Map(
      (await candidates(actor, goal)).map((s) => [s.key, s]),
    );
    return results.flatMap((r) => {
      const s = current.get(r.kind + ":" + r.id);
      return s
        ? [{ ...r, title: s.title, evidence: s.summary, target: s.target }]
        : [];
    });
  }
  return { candidates, revalidate };
}
module.exports = { createSources };
