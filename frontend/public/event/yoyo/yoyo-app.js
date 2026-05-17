// ==========================================
// ヨーヨー釣り — ゲームロジック
// ==========================================

// ===== ホック（チケット）定義 =====
const HOOKS = [
  {
    id: 'normal',
    name: 'ふつうのホック',
    icon: '🪝',
    desc: '紙製だから慎重に！',
    tag: null,
    hookMaxHp: 100,
    hookDrain: 25,
    yoyoSpeed: 0.9,
    timeLimit: 60,
  },
  {
    id: 'strong',
    name: 'つよいホック',
    icon: '🏆',
    desc: '長持ちするホック',
    tag: 'おすすめ',
    hookMaxHp: 100,
    hookDrain: 14,
    yoyoSpeed: 1.1,
    timeLimit: 60,
  },
  {
    id: 'big',
    name: 'おおきいホック',
    icon: '🎯',
    desc: '当たり判定が広い！',
    tag: null,
    hookMaxHp: 100,
    hookDrain: 20,
    yoyoSpeed: 1.0,
    timeLimit: 60,
    bigHook: true,
  },
  {
    id: 'rainbow',
    name: 'レインボー',
    icon: '🌈',
    desc: '虹ヨーヨーが出やすい！',
    tag: 'NEW',
    hookMaxHp: 100,
    hookDrain: 30,
    yoyoSpeed: 1.2,
    timeLimit: 60,
    rainbowBonus: true,
  },
];

// ===== ヨーヨーの種類 =====
const YOYO_TYPES = [
  { id: 'red',     label: '赤',   color: '#e82030', colorLight: '#ff8090', pts: 10, weight: 5, emoji: '🔴' },
  { id: 'blue',    label: '青',   color: '#2050e8', colorLight: '#80a0ff', pts: 10, weight: 5, emoji: '🔵' },
  { id: 'yellow',  label: '黄',   color: '#e8c000', colorLight: '#ffe860', pts: 20, weight: 3, emoji: '🟡' },
  { id: 'green',   label: '緑',   color: '#20a040', colorLight: '#60e080', pts: 20, weight: 3, emoji: '🟢' },
  { id: 'purple',  label: '紫',   color: '#8020c8', colorLight: '#c060ff', pts: 30, weight: 2, emoji: '🟣' },
  { id: 'rainbow', label: '虹',   color: '#e84050', colorLight: '#ffa0b0', pts: 50, weight: 1, emoji: '🌈' },
];

// ===== ゲーム状態 =====
let canvas, ctx, raf;
let yoyos = [];
let ripples = [];
let particles = [];
let hookPos   = { x: 0.5, y: 0.5 };
let hookHp    = 100;
let caughtYoyos = [];
let gameState   = 'idle';
let timeLeft    = 60;
let timerInterval = null;
let currentHook   = null;
let speechTimer   = null;

// catch animation queue
let catchAnims = []; // { x, y, label, alpha, vy }

// ===== ホック描画パネル =====
function renderHooks() {
  const grid = document.getElementById('hookGrid');
  grid.innerHTML = HOOKS.map(h => `
    <div class="hook-card" data-id="${h.id}">
      ${h.tag ? `<span class="hc-tag">${h.tag}</span>` : ''}
      <div class="hc-icon">${h.icon}</div>
      <div class="hc-name">${h.name}</div>
      <div class="hc-desc">${h.desc}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.hook-card').forEach(card => {
    card.addEventListener('click', () => {
      const h = HOOKS.find(x => x.id === card.dataset.id);
      if (h) startGame(h);
    });
  });
}

// ===== ゲーム開始 =====
function startGame(hook) {
  currentHook = hook;
  yoyos = [];
  ripples = [];
  particles = [];
  catchAnims = [];
  caughtYoyos = [];
  hookHp = hook.hookMaxHp;
  timeLeft = hook.timeLimit;
  gameState = 'playing';

  // UI切り替え
  document.getElementById('gameOverlay').classList.add('show');
  document.getElementById('gameCard').style.display = '';
  document.getElementById('resultScreen').classList.remove('show');
  document.getElementById('gameActions').style.display = 'none';
  document.getElementById('gameTitle').textContent = `${hook.icon} ${hook.name}でスタート！`;
  document.getElementById('gameMsg').textContent = 'ヨーヨーの紐をタップして釣ろう！';
  document.getElementById('timerVal').textContent = timeLeft;
  document.getElementById('timerVal').style.color = '';
  document.getElementById('caughtVal').textContent = '0個';
  updateHookBar();

  // ヨーヨー生成
  spawnYoyos(hook.rainbowBonus ? 12 : 10, hook.yoyoSpeed, hook.rainbowBonus);

  // canvas
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  resizeCanvas();
  setupInput(); // canvas確定後に呼ぶ

  // タイマー
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (gameState !== 'playing') { clearInterval(timerInterval); return; }
    timeLeft--;
    document.getElementById('timerVal').textContent = timeLeft;
    if (timeLeft <= 10) document.getElementById('timerVal').style.color = '#ff6060';
    if (timeLeft <= 0) endGame('time');
  }, 1000);

  setSpeechPlaying();
  cancelAnimationFrame(raf);
  loop();
}

// ===== ヨーヨー生成 =====
function spawnYoyos(count, speedMul, rainbowBonus) {
  for (let i = 0; i < count; i++) {
    const type = rainbowBonus && i === 0
      ? YOYO_TYPES.find(t => t.id === 'rainbow')
      : weightedRandom(YOYO_TYPES);
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.0008 + Math.random() * 0.001) * speedMul;
    yoyos.push({
      id: Date.now() + i,
      type,
      // ヨーヨーは水面に浮くので 0.15〜0.85 の範囲
      x: 0.12 + Math.random() * 0.76,
      y: 0.12 + Math.random() * 0.76,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.025 + Math.random() * 0.02,
      bobAmp:   0.012 + Math.random() * 0.01,
      radius: 0.07 + Math.random() * 0.015, // ヨーヨーの半径（正規化）
      stringLen: 0.14 + Math.random() * 0.04,
      catchAnim: 0,
      caught: false,
      springY: 0,     // 釣れたときのバウンス
      springVy: 0,
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
  updateAndDrawYoyos(W, H);
  updateAndDrawParticles(W, H);
  updateAndDrawCatchAnims(W, H);
  drawHook(W, H);
}

// ===== 水面 =====
function drawWater(W, H) {
  const grd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H) * 0.75);
  grd.addColorStop(0,   '#50b0e8');
  grd.addColorStop(0.6, '#2888c8');
  grd.addColorStop(1,   '#0d4070');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // 水面波紋ライン
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = H * 0.18 + i * H * 0.2 + Math.sin(Date.now() * 0.0004 + i * 1.2) * 5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * 0.3, y - 7, W * 0.7, y + 7, W, y);
    ctx.stroke();
  }

  // 桶の縁
  ctx.strokeStyle = 'rgba(180,120,40,0.45)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(W/2, H/2, W * 0.475, H * 0.475, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,180,80,0.3)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(W/2, H/2, W * 0.465, H * 0.465, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// ===== 波紋 =====
function addRipple(x, y) {
  ripples.push({ x, y, r: 0, alpha: 0.5 });
}
function updateAndDrawRipples(W, H) {
  ripples = ripples.filter(r => r.alpha > 0.01);
  ripples.forEach(r => {
    r.r += 1.6;
    r.alpha -= 0.018;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(180,230,255,${r.alpha})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (r.r > 12) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,230,255,${r.alpha * 0.4})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

// ===== ヨーヨー描画・更新 =====
function updateAndDrawYoyos(W, H) {
  yoyos.forEach(y => {
    if (y.caught) return;

    // ゆったり漂う
    y.bobPhase += y.bobSpeed;
    y.x += y.dx;
    y.y += y.dy + Math.sin(y.bobPhase) * 0.0004;

    // 楕円境界バウンス
    const nx = (y.x - 0.5) / 0.44;
    const ny = (y.y - 0.5) / 0.44;
    if (nx*nx + ny*ny > 0.85) {
      const a = Math.atan2(ny, nx);
      y.dx -= Math.cos(a) * 0.003;
      y.dy -= Math.sin(a) * 0.003;
      y.x = 0.5 + Math.cos(a) * 0.42 * 0.44;
      y.y = 0.5 + Math.sin(a) * 0.42 * 0.44;
    }
    if (y.x < 0.1) { y.x = 0.1; y.dx = Math.abs(y.dx); }
    if (y.x > 0.9) { y.x = 0.9; y.dx = -Math.abs(y.dx); }
    if (y.y < 0.1) { y.y = 0.1; y.dy = Math.abs(y.dy); }
    if (y.y > 0.9) { y.y = 0.9; y.dy = -Math.abs(y.dy); }

    // ホックが近いと少し逃げる（でも魚ほどは逃げない）
    const hpd = Math.hypot(y.x - hookPos.x, y.y - hookPos.y);
    if (hpd < 0.12) {
      const a = Math.atan2(y.y - hookPos.y, y.x - hookPos.x);
      y.dx += Math.cos(a) * 0.0005;
      y.dy += Math.sin(a) * 0.0005;
    }

    // 速度制限
    const spd = Math.hypot(y.dx, y.dy);
    const maxS = 0.006;
    if (spd > maxS) { y.dx = y.dx/spd*maxS; y.dy = y.dy/spd*maxS; }

    drawYoyo(y, W, H);
  });
}

function drawYoyo(y, W, H) {
  const cx = y.x * W;
  const cy = y.y * H;
  const r  = y.radius * Math.min(W, H);
  const stringPx = y.stringLen * Math.min(W, H);
  const bob = Math.sin(y.bobPhase) * r * 0.18; // 上下ボブ

  // ===== 影（水面に映る） =====
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.12, cy + bob + r * 0.35, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();

  // ===== 紐（ひも）→ フックの当たり判定に使う部分 =====
  ctx.beginPath();
  ctx.moveTo(cx, cy + bob + r);
  // 紐がわずかにたわむ
  const loopX = cx + Math.sin(y.bobPhase * 0.5) * r * 0.4;
  const loopY = cy + bob + r + stringPx;
  ctx.bezierCurveTo(
    cx + r * 0.1, cy + bob + r + stringPx * 0.4,
    loopX - r * 0.05, loopY - stringPx * 0.1,
    loopX, loopY
  );
  ctx.strokeStyle = 'rgba(200,200,200,0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 紐の先端のループ（ここにフックをかける）
  ctx.beginPath();
  ctx.arc(loopX, loopY, r * 0.22, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(220,220,220,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  // ===== ヨーヨー本体（上半球） =====
  const grd = ctx.createRadialGradient(cx - r * 0.3, cy + bob - r * 0.3, r * 0.05, cx, cy + bob, r);
  grd.addColorStop(0, y.type.colorLight);
  grd.addColorStop(0.5, y.type.color);
  grd.addColorStop(1, darken(y.type.color, 0.55));
  ctx.beginPath();
  ctx.arc(cx, cy + bob, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ヨーヨーの溝（真ん中の線）
  ctx.beginPath();
  ctx.ellipse(cx, cy + bob, r, r * 0.12, 0, 0, Math.PI * 2);
  ctx.strokeStyle = darken(y.type.color, 0.45);
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ハイライト
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy + bob - r * 0.28, r * 0.3, r * 0.18, -Math.PI * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fill();

  // 虹ヨーヨーは特別装飾
  if (y.type.id === 'rainbow') {
    const colors = ['#ff4040','#ff9900','#ffe000','#40e040','#4080ff','#a040e8'];
    const slices = colors.length;
    const rotation = Date.now() * 0.002;
    for (let s = 0; s < slices; s++) {
      const startA = rotation + (Math.PI * 2 / slices) * s;
      const endA   = startA + (Math.PI * 2 / slices);
      ctx.beginPath();
      ctx.moveTo(cx, cy + bob);
      ctx.arc(cx, cy + bob, r * 0.88, startA, endA);
      ctx.closePath();
      ctx.fillStyle = colors[s] + '55';
      ctx.fill();
    }
    // キラキラ
    ctx.beginPath();
    ctx.arc(cx, cy + bob, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,230,80,${0.3 + Math.sin(Date.now() * 0.005) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ループの座標を保存（当たり判定に使用）
  y._loopX = loopX;
  y._loopY = loopY;
  y._loopR = r * 0.22;
}

// ===== パーティクル =====
function addCatchParticles(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 / 14) * i + Math.random() * 0.3;
    const s = 2.5 + Math.random() * 3.5;
    particles.push({
      x, y,
      dx: Math.cos(a) * s,
      dy: Math.sin(a) * s - 1.5,
      r: 2.5 + Math.random() * 3,
      alpha: 1,
      color,
    });
  }
}
function addBreakParticles(x, y) {
  for (let i = 0; i < 18; i++) {
    const a = (Math.PI * 2 / 18) * i;
    particles.push({ x, y, dx: Math.cos(a) * (1.5 + Math.random()*2.5), dy: Math.sin(a) * (1.5 + Math.random()*2.5) - 1, r: 3 + Math.random()*4, alpha: 1, color: '#e8d090' });
  }
}
function updateAndDrawParticles(W, H) {
  particles = particles.filter(p => p.alpha > 0.02);
  particles.forEach(p => {
    p.x += p.dx; p.y += p.dy;
    p.dy += 0.1; p.dx *= 0.94; p.alpha -= 0.03;
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ===== キャッチアニメ（+点数テキスト）=====
function addCatchAnim(x, y, label) {
  catchAnims.push({ x, y, label, alpha: 1, vy: -1.5 });
}
function updateAndDrawCatchAnims(W, H) {
  catchAnims = catchAnims.filter(c => c.alpha > 0.02);
  catchAnims.forEach(c => {
    c.y += c.vy;
    c.alpha -= 0.025;
    ctx.globalAlpha = c.alpha;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#ffe270';
    ctx.textAlign = 'center';
    ctx.fillText(c.label, c.x, c.y);
    ctx.globalAlpha = 1;
  });
}

// ===== ホック描画 =====
function drawHook(W, H) {
  if (gameState !== 'playing') return;
  const hx = hookPos.x * W;
  const hy = hookPos.y * H;
  const hookR = currentHook && currentHook.bigHook ? 0.095 : 0.072;
  const hr = hookR * Math.min(W, H);

  // 柄（上に伸びる）
  ctx.beginPath();
  ctx.moveTo(hx, hy - hr * 0.3);
  ctx.lineTo(hx, hy - hr * 2.4);
  ctx.strokeStyle = '#8a6030';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx - 1, hy - hr * 0.3);
  ctx.lineTo(hx - 1, hy - hr * 2.4);
  ctx.strokeStyle = '#c09050';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ホック本体（J字）
  const hpRatio = Math.max(0, hookHp) / 100;
  const hookColor = hpRatio > 0.5 ? '#c8a840' : hpRatio > 0.25 ? '#e87020' : '#e83030';
  ctx.beginPath();
  ctx.moveTo(hx, hy - hr * 0.3);
  ctx.lineTo(hx, hy + hr * 0.8);
  ctx.arc(hx + hr * 0.55, hy + hr * 0.8, hr * 0.55, Math.PI, Math.PI * 1.85);
  ctx.strokeStyle = hookColor;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // ホックのHP外縁リング
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 0.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
  ctx.strokeStyle = hookColor.replace(')', ',0.55)').replace('#', 'rgba(').replace('rgba(', 'rgba(');
  // simpler:
  ctx.strokeStyle = hpRatio > 0.5 ? 'rgba(200,168,64,0.45)' : hpRatio > 0.25 ? 'rgba(232,112,32,0.5)' : 'rgba(232,48,48,0.6)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // HP0で折れ曲がり演出
  if (hpRatio <= 0) {
    ctx.beginPath();
    ctx.moveTo(hx, hy + hr * 0.4);
    ctx.lineTo(hx + hr * 0.6, hy + hr * 1.0);
    ctx.strokeStyle = '#e83030';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ===== HPバー =====
function updateHookBar() {
  const bar = document.getElementById('hookBar');
  if (!bar) return;
  const hp = Math.max(0, hookHp);
  bar.style.width = hp + '%';
  bar.style.background = hp > 50
    ? 'linear-gradient(90deg,#f5c600,#fff380)'
    : hp > 25
      ? 'linear-gradient(90deg,#f07020,#ffb040)'
      : 'linear-gradient(90deg,#e83030,#ff6060)';
}

// ===== 入力セットアップ（canvas確定後に呼ぶ）=====
function setupInput() {
  if (canvas._inputBound) return;
  canvas._inputBound = true;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
    else { cx = e.clientX; cy = e.clientY; }
    return { x: (cx - rect.left) / rect.width, y: (cy - rect.top) / rect.height };
  }

  function onMove(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    hookPos = getPos(e);
  }
  function onTap(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    const p = getPos(e);
    hookPos = p;
    tryHookAt(p.x, p.y);
  }

  canvas.addEventListener('mousemove',  onMove, { passive: false });
  canvas.addEventListener('touchmove',  onMove, { passive: false });
  canvas.addEventListener('click',      onTap,  { passive: false });
  canvas.addEventListener('touchstart', onTap,  { passive: false });
}

// ===== 釣り判定 =====
function tryHookAt(nx, ny) {
  if (gameState !== 'playing') return;
  if (hookHp <= 0) return;

  const W = canvas.width, H = canvas.height;
  addRipple(nx * W, ny * H);

  // HP消費
  hookHp = Math.max(0, hookHp - currentHook.hookDrain);
  updateHookBar();

  // ループへの当たり判定
  const hookR = (currentHook.bigHook ? 0.095 : 0.072) * Math.min(W, H);
  let best = null, bestD = Infinity;

  yoyos.forEach(y => {
    if (y.caught || !y._loopX) return;
    const dx = y._loopX - nx * W;
    const dy = y._loopY - ny * H;
    const d  = Math.hypot(dx, dy);
    // ループ半径 + フック当たり半径
    if (d < y._loopR + hookR * 1.2 && d < bestD) {
      bestD = d;
      best = y;
    }
  });

  if (best) {
    // 当たり確率（距離・HP依存）
    const hpRatio = hookHp / 100;
    const distRatio = 1 - bestD / (best._loopR + hookR * 1.2);
    const chance = 0.5 + distRatio * 0.35 - (1 - hpRatio) * 0.12;
    if (Math.random() < chance) {
      catchYoyo(best, nx * W, ny * H);
    } else {
      setMsg('惜しい！もう一度！');
      addRipple(nx * W + 5, ny * H - 5);
    }
  } else {
    setMsg('空振り… ループを狙って！');
  }

  // HP切れ
  if (hookHp <= 0) {
    addBreakParticles(nx * W, ny * H);
    setMsg('💥 ホックが折れた！');
    setSpeechBroken();
    gameState = 'broken';
    setTimeout(() => endGame('broken'), 1400);
  }
}

function catchYoyo(y, px, py) {
  caughtYoyos.push(y.type);
  y.caught = true;
  addCatchParticles(px, py, y.type.colorLight);
  addCatchAnim(px, py - 20, `+${y.type.pts}`);
  addRipple(px, py);
  addRipple(px + 10, py - 8);
  document.getElementById('caughtVal').textContent = caughtYoyos.length + '個';
  setMsg(`✨ ${y.type.label}ヨーヨーゲット！ +${y.type.pts}点`);
  setSpeechCatch(y.type);
  setTimeout(() => { yoyos = yoyos.filter(yy => yy.id !== y.id); }, 400);
}

// ===== ゲーム終了 =====
function endGame(reason) {
  gameState = 'done';
  clearInterval(timerInterval);
  cancelAnimationFrame(raf);

  const totalScore = caughtYoyos.reduce((s, t) => s + t.pts, 0);

  document.getElementById('gameCard').style.display = 'none';
  const rs = document.getElementById('resultScreen');
  rs.classList.add('show');

  const title = document.getElementById('resultTitle');
  title.textContent = reason === 'time'
    ? (caughtYoyos.length >= 5 ? '🎉 すごい！' : caughtYoyos.length >= 2 ? '😄 上手！' : '⏰ 時間切れ！')
    : '💥 ホックが折れちゃった！';

  document.getElementById('resultSub').textContent =
    caughtYoyos.length > 0 ? `釣れたヨーヨー ${caughtYoyos.length}個` : '今回は0個… また挑戦してみてね！';

  const list = document.getElementById('resultYoyoList');
  if (caughtYoyos.length > 0) {
    const counts = {};
    caughtYoyos.forEach(t => { counts[t.id] = counts[t.id] || { type: t, n: 0 }; counts[t.id].n++; });
    list.innerHTML = Object.values(counts).map(c =>
      `<span title="${c.type.label}×${c.n}">${c.type.emoji} <sub style="font-size:11px">×${c.n}</sub></span>`
    ).join('');
  } else {
    list.innerHTML = '<span style="font-size:32px">😢</span>';
  }

  document.getElementById('resultScore').textContent = totalScore + '点';
  setSpeechResult(caughtYoyos.length);
}

// ===== 吹き出し制御 =====
function setMsg(txt) {
  const el = document.getElementById('gameMsg');
  if (el) el.textContent = txt;
}
function setSpeech(txt) {
  const el = document.getElementById('speech');
  if (!el) return;
  el.textContent = txt;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'popIn .5s cubic-bezier(.34,1.56,.64,1) both, wiggle 4s ease-in-out 1s infinite';
}
function setSpeechPlaying() {
  const phrases = ['がんばれ〜！', 'もうちょっと！', 'いいね！', 'ループを狙って！'];
  setSpeech(phrases[0]);
  clearInterval(speechTimer);
  let i = 1;
  speechTimer = setInterval(() => {
    if (gameState !== 'playing') { clearInterval(speechTimer); return; }
    setSpeech(phrases[i++ % phrases.length]);
  }, 4000);
}
function setSpeechCatch(type) {
  const msgs = {
    red:     'やったー！赤ゲット！🎈',
    blue:    'おおっ！青だ！🎈',
    yellow:  'いいね！黄色！✨',
    green:   '緑もゲット！😄',
    purple:  'おお〜！紫！すごい！',
    rainbow: '！！虹ヨーヨー！！すごすぎ！！🌈',
  };
  setSpeech(msgs[type.id] || 'ナイス！釣れた！');
}
function setSpeechBroken() { setSpeech('あらら〜折れちゃった💦'); }
function setSpeechResult(n) {
  if (n >= 6) setSpeech('釣り名人だ！🏆');
  else if (n >= 3) setSpeech('上手い！さすが！😄');
  else if (n >= 1) setSpeech('やったね！また来てね！');
  else setSpeech('次は釣れるよ！😊');
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
function darken(hex, amount) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) * amount) | 0;
  const g = Math.max(0, ((n >> 8)  & 0xff) * amount) | 0;
  const b = Math.max(0, (n         & 0xff) * amount) | 0;
  return `rgb(${r},${g},${b})`;
}

// ===== ボタン =====
function bindButtons() {
  function resetOverlay() {
    document.getElementById('gameOverlay').classList.remove('show');
    clearInterval(timerInterval);
    cancelAnimationFrame(raf);
    gameState = 'idle';
    document.getElementById('timerVal').style.color = '';
  }
  document.getElementById('btnAgain').addEventListener('click', () => { if (currentHook) startGame(currentHook); });
  document.getElementById('btnDone').addEventListener('click', () => { resetOverlay(); setSpeech('ヨーヨー釣り、やってみる？🎈'); });
  document.getElementById('btnResultAgain').addEventListener('click', () => { if (currentHook) startGame(currentHook); });
  document.getElementById('btnResultClose').addEventListener('click', () => { resetOverlay(); setSpeech('またね〜！🎈'); });
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  renderHooks();
  bindButtons();
  window.addEventListener('resize', () => { if (canvas) resizeCanvas(); });

  // 待機中 吹き出しローテーション
  const idlePhrases = ['ヨーヨー釣り、やってみる？🎈','ホックを選んでね！😊','何個釣れるかな？','ループを狙うのがコツだよ！'];
  let idleIdx = 0;
  setInterval(() => {
    if (gameState !== 'idle') return;
    idleIdx = (idleIdx + 1) % idlePhrases.length;
    setSpeech(idlePhrases[idleIdx]);
  }, 4500);
});
