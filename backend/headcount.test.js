"use strict";

/**
 * いまの人数。
 *
 * 「SchoolPark と Emu を何人が使っているか」を出す場所が無かった。
 * 管理画面の会員一覧は有料の契約しか数えないので、無料で使っている人が
 * 一人も入らない。
 *
 * ここで一番こわいのは2つ。
 *   ・全件読んで、1日の読み取り枠を使い切ること（前に起きている）
 *   ・月の切れ目を UTC で切って、毎月1日の朝9時までを先月に入れること
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createIdentity } = require("./identity");
const { makeFirestore } = require("./fake-firestore");

const ADDR = (n) => "0x" + String(n).repeat(40).slice(0, 40);
function account(uid, addr) {
  return { uid, provider: "line", walletAddress: addr, chesAddress: addr, createdAt: 1 };
}

function setup(howMany) {
  const accounts = {};
  for (let i = 1; i <= (howMany || 3); i += 1) accounts["u" + i] = account("u" + i, ADDR(i));
  const db = makeFirestore({ ches_accounts: accounts });
  return { db, identity: createIdentity({ db }) };
}

/* ───────── 月の切れ目 ───────── */

test("月の切れ目は、日本時間の1日0:00", () => {
  const { identity } = setup();
  /* 10/1 00:00 JST ＝ 9/30 15:00 UTC。EMUER の施行と同じ時刻。 */
  const expected = Date.parse("2026-09-30T15:00:00.000Z");
  assert.equal(identity.jstMonthStart(Date.parse("2026-10-04T02:00:00.000Z")), expected);
  /* 10/31 23:59 JST ＝ 10/31 14:59 UTC。UTC で 10/31 23:59 は、
     日本時間ではもう 11/1 の朝なので、ここでは使わない。 */
  assert.equal(identity.jstMonthStart(Date.parse("2026-10-31T14:59:59.000Z")), expected);
});

test("日本時間の1日の朝は、今月に入る", () => {
  /* UTC で切ると、毎月1日の 0:00〜8:59 JST が先月に入ってしまう。 */
  const { identity } = setup();
  const octStart = Date.parse("2026-09-30T15:00:00.000Z");
  const asa = Date.parse("2026-09-30T16:00:00.000Z");   // 10/1 01:00 JST
  assert.equal(identity.jstMonthStart(asa), octStart, "1日の朝が先月になっています");
});

test("月末の深夜は、まだ今月", () => {
  const { identity } = setup();
  const octStart = Date.parse("2026-09-30T15:00:00.000Z");
  const yoru = Date.parse("2026-10-31T14:59:00.000Z");  // 10/31 23:59 JST
  assert.equal(identity.jstMonthStart(yoru), octStart);
});

test("月をまたぐと、切れ目も変わる", () => {
  const { identity } = setup();
  const nov = Date.parse("2026-10-31T15:00:00.000Z");   // 11/1 00:00 JST
  assert.equal(identity.jstMonthStart(Date.parse("2026-11-05T00:00:00.000Z")), nov);
});

/* ───────── 数える ───────── */

test("アカウントとパスポートを、別々に数える", async () => {
  const { identity } = setup(3);
  await identity.resolveForUid("u1");
  await identity.resolveForUid("u2");
  const h = await identity.headcount(Date.now());
  assert.equal(h.accounts, 3, "アカウントの数が違います");
  assert.equal(h.passports, 2, "パスポートの数が違います");
});

test("誰もいなければ、0で返る（落ちない）", async () => {
  const db = makeFirestore({});
  const identity = createIdentity({ db });
  const h = await identity.headcount(Date.now());
  assert.equal(h.accounts, 0);
  assert.equal(h.passports, 0);
  assert.equal(h.invited, 0);
});

test("招待から来た人を数える", async () => {
  const { identity } = setup(3);
  const a = await identity.resolveForUid("u1");
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid("u2");
  await identity.resolveForUid("u3");          // 招待ではない
  await identity.recordInvite(code, b.spid);

  const h = await identity.headcount(Date.now());
  assert.equal(h.passports, 3);
  assert.equal(h.invited, 1, "招待から来た人の数が違います");
});

test("今月のぶんだけ数える", async () => {
  const { db, identity } = setup(2);
  await identity.resolveForUid("u1");
  const old = await identity.resolveForUid("u2");
  /* 片方を先月にする。 */
  const sep = Date.parse("2026-09-15T00:00:00.000Z");
  const row = db._dump("sp_identities")[old.spid];
  await db.collection("sp_identities").doc(old.spid)
    .set(Object.assign({}, row, { createdAt: sep }), { merge: false });

  const now = Date.parse("2026-10-04T02:00:00.000Z");
  const h = await identity.headcount(now);
  assert.equal(h.passports, 2, "全部では2件のはずです");
  assert.equal(h.passportsThisMonth, 1, "先月のぶんまで今月に数えています");
});

test("数えた時刻と、月の切れ目を返す", async () => {
  const { identity } = setup(1);
  const now = Date.parse("2026-10-04T02:00:00.000Z");
  const h = await identity.headcount(now);
  assert.equal(h.countedAt, now);
  assert.equal(h.since, Date.parse("2026-09-30T15:00:00.000Z"));
});

/* ───────── 読み取りの枠を食わないこと ───────── */

test("数えるのに、全件は読まない", () => {
  /* count() は索引から数えるので、何人いても読み取りはごくわずか。
     ここが .get() に戻ると、1日の読み取り枠を使い切る。 */
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "identity.js"), "utf8");
  const i = src.indexOf("async function headcount(now)");
  assert.ok(i > 0, "数えるところが見つかりません");
  const seg = src.slice(i, i + 1200);
  assert.ok(seg.indexOf("countOf(") > 0, "count() を通していません");
  assert.equal(seg.indexOf(".get()"), -1, "全件読みが混ざっています");
});

test("count() を持たない繋ぎ先でも落ちない", async () => {
  const { db, identity } = setup(2);
  await identity.resolveForUid("u1");
  /* 古い版の Firestore を真似て、count() を外す。 */
  const orig = db.collection.bind(db);
  db.collection = function (name) {
    const c = orig(name);
    const strip = (q) => {
      const out = Object.assign({}, q);
      delete out.count;
      if (typeof q.where === "function") out.where = (f, o, v) => strip(q.where(f, o, v));
      return out;
    };
    return strip(c);
  };
  const h = await identity.headcount(Date.now());
  assert.equal(h.passports, 1);
});

test("絞り込みは、1つの欄だけ（索引を別に作らなくて済む）", () => {
  /* 2つ以上を組み合わせると、索引を作るまで数えられなくなる。 */
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "identity.js"), "utf8");
  const i = src.indexOf("async function headcount(now)");
  const seg = src.slice(i, i + 1200);
  assert.equal(seg.indexOf('.where("createdAt", ">=", since).where'), -1, '絞り込みを重ねています');
  assert.equal(seg.indexOf('").where("'), -1, '絞り込みを重ねています');
});
