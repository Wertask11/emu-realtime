// =====================
// Module import
// =====================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const path = require("path");
const cors = require("cors");
const ethers = require("ethers");
const cron = require("node-cron");

// =====================
// App / Server
// =====================
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://schoolpark-emu.vercel.app",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// =====================
// Middleware
// =====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(
  express.static(
    path.join(__dirname, "..", "frontend", "public")
  )
);

// =====================
// Firebase Admin 初期化
// =====================
let db = null;
const initFirestore = () => {
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "emusch-2a111.firebasestorage.app"
      });
    }
    db = admin.firestore();
    console.log("✅ Firestore + Storage 初期化完了");
  } catch (e) {
    console.warn("⚠️ Firebase 初期化失敗:", e.message);
  }
};
initFirestore();

// =====================
// Ethers / コントラクト設定（Dプラン）
// =====================
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;
const EMUER_CONTRACT_ADDRESS = process.env.EMUER_CONTRACT_ADDRESS || "0x4418d5250Dae4b1125ADFCD5C0779B1412E4a964";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const CAMPAIGN_ID = "EmuRelease2026";
const CAMPAIGN_DEADLINE = new Date("2026-04-14T23:59:59+09:00");

const EMUER_ABI_MINIMAL = [
  "function addGoodBatch(address[] calldata _users, uint256[] calldata _amounts) external",
  "function balanceOf(address account) view returns (uint256)"
];

let operatorWallet = null;
let emuerContract = null;

if (OPERATOR_PRIVATE_KEY) {
  try {
    const rpcProvider = new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL);
    operatorWallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY, rpcProvider);
    emuerContract = new ethers.Contract(EMUER_CONTRACT_ADDRESS, EMUER_ABI_MINIMAL, operatorWallet);
    console.log("✅ 運営ウォレット初期化完了:", operatorWallet.address);
  } catch (e) {
    console.error("❌ 運営ウォレット初期化失敗:", e.message);
  }
} else {
  console.warn("⚠️ OPERATOR_PRIVATE_KEY 未設定");
}

// =====================
// EIP-712 署名検証（Dプラン）
// =====================
function verifyAirdropSignature({ address, campaign, timestamp, signature }) {
  try {
    const domain = { name: "Emu Airdrop", version: "1", chainId: 137 };
    const types = {
      AirdropClaim: [
        { name: "address", type: "address" },
        { name: "campaign", type: "string" },
        { name: "timestamp", type: "uint256" }
      ]
    };
    const value = { address, campaign, timestamp };
    const recovered = ethers.utils.verifyTypedData(domain, types, value, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch (e) {
    console.error("署名検証エラー:", e.message);
    return false;
  }
}

// =====================
// エアドロ一括送金バッチ（Dプラン）
// =====================
async function runAirdropBatch() {
  if (!db || !emuerContract) {
    console.warn("⚠️ Firestore または emuerContract が未初期化。バッチをスキップ。");
    return;
  }
  console.log("🚀 エアドロバッチ開始:", new Date().toISOString());
  try {
    const snapshot = await db
      .collection("airdrop_registrations")
      .where("status", "==", "pending")
      .limit(50)
      .get();

    if (snapshot.empty) { console.log("ℹ️ 送金対象なし"); return; }

    const targets = snapshot.docs.map(doc => doc.data());
    const addresses = targets.map(t => t.address);
    const amounts = targets.map(t => ethers.utils.parseUnits(String(t.amount || "100"), 18));

    console.log(`📦 送金対象: ${addresses.length} 件`);

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.update(doc.ref, { status: "processing" }));
    await batch.commit();

    const gasOptions = {
      maxPriorityFeePerGas: ethers.utils.parseUnits("40", "gwei"),
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      gasLimit: 500000
    };

    const tx = await emuerContract.addGoodBatch(addresses, amounts, gasOptions);
    console.log("📝 TX Hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ TX確定:", receipt.transactionHash);

    const doneBatch = db.batch();
    snapshot.docs.forEach(doc => {
      doneBatch.update(doc.ref, {
        status: "done",
        txHash: receipt.transactionHash,
        processedAt: new Date()
      });
    });
    await doneBatch.commit();
    console.log(`🎉 エアドロ完了: ${addresses.length} 件`);

  } catch (err) {
    console.error("❌ バッチエラー:", err);
    try {
      const stuck = await db.collection("airdrop_registrations").where("status", "==", "processing").get();
      const rb = db.batch();
      stuck.docs.forEach(doc => rb.update(doc.ref, { status: "pending", errorMessage: err.message }));
      await rb.commit();
    } catch (rbErr) {
      console.error("❌ ロールバック失敗:", rbErr);
    }
  }
}

// =====================
// 画像アップロード API
// =====================
app.post("/upload/image", async (req, res) => {
  const { base64, mimeType, filename } = req.body;
  if (!base64 || !mimeType || !filename) return res.status(400).json({ error: "MISSING_PARAMS" });

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowedTypes.includes(mimeType)) return res.status(400).json({ error: "INVALID_TYPE" });

  try {
    const admin = require("firebase-admin");
    const bucket = admin.storage().bucket();
    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const destPath = `posts/${Date.now()}_${safeName}`;
    const buffer = Buffer.from(base64, "base64");
    const file = bucket.file(destPath);

    await file.save(buffer, { contentType: mimeType });
    await file.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${destPath}`;
    console.log("✅ 画像アップロード完了:", url);
    return res.json({ success: true, url });
  } catch (e) {
    console.error("画像アップロードエラー:", e.message);
    return res.status(500).json({ error: "UPLOAD_FAILED", message: e.message });
  }
});

// =====================
// エアドロ API（Dプラン）
// =====================
const airdropRouter = express.Router();

airdropRouter.post("/register", async (req, res) => {
  const { address, campaign, timestamp, signature } = req.body;
  if (!address || !campaign || !timestamp || !signature) return res.status(400).json({ error: "MISSING_PARAMS" });
  if (campaign !== CAMPAIGN_ID) return res.status(400).json({ error: "INVALID_CAMPAIGN" });
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return res.status(400).json({ error: "TIMESTAMP_EXPIRED" });
  if (new Date() > CAMPAIGN_DEADLINE) return res.status(400).json({ error: "CAMPAIGN_ENDED" });
  if (!verifyAirdropSignature({ address, campaign, timestamp, signature })) return res.status(401).json({ error: "INVALID_SIGNATURE" });

  if (!db) {
    console.log("⚠️ Firestore未接続 - 登録をスキップ:", address);
    return res.json({ success: true, message: "受付完了（テストモード）" });
  }
  try {
    const docRef = db.collection("airdrop_registrations").doc(address.toLowerCase());
    const existing = await docRef.get();
    if (existing.exists) return res.status(409).json({ error: "ALREADY_REGISTERED" });
    await docRef.set({ address: address.toLowerCase(), campaign, timestamp, registeredAt: new Date(), status: "pending", amount: "100" });
    console.log("✅ エアドロ登録:", address);
    return res.json({ success: true, message: "100 EMUER 受取予約が完了しました" });
  } catch (e) {
    console.error("Firestore書き込みエラー:", e);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

airdropRouter.get("/status/:address", async (req, res) => {
  if (!db) return res.json({ registered: false });
  try {
    const doc = await db.collection("airdrop_registrations").doc(req.params.address.toLowerCase()).get();
    if (!doc.exists) return res.json({ registered: false });
    const data = doc.data();
    return res.json({ registered: true, status: data.status, amount: data.amount, txHash: data.txHash || null });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

airdropRouter.post("/batch/run", requireAdminKey, async (req, res) => {
  res.json({ message: "バッチを開始します" });
  runAirdropBatch();
});

app.use("/airdrop", airdropRouter);

// =====================
// オーナー署名検証ユーティリティ
// =====================
const SP_OWNER_ADDRESS = (process.env.SP_OWNER_ADDRESS || "0xdcc687c05f130e57597a8525771299a4efb6edf7").toLowerCase();

// 管理者キー検証ミドルウェア（ADMIN_SECRET_KEY 未設定時は全リクエスト拒否）
function requireAdminKey(req, res, next) {
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret || req.headers["x-admin-key"] !== secret) {
    return res.status(403).json({ error: "UNAUTHORIZED" });
  }
  next();
}

// 管理画面の入室チェック用（キーが正しいかだけを返す）
app.get("/api/admin/verify", requireAdminKey, (req, res) => res.json({ ok: true }));

function verifyOwnerSignature({ address, action, timestamp, signature }) {
  try {
    const message = `SchoolPark Admin:${action}:${timestamp}`;
    const recovered = ethers.utils.verifyMessage(message, signature);
    return recovered.toLowerCase() === SP_OWNER_ADDRESS &&
           recovered.toLowerCase() === address.toLowerCase() &&
           Math.abs(Math.floor(Date.now() / 1000) - timestamp) < 300;
  } catch (e) {
    console.error("オーナー署名検証エラー:", e.message);
    return false;
  }
}

// =====================
// 月次EMUER配布 API (毎月20日・オーナーのみ)
// =====================
async function runMonthlyDistribution(monthKey) {
  if (!db || !emuerContract) { console.warn("⚠️ 月次配布スキップ: 未初期化"); return { error: "NOT_INITIALIZED" }; }
  try {
    // 配布対象: emuer_rate コレクションに記録のある全ウォレット
    const snapshot = await db.collection("emuer_rate").get();
    const addresses = snapshot.docs.map(d => d.id).filter(a => /^0x[0-9a-f]{40}$/i.test(a));
    if (addresses.length === 0) { console.log("ℹ️ 月次配布: 対象ユーザーなし"); return { count: 0 }; }

    const amounts = addresses.map(() => ethers.utils.parseUnits("1000", 18));
    console.log(`📦 月次配布対象: ${addresses.length} 件`);

    const gasOptions = { maxPriorityFeePerGas: ethers.utils.parseUnits("40","gwei"), maxFeePerGas: ethers.utils.parseUnits("100","gwei"), gasLimit: 800000 };
    const tx = await emuerContract.addGoodBatch(addresses, amounts, gasOptions);
    const receipt = await tx.wait();
    console.log("✅ 月次配布TX確定:", receipt.transactionHash);

    await db.collection("monthly_distributions").doc(monthKey).set({
      status: "done", txHash: receipt.transactionHash,
      count: addresses.length, distributedAt: new Date(), monthKey
    });
    return { success: true, txHash: receipt.transactionHash, count: addresses.length };
  } catch (err) {
    console.error("❌ 月次配布エラー:", err.message);
    await db.collection("monthly_distributions").doc(monthKey).set({ status: "error", error: err.message, monthKey, distributedAt: new Date() });
    return { error: err.message };
  }
}

app.post("/monthly-distribute", async (req, res) => {
  const { address, action, timestamp, signature } = req.body;
  if (!verifyOwnerSignature({ address, action: "monthly-distribute", timestamp, signature }))
    return res.status(403).json({ error: "UNAUTHORIZED" });

  // 20日チェック（日本時間）
  const jstNow = new Date(Date.now() + 9 * 3600000);
  if (jstNow.getDate() !== 20)
    return res.status(400).json({ error: "NOT_20TH", message: "配布は毎月20日のみ実行できます" });

  const monthKey = `${jstNow.getFullYear()}-${String(jstNow.getMonth()+1).padStart(2,"0")}`;
  if (db) {
    const existing = await db.collection("monthly_distributions").doc(monthKey).get();
    if (existing.exists && existing.data().status === "done")
      return res.status(409).json({ error: "ALREADY_DISTRIBUTED", txHash: existing.data().txHash, count: existing.data().count });
  }

  res.json({ message: `${monthKey} の月次配布を開始します` });
  runMonthlyDistribution(monthKey);
});

app.get("/monthly-distribute/status", async (req, res) => {
  if (!db) return res.json({ distributions: [] });
  try {
    const snap = await db.collection("monthly_distributions").orderBy("distributedAt","desc").limit(6).get();
    const distributions = snap.docs.map(d => d.data());
    return res.json({ distributions });
  } catch (e) { return res.json({ distributions: [] }); }
});

// =====================
// 管理者: 制限回数ランキング
// =====================
app.get("/admin/restriction-stats", async (req, res) => {
  const { address, action, timestamp, signature } = req.query;
  if (!verifyOwnerSignature({ address, action: "restriction-stats", timestamp: parseInt(timestamp), signature }))
    return res.status(403).json({ error: "UNAUTHORIZED" });
  if (!db) return res.json({ stats: [] });
  try {
    const snap = await db.collection("emuer_rate").get();
    const stats = snap.docs
      .map(d => ({ address: d.id, ...d.data() }))
      .filter(u => (u.restrictionCount || 0) > 0)
      .sort((a, b) => (b.restrictionCount || 0) - (a.restrictionCount || 0))
      .slice(0, 50);
    return res.json({ stats });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// =====================
// 管理者: ボーナス報酬手動送金
// =====================
app.post("/admin/send-reward", async (req, res) => {
  const { address: ownerAddress, action, timestamp, signature, targetAddress, amount, reason } = req.body;
  if (!verifyOwnerSignature({ address: ownerAddress, action: "send-reward", timestamp, signature }))
    return res.status(403).json({ error: "UNAUTHORIZED" });
  if (!emuerContract) return res.status(503).json({ error: "CONTRACT_NOT_INITIALIZED" });

  try {
    const amountWei = ethers.utils.parseUnits(String(amount), 18);
    const gasOptions = { maxPriorityFeePerGas: ethers.utils.parseUnits("40","gwei"), maxFeePerGas: ethers.utils.parseUnits("100","gwei"), gasLimit: 200000 };
    const tx = await emuerContract.addGoodBatch([targetAddress], [amountWei], gasOptions);
    const receipt = await tx.wait();
    console.log(`🎁 ボーナス送金: ${targetAddress} ← ${amount} EMUER | TX: ${receipt.transactionHash}`);
    if (db) {
      await db.collection("bonus_rewards").add({ targetAddress, amount: String(amount), reason: reason || "", txHash: receipt.transactionHash, sentAt: new Date(), ownerAddress });
    }
    return res.json({ success: true, txHash: receipt.transactionHash });
  } catch (err) {
    console.error("❌ ボーナス送金エラー:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// =====================
// 秘密のとびら 報酬 API
// =====================
const SECRET_DOOR_AMOUNTS = { 1: 100, 2: 150, 3: 120, 4: 130, 5: 200 };

async function runSecretDoorBatch() {
  if (!db || !emuerContract) {
    console.warn("⚠️ Firestore または emuerContract が未初期化。秘密のとびらバッチをスキップ。");
    return;
  }
  console.log("🚀 秘密のとびらバッチ開始:", new Date().toISOString());
  try {
    const snapshot = await db
      .collection("secret_door_rewards")
      .where("status", "==", "pending")
      .limit(50)
      .get();

    if (snapshot.empty) { console.log("ℹ️ 秘密のとびら送金対象なし"); return; }

    const targets = snapshot.docs.map(doc => doc.data());
    const addresses = targets.map(t => t.address);
    const amounts = targets.map(t => ethers.utils.parseUnits(String(t.amount || "100"), 18));

    console.log(`📦 秘密のとびら送金対象: ${addresses.length} 件`);

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.update(doc.ref, { status: "processing" }));
    await batch.commit();

    const gasOptions = {
      maxPriorityFeePerGas: ethers.utils.parseUnits("40", "gwei"),
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      gasLimit: 500000
    };

    const tx = await emuerContract.addGoodBatch(addresses, amounts, gasOptions);
    console.log("📝 TX Hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ TX確定:", receipt.transactionHash);

    const doneBatch = db.batch();
    snapshot.docs.forEach(doc => {
      doneBatch.update(doc.ref, {
        status: "done",
        txHash: receipt.transactionHash,
        processedAt: new Date()
      });
    });
    await doneBatch.commit();
    console.log(`🎉 秘密のとびら報酬完了: ${addresses.length} 件`);

  } catch (err) {
    console.error("❌ 秘密のとびらバッチエラー:", err);
    try {
      const stuck = await db.collection("secret_door_rewards").where("status", "==", "processing").get();
      const rb = db.batch();
      stuck.docs.forEach(doc => rb.update(doc.ref, { status: "pending", errorMessage: err.message }));
      await rb.commit();
    } catch (rbErr) {
      console.error("❌ ロールバック失敗:", rbErr);
    }
  }
}

const secretDoorRouter = express.Router();

secretDoorRouter.post("/reward", async (req, res) => {
  const { address, doorId } = req.body;
  if (!address || !doorId) return res.status(400).json({ error: "MISSING_PARAMS" });

  const expectedAmount = SECRET_DOOR_AMOUNTS[Number(doorId)];
  if (!expectedAmount) return res.status(400).json({ error: "INVALID_DOOR_ID" });

  if (!db) {
    console.log("⚠️ Firestore未接続 - 秘密のとびら登録スキップ:", address, "door:", doorId);
    return res.json({ success: true, message: "受付完了（テストモード）" });
  }
  try {
    const docId = `secretDoor_${address.toLowerCase()}_${doorId}`;
    const docRef = db.collection("secret_door_rewards").doc(docId);
    const existing = await docRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: "ALREADY_REGISTERED", message: "このとびらの報酬は既に受け取り済みです" });
    }
    await docRef.set({
      address: address.toLowerCase(),
      doorId: Number(doorId),
      amount: String(expectedAmount),
      registeredAt: new Date(),
      status: "pending"
    });
    console.log("✅ 秘密のとびら報酬登録:", address, "door:", doorId, expectedAmount, "EMUER");
    return res.json({ success: true, message: `${expectedAmount} EMUER 受取予約が完了しました` });
  } catch (e) {
    console.error("秘密のとびら報酬エラー:", e);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

secretDoorRouter.post("/batch/run", requireAdminKey, async (req, res) => {
  res.json({ message: "秘密のとびらバッチを開始します" });
  runSecretDoorBatch();
});

app.use("/secret-door", secretDoorRouter);

cron.schedule("0 2 * * *", () => { console.log("⏰ 定期エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });
cron.schedule("0 3 15 4 *", () => { console.log("🏁 最終エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });
cron.schedule("30 2 * * *", () => { console.log("⏰ 秘密のとびらバッチ起動"); runSecretDoorBatch(); }, { timezone: "Asia/Tokyo" });

// =====================
// 予約投稿 システム
// =====================
const SCHEDULE_NFT_ADDRESS = process.env.SCHEDULE_NFT_ADDRESS || "";
const SCHEDULE_NFT_ABI = ["function balanceOf(address) view returns (uint256)"];
const SCHEDULED_POSTS_COL = "scheduled_posts";

async function verifyScheduleNFT(address) {
  if (!SCHEDULE_NFT_ADDRESS) {
    console.warn("⚠️ SCHEDULE_NFT_ADDRESS 未設定 - NFTチェックをスキップ");
    return false;
  }
  try {
    const rpcProvider = new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL);
    const nft = new ethers.Contract(SCHEDULE_NFT_ADDRESS, SCHEDULE_NFT_ABI, rpcProvider);
    const balance = await nft.balanceOf(address);
    return balance.gt(0);
  } catch (e) {
    console.error("Schedule NFT check error:", e.message);
    return false;
  }
}

async function publishScheduledPosts() {
  if (!db) return;
  try {
    const now = new Date();
    const snap = await db.collection(SCHEDULED_POSTS_COL)
      .where("status", "==", "scheduled")
      .get();

    const due = snap.docs.filter(d => {
      const sa = d.data().scheduledAt;
      const date = sa?.toDate ? sa.toDate() : new Date(sa);
      return date <= now;
    });

    if (due.length === 0) return;
    console.log(`⏰ 予約投稿: ${due.length}件を公開します`);

    for (const docSnap of due) {
      const d = docSnap.data();
      try {
        const postRef = await db.collection("posts").add({
          title: d.title,
          body: d.body,
          tags: d.tags || "",
          address: d.address,
          userId: d.userId,
          userType: d.userType,
          createdAt: new Date(),
          updatedAt: new Date(),
          goodCount: 0,
          changeCount: 0,
          goodUsers: [],
          changeUsers: [],
          scheduledPostId: docSnap.id
        });
        await docSnap.ref.update({
          status: "published",
          publishedPostId: postRef.id,
          publishedAt: new Date()
        });
        console.log(`✅ 予約投稿公開: ${docSnap.id} → posts/${postRef.id}`);
      } catch (e) {
        console.error(`❌ 予約投稿公開失敗: ${docSnap.id}`, e.message);
      }
    }
  } catch (e) {
    console.error("publishScheduledPosts error:", e);
  }
}

// 5分ごとチェック（毎分→5分に変更でFirestore読み取りを 1/5 に削減）
cron.schedule("*/5 * * * *", () => publishScheduledPosts(), { timezone: "Asia/Tokyo" });

// 予約投稿 作成
app.post("/api/scheduled-posts", async (req, res) => {
  const { address, title, body, tags, scheduledAt, userId, userType } = req.body;
  if (!address || !title || !body || !scheduledAt) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  if (!db) return res.status(500).json({ error: "Firestore未接続" });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return res.status(400).json({ error: "INVALID_DATE" });
  }

  const hasNFT = await verifyScheduleNFT(address);
  if (!hasNFT) {
    return res.status(403).json({ error: "SCHEDULE_NFT_REQUIRED" });
  }

  try {
    const ref = await db.collection(SCHEDULED_POSTS_COL).add({
      title,
      body,
      tags: tags || "",
      address: address.toLowerCase(),
      userId: userId || address.toLowerCase(),
      userType: userType || "unknown",
      scheduledAt: scheduledDate,
      status: "scheduled",
      createdAt: new Date(),
      publishedPostId: null
    });
    console.log(`✅ 予約投稿登録: ${ref.id} by ${address} at ${scheduledDate.toISOString()}`);
    res.json({ success: true, id: ref.id });
  } catch (e) {
    console.error("scheduled-posts create error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 予約投稿 一覧取得
app.get("/api/scheduled-posts", async (req, res) => {
  const address = (req.query.address || "").toLowerCase();
  if (!address) return res.status(400).json({ error: "MISSING_ADDRESS" });
  if (!db) return res.json([]);
  try {
    const snap = await db.collection(SCHEDULED_POSTS_COL)
      .where("address", "==", address)
      .where("status", "==", "scheduled")
      .get();

    const items = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      scheduledAt: d.data().scheduledAt?.toDate?.()?.toISOString() || d.data().scheduledAt
    }));
    items.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    res.json(items);
  } catch (e) {
    console.error("scheduled-posts get error:", e);
    res.status(500).json([]);
  }
});

// 予約投稿 キャンセル
app.delete("/api/scheduled-posts/:id", async (req, res) => {
  const { address } = req.body;
  if (!db) return res.status(500).json({ error: "Firestore未接続" });
  try {
    const ref = db.collection(SCHEDULED_POSTS_COL).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    if (snap.data().address !== (address || "").toLowerCase()) {
      return res.status(403).json({ error: "UNAUTHORIZED" });
    }
    if (snap.data().status !== "scheduled") {
      return res.status(400).json({ error: "ALREADY_PUBLISHED" });
    }
    await ref.update({ status: "cancelled" });
    console.log(`🗑️ 予約投稿キャンセル: ${req.params.id}`);
    res.json({ success: true });
  } catch (e) {
    console.error("scheduled-posts delete error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// お問い合わせ API（復元）
// ════════════════════════════════════════
app.post("/api/contact", async (req, res) => {
  const { type, name, email, company, message, scale, source } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "必須項目が不足しています" });
  }

  const payload = {
    type: type || "general",
    name, email,
    company: company || "",
    message,
    scale: scale || "",
    source: source || "unknown",
    submittedAt: new Date().toISOString()
  };

  try {
    // 1. Firestoreに保存
    if (db) {
      await db.collection("contact_submissions").add(payload);
      console.log("✅ Firestore: contact saved");
    }

    // 2. Notionに保存
    const NOTION_TOKEN = process.env.NOTION_TOKEN;
    const NOTION_DB_ID = "32b72abf64104a618d3d2ec00d3b37ba";

    if (NOTION_TOKEN) {
      const typeMap = { general: "💬一般", event: "🎪イベント", media: "📰取材", investor: "💰投資家" };
      const sourceMap = { "emu-widget": "Emuウィジェット", "hp-form": "HPフォーム" };

      const notionRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28"
        },
        body: JSON.stringify({
          parent: { database_id: NOTION_DB_ID },
          properties: {
            "件名・概要": { title: [{ text: { content: `[${typeMap[type] || type}] ${name}` } }] },
            "種別": { select: { name: typeMap[type] || "💬一般" } },
            "ステータス": { select: { name: "未対応" } },
            "送信者名": { rich_text: [{ text: { content: name } }] },
            "メールアドレス": { email: email },
            "会社名": { rich_text: [{ text: { content: company || "" } }] },
            "メッセージ": { rich_text: [{ text: { content: message.slice(0, 2000) } }] },
            "ソース": { select: { name: sourceMap[source] || "直接" } },
            "送信日時": { date: { start: new Date().toISOString() } }
          }
        })
      });

      if (!notionRes.ok) {
        const err = await notionRes.json();
        console.error("Notion API error:", err);
      } else {
        console.log("✅ Notion: contact saved");
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Contact API error:", err);
    res.status(500).json({ error: "サーバーエラー" });
  }
});

// ════════════════════════════════════════
// Room1 API ── Firestore永続化版（修正版）
// backend/server.js の Room1 APIセクションを
// このコードに完全置き換えてください
// ════════════════════════════════════════

const ROOM1_CONTENTS_COL   = "room1_contents";
const ROOM1_SUBMISSIONS_COL = "room1_submissions";

// ── room1コンテンツ キャッシュ（10分TTL） ──
const _room1Cache = { data: null, fetchedAt: 0 };
const ROOM1_CACHE_TTL = 10 * 60 * 1000; // 10分

// ── コンテンツ一覧取得 ──
app.get("/api/room1/contents", async (req, res) => {
  if (!db) return res.json([]);
  const now = Date.now();
  // キャッシュHITならFirestoreを読まずに返す
  if (_room1Cache.data && now - _room1Cache.fetchedAt < ROOM1_CACHE_TTL) {
    return res.json(_room1Cache.data);
  }
  try {
    const snapshot = await db.collection(ROOM1_CONTENTS_COL).get();
    const contents = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    _room1Cache.data = contents;
    _room1Cache.fetchedAt = now;
    res.json(contents);
  } catch (err) {
    console.error("room1/contents get error:", err.code, err.message);
    // キャッシュが残っていれば古いデータで応答
    if (_room1Cache.data) return res.json(_room1Cache.data);
    res.status(500).json({ error: err.message, code: err.code || "UNKNOWN" });
  }
});

// ── 直接追加（管理者のみ）──
app.post("/api/room1/direct-add", requireAdminKey, async (req, res) => {
  try {
    const { theme, subTheme, subSubTheme, summary, body, note, noteUrl } = req.body;

    if (!theme || !subTheme || !body) {
      return res.status(400).json({ error: "theme, subTheme, body は必須です" });
    }

    if (!db) return res.status(500).json({ error: "Firestore未接続" });

    const newItem = {
      title: subSubTheme
        ? `${theme}/${subTheme}/${subSubTheme}`
        : `${theme}/${subTheme}`,
      theme,
      subTheme,
      subSubTheme: subSubTheme || "",
      summary: summary || "",
      body,
      note: note || "",
      noteUrl: noteUrl || "",
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection(ROOM1_CONTENTS_COL).add(newItem);
    _room1Cache.data = null; // キャッシュ無効化
    console.log(`✅ Direct add: ${newItem.title} (${docRef.id})`);
    // 自動お知らせ追加
    _spAddNotification({
      title: `📚 学習コンテンツが追加されました`,
      body: `「${newItem.title}」が学習ルームに追加されました。`,
      link: "/schoolpark/north-library.html",
      contentType: "room1",
      icon: "📚"
    });
    res.json({ success: true, item: { id: docRef.id, ...newItem } });

  } catch (err) {
    console.error("direct-add error:", err);
    res.status(500).json({ error: "追加に失敗しました: " + err.message });
  }
});

// ── お預かり箱：送信 ──
app.post("/api/room1/submit", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });

    const item = {
      theme:     req.body.theme    || "",
      subTheme:  req.body.subTheme || "",
      content:   req.body.content  || "",
      status:    "pending",
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection(ROOM1_SUBMISSIONS_COL).add(item);
    console.log(`✅ Submission added: ${docRef.id}`);
    res.json({ success: true, id: docRef.id });
  } catch (err) {
    console.error("submit error:", err);
    res.status(500).json({ error: "submit failed: " + err.message });
  }
});

// ── お預かり箱：一覧取得（pendingのみ）──
app.get("/api/room1/submissions", requireAdminKey, async (req, res) => {
  try {
    if (!db) return res.json([]);

    // whereのみ（orderByなし → インデックス不要）
    const snapshot = await db
      .collection(ROOM1_SUBMISSIONS_COL)
      .where("status", "==", "pending")
      .get();

    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // JS側で新しい順にソート
    items.sort((a, b) => {
      const ta = a.createdAt || "";
      const tb = b.createdAt || "";
      return tb.localeCompare(ta); // 降順
    });

    console.log(`📬 Submissions取得: ${items.length}件`);
    res.json(items);
  } catch (err) {
    console.error("submissions get error:", err);
    res.status(500).json([]);
  }
});

// ── お預かり箱：昇華（承認）──
app.post("/api/room1/approve/:id", requireAdminKey, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });

    const submDoc = await db.collection(ROOM1_SUBMISSIONS_COL).doc(req.params.id).get();
    if (!submDoc.exists) return res.status(404).json({ error: "not found" });

    const item = submDoc.data();
    const { summary, body, note, noteUrl } = req.body;

    const newItem = {
      title:       `${item.theme}/${item.subTheme}`,
      theme:       item.theme,
      subTheme:    item.subTheme,
      subSubTheme: "",
      summary:     summary || "",
      body:        body    || item.content,
      note:        note    || "",
      noteUrl:     noteUrl || "",
      createdAt:   new Date().toISOString()
    };

    await db.collection(ROOM1_CONTENTS_COL).add(newItem);
    await db.collection(ROOM1_SUBMISSIONS_COL).doc(req.params.id).update({ status: "done" });
    _room1Cache.data = null; // キャッシュ無効化
    console.log(`✅ Approved & added to contents: ${newItem.title}`);
    // 自動お知らせ追加
    _spAddNotification({
      title: `📚 学習コンテンツが追加されました`,
      body: `「${newItem.title}」が学習ルームに追加されました。`,
      link: "/schoolpark/north-library.html",
      contentType: "room1",
      icon: "📚"
    });
    res.json({ success: true });

  } catch (err) {
    console.error("approve error:", err);
    res.status(500).json({ error: "approve failed: " + err.message });
  }
});

// ── お預かり箱：見送り ──
app.post("/api/room1/reject/:id", requireAdminKey, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    await db.collection(ROOM1_SUBMISSIONS_COL).doc(req.params.id).update({ status: "rejected" });
    console.log(`🗑️ Rejected: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("reject error:", err);
    res.status(500).json({ error: "reject failed: " + err.message });
  }
});

// ── コンテンツ全削除（管理者のみ）──
app.delete("/api/room1/contents/all", requireAdminKey, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const snapshot = await db.collection(ROOM1_CONTENTS_COL).get();
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`🗑️ room1_contents 全削除: ${snapshot.size}件`);
    res.json({ success: true, deleted: snapshot.size });
  } catch (err) {
    console.error("contents delete-all error:", err);
    res.status(500).json({ error: "delete failed: " + err.message });
  }
});

// ════════════════════════════════════════════════════════
// ユーザープロフィール API + ランキング API v3
// server.js の既存ランキングAPIを全てこれに置き換える
// ════════════════════════════════════════════════════════

// ── ユーザー名の保存 ──
app.post('/api/user/setname', async (req, res) => {
  try {
    const address     = (req.body.address     || '').toLowerCase().trim();
    const displayName = (req.body.displayName || '').trim().slice(0, 30);

    if (!address || !displayName) {
      return res.status(400).json({ error: 'address と displayName が必要です' });
    }
    if (!db) return res.status(500).json({ error: 'Firestore未接続' });

    await db.collection('user_profiles').doc(address).set({
      address,
      displayName,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log('✅ DisplayName set:', address, '->', displayName);
    res.json({ success: true });
  } catch (err) {
    console.error('setname error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ユーザー名の取得（単体） ──
app.get('/api/user/name/:address', async (req, res) => {
  try {
    if (!db) return res.json({ displayName: null });
    const docId = req.params.address.toLowerCase();
    const doc = await db.collection('user_profiles').doc(docId).get();
    if (!doc.exists) return res.json({ displayName: null });
    res.json({ displayName: doc.data().displayName || null });
  } catch (err) {
    res.status(500).json({ displayName: null });
  }
});

// ── ランキング用サーバーキャッシュ（5分TTL） ──
const _rankingCache = {
  postsSnap: null,
  names:     null,
  fetchedAt: 0,
};
const RANKING_CACHE_TTL = 5 * 60 * 1000; // 5分

async function _getRankingSource() {
  const now = Date.now();
  if (_rankingCache.postsSnap && now - _rankingCache.fetchedAt < RANKING_CACHE_TTL) {
    console.log('📊 RankingCache HIT');
    return { postsSnap: _rankingCache.postsSnap, names: _rankingCache.names };
  }
  console.log('📊 RankingCache MISS — Firestore読み取り');
  const [postsSnap, names] = await Promise.all([
    db.collection('posts').limit(500).get(),
    fetchAllDisplayNames(),
  ]);
  _rankingCache.postsSnap = postsSnap;
  _rankingCache.names     = names;
  _rankingCache.fetchedAt = now;
  return { postsSnap, names };
}

// ── ユーザー名テーブルを一括取得（ランキング用内部関数） ──
async function fetchAllDisplayNames() {
  if (!db) return {};
  try {
    const snapshot = await db.collection('user_profiles').get();
    const map = {};
    snapshot.docs.forEach(doc => {
      const d = doc.data();
      if (d.address && d.displayName) {
        map[d.address.toLowerCase()] = d.displayName;
      }
    });
    return map;
  } catch (e) {
    console.error('fetchAllDisplayNames error:', e);
    return {};
  }
}

// ── アドレス短縮表示 ──
function shortAddr(addr) {
  if (!addr || addr === 'unknown') return '匿名';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// ── ランキング取得 ──
// type: good_post | change_post | total_post | posted | good_given | change_given
app.get('/api/ranking', async (req, res) => {
  try {
    if (!db) return res.json([]);

    const type  = req.query.type  || 'good_post';
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    // キャッシュから posts + names を取得（5分TTLで Firestore 読み取りを抑制）
    const { postsSnap, names } = await _getRankingSource();

    let items = [];

    if (type === 'posted') {
      // ── 投稿数：addressごとにカウント ──
      const countMap = {};
      postsSnap.docs.forEach(doc => {
        const addr = (doc.data().address || '').toLowerCase();
        if (!addr || addr === 'unknown') return;
        countMap[addr] = (countMap[addr] || 0) + 1;
      });

      items = Object.keys(countMap).map(addr => ({
        address:     addr,
        displayName: names[addr] || shortAddr(addr),
        score:       countMap[addr],
        scoreLabel:  '📝 ' + countMap[addr] + '件'
      }));
      items.sort((a, b) => b.score - a.score);

    } else if (type === 'good_given' || type === 'change_given') {
      // ── 行動者ランキング：goodUsers / changeUsers 配列を集計 ──
      const field = type === 'good_given' ? 'goodUsers' : 'changeUsers';
      const emoji = type === 'good_given' ? '👍' : '🤝';
      const label = type === 'good_given' ? 'Good' : 'Change';

      const givenMap = {};
      postsSnap.docs.forEach(doc => {
        const users = doc.data()[field];
        if (!Array.isArray(users)) return;
        users.forEach(addr => {
          if (!addr) return;
          const a = addr.toLowerCase();
          givenMap[a] = (givenMap[a] || 0) + 1;
        });
      });

      items = Object.keys(givenMap).map(addr => ({
        address:     addr,
        displayName: names[addr] || shortAddr(addr),
        score:       givenMap[addr],
        scoreLabel:  emoji + ' ' + givenMap[addr] + '回 ' + label + 'した'
      }));
      items.sort((a, b) => b.score - a.score);

    } else {
      // ── 投稿者ランキング：good_post / change_post / total_post ──
      const scoreMap = {};
      postsSnap.docs.forEach(doc => {
        const d    = doc.data();
        const addr = (d.address || '').toLowerCase();
        if (!addr || addr === 'unknown') return;
        if (!scoreMap[addr]) scoreMap[addr] = { good: 0, change: 0 };
        scoreMap[addr].good   += (d.goodCount   || 0);
        scoreMap[addr].change += (d.changeCount || 0);
      });

      items = Object.keys(scoreMap).map(addr => {
        const s = scoreMap[addr];
        let score, scoreLabel;

        if (type === 'change_post') {
          score      = s.change;
          scoreLabel = '🤝 ' + s.change + ' Change獲得';
        } else if (type === 'total_post') {
          score      = s.good + s.change * 2;
          scoreLabel = '🏆 ' + score + '点  👍' + s.good + ' 🤝' + s.change;
        } else { // good_post
          score      = s.good;
          scoreLabel = '👍 ' + s.good + ' Good獲得';
        }

        return {
          address:     addr,
          displayName: names[addr] || shortAddr(addr),
          score,
          scoreLabel
        };
      });
      items.sort((a, b) => b.score - a.score);
    }

    // 0件フィルタ・上位N件
    items = items.filter(i => i.score > 0).slice(0, limit);

    console.log(`📊 Ranking[${type}]: ${items.length}件`);
    res.json(items);

  } catch (err) {
    console.error('ranking error:', err);
    res.status(500).json([]);
  }
});

// =====================
// Room3 リアルタイム
// =====================
const topics = [
  "なぜ空は青いのか？", "AIに感情や権利は認めるべきか？", "日本の義務教育は本当に必要か？",
  "仕事と趣味、どちらを優先すべきか？", "SNSは社会にとってプラスかマイナスか？",
  "遺伝子編集は許されるべきか？", "自動運転車の事故責任は誰が取るべきか？",
  "人は動物園で動物を見るべきか？", "給料は能力で決まるべきか？年功序列でよいか？",
  "本を紙で読むのと電子書籍で読むの、どちらがよいか？", "学校でプログラミングは必修にすべきか？",
  "旅行は国内と海外どちらが価値があるか？", "長時間労働は本当に悪か？",
  "宇宙旅行は一般人も行くべきか？", "服装の自由はどこまで許されるべきか？",
  "ゲームは教育に役立つか？", "自然エネルギーだけで日本はやっていけるか？",
  "タバコやお酒の規制はもっと厳しくすべきか？", "結婚は必ず必要か？",
  "犬と猫、どちらが飼いやすいか？", "健康のために運動は義務化すべきか？",
  "ロボットが人間の仕事を奪うのは良いことか？", "音楽はジャンルで人を判断できるか？",
  "美術館や博物館は学校に必修にすべきか？", "お金よりも時間を優先すべきか？",
  "お祭りや伝統行事は続けるべきか？", "記憶力より創造力が大事か？",
  "動物実験は許されるべきか？", "日本は移民をもっと受け入れるべきか？",
  "成功するために努力と才能、どちらが重要か？"
];

function getTodayTopic() {
  const day = new Date().getDate();
  return topics[(day - 1) % topics.length];
}

const messages = new Map();

// Fountain チャット履歴（メモリ + Firestore永続化）
const fountainMessages = new Map();
const FP_CHAT_COL = "sp_fountain_chat";

// 起動時にFirestoreからチャット履歴を復元
async function loadFountainHistory() {
  if (!db) { console.warn("⚠️ Firestore未接続 - チャット履歴のロードをスキップ"); return; }
  try {
    const snap = await db.collection(FP_CHAT_COL).orderBy("timestamp", "desc").limit(100).get();
    const docs = [];
    snap.forEach(d => docs.push({ messageId: d.id, ...d.data() }));
    docs.reverse().forEach(m => fountainMessages.set(m.messageId, m));
    console.log(`✅ Fountain チャット履歴 ${fountainMessages.size}件 を復元しました`);
  } catch(e) {
    console.warn("⚠️ チャット履歴の復元に失敗:", e.message);
  }
}
loadFountainHistory();

// Mansion 掲示板（Socket.io + Firestore永続化）
const mansionPosts    = new Map();
const MANSION_BOARD_COL = "sp_mansion_board";

async function loadMansionBoard() {
  if (!db) { console.warn("⚠️ Firestore未接続 - Mansion 掲示板ロードをスキップ"); return; }
  try {
    const snap = await db.collection(MANSION_BOARD_COL).orderBy("ts", "desc").limit(200).get();
    const docs = [];
    snap.forEach(d => docs.push({ postId: d.id, ...d.data() }));
    docs.reverse().forEach(m => mansionPosts.set(m.postId, m));
    console.log(`✅ Mansion 掲示板 ${mansionPosts.size}件 を復元しました`);
  } catch(e) {
    console.warn("⚠️ Mansion 掲示板の復元に失敗:", e.message);
  }
}
loadMansionBoard();

io.on("connection", (socket) => {
  console.log("接続:", socket.id);
  socket.emit("today topic", getTodayTopic());
  socket.emit("room3 history", Array.from(messages.values()));
  // Fountain チャット履歴を送信（メモリから）
  socket.emit("fountain history", Array.from(fountainMessages.values()).slice(-100));

  socket.on("join room3", ({ wallet }) => { socket.wallet = wallet; });

  // ★ Fountain チャット参加
  socket.on("join fountain", ({ wallet, name }) => {
    socket.fountainWallet = wallet || "guest";
    socket.fountainName   = name   || "名無し";
  });

  // ★ Fountain チャットメッセージ
  socket.on("fountain message", (data) => {
    if (!data.text || String(data.text).trim().length === 0) return;
    const messageId = randomUUID();
    const message = {
      id: socket.id,
      wallet: socket.fountainWallet || "guest",
      name: socket.fountainName || "名無し",
      messageId,
      text: String(data.text).slice(0, 500),
      timestamp: Date.now()
    };
    fountainMessages.set(messageId, message);
    // 100件を超えたら古いものをメモリから削除
    if (fountainMessages.size > 100) {
      fountainMessages.delete(fountainMessages.keys().next().value);
    }
    io.emit("fountain message", message);
    // Firestoreに永続保存（再起動してもメッセージが消えないように）
    if (db) {
      db.collection(FP_CHAT_COL).doc(messageId).set(message).catch(e => {
        console.warn("チャット保存失敗:", e.message);
      });
      // 古いメッセージ（200件超）を非同期で削除
      db.collection(FP_CHAT_COL).orderBy("timestamp","asc").limit(1).get().then(snap => {
        if (!snap.empty) {
          db.collection(FP_CHAT_COL).orderBy("timestamp","desc").offset(150).limit(50).get()
            .then(old => { const b = db.batch(); old.forEach(d => b.delete(d.ref)); b.commit().catch(()=>{}); })
            .catch(()=>{});
        }
      }).catch(()=>{});
    }
  });

  // ★ Mansion 掲示板履歴を送信
  socket.emit("mansion history", Array.from(mansionPosts.values()).slice(-50));

  // ★ Mansion 参加
  socket.on("join mansion", ({ wallet, name }) => {
    socket.mansionWallet = wallet || "guest";
    socket.mansionName   = name   || "住民";
  });

  // ★ Mansion 掲示板投稿
  socket.on("mansion post", (data) => {
    if (!data.text || String(data.text).trim().length === 0) return;
    const postId = randomUUID();
    const post = {
      postId,
      author: socket.mansionName || "住民",
      wallet: socket.mansionWallet || "guest",
      text: String(data.text).slice(0, 500),
      tag:  String(data.tag  || "住民投稿").slice(0, 20),
      ts:   Date.now()
    };
    mansionPosts.set(postId, post);
    if (mansionPosts.size > 200) {
      mansionPosts.delete(mansionPosts.keys().next().value);
    }
    io.emit("mansion post", post);
    if (db) {
      db.collection(MANSION_BOARD_COL).doc(postId).set(post).catch(e => {
        console.warn("Mansion 投稿保存失敗:", e.message);
      });
      db.collection(MANSION_BOARD_COL).orderBy("ts","desc").offset(200).limit(50).get()
        .then(old => { const b = db.batch(); old.forEach(d => b.delete(d.ref)); b.commit().catch(()=>{}); })
        .catch(()=>{});
    }
  });

  // ★ 議題の再リクエスト
  socket.on("request topic", () => {
    socket.emit("today topic", getTodayTopic());
  });

  socket.on("room3 message", (data) => {
    const messageId = randomUUID();
    const message = {
      id: socket.id, wallet: socket.wallet, messageId,
      text: data.text, replyTo: data.replyTo || null, timestamp: Date.now()
    };
    messages.set(messageId, message);
    io.emit("room3 message", message);
  });
});

// =====================
// SchoolPark お知らせ API
// =====================
const SP_NOTIFICATIONS_COL = "sp_notifications";

// GET /api/sp/notifications?limit=20&address=0x...
app.get("/api/sp/notifications", async (req, res) => {
  if (!db) return res.json([]);
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const address = (req.query.address || "").toLowerCase();
    const snap = await db.collection(SP_NOTIFICATIONS_COL)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    const items = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || "",
        body: d.body || "",
        link: d.link || "",
        contentType: d.contentType || "general",
        icon: d.icon || "📢",
        createdAt: d.createdAt?.toDate?.()?.toISOString() || d.createdAt || new Date().toISOString(),
        isRead: address ? (d.readBy || []).includes(address) : false
      };
    });
    return res.json(items);
  } catch (err) {
    console.error("sp/notifications get error:", err.message);
    return res.json([]);
  }
});

// POST /api/sp/notifications （管理者専用）
app.post("/api/sp/notifications", requireAdminKey, async (req, res) => {
  if (!db) return res.status(500).json({ error: "Firestore未接続" });
  const { title, body, link, contentType, icon } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const ref = await db.collection(SP_NOTIFICATIONS_COL).add({
      title,
      body: body || "",
      link: link || "",
      contentType: contentType || "general",
      icon: icon || "📢",
      readBy: [],
      createdAt: new Date()
    });
    console.log(`✅ SP通知追加: ${ref.id} "${title}"`);
    return res.json({ success: true, id: ref.id });
  } catch (err) {
    console.error("sp/notifications post error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sp/notifications/read-all （全既読）
app.post("/api/sp/notifications/read-all", async (req, res) => {
  const address = (req.body.address || "").toLowerCase();
  if (!address || !db) return res.json({ success: true });
  try {
    const admin = require("firebase-admin");
    const snap = await db.collection(SP_NOTIFICATIONS_COL)
      .orderBy("createdAt", "desc").limit(50).get();
    const batch = db.batch();
    snap.docs.forEach(doc => {
      if (!(doc.data().readBy || []).includes(address)) {
        batch.update(doc.ref, { readBy: admin.firestore.FieldValue.arrayUnion(address) });
      }
    });
    await batch.commit();
    return res.json({ success: true });
  } catch (err) {
    console.error("sp/notifications read-all error:", err.message);
    return res.json({ success: true });
  }
});

// POST /api/sp/notifications/:id/read （1件既読）
app.post("/api/sp/notifications/:id/read", async (req, res) => {
  const address = (req.body.address || "").toLowerCase();
  if (!address || !db) return res.json({ success: true });
  try {
    const admin = require("firebase-admin");
    await db.collection(SP_NOTIFICATIONS_COL).doc(req.params.id).update({
      readBy: admin.firestore.FieldValue.arrayUnion(address)
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("sp/notifications read error:", err.message);
    return res.json({ success: true }); // 非クリティカル
  }
});

// 内部ヘルパー: お知らせ自動追加
async function _spAddNotification({ title, body, link, contentType, icon }) {
  if (!db) return;
  try {
    await db.collection(SP_NOTIFICATIONS_COL).add({
      title, body: body || "", link: link || "",
      contentType: contentType || "general", icon: icon || "📢",
      readBy: [], createdAt: new Date()
    });
    console.log(`📢 SP自動通知: "${title}"`);
  } catch (e) {
    console.warn("SP通知追加失敗:", e.message);
  }
}

// =====================
// Start server
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔥 Emu Server running on port ${PORT}`);
});