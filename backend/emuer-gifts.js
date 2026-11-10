"use strict";
/* EMUER を「誰かを喜ばせるために使う」（11/10）。応援・協賛・投票。

   使うのは、まだ実EMUERに換えていない方の EMUER（未変換・emuer_offchain の balance）だけ。
   画面の残高の（ ）の中の数字。実EMUER（チェーンの上のトークン）は一切動かさない。
   emuer_offchain は、いまはチェーンへの変換の元にならない（変換の元は emuer_v2_unconverted_legacy の確定済みの数字）。

   C. 応援（送る型）… 知識の投稿に 1・3・5・10 EMUER を贈る。贈った分は投稿した人の未変換EMUERに入る。
   D. 協賛         … クエストに 5・10・30・50 EMUER を出し合い、完走した人へのご褒美の袋に積む。
                     完走（完走証明がある）した人は、袋から1人10 EMUERを1回だけ受け取れる（袋が空になるまで）。
   D. 投票         … 運営が作った「みんなで決める」に、1人1票。運営が決めた EMUER（0〜10）を使う。

   決めごと
   - 動かすのはいつもサーバー。金額はサーバーの決まった選択肢からだけ選ぶ。画面から来た額をそのまま使わない。
   - 残高が足りなければ動かさない（無から作らない）。自分の投稿には贈れない。
   - 応援と協賛は、合わせて1日100 EMUERまで（日本時間）。同じ requestId は1回だけ（押し直しで二重にならない）。
   - 1回の動きは、贈る人・受け取る人・記録を1つの取引で書く。監査の記録は emuer_offchain_ledger にも残す
     （知識の懸賞の移転と同じ置き場）。
   - 台帳の照合バッチ（server.js runOffchainEmuerReconcile）は、giftIn（受け取った累計）と
     giftOut（使った累計）を数えに入れる。
   - 新しい記録は emuer_v2_* の名前で置く。Firestore のルールで、サーバーしか読み書きできない。 */
const crypto = require("node:crypto");
const express = require("express");
let ethers = null;
try { ({ ethers } = require("ethers")); } catch (_) { ethers = null; }

const LEDGER = "emuer_offchain";
const AUDIT = "emuer_offchain_ledger";
const EVENTS = "emuer_v2_gift_events";
const TARGETS = "emuer_v2_gift_targets";
const DAILY = "emuer_v2_gift_daily";
const POLLS = "emuer_v2_polls";
const VOTES = "emuer_v2_poll_votes";

const CHEER_AMOUNTS = [1, 3, 5, 10];
const SPONSOR_AMOUNTS = [5, 10, 30, 50];
const DAILY_LIMIT = 100;
const SPONSOR_BONUS = 10;
const FOUNDER_QUEST_ID = "founder-quest-000";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,120}$/;

function err(code, status = 400, extra = {}) { return Object.assign(new Error(code), { code, status, extra }); }
function jstDay(ms) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function hash(text) { return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 40); }
function nameOf(identity) {
  const a = (identity && identity.account) || {};
  return String(a.displayName || a.name || "Emuer").replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 40) || "Emuer";
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function createGiftsRouter({ db, requireFirebaseUser, requireOwner, now = () => Date.now(), enabled = () => true }) {
  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const ledgerRef = (addr) => db.collection(LEDGER).doc(addr);
  const countsCache = new Map();   // postId → { at, value }
  /* もらった側に早く知らせる（11/10）。画面は20秒ごとに「届いた？」と聞きに来る。
     そのたびに Firestore を読まないよう、このサーバーで「最後に応援が届いた時刻」と
     「最後に本当に調べた時刻」を覚えておき、そのあと何も届いていなければ読まずに返す。
     サーバーが複数台・再起動でも取りこぼさないよう、5分たったら必ず本当に調べる。 */
  const lastGiftTo = new Map();    // 受け取る人のアドレス → 最後に届いた時刻
  const lastFullCheck = new Map(); // 本人のアドレス → 最後に本当に調べた時刻
  const QUICK_MS = 5 * 60 * 1000;
  function remember(map, key, value) {
    if (map.size > 20000) map.clear();
    map.set(key, value);
  }

  function fail(res, e) {
    if (e && e.code && e.status) return res.status(e.status).json({ error: e.code, ...e.extra });
    console.warn("emuer-gifts:", e && e.message);
    return res.status(500).json({ error: "GIFT_FAILED" });
  }
  function senderOf(req) {
    const addr = String((req.identity && req.identity.walletAddress) || "").toLowerCase();
    if (!ADDRESS.test(addr)) throw err("WALLET_REQUIRED", 403);
    return addr;
  }
  /* 本人のアドレス（ログインの名義と、アプリが作ったアドレスの2つ）。
     ウォレットでログインした人は、知識をどちらの名義でも書ける。 */
  function addressesOf(req) {
    const main = senderOf(req);
    const ches = String(((req.identity || {}).account || {}).chesAddress || "").toLowerCase();
    return ADDRESS.test(ches) && ches !== main ? [main, ches] : [main];
  }
  /* 応援を届ける先。投稿の名義がアプリの作ったアドレス（chesAddress）なら、
     その人がログインしている名義（walletAddress）の台帳へ届ける。
     そうしないと、ウォレットでログインしている人には「届いたよ」も出ず、受け取ったEMUERも使えない。 */
  async function receiverOf(addr) {
    const forms = [addr];
    if (ethers) { try { const c = ethers.utils.getAddress(addr); if (c !== addr) forms.push(c); } catch (_) {} }
    for (const form of forms) {
      const snap = await db.collection("ches_accounts").where("chesAddress", "==", form).limit(1).get();
      if (snap.empty) continue;
      const wallet = String((snap.docs[0].data() || {}).walletAddress || "").toLowerCase();
      return ADDRESS.test(wallet) ? wallet : addr;
    }
    return addr;
  }
  function active(req, res, next) { return enabled() ? next() : res.status(503).json({ error: "GIFTS_NOT_ACTIVE" }); }

  /* お金の動き1回分。取引の中で使う。
     from から amount を引き、to があれば足す（to が無いのは投票：使って消える）。
     残高が足りなければ止める。 */
  async function move(tx, { from, to, amount, dailyCount }) {
    const day = jstDay(now());
    const dailyRef = db.collection(DAILY).doc(from + "_" + day);
    const fs = await tx.get(ledgerRef(from));
    const ts = to ? await tx.get(ledgerRef(to)) : null;
    const dsnap = dailyCount ? await tx.get(dailyRef) : null;
    const f = fs.exists ? fs.data() || {} : {};
    const balance = num(f.balance);
    if (balance < amount) throw err("INSUFFICIENT_EMUER", 409, { balance });
    const sent = dsnap && dsnap.exists ? num((dsnap.data() || {}).sent) : 0;
    if (dailyCount && sent + amount > DAILY_LIMIT) throw err("DAILY_LIMIT", 429, { limit: DAILY_LIMIT, sent });
    return function write() {
      tx.set(ledgerRef(from), { address: from, balance: balance - amount, giftOut: num(f.giftOut) + amount, updatedAt: new Date(now()) }, { merge: true });
      if (to) {
        const t = ts.exists ? ts.data() || {} : {};
        tx.set(ledgerRef(to), { address: to, balance: num(t.balance) + amount, giftIn: num(t.giftIn) + amount, updatedAt: new Date(now()) }, { merge: true });
      }
      if (dailyCount) tx.set(dailyRef, { address: from, day, sent: sent + amount, updatedAtMs: now() }, { merge: true });
      return { balance: balance - amount, sentToday: sent + (dailyCount ? amount : 0) };
    };
  }
  function audit(tx, id, row) {
    tx.set(db.collection(AUDIT).doc("gift-" + id), { ...row, createdAt: new Date(now()) });
  }

  router.get("/config", (req, res) => res.json({ enabled: !!enabled(), cheerAmounts: CHEER_AMOUNTS, sponsorAmounts: SPONSOR_AMOUNTS,
    dailyLimit: DAILY_LIMIT, sponsorBonus: SPONSOR_BONUS }));

  router.get("/me", requireFirebaseUser, async (req, res) => {
    try {
      const addr = senderOf(req);
      const [l, d] = await Promise.all([ledgerRef(addr).get(), db.collection(DAILY).doc(addr + "_" + jstDay(now())).get()]);
      return res.json({ ok: true, balance: l.exists ? num((l.data() || {}).balance) : 0,
        sentToday: d.exists ? num((d.data() || {}).sent) : 0, dailyLimit: DAILY_LIMIT });
    } catch (e) { return fail(res, e); }
  });

  /* ── C. 応援 ── */
  router.post("/cheer", active, requireFirebaseUser, async (req, res) => {
    try {
      const from = senderOf(req);
      const b = req.body || {};
      const postId = String(b.postId || "");
      const amount = Number(b.amount);
      const requestId = String(b.requestId || "");
      if (!DOC_ID.test(postId)) throw err("INVALID_POST");
      if (!CHEER_AMOUNTS.includes(amount)) throw err("INVALID_AMOUNT");
      if (!REQUEST_ID.test(requestId)) throw err("INVALID_REQUEST");
      const id = "cheer-" + hash([from, requestId].join(":"));
      const postSnap = await db.collection("posts").doc(postId).get();
      const post = postSnap.exists ? postSnap.data() || {} : null;
      if (!post || post.deleted === true || post.status === "deleted") throw err("POST_NOT_FOUND", 404);
      const named = String(post.address || "").toLowerCase();
      if (!ADDRESS.test(named)) throw err("POST_NOT_FOUND", 404);
      if (addressesOf(req).includes(named)) throw err("OWN_POST", 409);
      const to = await receiverOf(named);
      if (to === from) throw err("OWN_POST", 409);
      const targetRef = db.collection(TARGETS).doc("post:" + postId);
      const personRef = db.collection(TARGETS).doc("post:" + postId + ":by:" + from);
      const eventRef = db.collection(EVENTS).doc(id);
      const result = await db.runTransaction(async (tx) => {
        const [ev, target, person] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(personRef)]);
        if (ev.exists) return { already: true, event: ev.data() };
        const write = await move(tx, { from, to, amount, dailyCount: true });
        const t = target.exists ? target.data() || {} : {};
        const people = num(t.people) + (person.exists ? 0 : 1);
        const total = num(t.total) + amount;
        const after = write();
        tx.set(targetRef, { kind: "post", postId, people, total, updatedAtMs: now() }, { merge: true });
        if (!person.exists) tx.set(personRef, { kind: "post-person", postId, address: from, firstAtMs: now() });
        const event = { kind: "cheer", from, to, amount, postId, postTitle: String(post.title || "").slice(0, 80),
          fromName: nameOf(req.identity), seen: false, createdAtMs: now() };
        tx.create(eventRef, event);
        audit(tx, id, { from, to, amount, reason: "cheer", postId });
        return { already: false, event, people, total, balance: after.balance, sentToday: after.sentToday };
      });
      countsCache.delete(postId);
      if (!result.already) remember(lastGiftTo, to, now());
      return res.json({ ok: true, ...result, event: undefined, amount });
    } catch (e) { return fail(res, e); }
  });

  /* 投稿ごとの応援の人数と合計。だれでも見られる（誰が贈ったかは出さない）。少しのあいだ覚えておく。 */
  router.get("/cheers", async (req, res) => {
    try {
      const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter((s) => DOC_ID.test(s)).slice(0, 40);
      const out = {};
      const miss = [];
      for (const id of ids) {
        const c = countsCache.get(id);
        if (c && now() - c.at < 60000) { if (c.value) out[id] = c.value; } else miss.push(id);
      }
      const snaps = await Promise.all(miss.map((id) => db.collection(TARGETS).doc("post:" + id).get()));
      snaps.forEach((s, i) => {
        const v = s.exists ? { people: num((s.data() || {}).people), total: num((s.data() || {}).total) } : null;
        countsCache.set(miss[i], { at: now(), value: v });
        if (v) out[miss[i]] = v;
      });
      res.set("Cache-Control", "public, max-age=30");
      return res.json({ ok: true, counts: out });
    } catch (e) { return fail(res, e); }
  });

  /* 届いた応援（まだ見ていないもの）。開いたとき・画面に戻ったとき・開いている間は20秒ごとに見る。
     ?quick=1 のときは、このサーバーで覚えている時刻から「何も届いていない」と分かれば Firestore を読まない。 */
  router.get("/inbox", requireFirebaseUser, async (req, res) => {
    try {
      const mine = addressesOf(req);
      const startedAt = now();
      const checked = lastFullCheck.get(mine[0]);
      if (String(req.query.quick || "") === "1" && checked && startedAt - checked < QUICK_MS
          && mine.every((a) => (lastGiftTo.get(a) || 0) < checked)) {
        return res.json({ ok: true, items: [], total: 0, quick: true });
      }
      const snaps = await Promise.all(mine.map((a) => db.collection(EVENTS).where("to", "==", a).where("seen", "==", false).limit(30).get()));
      remember(lastFullCheck, mine[0], startedAt);
      const items = snaps.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })))
        .sort((a, b) => num(b.createdAtMs) - num(a.createdAtMs)).slice(0, 30)
        .map((e) => ({ id: e.id, kind: e.kind, amount: num(e.amount), fromName: e.fromName || "Emuer",
          postId: e.postId || "", postTitle: e.postTitle || "", questTitle: e.questTitle || "", at: num(e.createdAtMs) }));
      return res.json({ ok: true, items, total: items.reduce((s, x) => s + x.amount, 0) });
    } catch (e) { return fail(res, e); }
  });
  /* 見たしるしを付ける。あわせて、アプリが作ったアドレスの台帳に届いていた応援の分を、
     ログインの名義の台帳へ移す（この仕組みより前に届いた分。応援・協賛で受け取った分だけを動かす）。
     返す balance は、いま使える未変換の EMUER。 */
  router.post("/inbox/seen", requireFirebaseUser, async (req, res) => {
    try {
      const mine = addressesOf(req);
      const main = mine[0];
      const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(String).filter((s) => /^[a-z]+-[0-9a-f]{40}$/.test(s)).slice(0, 30);
      await Promise.all(ids.map(async (id) => {
        const ref = db.collection(EVENTS).doc(id);
        const s = await ref.get();
        if (s.exists && mine.includes((s.data() || {}).to)) await ref.set({ seen: true, seenAtMs: now() }, { merge: true });
      }));
      let moved = 0;
      if (mine[1]) {
        const ches = mine[1];
        moved = await db.runTransaction(async (tx) => {
          const [cs, ms] = await Promise.all([tx.get(ledgerRef(ches)), tx.get(ledgerRef(main))]);
          if (!cs.exists) return 0;
          const c = cs.data() || {};
          const amount = Math.max(0, Math.min(num(c.balance), num(c.giftIn) - num(c.giftOut)));
          if (!amount) return 0;
          const m = ms.exists ? ms.data() || {} : {};
          tx.set(ledgerRef(ches), { address: ches, balance: num(c.balance) - amount, giftOut: num(c.giftOut) + amount, updatedAt: new Date(now()) }, { merge: true });
          tx.set(ledgerRef(main), { address: main, balance: num(m.balance) + amount, giftIn: num(m.giftIn) + amount, updatedAt: new Date(now()) }, { merge: true });
          audit(tx, "merge-" + hash([ches, main, now()].join(":")), { from: ches, to: main, amount, reason: "gift_merge_to_login_address" });
          return amount;
        });
      }
      const l = await ledgerRef(main).get();
      return res.json({ ok: true, count: ids.length, moved, balance: l.exists ? num((l.data() || {}).balance) : 0 });
    } catch (e) { return fail(res, e); }
  });

  /* ── D. 協賛 ── */
  async function questOf(questId) {
    if (!DOC_ID.test(questId) || questId === FOUNDER_QUEST_ID) throw err("QUEST_NOT_FOUND", 404);
    const s = await db.collection("sp_quests").doc(questId).get();
    const q = s.exists ? s.data() || {} : null;
    if (!q || q.deleted === true || q.status === "deleted" || q.status === "archived") throw err("QUEST_NOT_FOUND", 404);
    return q;
  }
  function potView(t) {
    const pot = num(t.pot);
    return { pot, total: num(t.total), sponsors: num(t.sponsors), paidOut: num(t.paidOut), bonusCount: num(t.bonusCount),
      bonus: SPONSOR_BONUS, peopleLeft: Math.floor(pot / SPONSOR_BONUS) + (pot % SPONSOR_BONUS > 0 ? 1 : 0) };
  }
  router.get("/sponsor/:questId", async (req, res) => {
    try {
      const questId = String(req.params.questId || "");
      if (!DOC_ID.test(questId)) throw err("QUEST_NOT_FOUND", 404);
      const s = await db.collection(TARGETS).doc("quest:" + questId).get();
      return res.json({ ok: true, questId, ...potView(s.exists ? s.data() || {} : {}) });
    } catch (e) { return fail(res, e); }
  });
  router.post("/sponsor", active, requireFirebaseUser, async (req, res) => {
    try {
      const from = senderOf(req);
      const b = req.body || {};
      const questId = String(b.questId || "");
      const amount = Number(b.amount);
      const requestId = String(b.requestId || "");
      if (!SPONSOR_AMOUNTS.includes(amount)) throw err("INVALID_AMOUNT");
      if (!REQUEST_ID.test(requestId)) throw err("INVALID_REQUEST");
      const q = await questOf(questId);
      const id = "sponsor-" + hash([from, requestId].join(":"));
      const targetRef = db.collection(TARGETS).doc("quest:" + questId);
      const personRef = db.collection(TARGETS).doc("quest:" + questId + ":by:" + from);
      const eventRef = db.collection(EVENTS).doc(id);
      const result = await db.runTransaction(async (tx) => {
        const [ev, target, person] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(personRef)]);
        if (ev.exists) return { already: true };
        const write = await move(tx, { from, to: null, amount, dailyCount: true });
        const t = target.exists ? target.data() || {} : {};
        const next = { kind: "quest", questId, pot: num(t.pot) + amount, total: num(t.total) + amount,
          sponsors: num(t.sponsors) + (person.exists ? 0 : 1), paidOut: num(t.paidOut), bonusCount: num(t.bonusCount), updatedAtMs: now() };
        const after = write();
        tx.set(targetRef, next, { merge: true });
        if (!person.exists) tx.set(personRef, { kind: "quest-person", questId, address: from, firstAtMs: now() });
        tx.create(eventRef, { kind: "sponsor", from, to: null, amount, questId, questTitle: String(q.title || "").slice(0, 80),
          fromName: nameOf(req.identity), seen: true, createdAtMs: now() });
        audit(tx, id, { from, to: "quest-pot:" + questId, amount, reason: "quest_sponsor", questId });
        return { already: false, ...potView(next), balance: after.balance, sentToday: after.sentToday };
      });
      return res.json({ ok: true, ...result, amount });
    } catch (e) { return fail(res, e); }
  });
  /* 完走した人が、協賛の袋から1回だけ受け取る。完走は完走証明（sp_quest_certificates）で確かめる。 */
  async function completed(questId, spid) {
    if (!spid) return false;
    const s = await db.collection("sp_quest_certificates").where("questId", "==", questId).where("spid", "==", spid).limit(1).get();
    return !s.empty;
  }
  router.get("/sponsor/:questId/mine", requireFirebaseUser, async (req, res) => {
    try {
      const questId = String(req.params.questId || "");
      if (!DOC_ID.test(questId)) throw err("QUEST_NOT_FOUND", 404);
      const spid = String(((req.identity || {}).account || {}).spid || "");
      const [done, claim] = await Promise.all([completed(questId, spid),
        spid ? db.collection(EVENTS).doc("bonus-" + hash([questId, spid].join(":"))).get() : Promise.resolve({ exists: false })]);
      return res.json({ ok: true, completed: done, claimed: claim.exists, amount: claim.exists ? num((claim.data() || {}).amount) : 0 });
    } catch (e) { return fail(res, e); }
  });
  router.post("/sponsor/:questId/claim", active, requireFirebaseUser, async (req, res) => {
    try {
      const to = senderOf(req);
      const questId = String(req.params.questId || "");
      const q = await questOf(questId);
      const spid = String(((req.identity || {}).account || {}).spid || "");
      if (!spid) throw err("PASSPORT_REQUIRED", 403);
      if (!(await completed(questId, spid))) throw err("NOT_COMPLETED", 403);
      const id = "bonus-" + hash([questId, spid].join(":"));
      const targetRef = db.collection(TARGETS).doc("quest:" + questId);
      const eventRef = db.collection(EVENTS).doc(id);
      const result = await db.runTransaction(async (tx) => {
        const [ev, target, ls] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(ledgerRef(to))]);
        if (ev.exists) return { already: true, amount: num((ev.data() || {}).amount) };
        const t = target.exists ? target.data() || {} : {};
        const pot = num(t.pot);
        if (pot <= 0) throw err("POT_EMPTY", 409);
        const amount = Math.min(SPONSOR_BONUS, pot);
        const l = ls.exists ? ls.data() || {} : {};
        const next = { pot: pot - amount, paidOut: num(t.paidOut) + amount, bonusCount: num(t.bonusCount) + 1, updatedAtMs: now() };
        tx.set(targetRef, next, { merge: true });
        tx.set(ledgerRef(to), { address: to, balance: num(l.balance) + amount, giftIn: num(l.giftIn) + amount, updatedAt: new Date(now()) }, { merge: true });
        tx.create(eventRef, { kind: "bonus", from: "quest-pot:" + questId, to, amount, questId, spid,
          questTitle: String(q.title || "").slice(0, 80), fromName: "協賛してくれたみんな", seen: true, createdAtMs: now() });
        audit(tx, id, { from: "quest-pot:" + questId, to, amount, reason: "quest_sponsor_bonus", questId });
        return { already: false, amount, ...potView({ ...t, ...next }) };
      });
      return res.json({ ok: true, ...result });
    } catch (e) { return fail(res, e); }
  });

  /* ── D. 投票 ── */
  function pollView(id, p, mine) {
    const options = Array.isArray(p.options) ? p.options : [];
    const tallies = p.tallies || {};
    const open = p.status === "open" && (!p.closesAtMs || now() < num(p.closesAtMs));
    return { id, question: p.question, options: options.map((o) => ({ id: o.id, label: o.label, votes: num(tallies[o.id]) })),
      cost: num(p.cost), votes: num(p.votes), open, closesAt: num(p.closesAtMs) || null, createdAt: num(p.createdAtMs),
      ...(mine !== undefined ? { myVote: mine } : {}) };
  }
  async function listPolls() {
    const snap = await db.collection(POLLS).where("visible", "==", true).limit(20).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} })).sort((a, b) => num(b.data.createdAtMs) - num(a.data.createdAtMs));
  }
  router.get("/polls", async (req, res) => {
    try {
      const rows = await listPolls();
      return res.json({ ok: true, polls: rows.map((r) => pollView(r.id, r.data)) });
    } catch (e) { return fail(res, e); }
  });
  router.get("/polls/mine", requireFirebaseUser, async (req, res) => {
    try {
      const rows = await listPolls();
      const votes = await Promise.all(rows.map((r) => db.collection(VOTES).doc(r.id + ":" + req.identity.uid).get()));
      return res.json({ ok: true, polls: rows.map((r, i) => pollView(r.id, r.data, votes[i].exists ? String((votes[i].data() || {}).option || "") : null)) });
    } catch (e) { return fail(res, e); }
  });
  router.post("/polls/:id/vote", active, requireFirebaseUser, async (req, res) => {
    try {
      const pollId = String(req.params.id || "");
      if (!DOC_ID.test(pollId)) throw err("POLL_NOT_FOUND", 404);
      const option = String((req.body || {}).option || "");
      const from = senderOf(req);
      const pollRef = db.collection(POLLS).doc(pollId);
      const voteRef = db.collection(VOTES).doc(pollId + ":" + req.identity.uid);
      const result = await db.runTransaction(async (tx) => {
        const [ps, vs] = await Promise.all([tx.get(pollRef), tx.get(voteRef)]);
        const p = ps.exists ? ps.data() || {} : null;
        if (!p || p.visible !== true) throw err("POLL_NOT_FOUND", 404);
        if (vs.exists) throw err("ALREADY_VOTED", 409, { myVote: String((vs.data() || {}).option || "") });
        if (!(p.status === "open" && (!p.closesAtMs || now() < num(p.closesAtMs)))) throw err("POLL_CLOSED", 409);
        if (!(p.options || []).some((o) => o.id === option)) throw err("INVALID_OPTION");
        const cost = num(p.cost);
        let after = null;
        if (cost > 0) after = (await move(tx, { from, to: null, amount: cost, dailyCount: false }))();
        const tallies = { ...(p.tallies || {}) };
        tallies[option] = num(tallies[option]) + 1;
        const next = { ...p, tallies, votes: num(p.votes) + 1, updatedAtMs: now() };
        tx.set(pollRef, { tallies, votes: next.votes, updatedAtMs: now() }, { merge: true });
        tx.create(voteRef, { pollId, uid: req.identity.uid, address: from, option, cost, createdAtMs: now() });
        if (cost > 0) audit(tx, "vote-" + hash(pollId + ":" + req.identity.uid), { from, to: "poll:" + pollId, amount: cost, reason: "poll_vote", pollId });
        return { poll: pollView(pollId, next, option), balance: after ? after.balance : undefined };
      });
      return res.json({ ok: true, ...result });
    } catch (e) { return fail(res, e); }
  });

  /* 運営：投票を作る・締める。 */
  router.get("/admin/polls", requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(POLLS).limit(50).get();
      const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} })).sort((a, b) => num(b.data.createdAtMs) - num(a.data.createdAtMs));
      return res.json({ ok: true, polls: rows.map((r) => ({ ...pollView(r.id, r.data), visible: r.data.visible === true, status: r.data.status })) });
    } catch (e) { return fail(res, e); }
  });
  router.post("/admin/polls", requireOwner, async (req, res) => {
    try {
      const b = req.body || {};
      const question = String(b.question || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
      const labels = (Array.isArray(b.options) ? b.options : []).map((o) => String(o || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60)).filter(Boolean);
      const unique = [...new Set(labels)];
      const cost = Number(b.cost);
      const days = Number(b.days);
      if (!question) throw err("QUESTION_REQUIRED");
      if (unique.length < 2 || unique.length > 6) throw err("OPTIONS_2_TO_6");
      if (!Number.isInteger(cost) || cost < 0 || cost > 10) throw err("COST_0_TO_10");
      if (!Number.isInteger(days) || days < 1 || days > 60) throw err("DAYS_1_TO_60");
      const id = "poll_" + crypto.randomBytes(6).toString("hex");
      const row = { question, options: unique.map((label, i) => ({ id: "o" + (i + 1), label })), tallies: {}, votes: 0, cost,
        status: "open", visible: true, closesAtMs: now() + days * 86400000, createdAtMs: now(), createdBy: req.identity.uid };
      await db.collection(POLLS).doc(id).create(row);
      return res.json({ ok: true, poll: pollView(id, row) });
    } catch (e) { return fail(res, e); }
  });
  router.post("/admin/polls/:id/close", requireOwner, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!DOC_ID.test(id)) throw err("POLL_NOT_FOUND", 404);
      const ref = db.collection(POLLS).doc(id);
      const s = await ref.get();
      if (!s.exists) throw err("POLL_NOT_FOUND", 404);
      const hide = (req.body || {}).hide === true;
      await ref.set({ status: "closed", closedAtMs: now(), ...(hide ? { visible: false } : {}) }, { merge: true });
      return res.json({ ok: true });
    } catch (e) { return fail(res, e); }
  });

  return router;
}

module.exports = { createGiftsRouter, CHEER_AMOUNTS, SPONSOR_AMOUNTS, DAILY_LIMIT, SPONSOR_BONUS, jstDay };
