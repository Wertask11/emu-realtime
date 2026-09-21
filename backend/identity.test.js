"use strict";

/**
 * SchoolPark ID（Passport ID）のテスト。
 *
 * ここが壊れると、
 *   - 同じ人に番号が2つできる（パスポートが分かれる）
 *   - 他人のパスポートへ、別人のログイン方法を足せてしまう
 *   - 公式パスの持ち主が SchoolPark に入れなくなる
 * のどれかが起きる。変更したら必ず `npm test` を通してから出すこと。
 *
 * 追加の依存は入れない（Node の標準テストランナーだけで動く）。
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createIdentity, isSchoolParkId, newSchoolParkId } = require("./identity");
const { createEntitlement } = require("./entitlement");
const { makeFirestore } = require("./fake-firestore");
const { decideSchoolParkAccess, PASS_PREVIEW_AT, PUBLIC_AT } = require("./schoolpark-access");

/* ───────── お膳立て ───────── */

/* ログイン方法ごとの ches_accounts を、本番と同じ形で作る。
   LINE / Google / メールは walletAddress ＝ chesAddress（uid から決まる住所）。
   ウォレットだけ walletAddress が本物のアドレスになる。 */
function account(uid, provider, walletAddress, chesAddress) {
  return {
    uid, provider,
    displayName: "", email: "", photoURL: "",
    walletAddress, chesAddress: chesAddress || walletAddress,
    membership: { tier: "free", offchain: true, issuedAt: 1 },
    createdAt: 1, lastLogin: 1
  };
}

const LINE_UID = "line:U1111";
const LINE_ADDR = "0x1111111111111111111111111111111111111111";
const GOOGLE_UID = "googleuid2222";
const GOOGLE_ADDR = "0x2222222222222222222222222222222222222222";
const WALLET_ADDR = "0x3333333333333333333333333333333333333333";
const WALLET_UID = "wallet:" + WALLET_ADDR;
const WALLET_CHES = "0x4444444444444444444444444444444444444444";
const OTHER_UID = "line:U9999";
const OTHER_ADDR = "0x9999999999999999999999999999999999999999";

function setup(extra) {
  const db = makeFirestore({
    ches_accounts: {
      [LINE_UID]: account(LINE_UID, "line", LINE_ADDR),
      [GOOGLE_UID]: account(GOOGLE_UID, "google", GOOGLE_ADDR),
      [WALLET_UID]: account(WALLET_UID, "wallet", WALLET_ADDR, WALLET_CHES),
      [OTHER_UID]: account(OTHER_UID, "line", OTHER_ADDR)
    },
    ...(extra || {})
  });
  return { db, identity: createIdentity({ db }) };
}

/* ───────── 1〜3. 新規ユーザーは番号が一度だけ発行される ───────── */

test("1. 新規LINEユーザー: SchoolPark ID が一度だけ発行される", async () => {
  const { db, identity } = setup();
  const first = await identity.resolveForUid(LINE_UID);
  assert.equal(first.isNew, true);
  assert.equal(isSchoolParkId(first.spid), true);
  assert.equal(db._count("sp_identities"), 1);

  // 何度呼んでも増えない
  await identity.resolveForUid(LINE_UID);
  await identity.resolveForUid(LINE_UID);
  assert.equal(db._count("sp_identities"), 1);
});

test("2. 新規Googleユーザー: SchoolPark ID が一度だけ発行される", async () => {
  const { db, identity } = setup();
  const out = await identity.resolveForUid(GOOGLE_UID);
  assert.equal(out.isNew, true);
  assert.equal(isSchoolParkId(out.spid), true);
  assert.equal(db._count("sp_identities"), 1);
});

test("3. 新規ウォレットユーザー: SchoolPark ID が一度だけ発行され、実アドレスが名義に入る", async () => {
  const { db, identity } = setup();
  const out = await identity.resolveForUid(WALLET_UID);
  assert.equal(out.isNew, true);
  assert.equal(db._count("sp_identities"), 1);
  // 署名で確かめた実アドレスと、uid から決まる住所の両方が名義として残る
  assert.deepEqual(out.identity.addresses.sort(), [WALLET_ADDR, WALLET_CHES].sort());
  // アドレス→番号 の逆引きもできている
  assert.equal(await identity.findByAddress(WALLET_ADDR), out.spid);
});

/* ───────── 4. 同じ方法で再ログイン ───────── */

test("4. 同じログイン方法で入り直すと、同じ SchoolPark ID に入る", async () => {
  const { identity } = setup();
  const a = await identity.resolveForUid(LINE_UID);
  const b = await identity.resolveForUid(LINE_UID);
  assert.equal(b.spid, a.spid);
  assert.equal(b.isNew, false);
});

/* ───────── 5〜6. ログイン方法を足す ───────── */

test("5. LINEで作ったあとウォレットを連携すると、ウォレットで入っても同じ番号になる", async () => {
  const { db, identity } = setup();
  const line = await identity.resolveForUid(LINE_UID);

  // パスポートから「ウォレットを連携」（署名の確認は窓口側。ここは確認済みの想定）
  await identity.registerWalletLink(line.spid, WALLET_ADDR, { source: "passport-link" });

  // そのウォレットでログインし直す
  const viaWallet = await identity.resolveForUid(WALLET_UID);
  assert.equal(viaWallet.spid, line.spid, "ウォレットで入っても同じ番号でなければならない");
  assert.equal(viaWallet.isNew, false);
  assert.equal(db._count("sp_identities"), 1, "番号が増えてはいけない");

  // LINE でも当然そのまま
  assert.equal((await identity.resolveForUid(LINE_UID)).spid, line.spid);
});

test("6. ウォレットで作ったあとLINEを足すと、LINEで入っても同じ番号になる", async () => {
  const { db, identity } = setup();
  const wallet = await identity.resolveForUid(WALLET_UID);

  // ウォレットで入ったまま引換券をもらい、LINE で認証して足す
  const ticket = await identity.issueLinkTicket(wallet.spid, WALLET_UID);
  const linked = await identity.completeLinkWithTicket(ticket.ticket, LINE_UID);
  assert.equal(linked.spid, wallet.spid);

  const viaLine = await identity.resolveForUid(LINE_UID);
  assert.equal(viaLine.spid, wallet.spid);
  assert.equal(viaLine.isNew, false);
  assert.equal(db._count("sp_identities"), 1, "番号が増えてはいけない");
});

test("15. ログイン方法を足しても、新しいパスポートは作られない", async () => {
  const { db, identity } = setup();
  const line = await identity.resolveForUid(LINE_UID);
  assert.equal(db._count("sp_identities"), 1);

  const ticket = await identity.issueLinkTicket(line.spid, LINE_UID);
  await identity.completeLinkWithTicket(ticket.ticket, GOOGLE_UID);

  assert.equal(db._count("sp_identities"), 1);
  const record = await identity.readIdentity(line.spid);
  assert.equal(record.links.filter((l) => l.kind === "fb").length, 2);
  // ches_accounts 側にも同じ番号の控えが入る（Firestore ルールがこれを見る）
  assert.equal(db._dump("ches_accounts")[GOOGLE_UID].spid, line.spid);
});

/* ───────── 7. 公式パス ───────── */

test("7. 公式パス保有者は、どの連携済みログイン方法でも保有者と判定される", async () => {
  // 公式パスは実ウォレットの名義で paid_users に入っている
  const { db, identity } = setup({ paid_users: { [WALLET_ADDR]: { label: "official" } } });

  const line = await identity.resolveForUid(LINE_UID);
  assert.equal(await identity.holdsOfficialPass(line.spid), false, "まだ連携していないので当たらない");

  await identity.registerWalletLink(line.spid, WALLET_ADDR, { source: "passport-link" });
  identity.forget(line.spid);
  assert.equal(await identity.holdsOfficialPass(line.spid), true,
    "連携後は、ウォレットを繋いでいなくても保有者と分かる");

  // LINE のログインからも、ウォレットのログインからも同じ答えになる
  assert.equal(await identity.holdsOfficialPassForUid(LINE_UID), true);
  const viaWallet = await identity.resolveForUid(WALLET_UID);
  assert.equal(viaWallet.spid, line.spid);
  assert.equal(await identity.holdsOfficialPassForUid(WALLET_UID), true);
  assert.equal(db._count("sp_identities"), 1);
});

test("7b. paid_users がチェックサム表記（大文字まじり）でも当たる", async () => {
  /* paid_users には小文字の鍵と、チェックサム表記の鍵が混ざって現存する。
     どちらでも当たらないと、公式パスの持ち主が見学のままになる。 */
  const checksummed = "0xDCc687c05f130e57597a8525771299A4Efb6edF7";
  const { identity } = setup({ paid_users: { [checksummed]: {} } });
  const line = await identity.resolveForUid(LINE_UID);
  await identity.registerWalletLink(line.spid, checksummed.toLowerCase(), { source: "test" });
  identity.forget(line.spid);
  assert.equal(await identity.holdsOfficialPass(line.spid), true);
});

test("10. 既存の Emu plus 相当（公式パス）が、SchoolPark ID 経由でも保たれる", async () => {
  const { db, identity } = setup({ paid_users: { [WALLET_ADDR]: {} } });
  const entitlement = createEntitlement({ db, identity });

  // LINE の名義は paid_users にいないので、旧判定だけでは見学のまま
  assert.equal((await entitlement.getEntitlement(LINE_UID)).plan, "guest");

  const line = await identity.resolveForUid(LINE_UID);
  await identity.registerWalletLink(line.spid, WALLET_ADDR, { source: "passport-link" });
  identity.forget(line.spid);
  entitlement.forget(LINE_UID);

  const after = await entitlement.getEntitlement(LINE_UID);
  assert.equal(after.plan, "plus");
  assert.equal(after.source, "official-pass");
});

test("10b. 旧判定（walletAddress が paid_users にいる）は、そのまま通り続ける", async () => {
  // SchoolPark ID を一度も発行していない人でも、これまでどおり plus
  const { db, identity } = setup({ paid_users: { [WALLET_ADDR]: {} } });
  const entitlement = createEntitlement({ db, identity });
  const out = await entitlement.getEntitlement(WALLET_UID, null);
  assert.equal(out.plan, "plus");
  assert.equal(out.hasPass, true);
  assert.equal(db._count("sp_identities"), 0, "判定のためだけに番号を作ってはいけない");
});

/* ───────── 8〜9. 公開日の判定（SchoolPark ID を基準にする） ───────── */

test("8-9. 公式パスの有無で、先行公開と一般公開の入場可否が決まる", async () => {
  const { db, identity } = setup({ paid_users: { [WALLET_ADDR]: {} } });
  const holder = await identity.resolveForUid(LINE_UID);
  await identity.registerWalletLink(holder.spid, WALLET_ADDR, { source: "passport-link" });
  identity.forget(holder.spid);

  const guest = await identity.resolveForUid(GOOGLE_UID);

  const hasPass = await identity.holdsOfficialPass(holder.spid);
  const noPass = await identity.holdsOfficialPass(guest.spid);
  assert.equal(hasPass, true);
  assert.equal(noPass, false);

  // 9/21 JST 〜: 公式パス保有者だけ
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT, { hasOfficialPass: hasPass }).allowed, true);
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT, { hasOfficialPass: noPass }).allowed, false);
  // 9/30 まで（＝先行公開の直前）は、非保有者は入れない
  assert.equal(decideSchoolParkAccess(PUBLIC_AT - 1, { hasOfficialPass: noPass }).allowed, false);
  // 10/1 JST 〜: 誰でも
  assert.equal(decideSchoolParkAccess(PUBLIC_AT, { hasOfficialPass: noPass }).allowed, true);
  assert.equal(db._count("sp_identities"), 2);
});

/* ───────── 13. 同時リクエスト ───────── */

test("13. 同時に何本ログインしても、SchoolPark ID は1つしか発行されない", async () => {
  const { db, identity } = setup();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => identity.resolveForUid(LINE_UID))
  );
  const ids = [...new Set(results.map((r) => r.spid))];
  assert.equal(ids.length, 1, "同時に来ても番号は1つ: " + JSON.stringify(ids));
  assert.equal(db._count("sp_identities"), 1);
  assert.equal(db._count("sp_auth_links"), 1);
  assert.equal(results.filter((r) => r.isNew).length, 1, "新規と名乗るのは1本だけ");
});

test("13b. 同時に別々の人がログインしても、それぞれ別の番号になる", async () => {
  const { db, identity } = setup();
  const [a, b, c] = await Promise.all([
    identity.resolveForUid(LINE_UID),
    identity.resolveForUid(GOOGLE_UID),
    identity.resolveForUid(WALLET_UID)
  ]);
  assert.equal(new Set([a.spid, b.spid, c.spid]).size, 3);
  assert.equal(db._count("sp_identities"), 3);
});

/* ───────── 14. 横取りの防止 ───────── */

test("14. 別人の認証情報を、既存のパスポートへ紐付けられない", async () => {
  const { db, identity } = setup();
  const mine = await identity.resolveForUid(LINE_UID);
  const theirs = await identity.resolveForUid(OTHER_UID);   // すでに別人の番号がある

  const ticket = await identity.issueLinkTicket(mine.spid, LINE_UID);
  await assert.rejects(
    () => identity.completeLinkWithTicket(ticket.ticket, OTHER_UID),
    (e) => e.message === "AUTH_LINKED_TO_OTHER"
  );

  // 別人の番号は動いていない
  assert.equal(await identity.findByUid(OTHER_UID), theirs.spid);
  assert.notEqual(theirs.spid, mine.spid);
  // 重複候補として記録されている（勝手に統合しない）
  const dups = await identity.listDuplicates();
  assert.equal(dups.length, 1);
  assert.equal(dups[0].reason, "auth-already-linked");
  assert.equal(dups[0].status, "pending_review");
  assert.equal(db._count("sp_identities"), 2, "拒否しても番号は増減しない");
});

test("14b. 他人が連携済みのウォレットは、自分のパスポートへ連携できない", async () => {
  const { identity } = setup();
  const theirs = await identity.resolveForUid(OTHER_UID);
  await identity.registerWalletLink(theirs.spid, WALLET_ADDR, { source: "passport-link" });

  const mine = await identity.resolveForUid(LINE_UID);
  await assert.rejects(
    () => identity.registerWalletLink(mine.spid, WALLET_ADDR, { source: "passport-link" }),
    (e) => e.message === "WALLET_LINKED_TO_OTHER"
  );
  assert.equal(await identity.findByAddress(WALLET_ADDR), theirs.spid, "持ち主は変わらない");
  const dups = await identity.listDuplicates();
  assert.equal(dups[0].reason, "wallet-already-linked");
});

test("14c. 引換券は10分・1回きり。使い回しも期限切れも通らない", async () => {
  const { identity } = setup();
  const mine = await identity.resolveForUid(LINE_UID);
  const ticket = await identity.issueLinkTicket(mine.spid, LINE_UID);

  await identity.completeLinkWithTicket(ticket.ticket, GOOGLE_UID);
  // 2回目は通らない
  await assert.rejects(
    () => identity.completeLinkWithTicket(ticket.ticket, OTHER_UID),
    (e) => e.message === "TICKET_USED"
  );
  // 無い券も通らない
  await assert.rejects(
    () => identity.completeLinkWithTicket("deadbeef", OTHER_UID),
    (e) => e.message === "TICKET_NOT_FOUND"
  );
});

test("14d. 期限の切れた引換券は通らない", async () => {
  const { db, identity } = setup();
  const mine = await identity.resolveForUid(LINE_UID);
  const ticket = await identity.issueLinkTicket(mine.spid, LINE_UID);
  // 券を過去のものにする
  await db.collection("sp_link_tickets").doc(ticket.ticket)
    .set({ expiresAt: Date.now() - 1 }, { merge: true });
  await assert.rejects(
    () => identity.completeLinkWithTicket(ticket.ticket, GOOGLE_UID),
    (e) => e.message === "TICKET_EXPIRED"
  );
});

/* ───────── 17. 失敗したときに番号を増やさない ───────── */

test("17. サーバー/通信が落ちても、新しいパスポートを発行しない", async () => {
  const { db, identity } = setup();
  db._breakAll("NETWORK_DOWN");
  await assert.rejects(() => identity.resolveForUid(LINE_UID));
  db._repair();
  assert.equal(db._count("sp_identities"), 0, "失敗したときは何も作らない");

  // 直ったら1つだけ作られる
  const out = await identity.resolveForUid(LINE_UID);
  assert.equal(db._count("sp_identities"), 1);
  assert.equal(isSchoolParkId(out.spid), true);
});

test("17b. 途中で落ちて ches_accounts にだけ番号が残っていても、作り直さない", async () => {
  const { db, identity } = setup();
  const orphan = newSchoolParkId();
  await db.collection("ches_accounts").doc(LINE_UID).set({ spid: orphan }, { merge: true });

  const out = await identity.resolveForUid(LINE_UID);
  assert.equal(out.spid, orphan, "書きかけの番号を拾い直す");
  assert.equal(db._count("sp_identities"), 1);
});

/* ───────── 番号そのものの性質 ───────── */

test("番号は不透明で、ログイン方法や個人情報が読み取れない", async () => {
  const { identity } = setup();
  const line = await identity.resolveForUid(LINE_UID);
  const google = await identity.resolveForUid(GOOGLE_UID);
  const wallet = await identity.resolveForUid(WALLET_UID);

  for (const spid of [line.spid, google.spid, wallet.spid]) {
    assert.match(spid, /^SP-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    assert.equal(spid.includes("0x"), false, "ウォレットアドレスを含めない");
    assert.equal(spid.toLowerCase().includes("line"), false, "LINE の痕跡を含めない");
    assert.equal(spid.toLowerCase().includes("wallet"), false);
    assert.equal(spid.includes("@"), false, "メールアドレスを含めない");
  }
  // uid から番号が決まらない（決まると「入り方が違えば別番号」に戻ってしまう）
  assert.notEqual(line.spid, google.spid);

  // 読み違えやすい文字（I・L・O・U）は使わない
  const many = Array.from({ length: 200 }, () => newSchoolParkId()).join("");
  assert.equal(/[ILOU]/.test(many.replace(/^SP-/g, "").replace(/SP-/g, "")), false);
  // 総当たりされない程度に散らばっている
  assert.equal(new Set(Array.from({ length: 500 }, () => newSchoolParkId())).size, 500);
});

test("publicView は他人に渡せない値を含めない", async () => {
  const { identity } = setup();
  const line = await identity.resolveForUid(LINE_UID);
  const view = identity.publicView(await identity.readIdentity(line.spid));
  assert.equal(view.schoolParkId, line.spid);
  // ログイン方法の内部ID（LINEのユーザーID等）はそのまま返さない
  const json = JSON.stringify(view);
  assert.equal(json.includes("U1111"), false);
  assert.equal(view.links[0].provider, "line");
});

/* ───────── 11〜12, 18. 既存データを壊さない ───────── */

test("11. 既存の名義（walletAddress / chesAddress）を書き換えない", async () => {
  const { db, identity } = setup();
  const before = db._dump("ches_accounts");
  await identity.resolveForUid(LINE_UID);
  await identity.resolveForUid(WALLET_UID);
  const after = db._dump("ches_accounts");

  for (const uid of Object.keys(before)) {
    assert.equal(after[uid].walletAddress, before[uid].walletAddress);
    assert.equal(after[uid].chesAddress, before[uid].chesAddress);
    assert.deepEqual(after[uid].membership, before[uid].membership);
    assert.equal(after[uid].createdAt, before[uid].createdAt);
  }
  // 足したのは spid の控えだけ
  assert.equal(isSchoolParkId(after[LINE_UID].spid), true);
});

test("12. 既存ユーザーへの割り当ては冪等（何度実行しても番号が増えない）", async () => {
  const { db, identity } = setup();

  const dry = await identity.backfill({ dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.wouldIssue, 4);
  assert.equal(dry.issued, 0);
  assert.equal(db._count("sp_identities"), 0, "空打ちでは何も書かない");

  const first = await identity.backfill({ dryRun: false });
  assert.equal(first.issued, 4);
  assert.equal(db._count("sp_identities"), 4);

  const second = await identity.backfill({ dryRun: false });
  assert.equal(second.issued, 0);
  assert.equal(second.alreadyHasId, 4);
  assert.equal(db._count("sp_identities"), 4, "2回目で番号が増えてはいけない");
});

test("18. 既存の公式パス保有者は、番号が付いても入場判定が変わらない", async () => {
  const { db, identity } = setup({ paid_users: { [WALLET_ADDR]: {} } });
  const entitlement = createEntitlement({ db, identity });

  const before = await entitlement.getEntitlement(WALLET_UID, null);
  assert.equal(before.hasPass, true);

  await identity.backfill({ dryRun: false });
  entitlement.forget(WALLET_UID);

  const after = await entitlement.getEntitlement(WALLET_UID, null);
  assert.equal(after.hasPass, true, "移行後も公式パス保有者のまま");
  assert.equal(after.plan, "plus");
  assert.equal(decideSchoolParkAccess(PASS_PREVIEW_AT, { hasOfficialPass: after.hasPass }).allowed, true);
});

/* ───────── 運営が見るもの ───────── */

test("whois は番号・uid・アドレスのどれからでも引ける", async () => {
  const { identity } = setup({ paid_users: { [WALLET_ADDR]: {} } });
  const mine = await identity.resolveForUid(WALLET_UID);

  const bySpid = await identity.whois({ spid: mine.spid });
  const byUid = await identity.whois({ uid: WALLET_UID });
  const byAddr = await identity.whois({ address: WALLET_ADDR });
  assert.equal(bySpid.spid, mine.spid);
  assert.equal(byUid.spid, mine.spid);
  assert.equal(byAddr.spid, mine.spid);
  assert.equal(byAddr.hasOfficialPass, true);

  const missing = await identity.whois({ spid: "SP-0000-0000-0000-0000" });
  assert.equal(missing.found, false);
});

test("存在しない番号や壊れた番号では、何も読めない", async () => {
  const { identity } = setup();
  assert.equal(await identity.readIdentity("SP-XXXX"), null);
  assert.equal(await identity.readIdentity("0x1111111111111111111111111111111111111111"), null);
  assert.equal(await identity.holdsOfficialPass("not-an-id"), false);
  assert.equal(isSchoolParkId("SP-IIII-IIII-IIII-IIII"), false, "使わない文字は弾く");
  assert.equal(isSchoolParkId("sp-abcd-abcd-abcd-abcd"), false, "小文字は弾く");
});
