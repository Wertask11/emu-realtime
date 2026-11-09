"use strict";
/* 返り道（11/9）：Emu の知識が、SchoolPark でどう使われたかを、投稿ごとに数える。

   SchoolPark のクエストの報告（やってみた）と知恵カードは、元の Emu 投稿の番号
   （fromPostId）を持っている。議題から生まれたクエストも、元の投稿の番号を持っている。
   ところが Emu の投稿カードは Good の数しか見ておらず、書いた人には
   「誰かが実際にやってみた」ことが何も返っていなかった。

   ここは数だけを返す。誰がやったか（名前・番号・本文・画像）は返さない。
     tried  … その投稿を選んで「やってみた」を出した人の数（同じ人は1回）
     wisdom … その投稿を元の知識にした知恵カードの枚数
     quests … その投稿から生まれたクエストの数（議題 → 投票 → クエスト）

   読み取りは全員で共有する。1時間に1回だけ数え直し、その間は覚えた結果を返す
   （Firestore の無料枠を守るため。画面を開くたびに数えない）。
   数え直しに失敗したら、前の結果をそのまま返す。 */
const express = require("express");

const FOUNDER_QUEST_ID = "founder-quest-000";
const POST_ID = /^[A-Za-z0-9_-]{1,80}$/;

function createKnowledgeTrialsRouter({ db, now = () => Date.now(), ttlMs = 60 * 60 * 1000 } = {}) {
  const router = express.Router();
  let cache = null;
  let cachedAt = 0;
  let pending = null;

  /* 本番（Admin SDK）は必要な欄だけ読む。報告には画像が入っているため。 */
  const pick = (query, fields) => (typeof query.select === "function" ? query.select(...fields) : query);

  async function build() {
    const posts = {};
    const entry = (id) => {
      const key = String(id || "");
      if (!POST_ID.test(key)) return null;
      if (!posts[key]) posts[key] = { tried: new Set(), wisdom: 0, quests: 0 };
      return posts[key];
    };
    const quests = await pick(db.collection("sp_quests"), ["fromPostId"]).get();
    const ids = [];
    quests.forEach((doc) => {
      if (doc.id === FOUNDER_QUEST_ID) return;
      ids.push(doc.id);
      const e = entry((doc.data() || {}).fromPostId);
      if (e) e.quests += 1;
    });
    const logs = await Promise.all(ids.map((id) =>
      pick(db.collection("sp_quests").doc(id).collection("logs").where("kind", "==", "やってみた"),
        ["author", "fromPostId"]).get()));
    logs.forEach((snap) => snap.forEach((doc) => {
      const row = doc.data() || {};
      const e = entry(row.fromPostId);
      const who = String(row.author || "").toLowerCase();
      if (e && who) e.tried.add(who);
    }));
    const wisdom = await pick(db.collection("sp_wisdom"), ["fromPostId"]).get();
    wisdom.forEach((doc) => {
      const e = entry((doc.data() || {}).fromPostId);
      if (e) e.wisdom += 1;
    });
    const out = {};
    for (const [id, e] of Object.entries(posts)) {
      const row = { tried: e.tried.size, wisdom: e.wisdom, quests: e.quests };
      if (row.tried || row.wisdom || row.quests) out[id] = row;
    }
    return out;
  }

  async function read() {
    if (cache && now() - cachedAt < ttlMs) return { posts: cache, stale: false };
    if (!pending) {
      pending = build()
        .then((posts) => { cache = posts; cachedAt = now(); return { posts, stale: false }; })
        .finally(() => { pending = null; });
    }
    try { return await pending; }
    catch (error) {
      if (cache) return { posts: cache, stale: true };
      throw error;
    }
  }

  router.get("/", async (_req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const { posts, stale } = await read();
      res.set("Cache-Control", "public, max-age=300");
      return res.json({ ok: true, posts, stale, at: cachedAt });
    } catch (error) {
      console.warn("knowledge-trials:", error && (error.code || error.message));
      return res.status(503).json({ error: "TRIALS_UNAVAILABLE" });
    }
  });

  return { router, read };
}

module.exports = { createKnowledgeTrialsRouter };
