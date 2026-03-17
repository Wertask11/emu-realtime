// =====================
// Module import
// =====================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const ethers = require("ethers");  // ★追加
const cron = require("node-cron"); // ★追加 (npm install node-cron)

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
app.use(express.json());
app.use(
  express.static(
    path.join(__dirname, "..", "frontend", "public")
  )
);

// =====================
// ★ Dプラン: ethers / コントラクト設定
// =====================
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;
const EMUER_CONTRACT_ADDRESS = process.env.EMUER_CONTRACT_ADDRESS || "0x4418d5250Dae4b1125ADFCD5C0779B1412E4a964";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const CAMPAIGN_ID = "EmuRelease2026";
const CAMPAIGN_DEADLINE = new Date("2026-04-14T23:59:59+09:00");

// addGoodBatch のみ使用（コントラクト改修なし）
const EMUER_ABI_MINIMAL = [
  "function addGoodBatch(address[] calldata _users, uint256[] calldata _amounts) external",
  "function balanceOf(address account) view returns (uint256)"
];

// 運営ウォレット・コントラクト（OPERATOR_PRIVATE_KEY がある場合のみ初期化）
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
  console.warn("⚠️ OPERATOR_PRIVATE_KEY が未設定。エアドロバッチは無効。");
}

// ★ Firestore (firebase-admin) — Firebase初期化はこのファイルの下部のModule importで行う想定
// render.com では GOOGLE_APPLICATION_CREDENTIALS か initializeApp で設定してください
let db = null;
const initFirestore = () => {
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    console.log("✅ Firestore 初期化完了");
  } catch (e) {
    console.warn("⚠️ Firestore 初期化失敗（firebase-adminがない場合は省略可）:", e.message);
  }
};
initFirestore();

// =====================
// ★ Dプラン: EIP-712 署名検証
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
// ★ Dプラン: エアドロ一括送金バッチ
// =====================
async function runAirdropBatch() {
  if (!db || !emuerContract) {
    console.warn("⚠️ Firestore または emuerContract が未初期化。バッチをスキップ。");
    return;
  }

  console.log("🚀 エアドロバッチ開始:", new Date().toISOString());

  try {
    // pending を最大50件取得
    const snapshot = await db
      .collection("airdrop_registrations")
      .where("status", "==", "pending")
      .limit(50)
      .get();

    if (snapshot.empty) {
      console.log("ℹ️ 送金対象なし");
      return;
    }

    const targets = snapshot.docs.map(doc => doc.data());
    const addresses = targets.map(t => t.address);
    // 100 EMUER × 件数（good ポイントとして付与）
    const amounts = addresses.map(() => ethers.utils.parseUnits("100", 18));

    console.log(`📦 送金対象: ${addresses.length} 件`);

    // ステータスを processing に（二重実行防止）
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.update(doc.ref, { status: "processing" }));
    await batch.commit();

    // addGoodBatch で一括送金（1tx）
    const gasOptions = {
      maxPriorityFeePerGas: ethers.utils.parseUnits("50", "gwei"),
      maxFeePerGas: ethers.utils.parseUnits("200", "gwei"),
      gasLimit: 500000
    };

    console.log("⛽ トランザクション送信中...");
    const tx = await emuerContract.addGoodBatch(addresses, amounts, gasOptions);
    console.log("📝 TX Hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ TX確定:", receipt.transactionHash);

    // done に更新
    const doneBatch = db.batch();
    snapshot.docs.forEach(doc => {
      doneBatch.update(doc.ref, {
        status: "done",
        txHash: receipt.transactionHash,
        processedAt: new Date()
      });
    });
    await doneBatch.commit();

    console.log(`🎉 エアドロ完了: ${addresses.length} 件 / TX: ${receipt.transactionHash}`);

  } catch (err) {
    console.error("❌ バッチエラー:", err);
    // processing → pending にロールバック
    try {
      const stuck = await db
        .collection("airdrop_registrations")
        .where("status", "==", "processing")
        .get();
      const rb = db.batch();
      stuck.docs.forEach(doc => rb.update(doc.ref, { status: "pending", errorMessage: err.message }));
      await rb.commit();
      console.log("🔄 ロールバック完了");
    } catch (rbErr) {
      console.error("❌ ロールバック失敗:", rbErr);
    }
  }
}

// =====================
// ★ Dプラン: エアドロ API エンドポイント
// =====================
const airdropRouter = express.Router();

// POST /airdrop/register — フロントからの接続証明受付
airdropRouter.post("/register", async (req, res) => {
  const { address, campaign, timestamp, signature } = req.body;

  if (!address || !campaign || !timestamp || !signature) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  if (campaign !== CAMPAIGN_ID) {
    return res.status(400).json({ error: "INVALID_CAMPAIGN" });
  }

  // タイムスタンプ5分チェック（リプレイ攻撃防止）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return res.status(400).json({ error: "TIMESTAMP_EXPIRED" });
  }

  // キャンペーン期間チェック
  if (new Date() > CAMPAIGN_DEADLINE) {
    return res.status(400).json({ error: "CAMPAIGN_ENDED" });
  }

  // 署名検証
  if (!verifyAirdropSignature({ address, campaign, timestamp, signature })) {
    return res.status(401).json({ error: "INVALID_SIGNATURE" });
  }

  if (!db) {
    // Firestoreなし環境のフォールバック（開発用）
    console.log("⚠️ Firestore未接続 - 登録をスキップ:", address);
    return res.json({ success: true, message: "受付完了（テストモード）" });
  }

  try {
    const docRef = db.collection("airdrop_registrations").doc(address.toLowerCase());
    const existing = await docRef.get();

    if (existing.exists) {
      return res.status(409).json({ error: "ALREADY_REGISTERED" });
    }

    await docRef.set({
      address: address.toLowerCase(),
      campaign,
      timestamp,
      registeredAt: new Date(),
      status: "pending",
      amount: "100"
    });

    console.log("✅ エアドロ登録:", address);
    return res.json({ success: true, message: "100 EMUER 受取予約が完了しました" });

  } catch (e) {
    console.error("Firestore書き込みエラー:", e);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// GET /airdrop/status/:address — 状態確認
airdropRouter.get("/status/:address", async (req, res) => {
  if (!db) return res.json({ registered: false });

  try {
    const doc = await db
      .collection("airdrop_registrations")
      .doc(req.params.address.toLowerCase())
      .get();

    if (!doc.exists) return res.json({ registered: false });

    const data = doc.data();
    return res.json({
      registered: true,
      status: data.status,
      amount: data.amount,
      txHash: data.txHash || null
    });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// POST /airdrop/batch/run — 管理者用手動バッチ実行
airdropRouter.post("/batch/run", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: "UNAUTHORIZED" });
  }
  res.json({ message: "バッチを開始します" });
  runAirdropBatch();
});

// ★ エアドロルーターをアプリに接続
app.use("/airdrop", airdropRouter);

// =====================
// ★ 初投稿ボーナス API
// =====================
const firstPostRouter = express.Router();

// POST /first-post/register — 投稿フォームから呼ぶ
firstPostRouter.post("/register", async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "MISSING_ADDRESS" });
  if (!db) return res.json({ success: true, message: "テストモード" });

  try {
    const docRef = db.collection("first_post_bonus")
      .doc(address.toLowerCase());
    const existing = await docRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: "ALREADY_REGISTERED" });
    }
    await docRef.set({
      address: address.toLowerCase(),
      registeredAt: new Date(),
      status: "pending",
      amount: "30"
    });
    console.log("✅ 初投稿ボーナス登録:", address);
    return res.json({ success: true });
  } catch(e) {
    console.error("初投稿ボーナス登録エラー:", e);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.use("/first-post", firstPostRouter);

// ★ 初投稿ボーナス バッチ（毎日AM2:10 JST）
async function runFirstPostBatch() {
  if (!db || !emuerContract) return;
  console.log("🚀 初投稿ボーナスバッチ開始:", new Date().toISOString());

  try {
    const snapshot = await db.collection("first_post_bonus")
      .where("status", "==", "pending")
      .limit(50).get();

    if (snapshot.empty) { console.log("ℹ️ 初投稿ボーナス対象なし"); return; }

    const addresses = snapshot.docs.map(d => d.data().address);
    const amounts = addresses.map(() =>
      ethers.utils.parseUnits("30", 18)
    );

    const batch = db.batch();
    snapshot.docs.forEach(doc =>
      batch.update(doc.ref, { status: "processing" })
    );
    await batch.commit();

    const tx = await emuerContract.addGoodBatch(addresses, amounts, {
      maxPriorityFeePerGas: ethers.utils.parseUnits("50", "gwei"),
      maxFeePerGas: ethers.utils.parseUnits("200", "gwei"),
      gasLimit: 500000
    });
    const receipt = await tx.wait();

    const doneBatch = db.batch();
    snapshot.docs.forEach(doc =>
      doneBatch.update(doc.ref, {
        status: "done",
        txHash: receipt.transactionHash,
        processedAt: new Date()
      })
    );
    await doneBatch.commit();
    console.log(`🎉 初投稿ボーナス完了: ${addresses.length}件`);
  } catch(err) {
    console.error("❌ 初投稿ボーナスバッチエラー:", err);
  }
}

cron.schedule("10 2 * * *", () => {
  console.log("⏰ 初投稿ボーナスバッチ起動");
  runFirstPostBatch();
}, { timezone: "Asia/Tokyo" });

// =====================
// ★ Dプラン: cron スケジュール（毎日 AM2:00 JST）
// =====================
cron.schedule("0 2 * * *", () => {
  console.log("⏰ 定期エアドロバッチ起動");
  runAirdropBatch();
}, { timezone: "Asia/Tokyo" });

// キャンペーン最終日翌日（4/15 AM3:00）に最終バッチ
cron.schedule("0 3 15 4 *", () => {
  console.log("🏁 最終エアドロバッチ起動");
  runAirdropBatch();
}, { timezone: "Asia/Tokyo" });


// =====================
// Room1 path
// =====================
const room1AdminDir = path.join(
  __dirname, "public", "Emu_room1", "room1_admin.html"
);
const submissionsPath = path.join(room1AdminDir, "data", "submissions.json");
const contentsPath = path.join(room1AdminDir, "data", "contents.json");

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "[]", "utf8");
  }
}
function readJSON(filePath) {
  ensureFile(filePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// =====================
// Room1 API（既存のまま）
// =====================
app.post("/api/room1/reject/:id", (req, res) => {
  try {
    const submissions = readJSON(submissionsPath);
    const index = submissions.findIndex(s => String(s.id) === req.params.id);
    if (index === -1) return res.status(404).json({ error: "not found" });
    submissions.splice(index, 1);
    writeJSON(submissionsPath, submissions);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "reject failed" });
  }
});

app.post("/api/room1/submit", (req, res) => {
  try {
    const submissions = readJSON(submissionsPath);
    submissions.push({
      id: Date.now(),
      theme: req.body.theme,
      subTheme: req.body.subTheme,
      content: req.body.content,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    writeJSON(submissionsPath, submissions);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "submit failed" });
  }
});

app.get("/api/room1/submissions", (req, res) => {
  try {
    res.json(readJSON(submissionsPath));
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.post("/api/room1/approve/:id", (req, res) => {
  try {
    const submissions = readJSON(submissionsPath);
    const contents = readJSON(contentsPath);
    const index = submissions.findIndex(s => String(s.id) === req.params.id);
    if (index === -1) return res.status(404).json({ error: "not found" });
    const item = submissions[index];
    const { summary, body, note } = req.body;
    contents.push({
      title: `${item.theme}/${item.subTheme}`,
      theme: item.theme,
      subTheme: item.subTheme,
      summary: summary || "",
      body: body || item.content,
      note: note || "",
      createdAt: new Date().toISOString()
    });
    submissions.splice(index, 1);
    writeJSON(submissionsPath, submissions);
    writeJSON(contentsPath, contents);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "approve failed" });
  }
});

app.get("/api/room1/contents", (req, res) => {
  try {
    const contents = readJSON(contentsPath);
    res.json(contents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load contents" });
  }
});

// =====================
// Room3（既存のまま）
// =====================
const topics = [
  "なぜ空は青いのか？",
  "AIに感情や権利は認めるべきか？",
  "日本の義務教育は本当に必要か？",
  "仕事と趣味、どちらを優先すべきか？",
  "SNSは社会にとってプラスかマイナスか？",
  "遺伝子編集は許されるべきか？",
  "自動運転車の事故責任は誰が取るべきか？",
  "人は動物園で動物を見るべきか？",
  "給料は能力で決まるべきか？年功序列でよいか？",
  "本を紙で読むのと電子書籍で読むの、どちらがよいか？",
  "学校でプログラミングは必修にすべきか？",
  "旅行は国内と海外どちらが価値があるか？",
  "長時間労働は本当に悪か？",
  "宇宙旅行は一般人も行くべきか？",
  "服装の自由はどこまで許されるべきか？",
  "ゲームは教育に役立つか？",
  "自然エネルギーだけで日本はやっていけるか？",
  "タバコやお酒の規制はもっと厳しくすべきか？",
  "結婚は必ず必要か？",
  "犬と猫、どちらが飼いやすいか？",
  "健康のために運動は義務化すべきか？",
  "ロボットが人間の仕事を奪うのは良いことか？",
  "音楽はジャンルで人を判断できるか？",
  "美術館や博物館は学校に必修にすべきか？",
  "お金よりも時間を優先すべきか？",
  "お祭りや伝統行事は続けるべきか？",
  "記憶力より創造力が大事か？",
  "動物実験は許されるべきか？",
  "日本は移民をもっと受け入れるべきか？",
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

  socket.on("join room3", ({ wallet }) => {
    socket.wallet = wallet;
  });

  socket.on("room3 message", (data) => {
    const messageId = randomUUID();
    const message = {
      id: socket.id,
      wallet: socket.wallet,
      messageId,
      text: data.text,
      replyTo: data.replyTo || null,
      timestamp: Date.now()
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