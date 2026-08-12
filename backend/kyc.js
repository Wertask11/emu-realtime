"use strict";

/**
 * 本人確認（書類アップロード → オーナーが目視承認）と、保証判定のための対話記録。
 *
 * 個人情報の扱い（要配慮性が高いので設計として固定する）:
 *  - 書類画像は非公開バケットに置く。makePublic は絶対にしない。
 *  - オーナーの閲覧は都度発行する短時間の署名付きURLのみ。URLは監査ログに残す。
 *  - 承認・却下が決まった時点で画像を削除し、結果だけを残す。
 *  - 氏名・生年月日そのものは保存しない。「確認済み」という事実だけ残す。
 *  - 未処理のまま放置された書類も、保持期限を過ぎたら削除する。
 */

const express = require("express");

const KYC_COL = "kyc_submissions";
const DIALOGUE_COL = "dialogue_sessions";
const AUDIT_COL = "admin_audit_logs";

const KYC_PREFIX = "kyc";                       // Storage 上の保存先
const KYC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 未処理書類の保持上限: 30日
const VIEW_URL_TTL_MS = 5 * 60 * 1000;          // 署名付きURLの有効期間: 5分

const ALLOWED_DOC_TYPES = ["driver_license", "passport", "mynumber_card", "residence_card"];
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

function createKycRouter(deps) {
  const { db, firebaseAdmin, requireFirebaseUser, requireOwner, rateLimit } = deps;
  const router = express.Router();

  const kycRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, key: "kyc" });

  function kycRef(uid) { return db.collection(KYC_COL).doc(uid); }
  function bucket() { return firebaseAdmin.storage().bucket(); }

  async function audit(actorUid, action, target, detail) {
    try {
      await db.collection(AUDIT_COL).add({
        actorUid, action, target, detail: detail || null, createdAt: new Date()
      });
    } catch (e) {
      console.warn("監査ログ書き込み失敗:", e.message);
    }
  }

  /* アップロードされた画像が本当に画像かをマジックナンバーで確かめる。
     拡張子や Content-Type の自己申告だけを信じない。 */
  function looksLikeImage(buffer, mimeType) {
    if (buffer.length < 12) return false;
    if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === "image/png") {
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === "image/webp") {
      return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    }
    return false;
  }

  async function deleteStoredDocs(paths) {
    for (const p of paths) {
      if (!p) continue;
      try { await bucket().file(p).delete(); }
      catch (e) { if (e.code !== 404) console.warn("KYC画像の削除に失敗:", p, e.message); }
    }
  }

  // ───────── 提出 ─────────
  router.post("/submit", requireFirebaseUser, kycRateLimit, async (req, res) => {
    try {
      if (!db || !firebaseAdmin) return res.status(503).json({ error: "KYC_UNAVAILABLE" });
      const { uid, walletAddress } = req.identity;
      const docType = String(req.body.docType || "");
      const mimeType = String(req.body.mimeType || "");
      const front = String(req.body.front || "");
      const back = String(req.body.back || "");

      if (!ALLOWED_DOC_TYPES.includes(docType)) return res.status(400).json({ error: "INVALID_DOC_TYPE" });
      if (!ALLOWED_MIME.includes(mimeType)) return res.status(400).json({ error: "INVALID_MIME" });
      if (!front) return res.status(400).json({ error: "MISSING_IMAGE" });

      const current = await kycRef(uid).get();
      if (current.exists) {
        const s = current.data().status;
        if (s === "approved") return res.status(409).json({ error: "ALREADY_APPROVED" });
        if (s === "pending") return res.status(409).json({ error: "ALREADY_PENDING" });
      }

      const files = [];
      for (const [label, b64] of [["front", front], ["back", back]]) {
        if (!b64) continue;
        const buffer = Buffer.from(b64, "base64");
        if (!buffer.length || buffer.length > MAX_BYTES) return res.status(413).json({ error: "IMAGE_TOO_LARGE" });
        if (!looksLikeImage(buffer, mimeType)) return res.status(400).json({ error: "INVALID_IMAGE_DATA" });
        files.push({ label, buffer });
      }

      const stamp = Date.now();
      const stored = [];
      for (const f of files) {
        const destPath = `${KYC_PREFIX}/${uid}/${stamp}_${f.label}`;
        // 非公開のまま保存する（makePublic を呼ばない）
        await bucket().file(destPath).save(f.buffer, {
          contentType: mimeType,
          metadata: { cacheControl: "private, max-age=0, no-store" }
        });
        stored.push(destPath);
      }

      await kycRef(uid).set({
        uid, walletAddress, docType,
        status: "pending",
        storagePaths: stored,
        submittedAt: new Date(),
        expiresAt: new Date(stamp + KYC_RETENTION_MS)
      }, { merge: true });

      return res.json({ ok: true, status: "pending" });
    } catch (e) {
      console.error("kyc submit error:", e.message);
      return res.status(500).json({ error: "SUBMIT_FAILED" });
    }
  });

  router.get("/status", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "KYC_UNAVAILABLE" });
      const snap = await kycRef(req.identity.uid).get();
      if (!snap.exists) return res.json({ ok: true, status: "none" });
      const d = snap.data();
      return res.json({
        ok: true,
        status: d.status,
        docType: d.docType || null,
        submittedAt: d.submittedAt ? d.submittedAt.toDate().toISOString() : null,
        decidedAt: d.decidedAt ? d.decidedAt.toDate().toISOString() : null,
        rejectReason: d.rejectReason || null
      });
    } catch (e) {
      console.error("kyc status error:", e.message);
      return res.status(500).json({ error: "STATUS_FAILED" });
    }
  });

  // ───────── 管理（オーナーのみ） ─────────
  router.get("/admin/list", requireOwner, async (req, res) => {
    try {
      const status = String(req.query.status || "pending");
      let query = db.collection(KYC_COL).limit(100);
      if (status !== "all") query = query.where("status", "==", status);
      const snap = await query.get();
      const items = [];
      snap.forEach(d => {
        const v = d.data();
        items.push({
          uid: d.id, docType: v.docType, status: v.status,
          submittedAt: v.submittedAt ? v.submittedAt.toDate().toISOString() : null,
          decidedAt: v.decidedAt ? v.decidedAt.toDate().toISOString() : null,
          imageCount: (v.storagePaths || []).length
        });
      });
      items.sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("kyc admin list error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  /* 目視確認のための一時URL。閲覧したこと自体を監査ログに残す。 */
  router.get("/admin/:uid/view", requireOwner, async (req, res) => {
    try {
      const targetUid = String(req.params.uid);
      const snap = await kycRef(targetUid).get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      const paths = snap.data().storagePaths || [];
      if (!paths.length) return res.status(410).json({ error: "IMAGES_DELETED" });

      const expires = Date.now() + VIEW_URL_TTL_MS;
      const urls = [];
      for (const p of paths) {
        const [url] = await bucket().file(p).getSignedUrl({ action: "read", expires });
        urls.push(url);
      }
      await audit(req.identity.uid, "kyc_view", targetUid, { count: urls.length });
      return res.json({ ok: true, urls, expiresAt: new Date(expires).toISOString() });
    } catch (e) {
      console.error("kyc view error:", e.message);
      return res.status(500).json({ error: "VIEW_FAILED" });
    }
  });

  /* 判定と同時に画像を破棄する。結果だけを残し、書類の現物は持ち続けない。 */
  router.post("/admin/:uid/decide", requireOwner, async (req, res) => {
    try {
      const targetUid = String(req.params.uid);
      const decision = String(req.body.decision || "");
      const rejectReason = String(req.body.rejectReason || "").slice(0, 500);
      if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "INVALID_DECISION" });

      const ref = kycRef(targetUid);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      if (snap.data().status !== "pending") {
        return res.status(409).json({ error: "ALREADY_DECIDED", status: snap.data().status });
      }

      await deleteStoredDocs(snap.data().storagePaths || []);
      await ref.update({
        status: decision === "approve" ? "approved" : "rejected",
        rejectReason: decision === "reject" ? rejectReason : null,
        decidedAt: new Date(),
        decidedBy: req.identity.uid,
        storagePaths: [],
        imagesDeletedAt: new Date()
      });
      await audit(req.identity.uid, `kyc_${decision}`, targetUid, { rejectReason: rejectReason || null });
      return res.json({ ok: true, status: decision === "approve" ? "approved" : "rejected" });
    } catch (e) {
      console.error("kyc decide error:", e.message);
      return res.status(500).json({ error: "DECIDE_FAILED" });
    }
  });

  /* 未処理のまま保持期限を過ぎた書類を消す。定期実行から呼ぶ。 */
  async function purgeExpiredDocuments() {
    if (!db || !firebaseAdmin) return { deleted: 0 };
    try {
      const snap = await db.collection(KYC_COL)
        .where("status", "==", "pending")
        .where("expiresAt", "<=", new Date())
        .limit(200).get();
      let deleted = 0;
      for (const doc of snap.docs) {
        await deleteStoredDocs(doc.data().storagePaths || []);
        await doc.ref.update({
          status: "expired", storagePaths: [], imagesDeletedAt: new Date()
        });
        deleted++;
      }
      if (deleted) console.log(`🗑 期限切れの本人確認書類を削除: ${deleted}件`);
      return { deleted };
    } catch (e) {
      console.warn("KYC 期限切れ削除に失敗:", e.message);
      return { deleted: 0, error: e.message };
    }
  }

  return { router, purgeExpiredDocuments, DIALOGUE_COL };
}

module.exports = { createKycRouter, KYC_COL, DIALOGUE_COL };
