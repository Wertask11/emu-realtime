/* みてみるで使った報酬（status: spent）には、受け取りの署名を出さない。
   出してしまうと、払ったのと同じ EMUER を鎖の上でも受け取れて、二重に使える。
   署名を出すときは期限を報酬に書き、みてみるはその期限まで報酬を選ばない。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeFirestore } = require("../fake-firestore");

const SRC = fs.readFileSync(path.join(__dirname, "router.js"), "utf8");
const SEG = SRC.slice(SRC.indexOf("async function reserveAuthorization("), SRC.indexOf("function reactionKey("));

function load(db) {
  const ctx = vm.createContext({ db, Date, Math, Number, String, Error });
  vm.runInContext(SEG, ctx);
  return ctx.reserveAuthorization;
}

test("使用済みの報酬には署名を出さない", async () => {
  const db = makeFirestore({ emuer_v2_rewards: { r1: { recipient: "0xabc", status: "spent" } } });
  const reserve = load(db);
  await assert.rejects(reserve(db.collection("emuer_v2_rewards").doc("r1"), "0xABC"), /REWARD_SPENT/);
});

test("署名を出すと、その期限が報酬に残る。他人の報酬には出さない", async () => {
  const db = makeFirestore({ emuer_v2_rewards: { r1: { recipient: "0xabc", status: "pending" } } });
  const reserve = load(db);
  await assert.rejects(reserve(db.collection("emuer_v2_rewards").doc("r1"), "0xdef"), /REWARD_NOT_OWNED/);
  const { deadline } = await reserve(db.collection("emuer_v2_rewards").doc("r1"), "0xabc");
  assert.equal(db._dump("emuer_v2_rewards").r1.authorizedUntilMs, deadline * 1000);
  assert.ok(deadline * 1000 > Date.now() + 14 * 60 * 1000);
});
