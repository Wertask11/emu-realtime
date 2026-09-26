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
function request() {
  const result = { status:200 };
  const res = {
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return result; }
  };
  return approve({ params:{questId:"quest-001",address}, identity:{walletAddress:wallet} }, res);
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
    {status:"published",scopeType:"quest",scopeId:"quest-001",totalEmuer:10000,allocatedEmuer:0});
}
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
