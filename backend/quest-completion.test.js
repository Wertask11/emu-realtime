"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const original = Module._load;
const routes = [];
Module._load = function (name, parent, main) {
  if (name === "express") return { Router: () => ({
    post: (path, ...handlers) => routes.push({ path, handler: handlers.at(-1) }),
    get: () => {}
  }) };
  if (name === "ethers") return { utils: {
    isAddress: v => /^0x[0-9a-f]{40}$/i.test(v),
    toUtf8Bytes: v => Buffer.from(v),
    keccak256: v => "0x" + crypto.createHash("sha256").update(v).digest("hex")
  } };
  return original.call(this, name, parent, main);
};
const { createQuestCompletionRouter } = require("./quest-completion");
Module._load = original;

const address = "0x" + "a".repeat(40);
const wallet = "0x" + "b".repeat(40);
const records = new Map();
function doc(path) {
  return {
    id: path.split("/").at(-1),
    path,
    collection: name => collection(path + "/" + name),
    get: async () => snapshot(path),
    set: async value => records.set(path, value)
  };
}
function snapshot(path) {
  const data = records.get(path);
  return { id:path.split("/").at(-1), exists:!!data, data:() => data };
}
function collection(path, filters = []) {
  return {
    doc: id => doc(path + "/" + id),
    where: (field, op, value) => collection(path, filters.concat([[field, value]])),
    limit: () => collection(path, filters),
    get: async () => {
      const rows = [...records.entries()].filter(([key, row]) =>
        key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/") &&
        filters.every(([field, value]) => row[field] === value))
        .map(([key, row]) => ({ id:key.split("/").at(-1), data:() => row }));
      return { docs:rows, forEach:fn => rows.forEach(fn) };
    }
  };
}
const db = {
  collection,
  runTransaction: async fn => fn({
    get: ref => ref.get(),
    create: (ref, value) => { assert.equal(records.has(ref.path), false); records.set(ref.path, value); },
    update: (ref, patch) => records.set(ref.path, { ...records.get(ref.path), ...patch })
  })
};
createQuestCompletionRouter({ db, requireOwner: (_req, _res, next) => next(), env:{} });
const approve = routes.find(route => route.path === "/:questId/:address/approve").handler;
const publishBudget = routes.find(route => route.path === "/:questId/budget").handler;
function reply() {
  const result = { status:200 };
  return { result, res: {
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return result; }
  } };
}
function request(questId = "quest-001", who = address) {
  const { res } = reply();
  return approve({ params:{questId,address:who}, identity:{walletAddress:wallet} }, res);
}
function budget(questId, body) {
  const { res } = reply();
  return publishBudget({ params:{questId}, body, identity:{walletAddress:wallet} }, res);
}
function seed() {
  records.clear();
  records.set("sp_quests/quest-001", { series:"general",questNumber:1,guildId:"learn",title:"試して残す" });
  records.set("sp_quests/quest-001/commits/" + address, { name:"member" });
  ["やってみた","つまずいた","気づいた"].forEach((kind, i) =>
    records.set("sp_quests/quest-001/logs/log-" + i, {author:address,kind}));
  records.set("sp_wisdom/card-1", {questId:"quest-001",author:address,insight:"分かった"});
  records.set("ches_accounts/user-a", {chesAddress:address,walletAddress:address,spid:"spid-a"});
  records.set("sp_identities/spid-a", {links:[{kind:"wallet",subject:wallet}]});
  records.set("emuer_v2_guild_quest_budgets/quest:quest-001",
    {status:"published",scopeType:"quest",scopeId:"quest-001",totalEmuer:10000,perPersonEmuer:100,allocatedEmuer:0});
}
/* LEARN #001 以外のクエストを1本置く。前はこれが弾かれていた。 */
function seedOther(quest, budgetRow) {
  seed();
  records.set("sp_quests/quest-002", Object.assign(
    { series:"general", questNumber:2, branch:1, stage:"実践", guildId:"work", title:"提案資料5枚" }, quest || {}));
  records.set("sp_quests/quest-002/commits/" + address, { name:"member" });
  ["やってみた","つまずいた","気づいた"].forEach((kind, i) =>
    records.set("sp_quests/quest-002/logs/log2-" + i, {author:address,kind}));
  records.set("sp_wisdom/card-2", {questId:"quest-002",author:address,insight:"分かった"});
  if (budgetRow !== null) {
    records.set("emuer_v2_guild_quest_budgets/quest:quest-002", Object.assign(
      {status:"published",scopeType:"quest",scopeId:"quest-002",totalEmuer:2000,perPersonEmuer:200,allocatedEmuer:0},
      budgetRow || {}));
  }
}
const AT = fn => async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-02T00:00:00+09:00");
  try { await fn(); } finally { Date.now = now; }
};
test("completion reserves exactly 100 once and creates one star entitlement", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-02T00:00:00+09:00");
  try {
    seed();
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body.amountEmuer, 100);
    assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-001").allocatedEmuer, 100);
    assert.equal(records.get("sp_quests/quest-001/commits/" + address).approved, true);
    const reward = records.get("emuer_v2_rewards/" + first.body.rewardId);
    assert.equal(reward.recipient, wallet);
    assert.equal(reward.amount, "100");
    assert.equal([...records.keys()].filter(key => key.startsWith("sp_quest_certificates/")).length, 1);
    const again = await request();
    assert.equal(again.body.alreadyApproved, true);
    assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-001").allocatedEmuer, 100);
  } finally { Date.now = now; }
});
test("missing report prevents approval and spending", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-02T00:00:00+09:00");
  try {
    seed();
    records.delete("sp_quests/quest-001/logs/log-2");
    const response = await request();
    assert.equal(response.body.error, "COMPLETION_EVIDENCE_MISSING");
    assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-001").allocatedEmuer, 0);
  } finally { Date.now = now; }
});

/* ───────── 全クエスト共通にしたぶん ─────────

   前は一般 #001 の LEARN しか通さなかった（QUEST_NOT_LEARN_001）。
   だから #002 以降と特殊クエストは、予算そのものを公開できず、
   承認しても EMUER も証明書も動かなかった。 */

test("LEARN #001 以外のクエストでも完走を認められる", AT(async () => {
  seedOther();
  const r = await request("quest-002");
  assert.equal(r.status, 200);
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approved, true);
}));

test("1人あたりの額は、その予算に書いてあるものを使う", AT(async () => {
  seedOther();                                  // 実践＝200、予算にも200
  const r = await request("quest-002");
  assert.equal(r.body.amountEmuer, 200);
  assert.equal(records.get("emuer_v2_rewards/" + r.body.rewardId).amount, "200");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 200);
}));

test("古い予算（1人あたりが無い）は、段から決める", AT(async () => {
  seedOther(null, { perPersonEmuer: undefined });
  const r = await request("quest-002");
  assert.equal(r.body.amountEmuer, 200, "実践なので200のはず");
}));

test("段が無いクエストは100", AT(async () => {
  seedOther({ stage: "", branch: 0 }, { perPersonEmuer: undefined });
  const r = await request("quest-002");
  assert.equal(r.body.amountEmuer, 100);
}));

test("予算が足りなければ、認めない（引き当ても起きない）", AT(async () => {
  seedOther(null, { totalEmuer: 100, perPersonEmuer: 200 });
  const r = await request("quest-002");
  assert.equal(r.body.error, "BUDGET_EXCEEDED");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approved, undefined);
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 0);
}));

test("証明書は、そのクエストのギルドの色と番号を持つ", AT(async () => {
  seedOther();
  await request("quest-002");
  const cert = [...records.entries()].find(([k]) => k.startsWith("sp_quest_certificates/")
    && records.get(k).questId === "quest-002")[1];
  assert.equal(cert.guildId, "work");
  assert.equal(cert.guildColor, "#141310", "WORK の色になっていない");
  assert.equal(cert.questLabel, "一般 #002-1 実践");
  assert.equal(cert.amountEmuer, 200);
}));

test("特殊クエストも通る", AT(async () => {
  seedOther({ series: "special", questNumber: 1, branch: 0, stage: "", guildId: "" },
            { perPersonEmuer: 100, totalEmuer: 1000 });
  const r = await request("quest-002");
  assert.equal(r.status, 200);
  const cert = [...records.entries()].find(([k]) => k.startsWith("sp_quest_certificates/")
    && records.get(k).questId === "quest-002")[1];
  assert.equal(cert.questLabel, "特殊 #001");
  assert.equal(cert.guildColor, "#6E695C", "どのギルドにも属さないときの色になっていない");
}));

test("Quest #000 は対象外", AT(async () => {
  seed();
  records.set("sp_quests/founder-quest-000", { kind:"founder", questNumber:0, title:"#000" });
  records.set("sp_quests/founder-quest-000/commits/" + address, { name:"member" });
  const r = await request("founder-quest-000");
  assert.equal(r.body.error, "QUEST_NOT_ELIGIBLE");
}));

/* ───────── 予算の公開 ───────── */

test("予算は、どのクエストでも公開できる", AT(async () => {
  seedOther(null, null);                        // 予算なしで始める
  const r = await budget("quest-002", { perPersonEmuer: 200, totalEmuer: 2000 });
  assert.equal(r.status, 200);
  const row = records.get("emuer_v2_guild_quest_budgets/quest:quest-002");
  assert.equal(row.status, "published");
  assert.equal(row.perPersonEmuer, 200);
  assert.equal(row.totalEmuer, 2000);
  assert.match(row.title, /一般 #002-1 実践/);
  assert.match(row.conditions, /1人200 EMUER、最大10人/);
}));

test("1人あたりを入れなければ、段から決める", AT(async () => {
  seedOther(null, null);
  const r = await budget("quest-002", { totalEmuer: 2000 });
  assert.equal(r.body.perPersonEmuer, 200, "実践なので200のはず");
}));

test("総額が1人ぶんに足りない予算は作れない", AT(async () => {
  seedOther(null, null);
  const r = await budget("quest-002", { perPersonEmuer: 200, totalEmuer: 100 });
  assert.equal(r.status, 400);
  assert.equal(records.has("emuer_v2_guild_quest_budgets/quest:quest-002"), false);
}));

test("同じ額でもう一度公開しても、二重にはならない", AT(async () => {
  seedOther(null, null);
  await budget("quest-002", { perPersonEmuer: 200, totalEmuer: 2000 });
  const again = await budget("quest-002", { perPersonEmuer: 200, totalEmuer: 2000 });
  assert.equal(again.body.alreadyPublished, true);
}));

test("違う額で公開し直そうとしたら止める", AT(async () => {
  seedOther(null, null);
  await budget("quest-002", { perPersonEmuer: 200, totalEmuer: 2000 });
  const again = await budget("quest-002", { perPersonEmuer: 100, totalEmuer: 2000 });
  assert.equal(again.body.error, "BUDGET_EXISTS_DIFFERENT");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").perPersonEmuer, 200);
}));

/* ───────── 届かなかった承認に、あとから EMUER を渡す ─────────

   管理画面は、サーバーへ届かないときでも承認だけは通す（完走の記録を
   止めないため）。そのときは approved だけが立って、報酬も証明書も無い。
   前はその状態を COMPLETION_STATE_CONFLICT で止めていたので、
   予算を公開したあとで認め直しても、二度と EMUER が渡らなかった。 */

test("承認だけ先に立っていても、あとから EMUER を渡せる", AT(async () => {
  seedOther();
  records.set("sp_quests/quest-002/commits/" + address,
    { name:"member", approved:true, approvedAt: Date.parse("2026-10-01T10:00:00+09:00") });
  const r = await request("quest-002");
  assert.equal(r.status, 200);
  assert.equal(r.body.amountEmuer, 200);
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 200);
}));

test("あとから渡すときも、認めた日は動かさない", AT(async () => {
  seedOther();
  const when = Date.parse("2026-10-01T10:00:00+09:00");
  records.set("sp_quests/quest-002/commits/" + address, { name:"member", approved:true, approvedAt: when });
  await request("quest-002");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedAt, when);
  const cert = [...records.entries()].find(([k]) => k.startsWith("sp_quest_certificates/")
    && records.get(k).questId === "quest-002")[1];
  assert.equal(cert.completedAt, when, "証明書の日付が承認の日とずれている");
}));

test("引き当てた額は、参加の記録に残る（取り消せない印になる）", AT(async () => {
  seedOther();
  await request("quest-002");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).rewardEmuer, 200);
}));

test("報酬がもう予約されていれば、二重には渡さない", AT(async () => {
  seedOther();
  await request("quest-002");
  const before = records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer;
  const again = await request("quest-002");
  assert.equal(again.body.alreadyApproved, true);
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, before);
}));

test("証明書だけが先にあるときは、止める", AT(async () => {
  seedOther();
  await request("quest-002");
  /* 報酬の予約だけを消して、証明書を残す。食い違いなので触らない。 */
  const rewardKey = [...records.keys()].find(k => k.startsWith("emuer_v2_rewards/"));
  records.delete(rewardKey);
  records.set("sp_quests/quest-002/commits/" + address, { name:"member" });
  const r = await request("quest-002");
  assert.equal(r.body.error, "COMPLETION_STATE_CONFLICT");
}));
