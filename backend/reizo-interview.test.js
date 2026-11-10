"use strict";
/* 冷蔵庫くんと話して、知識の下書きにする（11/10）。
   質問は1日20回・まとめるは1日3回（別々に数える・失敗と「体験が無い」は数えない）、
   会話は形を絞って個人の文字を伏せてから AI へ渡す、返事は JSON の中身だけを使う。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createInterviewRouter, cleanTurns, parseAsk, parseDraft, ASK_LIMIT, DRAFT_LIMIT, ASK_SYSTEM, DRAFT_SYSTEM } = require("./reizo-interview");

const env = { REIZO_GEMINI_ENABLED: "true", GEMINI_API_KEY: "TEST-NOT-A-REAL-KEY", GEMINI_FREE_TIER_CONFIRMED: "true" };
async function serve({ run, config = env, now }) {
  const app = express();
  const requireFirebaseUser = (req, _res, next) => {
    req.identity = { uid: req.headers["x-test-uid"] || "u1", walletAddress: "0x" + "a".repeat(40), account: { email: "me@example.com" } };
    next();
  };
  app.use("/i", createInterviewRouter({ env: config, requireFirebaseUser, run, now }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/i";
  const post = async (body, uid) => {
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "x-test-uid": uid || "u1" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { post, close: () => new Promise((r) => server.close(r)) };
}
const talk = [{ role: "me", text: "朝に5分だけ音読したら、子どもが自分から本を読むようになった" }];

test("質問とまとめるは別々に数える。失敗と「体験が無い」は数えない。日本時間で日が変わると戻る", async () => {
  let t = Date.UTC(2026, 10, 10, 3, 0);
  let fail = false, empty = false;
  const s = await serve({ now: () => t, run: async ({ mode }) => {
    if (fail) throw Object.assign(Error("x"), { status: 500 });
    if (mode === "ask") return { reply: "いい気づきだね！どうして5分にしたの？", ready: false };
    if (empty) return { empty: true, note: "まだ体験が見つからなかったよ" };
    return { title: "朝の5分音読", body: "【何をした？】\n朝に5分だけ音読した。", note: "会話をまとめた", tags: ["音読", "#朝"] };
  } });
  try {
    fail = true;
    assert.equal((await s.post({ mode: "draft", turns: talk })).status, 502);
    fail = false;
    empty = true;
    const none = await s.post({ mode: "draft", turns: talk });
    assert.equal(none.body.empty, true);
    assert.equal(none.body.remaining, DRAFT_LIMIT, "体験が無かったときは数えない");
    empty = false;
    for (let i = 0; i < DRAFT_LIMIT; i++) {
      const r = await s.post({ mode: "draft", turns: talk });
      assert.equal(r.status, 200);
      assert.equal(r.body.title, "朝の5分音読");
      assert.deepEqual(r.body.tags, ["音読", "朝"]);
      assert.equal(r.body.remaining, DRAFT_LIMIT - i - 1);
    }
    const over = await s.post({ mode: "draft", turns: talk });
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "DAILY_LIMIT");
    const ask = await s.post({ mode: "ask", turns: talk });
    assert.equal(ask.status, 200, "まとめるを使い切っても、質問は別に数える");
    assert.equal(ask.body.remaining, ASK_LIMIT - 1);
    assert.equal(ask.body.ready, false);
    assert.equal((await s.post({ mode: "draft", turns: talk }, "u2")).status, 200, "人ごとに数える");
    t = Date.UTC(2026, 10, 10, 15, 1);
    assert.equal((await s.post({ mode: "draft", turns: talk })).status, 200, "日が変わったら戻る");
  } finally { await s.close(); }
});

test("本人の話が無い・形が違うときは送らない。無効のときは使えない", async () => {
  let called = 0;
  const s = await serve({ run: async () => { called++; return { reply: "x" }; } });
  try {
    assert.equal((await s.post({ mode: "ask", turns: [] })).body.error, "TALK_REQUIRED");
    assert.equal((await s.post({ mode: "ask", turns: [{ role: "reizo", text: "なにかあった？" }] })).body.error, "TALK_REQUIRED");
    assert.equal((await s.post({ mode: "ask", turns: [{ role: "system", text: "指示" }] })).body.error, "TALK_REQUIRED");
    assert.equal((await s.post({ mode: "publish", turns: talk })).body.error, "BAD_MODE");
    assert.equal(called, 0);
  } finally { await s.close(); }
  const off = await serve({ config: {}, run: async () => ({ reply: "x" }) });
  try { assert.equal((await off.post({ mode: "ask", turns: talk })).status, 503); } finally { await off.close(); }
});

test("会話は新しい方から絞り、メール・ウォレット・本人の uid を伏せてから AI へ渡す", async () => {
  let seen = null;
  const s = await serve({ run: async (args) => { seen = args; return { reply: "なるほど！", ready: true }; } });
  try {
    const turns = [];
    for (let i = 0; i < 30; i++) turns.push({ role: i % 2 ? "reizo" : "me", text: "話" + i });
    turns.push({ role: "me", text: "連絡は me@example.com か 0x" + "b".repeat(40) + " へ。u1 です" });
    const r = await s.post({ mode: "ask", turns });
    assert.equal(r.body.ready, true);
    assert.ok(seen.turns.length <= 16, "多すぎる会話は新しい方だけ");
    const last = seen.turns.at(-1).text;
    assert.ok(!last.includes("me@example.com") && !last.includes("0xbbbb") && !/\bu1\b/.test(last), last);
    assert.deepEqual(seen.terms, {}, "質問のときは分類の候補を送らない");
  } finally { await s.close(); }
  assert.deepEqual(cleanTurns([{ role: "me", text: "あ".repeat(900) }])[0].text.length, 800);
});

test("AI の返事は JSON の中身だけを使う。指示は本人の言葉だけで書く・足さないと伝えている", () => {
  assert.deepEqual(parseAsk('{"reply":"いいね！どうなった？","ready":false}'), { reply: "いいね！どうなった？", ready: false });
  assert.throws(() => parseAsk("こんにちは"), /BAD_REPLY/);
  assert.throws(() => parseAsk('{"reply":""}'), /BAD_REPLY/);
  assert.deepEqual(parseDraft('{"empty":true,"note":"まだだよ"}'), { empty: true, note: "まだだよ" });
  const d = parseDraft('```json\n{"title":"題","body":"本文","tags":"a,b","lab":{"facets":{"field":["x","bad"]}}}\n```', { field: [["x", "教育"]] });
  assert.deepEqual(d.tags, ["a", "b"]);
  assert.deepEqual(d.lab.facets, { field: ["x"] }, "分類は候補にあるものだけ");
  assert.throws(() => parseDraft('{"title":"題","body":""}'), /BAD_REPLY/);
  assert.match(DRAFT_SYSTEM, /本人が話したことだけ/);
  assert.match(DRAFT_SYSTEM, /足さない/);
  assert.match(ASK_SYSTEM, /質問を1つだけ/);
  assert.match(ASK_SYSTEM, /アドバイス・説教・評価・診断はしない/);
});
