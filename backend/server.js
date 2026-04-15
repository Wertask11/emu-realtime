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

airdropRouter.post("/batch/run", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  res.json({ message: "バッチを開始します" });
  runAirdropBatch();
});

app.use("/airdrop", airdropRouter);

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

secretDoorRouter.post("/batch/run", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
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

// 毎分チェック
cron.schedule("* * * * *", () => publishScheduledPosts(), { timezone: "Asia/Tokyo" });

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

// ── コンテンツ一覧取得 ──
app.get("/api/room1/contents", async (req, res) => {
  try {
    if (!db) return res.json([]);
    const snapshot = await db
      .collection(ROOM1_CONTENTS_COL)
      .orderBy("createdAt", "asc")
      .get();
    const contents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(contents);
  } catch (err) {
    console.error("contents get error:", err);
    // orderByでインデックスエラーが出た場合はorderByなしで再試行
    try {
      const snapshot2 = await db.collection(ROOM1_CONTENTS_COL).get();
      const contents2 = snapshot2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(contents2);
    } catch (err2) {
      res.status(500).json([]);
    }
  }
});

// ── 直接追加（管理者のみ）──
app.post("/api/room1/direct-add", async (req, res) => {
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
    console.log(`✅ Direct add: ${newItem.title} (${docRef.id})`);
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
app.get("/api/room1/submissions", async (req, res) => {
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
app.post("/api/room1/approve/:id", async (req, res) => {
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

    console.log(`✅ Approved & added to contents: ${newItem.title}`);
    res.json({ success: true });

  } catch (err) {
    console.error("approve error:", err);
    res.status(500).json({ error: "approve failed: " + err.message });
  }
});

// ── お預かり箱：見送り ──
app.post("/api/room1/reject/:id", async (req, res) => {
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
app.delete("/api/room1/contents/all", async (req, res) => {
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

    // ユーザー名テーブルを並列取得
    const namesPromise = fetchAllDisplayNames();

    // ── posts コレクションを全件取得（インデックス不要・JS側でソート） ──
    // where + orderBy の複合クエリを使わずに全件取得してJS集計する
    // → Firestoreインデックスエラーを完全回避
    const postsSnap = await db.collection('posts').get();
    const names = await namesPromise;

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

io.on("connection", (socket) => {
  console.log("接続:", socket.id);
  socket.emit("today topic", getTodayTopic());
  socket.emit("room3 history", Array.from(messages.values()));

  socket.on("join room3", ({ wallet }) => { socket.wallet = wallet; });
  
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
// Start server
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔥 Emu Server running on port ${PORT}`);
});