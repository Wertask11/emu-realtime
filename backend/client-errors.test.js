"use strict";
/* 画面のエラーを集める（client-errors.js、11/3 点検 15）。
   人を特定するものは受け取らず、伏せ字にし、同じエラーは1日1件にまとめて数える。見られるのは運営だけ。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createClientErrorsRouter, parseReport, scrub } = require("./client-errors");

async function setup() {
  const db = makeFirestore({});
  let owner = false;
  let t = Date.parse("2026-11-03T01:00:00Z");
  const app = express();
  app.use(express.json());
  app.use("/api/client-errors", createClientErrorsRouter({
    db, now: () => t,
    requireOwner: (req, res, next) => (owner ? next() : res.status(403).json({ error: "OWNER_ONLY" }))
  }).router);
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/client-errors";
  const send = body => fetch(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: typeof body === "string" ? body : JSON.stringify(body) }).then(r => r.status);
  const admin = () => fetch(base + "/admin").then(async r => ({ status: r.status, body: await r.json() }));
  return { db, send, admin, owner: v => { owner = v; }, at: v => { t = v; }, close: () => server.close() };
}

const REPORT = {
  kind: "error", message: "TypeError: Cannot read properties of null (reading 'post')",
  source: "https://schoolpark-emu.vercel.app/index.html?v=2#x", line: 25120, col: 7,
  page: "https://schoolpark-emu.vercel.app/?view=search"
};

test("同じエラーは1日1件にまとめて数え、ファイルとページはパスだけを残す", async () => {
  const t = await setup();
  try {
    assert.equal(await t.send(REPORT), 204);
    assert.equal(await t.send(REPORT), 204);
    const rows = Object.values(t.db._dump("emu_client_errors"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 2);
    assert.equal(rows[0].source, "/index.html");
    assert.equal(rows[0].page, "/");
    assert.equal(rows[0].day, "2026-11-03");
    const exp = rows[0].expireAt && rows[0].expireAt.toDate ? rows[0].expireAt.toDate() : new Date(rows[0].expireAt);
    assert.equal(Math.round((exp - Date.parse("2026-11-03T01:00:00Z")) / 86400000), 30, "30日で消す印が無い");
    for (const key of ["uid", "ip", "userAgent", "walletAddress", "address"]) assert.equal(key in rows[0], false, key + " を残している");
  } finally { t.close(); }
});

test("エラーの文の中のメール・アドレス・パスポートID・長い番号は伏せる", () => {
  const s = scrub("failed for taro@example.com 0x" + "ab".repeat(20) + " SP-AB12-CD34-EF56-GH78 tok_" + "x".repeat(40) + " id 12345678", 300);
  assert.equal(s.includes("taro@example.com"), false);
  assert.equal(s.includes("0xabab"), false);
  assert.equal(s.includes("SP-AB12"), false);
  assert.equal(s.includes("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), false);
  assert.equal(s.includes("12345678"), false);
  assert.match(s, /<mail>.*<addr>.*<spid>.*<token>.*<num>/);
});

test("ほかのサイト（拡張機能など）のエラーと、壊れた送り物は受け取らない", async () => {
  const t = await setup();
  try {
    assert.equal(await t.send({ ...REPORT, source: "chrome-extension://abc/content.js" }), 204);
    assert.equal(await t.send({ ...REPORT, page: "https://evil.example/" }), 204);
    assert.equal(await t.send("not json"), 204);
    assert.equal(await t.send({ ...REPORT, message: "" }), 204);
    assert.deepEqual(Object.values(t.db._dump("emu_client_errors")), []);
    assert.equal(parseReport({ ...REPORT, source: "" }).source, "", "ファイルが分からないエラーは受ける");
  } finally { t.close(); }
});

test("見られるのは運営だけ。この7日分を、多い順にまとめて返す", async () => {
  const t = await setup();
  try {
    await t.send(REPORT);
    await t.send({ ...REPORT, message: "ReferenceError: x is not defined", line: 10 });
    await t.send({ ...REPORT, message: "ReferenceError: x is not defined", line: 10 });
    t.at(Date.parse("2026-11-04T01:00:00Z"));
    await t.send({ ...REPORT, message: "ReferenceError: x is not defined", line: 10 });
    assert.equal((await t.admin()).status, 403);
    t.owner(true);
    const r = await t.admin();
    assert.equal(r.status, 200);
    assert.equal(r.body.errors[0].message, "ReferenceError: x is not defined");
    assert.equal(r.body.errors[0].count, 3);
    assert.deepEqual(r.body.errors[0].days.sort(), ["2026-11-03", "2026-11-04"]);
    assert.equal(r.body.errors[1].count, 1);
  } finally { t.close(); }
});

/* 11/11 点検：受け取る相手が旧URLだけだったので、URLを移してからのエラーは全部捨てられていた。 */
test("いまのURL（emu-for-schoolpark）からのエラーも受け取る", async () => {
  const t = await setup();
  try {
    assert.equal(await t.send({ ...REPORT,
      source: "https://emu-for-schoolpark.vercel.app/index.html?v=3",
      page: "https://emu-for-schoolpark.vercel.app/?view=search" }), 204);
    const rows = Object.values(t.db._dump("emu_client_errors"));
    assert.equal(rows.length, 1, "新しいURLのエラーが捨てられている");
    assert.equal(rows[0].source, "/index.html");
  } finally { t.close(); }
});
