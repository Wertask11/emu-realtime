"use strict";

/**
 * 利用資格と上限のテスト。
 *
 * ここが壊れると、お金を払っている人が使えなくなったり、
 * 払っていない人が使えてしまったりする。売上と信用に直結するので、
 * 変更したら必ず `npm test` を通してから出すこと。
 *
 * Node の標準テストランナーだけで動く。追加の依存は入れない。
 */

const test = require("node:test");
const assert = require("node:assert");
const { createEntitlement } = require("./entitlement");

const DAY = 24 * 60 * 60 * 1000;

/* Firestore の代わり。中身を差し替えながら試せるようにする。 */
function makeDb(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}), (k, v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v);
  const store = (n) => (data[n] = data[n] || {});
  return {
    _data: data,
    collection: (n) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!store(n)[id], data: () => store(n)[id] }),
        set: async (v, o) => { store(n)[id] = (o && o.merge) ? Object.assign({}, store(n)[id], v) : v; }
      }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      limit: () => ({ get: async () => {
        const s = store(n);
        const docs = Object.keys(s).map((id) => ({ id, data: () => s[id] }));
        /* 本物の QuerySnapshot は forEach を持つ。listGrants がそれを使う。
           無いと「forEach is not a function」で落ち、中身を試せない。 */
        return { docs, size: docs.length, forEach: (f) => docs.forEach(f) };
      } })
    }),
    /* 本物の Firestore のトランザクションは、同じ書類に同時に触れたとき
       順番に処理される。ここでも直列にして、その性質を再現する。
       直列にしないと、取引を使っていないコードでもテストが通ってしまう。 */
    _queue: Promise.resolve(),
    runTransaction(fn) {
      const run = this._queue.then(() => fn({
        get: async (ref) => ref.get(),
        set: async (ref, v, o) => ref.set(v, o)
      }));
      this._queue = run.catch(() => {});
      return run;
    }
  };
}

/* 施行日をまたいで試すため、時計を差し替える。 */
function at(iso, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(iso);
  return Promise.resolve(fn()).finally(() => { Date.now = real; });
}

const BEFORE = "2026-08-20T12:00:00+09:00";   // 施行前
const AFTER  = "2026-09-03T12:00:00+09:00";   // 施行後

test("施行日より前は、誰も止めない", async () => {
  const e = createEntitlement({ db: makeDb({}) });
  await at(BEFORE, async () => {
    const r = await e.consume("u1", "post");
    assert.strictEqual(r.ok, true, "見学の人でも通る");
    assert.strictEqual(r.enforcing, false);
  });
});

test("施行後、見学の人は1件も投稿できない", async () => {
  const e = createEntitlement({ db: makeDb({}) });
  await at(AFTER, async () => {
    const r = await e.consume("u1", "post");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.limit, 0);
  });
});

/* もとは「2件まで、3件目で止まる」だった。
   2件では #003（Emuに投稿し、それを報告3回ぶん紐づける）を完走できないため、
   運営の判断で5件に上げた。テストも新しい数に合わせて書き直している。 */
test("light は投稿5件まで、6件目で止まる", async () => {
  const db = makeDb({ entitlements: { u2: { plan: "light", startsAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-03-01T00:00:00.000Z" } } });
  const e = createEntitlement({ db });
  await at(AFTER, async () => {
    for (let i = 1; i <= 5; i++) {
      assert.strictEqual((await e.consume("u2", "post")).ok, true, i + "件目は通る");
    }
    const sixth = await e.consume("u2", "post");
    assert.strictEqual(sixth.ok, false, "6件目は止まる");
    assert.strictEqual(sixth.limit, 5);
  });
});

test("light は議論を立てられない", async () => {
  const db = makeDb({ entitlements: { u2: { plan: "light", startsAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-03-01T00:00:00.000Z" } } });
  const e = createEntitlement({ db });
  await at(AFTER, async () => {
    assert.strictEqual((await e.consume("u2", "discussion")).ok, false);
  });
});

test("支払い遅延では締め出さない", async () => {
  const db = makeDb({ subscriptions: { u3: { plan: "pro", status: "past_due" } } });
  const e = createEntitlement({ db });
  const ent = await e.getEntitlement("u3");
  assert.strictEqual(ent.plan, "pro", "再試行中はまだ会員のまま");
});

test("解約したら段が下がる", async () => {
  const db = makeDb({ subscriptions: { u4: { plan: "pro", status: "canceled" } } });
  const e = createEntitlement({ db });
  assert.strictEqual((await e.getEntitlement("u4")).plan, "guest");
});

test("付与が切れたら段が下がる", async () => {
  const db = makeDb({ entitlements: { u5: { plan: "light", startsAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z" } } });
  const e = createEntitlement({ db });
  assert.strictEqual((await e.getEntitlement("u5")).plan, "guest");
});

test("期限のない付与（オーナー）は生き続ける", async () => {
  const db = makeDb({ entitlements: { u6: { plan: "pro", source: "owner", startsAt: "2026-01-01T00:00:00.000Z" } } });
  const e = createEntitlement({ db });
  assert.strictEqual((await e.getEntitlement("u6")).plan, "pro");
});

test("契約と付与では、上の段を採る", async () => {
  const db = makeDb({
    subscriptions: { u7: { plan: "plus", status: "active" } },
    entitlements: { u7: { plan: "light", startsAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-03-01T00:00:00.000Z" } }
  });
  const e = createEntitlement({ db });
  assert.strictEqual((await e.getEntitlement("u7")).plan, "plus");
});

test("段の比較", () => {
  const e = createEntitlement({ db: makeDb({}) });
  assert.strictEqual(e.atLeast("pro", "plus"), true);
  assert.strictEqual(e.atLeast("plus", "pro"), false);
  assert.strictEqual(e.atLeast("guest", "light"), false);
});

test("同時に押されても上限を超えない", async () => {
  const db = makeDb({ entitlements: { u8: { plan: "light", startsAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-03-01T00:00:00.000Z" } } });
  const e = createEntitlement({ db });
  await at(AFTER, async () => {
    const results = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6, 7].map(() => e.consume("u8", "post")));
    const ok = results.filter((r) => r.ok).length;
    assert.strictEqual(ok, 5, "8回同時に押しても通るのは上限の5回だけ");
  });
});

test("最初の付与は二層になり、重なる場合は公式パスを優先する", async () => {
  const now = Date.now();
  const db = makeDb({
    ches_accounts: {
      owner:    { walletAddress: "0xOWNER", createdAt: now - 100 * DAY },
      passOnly: { walletAddress: "0xaaa",   createdAt: now - 50 * DAY },
      both:     { walletAddress: "0xbbb",   createdAt: now - 50 * DAY },
      oldUser:  { walletAddress: "0xccc",   createdAt: now - 50 * DAY },
      newUser:  { walletAddress: "0xddd",   createdAt: now + DAY }
    },
    paid_users: { "0xaaa": {}, "0xbbb": {} }
  });
  const e = createEntitlement({ db });
  const r = await e.grantInitial({ months: 6, dryRun: false, cutoff: new Date(now), ownerAddress: "0xowner" });

  assert.strictEqual(r.proTarget, 1, "オーナーは pro");
  assert.strictEqual(r.plusTarget, 2, "公式パス保有者は plus");
  assert.strictEqual(r.lightTarget, 1, "それ以外の既存の人は light");
  assert.strictEqual(r.tooNew, 1, "施行より後に来た人には配らない");

  const g = db._data.entitlements;
  assert.strictEqual(g.both.plan, "plus", "重なる場合は公式パスを優先");
  assert.strictEqual(g.owner.expiresAt, undefined, "オーナーの付与に期限はない");
  assert.ok(g.oldUser.expiresAt, "light の付与には期限がある");
  assert.strictEqual(g.newUser, undefined);
});

test("二度配っても増えない", async () => {
  const now = Date.now();
  const db = makeDb({
    ches_accounts: { a: { walletAddress: "0xccc", createdAt: now - 50 * DAY } },
    paid_users: {}
  });
  const e = createEntitlement({ db });
  await e.grantInitial({ months: 6, dryRun: false, cutoff: new Date(now) });
  const again = await e.grantInitial({ months: 6, dryRun: false, cutoff: new Date(now) });
  assert.strictEqual(again.granted, 0);
  assert.strictEqual(again.skipped, 1);
});

test("付与の基準日は、渡さなければ制限の開始日になる", async () => {
  const { ENFORCE_FROM } = require("./entitlement");
  const before = ENFORCE_FROM - 10 * DAY;   // 制限開始より前に登録
  const after = ENFORCE_FROM + 10 * DAY;    // 制限開始より後に登録
  const db = makeDb({
    ches_accounts: {
      old: { walletAddress: "0xaaa", createdAt: before },
      neo: { walletAddress: "0xbbb", createdAt: after }
    },
    paid_users: {}
  });
  const e = createEntitlement({ db });
  // 実行した時刻ではなく、決めた日（制限の開始日）が基準になること
  const r = await at("2026-10-15T12:00:00+09:00", () =>
    e.grantInitial({ months: 6, dryRun: true }));
  assert.strictEqual(r.lightTarget, 1, "制限開始より前の人だけが対象");
  assert.strictEqual(r.tooNew, 1, "あとから来た人は、いつ実行しても対象外");
  assert.strictEqual(r.cutoff, new Date(ENFORCE_FROM).toISOString());
});

test("空打ちでは書き込まない", async () => {
  const now = Date.now();
  const db = makeDb({
    ches_accounts: { a: { walletAddress: "0xccc", createdAt: now - 50 * DAY } },
    paid_users: {}
  });
  const e = createEntitlement({ db });
  const r = await e.grantInitial({ months: 6, dryRun: true, cutoff: new Date(now) });
  assert.strictEqual(r.lightTarget, 1);
  assert.strictEqual(Object.keys(db._data.entitlements || {}).length, 0, "空打ちでは1件も書かない");
});

/* ───────── 上限の数が、散らばった3か所で揃っているか ─────────

   上限は1か所では済んでいない。

     backend/entitlement.js   … サーバーの判定
     firestore.rules          … 画面を通さず直接書かれたときの最後の砦
     frontend/public/index.html … 断られたときに出す案内文

   どれか1つだけ直すと、静かに食い違う。ルールだけ古いと、
   上げたはずの上限で弾かれ続け、しかも理由は返らない（Firestore は
   どの条件で落ちたかを教えない）。案内文だけ古いと、直っているのに
   「月2件です」と出て、問い合わせになる。

   実際に light の投稿を 2 → 5 に上げたとき、3か所に散っていた。
   同じことを繰り返さないよう、ここで突き合わせる。 */
test("上限の数が entitlement.js・firestore.rules・案内文で揃っている", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const page = fs.readFileSync(
    path.join(root, "frontend", "public", "index.html"), "utf8");

  /* entitlement.js の表を、ここではなく本体から読む。
     ここに数を書き写すと、写し間違いを試すことになってしまう。 */
  const src = fs.readFileSync(path.join(__dirname, "entitlement.js"), "utf8");
  const row = function (plan) {
    const m = new RegExp("\\n\\s*" + plan + ":\\s*\\{([^}]*)\\}").exec(src);
    assert.ok(m, plan + " の行が entitlement.js に見つからない");
    const get = function (kind) {
      const k = new RegExp(kind + ":\\s*(\\d+)").exec(m[1]);
      assert.ok(k, plan + "." + kind + " が読めない");
      return Number(k[1]);
    };
    return { post: get("post"), request: get("request"), answer: get("answer") };
  };
  const light = row("light");
  const plus = row("plus");

  /* firestore.rules の limitOf。light は段 1、plus は段 2。 */
  const lo = /rank == 1\s*\?\s*\(kind == 'post' \? (\d+) : \(kind == 'request' \? (\d+) : \(kind == 'answer' \? (\d+)/
    .exec(rules.replace(/\s*\n\s*/g, " "));
  assert.ok(lo, "firestore.rules の limitOf（段1）が読めない");
  assert.equal(Number(lo[1]), light.post,
    "light の投稿が firestore.rules と食い違う（ルールが古いと、上げても弾かれ続ける）");
  assert.equal(Number(lo[2]), light.request, "light の募集が firestore.rules と食い違う");
  assert.equal(Number(lo[3]), light.answer, "light の回答が firestore.rules と食い違う");

  const hi = /kind == 'post' \? \(rank == 3 \? unlimited\(\) : (\d+)\)/
    .exec(rules.replace(/\s*\n\s*/g, " "));
  assert.ok(hi, "firestore.rules の limitOf（段2以上）が読めない");
  assert.equal(Number(hi[1]), plus.post, "plus の投稿が firestore.rules と食い違う");

  /* 断られたときの案内文。ここだけ古いと、直っているのに古い数を見せる。 */
  const cap = /plan === 'plus' \? '月(\d+)件' : '月(\d+)件'/.exec(page);
  assert.ok(cap, "index.html の案内文（月◯件）が読めない");
  assert.equal(Number(cap[1]), plus.post, "plus の案内文が実際の上限と食い違う");
  assert.equal(Number(cap[2]), light.post, "light の案内文が実際の上限と食い違う");
});

/* クエストのための投稿は、月の回数に数えない。

   #003 は「Emuに投稿し、その投稿を途中報告で紐づける」を報告3回ぶん求める。
   数に入れてしまうと light（月5件）ではほかに何も投稿できなくなる。

   ただし「数えない」を名乗るだけで通ってはいけないので、決まりの側で
   受けた印（commits）の有無を確かめている。両方が揃っていることを見る。 */
test("クエストのための投稿は回数に数えず、受けた人だけが出せる", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const page = fs.readFileSync(
    path.join(root, "frontend", "public", "index.html"), "utf8");

  /* 画面：questId があるときは回数を増やさない。 */
  assert.match(page, /if \(!_questId\) await _emuAddUsage\(_postBatch, 'post'\);/,
    "クエスト投稿でも回数を増やしている（決まり側と食い違って書き込みごと弾かれる）");
  assert.match(page, /\.\.\.\(_questId \? \{ questId: _questId \} : \{\}\)/,
    "投稿に questId を載せていない");

  /* 決まり：受けた印が無ければ通さない。 */
  const flat = rules.replace(/\s*\n\s*/g, " ");
  assert.match(flat, /function mayCreateForQuest\(addr, qid\)/,
    "firestore.rules にクエスト投稿の判定が無い");
  assert.match(flat,
    /exists\(\/databases\/\$\(database\)\/documents\/sp_quests\/\$\(qid\)\/commits\/\$\(addr\)\)/,
    "受けた印（commits）を確かめていない。questId を書くだけで通ってしまう");
  /* 先に見ること。あとに回すと、回数の記録を必ず参照してしまう。 */
  assert.ok(
    flat.indexOf("mayCreateForQuest(request.resource.data.get('address', '')")
      < flat.indexOf("|| mayCreate(request.resource.data.get('address', ''), 1, 'post')"),
    "クエストの判定を先に見ていない");
});

/* ───────── SchoolPark ID で渡せるか ─────────

   キャンペーンで「パスポートのIDを教えてください」と頼むと、
   返ってくるのは SP-XXXX-XXXX-XXXX-XXXX。パスポートの
   「番号をコピー」が渡すのがこれで、0x のアドレスではない
   （index.html の sppCopyAddress(p.spid)）。

   前は grantOne が 0x しか受け取らなかったので、
   もらった番号をそのまま管理画面に貼ると BAD_ADDRESS。
   渡す側には理由が見えず、キャンペーンがそこで止まる。

   ここの偽DBの where() は常に空を返すので、名義の引き当ては
   ches_wallets に積む（本物もまずそこを見る）。 */
function makeIdentity(map) {
  return {
    isSchoolParkId: function (v) { return /^SP-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/i.test(String(v || "")); },
    readIdentity: async function (spid) { return map[spid] || null; }
  };
}

const SPID = "SP-AAAA-BBBB-CCCC-DDDD";
const ADDR_A = "0x" + "a".repeat(40);
const ADDR_B = "0x" + "b".repeat(40);

function dbWith(addr, uid) {
  return makeDb({
    ches_wallets: { [addr]: { uid: uid } },
    ches_accounts: { [uid]: { walletAddress: addr, createdAt: Date.now() } }
  });
}

test("SchoolPark ID で渡すと、その人の名義に渡る", async () => {
  const e = createEntitlement({
    db: dbWith(ADDR_A, "u9"),
    /* 番号の側は大文字で持っていることがある。小文字に直して引く。 */
    identity: makeIdentity({ [SPID]: { addresses: ["0x" + "A".repeat(40)] } })
  });
  const out = await e.grantOne({ address: SPID, plan: "light" });
  assert.strictEqual(out.uid, "u9", "番号から本人に辿り着けていない");
  assert.strictEqual(out.address, ADDR_A);
});

test("SchoolPark ID で渡した記録には、その番号も残る", async () => {
  const e = createEntitlement({
    db: dbWith(ADDR_A, "u9"),
    identity: makeIdentity({ [SPID]: { addresses: [ADDR_A] } })
  });
  await e.grantOne({ address: SPID, plan: "light", note: "10月キャンペーン" });
  const rows = await e.listGrants(10);
  assert.ok(rows.some(function (r) { return r.spid === SPID; }), "あとから番号で辿れない");
});

test("番号にまだ名義が無いときは、見つからないのとは別に伝える", async () => {
  const e = createEntitlement({
    db: dbWith(ADDR_A, "u9"),
    identity: makeIdentity({ [SPID]: { addresses: [] } })
  });
  await assert.rejects(() => e.grantOne({ address: SPID, plan: "light" }), function (err) {
    assert.equal(err.message, "SPID_NO_ACCOUNT",
      "BAD_ADDRESS や USER_NOT_FOUND に混ぜると、渡す側は何をすればよいか分からない");
    return true;
  });
});

test("0x のアドレスは、これまでどおり渡せる（identity が無くても）", async () => {
  const e = createEntitlement({ db: dbWith(ADDR_B, "u9") });
  const out = await e.grantOne({ address: "0x" + "B".repeat(40), plan: "light" });
  assert.strictEqual(out.uid, "u9");
});

test("調べるほうも SchoolPark ID で引ける", async () => {
  /* 渡すときは SP- が通るのに調べるときは通らない、では使えない。 */
  const e = createEntitlement({
    db: dbWith(ADDR_A, "u9"),
    identity: makeIdentity({ [SPID]: { addresses: [ADDR_A] } })
  });
  const w = await e.whois(SPID);
  assert.strictEqual(w.uid, "u9", "番号から引けていない");
  assert.strictEqual(w.spid, SPID, "どの番号で引いたかを返していない");
});
