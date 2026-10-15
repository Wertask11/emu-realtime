"use strict";

// Stable schema axes; terms themselves live in the Owner-managed Firestore catalog.
const PUBLIC_AXES = Object.freeze([
  "field",
  "industry",
  "occupation",
  "genre",
  "experience",
  "purpose",
  "kind",
  "difficulty",
  "audience",
  "period",
]);
const AXES = Object.freeze([...PUBLIC_AXES, "job"]);
const LABELS = Object.freeze({
  field: "分野",
  industry: "業種",
  occupation: "職業",
  genre: "ジャンル",
  experience: "経験の種類",
  purpose: "目的",
  kind: "知識の形式",
  difficulty: "難易度",
  audience: "対象者",
  period: "経験した時期",
  job: "以前の業種・職業分類（確認待ち）",
});

function aliases(input, fallback = []) {
  const value = input === undefined ? fallback : input;
  if (
    !Array.isArray(value) ||
    value.length > 12 ||
    value.some((v) => typeof v !== "string" || !v.trim() || v.length > 60)
  ) {
    const error = new Error("INVALID_ALIASES");
    error.status = 400;
    throw error;
  }
  return [...new Set(value.map((v) => v.normalize("NFKC").trim()))];
}

module.exports = { PUBLIC_AXES, AXES, LABELS, aliases };
