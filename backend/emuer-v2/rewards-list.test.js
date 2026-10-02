/* 受け取り済みの報酬を、一覧から外す。

   10/2、一般 #001 の完走報酬を2件ぶん受け取ろうとした。
   1件目は通った。2件目を押したら MetaMask の前で落ちた。

     cannot estimate gas … reason="execution reverted"
     to=0x9c102cC3016C70767082b60196565878D9314864

   報酬は status:"pending" で作られるが、鎖の上で受け取っても
   その status を戻すところが無かった。一覧には受け取り済みのぶんが
   残り続け、その先頭をもう一度コントラクトへ送っていた。
   コントラクトは already >= totalAmount で ClaimUnavailable を返す。

   ここが緩むと、受け取れば受け取るほど一覧が詰まって、押せなくなる。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "router.js"), "utf8");
const SEG = SRC.slice(SRC.indexOf("async function unpaidOnly(docs)"),
                      SRC.indexOf('router.get("/rewards"'));
assert.ok(SEG.indexOf("claimPaid") > 0, "鎖に聞くところが見つかりません");

function big(n) {
  return { gte: (other) => BigInt(n) >= BigInt(String(other)) };
}

function stage(opts) {
  const o = opts || {};
  const seen = { asked: [], updated: [] };
  const ctx = vm.createContext({
    String, Boolean, Promise, Date, BigInt,
    contract: o.noContract ? null : {
      claimPaid: async (id) => {
        seen.asked.push(id);
        if (o.chainFails) throw new Error("rpc");
        return big((o.paid || {})[id] || 0);
      }
    },
    db: {
      collection: () => ({
        doc: (id) => ({
          update: async (patch) => { seen.updated.push({ id, patch }); }
        })
      })
    }
  });
  vm.runInContext(SEG, ctx);
  return { ctx, seen };
}

const doc = (id, amountWei) => ({ id, data: () => ({ claimId: id, amountWei, amount: "100" }) });

test("受け取り済みのものは、一覧から外す", async () => {
  const s = stage({ paid: { "0xa": "100000000000000000000" } });
  const out = await s.ctx.unpaidOnly([
    doc("0xa", "100000000000000000000"),
    doc("0xb", "100000000000000000000")
  ]);
  assert.deepEqual(out.map(r => r.id), ["0xb"], "受け取り済みが残っています");
});

test("受け取り済みのものには、Firestore にも印を付ける", async () => {
  const s = stage({ paid: { "0xa": "100000000000000000000" } });
  await s.ctx.unpaidOnly([doc("0xa", "100000000000000000000")]);
  assert.equal(s.seen.updated.length, 1, "印を付けていません");
  assert.equal(s.seen.updated[0].id, "0xa");
  assert.equal(s.seen.updated[0].patch.status, "claimed");
  assert.ok(s.seen.updated[0].patch.claimedAt, "いつ受け取ったかが残っていません");
});

test("まだのものには、印を付けない", async () => {
  const s = stage({ paid: {} });
  const out = await s.ctx.unpaidOnly([doc("0xa", "100000000000000000000")]);
  assert.deepEqual(out.map(r => r.id), ["0xa"]);
  assert.equal(s.seen.updated.length, 0, "まだなのに受け取り済みにしています");
});

test("途中までしか払われていなければ、残す", async () => {
  /* 月の上限やトレジャリー残高で、一度に全額出ないことがある。
     コントラクトは残りをあとから出せるので、一覧に残す。 */
  const s = stage({ paid: { "0xa": "40000000000000000000" } });
  const out = await s.ctx.unpaidOnly([doc("0xa", "100000000000000000000")]);
  assert.deepEqual(out.map(r => r.id), ["0xa"], "残りが受け取れなくなります");
  assert.equal(s.seen.updated.length, 0);
});

test("ちょうど全額なら、外す", async () => {
  const s = stage({ paid: { "0xa": "100000000000000000000" } });
  const out = await s.ctx.unpaidOnly([doc("0xa", "100000000000000000000")]);
  assert.equal(out.length, 0);
});

test("鎖に聞けなければ、外さない", async () => {
  /* 黙って隠すと、受け取れるものが消えたように見える。
     出して転ぶほうがまだ分かる。 */
  const s = stage({ chainFails: true });
  const out = await s.ctx.unpaidOnly([doc("0xa", "100000000000000000000")]);
  assert.deepEqual(out.map(r => r.id), ["0xa"]);
  assert.equal(s.seen.updated.length, 0);
});

test("繋ぎ先が無ければ、今までどおり全部返す", async () => {
  const s = stage({ noContract: true });
  const out = await s.ctx.unpaidOnly([doc("0xa", "1"), doc("0xb", "1")]);
  assert.deepEqual(out.map(r => r.id), ["0xa", "0xb"]);
  assert.equal(s.seen.asked.length, 0, "繋ぎ先が無いのに聞いています");
});

test("額が入っていないものは、聞かずに残す", async () => {
  const s = stage({});
  const out = await s.ctx.unpaidOnly([{ id: "0xa", data: () => ({ claimId: "0xa" }) }]);
  assert.deepEqual(out.map(r => r.id), ["0xa"]);
  assert.equal(s.seen.asked.length, 0);
});

test("聞くのは claimId。無ければ書類の名前を使う", async () => {
  const s = stage({});
  await s.ctx.unpaidOnly([
    { id: "docA", data: () => ({ claimId: "0xclaim", amountWei: "1" }) },
    { id: "0xdocB", data: () => ({ amountWei: "1" }) }
  ]);
  assert.deepEqual(Array.from(s.seen.asked).sort(), ["0xclaim", "0xdocB"]);
});

test("まとめて聞く（1件ずつ順番に待たない）", () => {
  assert.ok(SEG.indexOf("Promise.all") > 0, "順番に聞くと、件数ぶん遅くなります");
});

test("印を付けるのに失敗しても、一覧は返す", async () => {
  const s = stage({ paid: { "0xa": "100000000000000000000" } });
  s.ctx.db.collection = () => ({ doc: () => ({ update: async () => { throw new Error("no"); } }) });
  const out = await s.ctx.unpaidOnly([
    doc("0xa", "100000000000000000000"),
    doc("0xb", "100000000000000000000")
  ]);
  assert.deepEqual(out.map(r => r.id), ["0xb"]);
});

test("一覧の口は、外したあとのものを返す", () => {
  const i = SRC.indexOf('router.get("/rewards"');
  const seg = SRC.slice(i, i + 900);
  assert.ok(seg.indexOf("await unpaidOnly(rewards.docs)") > 0, "外していません");
  assert.ok(seg.indexOf('status", "==", "pending"') > 0, "pending で絞るのをやめています");
});
