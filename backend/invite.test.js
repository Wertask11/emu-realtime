"use strict";

/**
 * 招待リンク（一般クエスト #005）のテスト。
 *
 * #005 は「招待した人が1人、SchoolPark Passport を発行する」で完走する。
 * これまでは相手の名前を報告して、運営が発行日を照合していた。
 * ここが機械で数えられるようになると、照合の手間が消える。
 *
 * ただし、数えるのは数えるだけ。認めるのは運営が決める。
 * 同じ人が LINE と Google で入れば別の番号になるので、
 * 自作自演は機械では見分けられない（identity.js の頭に書いたとおり）。
 *
 * ここが緩むと、完走を自分で作れてしまう。確かめること:
 *   ・自分で自分は招待できない
 *   ・同じ相手は何度来ても1件
 *   ・すでに番号がある人は数えない（＝前からいる人の呼び直しで増やせない）
 *   ・合言葉に SchoolPark ID そのものを使っていない
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createIdentity, isSchoolParkId, newInviteCode, isInviteCode } = require("./identity");
const { makeFirestore } = require("./fake-firestore");

function account(uid, provider, walletAddress) {
  return {
    uid, provider, displayName: "", email: "", photoURL: "",
    walletAddress, chesAddress: walletAddress,
    membership: { tier: "free", offchain: true, issuedAt: 1 },
    createdAt: 1, lastLogin: 1
  };
}

const A_UID = "line:UAAAA", A_ADDR = "0xaaaa111111111111111111111111111111111111";
const B_UID = "googleuidBBBB", B_ADDR = "0xbbbb222222222222222222222222222222222222";
const C_UID = "line:UCCCC", C_ADDR = "0xcccc333333333333333333333333333333333333";

function setup() {
  const db = makeFirestore({
    ches_accounts: {
      [A_UID]: account(A_UID, "line", A_ADDR),
      [B_UID]: account(B_UID, "google", B_ADDR),
      [C_UID]: account(C_UID, "line", C_ADDR)
    }
  });
  return { db, identity: createIdentity({ db }) };
}

/* ───────── 合言葉そのもの ───────── */

test("合言葉は、読み違えない文字だけで10文字", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newInviteCode();
    assert.equal(code.length, 10, code);
    assert.equal(isInviteCode(code), true, code);
    /* 1とI、0とOを読み違えないため、I・L・O・U は使わない。 */
    assert.equal(/[ILOU]/.test(code), false, code);
  }
});

test("合言葉に SchoolPark ID そのものは使わない", () => {
  /* 番号は「順に試せない」ことを前提に作ってある。SNS に貼った時点で
     その前提が崩れるので、合言葉は番号とは別物でなければならない。 */
  const code = newInviteCode();
  assert.equal(isSchoolParkId(code), false);
  assert.equal(code.indexOf("SP-"), -1);
});

test("形の違うものは合言葉として受け取らない", () => {
  ["", "SHORT", "0123456789012", "ABCDEFGHIJ", "abcdefghij", null, undefined]
    .forEach((v) => assert.equal(isInviteCode(v), false, String(v)));
});

/* ───────── 合言葉を配る ───────── */

test("合言葉は一度だけ作られ、何度聞いても同じ", async () => {
  const { db, identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const first = await identity.inviteCodeFor(a.spid);
  const again = await identity.inviteCodeFor(a.spid);
  assert.equal(first, again);
  assert.equal(isInviteCode(first), true);
  assert.equal(db._count("sp_invite_codes"), 1);
});

test("同時に2回聞いても、合言葉は1つしかできない", async () => {
  const { db, identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const [x, y] = await Promise.all([
    identity.inviteCodeFor(a.spid), identity.inviteCodeFor(a.spid)
  ]);
  assert.equal(x, y);
  assert.equal(db._count("sp_invite_codes"), 1);
});

test("番号が無い人には合言葉を出さない", async () => {
  const { identity } = setup();
  await assert.rejects(() => identity.inviteCodeFor("SP-0000-0000-0000-0000"),
    /IDENTITY_NOT_FOUND/);
});

test("合言葉から、招待した人の番号が引ける", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  assert.equal(await identity.inviterOf(code), a.spid);
  assert.equal(await identity.inviterOf("ZZZZZZZZZZ"), null);
  assert.equal(await identity.inviterOf("でたらめ"), null);
});

/* ───────── 招待を数える ───────── */

test("招待された人のパスポートが、1件として数えられる", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid(B_UID);

  const got = await identity.recordInvite(code, b.spid);
  assert.equal(got.ok, true);
  assert.equal(got.inviter, a.spid);

  const out = await identity.invitesOf(a.spid, 0);
  assert.equal(out.total, 1);
  assert.deepEqual(out.invited.map((r) => r.spid), [b.spid]);
});

test("同じ相手は、何度来ても1件", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid(B_UID);

  assert.equal((await identity.recordInvite(code, b.spid)).ok, true);
  const second = await identity.recordInvite(code, b.spid);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "ALREADY");
  assert.equal((await identity.invitesOf(a.spid, 0)).total, 1);
});

test("自分で自分は招待できない", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const got = await identity.recordInvite(code, a.spid);
  assert.equal(got.ok, false);
  assert.equal(got.reason, "SELF");
  assert.equal((await identity.invitesOf(a.spid, 0)).total, 0);
});

test("すでに誰かの招待で数えてある人は、あとから付け替えられない", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const c = await identity.resolveForUid(C_UID);
  const codeA = await identity.inviteCodeFor(a.spid);
  const codeC = await identity.inviteCodeFor(c.spid);
  const b = await identity.resolveForUid(B_UID);

  assert.equal((await identity.recordInvite(codeA, b.spid)).ok, true);
  const steal = await identity.recordInvite(codeC, b.spid);
  assert.equal(steal.ok, false);
  assert.equal(steal.reason, "ALREADY_INVITED");
  assert.equal((await identity.invitesOf(a.spid, 0)).total, 1);
  assert.equal((await identity.invitesOf(c.spid, 0)).total, 0);
});

test("知らない合言葉では数えない", async () => {
  const { identity } = setup();
  const b = await identity.resolveForUid(B_UID);
  const got = await identity.recordInvite("ZZZZZZZZZZ", b.spid);
  assert.equal(got.ok, false);
  assert.equal(got.reason, "UNKNOWN_CODE");
});

test("形の違う合言葉では数えない", async () => {
  const { identity } = setup();
  const b = await identity.resolveForUid(B_UID);
  for (const bad of ["", "SHORT", "abcdefghij"]) {
    const got = await identity.recordInvite(bad, b.spid);
    assert.equal(got.ok, false, bad);
    assert.equal(got.reason, "BAD_CODE", bad);
  }
});

test("番号が無い相手は数えない", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const got = await identity.recordInvite(code, "SP-0000-0000-0000-0000");
  assert.equal(got.ok, false);
  assert.equal(got.reason, "IDENTITY_NOT_FOUND");
});

test("招待された記録は、招待された人の番号にも残る", async () => {
  const { db, identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid(B_UID);
  await identity.recordInvite(code, b.spid);

  const row = db._dump("sp_identities")[b.spid];
  assert.equal(row.invitedByCode, code);
  assert.equal(row.invitedBySpid, a.spid);
  assert.ok(Number(row.invitedAt) > 0, "いつ招待されたかが残っていません");
});

/* ───────── クエストの判定（受けた日より後か） ───────── */

test("受けた日より後にできたものだけ数える", async () => {
  const { db, identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid(B_UID);
  const c = await identity.resolveForUid(C_UID);
  await identity.recordInvite(code, b.spid);
  await identity.recordInvite(code, c.spid);

  /* 片方を「クエストを受ける前」にする。 */
  const seats = db._dump("sp_invite_codes/" + code + "/invited");
  const key = Object.keys(seats).find((k) => k === b.spid);
  await db.collection("sp_invite_codes/" + code + "/invited").doc(key)
    .set({ ...seats[key], createdAt: 1000 }, { merge: false });

  const all = await identity.invitesOf(a.spid, 0);
  assert.equal(all.total, 2, "全部では2件のはずです");

  const after = await identity.invitesOf(a.spid, 5000);
  assert.equal(after.invited.length, 1, "受ける前のものまで数えています");
  assert.equal(after.invited[0].spid, c.spid);
});

test("合言葉を作っていない人は、0件で返る（落ちない）", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const out = await identity.invitesOf(a.spid, 0);
  assert.equal(out.code, "");
  assert.equal(out.total, 0);
  assert.deepEqual(out.invited, []);
});

test("番号の形が違えば、数えに行かない", async () => {
  const { identity } = setup();
  await assert.rejects(() => identity.invitesOf("でたらめ", 0), /BAD_SPID/);
});

/* ───────── 壊れたときに、発行そのものを止めない ───────── */

test("招待を数えられなくても、落ちずに理由を返す", async () => {
  const { db, identity } = setup();
  const a = await identity.resolveForUid(A_UID);
  const code = await identity.inviteCodeFor(a.spid);
  const b = await identity.resolveForUid(B_UID);
  db._breakAll("NETWORK_DOWN");
  const got = await identity.recordInvite(code, b.spid);
  db._repair();
  assert.equal(got.ok, false);
  assert.equal(got.reason, "RECORD_FAILED");
});
