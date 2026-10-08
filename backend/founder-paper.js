/* Quest #000 の「SchoolPark論文」を、リポジトリにある新しい版へ差し替える（運営だけ）。

   #000 の本文は Firestore の sp_quests/founder-quest-000 にあり、
   記録の決まり（firestore.rules）で、ブラウザからは誰も書き換えられない。
   最初に入れたときは、運営が自分の端末で tools/seed-founder-quest.cjs を走らせた。
   その道具は「すでにある #000 は上書きしない」作りなので、論文を新しくする道が無かった。

   ここでは、論文の本文をリポジトリのファイル（founder/schoolpark-paper.txt）から読み、
   そのハッシュが下の PAPER_SHA256 と一致するときだけ、1番目の節（SchoolPark論文）の
   本文を差し替える。ほかの5つの節（A・B・起業観①②・人生観）には触らない。
   画面から本文を送らせないのは、貼り付けの途中で切れたり、別のものが入ったりしないため。

   前の版の本文は、リポジトリの docs/quest-000.md の履歴に残っている。 */
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const FOUNDER_ID = "founder-quest-000";
const PAPER_TITLE = "SchoolPark論文";
const PAPER_FILE = path.join(__dirname, "founder", "schoolpark-paper.txt");
/* founder/schoolpark-paper.txt の sha256。ファイルを差し替えたら、ここも書き替える。 */
const PAPER_SHA256 = "1b7445a436b5433615af7e41b2fcd28012b287d14868906e3e085d1645b95503";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function readPaper(file = PAPER_FILE, expected = PAPER_SHA256) {
  const raw = fs.readFileSync(file);
  if (sha256(raw) !== expected) throw new Error("PAPER_HASH_MISMATCH");
  /* 終わりの改行だけ落とす。本文は1文字も削らない。 */
  return raw.toString("utf8").replace(/\s+$/, "");
}

/* 差し替えたあとの #000 の欄を作る（取引の外でも試せるように分けてある）。 */
function nextFounder(current, body) {
  const sections = Array.isArray(current.founderSections) ? current.founderSections : [];
  if (current.kind !== "founder" || !sections.length) throw new Error("FOUNDER_MISSING");
  if (String(sections[0] && sections[0].title || "") !== PAPER_TITLE) throw new Error("PAPER_SECTION_MISSING");
  if (sections[0].body === body) return null;            /* もう新しい版になっている */
  const version = (Number(current.founderVersion) || 1) + 1;
  const next = [{ ...sections[0], body }].concat(sections.slice(1));
  return {
    founderSections: next,
    founderVersion: version,
    founderHash: sha256(JSON.stringify({ version, sections: next })),
    founderPaperSha256: sha256(Buffer.from(body, "utf8")),
    founderUpdatedAt: Date.now()
  };
}

function createFounderPaperRouter({ db, requireOwner, file, expected }) {
  const router = express.Router();

  /* いま入っている論文と、差し替える版の違い（読むだけ）。押す前に確かめるため。 */
  router.get("/paper", requireOwner, async (_req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const body = readPaper(file, expected);
      const snap = await db.collection("sp_quests").doc(FOUNDER_ID).get();
      const cur = snap.exists ? snap.data() || {} : {};
      const sec = Array.isArray(cur.founderSections) ? cur.founderSections[0] : null;
      return res.json({ ok: true,
        current: { version: Number(cur.founderVersion) || 1, characters: sec ? String(sec.body || "").length : 0 },
        next: { characters: body.length },
        same: !!sec && sec.body === body });
    } catch (error) {
      const code = String(error.message || "");
      if (code === "PAPER_HASH_MISMATCH") return res.status(500).json({ error: code });
      console.error("Founder paper read failed:", error);
      return res.status(500).json({ error: "PAPER_READ_FAILED" });
    }
  });

  router.post("/paper/apply", requireOwner, async (_req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const body = readPaper(file, expected);
      const ref = db.collection("sp_quests").doc(FOUNDER_ID);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("FOUNDER_MISSING");
        const cur = snap.data() || {};
        const patch = nextFounder(cur, body);
        if (!patch) return { updated: false, version: Number(cur.founderVersion) || 1 };
        tx.update(ref, patch);
        return { updated: true, version: patch.founderVersion, characters: body.length };
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const code = String(error.message || "");
      if (["FOUNDER_MISSING", "PAPER_SECTION_MISSING"].includes(code)) return res.status(409).json({ error: code });
      if (code === "PAPER_HASH_MISMATCH") return res.status(500).json({ error: code });
      console.error("Founder paper update failed:", error);
      return res.status(500).json({ error: "PAPER_UPDATE_FAILED" });
    }
  });

  return router;
}

module.exports = { createFounderPaperRouter, nextFounder, readPaper, PAPER_SHA256, PAPER_TITLE };
