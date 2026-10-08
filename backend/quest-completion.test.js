"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
/* 本物の ethers を先に捕まえておく。差し替えの中から使う。

   差し替えの utils に getAddress が無かったため、アドレスの表記ゆれを
   見分けるところ（addressForms）が本番と違う動きをしていた。
   本番では使えるのに、試験では使えない。それでは試験にならない。 */
const realEthers = require("ethers");
const original = Module._load;
const routes = [];
Module._load = function (name, parent, main) {
  if (name === "express") return { Router: () => ({
    post: (path, ...handlers) => routes.push({ path, method:"post", handler: handlers.at(-1) }),
    /* GET も拾う。前は捨てていたので、読み取りの口を一度も試せなかった。
       既存の find は path だけで引いているが、同じ path を GET と POST の
       両方で登録しているところは無いので、そのままで当たる。 */
    get: (path, ...handlers) => routes.push({ path, method:"get", handler: handlers.at(-1) })
  }) };
  if (name === "ethers") return { utils: {
    isAddress: v => /^0x[0-9a-f]{40}$/i.test(v),
    toUtf8Bytes: v => Buffer.from(v),
    keccak256: v => "0x" + crypto.createHash("sha256").update(v).digest("hex"),
    /* ここだけは本物を使う。チェックサム表記は決まった作り方があり、
       偽物で作ると本番と違う文字列になる。 */
    getAddress: v => realEthers.utils.getAddress(v)
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
let _autoId = 0;
function collection(path, filters = []) {
  return {
    doc: id => doc(path + "/" + id),
    /* addDoc 相当。自動のIDで1件足す。 */
    add: async value => {
      const id = "auto-" + (++_autoId);
      records.set(path + "/" + id, value);
      return { id, path: path + "/" + id };
    },
    /* in は配列のどれかに当たれば一致。== は1つだけ。
       本物と同じにしておかないと、表記ゆれの試験が通ってしまう。 */
    where: (field, op, value) => collection(path, filters.concat([[field, value, op]])),
    limit: () => collection(path, filters),
    get: async () => {
      const rows = [...records.entries()].filter(([key, row]) =>
        key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/") &&
        filters.every(([field, value, op]) => op === "in"
          ? (Array.isArray(value) && value.includes(row[field]))
          : row[field] === value))
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
let emuerActive = true;
createQuestCompletionRouter({ db, requireOwner: (_req, _res, next) => next(),
  requireFirebaseUser: (_req, _res, next) => next(), env:{}, emuerEnabled: () => emuerActive });
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
test("EMUER v2 停止中はクエスト完走報酬を付与しない", async () => {
  seed();
  const previous = emuerActive;
  emuerActive = false;
  try {
    const result = await request();
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "EMUER_V2_NOT_ACTIVE");
    assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-001").allocatedEmuer, 0);
    assert.equal([...records.keys()].some(key => key.startsWith("emuer_v2_rewards/")), false);
  } finally {
    emuerActive = previous;
  }
});

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
    /* もう一度押したときは「新しい周回が無い」と答える。
       前は alreadyApproved と答えていたが、周回を数えるようになったので、
       運営には「この人はもう全部認めてある」と分かるほうがよい。 */
    const again = await request();
    assert.equal(again.body.error, "NO_NEW_ROUND");
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
  assert.equal(again.body.error, "NO_NEW_ROUND", "新しい周回が無いと言っていない");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, before,
    "二重に引き当てている");
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

/* ───────── 周回（同じクエストを2回3回やる） ─────────

   報告はクエストに積み上がるが、知恵カードは周回ごとに別の記録として
   残る。だから知恵カードの枚数がそのまま周回数になる。
   前は「1枚でもあるか」しか見ていなかったので、2周目以降は承認する
   相手が無く、完走も増えず、EMUER も渡らなかった。 */

function addWisdom(questId, n) {
  for (let i = 0; i < n; i += 1)
    records.set("sp_wisdom/card-" + questId + "-" + i, {questId, author:address, insight:"分かった"});
}

test("2周目も認められる（EMUERももう一度渡る）", AT(async () => {
  seedOther();
  addWisdom("quest-002", 2);                       // 2周ぶんの知恵カード
  const first = await request("quest-002");
  assert.equal(first.body.round, 1);
  const second = await request("quest-002");
  assert.equal(second.status, 200, "2周目が通らない");
  assert.equal(second.body.round, 2);
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedRounds, 2);
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 400,
    "2周ぶん引き当てていない");
}));

test("周回ごとに、別の報酬と別の証明書ができる", AT(async () => {
  seedOther();
  addWisdom("quest-002", 2);
  await request("quest-002");
  await request("quest-002");
  const rewards = [...records.keys()].filter(k => k.startsWith("emuer_v2_rewards/"));
  const certs = [...records.keys()].filter(k => k.startsWith("sp_quest_certificates/"));
  assert.equal(rewards.length, 2, "報酬が1件しかない");
  assert.equal(certs.length, 2, "証明書が1件しかない");
  const byRound = certs.map(k => records.get(k)).filter(c => c.questId === "quest-002")
    .map(c => c.round).sort();
  assert.deepEqual(byRound, [1, 2]);
}));

test("知恵カードが1枚しかなければ、2周目は認められない", AT(async () => {
  seedOther();                                     // 知恵カード1枚
  await request("quest-002");
  const again = await request("quest-002");
  assert.equal(again.body.error, "NO_NEW_ROUND");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 200,
    "二重に引き当てている");
}));

test("予算が尽きたら、周回でも止まる", AT(async () => {
  seedOther(null, { totalEmuer: 200, perPersonEmuer: 200 });
  addWisdom("quest-002", 3);
  const first = await request("quest-002");
  assert.equal(first.status, 200);
  const second = await request("quest-002");
  assert.equal(second.body.error, "BUDGET_EXCEEDED");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedRounds, 1);
}));

test("1周目の鍵は、今までと同じままにする", AT(async () => {
  /* すでに出してある報酬と証明書を作り直さないため。 */
  seedOther();
  const a = await request("quest-002");
  const id = a.body.rewardId;
  records.delete("sp_quests/quest-002/commits/" + address);
  records.set("sp_quests/quest-002/commits/" + address, { name:"member" });
  records.delete("emuer_v2_rewards/" + id);
  const certKey = [...records.keys()].find(k => k.startsWith("sp_quest_certificates/"));
  records.delete(certKey);
  const b = await request("quest-002");
  assert.equal(b.body.rewardId, id, "1周目の鍵が変わっている");
}));

test("届かないまま通した承認は、まだ1周も払っていない扱いにする", AT(async () => {
  /* approved の印だけが立っている状態。approvedRounds は無い。 */
  seedOther();
  records.set("sp_quests/quest-002/commits/" + address,
    { name:"member", approved:true, approvedAt: Date.parse("2026-10-01T10:00:00+09:00") });
  const r = await request("quest-002");
  assert.equal(r.status, 200, "あとから渡す道が塞がっている");
  assert.equal(r.body.round, 1);
}));

/* ───────── 周回ぶんの証明書を受け取れるか ─────────

   承認は周回ごとに証明書を作る。鍵に round が入るのは2周目以降だけで、
   1周目には付かない（すでに出してある1周目を作り直さないため）。

   受け取る側は round を付けずに1つだけ探していたので、
   2周目以降の証明書は作られても永久に見つからなかった。
   「2周目を認めたのに証明書が来ない」は、ここが原因になる。

   本物の発行（Polygon への mint）までは試さない。
   ここで見たいのは「その周の証明書を見つけられるか」だけなので、
   見つけたあとの WALLET_REQUIRED / CERTIFICATE_NOT_DEPLOYED まで
   進めば通ったことになる。404（NOT_COMPLETED）なら見つけられていない。 */
const claim = routes.find(route => route.path === "/:questId/certificate/claim").handler;

function claimFor(questId = "quest-001", spid = "spid-a") {
  const { res } = reply();
  return claim({ params: { questId }, identity: { account: { spid } } }, res);
}

test("2周目の証明書も見つけられる", AT(async () => {
  seed();
  await request();                       // 1周目
  records.set("sp_wisdom/card-1b", { questId:"quest-001", author:address, insight:"2周目" });
  await request();                       // 2周目
  const certs = [...records.keys()].filter(k => k.startsWith("sp_quest_certificates/"));
  assert.equal(certs.length, 2, "周回ぶんの証明書が作られていない");

  /* 1周目を受け取り済みにして、2周目だけが残っている状態にする。 */
  const rows = certs.map(k => [k, records.get(k)]);
  const first = rows.find(([, v]) => (Number(v.round) || 1) === 1);
  records.set(first[0], Object.assign({}, first[1], { status:"minted", tokenId:"1", txHash:"0x1" }));

  const out = await claimFor();
  assert.notEqual(out.status, 404,
    "2周目の証明書を見つけられていない（前はここで NOT_COMPLETED になっていた）");
  assert.notEqual(out.body && out.body.alreadyMinted, true,
    "まだ受け取っていない2周目があるのに、受け取り済みとして返している");
}));

test("全部受け取り済みなら、受け取り済みとして返す", AT(async () => {
  seed();
  await request();
  const k = [...records.keys()].find(x => x.startsWith("sp_quest_certificates/"));
  records.set(k, Object.assign({}, records.get(k), { status:"minted", tokenId:"7", txHash:"0x7" }));
  const out = await claimFor();
  assert.equal(out.status, 200);
  assert.equal(out.body.alreadyMinted, true);
  assert.equal(out.body.tokenId, "7");
}));

test("完走していないクエストは、これまでどおり断る", AT(async () => {
  seed();
  const out = await claimFor("quest-999");
  assert.equal(out.status, 404);
  assert.equal(out.body.error, "NOT_COMPLETED");
}));

/* ───────── 限定星 ─────────

   クエストの完走とは別に、運営が配る星。特殊 #002（解剖フェス）の
   「来た人全員」に配るためのもの。

   作りは証明書と同じ「先に記録、ウォレットができてから発行」。
     1. 運営が配ると sp_stars/{key} に記録ができる（鍵は spid）
     2. 星空にはこの記録から出る。ウォレットは要らない
     3. ウォレットを連携した人が「NFTで受け取る」を押すと発行される
     4. 受け取らなくても記録は消えない

   ここで見たいのは 1・2・4。3（Polygon への mint）までは試さない。 */
const grantStar = routes.find(r => r.path === "/stars/grant").handler;
const myStars  = routes.find(r => r.path === "/stars/mine").handler;
const claimStar = routes.find(r => r.path === "/stars/:starId/claim").handler;
const SPID = "SP-AAAA-BBBB-CCCC-DDDD";

function grant(body) {
  const { res } = reply();
  return grantStar({ body, identity:{ walletAddress: wallet } }, res);
}
function mine(spid = SPID) {
  const { res } = reply();
  return myStars({ identity:{ account:{ spid } } }, res);
}
function claimStarFor(starId = "fes-2026-10", spid = SPID) {
  const { res } = reply();
  return claimStar({ params:{ starId }, identity:{ account:{ spid } } }, res);
}

test("限定星は、ウォレットが無くても配れる", async () => {
  records.clear();
  const out = await grant({ starId:"fes-2026-10", spid:SPID, label:"解剖フェス 2026", color:"#D4A843" });
  assert.equal(out.status, 200);
  assert.equal(out.body.already, false);
  const row = records.get("sp_stars/" + out.body.key);
  assert.equal(row.spid, SPID, "鍵は SchoolPark ID で持つ（ウォレットではない）");
  assert.equal(row.status, "pending", "配った時点ではまだ発行していない");
});

test("二度配っても増えない", async () => {
  records.clear();
  const first = await grant({ starId:"fes-2026-10", spid:SPID, label:"解剖フェス 2026" });
  const again = await grant({ starId:"fes-2026-10", spid:SPID, label:"解剖フェス 2026" });
  assert.equal(again.body.already, true);
  assert.equal(again.body.key, first.body.key, "同じ人・同じ星なら同じ鍵になる");
  assert.equal([...records.keys()].filter(k => k.startsWith("sp_stars/")).length, 1);
});

test("星の種類の名前が変なものは断る", async () => {
  records.clear();
  assert.equal((await grant({ starId:"", spid:SPID })).status, 400);
  assert.equal((await grant({ starId:"Fes 2026", spid:SPID })).status, 400);
  assert.equal((await grant({ starId:"fes-2026-10", spid:"ないID" })).status, 400);
  assert.equal([...records.keys()].filter(k => k.startsWith("sp_stars/")).length, 0);
});

test("自分の限定星は、ウォレットが無くても読める（星空はここから出る）", async () => {
  records.clear();
  await grant({ starId:"fes-2026-10", spid:SPID, label:"解剖フェス 2026", color:"#D4A843" });
  const out = await mine();
  assert.equal(out.status, 200);
  assert.equal(out.body.stars.length, 1);
  assert.equal(out.body.stars[0].label, "解剖フェス 2026");
  assert.equal(out.body.stars[0].minted, false);
});

test("他人の星は出てこない", async () => {
  records.clear();
  await grant({ starId:"fes-2026-10", spid:SPID });
  const out = await mine("SP-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  assert.equal(out.body.stars.length, 0);
});

test("ウォレットが無いと受け取れないが、星の記録は消えない", async () => {
  records.clear();
  const g = await grant({ starId:"fes-2026-10", spid:SPID });
  records.set("sp_identities/" + SPID, { links: [] });      /* ウォレット未連携 */
  const out = await claimStarFor();
  assert.equal(out.status, 409);
  assert.equal(out.body.error, "WALLET_REQUIRED");
  assert.equal(records.get("sp_stars/" + g.body.key).status, "pending",
    "受け取れなかったときに記録を触っている（星が消える）");
});

test("配られていない星は受け取れない", async () => {
  records.clear();
  const out = await claimStarFor();
  assert.equal(out.status, 404);
  assert.equal(out.body.error, "STAR_NOT_GRANTED");
});

test("受け取り済みなら、そう返す", async () => {
  records.clear();
  const g = await grant({ starId:"fes-2026-10", spid:SPID });
  records.set("sp_stars/" + g.body.key,
    Object.assign({}, records.get("sp_stars/" + g.body.key),
      { status:"minted", tokenId:"5", txHash:"0x5" }));
  const out = await claimStarFor();
  assert.equal(out.status, 200);
  assert.equal(out.body.alreadyMinted, true);
  assert.equal(out.body.tokenId, "5");
});

test("限定星は、包括ルールの素通しから外してある", () => {
  /* 外していないと、誰でも自分に星を書き込めてしまう。
     書けるということは、そのままNFTまで発行できるということ。 */
  const fs = require("node:fs");
  const path = require("node:path");
  const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  assert.match(rules, /coll != 'sp_stars'/,
    "sp_stars が包括ルールの除外に入っていない（誰でも星を配れてしまう）");
});

/* 誰に配ったか。イベント当日に人数と重複を見るためのもの。 */
const listStars = routes.find(r => r.path === "/stars/list").handler;
function listFor(starId) {
  const { res } = reply();
  return listStars({ query: starId ? { starId } : {} }, res);
}

test("配った人を、星の種類で絞って見られる", async () => {
  records.clear();
  await grant({ starId:"fes-2026-10", spid:SPID, label:"解剖フェス 2026" });
  await grant({ starId:"fes-2026-10", spid:"SP-BBBB-BBBB-BBBB-BBBB", label:"解剖フェス 2026" });
  await grant({ starId:"other-2026", spid:SPID, label:"別の催し" });

  const all = await listFor();
  assert.equal(all.body.total, 3, "全部が出ていない");

  const fes = await listFor("fes-2026-10");
  assert.equal(fes.body.total, 2, "種類で絞れていない");
  assert.ok(fes.body.stars.every(x => x.starId === "fes-2026-10"));
});

test("配った人の一覧に、まだ受け取っていないことが出る", async () => {
  records.clear();
  await grant({ starId:"fes-2026-10", spid:SPID, note:"10/25 来場" });
  const out = await listFor("fes-2026-10");
  assert.equal(out.body.stars[0].minted, false);
  assert.equal(out.body.stars[0].note, "10/25 来場", "メモが消えている");
});

/* ═══════════════════════════════════════════════════════════════
   知恵カードは、やり終えてからしか置けない

   「知恵カードは、完了したクエストからしか生まれない」。
   前はこれを守っている場所が無かった。画面は一文が空かどうかだけ、
   ルールは「受けているか」だけ。受けるだけで何枚でも置けて、
   信用スコアの「知恵 ×5」が働かずに積めた。

   「完了した」は「承認済み」とは読めない。承認のほうが知恵カードを
   完走の証拠として要求するので、循環して両方とも起きなくなる。
   守るのは「やってみた・つまずいた・気づいた が揃っている」。
   ═══════════════════════════════════════════════════════════════ */
const putWisdom = routes.find(r => r.path === "/:questId/wisdom").handler;

function wisdomReply() {
  const result = { status: 200 };
  return { result, res: {
    set() { return this; },
    status(c) { result.status = c; return this; },
    json(v) { result.body = v; return result; } } };
}
async function putCard(body, questId = "quest-001", spid = "spid-a") {
  const { result, res } = wisdomReply();
  await putWisdom({ params: { questId }, body: body || { insight: "分かった" },
    identity: { account: { spid }, uid: "user-a" } }, res);
  return result;
}
/* 受けてはいるが、報告は1本も無い状態。 */
function seedTaken() {
  records.clear();
  records.set("sp_identities/spid-a", { addresses: [address] });
  records.set("sp_quests/quest-001",
    { series:"general", questNumber:1, guildId:"learn", title:"試して残す" });
  records.set("sp_quests/quest-001/commits/" + address, { name:"member" });
}
function seedReports(kinds) {
  kinds.forEach((kind, i) =>
    records.set("sp_quests/quest-001/logs/log-" + i, { author: address, kind }));
}
const cards = () => [...records.keys()].filter(k => k.startsWith("sp_wisdom/"));

test("報告が3本そろっていれば置ける", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  const out = await putCard({ insight: "14日続けると分かる" });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(cards().length, 1);
  assert.equal(records.get(cards()[0]).insight, "14日続けると分かる");
});

test("受けただけでは置けない（前はこれが通っていた）", async () => {
  seedTaken();
  const out = await putCard();
  assert.equal(out.status, 409);
  assert.equal(out.body.error, "REPORTS_MISSING");
  assert.equal(cards().length, 0, "働かずに信用スコアを積めてしまう");
});

test("足りない報告の種類を、名前で返す", async () => {
  seedTaken(); seedReports(["やってみた"]);
  const out = await putCard();
  assert.equal(out.body.error, "REPORTS_MISSING");
  assert.deepEqual([...out.body.missing].sort(), ["つまずいた","気づいた"].sort());
});

test("2本までではまだ置けない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた"]);
  assert.equal((await putCard()).status, 409);
  assert.equal(cards().length, 0);
});

test("他人の報告では数えない", async () => {
  seedTaken();
  ["やってみた","つまずいた","気づいた"].forEach((kind, i) =>
    records.set("sp_quests/quest-001/logs/other-" + i,
      { author: "0x" + "9".repeat(40), kind }));
  const out = await putCard();
  assert.equal(out.body.error, "REPORTS_MISSING", "他人の働きで置けてはいけない");
});

test("受けていないクエストには置けない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  records.delete("sp_quests/quest-001/commits/" + address);
  const out = await putCard();
  assert.equal(out.status, 409);
  assert.equal(out.body.error, "NOT_TAKEN");
});

test("自分のパスポートに無い名義の完走は、持ってこられない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  records.set("sp_identities/spid-a", { addresses: ["0x" + "e".repeat(40)] });
  assert.equal((await putCard()).body.error, "NOT_TAKEN");
});

test("一文が無い・長すぎるものは断る", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  assert.equal((await putCard({ insight: "" })).body.error, "INSIGHT_REQUIRED");
  assert.equal((await putCard({ insight: "  " })).body.error, "INSIGHT_REQUIRED");
  assert.equal((await putCard({ insight: "あ".repeat(201) })).body.error, "INSIGHT_TOO_LONG");
  assert.equal(cards().length, 0);
});

test("Quest #000 には置けない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  const out = await putCard({ insight: "x" }, "founder-quest-000");
  assert.equal(out.body.error, "QUEST_NOT_ELIGIBLE");
});

test("パスポートが無ければ置けない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  const out = await putCard({ insight: "x" }, "quest-001", "");
  assert.equal(out.body.error, "PASSPORT_LINK_REQUIRED");
});

test("書いた人は名義から決める。画面の言い値では決めない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  await putCard({ insight: "x", author: "0x" + "f".repeat(40), spid: "spid-z" });
  const row = records.get(cards()[0]);
  assert.equal(row.author, address, "他人の名前で置けてはいけない");
  assert.equal(row.spid, "spid-a");
});

test("棚は出どころから決める。画面の言い値では決めない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  await putCard({ insight: "x", tag: "WEB3" });
  assert.equal(records.get(cards()[0]).tag, "LEARN", "ギルドの棚に入れること");

  records.delete(cards()[0]);
  await putCard({ insight: "y", fromPostId: "post-1", tag: "WEB3" });
  assert.equal(records.get(cards()[0]).tag, "Emu", "Emuの投稿からなら Emu の棚");
});

test("長すぎる欄は切り詰める", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  await putCard({ insight: "x", knowledge: "あ".repeat(500),
    experiment: "い".repeat(500), fromPostId: "p".repeat(200) });
  const row = records.get(cards()[0]);
  assert.equal(row.knowledge.length, 200);
  assert.equal(row.experiment.length, 200);
  assert.equal(row.fromPostId.length, 80);
});

/* ───────── 前の周が認められるまで、次は置けない ─────────

   枚数がそのまま周回の数になる（承認の口がそう数える）。
   続けて何枚も置けると、まだ認めていない周回まで「認められる」
   ことになり、管理画面の「あと◯周」が実態とずれる。 */

function approveRound(n) {
  records.set("sp_quests/quest-001/commits/" + address,
    { name: "member", approved: true, approvedRounds: n });
}

test("2周目は、1周目が認められてから置ける", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  assert.equal((await putCard({ insight: "1周目" })).status, 200);

  const blocked = await putCard({ insight: "2周目（まだ）" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "ROUND_NOT_APPROVED");
  assert.equal(cards().length, 1, "認められる前に2枚目が置けてしまう");

  approveRound(1);
  assert.equal((await putCard({ insight: "2周目" })).status, 200);
  assert.equal(cards().length, 2, "周回ごとに1枚。承認はこの枚数を見ている");
});

test("止めたときは、いまの枚数と認められた周回を返す", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  await putCard({ insight: "1枚目" });
  const out = await putCard({ insight: "2枚目" });
  assert.equal(out.body.placed, 1);
  assert.equal(out.body.approvedRounds, 0);
});

test("3枚目も、2周目が認められるまで置けない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  await putCard({ insight: "1" }); approveRound(1);
  await putCard({ insight: "2" });
  assert.equal((await putCard({ insight: "3" })).body.error, "ROUND_NOT_APPROVED");
  approveRound(2);
  assert.equal((await putCard({ insight: "3" })).status, 200);
  assert.equal(cards().length, 3);
});

test("他人のカードは、自分の枚数に数えない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  records.set("sp_wisdom/other-1",
    { questId: "quest-001", author: "0x" + "9".repeat(40), insight: "他人" });
  assert.equal((await putCard({ insight: "1枚目" })).status, 200,
    "他人のカードで自分が止められてはいけない");
});

test("別のクエストのカードは、このクエストの枚数に数えない", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  records.set("sp_wisdom/elsewhere",
    { questId: "quest-999", author: address, insight: "よそ" });
  assert.equal((await putCard({ insight: "1枚目" })).status, 200);
});

test("すでに2周認めてある人は、3枚目から置ける（いまの記録を止めない）", async () => {
  seedTaken(); seedReports(["やってみた","つまずいた","気づいた"]);
  records.set("sp_wisdom/w1", { questId: "quest-001", author: address, insight: "1" });
  records.set("sp_wisdom/w2", { questId: "quest-001", author: address, insight: "2" });
  approveRound(2);
  assert.equal((await putCard({ insight: "3枚目" })).status, 200);
});

/* ───────── 認めてあるのに EMUER が渡っていない周回 ─────────

   10/2、実際に起きた。

   10/1 まで、このサーバーは NOT_STARTED で承認を断っていた。
   そのあいだ運営は管理画面の逃げ道を通り、Firestore へ直接
   approved と approvedRounds を書いていた。完走は記録されたが、
   報酬は1枚も引き当てられていない。

   その状態で「EMUERを渡す」を押すと、approvedRounds（2）が
   知恵カードの枚数（2）に並んでいるので NO_NEW_ROUND で断られた。
   渡すためのボタンが、渡せないと言う状態だった。 */

/* サーバーを通さずに認めた状態をつくる（管理画面の逃げ道と同じ）。 */
function approvedOffline(questId, rounds) {
  records.set("sp_quests/" + questId + "/commits/" + address,
    { name:"member", approved:true, approvedAt:1, approvedBy:wallet,
      approvedRounds:rounds, lastApprovedAt:1 });
}

test("認めてあるのに渡っていない周回には、あとから渡せる", AT(async () => {
  seedOther();
  approvedOffline("quest-002", 1);                 // 認めた印だけがある
  const r = await request("quest-002");
  assert.equal(r.status, 200, "渡せない（" + String(r.body.error) + "）");
  assert.equal(r.body.amountEmuer, 200);
  assert.equal(r.body.round, 1, "渡すのは1周目のはず");
  assert.equal(r.body.toppedUp, true, "渡しそびれとして扱っていない");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 200);
}));

test("あとから渡しても、完走の数は増えない", AT(async () => {
  seedOther();
  approvedOffline("quest-002", 1);
  await request("quest-002");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedRounds, 1,
    "やってもいない周回を認めたことになっている");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).rewardEmuer, 200,
    "渡した額が記録に残っていない");
}));

test("2周ぶん渡しそびれていたら、2回押して2周ぶん渡る", AT(async () => {
  seedOther();                                     // 知恵カード1枚
  addWisdom("quest-002", 1);                       // あわせて2枚＝2周ぶん
  approvedOffline("quest-002", 2);                 // 2周とも認めた印だけ
  const first = await request("quest-002");
  assert.equal(first.body.round, 1, "古いほうから渡していない");
  const second = await request("quest-002");
  assert.equal(second.status, 200, "2周目が渡らない");
  assert.equal(second.body.round, 2);
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 400,
    "2周ぶん引き当てていない");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedRounds, 2,
    "完走の数が動いている");
}));

test("全部渡し終えたら、そこで止まる", AT(async () => {
  seedOther();
  approvedOffline("quest-002", 1);
  await request("quest-002");
  const again = await request("quest-002");
  assert.equal(again.body.error, "NO_NEW_ROUND", "二重に渡そうとしている");
  assert.equal(records.get("emuer_v2_guild_quest_budgets/quest:quest-002").allocatedEmuer, 200);
}));

test("何周ぶん EMUER を渡したかを、参加の記録に残す（管理画面がこれで2周目のボタンを出す）", AT(async () => {
  seedOther();
  addWisdom("quest-002", 1);
  approvedOffline("quest-002", 2);
  await request("quest-002");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).rewardedRounds, 1);
  await request("quest-002");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).rewardedRounds, 2);
}));

test("運営は、周回ごとの報酬の宛先と状態を読める（読むだけ）", AT(async () => {
  seedOther();
  addWisdom("quest-002", 1);
  approvedOffline("quest-002", 2);
  await request("quest-002");                      // 1周目だけ渡す
  const before = JSON.stringify([...records.entries()]);
  const look = routes.find(route => route.path === "/:questId/:address/rewards").handler;
  const { res } = reply();
  const r = await look({ params:{ questId:"quest-002", address } }, res);
  assert.equal(r.status, 200, String(r.body && r.body.error));
  assert.equal(r.body.approvedRounds, 2);
  assert.equal(r.body.wisdomCards, 2);
  assert.equal(r.body.rounds.length, 2);
  assert.equal(r.body.rounds[0].reward.recipient, wallet, "1周目の宛先が出ていない");
  assert.equal(r.body.rounds[0].reward.status, "pending");
  assert.equal(r.body.rounds[1].reward, null, "渡していない2周目に報酬があることになっている");
  assert.equal(JSON.stringify([...records.entries()]), before, "読むだけのはずが書き換えている");
}));

test("この欄ができる前に1周ぶん渡した人は、額から1周ぶんと数えて続きを渡す", AT(async () => {
  /* 10/2 の実際の形：2周認めてあり、1周ぶんだけ渡してあって、rewardedRounds が無い。 */
  seedOther();
  addWisdom("quest-002", 1);
  approvedOffline("quest-002", 2);
  await request("quest-002");                      // 1周目を渡す
  const row = records.get("sp_quests/quest-002/commits/" + address);
  delete row.rewardedRounds;                       // 欄ができる前の記録にする
  const r = await request("quest-002");
  assert.equal(r.status, 200, "2周目が渡らない（" + String(r.body.error) + "）");
  assert.equal(r.body.round, 2);
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).rewardedRounds, 2);
}));

test("証明書をもう受け取っていても、EMUER は渡せる", AT(async () => {
  /* 10/1 前に承認 → 証明書だけ先に受け取った、という形。
     これが実際に起きた状態である。 */
  seedOther();
  approvedOffline("quest-002", 1);
  const key = require("ethers").utils.keccak256(require("ethers").utils.toUtf8Bytes(
    JSON.stringify(["schoolpark", "quest-002", "spid-a"])));
  records.set("sp_quest_certificates/" + key, { status:"claimed", round:1 });
  const r = await request("quest-002");
  assert.equal(r.status, 200, "証明書があると渡せない（" + String(r.body.error) + "）");
  assert.equal(r.body.amountEmuer, 200);
  /* 証明書は作り直さない。受け取り済みのものを pending に戻してはいけない。 */
  assert.equal(records.get("sp_quest_certificates/" + key).status, "claimed",
    "受け取り済みの証明書を書き換えている");
}));

test("予算が足りなければ、渡しそびれでも止まる", AT(async () => {
  seedOther(null, { totalEmuer: 100, perPersonEmuer: 200 });
  approvedOffline("quest-002", 1);
  const r = await request("quest-002");
  assert.equal(r.body.error, "BUDGET_EXCEEDED", "予算を超えて渡している");
}));

test("ふつうの承認は、これまでどおり完走の数を増やす", AT(async () => {
  seedOther();
  const r = await request("quest-002");
  assert.equal(r.body.round, 1);
  assert.notEqual(r.body.toppedUp, true, "ふつうの承認を渡しそびれとして扱っている");
  assert.equal(records.get("sp_quests/quest-002/commits/" + address).approvedRounds, 1);
}));

/* ───────── アドレスの表記ゆれ ─────────

   10/2、実際に起きた。「EMUERを渡す」が PASSPORT_LINK_REQUIRED で
   止まった。予算もウォレット連携も済んでいたのに。

   ches_accounts の walletAddress / chesAddress には、
   ethers.utils.getAddress が作るチェックサム表記（大文字混じり）が
   入っている。いっぽうクエストを受けた記録の文書IDは小文字である。

   Firestore の一致検索は大文字小文字を区別する。小文字だけで探すと
   どのアカウントにも当たらず、SchoolPark ID が引けない。
   ウォレットで入った人は、全員これで止まる。

   同じ落とし穴は entitlement.js で先に見つかっていて、あちらは
   addressForms で3つの形を試していた。こちらにだけ無かった。 */
const checksummed = require("ethers").utils.getAddress(address);

test("アカウントがチェックサム表記でも、本人だと分かる", AT(async () => {
  seed();
  assert.notEqual(checksummed, address, "この試験の前提（表記が違う）が崩れています");
  /* 本物と同じ形で入れ直す。 */
  records.set("ches_accounts/user-a",
    { chesAddress: checksummed, walletAddress: checksummed, spid: "spid-a" });
  const r = await request();
  assert.equal(r.status, 200, "本人を引けない（" + String(r.body.error) + "）");
  assert.equal(r.body.amountEmuer, 100);
}));

test("小文字で入っているアカウントも、これまでどおり引ける", AT(async () => {
  seed();                                          // 小文字で入っている
  const r = await request();
  assert.equal(r.status, 200, "引けなくなっている（" + String(r.body.error) + "）");
}));

test("ウォレット名義だけがチェックサム表記でも引ける", AT(async () => {
  seed();
  records.set("ches_accounts/user-a",
    { chesAddress: "", walletAddress: checksummed, spid: "spid-a" });
  const r = await request();
  assert.equal(r.status, 200, "引けない（" + String(r.body.error) + "）");
}));

test("そのアドレスのアカウントが無ければ、これまでどおり止める", AT(async () => {
  seed();
  records.delete("ches_accounts/user-a");
  const r = await request();
  assert.equal(r.body.error, "PASSPORT_LINK_REQUIRED");
}));

test("SchoolPark ID が空のアカウントは、本人と認めない", AT(async () => {
  seed();
  records.set("ches_accounts/user-a",
    { chesAddress: checksummed, walletAddress: checksummed, spid: "" });
  const r = await request();
  assert.equal(r.body.error, "PASSPORT_LINK_REQUIRED",
    "番号が無いまま渡そうとしている");
}));

test("別の番号のアカウントが2つ当たったら、止める", AT(async () => {
  seed();
  records.set("ches_accounts/user-a",
    { chesAddress: checksummed, walletAddress: checksummed, spid: "spid-a" });
  records.set("ches_accounts/user-b",
    { chesAddress: address, walletAddress: address, spid: "spid-b" });
  const r = await request();
  assert.equal(r.body.error, "PASSPORT_LINK_REQUIRED",
    "どちらの人か決まらないのに渡している");
}));
