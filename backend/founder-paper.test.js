/* Quest #000 の論文の差し替え。1番目の節の本文だけを、リポジトリの版に替える。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createFounderPaperRouter, nextFounder, readPaper, PAPER_SHA256 } = require("./founder-paper");

const sha = (v) => createHash("sha256").update(v).digest("hex");

/* 試験用の偽の本文（本物の論文は使わない） */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-"));
const FILE = path.join(dir, "paper.txt");
const NEW_BODY = "School Park論文（試験用）\n\n1．要旨\nCamelliaは、試験用の一文である。";
fs.writeFileSync(FILE, NEW_BODY + "\n");
const HASH = sha(fs.readFileSync(FILE));

function founder() {
  return {
    title: "SchoolPark Quest #000", kind: "founder", questNumber: 0, owner: "0xabc",
    founderVersion: 1, founderHash: "old",
    founderSections: [
      { title: "SchoolPark論文", body: "古い論文" },
      { title: "A：取り込みたい要素", body: "A" },
      { title: "B：やりたいこと", body: "B" },
      { title: "起業観①", body: "1" },
      { title: "起業観②", body: "2" },
      { title: "人生観", body: "人生" }
    ]
  };
}

function fakeDb(initial) {
  const store = { "sp_quests/founder-quest-000": initial };
  const ref = (p) => ({ path: p, get: async () => ({ exists: !!store[p], data: () => store[p] }) });
  return {
    store,
    collection: (c) => ({ doc: (id) => ref(c + "/" + id) }),
    runTransaction: async (fn) => fn({
      get: (r) => r.get(),
      update: (r, patch) => { store[r.path] = { ...store[r.path], ...patch }; }
    })
  };
}

function route(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  return layer.route.stack.at(-1).handle;
}
async function call(handler) {
  const out = { status: 200 };
  await handler({}, { status(c) { out.status = c; return this; }, json(v) { out.body = v; return out; } });
  return out;
}
const pass = (_req, _res, next) => next();

test("リポジトリの論文ファイルは、記録してあるハッシュと一致する（途中で切れていない）", () => {
  const body = readPaper();
  assert.ok(body.startsWith("School Park論文"), "頭が違う");
  assert.ok(body.includes("3.8　Camellia――今日の自分を知り、自分で選ぶための領域"), "Camellia の節が無い");
  assert.ok(body.endsWith("#SchoolPark"), "終わりまで入っていない");
  assert.equal(sha(fs.readFileSync(path.join(__dirname, "founder", "schoolpark-paper.txt"))), PAPER_SHA256);
});

test("ハッシュが違うファイルは使わない", () => {
  assert.throws(() => readPaper(FILE, "0".repeat(64)), /PAPER_HASH_MISMATCH/);
});

test("1番目の節（SchoolPark論文）の本文だけを替え、ほかの5つの節には触らない", async () => {
  const db = fakeDb(founder());
  const r = await call(route(createFounderPaperRouter({ db, requireOwner: pass, file: FILE, expected: HASH }), "post", "/paper/apply"));
  assert.equal(r.status, 200, String(r.body && r.body.error));
  assert.equal(r.body.updated, true);
  assert.equal(r.body.version, 2);
  const after = db.store["sp_quests/founder-quest-000"];
  assert.equal(after.founderSections.length, 6);
  assert.equal(after.founderSections[0].title, "SchoolPark論文");
  assert.equal(after.founderSections[0].body, NEW_BODY, "本文が1文字でも違う");
  assert.deepEqual(after.founderSections.slice(1), founder().founderSections.slice(1), "ほかの節が変わっている");
  /* #000 のほかの欄（題名・番号・持ち主）はそのまま */
  assert.equal(after.title, "SchoolPark Quest #000");
  assert.equal(after.questNumber, 0);
  assert.equal(after.owner, "0xabc");
  assert.equal(after.founderVersion, 2);
  assert.equal(after.founderHash, sha(JSON.stringify({ version: 2, sections: after.founderSections })));
});

test("もう新しい版なら、何も書かない（何度押しても版は上がらない）", async () => {
  const db = fakeDb(founder());
  const router = createFounderPaperRouter({ db, requireOwner: pass, file: FILE, expected: HASH });
  await call(route(router, "post", "/paper/apply"));
  const again = await call(route(router, "post", "/paper/apply"));
  assert.equal(again.body.updated, false);
  assert.equal(db.store["sp_quests/founder-quest-000"].founderVersion, 2);
});

test("#000 が無い・1番目が論文でないときは、書かずに止まる", async () => {
  const none = await call(route(createFounderPaperRouter({ db: fakeDb(undefined), requireOwner: pass, file: FILE, expected: HASH }), "post", "/paper/apply"));
  assert.equal(none.status, 409);
  const odd = founder(); odd.founderSections = [{ title: "人生観", body: "x" }];
  assert.throws(() => nextFounder(odd, NEW_BODY), /PAPER_SECTION_MISSING/);
});

test("運営でなければ通さない（requireOwner を通る）", async () => {
  const db = fakeDb(founder());
  const deny = (_req, res) => res.status(403).json({ error: "OWNER_REQUIRED" });
  const router = createFounderPaperRouter({ db, requireOwner: deny, file: FILE, expected: HASH });
  const layer = router.stack.find((l) => l.route && l.route.path === "/paper/apply");
  assert.equal(layer.route.stack[0].handle, deny, "運営の確かめが先頭に無い");
  assert.equal(db.store["sp_quests/founder-quest-000"].founderVersion, 1);
});

test("サーバーに、運営だけの窓口としてつながっている", () => {
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.ok(src.includes('app.use("/api/schoolpark/founder", require("./founder-paper").createFounderPaperRouter({ db, requireOwner }));'));
});
