"use strict";
/* 冷蔵庫くんに整えてもらう（11/9）：1日3回・失敗は数えない・中身は変えない指示・本文は返すだけ。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createProofreadRouter, parseReply, DAILY_LIMIT } = require("./proofread");

const env = { REIZO_GEMINI_ENABLED: "true", GEMINI_API_KEY: "TEST-NOT-A-REAL-KEY", GEMINI_FREE_TIER_CONFIRMED: "true" };
async function serve({ generate, config = env, now }) {
  const app = express();
  const requireFirebaseUser = (req, _res, next) => { req.identity = { uid: req.headers["x-test-uid"] || "u1" }; next(); };
  app.use("/p", createProofreadRouter({ env: config, requireFirebaseUser, generate, now }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/p";
  const post = async (body, uid) => {
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "x-test-uid": uid || "u1" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { base, post, close: () => new Promise((r) => server.close(r)) };
}

test("1日3回まで。失敗は回数に数えない。日本時間で日が変わると戻る", async () => {
  let t = Date.UTC(2026, 10, 9, 3, 0);  // 日本時間 12:00
  let fail = false;
  const s = await serve({ now: () => t, generate: async ({ body }) => { if (fail) throw Object.assign(Error("x"), { status: 500 }); return { title: "朝の音読", body: body + "。", note: "句点を足した" }; } });
  try {
    fail = true;
    assert.equal((await s.post({ body: "朝に音読した" })).status, 502);
    fail = false;
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const r = await s.post({ body: "朝に音読した" });
      assert.equal(r.status, 200);
      assert.equal(r.body.body, "朝に音読した。");
      assert.equal(r.body.remaining, DAILY_LIMIT - i - 1);
    }
    const over = await s.post({ body: "朝に音読した" });
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "DAILY_LIMIT");
    assert.equal((await s.post({ body: "別の人" }, "u2")).status, 200, "人ごとに数える");
    t = Date.UTC(2026, 10, 9, 15, 1);  // 日本時間 翌 0:01
    assert.equal((await s.post({ body: "朝に音読した" })).status, 200, "日が変わったら戻る");
  } finally { await s.close(); }
});

test("空・長すぎる本文は送らない。無効のときは使えない", async () => {
  const s = await serve({ generate: async () => ({ body: "x" }) });
  try {
    assert.equal((await s.post({ body: "   " })).body.error, "BODY_REQUIRED");
    assert.equal((await s.post({ body: "あ".repeat(3001) })).body.error, "BODY_TOO_LONG");
  } finally { await s.close(); }
  const off = await serve({ config: {}, generate: async () => ({ body: "x" }) });
  try { assert.equal((await off.post({ body: "本文" })).status, 503); } finally { await off.close(); }
});

test("AI の返事は JSON の本文だけを使う", () => {
  assert.deepEqual(parseReply('```json\n{"title":"題","body":"本文です","note":"誤字"}\n```'), { title: "題", body: "本文です", note: "誤字", lab: null });
  assert.throws(() => parseReply("こんにちは"), /BAD_REPLY/);
  assert.throws(() => parseReply('{"title":"題","body":""}'), /BAD_REPLY/);
});

test("詳しく整理する：候補にある分類だけ・軸ごとに3つまで・本文に無いことは空", async () => {
  const { cleanTerms, cleanLab } = require("./proofread");
  const terms = cleanTerms({
    field: [["field-education", "教育"], ["field-it", "IT"], ["BAD ID", "x"]],
    period: [["period-student", "学生時代"]],
    job: [["job-x", "使わない軸"]],
    nope: "x"
  });
  assert.deepEqual(Object.keys(terms), ["field", "period"], "決まった軸だけ・形の悪い id は捨てる");
  assert.equal(terms.field.length, 2);
  const lab = cleanLab({ facets: { field: ["field-it", "field-made-up", "field-it"], period: ["period-student"], job: ["job-x"] },
    period: "社会人3年目", happened: "会議で声が震えた", learned: "", advice: "まず5分から" }, terms);
  assert.deepEqual(lab.facets, { field: ["field-it"], period: ["period-student"] }, "候補にない id・重複・別の軸は入れない");
  assert.equal(lab.period, "社会人3年目");
  assert.equal(lab.learned, "");
  assert.equal(cleanLab({ facets: {} }, terms), null, "何も無ければ出さない");
  assert.equal(cleanLab({ facets: { field: ["field-it"] } }, {}), null, "候補が無いときは出さない");
});

test("分類の候補を送ると、サーバーは AI の選んだ分類を候補で絞って返す", async () => {
  let seen = null;
  const s = await serve({ generate: async (args) => { seen = args; return { body: "本文。", lab: { facets: { field: ["field-it", "evil"] }, happened: "起きたこと" } }; } });
  try {
    const r = await s.post({ body: "本文", terms: { field: [["field-it", "IT"]] } });
    assert.equal(r.status, 200);
    assert.deepEqual(seen.terms, { field: [["field-it", "IT"]] });
    assert.deepEqual(r.body.lab.facets, { field: ["field-it"] });
    assert.equal(r.body.lab.happened, "起きたこと");
    const plain = await s.post({ body: "本文" });
    assert.equal(plain.body.lab, null, "候補を送らなければ整理の下書きは返さない");
  } finally { await s.close(); }
});
