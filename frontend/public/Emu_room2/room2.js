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

// 背景用の静的な小星（本物の夜空）
let bgStars = [];

function initBgStars() {
  bgStars = [];
  const w = canvas.width, h = canvas.height;
  const count = Math.floor(w * h / 1200); // 密度
  for (let i = 0; i < count; i++) {
    bgStars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 0.9 + 0.1,
      alpha: Math.random() * 0.55 + 0.1,
      twinkleOff: Math.random() * Math.PI * 2,
      twinkleSpd: 0.0004 + Math.random() * 0.0012
    });
  }
}

// ページ読み込み時に初期化
window.addEventListener("load", () => {
  resize();         // canvas.width/height を先に確定
  loadState();
  loadUserName();
  initBgStars();
  seedHistoryStars(); // 初回のみ既存履歴を反映（resize後に実行）
  render(); // アニメーションループ開始
});

window.addEventListener("resize", () => { resize(); initBgStars(); });

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
  var name = prompt('あなたの名前を入力してください（ランキングに表示されます）');
  if (name && name.trim()) {
    var trimmed = name.trim().slice(0, 30);
    localStorage.setItem(USER_NAME_KEY, trimmed);
    loadUserName();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'room2_name_set', displayName: trimmed }, '*');
    }
  }
}

userNameDisplay.addEventListener("click", askUserName);

/* ==========================
   Data Persistence (Storage)
========================== */
function saveState() {
  localStorage.setItem("room2_stars", JSON.stringify(stars));
  localStorage.setItem("room2_links", JSON.stringify(links));
  localStorage.setItem("room2_postCount", String(postCount));
}

function loadState() {
  const s = localStorage.getItem("room2_stars");
  const l = localStorage.getItem("room2_links");
  const pc = localStorage.getItem("room2_postCount");

  if (s) {
    try {
      stars = JSON.parse(s);
      const now = performance.now();
      stars.forEach(star => {
        star.birthAt = now - 2000;
        star.createdAt = now - Math.random() * 5000;
        star.vx = -0.04 - Math.random() * 0.08;
        star.vy = (Math.random() - 0.5) * 0.015;
      });
    } catch (e) { stars = []; }
  }
  if (l) {
    try { links = JSON.parse(l); } catch(e) { links = []; }
  }
  if (pc) {
    postCount = parseInt(pc) || 0;
  }
  updateStarList();
}

window.addEventListener("beforeunload", saveState);

/* ==========================
   初期履歴データ注入（初回のみ）
   Firebaseの実績: 投稿44件・NFT交換7回・3日連続1回・学びコンテンツ2回
========================== */
function seedHistoryStars() {
  const KEY = "room2_history_seeded_v1";
  if (localStorage.getItem(KEY)) return; // 既に実行済み

  const now = performance.now();
  const w = canvas.width  || window.innerWidth;
  const h = canvas.height || window.innerHeight;

  // ─ 投稿44件 → floor(44/10)=4 白星、postCount=4 ─
  for (let i = 0; i < 4; i++) {
    const star = createStar({
      type: "post",
      power: 10,
      baseColor: "#ffffff",
      baseRadius: 3,
      x: 80 + Math.random() * (w - 160),
      y: 80 + Math.random() * (h - 160)
    });
    star.birthAt    = now - 3000 - i * 1000;
    star.createdAt  = now - 3000 - i * 1000;
    stars.push(star);
  }
  postCount = 4; // 残り端数

  // ─ NFT交換7回 → 青星7個 ─
  for (let i = 0; i < 7; i++) {
    const star = createStar({
      type: "nft",
      power: 50,
      baseColor: "#4da3ff",
      baseRadius: 7,
      x: 80 + Math.random() * (w - 160),
      y: 80 + Math.random() * (h - 160)
    });
    star.birthAt   = now - 5000 - i * 500;
    star.createdAt = now - 5000 - i * 500;
    stars.push(star);
  }

  // ─ 探索・交流3日連続 → 黄色星1個 ─
  const yellowStar = createStar({
    type: "discussion",
    power: 20,
    baseColor: "#ffd166",
    baseRadius: 5,
    x: 80 + Math.random() * (w - 160),
    y: 80 + Math.random() * (h - 160)
  });
  yellowStar.birthAt   = now - 8000;
  yellowStar.createdAt = now - 8000;
  stars.push(yellowStar);

  // ─ 探索・学びコンテンツ2回反映 → 赤星2個 ─
  for (let i = 0; i < 2; i++) {
    const star = createStar({
      type: "learning",
      power: 30,
      baseColor: "#ff6b6b",
      baseRadius: 5,
      x: 80 + Math.random() * (w - 160),
      y: 80 + Math.random() * (h - 160)
    });
    star.birthAt   = now - 10000 - i * 500;
    star.createdAt = now - 10000 - i * 500;
    stars.push(star);
  }

  // タイムライン線を繋ぐ
  for (let i = 1; i < stars.length; i++) {
    links.push({ from: stars[i - 1].id, to: stars[i].id, type: "timeline" });
  }

  saveState();
  localStorage.setItem(KEY, "1");
  updateStarList();
  console.log("🌟 初期星データを注入しました（14個）");
}

/* ==========================
   Star & Link Logic
========================= */
function createStar({ type, power, baseColor, baseRadius, projectId = null, x, y }) {
  return {
    id: crypto.randomUUID(),
    type,
    x: x ?? Math.random() * canvas.width,
    y: y ?? Math.random() * canvas.height,
    vx: -0.04 - Math.random() * 0.08,
    vy: (Math.random() - 0.5) * 0.015,
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
    birthDuration: 1000
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
  const star = createStar({ type: "nft", power: 50, baseColor: "#4da3ff", baseRadius: 7, ...pos });
  stars.push(star);
  autoTimelineLink(star);
  saveState();
}

function spawnDiscussionStar(projectId, streak, pos) {
  const sizeMap = { 3: 5, 5: 6, 7: 8 };
  const powerMap = { 3: 20, 5: 35, 7: 60 };
  const star = createStar({
    type: "discussion",
    power: powerMap[streak] || 20,
    baseColor: "#ffd166",
    baseRadius: sizeMap[streak] || 5,
    projectId,
    ...(pos || {})
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
  saveState(); // カウントを即時保存
  if (postCount === 7 && !pendingBirth) {
    pendingBirth = {
      type,
      color: "#ffffff",
      x: 80 + Math.random() * (canvas.width - 160),
      y: 80 + Math.random() * (canvas.height - 160),
      startedAt: performance.now()
    };
  }
  if (postCount >= POSTS_PER_STAR) {
    postCount = 0;
    saveState();
    spawnStarFromPending();
  }
}

function spawnStarFromPending() {
  if (!pendingBirth) {
    // pendingBirthが未設定でも位置を決めて生成
    pendingBirth = {
      type: "post",
      color: "#ffffff",
      x: 80 + Math.random() * (canvas.width - 160),
      y: 80 + Math.random() * (canvas.height - 160),
      startedAt: performance.now()
    };
  }
  const pos = { x: pendingBirth.x, y: pendingBirth.y };
  if (pendingBirth.type === "post") postAction(pos);
  pendingBirth = null;
  updateStarList();
}

function spawnNFTStar() {
  const x = 80 + Math.random() * (canvas.width - 160);
  const y = 80 + Math.random() * (canvas.height - 160);
  pendingBirth = { x, y, color: "#4da3ff", startedAt: performance.now() };
  setTimeout(() => {
    nftBuyAction({ x, y });
    pendingBirth = null;
    updateStarList();
  }, 900);
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
    pendingBirth = {
      x: 80 + Math.random() * (canvas.width - 160),
      y: 80 + Math.random() * (canvas.height - 160),
      color: "#ffd166",
      startedAt: performance.now()
    };
  }
  if ([3, 5, 7].includes(streak)) {
    spawnDiscussionStar(projectId, streak);
    pendingBirth = null;
    updateStarList();
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
function drawBgStars(time) {
  bgStars.forEach(s => {
    const flicker = Math.sin(time * s.twinkleSpd + s.twinkleOff) * 0.15;
    const alpha = Math.max(0.05, Math.min(0.9, s.alpha + flicker));
    ctx.save();
    ctx.globalAlpha = alpha;
    // 明るい星はほんのりグロー
    if (s.r > 0.6) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawMilkyWay() {
  // 天の川：ページ中央に薄い帯
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createLinearGradient(w * 0.1, h * 0.2, w * 0.9, h * 0.85);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(0.3, 'rgba(140,170,255,0.025)');
  grad.addColorStop(0.5, 'rgba(180,200,255,0.04)');
  grad.addColorStop(0.7, 'rgba(140,170,255,0.025)');
  grad.addColorStop(1, 'transparent');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawLinks() {
  links.forEach(link => {
    const a = stars.find(s => s.id === link.from);
    const b = stars.find(s => s.id === link.to);
    if (!a || !b) return;
    ctx.beginPath();
    if (link.type === "timeline") ctx.setLineDash([4, 6]);
    else ctx.setLineDash([]);
    ctx.lineWidth = link.type === "collab" ? 2.5 : 0.8;
    ctx.strokeStyle = "rgba(180,200,255,0.12)";
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function drawPendingBirth(time) {
  if (!pendingBirth) return;
  const pulse = Math.sin(time * 0.004) * 0.4 + 0.6;
  const r = 18 + pulse * 8;
  const color = pendingBirth.color || '#ffffff';

  // 外側の波紋
  ctx.save();
  ctx.globalAlpha = 0.12 * pulse;
  const outerG = ctx.createRadialGradient(pendingBirth.x, pendingBirth.y, 0, pendingBirth.x, pendingBirth.y, r * 2.5);
  outerG.addColorStop(0, color);
  outerG.addColorStop(1, 'transparent');
  ctx.fillStyle = outerG;
  ctx.beginPath();
  ctx.arc(pendingBirth.x, pendingBirth.y, r * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 中心の光
  ctx.save();
  ctx.globalAlpha = 0.5 * pulse;
  const innerG = ctx.createRadialGradient(pendingBirth.x, pendingBirth.y, 0, pendingBirth.x, pendingBirth.y, r);
  innerG.addColorStop(0, '#ffffff');
  innerG.addColorStop(0.4, color);
  innerG.addColorStop(1, 'transparent');
  ctx.fillStyle = innerG;
  ctx.beginPath();
  ctx.arc(pendingBirth.x, pendingBirth.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // birth-hintテキスト表示
  const hintEl = document.getElementById("birthHint");
  if (hintEl) hintEl.classList.add("active");
}

function render(time = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. 背景：天の川
  drawMilkyWay();

  // 2. 背景の静的小星
  drawBgStars(time);

  // 3. 予兆エフェクト
  drawPendingBirth(time);
  if (!pendingBirth) {
    const hintEl = document.getElementById("birthHint");
    if (hintEl) hintEl.classList.remove("active");
  }

  // 4. 星座線
  drawLinks();

  // 5. 動的な星（アクション記録）
  stars.forEach(star => {
    star.x += (star.vx || -0.06);
    star.y += (star.vy || 0);

    // 画面外でワープ
    if (star.x < -30) star.x = canvas.width + 30;
    else if (star.x > canvas.width + 30) star.x = -30;
    if (star.y < -30) star.y = canvas.height + 30;
    if (star.y > canvas.height + 30) star.y = -30;

    const age = time - star.birthAt;
    const progress = Math.min(age / star.birthDuration, 1);
    const twinkle = Math.sin((time - star.createdAt) * 0.0008) * 0.3;
    star.radius = star.baseRadius * progress + twinkle * 0.5;

    const auraSize = Math.max(0.5, star.radius * (2.5 + star.brightness * 0.6));
    const outerSize = auraSize * 3.5;

    // 外側のソフトグロー
    ctx.save();
    ctx.globalAlpha = 0.12 * star.brightness * progress;
    const outerGlow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, outerSize);
    outerGlow.addColorStop(0, star.color);
    outerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(star.x, star.y, outerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 内側のコア輝き
    ctx.save();
    ctx.globalAlpha = Math.min(1, (star.brightness + 0.5) * progress);
    const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, auraSize);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.25, star.color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(star.x, star.y, auraSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // クロス（十字）スパーク（大きい星のみ）
    if (star.baseRadius >= 5 && progress > 0.5) {
      const sparkLen = auraSize * 2;
      ctx.save();
      ctx.globalAlpha = 0.4 * progress * star.brightness;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(star.x - sparkLen, star.y);
      ctx.lineTo(star.x + sparkLen, star.y);
      ctx.moveTo(star.x, star.y - sparkLen);
      ctx.lineTo(star.x, star.y + sparkLen);
      ctx.stroke();
      ctx.restore();
    }
  });

  requestAnimationFrame(render);

  if (Math.random() < 0.008) {
    updateStarList();
  }
}

/* ==========================
   UI Event Listeners
========================== */
window.addEventListener("DOMContentLoaded", () => {
  const detailBtn = document.getElementById("detailBtn");
  const detailOverlay = document.getElementById("detailOverlay");
  const closeDetail = document.getElementById("closeDetail");

  if (detailBtn) {
    detailBtn.onclick = () => { detailOverlay.style.display = "flex"; };
  }
  if (closeDetail) {
    closeDetail.onclick = () => { detailOverlay.style.display = "none"; };
  }
  detailOverlay?.addEventListener("click", e => {
    if (e.target === detailOverlay) detailOverlay.style.display = "none";
  });
});

/* ==========================
   星の一覧表示（自動更新）
========================== */
const starInfoUI = document.getElementById("starInfo");

function updateStarList() {
  if (!starInfoUI) return;

  const remaining = POSTS_PER_STAR - postCount;

  if (stars.length === 0) {
    starInfoUI.innerHTML = `
      <div style="text-align:left;font-family:sans-serif;">
        <strong style="color:#c8d8ff;display:block;margin-bottom:6px;font-size:12px;">🌌 あなたの星座</strong>
        <div style="font-size:11px;color:#8899bb;">まだ星がありません</div>
        <div style="font-size:10px;color:#667799;margin-top:4px;">投稿${remaining}回で最初の星が生まれる</div>
      </div>`;
    return;
  }

  const counts = stars.reduce((acc, star) => {
    acc[star.type] = (acc[star.type] || 0) + 1;
    return acc;
  }, {});

  let html = `<div style="text-align:left;font-family:sans-serif;font-size:12px;">`;
  html += `<strong style="color:#c8d8ff;border-bottom:1px solid rgba(140,170,255,0.25);display:block;margin-bottom:5px;padding-bottom:3px;font-size:12px;">🌌 あなたの星座記録</strong>`;
  if (counts.post)       html += `<div style="color:#e8eeff;">⚪ 投稿星 <span style="float:right;color:#aabbdd;">${counts.post}</span></div>`;
  if (counts.nft)        html += `<div style="color:#e8eeff;">🔵 NFT星 <span style="float:right;color:#4da3ff;">${counts.nft}</span></div>`;
  if (counts.discussion) html += `<div style="color:#e8eeff;">🟡 連続星 <span style="float:right;color:#ffd166;">${counts.discussion}</span></div>`;
  if (counts.learning)   html += `<div style="color:#e8eeff;">🔴 学び星 <span style="float:right;color:#ff6b6b;">${counts.learning}</span></div>`;
  html += `<div style="border-top:1px solid rgba(140,170,255,0.2);margin-top:5px;padding-top:4px;color:#ffd166;">✨ 合計 <span style="float:right;">${stars.length}</span></div>`;
  if (postCount > 0) {
    html += `<div style="color:#667799;font-size:10px;margin-top:3px;">次の白星まで: ${remaining}投稿</div>`;
  }
  html += `</div>`;
  starInfoUI.innerHTML = html;
}

/* ==========================
   X（Twitter）シェア
========================== */
function shareToX() {
  const counts = stars.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {});
  const white  = counts.post || 0;
  const blue   = counts.nft  || 0;
  const yellow = counts.discussion || 0;
  const total  = stars.length;

  const red    = counts.learning || 0;
  let parts = [];
  if (white > 0)  parts.push(`⚪ 投稿星×${white}`);
  if (blue > 0)   parts.push(`🔵 NFT星×${blue}`);
  if (yellow > 0) parts.push(`🟡 連続星×${yellow}`);
  if (red > 0)    parts.push(`🔴 学び星×${red}`);

  const body = parts.length > 0
    ? `私の星座記録：${parts.join(' / ')}（合計${total}個）`
    : `Emuの星座で自分だけの夜空を育てています🌌`;

  const text = `${body}\n\n#Emu #SchoolPark`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
}

/* ==========================
   Room2 モード制御
========================== */
function openStarMode() {
  document.getElementById('room2ModeSelect').style.display = 'none';
  document.getElementById('echoFieldFrame').style.display = 'none';
  document.getElementById('echoFieldFrame').src = '';
}

function openEchoField() {
  document.getElementById('room2ModeSelect').style.display = 'none';
  const frame = document.getElementById('echoFieldFrame');
  frame.src = './echo-field.html';
  frame.style.display = 'block';
}

/* ==========================
   メッセージハンドラー
========================== */
window.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  const action = event.data;

  // ECHO FIELDから戻る
  if (action.type === 'ECHO_FIELD_BACK') {
    document.getElementById('echoFieldFrame').style.display = 'none';
    document.getElementById('echoFieldFrame').src = '';
    document.getElementById('room2ModeSelect').style.display = 'flex';
    return;
  }

  // 星座への通知
  console.log("🌟 Room2 received action:", action.type);
  switch (action.type) {
    case "NEW_POST":
      handlePostAccumulation("post");
      break;
    case "NFT_PURCHASE":
      spawnNFTStar();
      break;
    case "STREAK_3DAY":
      handleDiscussionStreak(action.projectId || "default");
      break;
    default:
      console.log("ℹ️ その他のアクション:", action.type);
  }
});
