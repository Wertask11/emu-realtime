/* =============================================================
   射的 — shageki-app.js
   SchoolPark 開園祭 イベント
============================================================= */

/* ---------- 銃の定義 ---------- */
const GUN_TYPES = [
  {
    id: 'normal',
    icon: '🔫',
    name: 'ふつうの銃',
    desc: '弾10発・標準精度',
    ammo: 10,
    power: 1,        // 的HP減少量
    speed: 0.72,     // 弾速 (0〜1 比率/frame)
    spread: 0.018,   // ブレ幅（正規化座標）
    tag: null,
  },
  {
    id: 'heavy',
    icon: '💥',
    name: 'つよい銃',
    desc: '弾7発・貫通力高い',
    ammo: 7,
    power: 2,
    speed: 0.80,
    spread: 0.022,
    tag: 'パワー',
  },
  {
    id: 'rapid',
    icon: '⚡',
    name: '連射銃',
    desc: '弾14発・連射可能',
    ammo: 14,
    power: 1,
    speed: 0.88,
    spread: 0.028,
    tag: 'オススメ',
  },
  {
    id: 'sniper',
    icon: '🎯',
    name: 'スナイパー',
    desc: '弾5発・超精密',
    ammo: 5,
    power: 3,
    speed: 0.95,
    spread: 0.004,
    tag: null,
  },
];

/* ---------- 的の定義 ---------- */
const TARGET_TYPES = [
  { label:'🔴的', pts:10, hp:1, color:'#e82020' },
  { label:'🔵的', pts:20, hp:1, color:'#2060c8' },
  { label:'🟢的', pts:30, hp:2, color:'#28a820' },  // 強的（HP2）
  { label:'🟠的', pts:50, hp:3, color:'#e88020' },  // ボーナス的（HP3）
];

/* ---------- SVGターゲット要素 ---------- */
const SVG_TARGET_IDS = ['svgTarget0','svgTarget1','svgTarget2','svgTarget3'];

/* ---------- アイドル吹き出し ---------- */
const IDLE_MSGS = [
  '「狙いを定めて！」',
  '「ボーナス的は3発だ！」',
  '「オレンジが高得点！」',
  '「目標に集中！」',
  '「腕前を見せてみい！」',
];

/* ---------- ゲーム状態 ---------- */
let currentGun = null;
let canvas = null, ctx = null;
let W = 0, H = 0;
let targets  = [];
let bullets  = [];
let particles = [];
let flashEffects = [];
let ammoLeft = 0;
let totalScore = 0;
let hitCount   = 0;
let gameRunning = false;
let aimX = 0.5, aimY = 0.5;
let animId = null;
let idleTimer = null;
let msgTimer  = null;

/* ---------- DOM refs ---------- */
const gameOverlay  = document.getElementById('gameOverlay');
const gameCard     = document.getElementById('gameCard');
const resultScreen = document.getElementById('resultScreen');
const hudScore     = document.getElementById('hudScore');
const hudHit       = document.getElementById('hudHit');
const ammoPips     = document.getElementById('ammoPips');
const gameMsg      = document.getElementById('gameMsg');
const playPanel    = document.getElementById('playPanel');
const gunGrid      = document.getElementById('gunGrid');
const speech       = document.getElementById('speech');
const resultTitle  = document.getElementById('resultTitle');
const resultPrizes = document.getElementById('resultPrizes');
const resultScore  = document.getElementById('resultScore');
const resultRank   = document.getElementById('resultRank');
const resultSub    = document.getElementById('resultSub');

/* =====================================================================
   初期化
===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  buildGunCards();
  bindButtons();
  startIdleSpeech();

  window.addEventListener('resize', () => {
    if (canvas) resizeCanvas();
  });
});

/* ---------- 銃カード生成 ---------- */
function buildGunCards() {
  gunGrid.innerHTML = '';
  GUN_TYPES.forEach(g => {
    const card = document.createElement('div');
    card.className = 'gun-card';
    card.innerHTML = `
      ${g.tag ? `<div class="gc-tag">${g.tag}</div>` : ''}
      <div class="gc-icon">${g.icon}</div>
      <div class="gc-name">${g.name}</div>
      <div class="gc-desc">${g.desc}</div>
    `;
    card.addEventListener('click', () => startGame(g));
    gunGrid.appendChild(card);
  });
}

/* ---------- ボタン ---------- */
function bindButtons() {
  document.getElementById('closeBtn').addEventListener('click', closeStall);
  document.getElementById('btnClose2').addEventListener('click', closeStall);
  document.getElementById('btnRetry').addEventListener('click', () => {
    resultScreen.classList.remove('show');
    gameCard.style.display = '';
    playPanel.style.display = '';
    stopGame();
  });
}

/* =====================================================================
   ゲーム開始
===================================================================== */
function startGame(gun) {
  currentGun = gun;
  playPanel.style.display = 'none';
  resultScreen.classList.remove('show');
  gameCard.style.display = '';

  // canvas 取得は毎回 startGame 内で
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  resizeCanvas();
  setupInput();

  ammoLeft   = gun.ammo;
  totalScore = 0;
  hitCount   = 0;
  bullets    = [];
  particles  = [];
  flashEffects = [];
  gameRunning = true;

  buildTargets();
  updateAmmoUI();
  updateHUD();
  setMsg('的を狙ってクリック！');

  gameOverlay.classList.add('show');

  if (animId) cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

/* ---------- ターゲット配置 ---------- */
function buildTargets() {
  targets = [];
  // 下段に4つ配置（画面幅に対する割合で位置を指定）
  const positions = [0.18, 0.38, 0.62, 0.82]; // x比率
  const yRatio    = 0.38; // y比率（上のほう＝的棚）
  TARGET_TYPES.forEach((t, i) => {
    targets.push({
      x:       positions[i],   // 0〜1
      y:       yRatio,
      r:       0.07,           // 当たり判定半径（正規化）
      hp:      t.hp,
      maxHp:   t.hp,
      pts:     t.pts,
      label:   t.label,
      color:   t.color,
      alive:   true,
      hitAnim: 0,              // 被弾アニメフレーム
      fallY:   0,              // 倒れアニメ
      fallen:  false,
    });
  });
}

/* =====================================================================
   Canvas リサイズ
===================================================================== */
function resizeCanvas() {
  const wrap = document.getElementById('rangeWrap');
  if (!wrap || !canvas) return;
  const rect = wrap.getBoundingClientRect();
  canvas.width  = rect.width  * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  W = canvas.width;
  H = canvas.height;
  canvas.style.width  = rect.width  + 'px';
  canvas.style.height = rect.height + 'px';
}

/* =====================================================================
   入力（マウス / タッチ）
===================================================================== */
function setupInput() {
  if (canvas._inputBound) return;
  canvas._inputBound = true;

  // エイム更新
  function onMove(e) {
    if (!gameRunning) return;
    const r = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    aimX = (clientX - r.left) / r.width;
    aimY = (clientY - r.top)  / r.height;
  }

  // 射撃
  function onShoot(e) {
    if (!gameRunning) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const sx = (clientX - r.left) / r.width;
    const sy = (clientY - r.top)  / r.height;
    shoot(sx, sy);
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('touchmove',  onMove,  { passive: true });
  canvas.addEventListener('click',      onShoot);
  canvas.addEventListener('touchend',   onShoot, { passive: false });
}

/* =====================================================================
   射撃処理
===================================================================== */
function shoot(sx, sy) {
  if (!gameRunning || ammoLeft <= 0) return;

  // ブレを加える
  const bx = sx + (Math.random() - 0.5) * currentGun.spread * 2;
  const by = sy + (Math.random() - 0.5) * currentGun.spread * 2;

  // 銃口は下中央から
  bullets.push({
    x: 0.5,
    y: 1.0,
    tx: bx,
    ty: by,
    speed: currentGun.speed,
    power: currentGun.power,
    done: false,
    trail: [],
  });

  ammoLeft--;
  updateAmmoUI();

  // 銃声エフェクト（マズルフラッシュ）
  flashEffects.push({ x: 0.5, y: 0.98, r: 0.04, life: 8, maxLife: 8 });

  // 弾が0になったら数フレーム後に終了
  if (ammoLeft <= 0) {
    setTimeout(() => {
      if (gameRunning) endGame();
    }, 900);
  }
}

/* =====================================================================
   メインループ
===================================================================== */
function loop() {
  if (!gameRunning && bullets.length === 0) return;
  animId = requestAnimationFrame(loop);

  ctx.clearRect(0, 0, W, H);

  drawBackground();
  drawTargets();
  updateAndDrawBullets();
  drawFlashEffects();
  updateAndDrawParticles();
  drawAimSight();
}

/* ---------- 背景 ---------- */
function drawBackground() {
  // 射撃レンジ床
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1e0808');
  grad.addColorStop(1, '#0e0404');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 距離マーク（奥行き感）
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, H * (i * 0.25));
    ctx.lineTo(W, H * (i * 0.25));
    ctx.stroke();
  }

  // 床板
  ctx.fillStyle = 'rgba(120,60,20,0.25)';
  ctx.fillRect(0, H * 0.85, W, H * 0.15);

  // 的台（棚の雰囲気）
  const shelfY = H * 0.20;
  ctx.fillStyle = '#3a1a10';
  ctx.fillRect(W * 0.06, shelfY, W * 0.88, H * 0.07);
  ctx.fillStyle = '#5a3020';
  ctx.fillRect(W * 0.06, shelfY, W * 0.88, H * 0.02);

  // スポットライト
  for (let i = 0; i < 4; i++) {
    const sx = W * (0.18 + i * 0.22);
    const grad2 = ctx.createRadialGradient(sx, 0, 0, sx, H * 0.5, H * 0.6);
    grad2.addColorStop(0, 'rgba(255,240,200,0.10)');
    grad2.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, W, H * 0.5);
  }
}

/* ---------- ターゲット描画 ---------- */
function drawTargets() {
  targets.forEach(t => {
    const cx = t.x * W;
    const cy = (t.fallen ? t.y + t.fallY : t.y) * H;
    const r  = t.r * Math.min(W, H);

    if (!t.alive && t.fallen) {
      // 倒れた的をフェードアウト
      const alpha = Math.max(0, 1 - t.fallY * 15);
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      _drawTarget(t, r * 0.7);
      ctx.restore();
      return;
    }

    // 被弾シェイク
    const shake = t.hitAnim > 0 ? (Math.random() - 0.5) * 4 : 0;
    ctx.save();
    ctx.translate(cx + shake, cy);

    // HP バー（上）
    if (t.alive && t.maxHp > 1) {
      const bw = r * 1.6;
      const bh = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-bw / 2, -r - 10, bw, bh);
      ctx.fillStyle = t.hp / t.maxHp > 0.5 ? '#40e840' : '#e84040';
      ctx.fillRect(-bw / 2, -r - 10, bw * (t.hp / t.maxHp), bh);
    }

    _drawTarget(t, r);
    ctx.restore();

    // 被弾アニメ更新
    if (t.hitAnim > 0) t.hitAnim--;
  });
}

function _drawTarget(t, r) {
  const col = t.color;
  // 的本体（円）
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();

  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();

  ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();

  ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();

  // 点数テキスト
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.round(r * 0.38)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.pts + 'pt', 0, r * 1.6);
}

/* ---------- 弾 ---------- */
function updateAndDrawBullets() {
  bullets = bullets.filter(b => !b.done);

  bullets.forEach(b => {
    // 移動
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const dist = Math.hypot(dx, dy);
    const step = b.speed * 0.05;

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 8) b.trail.shift();

    if (dist < step) {
      b.x = b.tx; b.y = b.ty;
      b.done = true;
    } else {
      b.x += (dx / dist) * step;
      b.y += (dy / dist) * step;
    }

    // トレイル描画
    b.trail.forEach((p, i) => {
      const alpha = (i / b.trail.length) * 0.5;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,80,${alpha})`;
      ctx.fill();
    });

    // 弾本体
    ctx.beginPath();
    ctx.arc(b.x * W, b.y * H, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe080';
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur  = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ヒット判定
    if (!b.done) {
      targets.forEach(t => {
        if (!t.alive) return;
        const tdx = (b.x - t.x) * W;
        const tdy = (b.y - t.y) * H;
        const hr  = t.r * Math.min(W, H);
        if (Math.hypot(tdx, tdy) < hr) {
          b.done = true;
          onHit(t, b);
        }
      });
    }
  });
}

/* ---------- ヒット処理 ---------- */
function onHit(t, b) {
  t.hp -= b.power;
  t.hitAnim = 6;

  // 被弾パーティクル
  spawnParticles(t.x, t.y, t.color, 8);

  if (t.hp <= 0) {
    t.alive  = false;
    t.fallen = true;
    t.fallY  = 0;
    totalScore += t.pts;
    hitCount++;
    setMsg(`💥 +${t.pts}pt！`);
    spawnParticles(t.x, t.y, t.color, 18);
    // SVG ターゲットを傾ける
    const idx = targets.indexOf(t);
    hideSvgTarget(idx);
    // 倒れアニメ
    const fallInterval = setInterval(() => {
      t.fallY += 0.012;
      if (t.fallY > 0.18) clearInterval(fallInterval);
    }, 16);
  } else {
    setMsg(`💫 もう少し！`);
  }
  updateHUD();
}

/* ---------- SVG的を隠す ---------- */
function hideSvgTarget(idx) {
  // canvas は overlay の上なので SVG 的は見えないが念のため
  const el = document.getElementById(SVG_TARGET_IDS[idx]);
  if (el) el.style.opacity = '0.15';
}

/* ---------- マズルフラッシュ ---------- */
function drawFlashEffects() {
  flashEffects = flashEffects.filter(f => f.life > 0);
  flashEffects.forEach(f => {
    const alpha = f.life / f.maxLife;
    const r = f.r * Math.min(W, H) * (1 + (1 - alpha) * 1.5);
    const grad = ctx.createRadialGradient(f.x * W, f.y * H, 0, f.x * W, f.y * H, r);
    grad.addColorStop(0, `rgba(255,240,180,${alpha})`);
    grad.addColorStop(1, `rgba(255,120,0,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(f.x * W, f.y * H, r, 0, Math.PI * 2);
    ctx.fill();
    f.life--;
  });
}

/* ---------- パーティクル ---------- */
function spawnParticles(nx, ny, color, n) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 0.004 + Math.random() * 0.012;
    particles.push({
      x: nx, y: ny,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 0.008,
      r:  2 + Math.random() * 4,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color,
    });
  }
}

function updateAndDrawParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.0004; // gravity
    p.life--;
    const alpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, p.r * alpha, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    ctx.fill();
  });
}

/* ---------- 照準サイト ---------- */
function drawAimSight() {
  if (!gameRunning || ammoLeft <= 0) return;
  const ax = aimX * W;
  const ay = aimY * H;
  const r  = 14;

  ctx.strokeStyle = 'rgba(255,80,80,0.85)';
  ctx.lineWidth   = 1.5;
  // 外円
  ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
  // 十字
  ctx.beginPath();
  ctx.moveTo(ax - r * 1.6, ay); ctx.lineTo(ax - r * 0.4, ay);
  ctx.moveTo(ax + r * 0.4, ay); ctx.lineTo(ax + r * 1.6, ay);
  ctx.moveTo(ax, ay - r * 1.6); ctx.lineTo(ax, ay - r * 0.4);
  ctx.moveTo(ax, ay + r * 0.4); ctx.lineTo(ax, ay + r * 1.6);
  ctx.stroke();
  // 中心点
  ctx.fillStyle = 'rgba(255,80,80,0.9)';
  ctx.beginPath(); ctx.arc(ax, ay, 2, 0, Math.PI * 2); ctx.fill();
}

/* =====================================================================
   ゲーム終了
===================================================================== */
function endGame() {
  gameRunning = false;
  cancelAnimationFrame(animId);
  showResult();
}

function showResult() {
  gameCard.style.display = 'none';
  resultScreen.classList.add('show');

  // 称号
  const maxPts = TARGET_TYPES.reduce((s, t) => s + t.pts, 0);
  let rank = '', sub = '', prizeEmoji = '🎯';
  if (totalScore >= maxPts) {
    rank = '🏆 パーフェクト！全的命中！';
    sub  = '射的の名手だ！景品ゲット！';
    prizeEmoji = '🏆🎁🎯';
  } else if (hitCount >= 3) {
    rank = '🥇 すごい！3的以上ヒット！';
    sub  = 'センスあり！';
    prizeEmoji = '🎁🎯';
  } else if (hitCount >= 1) {
    rank = '🎯 ナイスショット！';
    sub  = 'もう一回挑戦してみよう！';
    prizeEmoji = '🎯';
  } else {
    rank = '😅 惜しい…次は入る！';
    sub  = '諦めずにもう一回！';
    prizeEmoji = '💨';
  }

  resultTitle.textContent  = 'ゲーム終了！';
  resultPrizes.textContent = prizeEmoji;
  resultScore.textContent  = `${totalScore} pt`;
  resultRank.textContent   = rank;
  resultSub.textContent    = sub;
}

/* =====================================================================
   HUD / UI ユーティリティ
===================================================================== */
function updateHUD() {
  hudScore.textContent = totalScore;
  hudHit.textContent   = hitCount;
}

function updateAmmoUI() {
  ammoPips.innerHTML = '';
  for (let i = 0; i < currentGun.ammo; i++) {
    const pip = document.createElement('div');
    pip.className = 'ammo-pip' + (i >= ammoLeft ? ' used' : '');
    ammoPips.appendChild(pip);
  }
}

function setMsg(text) {
  gameMsg.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { gameMsg.textContent = ''; }, 2000);
}

/* =====================================================================
   アイドル吹き出し
===================================================================== */
function startIdleSpeech() {
  let idx = 0;
  function rotate() {
    speech.textContent = IDLE_MSGS[idx % IDLE_MSGS.length];
    idx++;
    idleTimer = setTimeout(rotate, 3500);
  }
  idleTimer = setTimeout(rotate, 2000);
}

/* =====================================================================
   ゲーム停止（リトライ用）
===================================================================== */
function stopGame() {
  gameRunning = false;
  cancelAnimationFrame(animId);
  bullets = []; particles = []; flashEffects = [];
  // SVG的を復元
  SVG_TARGET_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = '';
  });
  gameOverlay.classList.remove('show');
  playPanel.style.display = '';
}

/* =====================================================================
   閉じる
===================================================================== */
function closeStall() {
  stopGame();
  clearTimeout(idleTimer);
  window.parent.postMessage({ type: 'closeShageki' }, '*');
}
