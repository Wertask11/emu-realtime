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
app.use(express.json());
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
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    console.log("✅ Firestore 初期化完了");
  } catch (e) {
    console.warn("⚠️ Firestore 初期化失敗:", e.message);
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
    const amounts = addresses.map(() => ethers.utils.parseUnits("100", 18));

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

cron.schedule("0 2 * * *", () => { console.log("⏰ 定期エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });
cron.schedule("0 3 15 4 *", () => { console.log("🏁 最終エアドロバッチ起動"); runAirdropBatch(); }, { timezone: "Asia/Tokyo" });

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
    const { theme, subTheme, subSubTheme, summary, body, note } = req.body;

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
    const { summary, body, note } = req.body;

    const newItem = {
      title:       `${item.theme}/${item.subTheme}`,
      theme:       item.theme,
      subTheme:    item.subTheme,
      subSubTheme: "",
      summary:     summary || "",
      body:        body    || item.content,
      note:        note    || "",
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

// ════════════════════════════════════════
// ランキング API
// server.js の Room1 API セクションの後に追加
// ════════════════════════════════════════

// ── ランキング取得 ──
// GET /api/ranking?type=good|change|total&limit=10
app.get('/api/ranking', async (req, res) => {
  try {
    if (!db) return res.json([]);

    var type  = req.query.type  || 'good';   // good / change / total
    var limit = parseInt(req.query.limit) || 10;
    if (limit > 50) limit = 50; // 最大50件

    var postsRef = db.collection('posts');
    var snapshot;

    if (type === 'change') {
      // changeCount降順
      snapshot = await postsRef
        .where('changeCount', '>', 0)
        .orderBy('changeCount', 'desc')
        .limit(limit)
        .get();
    } else if (type === 'total') {
      // goodCount降順で取得してJS側で総合スコア計算
      // (good×1 + change×2) ← changeの重みを少し高く
      snapshot = await postsRef
        .orderBy('goodCount', 'desc')
        .limit(limit * 3) // 多めに取ってJS側でソート
        .get();
    } else {
      // good（デフォルト）
      snapshot = await postsRef
        .where('goodCount', '>', 0)
        .orderBy('goodCount', 'desc')
        .limit(limit)
        .get();
    }

    var items = snapshot.docs.map(function(doc) {
      var d = doc.data();
      return {
        id:          doc.id,
        title:       d.title       || '無題',
        body:        (d.body || '').slice(0, 80), // プレビュー用
        goodCount:   d.goodCount   || 0,
        changeCount: d.changeCount || 0,
        totalScore:  (d.goodCount || 0) + (d.changeCount || 0) * 2,
        userType:    d.userType    || 'guest',
        address:     d.address     || '',
        createdAt:   d.createdAt   || ''
      };
    });

    // totalの場合はJS側でソート
    if (type === 'total') {
      items.sort(function(a, b) { return b.totalScore - a.totalScore; });
      items = items.slice(0, limit);
    }

    res.json(items);

  } catch (err) {
    console.error('ranking error:', err);
    // インデックスエラーの場合はインデックスなしで再試行
    try {
      var snapshot2 = await db.collection('posts').get();
      var all = snapshot2.docs.map(function(doc) {
        var d = doc.data();
        return {
          id: doc.id, title: d.title || '無題',
          body: (d.body || '').slice(0, 80),
          goodCount: d.goodCount || 0, changeCount: d.changeCount || 0,
          totalScore: (d.goodCount || 0) + (d.changeCount || 0) * 2,
          userType: d.userType || 'guest', address: d.address || '',
          createdAt: d.createdAt || ''
        };
      });

      var type2 = req.query.type || 'good';
      if (type2 === 'change') {
        all.sort(function(a, b) { return b.changeCount - a.changeCount; });
      } else if (type2 === 'total') {
        all.sort(function(a, b) { return b.totalScore - a.totalScore; });
      } else {
        all.sort(function(a, b) { return b.goodCount - a.goodCount; });
      }

      res.json(all.slice(0, parseInt(req.query.limit) || 10));
    } catch (err2) {
      res.status(500).json([]);
    }
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