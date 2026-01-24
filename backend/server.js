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

// =====================
// App / Server
// =====================
const app = express();
const server = http.createServer(app);

// ★ここを書き換え
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
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
// Room1 path（※重要）
// data は room1_admin.html の中
// =====================
const room1AdminDir = path.join(
  __dirname,
  "public",
  "Emu_room1",
  "room1_admin.html"
);

const submissionsPath = path.join(
  room1AdminDir,
  "data",
  "submissions.json"
);

const contentsPath = path.join(
  room1AdminDir,
  "data",
  "contents.json"
);

// =====================
// Utility
// =====================
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
// Room1 API
// =====================

// 見送り（削除）
app.post("/api/room1/reject/:id", (req, res) => {
  try {
    const submissions = readJSON(submissionsPath);

    const index = submissions.findIndex(
      s => String(s.id) === req.params.id
    );

    if (index === -1) {
      return res.status(404).json({ error: "not found" });
    }

    submissions.splice(index, 1);

    writeJSON(submissionsPath, submissions);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "reject failed" });
  }
});

// 投稿（お預かり箱）
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

// 投稿一覧（管理）
app.get("/api/room1/submissions", (req, res) => {
  try {
    res.json(readJSON(submissionsPath));
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// 昇華（承認）
app.post("/api/room1/approve/:id", (req, res) => {
  try {
    const submissions = readJSON(submissionsPath);
    const contents = readJSON(contentsPath);

    const index = submissions.findIndex(
      s => String(s.id) === req.params.id
    );

    if (index === -1) {
      return res.status(404).json({ error: "not found" });
    }

    const item = submissions[index];
    const { summary, body, note } = req.body;

    contents.push({
      title: `${item.theme}/${item.subTheme}`,
      theme: item.theme,
      subTheme: item.subTheme,

      // ★分離して保存
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

// 学習コンテンツ一覧
// Room1 学習コンテンツ取得
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
// Room3（既存）
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