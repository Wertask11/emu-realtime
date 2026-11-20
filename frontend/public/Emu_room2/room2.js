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
/* 星の数をまだ受け取っていない（waiting）／受け取った（ready）／
   本人が分からない・数えられなかった（unknown）。
   0個なのか、数えられなかったのかを区別して伝えるために持つ。 */
let starCountsState = "waiting";
const POSTS_PER_STAR = 10;
const discussionStreaks = {};

/* ───── 背景の夜空（11/20 オーナー：「リアルな星空に」「星空が動くのは残して」） ─────
   本物の夜空と同じく、空全体が天の北極（POLE）のまわりをゆっくり回る（日周運動）。
   記録の星も、背景の星も、天の川も一緒に回る。画面の端で反対側へ飛ぶことはなく、
   地平の山に沈んだ星は、ひと回りしてまた昇ってくる。

   重くしないために、絵は3枚に分けて、画面の大きさが変わったときに1回だけ描く。
     gradLayer    … 空の色（回らない。地平ほど明るい）
     starLayer    … 天の川と星（回る。天の北極を中心にした正方形）
     horizonLayer … 地平の明るみ・かすみと、山と木々の影（回らない。いちばん手前）
   毎フレームは、回した starLayer を貼り、明るい星だけ瞬かせる。 */
let bgStars = [];      // 瞬く明るい星（天の北極からの距離と角度で持つ）
let gradLayer = null, starLayer = null, horizonLayer = null, starLayerSize = 0;
const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
/* ひと回り 8 分。本物（約24時間）だと止まって見えるので、動いているのが分かる速さにする。
   前の「左へ流れる」動き（毎秒 4〜7px ほど）と、記録の星のあたりで同じくらいの速さ */
const SKY_TURN_MS = 8 * 60 * 1000;
const POLE = { x: 0, y: 0 };
let skyAngle = 0;
function skyAngleAt(time) { return REDUCED_MOTION ? 0 : -(time / SKY_TURN_MS) * Math.PI * 2; }
const STAR_TINTS = ["#9db4ff", "#aabfff", "#cad7ff", "#f8f7ff", "#fff4ea", "#ffe7c4", "#ffd2a1", "#ffbe7f"];
/* 本物の星の色の割合（青白は少なく、白〜黄が多く、橙はやや少ない） */
const TINT_WEIGHT = [0.04, 0.08, 0.12, 0.26, 0.2, 0.15, 0.1, 0.05];
function pickTint(r) {
  let acc = 0;
  for (let i = 0; i < TINT_WEIGHT.length; i++) { acc += TINT_WEIGHT[i]; if (r <= acc) return STAR_TINTS[i]; }
  return STAR_TINTS[3];
}
function horizonY(x) {
  /* 地平の稜線（なだらかな山と木々） */
  return H * 0.86 - Math.sin(x / W * Math.PI * 1.3 + 0.6) * H * 0.035 - Math.sin(x / W * Math.PI * 4.1) * H * 0.012;
}
/* 記録の星を置く範囲（天の北極からの距離）。ここに置くと、回っても多くの時間は画面の中にいる */
function recordRadiusMax() {
  /* 星の数が夜空の準備より先に届いたときも、天の北極の位置は決めておく */
  if (!POLE.x) { POLE.x = W * 0.5; POLE.y = H * 0.36; }
  /* スマホ（縦長）は横幅が狭いので、横にはみ出しすぎない大きさに */
  return Math.max(80, Math.min(horizonY(W / 2) - POLE.y - 40, Math.max(W, H) * 0.42, W * 0.6)); }

function initBgStars() {
  POLE.x = W * 0.5; POLE.y = H * 0.36;
  bgStars = [];

  /* 1. 空の色（回らない） */
  gradLayer = document.createElement("canvas");
  gradLayer.width = Math.round(W * DPR); gradLayer.height = Math.round(H * DPR);
  let g = gradLayer.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#02030a");
  sky.addColorStop(0.55, "#060b1d");
  sky.addColorStop(0.82, "#0d1830");
  sky.addColorStop(1, "#1a2238");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  /* 2. 天の川と星（回る）。天の北極を中心に、画面のいちばん遠い角まで届く大きさの正方形に描く */
  const reach = Math.max(Math.hypot(POLE.x, POLE.y), Math.hypot(W - POLE.x, POLE.y),
    Math.hypot(POLE.x, H - POLE.y), Math.hypot(W - POLE.x, H - POLE.y));
  starLayerSize = Math.ceil(reach * 2 + 8);
  const ls = Math.min(DPR, 2800 / starLayerSize);   // 大きすぎる画像にしない（スマホのメモリ）
  starLayer = document.createElement("canvas");
  starLayer.width = Math.round(starLayerSize * ls); starLayer.height = Math.round(starLayerSize * ls);
  g = starLayer.getContext("2d");
  g.setTransform(ls, 0, 0, ls, starLayerSize * ls / 2, starLayerSize * ls / 2);   // (0,0) が天の北極
  /* 天の川の帯：天の北極から少し離れたところを斜めに通る直線のまわり */
  const bandAng = Math.PI * 0.2, bandOff = Math.min(W, H) * 0.32;
  const ux = Math.cos(bandAng), uy = Math.sin(bandAng);           // 帯の向き
  const nx = -uy, ny = ux;                                         // 帯に直角
  const bandWidth = Math.min(W, H) * 0.28;
  const bandDist = (x, y) => Math.abs((x * nx + y * ny) - bandOff) / bandWidth;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 90; i++) {
    const t = (i / 89 - 0.5) * 2 * reach;
    const cx = nx * bandOff + ux * t + (Math.random() - 0.5) * bandWidth * 0.25;
    const cy = ny * bandOff + uy * t + (Math.random() - 0.5) * bandWidth * 0.25;
    const r = Math.min(W, H) * (0.08 + Math.random() * 0.16);
    const warm = Math.abs(t) < reach * 0.3;   // 帯のまん中ほど少し黄みがかる
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0, warm ? "rgba(255,236,210,0.055)" : "rgba(190,205,255,0.045)");
    cg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  for (let i = 0; i < 50; i++) {   // 暗い筋（暗黒星雲）
    const t = (Math.random() - 0.5) * 1.6 * reach;
    const cx = nx * bandOff + ux * t + (Math.random() - 0.5) * bandWidth * 0.1;
    const cy = ny * bandOff + uy * t + (Math.random() - 0.5) * bandWidth * 0.1;
    const r = Math.min(W, H) * (0.02 + Math.random() * 0.06);
    const dg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    dg.addColorStop(0, "rgba(2,3,10,0.35)"); dg.addColorStop(1, "rgba(2,3,10,0)");
    g.fillStyle = dg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  /* 星。暗い星ほど多い（明るさの分布）。天の川の帯の中は密に。円の中に均等に散らす */
  const count = Math.floor(Math.PI * reach * reach / 260);
  const bright = [];
  for (let i = 0; i < count; i++) {
    let rr = reach * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    let x = Math.cos(th) * rr, y = Math.sin(th) * rr;
    if (bandDist(x, y) > 1 && Math.random() < 0.55) { rr = reach * Math.sqrt(Math.random()); th = Math.random() * Math.PI * 2; x = Math.cos(th) * rr; y = Math.sin(th) * rr; }
    const m = Math.pow(Math.random(), 3.2);           // 0（暗い）〜1（明るい）。ほとんどが暗い
    const tint = pickTint(Math.random());
    const r = 0.25 + m * 1.35, a = 0.18 + m * 0.75;
    g.globalAlpha = Math.min(1, a); g.fillStyle = tint;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (m > 0.6) bright.push({ rr, th, r, tint, a, m });
  }
  g.globalAlpha = 1;
  /* 北極星（天の北極のすぐそば。回っても動かない星） */
  g.fillStyle = "#fff6e8"; g.beginPath(); g.arc(0, 0, 1.9, 0, Math.PI * 2); g.fill();
  /* 瞬かせるのは、いちばん明るい星から 160 個まで（毎フレーム描くので数をしぼる） */
  bgStars = bright.sort((p, q) => q.m - p.m).slice(0, 160)
    .map(b => Object.assign(b, { off: Math.random() * Math.PI * 2, spd: 0.0012 + Math.random() * 0.003 }));

  /* 3. 地平（回らない。いちばん手前）。地平に近い星はかすむ → 山と木々の影 */
  horizonLayer = document.createElement("canvas");
  horizonLayer.width = Math.round(W * DPR); horizonLayer.height = Math.round(H * DPR);
  g = horizonLayer.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const haze = g.createLinearGradient(0, H * 0.6, 0, H);
  haze.addColorStop(0, "rgba(13,24,48,0)");
  haze.addColorStop(0.7, "rgba(16,26,48,0.55)");
  haze.addColorStop(1, "rgba(40,52,82,0.8)");
  g.fillStyle = haze; g.fillRect(0, H * 0.6, W, H * 0.4);
  g.fillStyle = "#03050b";
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) {
    let y = horizonY(x);
    /* 木々のぎざぎざ（決まった形にするため、x から作る） */
    const n = Math.sin(x * 0.37) * Math.sin(x * 0.11 + 1.7);
    if (n > 0.55) y -= (n - 0.55) * H * 0.06;
    g.lineTo(x, y);
  }
  g.lineTo(W, H); g.closePath(); g.fill();

  /* 大きさが変わったら、記録の星は新しい天の北極のまわりで角度を取り直す */
  stars.forEach(st => { st.r0 = undefined; });
}

/* 記録の星を、空と一緒に回す。初めて見る星は、いまの位置から天の北極までの距離と角度を覚える */
function placeOnSky(star) {
  if (star.r0 === undefined) {
    star.r0 = Math.hypot(star.x - POLE.x, star.y - POLE.y);
    star.a0 = Math.atan2(star.y - POLE.y, star.x - POLE.x) - skyAngle;
  }
  star.x = POLE.x + Math.cos(star.a0 + skyAngle) * star.r0;
  star.y = POLE.y + Math.sin(star.a0 + skyAngle) * star.r0;
}

/* 流れ星（ときどき）。動きを減らす設定では出さない */
let meteor = null, nextMeteorAt = 0;
function drawMeteor(time) {
  if (REDUCED_MOTION) return;
  if (!meteor && time > nextMeteorAt) {
    if (nextMeteorAt) {
      const x = W * (0.2 + Math.random() * 0.7), y = H * (0.05 + Math.random() * 0.3);
      const ang = Math.PI * (0.72 + Math.random() * 0.12);
      meteor = { x, y, dx: Math.cos(ang), dy: Math.sin(ang), start: time, life: 700 + Math.random() * 500, len: 120 + Math.random() * 120 };
    }
    nextMeteorAt = time + 9000 + Math.random() * 16000;
  }
  if (!meteor) return;
  const p = (time - meteor.start) / meteor.life;
  if (p >= 1) { meteor = null; return; }
  const dist = p * meteor.len * 2.4;
  const hx = meteor.x + meteor.dx * dist, hy = meteor.y + meteor.dy * dist;
  const tx = hx - meteor.dx * meteor.len, ty = hy - meteor.dy * meteor.len;
  const grad = ctx.createLinearGradient(hx, hy, tx, ty);
  const a = Math.sin(p * Math.PI);
  grad.addColorStop(0, "rgba(255,255,255," + (0.9 * a).toFixed(3) + ")");
  grad.addColorStop(1, "rgba(160,190,255,0)");
  ctx.save(); ctx.strokeStyle = grad; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.restore();
}

// ページ読み込み時に初期化
window.addEventListener("load", () => {
  resize();         // W/height を先に確定
  loadState();
  loadUserName();
  initBgStars();
  seedHistoryStars(); // 初回のみ既存履歴を反映（resize後に実行）
  render(); // アニメーションループ開始
});

window.addEventListener("resize", () => { resize(); initBgStars(); });

/* 画面の大きさ（CSS ピクセル）。描くのはこの座標で、キャンバスの実寸は画面の細かさ（devicePixelRatio）ぶん大きくする。
   前は実寸＝CSS ピクセルだったので、スマホや高精細の画面で星がぼやけていた。 */
let W = window.innerWidth, H = window.innerHeight, DPR = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ==========================
   User Name Management
========================== */
function loadUserName() {
  /* 新Emuのプロフィール名（ches_name）を正とする。
     星空だけ別の名前を持つと、同じ人が2つの名前で表示されてしまう。 */
  const chesName = localStorage.getItem('ches_name');
  const savedName = chesName || localStorage.getItem(USER_NAME_KEY);
  userNameDisplay.textContent = savedName ? `🌟 ${savedName}` : "🌟 名前を設定する";
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
/* 星は端末に残さない。

   これまでは room2_stars / room2_links / room2_postCount に星を書き、
   次に開いたときそれを読み直していた。端末に残す以上、そこには
   「誰の星か」が無い。同じ端末を家族や友人と使うと、前の人の星空が
   そのまま次の人に見えてしまう。

   いまは親（Emu本体）が、パスポート本人の実データから星の数を数えて
   EMU_STAR_COUNTS で送ってくる。開くたびに数え直すので、端末に
   残しておく必要がそもそも無い。保存はやめ、古い記録は消す。 */
const ROOM2_LEGACY_KEYS = ["room2_stars", "room2_links", "room2_postCount", "room2_history_seeded_v1"];

function saveState() {
  /* 何もしない。星の正は親が数える実データで、ここは映すだけ。
     呼び出し元が多いので、関数そのものは残す。 */
}

function loadState() {
  /* 前の人の星空を映さないよう、端末に残っていた星は捨てる。 */
  try { ROOM2_LEGACY_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  stars = [];
  links = [];
  postCount = 0;
  starCountsState = "waiting";
  updateStarList();
}

/* ==========================
   初期履歴データ注入（初回のみ）
   Firebaseの実績: 投稿44件・NFT交換7回・3日連続1回・学びコンテンツ2回
========================== */
/* 親（新Emu）が数えた実データで、星を並べ直す。
   これまでは 2026年時点の実績を書き込んだ固定値で、
   誰がログインしても同じ14個が出ていた。
   種類ごとの見た目は今までのものを引き継ぐ。 */
const STAR_LOOK = {
  post:       { power: 10, baseColor: '#ffffff', baseRadius: 3 },
  nft:        { power: 50, baseColor: '#4da3ff', baseRadius: 7 },
  discussion: { power: 20, baseColor: '#ffd166', baseRadius: 5 },
  learning:   { power: 30, baseColor: '#ff6b6b', baseRadius: 5 },
  change:     { power: 30, baseColor: '#c084fc', baseRadius: 5 }
};

/* クエスト星 ── 完走したクエストの星。色はギルドの色そのまま。

   ギルドの色（guild-store.js の accent）は、白い紙の上で読む前提で選ばれている。
   WORK(#141310) と WEB3(#3B382F) は夜空に置くとほとんど沈んで見えない。
   色を明るく作り変えると「ギルドの色」ではなくなるので、色はそのままにして、
   明るい縁で形だけを見せる。ギルドごとに縁の有無が変わると
   そちらが意味を持って見えてしまうので、縁は全ギルドに同じものを付ける。

   どのギルドが何色かは、親（Emu本体）が送ってくる。ここに色の表は持たない。
   持つと、ギルドが増えたときに2か所を直すことになる。 */
const QUEST_STAR_OUTLINE = 'rgba(244,241,234,.6)';
const QUEST_STAR_LOOK = { power: 30, baseRadius: 5 };
/* 限定星。運営が配る、完走とは別の星。
   クエスト星より大きく、縁を明るくして見分けられるようにする。
   色は親が決めて送ってくる（催しごとに変えられる）。 */
const LIMITED_STAR_OUTLINE = 'rgba(255,255,255,.85)';
const LIMITED_STAR_LOOK = { power: 45, baseRadius: 8 };

/* 種類（quest:<ギルドID>）→ 呼び名と色。一覧とシェアの文面で使う。
   受け取るたびに作り直すので、前のギルドが残ることはない。 */
let questStarLook = [];

function applyRealStarCounts(counts) {
  /* 受け取れなかったとき（ログインが確かめられない・通信が届かない）は、
     数を作らない。前に映っていた星も残さない。
     残すと、それが自分の記録だと読めてしまう。 */
  if (!counts) {
    stars.length = 0;
    links.length = 0;
    postCount = 0;
    questStarLook = [];
    starCountsState = "unknown";
    try { updateStarList(); } catch (e) {}
    return;
  }
  const now = performance.now();
  const w = W  || window.innerWidth;
  const h = H || window.innerHeight;

  stars.length = 0;
  links.length = 0;
  postCount = 0;

  let n = 0;
  const place = function (type, look, num) {
    for (let i = 0; i < num; i++) {
      const rr = 40 + Math.sqrt(Math.random()) * (recordRadiusMax() - 40), th = Math.random() * Math.PI * 2;
      const polar = { x: POLE.x + Math.cos(th) * rr, y: POLE.y + Math.sin(th) * rr };
      const star = createStar(Object.assign({ type: type }, look, {
        /* 天の北極のまわりに置く（空と一緒に回るので、四角ではなく円の中） */
        x: polar.x,
        y: polar.y
      }));
      n++;
      star.birthAt   = now - 2000 - n * 120;
      star.createdAt = star.birthAt;
      stars.push(star);
    }
  };

  Object.keys(STAR_LOOK).forEach(function (type) {
    place(type, STAR_LOOK[type], Math.max(0, Number(counts[type] || 0)));
  });

  /* ギルドごとのクエスト星。ギルドの数も色も親が決めるので、
     ここは届いたぶんだけ素直に置く。 */
  questStarLook = [];
  (Array.isArray(counts.guilds) ? counts.guilds : []).forEach(function (g) {
    g = g || {};
    const key = String(g.key || '');
    const color = /^#[0-9A-Fa-f]{6}$/.test(String(g.color || '')) ? g.color : '';
    const num = Math.max(0, Number(g.count || 0));
    if (!key || !color || !num) return;
    questStarLook.push({ key: key, label: String(g.label || 'クエスト星'), color: color });
    place(key, Object.assign({}, QUEST_STAR_LOOK, {
      baseColor: color, outline: QUEST_STAR_OUTLINE
    }), num);
  });

  /* 限定星。ギルド星と同じで、種類も色も親が決める。
     届いたぶんだけ素直に置く。 */
  (Array.isArray(counts.limited) ? counts.limited : []).forEach(function (g) {
    g = g || {};
    const key = String(g.key || '');
    const color = /^#[0-9A-Fa-f]{6}$/.test(String(g.color || '')) ? g.color : '';
    const num = Math.max(0, Number(g.count || 0));
    if (!key || !color || !num) return;
    questStarLook.push({ key: key, label: String(g.label || '限定星'), color: color });
    place(key, Object.assign({}, LIMITED_STAR_LOOK, {
      baseColor: color, outline: LIMITED_STAR_OUTLINE
    }), num);
  });

  /* ここは「足す」ではなく「置き換える」。上で stars を空にしてから
     受け取った数だけ作り直しているので、同じ数を二度受け取っても
     星が2倍になることはない。 */
  starCountsState = "ready";
  try { updateStarList(); } catch (e) {}
}

function seedHistoryStars() {
  /* 以前はここで星を14個つくって置いていた。
     「投稿44件・NFT交換7回・3日連続1回・学び2回」という、
     2026年時点の誰か一人の実績を書き写した固定値で、
     誰がログインしても、まだ何もしていない人にも同じ14個が出ていた。

     星空は「この人が何をしてきたか」を映す場所なので、
     やっていないことを星にしてはいけない。作るのをやめる。
     星の数は親（Emu本体）が実データから数えて送ってくる。 */
}


/* ==========================
   Star & Link Logic
========================= */
function createStar({ type, power, baseColor, baseRadius, projectId = null, outline = null, x, y }) {
  return {
    id: crypto.randomUUID(),
    type,
    x: x ?? Math.random() * W,
    y: y ?? Math.random() * H,
    vx: -0.04 - Math.random() * 0.08,
    vy: (Math.random() - 0.5) * 0.015,
    baseColor,
    color: baseColor,
    /* 暗い色の星に付ける明るい縁。付いていない星（これまでの5種類）は null。 */
    outline,
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
      x: 80 + Math.random() * (W - 160),
      y: 80 + Math.random() * (H - 160),
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
      x: 80 + Math.random() * (W - 160),
      y: 80 + Math.random() * (H - 160),
      startedAt: performance.now()
    };
  }
  const pos = { x: pendingBirth.x, y: pendingBirth.y };
  if (pendingBirth.type === "post") postAction(pos);
  pendingBirth = null;
  updateStarList();
}

function spawnNFTStar() {
  const x = 80 + Math.random() * (W - 160);
  const y = 80 + Math.random() * (H - 160);
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
      x: 80 + Math.random() * (W - 160),
      y: 80 + Math.random() * (H - 160),
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
  if (gradLayer) ctx.drawImage(gradLayer, 0, 0, W, H);
  if (starLayer) {
    ctx.save();
    ctx.translate(POLE.x, POLE.y); ctx.rotate(skyAngle);
    ctx.drawImage(starLayer, -starLayerSize / 2, -starLayerSize / 2, starLayerSize, starLayerSize);
    ctx.restore();
  }
  /* 明るい星だけ、大気のゆらぎで瞬く。動きを減らす設定では止める */
  bgStars.forEach(st => {
    const x = POLE.x + Math.cos(st.th + skyAngle) * st.rr, y = POLE.y + Math.sin(st.th + skyAngle) * st.rr;
    if (x < -10 || x > W + 10 || y < -10 || y > H) return;
    const flicker = REDUCED_MOTION ? 0 : Math.sin(time * st.spd + st.off) * 0.22 + Math.sin(time * st.spd * 2.7 + st.off) * 0.08;
    ctx.save();
    ctx.globalAlpha = Math.max(0.1, Math.min(1, st.a * 0.55 + flicker));
    const halo = ctx.createRadialGradient(x, y, 0, x, y, st.r * 4.5);
    halo.addColorStop(0, st.tint); halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, st.r * 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawHorizon() {
  if (horizonLayer) ctx.drawImage(horizonLayer, 0, 0, W, H);
}

function drawMilkyWay() {
  /* 天の川は、回る星の絵（starLayer）に描き込んである */
}

/* あなたの記録の星座線。同じ種類の星どうしを、近い順に細い線でつなぐ（星座のように見せる）。
   種類ごとに1本の木（最小全域木）にするので、線が交差しすぎない。並びが変わらない限り作り直さない。 */
let constellationCache = { sig: "", lines: [] };
function constellationLines() {
  const sig = stars.length + ":" + stars.map(st => st.id).join(",");
  if (constellationCache.sig === sig) return constellationCache.lines;
  const byType = {};
  stars.forEach(st => { (byType[st.type] = byType[st.type] || []).push(st); });
  const lines = [];
  Object.keys(byType).forEach(type => {
    const list = byType[type];
    if (list.length < 2) return;
    const inTree = [list[0]], rest = list.slice(1);
    while (rest.length) {
      let best = null, bi = -1, bd = Infinity;
      inTree.forEach(a => rest.forEach((b, i) => { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = [a, b]; bi = i; } }));
      /* 遠すぎる星どうしはつながない（画面を横切る線は星座に見えない） */
      if (bd < Math.min(W, H) * 0.32) lines.push({ a: best[0], b: best[1], color: best[0].baseColor });
      inTree.push(rest.splice(bi, 1)[0]);
    }
  });
  constellationCache = { sig, lines };
  return lines;
}
function drawConstellations(time) {
  const lines = constellationLines();
  if (!lines.length) return;
  ctx.save();
  ctx.lineWidth = 0.8;
  lines.forEach(l => {
    ctx.globalAlpha = 0.22 + (REDUCED_MOTION ? 0 : Math.sin(time * 0.0006) * 0.04);
    ctx.strokeStyle = l.color || "rgba(180,200,255,1)";
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
  });
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
  ctx.clearRect(0, 0, W, H);

  // 1〜2. 夜空（空の色・回る天の川と星）と、瞬く明るい星。記録の星も空と一緒に回す
  skyAngle = skyAngleAt(time);
  stars.forEach(placeOnSky);
  drawMilkyWay();
  drawBgStars(time);
  drawMeteor(time);

  // 3. 予兆エフェクト
  drawPendingBirth(time);
  if (!pendingBirth) {
    const hintEl = document.getElementById("birthHint");
    if (hintEl) hintEl.classList.remove("active");
  }

  // 4. 星座線（これまでの線と、同じ種類の星をつなぐ星座）
  drawLinks();
  drawConstellations(time);

  // 5. 動的な星（アクション記録）
  stars.forEach(star => {
    /* 本物の星は横に流れていかない。前は左へ流れて画面の端で反対側へ飛んでいた。
       位置は動かさず、瞬きと光の強さで生きているように見せる。 */

    const age = time - star.birthAt;
    const progress = Math.min(age / star.birthDuration, 1);
    const twinkle = REDUCED_MOTION ? 0 : Math.sin((time - star.createdAt) * 0.0016 + star.x) * 0.3;
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

    /* 明るい縁（クエスト星だけ）。
       ギルドの色は夜空に沈むものがあるので、色は変えずに輪郭で形を見せる。
       これまでの5種類は outline を持たないので、見た目は変わらない。 */
    if (star.outline) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, progress);
      ctx.strokeStyle = star.outline;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(star.x, star.y, Math.max(2, auraSize * 0.62), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // クロス（十字）スパーク（大きい星のみ）
    /* 光の筋（回折の十字）は、本物の夜空と同じく、いちばん明るい星（体験星・限定星）だけに付ける。
       前は大きさ5以上の星すべてに長い十字が付いていて、星が多い人ほど画面が十字だらけになっていた。 */
    if (star.baseRadius >= 7 && progress > 0.5) {
      const sparkLen = auraSize * (W < 600 ? 1.2 : 1.6);
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

  // 6. 地平（山と木々の影）。いちばん手前に置き、沈んでいく星を隠す
  drawHorizon();

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
    /* 「まだ0個」と「数えられなかった」は別のこと。
       数えられなかったのに0個と書くと、記録が消えたように読めてしまう。 */
    let body;
    if (starCountsState === "waiting") {
      body = '<div style="font-size:11px;color:#8899bb;">記録を読み込んでいます…</div>';
    } else if (starCountsState === "unknown") {
      body = '<div style="font-size:11px;color:#8899bb;">記録を読み込めませんでした</div>'
           + '<div style="font-size:10px;color:#667799;margin-top:4px;">ログインの状態と通信を確かめて、開き直してください</div>';
    } else {
      body = '<div style="font-size:11px;color:#8899bb;">まだ星がありません</div>'
           + `<div style="font-size:10px;color:#667799;margin-top:4px;">投稿${remaining}回で最初の星が生まれる</div>`;
    }
    starInfoUI.innerHTML = `
      <div style="text-align:left;font-family:sans-serif;">
        <strong style="color:#c8d8ff;display:block;margin-bottom:6px;font-size:12px;">🌌 あなたの星座</strong>
        ${body}
      </div>`;
    return;
  }

  const counts = stars.reduce((acc, star) => {
    acc[star.type] = (acc[star.type] || 0) + 1;
    return acc;
  }, {});

  let html = `<div style="text-align:left;font-family:sans-serif;font-size:12px;">`;
  html += `<strong style="color:#c8d8ff;border-bottom:1px solid rgba(140,170,255,0.25);display:block;margin-bottom:5px;padding-bottom:3px;font-size:12px;">🌌 あなたの星座記録</strong>`;
  /* 新Emuの行動に合わせた呼び名。
     post→知識星（誰かの役に立った）／nft→体験星（いま持っている体験チケット）
     discussion→議論星（議論の結論を残した日数）／learning→学び星（受け取った学び）
     change→改善星（誰かの知識を良くした） */
  if (counts.post)       html += `<div style="color:#e8eeff;">⚪ 知識星 <span style="float:right;color:#aabbdd;">${counts.post}</span></div>`;
  if (counts.nft)        html += `<div style="color:#e8eeff;">🔵 体験星 <span style="float:right;color:#4da3ff;">${counts.nft}</span></div>`;
  if (counts.discussion) html += `<div style="color:#e8eeff;">🟡 議論星 <span style="float:right;color:#ffd166;">${counts.discussion}</span></div>`;
  if (counts.learning)   html += `<div style="color:#e8eeff;">🔴 学び星 <span style="float:right;color:#ff6b6b;">${counts.learning}</span></div>`;
  if (counts.change)     html += `<div style="color:#e8eeff;">🟣 改善星 <span style="float:right;color:#c084fc;">${counts.change}</span></div>`;
  /* クエスト星 ── ギルドごと。色の丸は絵文字では出せないので、
     夜空と同じ色の点に、同じ明るい縁を付けて並べる。 */
  questStarLook.forEach(function (g) {
    const num = counts[g.key];
    if (!num) return;
    html += `<div style="color:#e8eeff;">`
      + `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;`
      + `background:${g.color};box-shadow:0 0 0 1px ${QUEST_STAR_OUTLINE};margin-right:5px;"></span>`
      + `${g.label} <span style="float:right;color:#aabbdd;">${num}</span></div>`;
  });
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
  if (white > 0)  parts.push(`⚪ 知識星×${white}`);
  if (blue > 0)   parts.push(`🔵 体験星×${blue}`);
  if (yellow > 0) parts.push(`🟡 議論星×${yellow}`);
  if (red > 0)    parts.push(`🔴 学び星×${red}`);
  const purple = counts.change || 0;
  if (purple > 0) parts.push(`🟣 改善星×${purple}`);
  /* クエスト星も合計に入っているので、内訳にも出す。
     出さないと「合計だけ多い」文面になる。 */
  questStarLook.forEach(function (g) {
    const num = counts[g.key] || 0;
    if (num > 0) parts.push(`⭐ ${g.label}×${num}`);
  });

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

/* 星空へ直接来たとき（?star=1）は、入口の選択画面を出さずにそのまま見せる。
   選ぶ先が星空しかないのに一枚挟むと、余計な一手間になる。 */
/* 入口の選択画面は最初から出していないので、ここで消す必要はない。
   ECHO FIELD から戻ったときだけ JS が表示する。 */

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
    case "EMU_OPEN_STAR":
      /* 親から「星空を開いて」と言われたとき。
         URLのクエリは配信サーバーに落とされることがあるので、
         こちらの合図を正とする。 */
      try { openStarMode(); } catch (e) {}
      break;
    case "EMU_STAR_COUNTS":
      /* 親（新Emu）が数えた実データ。固定値の代わりにこれを映す。 */
      applyRealStarCounts(action.counts);
      break;
    case "STREAK_3DAY":
      handleDiscussionStreak(action.projectId || "default");
      break;
    default:
      console.log("ℹ️ その他のアクション:", action.type);
  }
});
