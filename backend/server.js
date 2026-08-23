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
app.set("trust proxy", 1);
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
app.use((req, res, next) => {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 8 * 1024 * 1024) return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
  next();
});
// Stripe Webhook は署名検証に生のボディが必要なため、JSON パーサーを通さない。
const STRIPE_WEBHOOK_PATH = "/api/billing/webhook";
const jsonParser = express.json({ limit: '10mb' });
app.use((req, res, next) => {
  if (req.path === STRIPE_WEBHOOK_PATH) return next();
  return jsonParser(req, res, next);
});
app.use(
  express.static(
    path.join(__dirname, "..", "frontend", "public")
  )
);

// =====================
// Firebase Admin 初期化
// =====================
let db = null;
let firebaseAdmin = null;
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
    firebaseAdmin = admin;
    db = admin.firestore();
    console.log("✅ Firestore + Storage 初期化完了");
  } catch (e) {
    console.warn("⚠️ Firebase 初期化失敗:", e.message);
  }
};
initFirestore();

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_SECRET_KEY;
  if (!expected || req.headers["x-admin-key"] !== expected) return res.status(403).json({ error: "UNAUTHORIZED" });
  next();
}

const identityAccountCache = new Map();
const IDENTITY_CACHE_MS = 5 * 60 * 1000;
async function requireFirebaseUser(req, res, next) {
  try {
    if (!firebaseAdmin || !db) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(header.slice(7));
    const cached = identityAccountCache.get(decoded.uid);
    let accountData = cached && cached.expiresAt > Date.now() ? cached.data : null;
    if (!accountData) {
      const account = await db.collection("ches_accounts").doc(decoded.uid).get();
      if (!account.exists) return res.status(403).json({ error: "ACCOUNT_NOT_FOUND" });
      accountData = account.data();
      identityAccountCache.set(decoded.uid, { data: accountData, expiresAt: Date.now() + IDENTITY_CACHE_MS });
    }
    const walletAddress = String(accountData.walletAddress || "").toLowerCase();
    if (!walletAddress) return res.status(403).json({ error: "WALLET_NOT_FOUND" });
    req.identity = { uid: decoded.uid, walletAddress, account: accountData };
    next();
  } catch (_) {
    return res.status(401).json({ error: "INVALID_AUTH_TOKEN" });
  }
}

function requireOwnAddress(req, res, next) {
  const claimed = String(req.body?.address || req.query?.address || "").toLowerCase().trim();
  if (claimed && claimed !== req.identity.walletAddress) return res.status(403).json({ error: "ADDRESS_MISMATCH" });
  req.body = req.body || {};
  req.body.address = req.identity.walletAddress;
  next();
}

/* 管理操作（返金の承認・本人確認の閲覧など）はオーナーのウォレットに限定する。
   共有シークレット(x-admin-key)と違い、ブラウザの管理画面から
   ログイン済みユーザーとして本人性を確かめられる。 */
function requireOwner(req, res, next) {
  requireFirebaseUser(req, res, () => {
    const owner = String(process.env.SP_OWNER_ADDRESS || "0xdcc687c05f130e57597a8525771299a4efb6edf7").toLowerCase();
    if (req.identity.walletAddress !== owner) return res.status(403).json({ error: "OWNER_ONLY" });
    next();
  });
}

const rateBuckets = new Map();
function rateLimit({ windowMs, max, key }) {
  return (req, res, next) => {
    const bucketKey = `${key}:${req.identity?.uid || req.ip || "unknown"}`;
    const now = Date.now();
    if (rateBuckets.size > 5000) {
      for (const [storedKey, stored] of rateBuckets) if (stored.resetAt <= now) rateBuckets.delete(storedKey);
    }
    let bucket = rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateBuckets.set(bucketKey, bucket);
    if (bucket.count > max) return res.status(429).json({ error: "RATE_LIMITED", retryAfterMs: bucket.resetAt - now });
    next();
  };
}

const uploadRateLimit = rateLimit({ windowMs: 60_000, max: 10, key: "upload" });
const publicFormRateLimit = rateLimit({ windowMs: 10 * 60_000, max: 5, key: "form" });

// =====================
// 有料会員（月額10,000円）: 課金 / 返金 / 本人確認 / 対話記録
// =====================
/* 利用資格。「この人はいま何ができるか」をここ1か所で決める。
   契約（Stripe）と付与（Founding Emuer）の両方を見る。
   判定するだけで、まだ何も止めていない。止める場所は requirePlan を足したところだけ。 */
const entitlement = require("./entitlement").createEntitlement({ db });
const requirePlan = entitlement.requirePlan;

const membershipDeps = { db, firebaseAdmin, requireFirebaseUser, requireOwner, rateLimit, entitlement, requirePlan };
const billing = require("./billing").createBillingRouter({ ...membershipDeps, webhookPath: STRIPE_WEBHOOK_PATH });
const kyc = require("./kyc").createKycRouter(membershipDeps);
const dialogue = require("./dialogue").createDialogueRouter(membershipDeps);
const feedback = require("./feedback").createFeedbackRouter(membershipDeps);
// 運営の受領コメント（light 以上）。light の存在理由そのもの。
const review = require("./review").createReviewRouter(membershipDeps);

// Webhook は生ボディで受ける（JSON パーサーは上で迂回済み）
app.post(STRIPE_WEBHOOK_PATH, billing.webhookHandler, billing.handleWebhook);
app.use("/api/billing", billing.router);
app.use("/api/kyc", kyc.router);
app.use("/api/dialogue", dialogue.router);
app.use("/api/feedback", feedback.router);
app.use("/api/review", review.router);

// 未処理のまま保持期限(30日)を過ぎた本人確認書類を毎日破棄する。
cron.schedule("30 4 * * *", () => {
  console.log("⏰ 本人確認書類の保持期限チェック");
  kyc.purgeExpiredDocuments();
}, { timezone: "Asia/Tokyo" });

// =====================
// Ethers / コントラクト設定（Dプラン）
// =====================
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;
const EMUER_CONTRACT_ADDRESS = process.env.EMUER_CONTRACT_ADDRESS || "0x4418d5250Dae4b1125ADFCD5C0779B1412E4a964";
// 旧既定の https://polygon-rpc.com は API キー必須になり 401 を返すため、公開RPCへ変更。
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
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
app.post("/upload/image", requireFirebaseUser, requireOwnAddress, uploadRateLimit, async (req, res) => {
  const { base64, mimeType, filename } = req.body;
  if (!base64 || !mimeType || !filename) return res.status(400).json({ error: "MISSING_PARAMS" });

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowedTypes.includes(mimeType)) return res.status(400).json({ error: "INVALID_TYPE" });
  if (typeof base64 !== "string" || base64.length > 7_000_000) return res.status(413).json({ error: "IMAGE_TOO_LARGE" });

  try {
    const admin = require("firebase-admin");
    const bucket = admin.storage().bucket();
    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const destPath = `posts/${Date.now()}_${safeName}`;
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: "IMAGE_TOO_LARGE" });
    const signatures = {
      "image/jpeg": buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
      "image/png": buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
      "image/gif": buffer.length > 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")),
      "image/webp": buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
    };
    if (!signatures[mimeType]) return res.status(400).json({ error: "INVALID_IMAGE_DATA" });
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

airdropRouter.post("/batch/run", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  res.json({ message: "バッチを開始します" });
  runAirdropBatch();
});

app.use("/airdrop", airdropRouter);

// =====================
// オーナー署名検証ユーティリティ
// =====================
const SP_OWNER_ADDRESS = (process.env.SP_OWNER_ADDRESS || "0xdcc687c05f130e57597a8525771299a4efb6edf7").toLowerCase();

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

secretDoorRouter.post("/reward", (_req, res) => {
  return res.status(410).json({ error: "FEATURE_REMOVED" });
});

// Legacy handler retained under a non-public path for migration reference only.
secretDoorRouter.post("/reward-disabled", requireAdmin, async (req, res) => {
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

secretDoorRouter.post("/batch/run", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  res.json({ message: "秘密のとびらバッチを開始します" });
  runSecretDoorBatch();
});

app.use("/secret-door", secretDoorRouter);

// =====================
// Emu「知識を探しています」EMUER懸賞
// 採用済みの募集・回答と一致する申請だけを検証して配布する
// =====================

/* いま募集を作るときの懸賞額。画面（index.html の bounty）と必ず揃える。 */
const KNOWLEDGE_BOUNTY = 3;

/* 配布を認める額。3 は現行、10 は 2026-08-17 より前に作られた募集の分。
   古い募集がまだ採用されていないうちに 3 だけを認めると、
   回答者に懸賞が渡らないまま弾かれてしまうため、当面は両方を通す。
   古い募集がすべて片付いたら 10 を外してよい。 */
const KNOWLEDGE_BOUNTY_ALLOWED = [KNOWLEDGE_BOUNTY, 10];

async function runKnowledgeBountyBatch() {
  if (!db) {
    console.warn("⚠️ Firestore未初期化。知識懸賞バッチをスキップ。");
    return;
  }
  console.log("🚀 知識懸賞バッチ開始:", new Date().toISOString());
  try {
    const snapshot = await db.collection("emuer_bounty_claims")
      .where("status", "==", "pending")
      .limit(50)
      .get();
    if (snapshot.empty) return;

    const valid = [];
    for (const claimDoc of snapshot.docs) {
      const claim = claimDoc.data();
      const requestDoc = await db.collection("knowledge_requests").doc(String(claim.requestId || "")).get();
      if (!requestDoc.exists) {
        await claimDoc.ref.update({ status:"rejected", errorMessage:"REQUEST_NOT_FOUND", processedAt:new Date() });
        continue;
      }
      const request = requestDoc.data();
      const amount = Math.floor(Number(claim.amount));
      const recipient = String(claim.recipient || "").toLowerCase();
      // 懸賞は一律3 EMUERに固定。クライアント値は偽装可能なため、
      // サーバー側で決められた額ちょうど以外は配布しない（不正な高額配布を防ぐ）。
      const matches = request.status === "awarded"
        && request.settlementStatus === "pending_distribution"
        && String(request.acceptedAnswerAuthor || "").toLowerCase() === recipient
        && Number(request.bounty) === amount
        && ethers.utils.isAddress(recipient)
        && KNOWLEDGE_BOUNTY_ALLOWED.includes(amount);
      if (!matches) {
        await claimDoc.ref.update({ status:"rejected", errorMessage:"CLAIM_MISMATCH", processedAt:new Date() });
        continue;
      }
      if (amount === 0) {
        await claimDoc.ref.update({ status:"done", txHash:null, processedAt:new Date() });
        await requestDoc.ref.update({ settlementStatus:"done", settledAt:new Date() });
        continue;
      }
      // 回答者(受取人)のCHES判定（uid記録用）。実EMUERは送らずオフチェーン台帳へ計上。
      const answererWalletDoc = await db.collection("ches_wallets").doc(recipient).get();
      const answererUid = (answererWalletDoc.exists && answererWalletDoc.data().type === "address-only")
        ? (answererWalletDoc.data().uid || null) : null;

      // ── エスクロー相当：募集者(request.author)の残高から支払う（無からの生成を排除）──
      // 懸賞は「募集者→回答者」の純粋な移転にする。募集者がオフチェーン残高>=懸賞額を
      // 持っていなければ配布しない。これにより不正な自作自演でもEMUER総量は増えない。
      const requesterAddr = String(request.author || "").toLowerCase();
      if (!requesterAddr || requesterAddr === recipient) {
        await claimDoc.ref.update({ status:"rejected", errorMessage:"INVALID_REQUESTER", processedAt:new Date() });
        continue;
      }
      const requesterLedger = await db.collection("emuer_offchain").doc(requesterAddr).get();
      const requesterBalance = requesterLedger.exists ? (Number(requesterLedger.data().balance) || 0) : 0;
      if (requesterBalance < amount) {
        // 募集者が懸賞分を持っていない → 配布不可（無資金配布の防止）
        await claimDoc.ref.update({ status:"rejected", errorMessage:"INSUFFICIENT_FUNDS", processedAt:new Date() });
        await requestDoc.ref.update({ settlementStatus:"insufficient_funds", settledAt:new Date() });
        continue;
      }
      valid.push({ claimDoc, requestDoc, recipient, amount, answererUid, requesterAddr });
    }
    if (!valid.length) return;

    const processing = db.batch();
    valid.forEach(item => processing.update(item.claimDoc.ref, { status:"processing" }));
    await processing.commit();

    // ── 懸賞の確定：募集者から差し引き、回答者へ加算（差引ゼロ・オフチェーン移転）──
    // 総EMUER量は不変。将来CHESウォレット本開発時に emuer_offchain.balance を実EMUERで精算。
    const settle = db.batch();
    // admin はこのスコープに存在しない（各所でローカル require されているだけ）。
    // ここで admin を参照すると ReferenceError でバッチ全体が落ちる。
    const FieldValue = firebaseAdmin.firestore.FieldValue;
    valid.forEach(item => {
      // 募集者（支払い元）: balance を減らし、支払い累計 spentBounty を積む
      settle.set(db.collection("emuer_offchain").doc(item.requesterAddr), {
        address: item.requesterAddr,
        balance: FieldValue.increment(-item.amount),
        spentBounty: FieldValue.increment(item.amount),
        updatedAt: new Date()
      }, { merge: true });
      // 回答者（受取人）: bountyBalance と balance を加算
      settle.set(db.collection("emuer_offchain").doc(item.recipient), {
        address: item.recipient,
        uid: item.answererUid,
        bountyBalance: FieldValue.increment(item.amount),
        balance: FieldValue.increment(item.amount),
        updatedAt: new Date()
      }, { merge: true });
      // 監査ログ（移転）
      settle.set(db.collection("emuer_offchain_ledger").doc(), {
        from: item.requesterAddr, to: item.recipient, amount: item.amount,
        reason: "knowledge_bounty", requestId: item.requestDoc.id, claimId: item.claimDoc.id,
        createdAt: new Date()
      });
      settle.update(item.claimDoc.ref, { status:"done", settlement:"offchain_transfer", processedAt:new Date() });
      settle.update(item.requestDoc.ref, { settlementStatus:"done", settlement:"offchain_transfer", settledAt:new Date() });
    });
    await settle.commit();
    console.log(`💠 知識懸賞（募集者→回答者の移転）完了: ${valid.length} 件`);
  } catch (error) {
    console.error("❌ 知識懸賞バッチエラー:", error);
    try {
      const stuck = await db.collection("emuer_bounty_claims").where("status", "==", "processing").get();
      const rollback = db.batch();
      stuck.docs.forEach(doc => rollback.update(doc.ref, { status:"pending", errorMessage:error.message }));
      await rollback.commit();
    } catch (rollbackError) {
      console.error("❌ 知識懸賞ロールバック失敗:", rollbackError);
    }
  }
}

cron.schedule("0 2 * * *", () => { console.log("⏰ 定期エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });
cron.schedule("0 3 15 4 *", () => { console.log("🏁 最終エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });
// 「秘密のとびら」は廃止済みのため自動報酬バッチも停止。
cron.schedule("0 * * * *", () => { console.log("⏰ 知識懸賞バッチ起動"); runKnowledgeBountyBatch(); }, { timezone: "Asia/Tokyo" });

/* 受領コメントの期限を毎朝見る。規約で7営業日以内と約束しているので、
   返し忘れに気づける形にしておく。ログに出れば Render の画面で拾える。 */
cron.schedule("0 9 * * *", async () => {
  try {
    const d = await review.dueSoon();
    if (d.overdue > 0) {
      console.error("🔴 受領コメント: 期限を過ぎているものが " + d.overdue + " 件あります（500円の割引が必要になります）");
    }
    if (d.dueIn2Days > 0) {
      console.warn("🟠 受領コメント: あと2日以内が " + d.dueIn2Days + " 件");
    }
    if (d.overdue === 0 && d.dueIn2Days === 0 && d.pending > 0) {
      console.log("受領コメント: 未返信 " + d.pending + " 件（期限に余裕あり）");
    }
  } catch (e) {
    console.error("受領コメントの期限確認に失敗:", e.message);
  }
}, { timezone: "Asia/Tokyo" });

// =====================
// オフチェーンEMUER台帳の照合バッチ（CHESユーザーのGood/Change・ログインボーナス）
// 検証可能なFirestoreデータから毎回“再計算”するため、localStorage改ざんでは水増しできない。
// これが将来「実EMUER」で精算する durable な source of truth。
//   balance = bountyBalance(懸賞・イベント式) + reactionBalance(評価された分) + loginBalance(ログボ)
// 付与ルール（確定）:
//   ・Good/Change = 評価された投稿者が得る: floor(受Good/10) + floor(受Change/20)×3
//   ・ログインボーナス = ユーザーが受取ボタンを押したときだけ +0.5（/api/emuer/login-bonus）
//     このバッチでは自動付与しない。ログインしただけで勝手に受取済みになると、
//     受取ボタンが機能していないように見えるため。loginBalance は読むだけで加算しない。
// =====================
function _jstDateStr(d) {
  // Asia/Tokyo の YYYY-MM-DD
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCFullYear() + "-" + (jst.getUTCMonth() + 1) + "-" + jst.getUTCDate();
}
const EMU_LOGIN_BONUS = 0.5;

async function runOffchainEmuerReconcile() {
  if (!db) {
    console.warn("⚠️ Firestore未初期化。オフチェーン台帳照合をスキップ。");
    return;
  }
  console.log("🚀 オフチェーンEMUER台帳照合開始:", new Date().toISOString());
  try {
    // 以前ここに `const FieldValue = admin.firestore.FieldValue;` があったが、
    // このスコープに admin は存在せず ReferenceError でバッチ全体が毎回失敗していた。
    // このバッチは FieldValue を使わないので削除する（懸賞バッチ側は firebaseAdmin を使用）。
    // CHESアカウント（LINE/Google/ウォレット）を対象に処理。件数が増えたらページングを追加。
    const accountsSnap = await db.collection("ches_accounts").limit(500).get();
    // 投稿はアカウントごとに問い合わせず、一度だけ取得してメモリ上で集計する。
    // 旧実装は最大500本の個別クエリを毎時発行し、空結果にも読み取り料金が発生していた。
    const postsSnap = await db.collection("posts")
      .select("address", "goodCount", "changeCount")
      .get();
    const reactionsByAddress = new Map();
    postsSnap.forEach((postDoc) => {
      const post = postDoc.data();
      const postAddress = String(post.address || "").toLowerCase();
      if (!postAddress) return;
      const totals = reactionsByAddress.get(postAddress) || { good: 0, change: 0 };
      totals.good += Number(post.goodCount) || 0;
      totals.change += Number(post.changeCount) || 0;
      reactionsByAddress.set(postAddress, totals);
    });
    let processed = 0;

    for (const accDoc of accountsSnap.docs) {
      const acc = accDoc.data();
      const addr = String(acc.walletAddress || "").toLowerCase();
      if (!addr) continue;

      // ── ① 評価された分（投稿者が得る）: 自分の投稿が受けたGood/Changeを集計 ──
      const reactionTotals = reactionsByAddress.get(addr) || { good: 0, change: 0 };
      const sumGood = reactionTotals.good;
      const sumChange = reactionTotals.change;
      const reactionBalance = Math.floor(sumGood / 10) + Math.floor(sumChange / 20) * 3;

      // ── ② ログインボーナスは受取ボタン（/api/emuer/login-bonus）でのみ付与する ──
      // ここで自動付与すると、ユーザーが押す前に「受取済み」になってしまう。

      // ── 台帳を更新（bountyBalanceは懸賞バッチがイベント式に積む。ここでは触らず読むだけ）──
      const balRef = db.collection("emuer_offchain").doc(addr);
      const existing = await balRef.get();
      const ex = existing.exists ? existing.data() : {};
      const bountyBalance = Number(ex.bountyBalance) || 0;   // 懸賞で受け取った累計
      const spentBounty = Number(ex.spentBounty) || 0;       // 募集者として支払った累計
      const loginBalance = Number(ex.loginBalance) || 0;     // 受取APIが積む（ここでは加算しない）
      // 利用可能残高 = 受取(懸賞+評価+ログボ) - 支払い(懸賞)
      const balance = bountyBalance + reactionBalance + loginBalance - spentBounty;

      const nextUid = acc.uid || accDoc.id;
      const balanceChanged = !existing.exists
        || Number(ex.reactionBalance) !== reactionBalance
        || Number(ex.loginBalance) !== loginBalance
        || Number(ex.balance) !== balance
        || String(ex.uid || "") !== String(nextUid);
      if (balanceChanged) {
        await balRef.set({
          address: addr,
          uid: nextUid,
          reactionBalance,
          loginBalance,
          balance,
          settledOnchain: Number(ex.settledOnchain) || 0,
          updatedAt: new Date()
        }, { merge: true });
      }

      processed++;
    }
    console.log(`✅ オフチェーンEMUER台帳照合完了: ${processed} アカウント`);
  } catch (error) {
    console.error("❌ オフチェーンEMUER台帳照合エラー:", error);
  }
}
// ログインボーナスはAPIで即時処理される。反応残高は6時間ごとに一括照合する。
cron.schedule("15 */6 * * *", () => { console.log("⏰ オフチェーンEMUER台帳照合起動"); runOffchainEmuerReconcile(); }, { timezone: "Asia/Tokyo" });

// =====================
// ログインボーナス（アカウント単位・1日1回・サーバー権威）
// localStorage判定だと端末ごとに受け取れてしまうため、ches_accounts.lastLoginBonusDate で
// アカウント単位の受取済みを管理し、emuer_offchain 台帳（サーバー専用書き込み）に加算する。
// 付与額・計算式は runOffchainEmuerReconcile と同一（定期照合とも整合／二重付与しない）。
// =====================
// ches_accounts の特定。ドキュメントID = uid が最も確実。
// walletAddress は ethers.getAddress() のチェックサム(大文字小文字混在)で保存されているため、
// アドレス検索は「渡された形」と「チェックサム化した形」の両方を試す。
async function _findChesAccount(uid, addr) {
  if (uid) {
    const d = await db.collection("ches_accounts").doc(String(uid)).get();
    if (d.exists) return d;
  }
  if (addr) {
    let snap = await db.collection("ches_accounts").where("walletAddress", "==", addr).limit(1).get();
    if (!snap.empty) return snap.docs[0];
    try {
      const checksummed = ethers.utils.getAddress(addr);
      if (checksummed !== addr) {
        snap = await db.collection("ches_accounts").where("walletAddress", "==", checksummed).limit(1).get();
        if (!snap.empty) return snap.docs[0];
      }
    } catch (e) { /* 無効なアドレス形式 */ }
  }
  return null;
}

// ── 受取状況の確認 ──
app.get("/api/emuer/login-bonus/status", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.json({ claimedToday: false });
    const uid = req.identity.uid;
    const address = String(req.query.address || "").trim();
    if (!uid && !address) return res.json({ claimedToday: false });
    const todayJst = _jstDateStr(new Date());
    const accDoc = await _findChesAccount(uid, address);
    const claimedToday = !!(accDoc && accDoc.data().lastLoginBonusDate === todayJst);
    return res.json({ claimedToday, found: !!accDoc, date: todayJst });
  } catch (err) {
    console.error("login-bonus/status error:", err.message);
    return res.json({ claimedToday: false });
  }
});

// ── 受取（1日1回・アカウント単位） ──
app.post("/api/emuer/login-bonus", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const address = String(req.body.address || "").toLowerCase().trim();
    const reqUid = req.identity.uid;
    if (!address && !reqUid) return res.status(400).json({ error: "ウォレットが必要です" });

    const todayJst = _jstDateStr(new Date());
    const accDoc = await _findChesAccount(reqUid, address);
    if (!accDoc) return res.status(404).json({ error: "アカウントが見つかりません" });
    const accRef = accDoc.ref;
    const uid = accDoc.data().uid || accDoc.id;
    // オフチェーン台帳のドキュメントIDは小文字アドレス（毎時バッチと統一）。
    // アドレス未指定時はアカウントの walletAddress から復元。
    const ledgerAddr = address || String(accDoc.data().walletAddress || "").toLowerCase();
    if (!ledgerAddr) return res.status(400).json({ error: "ウォレットが必要です" });

    // 評価された分（毎時バッチと同一計算）をトランザクション外で先に集計
    let sumGood = 0, sumChange = 0;
    const postsSnap = await db.collection("posts").where("address", "==", ledgerAddr).get();
    postsSnap.forEach((p) => {
      const d = p.data();
      sumGood += Number(d.goodCount) || 0;
      sumChange += Number(d.changeCount) || 0;
    });
    const reactionBalance = Math.floor(sumGood / 10) + Math.floor(sumChange / 20) * 3;

    const balRef = db.collection("emuer_offchain").doc(ledgerAddr);

    // アカウント単位の受取済みチェックと加算を原子的に実施（複数端末の同時押下でも二重付与しない）
    const result = await db.runTransaction(async (tx) => {
      const acc = await tx.get(accRef);
      const already = acc.exists && acc.data().lastLoginBonusDate === todayJst;
      const balDoc = await tx.get(balRef);
      const ex = balDoc.exists ? balDoc.data() : {};
      const bountyBalance = Number(ex.bountyBalance) || 0;
      const spentBounty = Number(ex.spentBounty) || 0;
      if (already) {
        return { alreadyClaimed: true, balance: Number(ex.balance) || 0 };
      }
      const loginBalance = (Number(ex.loginBalance) || 0) + EMU_LOGIN_BONUS;
      const balance = bountyBalance + reactionBalance + loginBalance - spentBounty;
      tx.set(accRef, { lastLoginBonusDate: todayJst }, { merge: true });
      tx.set(balRef, {
        address: ledgerAddr, uid, reactionBalance, loginBalance, balance, updatedAt: new Date(),
      }, { merge: true });
      return { alreadyClaimed: false, balance };
    });

    if (!result.alreadyClaimed) {
      await db.collection("emuer_offchain_ledger").add({
        address: ledgerAddr, uid, amount: EMU_LOGIN_BONUS,
        reason: "login_bonus", date: todayJst, createdAt: new Date(),
      });
    }

    return res.json({
      ok: true,
      claimed: !result.alreadyClaimed,
      alreadyClaimed: result.alreadyClaimed,
      amount: EMU_LOGIN_BONUS,
      balance: result.balance,
      date: todayJst,
    });
  } catch (err) {
    console.error("login-bonus error:", err);
    res.status(500).json({ error: err.message });
  }
});

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
      .limit(100)
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

// =====================
// 立てられた議論の日次リセット
// 議論はその日限り。翌日には消して、毎日まっさらな状態から始める。
// 「みんなの結論」(discussion_conclusions) は残す ── 知識として読まれるものなので消さない。
// =====================
const DISCUSSION_ROOMS_COL = "discussion_rooms";

/* 日本時間の今日0時を Date で返す。
   既存の _jstDateStr はゼロ埋めしない（2026-8-9 のような形）ため
   文字列比較では 8-9 > 8-10 になってしまう。日付の境目は Date で扱う。 */
function _jstMidnight(base) {
  const now = base || new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const ms = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0);
  return new Date(ms - 9 * 60 * 60 * 1000); // JST 0時 = UTC 前日15時
}

async function purgeOldDiscussionRooms() {
  if (!db) return { deleted: 0 };
  const cutoff = _jstMidnight();
  let deleted = 0;
  try {
    // 一度に消しすぎないよう、500件ずつ回す（batch の上限）
    for (let pass = 0; pass < 20; pass++) {
      const snap = await db.collection(DISCUSSION_ROOMS_COL)
        .where("lastActiveAt", "<", cutoff)
        .limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 500) break;
    }
    if (deleted) console.log(`🗑 前日までの議論を削除: ${deleted}件`);
    return { deleted };
  } catch (err) {
    console.error("議論の日次リセットに失敗:", err.message);
    return { deleted, error: err.message };
  }
}

// 毎日 0:05（日本時間）にリセット
cron.schedule("5 0 * * *", () => {
  console.log("⏰ 議論の日次リセット");
  purgeOldDiscussionRooms();
}, { timezone: "Asia/Tokyo" });

// 再起動直後にも一度流す（停止中に日付をまたいでいた場合の取りこぼしを防ぐ）
setTimeout(() => purgeOldDiscussionRooms(), 30_000);

// 予約投稿 作成
app.post("/api/scheduled-posts", requireFirebaseUser, requireOwnAddress, async (req, res) => {
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
app.get("/api/scheduled-posts", requireFirebaseUser, requireOwnAddress, async (req, res) => {
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
app.delete("/api/scheduled-posts/:id", requireFirebaseUser, requireOwnAddress, async (req, res) => {
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
app.post("/api/contact", publicFormRateLimit, async (req, res) => {
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
app.post("/api/room1/direct-add", requireAdmin, async (req, res) => {
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
    res.json({ success: true, item: { id: docRef.id, ...newItem } });

  } catch (err) {
    console.error("direct-add error:", err);
    res.status(500).json({ error: "追加に失敗しました: " + err.message });
  }
});

// ── お預かり箱：送信 ──
app.post("/api/room1/submit", publicFormRateLimit, async (req, res) => {
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
app.get("/api/room1/submissions", requireAdmin, async (req, res) => {
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
app.post("/api/room1/approve/:id", requireAdmin, async (req, res) => {
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
    res.json({ success: true });

  } catch (err) {
    console.error("approve error:", err);
    res.status(500).json({ error: "approve failed: " + err.message });
  }
});

// ── お預かり箱：見送り ──
app.post("/api/room1/reject/:id", requireAdmin, async (req, res) => {
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
app.delete("/api/room1/contents/all", requireAdmin, async (req, res) => {
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
app.post('/api/user/setname', requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    const address     = (req.body.address     || '').toLowerCase().trim();
    const displayName = (req.body.displayName || '').trim().slice(0, 30);

    if (!address || !displayName) {
      return res.status(400).json({ error: 'address と displayName が必要です' });
    }
    if (!db) return res.status(500).json({ error: 'Firestore未接続' });

    /* プロフィール画像。Firebase Storage は使えない（Blazeプランが必要）ため、
       ブラウザ側で小さく縮めた画像をそのまま文字列として持つ。
       Firestore の1ドキュメントは1MBまでなので、余裕をみて200KBで打ち切る。 */
    const patch = { address, displayName, updatedAt: new Date().toISOString() };
    if (typeof req.body.avatar === 'string') {
      const avatar = req.body.avatar;
      if (avatar === '') {
        patch.avatar = null;                       // 削除
      } else if (!/^data:image\/(png|jpeg|webp);base64,/.test(avatar)) {
        return res.status(400).json({ error: 'AVATAR_FORMAT' });
      } else if (avatar.length > 200000) {
        return res.status(413).json({ error: 'AVATAR_TOO_LARGE' });
      } else {
        patch.avatar = avatar;
      }
    }

    await db.collection('user_profiles').doc(address).set(patch, { merge: true });

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
    if (!doc.exists) return res.json({ displayName: null, avatar: null });
    const d = doc.data();
    res.json({ displayName: d.displayName || null, avatar: d.avatar || null });
  } catch (err) {
    res.status(500).json({ displayName: null });
  }
});

// ── ランキング用サーバーキャッシュ（1時間TTL） ──
const _rankingCache = {
  postsSnap: null,
  names:     null,
  fetchedAt: 0,
};
const RANKING_CACHE_TTL = 60 * 60 * 1000; // 1時間

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

    // キャッシュから posts + names を取得（1時間TTLで Firestore読み取りを抑制）
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

  // ★ 議題の再リクエスト
  socket.on("request topic", () => {
    socket.emit("today topic", getTodayTopic());
  });

  socket.on("room3 message", async (data) => {
    /* 議論への発言は light 以上（9/1から）。
       ここは Socket.io なので uid を持っておらず、アドレスから引き直す。
       ここを開けたままだと、掲示した「議論への発言はできなくなる」が守れない。 */
    try {
      const ent = await entitlement.getEntitlementByAddress(socket.wallet);
      if (entitlement.enforcing() && !entitlement.atLeast(ent.plan, "light")) {
        socket.emit("room3 denied", {
          error: "PLAN_REQUIRED", required: "light", current: ent.plan,
          message: "議論への発言は Emu light（月額500円）以上でご利用いただけます。"
        });
        return;
      }
    } catch (e) {
      console.error("議論の資格判定に失敗:", e.message);
      return;   // 判定できないときは通さない（開けっぱなしにしない）
    }

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
// CHES Identity: LINE ログイン（認可コード → Firebase custom token）
// 必要な環境変数:
//   LINE_CHANNEL_ID     … LINE Login チャネルの Channel ID
//   LINE_CHANNEL_SECRET … 同 Channel Secret（サーバー限定・絶対に公開しない）
// =====================
app.post("/api/auth/line", async (req, res) => {
  const { code, redirectUri } = req.body || {};
  const CHANNEL_ID = process.env.LINE_CHANNEL_ID;
  const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: "code / redirectUri が必要です" });
  }
  if (!CHANNEL_ID || !CHANNEL_SECRET) {
    console.warn("⚠️ LINE_CHANNEL_ID / LINE_CHANNEL_SECRET 未設定");
    return res.status(500).json({ error: "LINE ログインはサーバー未設定です" });
  }

  try {
    // 1. 認可コード → アクセストークン / IDトークン
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CHANNEL_ID,
        client_secret: CHANNEL_SECRET
      }).toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.warn("LINE token error:", tokenData);
      return res.status(401).json({ error: "LINE 認証に失敗しました", detail: tokenData.error_description || tokenData.error });
    }

    // 2. IDトークンを検証してユーザー情報を取得（sub / name / picture / email）
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: tokenData.id_token,
        client_id: CHANNEL_ID
      }).toString()
    });
    const profile = await verifyRes.json();
    if (!verifyRes.ok || !profile.sub) {
      console.warn("LINE verify error:", profile);
      return res.status(401).json({ error: "LINE IDトークン検証に失敗しました" });
    }

    // 3. Firebase custom token を発行（uid = line:<LINEユーザーID>）
    const admin = require("firebase-admin");
    const uid = "line:" + profile.sub;
    const firebaseToken = await admin.auth().createCustomToken(uid, {
      provider: "line",
      name: profile.name || "",
      picture: profile.picture || ""
    });

    return res.json({
      firebaseToken,
      profile: {
        name: profile.name || "",
        picture: profile.picture || "",
        email: profile.email || ""
      }
    });
  } catch (e) {
    console.error("❌ /api/auth/line 失敗:", e);
    return res.status(500).json({ error: "サーバーエラー" });
  }
});

// ════════════════════════════════════════
// ウォレット（MetaMask等）ログイン → Firebase セッション発行
//   LINE / Google と同じく「Firebaseユーザー + ches_accounts」を用意する。
//   これが無いと requireFirebaseUser を通るAPI（ログインボーナス等）と
//   Firestoreルール（投稿・Good等）がウォレットログインでは一切使えない。
//   所有証明は personal_sign（EIP-191）の署名で行う。
//   ① GET  /api/auth/wallet/nonce?address=0x… → 署名対象メッセージを発行
//   ② POST /api/auth/wallet {address, nonce, signature} → custom token を返す
// ════════════════════════════════════════
const WALLET_NONCE_TTL_MS = 5 * 60 * 1000;
const walletNonces = new Map(); // nonce → { address, message, expiresAt }

// CHESアドレス（アドレスのみ・決定論的生成／秘密鍵なし）。
// LINE / Google はこれがそのまま walletAddress になる。ウォレットログインでも
// 同じ規則で発行して紐づけ、どのログイン方法でもCHESアドレスを持つようにする。
// フロント側 CHES.deriveWalletAddress と同一の計算式（変更する場合は両方を直すこと）。
function _deriveChesAddress(uid) {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ches-wallet:v1:" + uid));
  return ethers.utils.getAddress("0x" + hash.slice(-40));
}

function _purgeWalletNonces() {
  const now = Date.now();
  for (const [key, value] of walletNonces) if (value.expiresAt <= now) walletNonces.delete(key);
}

app.get("/api/auth/wallet/nonce", (req, res) => {
  let address;
  try {
    address = ethers.utils.getAddress(String(req.query.address || "").trim());
  } catch (e) {
    return res.status(400).json({ error: "INVALID_ADDRESS" });
  }
  _purgeWalletNonces();
  if (walletNonces.size > 5000) return res.status(503).json({ error: "BUSY" });

  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const message = [
    "SchoolPark / Emu にログインします。",
    "このメッセージへの署名でウォレットの所有を確認します（手数料はかかりません）。",
    "",
    "address: " + address,
    "nonce: " + nonce,
    "issuedAt: " + issuedAt
  ].join("\n");

  walletNonces.set(nonce, { address, message, expiresAt: Date.now() + WALLET_NONCE_TTL_MS });
  return res.json({ nonce, message, issuedAt, expiresInMs: WALLET_NONCE_TTL_MS });
});

app.post("/api/auth/wallet", async (req, res) => {
  try {
    const { address, nonce, signature } = req.body || {};
    if (!address || !nonce || !signature) return res.status(400).json({ error: "MISSING_PARAMS" });

    _purgeWalletNonces();
    const issued = walletNonces.get(String(nonce));
    // nonce は 1回限り。検証の成否にかかわらず即座に破棄して再利用（リプレイ）を防ぐ。
    walletNonces.delete(String(nonce));
    if (!issued) return res.status(401).json({ error: "NONCE_EXPIRED" });

    let checksummed;
    try {
      checksummed = ethers.utils.getAddress(String(address).trim());
    } catch (e) {
      return res.status(400).json({ error: "INVALID_ADDRESS" });
    }
    if (checksummed !== issued.address) return res.status(401).json({ error: "ADDRESS_MISMATCH" });

    let recovered;
    try {
      recovered = ethers.utils.verifyMessage(issued.message, String(signature));
    } catch (e) {
      return res.status(401).json({ error: "INVALID_SIGNATURE" });
    }
    if (recovered !== checksummed) return res.status(401).json({ error: "INVALID_SIGNATURE" });

    if (!firebaseAdmin || !db) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });

    // ches_accounts を用意（uid = wallet:<小文字アドレス>）。
    // walletAddress は署名で所有を確認済みの実アドレス（CHESの導出アドレスではない）。
    const uid = "wallet:" + checksummed.toLowerCase();
    const chesAddress = _deriveChesAddress(uid);
    const ref = db.collection("ches_accounts").doc(uid);
    const snap = await ref.get();
    const now = Date.now();
    if (!snap.exists) {
      await ref.set({
        uid,
        provider: "wallet",
        providerUid: checksummed,
        displayName: "",
        email: "",
        photoURL: "",
        walletAddress: checksummed,
        chesAddress,
        membership: { tier: "free", offchain: true, issuedAt: now },
        createdAt: now,
        lastLogin: now
      });
      await db.collection("ches_wallets").doc(checksummed).set({
        address: checksummed, uid, type: "self-custody", provider: "wallet", createdAt: now
      }, { merge: true });
    } else {
      // 既存アカウントに chesAddress が無ければ補完する（この仕組みより前に作られた分）
      const patch = { lastLogin: now };
      if (!snap.data().chesAddress) patch.chesAddress = chesAddress;
      await ref.set(patch, { merge: true });
    }
    // CHESアドレスの逆引き（アドレス→アカウント）。ウォレットログインでも紐づけておく。
    await db.collection("ches_wallets").doc(chesAddress).set({
      address: chesAddress, uid, type: "address-only", provider: "wallet", createdAt: now
    }, { merge: true });
    // requireFirebaseUser のキャッシュに古い内容が残らないようにする
    identityAccountCache.delete(uid);

    const firebaseToken = await firebaseAdmin.auth().createCustomToken(uid, {
      provider: "wallet",
      address: checksummed
    });
    return res.json({ firebaseToken, uid, address: checksummed, chesAddress });
  } catch (e) {
    console.error("❌ /api/auth/wallet 失敗:", e);
    return res.status(500).json({ error: "サーバーエラー" });
  }
});

// ════════════════════════════════════════
// 一日シェア (Ichinichi Share) API ── Firestore永続化版
// 「わたしの一日が、誰かの学びになる。」
// コレクション:
//   ichinichi_days   … doc id = `${address}__${date}`（ユーザー×日付でユニーク）
//                      items[] を埋め込み保存、learning / visibility 等
//   ichinichi_goods  … doc id = `${dayId}_${address}`（Good重複防止）
//   ichinichi_reports… doc id = `${dayId}_${address}`（通報重複防止）
//   ichinichi_adopts … 自動id。誰かに予定を取り入れられた回数（役に立った人）集計用
// ════════════════════════════════════════

const ICHI_DAYS_COL    = "ichinichi_days";
const ICHI_GOODS_COL   = "ichinichi_goods";
const ICHI_REPORTS_COL = "ichinichi_reports";
const ICHI_ADOPTS_COL  = "ichinichi_adopts";

const ICHI_CATEGORIES = ["生活", "学び", "仕事", "健康", "暮らし", "子育て"];
const ichiToday = () => new Date().toISOString().slice(0, 10);
const ichiNow = () => new Date().toISOString();
const ichiDayId = (address, date) => `${address}__${date}`;
// 「過去ロック」判定。サーバーはUTC・クライアントはローカルTZで日付を作るため、
// 1日の猶予を持たせてタイムゾーン差(最大±14h)による誤ブロックを防ぐ。
const ichiIsPastLocked = (date) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return date < d.toISOString().slice(0, 10);
};

// address を統一的に取得（Emu流: body/query の address を小文字化）
function ichiIdentity(req) {
  const address = String(req.body?.address || req.query?.address || "").toLowerCase().trim();
  const userName = String(req.body?.userName || req.query?.userName || "").trim().slice(0, 30) || "わたし";
  return { address, userName };
}

// 予定アイテムを正規化（保存用）
function ichiNormalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((it) => it && String(it.title || "").trim())
    .map((it) => ({
      id: String(it.id || randomUUID()),
      time: String(it.time || "").slice(0, 5),
      title: String(it.title || "").trim().slice(0, 100),
      note: String(it.note || "").trim().slice(0, 200),
      category: ICHI_CATEGORIES.includes(it.category) ? it.category : "生活",
      done: Boolean(it.done),
      sourceItemId: it.sourceItemId ? String(it.sourceItemId) : null,
      sourceUserId: it.sourceUserId ? String(it.sourceUserId) : null,
    }))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

// day ドキュメントを取得（無ければ null）
async function ichiGetDay(address, date) {
  const doc = await db.collection(ICHI_DAYS_COL).doc(ichiDayId(address, date)).get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    id: doc.id,
    userId: d.address,
    userName: d.userName || "わたし",
    date: d.date,
    learning: d.learning || "",
    visibility: d.visibility || "private",
    sharedAt: d.sharedAt || null,
    items: Array.isArray(d.items) ? d.items : [],
  };
}

// day ドキュメントを取得（無ければ作成して返す生データ）
async function ichiEnsureDay(address, userName, date) {
  const ref = db.collection(ICHI_DAYS_COL).doc(ichiDayId(address, date));
  const snap = await ref.get();
  if (snap.exists) {
    // 名前が変わっていたら更新
    if (userName && snap.data().userName !== userName) {
      await ref.set({ userName }, { merge: true });
    }
    return ref;
  }
  const ts = ichiNow();
  await ref.set({
    address, userName: userName || "わたし", date,
    items: [], learning: "", visibility: "private", sharedAt: null,
    createdAt: ts, updatedAt: ts,
  });
  return ref;
}

// ── 単日の取得 ──
app.get("/api/ichinichi/day", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.json({ day: null });
    const { address } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const date = String(req.query.date || ichiToday());
    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/day error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── みんなの一日（公開フィード） ──
app.get("/api/ichinichi/feed", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.json({ posts: [] });
    const { address } = ichiIdentity(req);
    const category = String(req.query.category || "すべて");

    // visibility の等値フィルタ＋新しい順の並べ替えは複合indexが必要になるため、
    // 公開日を多めに取得してJS側で共有日時ソート（ランキングと同じ方針）。
    // ※ limit なしのDocument-id順(=address__date)で切ると特定アドレスに偏るため多めに読む
    const snap = await db.collection(ICHI_DAYS_COL)
      .orderBy("sharedAt", "desc")
      .limit(300).get();

    let days = snap.docs.filter((doc) => doc.data().visibility === "public").map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.address,
        userName: d.userName || "わたし",
        date: d.date,
        learning: d.learning || "",
        visibility: "public",
        sharedAt: d.sharedAt || null,
        items: Array.isArray(d.items) ? d.items : [],
      };
    });
    // 学びと予定がある公開日のみ
    days = days.filter((day) => day.learning.trim() && day.items.length);
    // 新しい共有順
    days.sort((a, b) => (b.sharedAt || b.date || "").localeCompare(a.sharedAt || a.date || ""));
    days = days.slice(0, 40);

    const ids = days.map((day) => day.id);
    // Good 集計
    const goodCountMap = {};
    const mineSet = new Set();
    if (ids.length) {
      // chunk (Firestore in は最大30件)
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const gsnap = await db.collection(ICHI_GOODS_COL).where("dayId", "in", chunk).get();
        gsnap.docs.forEach((g) => {
          const gd = g.data();
          goodCountMap[gd.dayId] = (goodCountMap[gd.dayId] || 0) + 1;
          if (address && gd.address === address) mineSet.add(gd.dayId);
        });
      }
    }

    const posts = days
      .map((day) => ({
        ...day,
        goodCount: goodCountMap[day.id] || 0,
        gooded: mineSet.has(day.id),
      }))
      .filter((post) => category === "すべて" || post.items.some((it) => it.category === category));

    return res.json({ posts });
  } catch (err) {
    console.error("ichinichi/feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── わたしの記録（履歴＋統計） ──
app.get("/api/ichinichi/history", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.json({ history: [], stats: { streak: 0, learningCount: 0, usefulCount: 0, completionRate: 0 } });
    const { address } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });

    /* \u30c9\u30ad\u30e5\u30e1\u30f3\u30c8ID\u306e\u524d\u65b9\u4e00\u81f4\u3067\u5f15\u3044\u3066\u3044\u305f\u304c\u3001__name__ \u306b\u5bfe\u3059\u308b startAt/endAt \u306f
       \u5024\u304c\u6b63\u3057\u3044\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8ID\u3067\u3042\u308b\u5fc5\u8981\u304c\u3042\u308a\u3001\u756a\u5175\u306b\u4f7f\u3063\u3066\u3044\u305f \uf8ff \u304c
       \u5f3e\u304b\u308c\u3066 INVALID_ARGUMENT \u306b\u306a\u3063\u3066\u3044\u305f\uff08500\u306e\u539f\u56e0\uff09\u3002
       \u5404\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306f address \u30d5\u30a3\u30fc\u30eb\u30c9\u3092\u6301\u3063\u3066\u3044\u308b\u306e\u3067\u3001\u305d\u3061\u3089\u3067\u5f15\u304f\u3002
       \u4e26\u3079\u66ff\u3048\u306f\u76f4\u5f8c\u306b\u65e5\u4ed8\u3067\u884c\u3063\u3066\u3044\u308b\u305f\u3081\u3001\u8907\u5408\u30a4\u30f3\u30c7\u30c3\u30af\u30b9\u3082\u8981\u3089\u306a\u3044\u3002 */
    const snap = await db.collection(ICHI_DAYS_COL)
      .where("address", "==", address)
      .limit(90).get();
    let history = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id, userId: d.address, userName: d.userName || "わたし", date: d.date,
        learning: d.learning || "", visibility: d.visibility || "private",
        sharedAt: d.sharedAt || null, items: Array.isArray(d.items) ? d.items : [],
      };
    });
    history.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    /* 見られる期間の制限（9/1から）。Emu light は過去30日分まで。
       消してはいない。プランを上げると再び見えるようにするため、
       記録そのものは残したまま、返す範囲だけを絞る（保持期間は1年）。 */
    const ent = await entitlement.getEntitlement(req.identity.uid, req.identity.account);
    let hiddenOlder = 0;
    if (entitlement.enforcing() && !entitlement.atLeast(ent.plan, "plus")) {
      const limitDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const before = history.length;
      history = history.filter((d) => (d.date || "") >= limitDate);
      hiddenOlder = before - history.length;
    }

    // 連続日数: 公開かつ学び・予定がある日を新しい順に連続カウント
    const sharedDates = history
      .filter((day) => day.visibility === "public" && day.learning.trim() && day.items.length)
      .map((day) => day.date).sort().reverse();
    let streak = 0;
    if (sharedDates.length) {
      const cursor = new Date(`${sharedDates[0]}T00:00:00Z`);
      for (const value of sharedDates) {
        if (value !== cursor.toISOString().slice(0, 10)) break;
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }

    const allItems = history.flatMap((day) => day.items);
    const doneCount = allItems.filter((it) => it.done).length;

    // 役に立った人: 自分の予定を取り入れられた件数
    let usefulCount = 0;
    try {
      const adoptSnap = await db.collection(ICHI_ADOPTS_COL).where("sourceUserId", "==", address).get();
      usefulCount = adoptSnap.size;
    } catch (_) { usefulCount = 0; }

    return res.json({
      history,
      /* 見えていない古い記録があることを伝える。黙って消えたように見せない。
         プランを上げれば再び見える。 */
      hiddenOlder,
      hiddenNote: hiddenOlder > 0
        ? "30日より前の記録が " + hiddenOlder + " 日ぶんあります。Emu plus 以上で、また見られるようになります。"
        : null,
      stats: {
        streak,
        learningCount: history.filter((day) => day.learning.trim()).length,
        usefulCount,
        completionRate: allItems.length ? Math.round((doneCount / allItems.length) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("ichinichi/history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 時間割の保存 ──
app.post("/api/ichinichi/save", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address, userName } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const date = String(req.body.date || ichiToday());
    if (ichiIsPastLocked(date)) return res.status(400).json({ error: "過去の時間割は編集できません" });

    /* 一日シェアの記録できる日数はプランごとに上限がある（9/1から）。
       すでにその日を作ってある場合は数えない。同じ日を何度直しても
       1日ぶんとして数えるため。 */
    const existingDay = await ichiGetDay(address, date);
    if (!existingDay) {
      const room = await entitlement.consume(req.identity.uid, "ichinichi", { account: req.identity.account });
      if (!room.ok) {
        return res.status(403).json({
          error: "PLAN_LIMIT", kind: "ichinichi",
          plan: room.plan, limit: room.limit, used: room.used, resetsAt: room.resetsAt || null
        });
      }
    }

    const ref = await ichiEnsureDay(address, userName, date);
    const items = ichiNormalizeItems(req.body.items);
    await ref.set({ items, updatedAt: ichiNow() }, { merge: true });
    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/save error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 共有（公開/非公開の確定＋学び保存） ──
app.post("/api/ichinichi/share", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address, userName } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const date = String(req.body.date || ichiToday());
    const learning = String(req.body.learning || "").trim().slice(0, 500);
    const visibility = req.body.visibility === "public" ? "public" : "private";
    if (visibility === "public" && !learning) {
      return res.status(400).json({ error: "今日の学びを書いてください" });
    }
    const ref = await ichiEnsureDay(address, userName, date);
    await ref.set({
      learning, visibility,
      sharedAt: visibility === "public" ? ichiNow() : null,
      updatedAt: ichiNow(),
    }, { merge: true });
    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/share error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 過去の学びに追記 ──
app.post("/api/ichinichi/append-learning", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address, userName } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const date = String(req.body.date || ichiToday());
    const addition = String(req.body.learning || "").trim().slice(0, 500);
    if (!addition) return res.status(400).json({ error: "追記内容を入力してください" });

    const ref = await ichiEnsureDay(address, userName, date);
    const current = (await ref.get()).data().learning || "";
    const next = (current ? `${current}\n\n追記：${addition}` : addition).slice(0, 1500);
    await ref.set({ learning: next, updatedAt: ichiNow() }, { merge: true });
    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/append-learning error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 前日の時間割をコピー ──
// 前日の時間割コピーは plus 以上（9/1から）
app.post("/api/ichinichi/copy-previous", requireFirebaseUser, requirePlan("plus"), requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address, userName } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const date = String(req.body.date || ichiToday());
    if (ichiIsPastLocked(date)) return res.status(400).json({ error: "過去の時間割は編集できません" });

    const prev = new Date(`${date}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const previous = await ichiGetDay(address, prev.toISOString().slice(0, 10));
    if (!previous || !previous.items.length) {
      return res.status(400).json({ error: "前日の時間割がありません" });
    }
    const ref = await ichiEnsureDay(address, userName, date);
    const items = previous.items.map((it) => ({
      id: randomUUID(), time: it.time, title: it.title, note: it.note, category: it.category,
      done: false, sourceItemId: it.id, sourceUserId: address,
    }));
    await ref.set({ items, updatedAt: ichiNow() }, { merge: true });
    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/copy-previous error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── みんなの予定を自分の今日に取り入れる ──
// 他人の公開予定を取り入れるのは plus 以上（9/1から）
app.post("/api/ichinichi/adopt", requireFirebaseUser, requirePlan("plus"), requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address, userName } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const sourceDayId = String(req.body.dayId || "");
    const itemId = String(req.body.itemId || "");
    const date = String(req.body.date || ichiToday());

    const srcDoc = await db.collection(ICHI_DAYS_COL).doc(sourceDayId).get();
    if (!srcDoc.exists) return res.status(404).json({ error: "予定が見つかりません" });
    const srcData = srcDoc.data();
    if (srcData.visibility !== "public") return res.status(403).json({ error: "公開されていない予定です" });
    const srcItem = (srcData.items || []).find((it) => it.id === itemId);
    if (!srcItem) return res.status(404).json({ error: "予定が見つかりません" });
    if (srcData.address === address) return res.status(400).json({ error: "自分の予定は取り入れられません" });

    const ref = await ichiEnsureDay(address, userName, date);
    const current = (await ref.get()).data().items || [];
    const newItem = {
      id: randomUUID(), time: srcItem.time, title: srcItem.title, note: srcItem.note,
      category: srcItem.category, done: false, sourceItemId: srcItem.id, sourceUserId: srcData.address,
    };
    const items = [...current, newItem].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    await ref.set({ items, updatedAt: ichiNow() }, { merge: true });

    // 「役に立った人」集計用（同一元アイテム×取り入れ者で重複防止）
    await db.collection(ICHI_ADOPTS_COL).doc(`${srcItem.id}__${address}`).set({
      sourceUserId: srcData.address, byUserId: address,
      sourceItemId: srcItem.id, sourceDayId, createdAt: ichiNow(),
    }, { merge: true });

    return res.json({ day: await ichiGetDay(address, date) });
  } catch (err) {
    console.error("ichinichi/adopt error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Good を送る ──
app.post("/api/ichinichi/good", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const dayId = String(req.body.dayId || "");
    if (!dayId) return res.status(400).json({ error: "対象が不正です" });
    await db.collection(ICHI_GOODS_COL).doc(`${dayId}__${address}`).set({
      dayId, address, createdAt: ichiNow(),
    }, { merge: true });
    return res.json({ ok: true });
  } catch (err) {
    console.error("ichinichi/good error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 通報 ──
app.post("/api/ichinichi/report", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const dayId = String(req.body.dayId || "");
    const reason = String(req.body.reason || "不適切な内容").trim().slice(0, 300);
    if (!dayId) return res.status(400).json({ error: "対象が不正です" });
    await db.collection(ICHI_REPORTS_COL).doc(`${dayId}__${address}`).set({
      dayId, reporterId: address, reason, createdAt: ichiNow(),
    }, { merge: true });
    return res.json({ ok: true });
  } catch (err) {
    console.error("ichinichi/report error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 記録の削除（本人のみ） ──
app.post("/api/ichinichi/delete-day", requireFirebaseUser, requireOwnAddress, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firestore未接続" });
    const { address } = ichiIdentity(req);
    if (!address) return res.status(400).json({ error: "ウォレットが必要です" });
    const dayId = String(req.body.dayId || "");
    const doc = await db.collection(ICHI_DAYS_COL).doc(dayId).get();
    if (!doc.exists || doc.data().address !== address) {
      return res.status(404).json({ error: "削除できる記録が見つかりません" });
    }
    await db.collection(ICHI_DAYS_COL).doc(dayId).delete();
    return res.json({ ok: true });
  } catch (err) {
    console.error("ichinichi/delete-day error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================
// Start server
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔥 Emu Server running on port ${PORT}`);
});
