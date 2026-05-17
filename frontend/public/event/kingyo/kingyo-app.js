// ==========================================
// 金魚すくい — ゲームロジック
// ==========================================

// ===== チケット定義 =====
const TICKETS = [
  {
    id: 'normal',
    name: 'ふつうのポイ',
    icon: '🎣',
    desc: 'やぶれやすいけど挑戦！',
    tag: null,
    poiMaxHp: 100,
    poiDrain: 28,      // 1回のすくいで減るHP
    fishSpeed: 1.0,
    timeLimit: 60,
  },
  {
    id: 'strong',
    name: 'つよいポイ',
    icon: '🏆',
    desc: 'やぶれにくい！',
    tag: 'おすすめ',
    poiMaxHp: 100,
    poiDrain: 16,
    fishSpeed: 1.2,
    timeLimit: 60,
  },
  {
    id: 'speed',
    name: 'はやい金魚',
    icon: '⚡',
    desc: 'すばしっこい金魚が泳ぐ',
    tag: '難しい',
    poiMaxHp: 100,
    poiDrain: 22,
    fishSpeed: 2.0,
    timeLimit: 60,
  },
  {
    id: 'bonanza',
    name: '金魚いっぱい',
    icon: '🌊',
    desc: 'たくさん泳いでいるよ！',
    tag: 'NEW',
    poiMaxHp: 100,
    poiDrain: 32,
    fishSpeed: 1.1,
    timeLimit: 60,
    extraFish: true,
  },
];

// ===== 金魚の種類 =====
const FISH_TYPES = [
  { id: 'aka',    label: '赤金魚',   color: '#e82020', colorLight: '#ff8080', pts: 10, size: 1.0, weight: 5 },
  { id: 'shiro',  label: '白金魚',   color: '#d8c8b0', colorLight: '#fff0d8', pts: 20, size: 0.9, weight: 3 },
  { id: 'demekin',label: '出目金',   color: '#181818', colorLight: '#606060', pts: 30, size: 1.1, weight: 2 },
  { id: 'ryukin', label: '琉金',     color: '#e88020', colorLight: '#ffcc60', pts: 50, size: 1.2, weight: 1 },
];

// ===== ゲーム状態 =====
let canvas, ctx, raf;
let fish = [];
let ripples = [];
let catchEffects = [];
let splashParticles = [];
let poiPos   = { x: 0.5, y: 0.5 };  // 0-1 の正規化座標
let poiHp    = 100;
let poiInWater = false;
let caughtFish = [];
let gameState  = 'idle'; // idle / playing / broken / done
let timeLeft   = 60;
let timerInterval = null;
let currentTicket  = null;
let speechPhrases  = [];
let speechIdx      = 0;
let speechTimer    = null;

// ===== チケット描画 =====
function renderTickets() {
  const grid = document.getElementById('ticketGrid');
  grid.innerHTML = TICKETS.map(t => `
    <div class="ticket-card" data-id="${t.id}">
      ${t.tag ? `<span class="tc-tag">${t.tag}</span>` : ''}
      <div class="tc-icon">${t.icon}</div>
      <div class="tc-name">${t.name}</div>
      <div class="tc-desc">${t.desc}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.ticket-card').forEach(card => {
    card.addEventListener('click', () => {
      const t = TICKETS.find(x => x.id === card.dataset.id);
      if (t) startGame(t);
    });
  });
}

// ===== ゲーム開始 =====
function startGame(ticket) {
  currentTicket = ticket;
  fish = [];
  ripples = [];
  catchEffects = [];
  splashParticles = [];
  caughtFish = [];
  poiHp = ticket.poiMaxHp;
  timeLeft = ticket.timeLimit;
  gameState = 'playing';
  poiInWater = false;

  // UI
  const overlay = document.getElementById('gameOverlay');
  const gameCard = document.getElementById('gameCard');
  const resultScreen = document.getElementById('resultScreen');
  overlay.classList.add('show');
  gameCard.style.display = '';
  resultScreen.classList.remove('show');
  document.getElementById('gameActions').style.display = 'none';
  document.getElementById('gameTitle').textContent = `${ticket.icon} ${ticket.name}でスタート！`;
  document.getElementById('gameMsg').textContent = '金魚をタップしてすくおう！';
  document.getElementById('timerVal').textContent = timeLeft;
  document.getElementById('caughtVal').textContent = '0匹';
  updatePoiBar();

  // 金魚を生成
  const count = ticket.extraFish ? 14 : 10;
  spawnFish(count, ticket.fishSpeed);

  // canvas セットアップ
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  resizeCanvas();

  // タイマー
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (gameState !== 'playing') { clearInterval(timerInterval); return; }
    timeLeft--;
    document.getElementById('timerVal').textContent = timeLeft;
    if (timeLeft <= 10) document.getElementById('timerVal').style.color = '#ff6060';
    if (timeLeft <= 0) endGame('time');
  }, 1000);

  // 吹き出し
  setSpeechPlaying();

  // アニメーションループ
  cancelAnimationFrame(raf);
  loop();
}

// ===== 金魚生成 =====
function spawnFish(count, speedMul) {
  for (let i = 0; i < count; i++) {
    const type = weightedRandom(FISH_TYPES);
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.003 + Math.random() * 0.003) * speedMul;
    fish.push({
      id: Date.now() + i,
      type,
      x: 0.1 + Math.random() * 0.8,
      y: 0.1 + Math.random() * 0.8,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.04 + Math.random() * 0.04,
      size: type.size,
      catchAnim: 0,  // 0=normal, >0=被catch演出
      scaredTimer: 0,
    });
  }
}

// ===== メインループ =====
function loop() {
  raf = requestAnimationFrame(loop);
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawWater(W, H);
  updateAndDrawRipples(W, H);
  updateAndDrawFish(W, H);
  updateAndDrawEffects(W, H);
  drawPoi(W, H);
}

// ===== 水面描画 =====
function drawWater(W, H) {
  const grd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) * 0.7);
  grd.addColorStop(0,   '#2a90d8');
  grd.addColorStop(0.6, '#1a6fa8');
  grd.addColorStop(1,   '#0d3d5e');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // 波紋ライン
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (H * 0.15) + i * (H * 0.17) + Math.sin(Date.now() * 0.0004 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * 0.3, y - 8, W * 0.7, y + 8, W, y);
    ctx.stroke();
  }

  // 桶の内側の丸み（楕円でクリップ演出）
  const rx = W * 0.48, ry = H * 0.47;
  const cx2 = W / 2, cy2 = H / 2;
  ctx.strokeStyle = 'rgba(200,160,64,0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(cx2, cy2, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 外枠（木）
  ctx.strokeStyle = 'rgba(150,80,30,0.6)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(cx2, cy2, rx + 8, ry + 8, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// ===== 波紋 =====
function addRipple(x, y) {
  ripples.push({ x, y, r: 0, maxR: 55, alpha: 0.55 });
}
function updateAndDrawRipples(W, H) {
  ripples = ripples.filter(r => r.alpha > 0.01);
  ripples.forEach(r => {
    r.r += 1.8;
    r.alpha -= 0.016;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(125,212,248,${r.alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 二重リング
    if (r.r > 15) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(125,212,248,${r.alpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

// ===== 金魚描画・更新 =====
function updateAndDrawFish(W, H) {
  const cx = W / 2, cy = H / 2;
  const rx = W * 0.44, ry = H * 0.42;

  fish.forEach(f => {
    // scared -> poi から逃げる
    if (f.scaredTimer > 0) {
      f.scaredTimer--;
      const pdx = f.x - poiPos.x;
      const pdy = f.y - poiPos.y;
      const pd = Math.sqrt(pdx*pdx + pdy*pdy) || 0.001;
      f.dx += (pdx / pd) * 0.0012;
      f.dy += (pdy / pd) * 0.0012;
    }

    // wobble（体のくねり）
    f.wobble += f.wobbleSpeed;

    // 移動
    f.x += f.dx + Math.sin(f.wobble) * 0.0005;
    f.y += f.dy + Math.cos(f.wobble * 0.7) * 0.0004;

    // 速度の最大値制限
    const spd = Math.sqrt(f.dx*f.dx + f.dy*f.dy);
    const maxSpd = 0.012;
    if (spd > maxSpd) { f.dx = f.dx/spd*maxSpd; f.dy = f.dy/spd*maxSpd; }

    // 楕円境界でバウンス
    const nx = (f.x - 0.5) / 0.45;
    const ny = (f.y - 0.5) / 0.45;
    if (nx*nx + ny*ny > 0.85) {
      const angle = Math.atan2(ny, nx);
      f.dx -= Math.cos(angle) * 0.004;
      f.dy -= Math.sin(angle) * 0.004;
      f.x = 0.5 + Math.cos(angle) * 0.43 * 0.45;
      f.y = 0.5 + Math.sin(angle) * 0.43 * 0.45;
    }

    // 壁反射（安全策）
    if (f.x < 0.08) { f.x = 0.08; f.dx = Math.abs(f.dx); }
    if (f.x > 0.92) { f.x = 0.92; f.dx = -Math.abs(f.dx); }
    if (f.y < 0.08) { f.y = 0.08; f.dy = Math.abs(f.dy); }
    if (f.y > 0.92) { f.y = 0.92; f.dy = -Math.abs(f.dy); }

    // 描画
    const fx = f.x * W, fy = f.y * H;
    const fs = f.size * W * 0.058;
    const angle = Math.atan2(f.dy, f.dx);

    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(angle);

    // 影
    ctx.beginPath();
    ctx.ellipse(fs * 0.1, fs * 0.3, fs * 0.9, fs * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // 体
    const grd = ctx.createRadialGradient(-fs*0.2, -fs*0.2, 0, 0, 0, fs);
    grd.addColorStop(0, f.type.colorLight);
    grd.addColorStop(1, f.type.color);
    ctx.beginPath();
    ctx.ellipse(0, 0, fs, fs * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 尾ひれ
    ctx.beginPath();
    ctx.moveTo(fs * 0.75, 0);
    ctx.bezierCurveTo(fs * 1.1, -fs * 0.55, fs * 1.5, -fs * 0.4, fs * 1.6, 0);
    ctx.bezierCurveTo(fs * 1.5,  fs * 0.4,  fs * 1.1,  fs * 0.55, fs * 0.75, 0);
    ctx.fillStyle = f.type.color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 胸びれ
    ctx.beginPath();
    ctx.ellipse(0, fs * 0.45, fs * 0.25, fs * 0.15, Math.PI * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = f.type.colorLight;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 目
    ctx.beginPath();
    ctx.arc(-fs * 0.4, -fs * 0.18, fs * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-fs * 0.4, -fs * 0.18, fs * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    // 目のハイライト
    ctx.beginPath();
    ctx.arc(-fs * 0.43, -fs * 0.22, fs * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // 出目金の目は大きく
    if (f.type.id === 'demekin') {
      ctx.beginPath();
      ctx.arc(-fs * 0.38, -fs * 0.2, fs * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fill();
    }

    // スケール（鱗）
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    for (let s = 0; s < 3; s++) {
      ctx.beginPath();
      ctx.arc(-fs * 0.1 + s * fs * 0.3, 0, fs * 0.28, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
    }

    ctx.restore();

    // 点数表示（捕まえた直後に一瞬光る）
    if (f.catchAnim > 0) {
      f.catchAnim--;
      ctx.font = `bold ${Math.round(fs * 0.8)}px sans-serif`;
      ctx.fillStyle = `rgba(255,230,80,${f.catchAnim/20})`;
      ctx.textAlign = 'center';
      ctx.fillText(`+${f.type.pts}`, fx, fy - fs * 1.5);
    }
  });
}

// ===== パーティクル・エフェクト =====
function addCatchEffect(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 / 12) * i + Math.random() * 0.3;
    const spd = 2 + Math.random() * 3;
    splashParticles.push({
      x, y,
      dx: Math.cos(angle) * spd,
      dy: Math.sin(angle) * spd,
      r: 2 + Math.random() * 3,
      alpha: 1,
      color,
    });
  }
}
function addBreakEffect(x, y) {
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2 / 16) * i;
    splashParticles.push({
      x, y,
      dx: Math.cos(angle) * (1.5 + Math.random() * 2),
      dy: Math.sin(angle) * (1.5 + Math.random() * 2),
      r: 3 + Math.random() * 4,
      alpha: 1,
      color: '#e8d090',
    });
  }
}
function updateAndDrawEffects(W, H) {
  splashParticles = splashParticles.filter(p => p.alpha > 0.02);
  splashParticles.forEach(p => {
    p.x += p.dx;
    p.y += p.dy;
    p.dy += 0.12;
    p.alpha -= 0.035;
    p.dx *= 0.94;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color.replace(')', `,${p.alpha})`).replace('rgb', 'rgba').replace('#', '') ;
    // simpler approach:
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ===== ポイ描画 =====
function drawPoi(W, H) {
  if (gameState !== 'playing') return;
  const px = poiPos.x * W;
  const py = poiPos.y * H;
  const r  = W * 0.09;

  // 柄
  const handleAngle = Math.PI * 0.75;
  const hx = px + Math.cos(handleAngle) * r * 1.8;
  const hy = py + Math.sin(handleAngle) * r * 1.8;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(hx, hy);
  ctx.strokeStyle = '#8a5020';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();
  // 柄のハイライト
  ctx.beginPath();
  ctx.moveTo(px - 1, py - 1);
  ctx.lineTo(hx - 1, hy - 1);
  ctx.strokeStyle = '#c08040';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ポイの枠（ワイヤー）
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#d4a040';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // ポイの紙（HP に応じて破れ具合）
  const hpRatio = poiHp / 100;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, r - 2, 0, Math.PI * 2);
  ctx.clip();

  // 紙の色（HP低いほど茶色＋透明に）
  const paperAlpha = 0.25 + hpRatio * 0.45;
  ctx.fillStyle = `rgba(230,215,160,${paperAlpha})`;
  ctx.fillRect(px - r, py - r, r * 2, r * 2);

  // 破れ模様（HP低下で増える）
  if (hpRatio < 0.85) {
    ctx.strokeStyle = `rgba(160,100,30,${(1 - hpRatio) * 0.7})`;
    ctx.lineWidth = 1;
    const cracks = Math.floor((1 - hpRatio) * 8);
    for (let c = 0; c < cracks; c++) {
      const ca = (Math.PI * 2 / 8) * c + 0.3;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(ca) * r * 0.2, py + Math.sin(ca) * r * 0.2);
      ctx.lineTo(px + Math.cos(ca) * r * (0.6 + c * 0.04), py + Math.sin(ca) * r * (0.6 + c * 0.04));
      ctx.stroke();
    }
  }

  // HP 0% → 破れ穴
  if (hpRatio <= 0) {
    ctx.clearRect(px - r * 0.5, py - r * 0.5, r, r);
  }

  ctx.restore();

  // HP インジケーター（外縁の光）
  const hpColor = hpRatio > 0.5 ? `rgba(80,220,120,0.5)` : hpRatio > 0.25 ? `rgba(240,180,40,0.5)` : `rgba(240,60,60,0.6)`;
  ctx.beginPath();
  ctx.arc(px, py, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
  ctx.strokeStyle = hpColor;
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ===== ポイバー更新 =====
function updatePoiBar() {
  const bar = document.getElementById('poiBar');
  if (!bar) return;
  const hp = Math.max(0, poiHp);
  bar.style.width = hp + '%';
  bar.style.background = hp > 50
    ? 'linear-gradient(90deg,#e8a030,#ffe270)'
    : hp > 25
      ? 'linear-gradient(90deg,#e87030,#ffb040)'
      : 'linear-gradient(90deg,#e83030,#ff6060)';
}

// ===== マウス / タッチ入力 =====
function setupInput() {
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else {
      cx = e.clientX;
      cy = e.clientY;
    }
    return {
      x: (cx - rect.left) / rect.width,
      y: (cy - rect.top)  / rect.height,
    };
  }

  function onMove(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    const p = getPos(e);
    poiPos = p;
    // 近くの魚を怖がらせる
    fish.forEach(f => {
      const dx = f.x - p.x, dy = f.y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < 0.18) f.scaredTimer = 30;
    });
  }

  function onTap(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    const p = getPos(e);
    poiPos = p;
    tryScoopAt(p.x, p.y);
  }

  canvas.addEventListener('mousemove',  onMove, { passive: false });
  canvas.addEventListener('touchmove',  onMove, { passive: false });
  canvas.addEventListener('click',      onTap,  { passive: false });
  canvas.addEventListener('touchstart', onTap,  { passive: false });
}

// ===== すくい判定 =====
function tryScoopAt(nx, ny) {
  if (gameState !== 'playing') return;
  if (poiHp <= 0) return;

  const W = canvas.width, H = canvas.height;
  const poiR = 0.09; // 正規化半径

  addRipple(nx * W, ny * H);

  // HP を消費
  poiHp = Math.max(0, poiHp - currentTicket.poiDrain);
  updatePoiBar();

  // 近くの魚を探す
  let closest = null, closestD = Infinity;
  fish.forEach(f => {
    const dx = f.x - nx, dy = f.y - ny;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < poiR * 1.1 && d < closestD) {
      closestD = d;
      closest = f;
    }
  });

  if (closest) {
    // 捕獲成功！距離が近いほど確率UP
    const chance = 0.55 + (1 - closestD / (poiR * 1.1)) * 0.35 - (1 - poiHp / 100) * 0.15;
    if (Math.random() < chance) {
      // 捕まえた！
      caughtFish.push(closest.type);
      addCatchEffect(nx * W, ny * H, closest.type.colorLight);
      addRipple(nx * W, ny * H);
      addRipple(nx * W + 8, ny * H - 8);
      closest.catchAnim = 20;
      setTimeout(() => {
        fish = fish.filter(f => f.id !== closest.id);
      }, 300);
      document.getElementById('caughtVal').textContent = caughtFish.length + '匹';
      setMsg(`✨ ${closest.type.label}をすくった！+${closest.type.pts}点`);
      setSpeechCatch(closest.type);
    } else {
      // 惜しい！
      setMsg('あ〜もう少し！');
    }
  } else {
    // 外れ
    setMsg('空振り…金魚はどこだ？');
  }

  // ポイ破損チェック
  if (poiHp <= 0) {
    addBreakEffect(nx * W, ny * H);
    setMsg('💥 ポイが破れた！');
    setSpeechBroken();
    gameState = 'broken';
    setTimeout(() => endGame('broken'), 1200);
  }
}

// ===== ゲーム終了 =====
function endGame(reason) {
  gameState = 'done';
  clearInterval(timerInterval);
  cancelAnimationFrame(raf);

  const totalScore = caughtFish.reduce((s, f) => s + f.pts, 0);

  // リザルト画面
  const gameCard    = document.getElementById('gameCard');
  const resultScreen= document.getElementById('resultScreen');
  gameCard.style.display = 'none';
  resultScreen.classList.add('show');

  const title = document.getElementById('resultTitle');
  const sub   = document.getElementById('resultSub');
  const list  = document.getElementById('resultFishList');
  const score = document.getElementById('resultScore');

  if (reason === 'time') {
    title.textContent = caughtFish.length >= 5 ? '🎉 すごい！' : caughtFish.length >= 2 ? '😊 上手！' : '⏰ 時間切れ！';
  } else {
    title.textContent = '💥 ポイが破れた！';
  }

  sub.textContent = caughtFish.length > 0 ? `すくえた金魚 ${caughtFish.length}匹` : '今回は0匹…また挑戦してみてね！';

  if (caughtFish.length > 0) {
    const fishCounts = {};
    caughtFish.forEach(f => { fishCounts[f.id] = (fishCounts[f.id] || { type: f, count: 0 }); fishCounts[f.id].count++; });
    list.innerHTML = Object.values(fishCounts).map(fc =>
      `<div class="result-fish-item" title="${fc.type.label} ×${fc.count}">
         ${fc.type.id === 'aka' ? '🐟' : fc.type.id === 'shiro' ? '🤍' : fc.type.id === 'demekin' ? '🐠' : '🏅'}
         <span style="font-size:11px;font-weight:800;">×${fc.count}</span>
       </div>`
    ).join('');
  } else {
    list.innerHTML = '<span style="font-size:32px">😢</span>';
  }

  score.textContent = totalScore + '点';

  setSpeechResult(caughtFish.length);
}

// ===== メッセージ =====
function setMsg(txt) {
  const el = document.getElementById('gameMsg');
  if (el) el.textContent = txt;
}
function setSpeech(txt) {
  const el = document.getElementById('speech');
  if (el) {
    el.textContent = txt;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'popIn .5s cubic-bezier(.34,1.56,.64,1) both, wiggle 4s ease-in-out 1s infinite';
  }
}
function setSpeechPlaying() {
  const phrases = ['がんばれ〜！','ほらほら！','うまいうまい！','もう一匹！'];
  setSpeech(phrases[0]);
  clearInterval(speechTimer);
  let i = 1;
  speechTimer = setInterval(() => {
    if (gameState !== 'playing') { clearInterval(speechTimer); return; }
    setSpeech(phrases[i % phrases.length]);
    i++;
  }, 4000);
}
function setSpeechCatch(type) {
  const msgs = {
    aka:    'やったー！赤金魚！🎉',
    shiro:  'おお！白金魚だ！✨',
    demekin:'うわっ出目金！すごい！',
    ryukin: '！！琉金！！やるね！！',
  };
  setSpeech(msgs[type.id] || 'よし！すくった！');
}
function setSpeechBroken() { setSpeech('あらら〜破れちゃった💦'); }
function setSpeechResult(count) {
  if (count >= 5) setSpeech('すごい腕前だ！🏆');
  else if (count >= 2) setSpeech('なかなかやるね！😄');
  else if (count === 1) setSpeech('1匹ゲット！えらい！');
  else setSpeech('また来てね〜！😊');
}

// ===== canvas リサイズ =====
function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}

// ===== ユーティリティ =====
function weightedRandom(arr) {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
  return arr[arr.length - 1];
}

// ===== ボタンイベント =====
function bindButtons() {
  document.getElementById('btnAgain').addEventListener('click', () => {
    if (currentTicket) startGame(currentTicket);
  });
  document.getElementById('btnDone').addEventListener('click', () => {
    const overlay = document.getElementById('gameOverlay');
    overlay.classList.remove('show');
    clearInterval(timerInterval);
    cancelAnimationFrame(raf);
    gameState = 'idle';
    document.getElementById('timerVal').style.color = '';
    setSpeech('金魚すくい、やってみる？🐟');
  });
  document.getElementById('btnResultAgain').addEventListener('click', () => {
    if (currentTicket) startGame(currentTicket);
  });
  document.getElementById('btnResultClose').addEventListener('click', () => {
    const overlay = document.getElementById('gameOverlay');
    overlay.classList.remove('show');
    clearInterval(timerInterval);
    cancelAnimationFrame(raf);
    gameState = 'idle';
    document.getElementById('timerVal').style.color = '';
    setSpeech('また遊んでね〜🐟');
  });
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  renderTickets();
  bindButtons();
  setupInput();
  window.addEventListener('resize', () => { if (canvas) resizeCanvas(); });

  // 吹き出しローテーション（待機中）
  const idlePhrases = ['金魚すくい、やってみる？🐟','どれにする？😊','ポイを選んでね！','何匹すくえるかな？'];
  let idleIdx = 0;
  setInterval(() => {
    if (gameState !== 'idle') return;
    idleIdx = (idleIdx + 1) % idlePhrases.length;
    setSpeech(idlePhrases[idleIdx]);
  }, 4500);
});
