"use strict";
/* 12月の挑戦納めカレンダーの JPYC（11/28 オーナー決定）。
   - 特別な日にログインボーナスを受け取った人へ JPYC も配る：12/5・12/15 は 10、12/25 は 30、12/31 は 50 JPYC（1人 最大100）。
   - 12月の合計は 10,000 JPYC まで（先着）。超える分は配らない（EMUER はいつもどおり配る）。
   - その場では送らない。「受け取る予定の JPYC」として記録し、運営があとでまとめて送る（サーバーに送金の鍵を置かない）。
   - LINE・Google で入った人のアドレスは、ログインの ID から作った「鍵の無いアドレス」なので、そこへ送ると使えない。
     その人には、JPYC を受け取る自分のウォレットのアドレス（Polygon）を登録してもらう。登録するまでは「アドレス待ち」。
   置き場所（サーバーだけが読み書きする。Firestore のルールは変えない）：
     emuer_v2_jpyc_gifts/{uid}_{日}     … 1人1日1件。{ uid, day, amountJpyc, address, status: needs_address|pending|sent, txHash }
     emuer_v2_jpyc_budget/{月}           … その月に記録した合計（totalJpyc）
     emuer_v2_jpyc_addresses/{uid}       … JPYC を受け取るアドレス */
const ethers = require("ethers");

const DAYS = Object.freeze({ "2026-12-05": 10, "2026-12-15": 10, "2026-12-25": 30, "2026-12-31": 50 });
const BUDGET = Object.freeze({ "2026-12": 10000 });

const lower = (v) => String(v || "").toLowerCase();
const isAddress = (v) => /^0x[0-9a-f]{40}$/.test(lower(v));
function chesOf(uid) { return lower(ethers.utils.getAddress("0x" + ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ches-wallet:v1:" + uid)).slice(-40))); }
/* 送ってよいアドレスか（鍵の無い「ログインの ID から作ったアドレス」ではない） */
function sendable(uid, identity, address) {
  const a = lower(address);
  if (!isAddress(a) || /^0x0{40}$/.test(a)) return false;
  const ches = [chesOf(uid), lower(identity && identity.account && identity.account.chesAddress)];
  return !ches.includes(a);
}
function amountFor(day) { return DAYS[day] || 0; }

function createJpycGifts({ db }) {
  const giftRef = (uid, day) => db.collection("emuer_v2_jpyc_gifts").doc(uid + "_" + day);
  const budgetRef = (month) => db.collection("emuer_v2_jpyc_budget").doc(month);
  const addressRef = (uid) => db.collection("emuer_v2_jpyc_addresses").doc(uid);

  /* ログインボーナスの取引の中で使う。先に読むだけ読み、書くのは返した関数で（Firestore の取引は読み→書きの順） */
  async function prepare(tx, { uid, identity, day }) {
    const amount = amountFor(day);
    if (!amount) return null;
    const month = day.slice(0, 7);
    const [gift, budget, saved] = await Promise.all([tx.get(giftRef(uid, day)), tx.get(budgetRef(month)), tx.get(addressRef(uid))]);
    if (gift.exists) return { result: view(gift.data()), write: () => {} };
    const used = Number((budget.exists && budget.data().totalJpyc) || 0);
    if (used + amount > (BUDGET[month] || 0)) return { result: { amountJpyc: 0, soldOut: true }, write: () => {} };
    const wallet = sendable(uid, identity, identity && identity.walletAddress) ? lower(identity.walletAddress) : "";
    const savedAddress = saved.exists ? lower(saved.data().address) : "";
    const address = wallet || (sendable(uid, identity, savedAddress) ? savedAddress : "");
    const row = { uid, day, amountJpyc: amount, address, status: address ? "pending" : "needs_address", createdAtMs: Date.now() };
    return {
      result: view(row),
      write: () => {
        tx.create(giftRef(uid, day), row);
        tx.set(budgetRef(month), { month, totalJpyc: used + amount, limitJpyc: BUDGET[month], updatedAtMs: Date.now() }, { merge: true });
      }
    };
  }
  function view(row) {
    return { day: row.day, amountJpyc: Number(row.amountJpyc) || 0, status: row.status, needsAddress: row.status === "needs_address",
      address: row.address ? row.address.slice(0, 6) + "…" + row.address.slice(-4) : "", sent: row.status === "sent" };
  }

  function routes(router, { requireFirebaseUser, requireOwnAddress, requireOwner }) {
    /* 自分の JPYC（受け取る予定・送り済み） */
    router.get("/jpyc/mine", requireFirebaseUser, requireOwnAddress, async (req, res) => {
      try {
        const uid = req.identity.uid;
        const rows = await Promise.all(Object.keys(DAYS).map((d) => giftRef(uid, d).get()));
        const saved = await addressRef(uid).get();
        const gifts = rows.filter((s) => s.exists).map((s) => view(s.data()));
        const walletOk = sendable(uid, req.identity, req.identity.walletAddress);
        return res.json({ ok: true, gifts, days: DAYS, walletOk,
          address: walletOk ? "" : (saved.exists ? view({ address: lower(saved.data().address) }).address : "") });
      } catch (e) { return res.status(500).json({ error: "JPYC_UNAVAILABLE" }); }
    });
    /* JPYC を受け取るアドレスを登録する（LINE・Google で入った人） */
    router.post("/jpyc/address", requireFirebaseUser, requireOwnAddress, async (req, res) => {
      const uid = req.identity.uid, address = lower(req.body && req.body.jpycAddress);
      if (!sendable(uid, req.identity, address)) return res.status(400).json({ error: "INVALID_JPYC_ADDRESS" });
      try {
        await addressRef(uid).set({ uid, address, updatedAtMs: Date.now() }, { merge: true });
        let filled = 0;
        for (const d of Object.keys(DAYS)) {
          const ref = giftRef(uid, d), s = await ref.get();
          if (s.exists && s.data().status === "needs_address") { await ref.set({ address, status: "pending", updatedAtMs: Date.now() }, { merge: true }); filled++; }
        }
        return res.json({ ok: true, filled, address: view({ address }).address });
      } catch (e) { return res.status(500).json({ error: "JPYC_UNAVAILABLE" }); }
    });
    if (!requireOwner) return;
    /* 運営：まとめて送る一覧（送る先と額）。送ったら、取引の記録（txHash）を付けて「送り済み」にする */
    router.get("/admin/jpyc-gifts", requireOwner, async (req, res) => {
      try {
        const snap = await db.collection("emuer_v2_jpyc_gifts").get();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const sum = (st) => rows.filter((r) => r.status === st).reduce((n, r) => n + (Number(r.amountJpyc) || 0), 0);
        const budgets = (await db.collection("emuer_v2_jpyc_budget").get()).docs.map((d) => d.data());
        return res.json({ ok: true, pending: rows.filter((r) => r.status === "pending").map((r) => ({ id: r.id, day: r.day, address: r.address, amountJpyc: r.amountJpyc })),
          totals: { pending: sum("pending"), needsAddress: sum("needs_address"), sent: sum("sent") }, budgets });
      } catch (e) { return res.status(500).json({ error: "JPYC_UNAVAILABLE" }); }
    });
    router.post("/admin/jpyc-gifts/:id/sent", requireOwner, async (req, res) => {
      const txHash = lower(req.body && req.body.txHash);
      if (!/^0x[0-9a-f]{64}$/.test(txHash)) return res.status(400).json({ error: "INVALID_TX_HASH" });
      try {
        const ref = db.collection("emuer_v2_jpyc_gifts").doc(String(req.params.id || ""));
        const s = await ref.get();
        if (!s.exists) return res.status(404).json({ error: "NOT_FOUND" });
        if (s.data().status !== "pending") return res.status(409).json({ error: "NOT_PENDING" });
        await ref.set({ status: "sent", txHash, sentAtMs: Date.now() }, { merge: true });
        return res.json({ ok: true });
      } catch (e) { return res.status(500).json({ error: "JPYC_UNAVAILABLE" }); }
    });
  }
  return { prepare, routes, view };
}
module.exports = { createJpycGifts, DAYS, BUDGET, amountFor, sendable, chesOf };
