/* Knowledge Text（room1）の「🫶 役に立った」（11/28 オーナー：「ナレッジテキストのコンテンツにも役に立ったとか押せるようにして」）。

   - 押せるのはログインした人だけ。1人1つのコンテンツに1回（知識を読むの「役に立った」と同じく、取り消しは無し）。
   - 記録：room1_helpful/{uid}__{contentId}（だれが押したか）と room1_stats/helpful.counts.{contentId}（数）。
     どちらもサーバー（Admin SDK）だけが書く。画面から直接は読み書きしない（決まり＝firestore.rules は変えない）。
   - 数はだれでも見られる。自分が押したかは、ログインしているときだけ返す。 */
"use strict";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const COUNTS_TTL_MS = 20 * 1000;

function createRoom1HelpfulRouter({ express, db, firebaseAdmin, requireFirebaseUser, rateLimit }) {
  const router = express.Router();
  /* Firebase の初期化に失敗したサーバーでも起動は止めない（数は空、押すと 503） */
  const statsRef = () => db.collection("room1_stats").doc("helpful");
  const markRef = (uid, id) => db.collection("room1_helpful").doc(uid + "__" + id);
  let cache = { counts: null, at: 0 };

  async function counts() {
    if (cache.counts && Date.now() - cache.at < COUNTS_TTL_MS) return cache.counts;
    const snap = await statsRef().get();
    const raw = (snap.exists && snap.data() && snap.data().counts) || {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (ID.test(k) && Number.isSafeInteger(v) && v > 0) out[k] = v;
    cache = { counts: out, at: Date.now() };
    return out;
  }
  /* 自分が押したもの。トークンが無い・読めないときは空（数だけ返す） */
  async function mine(req) {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ") || !firebaseAdmin) return [];
    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(header.slice(7));
      const snap = await db.collection("room1_helpful").where("uid", "==", decoded.uid).limit(500).get();
      return snap.docs.map((d) => d.data().contentId).filter((id) => ID.test(String(id || "")));
    } catch (_) {
      return [];
    }
  }

  router.get("/helpful", async (req, res) => {
    if (!db) return res.json({ counts: {}, mine: [] });
    try {
      const [c, m] = await Promise.all([counts(), mine(req)]);
      res.json({ counts: c, mine: m });
    } catch (err) {
      console.error("room1/helpful get error:", err.code, err.message);
      res.status(500).json({ error: "HELPFUL_UNAVAILABLE" });
    }
  });

  const limited = rateLimit ? rateLimit({ windowMs: 60 * 1000, max: 30, key: "room1-helpful" }) : (req, res, next) => next();
  router.post("/contents/:id/helpful", requireFirebaseUser, limited, async (req, res) => {
    const id = String(req.params.id || "");
    if (!ID.test(id)) return res.status(400).json({ error: "INVALID_CONTENT" });
    if (!db || !firebaseAdmin) return res.status(503).json({ error: "HELPFUL_UNAVAILABLE" });
    const uid = req.identity.uid;
    /* 本番は require("firebase-admin") をそのまま受け取る。受け取った形に FieldValue が無ければ、firebase-admin から直接使う */
    const FieldValue = (firebaseAdmin.firestore && firebaseAdmin.firestore.FieldValue) || require("firebase-admin/firestore").FieldValue;
    try {
      const result = await db.runTransaction(async (tx) => {
        const [mark, content] = await Promise.all([tx.get(markRef(uid, id)), tx.get(db.collection("room1_contents").doc(id))]);
        if (!content.exists) return { missing: true };
        if (mark.exists) return { already: true };
        tx.set(markRef(uid, id), { uid, contentId: id, at: Date.now() });
        tx.set(statsRef(), { counts: { [id]: FieldValue.increment(1) }, updatedAt: Date.now() }, { merge: true });
        return { added: true };
      });
      if (result.missing) return res.status(404).json({ error: "CONTENT_NOT_FOUND" });
      if (result.added && cache.counts) cache.counts = { ...cache.counts, [id]: (cache.counts[id] || 0) + 1 };
      const c = await counts();
      res.json({ ok: true, already: !!result.already, count: c[id] || (result.added ? 1 : 0) });
    } catch (err) {
      console.error("room1/helpful post error:", err.code, err.message);
      res.status(500).json({ error: "HELPFUL_UNAVAILABLE" });
    }
  });
  return router;
}

module.exports = { createRoom1HelpfulRouter };
