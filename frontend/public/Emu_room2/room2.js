/* ==========================
   Canvas Setup
========================== */
const canvas = document.getElementById("constellationCanvas");
const ctx = canvas.getContext("2d");
const userNameDisplay = document.getElementById("userNameDisplay");

// ローカル保存キー
const USER_NAME_KEY = "emu_room2_username";

const birthHint = document.getElementById("birthHint");

// 初期表示
function loadUserName() {
  const savedName = localStorage.getItem(USER_NAME_KEY);

  if (savedName) {
    userNameDisplay.textContent = `🌟 ${savedName}`;
  } else {
    askUserName();
  }
}

// 名前入力
function askUserName() {
  const name = prompt("あなたの名前を入力してください");

  if (name && name.trim()) {
    localStorage.setItem(USER_NAME_KEY, name.trim());
    userNameDisplay.textContent = `🌟 ${name.trim()}`;
  } else {
    userNameDisplay.textContent = "🌟 No Name";
  }
}

// クリックで変更できるようにする（便利）
userNameDisplay.addEventListener("click", () => {
  askUserName();
});

// 起動時
loadUserName();

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

/* ==========================
   State
========================== */
let stars = [];
let links = [];
let pendingBirth = null;
const discussionStreaks = {};

/* ==========================
   Post Accumulator
========================== */
let postCount = 0;
const POSTS_PER_STAR = 10;


/* ==========================
   Star Factory（唯一）
========================== */
function createStar({
  type,
  power,
  baseColor,
  baseRadius,
  projectId = null,
  x,
  y
}) {
  return {
    id: crypto.randomUUID(),
    type,

    x: x ?? Math.random() * canvas.width,
    y: y ?? Math.random() * canvas.height,

    vx: (Math.random() - 0.5) * 0.02,
    vy: (Math.random() - 0.5) * 0.02,

    baseColor,
    color: baseColor,

    power,
    baseRadius,
    radius: 0,

    brightness: 1,
    changeCount: 0,

    projectId,

    createdAt: performance.now(),

    birthAt: performance.now(),
    birthDuration: 800
  };
}

/* ==========================
   Action → Star
========================== */
function postAction(position = null) {
  const star = createStar({
    type: "post",
    power: 10,
    baseColor: "#ffffff",
    baseRadius: 3
  });

  // 🌱 予兆の位置を使う
  if (position?.x != null && position?.y != null) {
    star.x = position.x;
    star.y = position.y;
  }

  stars.push(star);
  autoTimelineLink(star);
}

function nftBuyAction() {
  const star = createStar({
    type: "nft",
    power: 50,
    baseColor: "#4da3ff",
    baseRadius: 6
  });
  stars.push(star);
  autoTimelineLink(star);
}

function discussionAction(projectId) {
  const star = createStar({
    type: "discussion",
    power: 20,
    baseColor: "#ffd166",
    baseRadius: 4,
    projectId
  });
  stars.push(star);
  autoProjectLink(star);
}

/* ==========================
   Good / Change
========================== */
function applyGood(star) {
  star.brightness += 0.2;
  star.power += 5;
}

function applyChange(star) {
  star.changeCount += 1;
  star.color = "#ff6b6b";
}

/* ==========================
   Links
========================== */
function createLink(from, to, type) {
  links.push({ from, to, type });
}

function autoTimelineLink(newStar) {
  if (stars.length < 2) return;
  const prev = stars[stars.length - 2];
  createLink(prev.id, newStar.id, "timeline");
}

function autoProjectLink(newStar) {
  stars.forEach(s => {
    if (s.projectId && s.projectId === newStar.projectId && s.id !== newStar.id) {
      createLink(s.id, newStar.id, "project");
    }
  });
}

/* ==========================
   Draw Links
========================== */
function drawLinks() {
  links.forEach(link => {
    const a = stars.find(s => s.id === link.from);
    const b = stars.find(s => s.id === link.to);
    if (!a || !b) return;

    ctx.beginPath();

    if (link.type === "timeline") {
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
    }

    if (link.type === "project") {
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    if (link.type === "collab") {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
    }

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.setLineDash([]);
}

/* ==========================
   Draw Stars
========================== */
function drawStars(time) {
  stars.forEach(star => {

    // 移動
    star.x += star.vx;
    star.y += star.vy;

    /* =====================
       A. birth state ここ
    ===================== */
  const age = time - star.birthAt;
  const birthDuration = star.birthDuration || 1;

const birthProgress =
  Math.min(Math.max(age / birthDuration, 0), 1);
    // 生まれたては小さい → 通常サイズへ
    const birthRadius =
      star.baseRadius * birthProgress;

    // 生まれた瞬間のフラッシュ
    const birthFlash =
      (1 - birthProgress) * 2;

    /* =====================
       B. 既存の pulse
    ===================== */
    const pulse =
      Math.sin((time - star.createdAt) * 0.002) * 0.6;

    // ★ radius をここで最終決定
    star.radius = birthRadius + pulse;

    ctx.save();

    // birthフラッシュを α に加算
    ctx.globalAlpha =
      Math.min(star.brightness + birthFlash, 2);

    /* =====================
       C. オーラ描画（既存）
    ===================== */
    const auraSize =
      star.radius * (2 + star.brightness * 0.5);

      if (!Number.isFinite(auraSize) || auraSize <= 0) {
      return;
    }

    const gradient = ctx.createRadialGradient(
      star.x, star.y, 0,
      star.x, star.y, auraSize
    );

    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.3, star.color);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.beginPath();
    ctx.arc(star.x, star.y, auraSize, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.restore();
  });
}

/* ==========================
   Render Loop
========================== */
function render(time) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 🌱 予兆（白モヤ）
  if (pendingBirth) {
    const t = (time - pendingBirth.startedAt) * 0.003;
    const r = 6 + Math.sin(t) * 3;

    ctx.save();
    ctx.globalAlpha = 0.9;

    const g = ctx.createRadialGradient(
      pendingBirth.x, pendingBirth.y, 0,
      pendingBirth.x, pendingBirth.y, 25
    );

const color = pendingBirth.color || "#ffffff";

g.addColorStop(0, color);
g.addColorStop(0.6, color.replace(")", ",0.6)").replace("rgb", "rgba"));

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pendingBirth.x, pendingBirth.y, r + 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawLinks();
  drawStars(time);

  requestAnimationFrame(render);
}

/* ==========================
   Interaction
========================== */
canvas.addEventListener("click", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  stars.forEach(star => {
    const d = Math.hypot(mx - star.x, my - star.y);
    if (d < star.radius + 6) {
      applyGood(star); // 仮：クリック＝Good
      document.getElementById("starInfo").innerHTML = `
        ⭐ ${star.type}<br>
        🔥 power: ${star.power}<br>
        👍 good: ${star.brightness.toFixed(1)}<br>
        🔄 change: ${star.changeCount}
      `;
    }
  });
});

/* ==========================
   Demo Init
========================== */
//postAction();一旦コメントアウト
//postAction();
//nftBuyAction();
//discussionAction("project-1");
//discussionAction("project-1");

render();

window.addEventListener("DOMContentLoaded", () => {
  const detailBtn = document.getElementById("detailBtn");
  const detailOverlay = document.getElementById("detailOverlay");
  const closeDetail = document.getElementById("closeDetail");

  if (!detailBtn) {
    console.error("detailBtn が見つからない");
    return;
  }

  detailBtn.onclick = () => {
    detailOverlay.style.display = "flex";
  };

  closeDetail.onclick = () => {
    detailOverlay.style.display = "none";
  };

  detailOverlay.addEventListener("click", e => {
    if (e.target === detailOverlay) {
      detailOverlay.style.display = "none";
    }
  });
});



function applyGoodToTarget(targetId) {
  const star = stars.find(s => s.id === targetId);
  if (!star) return;
  applyGood(star);
}

function applyChangeToTarget(targetId) {
  const star = stars.find(s => s.id === targetId);
  if (!star) return;
  applyChange(star);
}

window.handleAction = function (action) {
  console.log("🌠 Room2 received action:", action);

  switch (action.type) {
    case "post":
      handlePostAccumulation();
      break;

    case "nft_buy":
    spawnNFTStar();
    break;

  case "discussion":
  handleDiscussionStreak(action.projectId);
  break;

    case "good":
      if (action.targetId) {
        applyGoodToTarget(action.targetId);
      }
      break;

    case "change":
      if (action.targetId) {
        applyChangeToTarget(action.targetId);
      }
      break;

    default:
      console.warn("Unknown action type:", action.type);
  }
};

function handlePostAccumulation(type) {
  postCount += 1;

  console.log(`📝 [${type}] count: ${postCount}/${POSTS_PER_STAR}`);

  // 🌱 予兆（7回目）
  if (postCount === 7 && !pendingBirth) {
    pendingBirth = createPendingBirth(type);
    console.log("🌱 pendingBirth created:", pendingBirth);
  }

  // ⭐ 星誕生（10回目）
  if (postCount >= POSTS_PER_STAR) {
    postCount = 0;

    spawnStarFromPending();
  }
}

function createPendingBirth(type) {
  const map = {
    post: { color: "#ffffff" },
    nft: { color: "#4da3ff" },
    discussion: { color: "#ffd166" }
  };

  const config = map[type];

  return {
    type,
    color: config.color,
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    startedAt: performance.now()
  };
}

function spawnStarFromPending() {
  if (!pendingBirth) return;

  console.log("⭐ Star born from pending:", pendingBirth);

  const pos = {
    x: pendingBirth.x,
    y: pendingBirth.y
  };

  switch (pendingBirth.type) {
    case "post":
      postAction(pos);
      break;

    case "nft":
      nftBuyAction(pos);
      break;

case "discussion":
  handleDiscussionStreak(action.projectId);
  break;
  }

  pendingBirth = null;
}

function postAction(pos) {
  const star = createStar({
    type: "post",
    power: 10,
    baseColor: "#ffffff",
    baseRadius: 3
  });

  if (pos) {
    star.x = pos.x;
    star.y = pos.y;
  }

  stars.push(star);
  autoTimelineLink(star);
}

function nftBuyAction(pos) {
  const star = createStar({
    type: "nft",
    power: 50,
    baseColor: "#4da3ff",
    baseRadius: 6
  });

  if (pos) {
    star.x = pos.x;
    star.y = pos.y;
  }

  stars.push(star);
  autoTimelineLink(star);
}

function discussionAction(projectId, pos) {
  const star = createStar({
    type: "discussion",
    power: 20,
    baseColor: "#ffd166",
    baseRadius: 4,
    projectId
  });

  if (pos) {
    star.x = pos.x;
    star.y = pos.y;
  }

  stars.push(star);
  autoProjectLink(star);
}

window.handleAction = function (action) {
  console.log("🌠 Room2 received action:", action);

  switch (action.type) {
    case "post":
      handlePostAccumulation("post");
      break;

      case "nft_buy":
  spawnNFTStar();
  break;

   case "discussion":
  handleDiscussionStreak(action.projectId);
  break;
  }
};

function spawnNFTStar() {
  const x = Math.random() * canvas.width;
  const y = Math.random() * canvas.height;

  // 🌱 青い予兆
  pendingBirth = {
    x,
    y,
    color: "#4da3ff",
    startedAt: performance.now()
  };

  setTimeout(() => {
    const star = createStar({
      type: "nft",
      power: 50,
      baseColor: "#4da3ff",
      baseRadius: 6
    });

    star.x = x;
    star.y = y;

    stars.push(star);
    autoTimelineLink(star);

    pendingBirth = null;
  }, 400);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isNextDay(prev, today) {
  return (new Date(today) - new Date(prev)) === 86400000;
}

function handleDiscussionStreak(projectId) {
  const today = todayStr();

  if (!discussionStreaks[projectId]) {
    discussionStreaks[projectId] = {
      lastDate: today,
      streak: 1
    };
  } else {
    const d = discussionStreaks[projectId];

    if (d.lastDate === today) return;

    if (isNextDay(d.lastDate, today)) {
      d.streak += 1;
    } else {
      d.streak = 1;
    }

    d.lastDate = today;
  }

  const streak = discussionStreaks[projectId].streak;
  console.log(`🟡 discussion ${projectId}: ${streak} days`);

  // 🌱 予兆
  if ([2, 4, 6].includes(streak)) {
    pendingBirth = {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      color: "#ffd166",
      startedAt: performance.now()
    };
  }

  // ⭐ 星誕生
  if ([3, 5, 7].includes(streak)) {
    spawnDiscussionStar(projectId, streak);
    pendingBirth = null;
  }
}

function spawnDiscussionStar(projectId, streak) {
  const sizeMap = { 3: 4, 5: 5, 7: 7 };
  const powerMap = { 3: 20, 5: 35, 7: 60 };

  const star = createStar({
    type: "discussion",
    power: powerMap[streak],
    baseColor: "#ffd166",
    baseRadius: sizeMap[streak],
    projectId
  });

  stars.push(star);
  autoProjectLink(star);
}

