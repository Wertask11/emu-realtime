/* ==========================
   Canvas & State Setup
========================== */
const canvas = document.getElementById("constellationCanvas");
const ctx = canvas.getContext("2d");
const userNameDisplay = document.getElementById("userNameDisplay");
const USER_NAME_KEY = "emu_room2_username";

let stars = [];
let links = [];
let pendingBirth = null;
let postCount = 0;
const POSTS_PER_STAR = 10;
const discussionStreaks = {};

// ページ読み込み時に初期化
window.addEventListener("load", () => {
  loadState();
  loadUserName();
  resize();
  render(); // アニメーションループ開始
});

window.addEventListener("resize", resize);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

/* ==========================
   User Name Management
========================== */
function loadUserName() {
  const savedName = localStorage.getItem(USER_NAME_KEY);
  userNameDisplay.textContent = savedName ? `🌟 ${savedName}` : "🌟 Tap to set name";
}

function askUserName() {
  const name = prompt("あなたの名前を入力してください");
  if (name && name.trim()) {
    localStorage.setItem(USER_NAME_KEY, name.trim());
    loadUserName();
  }
}
userNameDisplay.addEventListener("click", askUserName);

/* ==========================
   Data Persistence (Storage)
========================== */
function saveState() {
  localStorage.setItem("room2_stars", JSON.stringify(stars));
  localStorage.setItem("room2_links", JSON.stringify(links));
}

function loadState() {
  const s = localStorage.getItem("room2_stars");
  const l = localStorage.getItem("room2_links");
  if (s) {
    try {
      stars = JSON.parse(s);
      const now = performance.now();
      stars.forEach(star => {
        star.birthAt = now - 2000; 
        star.createdAt = now - Math.random() * 5000;

        // ★ここで速度をさらにゆっくり上書き（-0.05〜-0.15くらい）
        star.vx = -0.05 - Math.random() * 0.1;
        star.vy = (Math.random() - 0.5) * 0.02;
      });
    } catch (e) { stars = []; }
  }
  if (l) {
    try { links = JSON.parse(l); } catch(e) { links = []; }
  }
  updateStarList();
}

// 部屋を出る（バツボタンなどの）直前に保存されるようにする
window.addEventListener("beforeunload", saveState);

/* ==========================
   Star & Link Logic
========================= */
function createStar({ type, power, baseColor, baseRadius, projectId = null, x, y }) {
  return {
    id: crypto.randomUUID(),
    type,
    x: x ?? Math.random() * canvas.width,
    y: y ?? Math.random() * canvas.height,
    // ★ 本物の星座のように、ゆっくり左（マイナス方向）へ動く速度を設定
    vx: -0.05 - Math.random() * 0.1, 
    vy: (Math.random() - 0.5) * 0.02, // 上下にはほとんど動かさない
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


function createLink(from, to, type) {
  links.push({ from, to, type });
  saveState();
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
   Actions
========================== */
function postAction(pos) {
  const star = createStar({ type: "post", power: 10, baseColor: "#ffffff", baseRadius: 3, ...pos });
  stars.push(star);
  autoTimelineLink(star);
  saveState();
}

function nftBuyAction(pos) {
  const star = createStar({ type: "nft", power: 50, baseColor: "#4da3ff", baseRadius: 6, ...pos });
  stars.push(star);
  autoTimelineLink(star);
  saveState();
}

function spawnDiscussionStar(projectId, streak, pos) {
  const sizeMap = { 3: 4, 5: 5, 7: 7 };
  const powerMap = { 3: 20, 5: 35, 7: 60 };
  const star = createStar({
    type: "discussion",
    power: powerMap[streak] || 20,
    baseColor: "#ffd166",
    baseRadius: sizeMap[streak] || 4,
    projectId,
    ...pos
  });
  stars.push(star);
  autoProjectLink(star);
  saveState();
}

/* ==========================
   Action Handlers
========================== */
window.handleAction = function (action) {
  switch (action.type) {
    case "post": handlePostAccumulation("post"); break;
    case "nft_buy": spawnNFTStar(); break;
    case "discussion": handleDiscussionStreak(action.projectId || "default"); break;
    case "good": if (action.targetId) applyGoodToTarget(action.targetId); break;
    case "change": if (action.targetId) applyChangeToTarget(action.targetId); break;
  }
};

function handlePostAccumulation(type) {
  postCount++;
  if (postCount === 7 && !pendingBirth) {
    pendingBirth = { type, color: "#ffffff", x: Math.random() * canvas.width, y: Math.random() * canvas.height, startedAt: performance.now() };
  }
  if (postCount >= POSTS_PER_STAR) {
    postCount = 0;
    spawnStarFromPending();
  }
}

function spawnStarFromPending() {
  if (!pendingBirth) return;
  const pos = { x: pendingBirth.x, y: pendingBirth.y };
  if (pendingBirth.type === "post") postAction(pos);
  pendingBirth = null;
}

function spawnNFTStar() {
  const x = Math.random() * canvas.width;
  const y = Math.random() * canvas.height;
  pendingBirth = { x, y, color: "#4da3ff", startedAt: performance.now() };
  setTimeout(() => { nftBuyAction({ x, y }); pendingBirth = null; }, 800);
}

function handleDiscussionStreak(projectId) {
  const today = new Date().toISOString().slice(0, 10);
  if (!discussionStreaks[projectId]) {
    discussionStreaks[projectId] = { lastDate: today, streak: 1 };
  } else {
    const d = discussionStreaks[projectId];
    if (d.lastDate === today) return;
    d.streak = (new Date(today) - new Date(d.lastDate) === 86400000) ? d.streak + 1 : 1;
    d.lastDate = today;
  }
  const streak = discussionStreaks[projectId].streak;
  if ([2, 4, 6].includes(streak)) {
    pendingBirth = { x: Math.random() * canvas.width, y: Math.random() * canvas.height, color: "#ffd166", startedAt: performance.now() };
  }
  if ([3, 5, 7].includes(streak)) {
    spawnDiscussionStar(projectId, streak);
    pendingBirth = null;
  }
}

function applyGoodToTarget(id) {
  const star = stars.find(s => s.id === id);
  if (star) { star.brightness += 0.2; star.power += 5; saveState(); }
}

function applyChangeToTarget(id) {
  const star = stars.find(s => s.id === id);
  if (star) { star.changeCount++; star.color = "#ff6b6b"; saveState(); }
}

/* ==========================
   Drawing Logic
========================== */
function drawLinks() {
  links.forEach(link => {
    const a = stars.find(s => s.id === link.from);
    const b = stars.find(s => s.id === link.to);
    if (!a || !b) return;
    ctx.beginPath();
    if (link.type === "timeline") ctx.setLineDash([4, 6]);
    else ctx.setLineDash([]);
    ctx.lineWidth = link.type === "collab" ? 3 : 1;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function render(time = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 予兆の描画 (省略)
  if (pendingBirth) { /* ...既存の予兆処理... */ }

  drawLinks();

  stars.forEach(star => {
    // ★ 1. 移動させる
    star.x += (star.vx || -0.2);
    star.y += (star.vy || 0);

    // ★ 2. 画面外（左端）に出たら右端から戻す (ワープ)
    if (star.x < -20) {
      star.x = canvas.width + 20;
    } else if (star.x > canvas.width + 20) {
      star.x = -20;
    }
    
    // 上下も念のため（大きく外れたら戻す）
    if (star.y < -20) star.y = canvas.height + 20;
    if (star.y > canvas.height + 20) star.y = -20;

    // --- 以下、既存の描画処理 ---
    const age = time - star.birthAt;
    const progress = Math.min(age / star.birthDuration, 1);
    const pulse = Math.sin((time - star.createdAt) * 0.0005) * 0.5;
    star.radius = (star.baseRadius * progress) + pulse;

    ctx.save();
    ctx.globalAlpha = Math.min(star.brightness + (1 - progress), 2);
    const auraSize = Math.max(0.1, star.radius * (2 + star.brightness * 0.5));
    const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, auraSize);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.2, star.color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(star.x, star.y, auraSize, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  // ★ 3. 動いている位置を常に保存する（これがないと戻った時にズレる）
  // 頻繁すぎると重いので、ここではなく別のタイミングにするのが理想ですが
  // とりあえず「星が消える」問題を直すためにシンプルにします。

  requestAnimationFrame(render);
  // render関数の中の最後の方に追加
if (Math.random() < 0.01) {
  updateStarList();
}

}

/* ==========================
   UI Event Listeners (復活)
========================== */
window.addEventListener("DOMContentLoaded", () => {
  const detailBtn = document.getElementById("detailBtn");
  const detailOverlay = document.getElementById("detailOverlay");
  const closeDetail = document.getElementById("closeDetail");

  if (detailBtn) {
    detailBtn.onclick = () => {
      detailOverlay.style.display = "flex";
    };
  }

  if (closeDetail) {
    closeDetail.onclick = () => {
      detailOverlay.style.display = "none";
    };
  }

  // モーダルの外側をクリックしたら閉じる
  detailOverlay?.addEventListener("click", e => {
    if (e.target === detailOverlay) {
      detailOverlay.style.display = "none";
    }
  });
});

/* ==========================
   星の一覧表示機能 (左下 UI)
========================== */
/* ==========================
   星の一覧表示（自動更新）
========================== */
const starInfoUI = document.getElementById("starInfo");

function updateStarList() {
  if (!starInfoUI) return;

  if (stars.length === 0) {
    starInfoUI.innerHTML = "🌌 まだ星がありません<br><small>アクションを起こして星を呼ぼう</small>";
    return;
  }

  // 星の種類ごとにカウント
  const counts = stars.reduce((acc, star) => {
    acc[star.type] = (acc[star.type] || 0) + 1;
    return acc;
  }, {});

  // 表示用HTMLの構築
  let html = `<div style="text-align:left; font-family: sans-serif;">`;
  html += `<strong style="color:#fff; border-bottom:1px solid #555; display:block; margin-bottom:5px; padding-bottom:2px;">🌌 あなたの星座記録</strong>`;
  
  // 各項目の表示（アイコン付き）
  if (counts.post)       html += `<div>📝 投稿星: <span style="float:right;">${counts.post}</span></div>`;
  if (counts.nft)        html += `<div>💎 購入星: <span style="float:right;">${counts.nft}</span></div>`;
  if (counts.discussion) html += `<div>💬 議論星: <span style="float:right;">${counts.discussion}</span></div>`;
  
  html += `<hr style="border:0.1px solid rgba(255,255,255,0.1); margin:8px 0;">`;
  html += `<div style="font-weight:bold; color:#ffd166;">合計輝数: <span style="float:right;">${stars.length}</span></div>`;
  html += `</div>`;

  starInfoUI.innerHTML = html;
}

window.addEventListener("message", (event) => {
  // 🛡️ 自分が送ったアクション（typeがあるもの）以外は無視
  if (!event.data || !event.data.type) return;

  const action = event.data;

  // ログは必要な時だけ出すようにするとスッキリします
  if (action.type === "NEW_POST") {
    console.log("🌟 Room2 received NEW_POST!");
    if (typeof createStar === "function") {
      createStar("post"); 
    }
  }
});

