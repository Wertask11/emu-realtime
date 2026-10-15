"use strict";
const crypto = require("node:crypto");
const { AXES, PUBLIC_AXES } = require("./taxonomy");
function fail(code, status = 400) {
  const e = new Error(code);
  e.status = status;
  throw e;
}
function text(v, max, required = false) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail("INVALID_TEXT");
  return v.trim();
}
function id(v) {
  if (
    typeof v !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(v) ||
    v === "security-probe"
  )
    fail("INVALID_ID");
  return v;
}
function list(v, max = 12) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) fail("INVALID_LIST");
  return [...new Set(v.map(id))];
}
function normalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function hash(v) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(v))
    .digest("hex")
    .slice(0, 24);
}
function millis(v) {
  return v?.toMillis
    ? v.toMillis()
    : v?.toDate
      ? +v.toDate()
      : Number.isFinite(v)
        ? v
        : Date.parse(v) || 0;
}
function owner(p, actor) {
  if (!p || !actor) return false;
  if (p.authorSchoolParkId) return p.authorSchoolParkId === actor.spid;
  return [p.address, p.owner, p.author].some(
    (a) =>
      a &&
      [actor.walletAddress, actor.account?.chesAddress]
        .map((v) => String(v || "").toLowerCase())
        .includes(String(a).toLowerCase()),
  );
}
function publicPost(p) {
  // Legacy posts without a visibility field are already public. Never index an explicit private value.
  return (
    !!p &&
    (!p.visibility || p.visibility === "public") &&
    !p.knowledgeLab?.hidden
  );
}
function tombstone(p, revision, at = Date.now()) {
  // Keep earned reaction/Quest history, remove all content and private experience metadata.
  const out = {
    title: "公開を取り下げた知識",
    body: "",
    tags: "",
    imageUrl: "",
    visibility: "withdrawn",
    updatedAt: new Date(at),
    knowledgeLab: {
      revision,
      publishedOnce: true,
      tombstone: true,
      hidden: true,
    },
  };
  for (const key of [
    "address",
    "userId",
    "userType",
    "displayName",
    "authorSchoolParkId",
    "createdAt",
    "goodCount",
    "changeCount",
    "goodUsers",
    "changeUsers",
    "acceptedChangeCount",
    "lastChangedAt",
    "questId",
    "scheduledPostId",
  ])
    if (p[key] !== undefined) out[key] = p[key];
  return out;
}
function facets(p) {
  const source = p.knowledgeLab?.facets || p.facets || {};
  return Object.fromEntries(AXES.map((a) => [a, list(source[a])]));
}
function indexPost(postId, p, now = Date.now()) {
  const content = normalize(
    [
      p.title,
      p.body,
      ...(Array.isArray(p.tags) ? p.tags : [p.tags || ""]),
      ...["period", "happened", "learned", "advice", "sources"].map(
        (k) => p.knowledgeLab?.[k] || "",
      ),
    ].join(" "),
  );
  if (Buffer.byteLength(content) > 65536) fail("INDEX_CONTENT_TOO_LARGE", 503);
  return {
    postId,
    text: content,
    title: normalize(p.title),
    facets: facets(p),
    authorSchoolParkId: p.authorSchoolParkId || null,
    createdAtMs: millis(p.createdAt),
    updatedAtMs: millis(p.updatedAt || p.createdAt),
    indexedAtMs: now,
    active: publicPost(p),
    goodCount: Math.max(0, Number(p.goodCount) || 0),
  };
}
function searchParams(q) {
  const value = {
    q: normalize(String(q.q || "").slice(0, 120)),
    mode: q.mode === "semantic" ? "semantic" : "lexical",
    sort: ["new", "updated", "relevance", "popular", "saved"].includes(q.sort)
      ? q.sort
      : "new",
    match: q.match === "exact" ? "exact" : "partial",
    keywordOp: q.keywordOp === "or" ? "or" : "and",
    facetOp: q.facetOp === "or" ? "or" : "and",
    withinAxis: q.withinAxis === "and" ? "and" : "or",
    exclude: normalize(String(q.exclude || "").slice(0, 120)),
  };
  for (const a of AXES) {
    value[a] = list(q[a] ? String(q[a]).split(",") : []);
    value["exclude_" + a] = list(
      q["exclude_" + a] ? String(q["exclude_" + a]).split(",") : [],
    );
  }
  value.author = q.author ? id(q.author) : null;
  return value;
}
function keywordTerms(value) {
  return [...normalize(value).matchAll(/"([^"]+)"|(\S+)/g)]
    .map((m) => m[1] || m[2])
    .filter(Boolean)
    .slice(0, 16);
}
function includesKeyword(content, word, exact = false) {
  if (!word) return true;
  if (!exact) return content.includes(word);
  let at = content.indexOf(word);
  if (at < 0) return false;
  // Real Japanese word boundaries, including contiguous quoted phrases.
  const boundaries = new Set([0, content.length]);
  for (const part of new Intl.Segmenter("ja", { granularity: "word" }).segment(
    content,
  )) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  while (at >= 0) {
    if (boundaries.has(at) && boundaries.has(at + word.length)) return true;
    at = content.indexOf(word, at + 1);
  }
  return false;
}
function select(rows, query, taxonomy) {
  const aliases = new Map(
    taxonomy.filter((t) => t.mergedInto).map((t) => [t.id, t.mergedInto]),
  );
  function canonical(value) {
    const seen = new Set();
    while (aliases.has(value) && !seen.has(value)) {
      seen.add(value);
      value = aliases.get(value);
    }
    return value;
  }
  const words = keywordTerms(query.q),
    excluded = keywordTerms(query.exclude);
  const exact = query.match === "exact";
  const terms = new Map(taxonomy.map((t) => [t.id, t]));
  const matched = [];
  for (const row of rows) {
    const classificationText = Object.values(row.facets || {})
      .flat()
      .map((id) => terms.get(canonical(id)))
      .filter(Boolean)
      .flatMap((term) => [term.label, ...(term.aliases || [])])
      .join(" ");
    const content = normalize([row.text, classificationText].join(" "));
    const wordMatches = words.map((w) => includesKeyword(content, w, exact));
    if (
      !row.active ||
      (query.author && row.authorSchoolParkId !== query.author) ||
      (wordMatches.length &&
        !(query.keywordOp === "or"
          ? wordMatches.some(Boolean)
          : wordMatches.every(Boolean))) ||
      excluded.some((w) => includesKeyword(content, w, exact))
    )
      continue;
    const axisMatches = AXES.filter((axis) => query[axis]?.length).map(
      (axis) => {
        const checks = query[axis].map((v) =>
          (row.facets[axis] || []).some((f) => canonical(f) === canonical(v)),
        );
        return query.withinAxis === "and"
          ? checks.every(Boolean)
          : checks.some(Boolean);
      },
    );
    if (
      (axisMatches.length &&
        !(query.facetOp === "or"
          ? axisMatches.some(Boolean)
          : axisMatches.every(Boolean))) ||
      AXES.some((axis) =>
        (query["exclude_" + axis] || []).some((v) =>
          (row.facets[axis] || []).some((f) => canonical(f) === canonical(v)),
        ),
      )
    )
      continue;
    matched.push({
      ...row,
      score: words.reduce(
        (n, w) =>
          n +
          (includesKeyword(normalize(row.title), w, exact)
            ? 5
            : includesKeyword(content, w, exact)
              ? 1
              : 0),
        0,
      ),
    });
  }
  matched.sort(
    (a, b) =>
      (query.sort === "relevance"
        ? b.score - a.score
        : query.sort === "popular"
          ? (b.goodCount || 0) - (a.goodCount || 0)
          : query.sort === "saved"
            ? (b.savedCount || 0) - (a.savedCount || 0)
            : 0) ||
      (query.sort === "updated"
        ? b.updatedAtMs - a.updatedAtMs
        : b.createdAtMs - a.createdAtMs) ||
      a.postId.localeCompare(b.postId),
  );
  return matched;
}
function cursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function parseCursor(value) {
  try {
    if (typeof value !== "string" || value.length > 512) fail("INVALID_CURSOR");
    return JSON.parse(Buffer.from(value, "base64url"));
  } catch (_) {
    fail("INVALID_CURSOR");
  }
}
function safePost(postId, p, actor) {
  return {
    id: postId,
    title: String(p.title || ""),
    body: String(p.body || ""),
    tags: p.tags || [],
    displayName: String(p.displayName || "Emuer"),
    authorSchoolParkId: p.authorSchoolParkId || null,
    createdAt: millis(p.createdAt),
    updatedAt: millis(p.updatedAt || p.createdAt),
    knowledgeLab: p.knowledgeLab || null,
    facets: facets(p),
    goodCount: Number(p.goodCount || 0),
    changeCount: Number(p.changeCount || 0),
    visibility: p.visibility || "public",
    revision: p.knowledgeLab?.revision || 0,
    editable: owner(p, actor),
  };
}
module.exports = {
  AXES,
  PUBLIC_AXES,
  fail,
  text,
  id,
  list,
  normalize,
  hash,
  millis,
  owner,
  publicPost,
  tombstone,
  facets,
  indexPost,
  searchParams,
  keywordTerms,
  includesKeyword,
  select,
  cursor,
  parseCursor,
  safePost,
};
