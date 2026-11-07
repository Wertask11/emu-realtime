"use strict";
const { containsSensitiveText } = require("../../knowledge-lab/gemini");
const { hash, fail } = require("../config");
const targets = require("../../../frontend/public/economy/targets");
const ID = /^[A-Za-z0-9_-]{1,100}$/;
function text(value, max = 400) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    containsSensitiveText(value) ||
    /Bearer\s|SP-[A-Z0-9-]{16,}|\beyJ[A-Za-z0-9_-]{15,}\.|\b\d{12}\b|〒?\d{3}-\d{4}/i.test(
      value,
    )
  )
    return null;
  return value.trim();
}
function publicRow(p) {
  return (
    !!p &&
    !p.hidden &&
    !p.archived &&
    !p.draft &&
    p.private !== true &&
    p.isPublic !== false &&
    !p.deleted &&
    !p.withdrawn &&
    ![
      "draft",
      "private",
      "archived",
      "withdrawn",
      "deleted",
      "cancelled",
    ].includes(String(p.status || "").toLowerCase()) &&
    (!Object.hasOwn(p, "visibility") ||
      p.visibility === null ||
      p.visibility === "public")
  );
}
function millis(v) {
  if (v && typeof v.toMillis === "function") v = v.toMillis();
  else if (v instanceof Date) v = v.getTime();
  else if (typeof v === "string") v = Date.parse(v);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
function row(domain, kind, id, title, summary, source = {}) {
  if (
    !ID.test(String(id)) ||
    !text(String(id), 100) ||
    !text(title, 160) ||
    !text(summary, 400)
  )
    return null;
  const target = targets.target(kind, id);
  if (!target) return null;
  return {
    key: kind + ":" + id,
    domain,
    kind,
    id,
    title: title.trim(),
    summary: summary.trim(),
    target,
    publicURL: "https://schoolpark-emu.vercel.app" + target,
    updatedAtMs: millis(
      source.updatedAtMs || source.updatedAt || source.createdAt,
    ),
    sourceVersion: hash([title.trim(), summary.trim()]),
    relevance: 0,
    permission: {
      public: true,
      readAllowed: true,
      authorAIConsent: source.authorAIConsent === true,
      operatorReviewed: false,
    },
    facts: source.facts || {},
    origin: source.origin || domain,
    originHash: source.originHash || null,
  };
}
function assertRow(s) {
  if (
    !s ||
    !ID.test(s.id) ||
    s.key !== s.kind + ":" + s.id ||
    targets.target(s.kind, s.id) !== s.target ||
    !text(s.title, 160) ||
    !text(s.summary, 400) ||
    s.permission?.public !== true ||
    s.permission?.readAllowed !== true ||
    s.permission?.authorAIConsent !== true ||
    s.permission?.operatorReviewed !== true
  )
    fail("SEARCH_SOURCE_UNVERIFIED", 409);
  return s;
}
module.exports = { ID, text, publicRow, millis, row, assertRow };
