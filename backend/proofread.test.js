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
  assert.deepEqual(parseReply('```json\n{"title":"題","body":"本文です","note":"誤字"}\n```'), { title: "題", body: "本文です", note: "誤字", tags: [], lab: null });
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

test("タグ案：5個まで・# やカンマは外す・重複は1つ", () => {
  const { cleanTags, parseReply } = require("./proofread");
  assert.deepEqual(cleanTags(["#習慣", "朝時間", "朝時間", "小さく,始める", "音読", "会議", "6個目"]), ["習慣", "朝時間", "小さく始める", "音読", "会議"]);
  assert.deepEqual(cleanTags("習慣、朝時間"), ["習慣", "朝時間"]);
  assert.deepEqual(cleanTags(null), []);
  assert.deepEqual(parseReply('{"body":"本文","tags":["音読","#会議"]}').tags, ["音読", "会議"]);
});

test("11/18 整えてもらう：AI が空けた分類も全部うめる（文章の言葉→広い候補）。業種・職業は書いてあるときだけ。見出しから何が起きたか等も入れる", async () => {
  const terms = {
    field: [["field-money", "お金・金融"], ["field-life", "暮らし・人生"]],
    industry: [["industry-food", "飲食"]], occupation: [["occupation-nurse", "看護師"]],
    audience: [["audience-everyone", "どなたでも"], ["audience-parent", "子育て中の人"]],
    period: [["period-unspecified", "時期を特定しない"]], difficulty: [["difficulty-basic", "基礎"]],
    kind: [["kind-story", "体験談"]], purpose: [["purpose-experience", "誰かの経験を知りたい"]],
    experience: [["experience-challenge", "挑戦"]], genre: [["genre-daily", "日常の工夫"]],
  };
  const s = await serve({ generate: async () => ({ title: "先取り貯金", body: "【何があった？】\nお金が足りなかった\n【何をした？】\n給料日に分けた\n【どうなった？】\n半年で10万円たまった\n【次の人へひとこと】\nまず千円から", lab: null }) });
  try {
    const r = await s.post({ body: "お金が足りなかった", terms });
    const f = r.body.lab.facets;
    assert.deepEqual(f.field, ["field-money"], "文章に出てくる言葉で選ぶ");
    for (const axis of ["audience", "period", "difficulty", "kind", "purpose", "experience", "genre"]) assert.equal(f[axis].length, 1, axis + " もうまる");
    assert.equal(f.industry, undefined, "業種は書いていなければ決めつけない");
    assert.equal(f.occupation, undefined);
    assert.equal(r.body.lab.happened, "お金が足りなかった");
    assert.equal(r.body.lab.learned, "半年で10万円たまった");
    assert.equal(r.body.lab.advice, "まず千円から");
  } finally { await s.close(); }
  const { SYSTEM_TEXT } = { SYSTEM_TEXT: require("fs").readFileSync(__dirname + "/proofread.js", "utf8") };
  assert.match(SYSTEM_TEXT, /渡された軸は全部うめる/);
});
