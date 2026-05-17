// かき氷屋台 - インタラクティブロジック

const VARIANTS = [
  {
    id: 'ichigo',
    name: 'いちご',
    price: 500,
    badge: '看板',
    color: '#e8336a',
    syrupColor: '#e8336a',
    syrupLight: '#ff9bb5',
    description: '甘酸っぱい王道いちご',
    toppingLabel: 'いちごをひとつ添えて'
  },
  {
    id: 'matcha',
    name: '抹茶',
    price: 600,
    badge: null,
    color: '#3a8a3a',
    syrupColor: '#3a8a3a',
    syrupLight: '#8ac060',
    description: '宇治抹茶のほろ苦さ',
    toppingLabel: '白玉と粒あんをトッピング'
  },
  {
    id: 'blue',
    name: 'ブルーハワイ',
    price: 650,
    badge: '夏限定',
    color: '#2a6fdb',
    syrupColor: '#2a6fdb',
    syrupLight: '#7ec0e8',
    description: '南国フレーバー、ひんやり爽快',
    toppingLabel: 'パイナップルをのせて'
  },
  {
    id: 'milk-ichigo',
    name: '練乳いちご',
    price: 700,
    badge: 'NEW',
    color: '#ff7a9c',
    syrupColor: '#ff7a9c',
    syrupLight: '#ffd6e0',
    description: 'いちご＋濃厚ミルク',
    toppingLabel: 'とろり練乳を、たっぷり…'
  }
];

// ===== メニュー用ミニイラスト =====
function variantBowlSvg(v) {
  let topping = '';
  switch (v.id) {
    case 'ichigo':
      topping = `
        <!-- いちご -->
        <g transform="translate(0 -26)">
          <path d="M-5 -2 q5 -7 10 0 q4 8 -2 12 q-3 4 -8 2 q-6 -4 -2 -14z" fill="#e8336a" stroke="#9a1f1a" stroke-width=".7"/>
          <path d="M-3 -3 q3 -3 7 -1 q-2 -3 -7 1z" fill="#3a8a3a"/>
          <circle cx="-2" cy="4" r=".4" fill="#fdf6e3"/>
          <circle cx="3" cy="2" r=".4" fill="#fdf6e3"/>
          <circle cx="0" cy="6" r=".4" fill="#fdf6e3"/>
        </g>`;
      break;
    case 'matcha':
      topping = `
        <!-- 白玉団子 -->
        <circle cx="-6" cy="-22" r="3.5" fill="#fdf6e3" stroke="#c9a878" stroke-width=".5"/>
        <circle cx="6"  cy="-26" r="3.5" fill="#fdf6e3" stroke="#c9a878" stroke-width=".5"/>
        <ellipse cx="-7" cy="-23" rx="1" ry=".7" fill="#fff" opacity=".8"/>
        <ellipse cx="5"  cy="-27" rx="1" ry=".7" fill="#fff" opacity=".8"/>
        <!-- 粒あん -->
        <g fill="#5a2a1a">
          <ellipse cx="2"  cy="-20" rx="2" ry="1.5"/>
          <ellipse cx="-2" cy="-18" rx="2" ry="1.5"/>
          <ellipse cx="6"  cy="-18" rx="1.5" ry="1.2"/>
        </g>`;
      break;
    case 'blue':
      topping = `
        <!-- パイナップル -->
        <g transform="translate(0 -26)">
          <ellipse cx="0" cy="0" rx="6" ry="3.5" fill="#ffe25b" stroke="#a88810" stroke-width=".7"/>
          <line x1="-4" y1="-1" x2="-4" y2="1" stroke="#a88810" stroke-width=".5"/>
          <line x1="0" y1="-1.5" x2="0" y2="1.5" stroke="#a88810" stroke-width=".5"/>
          <line x1="4" y1="-1" x2="4" y2="1" stroke="#a88810" stroke-width=".5"/>
        </g>`;
      break;
    case 'milk-ichigo':
      topping = `
        <!-- 練乳ドリップ -->
        <path d="M-18 -12 q4 -6 8 0 q-2 4 -8 0z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".4" opacity=".95"/>
        <path d="M0   -14 q4 -6 8 0 q-2 4 -8 0z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".4" opacity=".95"/>
        <path d="M-12 -22 q3 -5 6 0 q-1 3 -6 0z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".4" opacity=".95"/>
        <!-- いちご飾り -->
        <g transform="translate(8 -26)">
          <path d="M-4 -1 q4 -5 8 0 q3 6 -2 9 q-3 3 -6 1 q-5 -3 0 -10z" fill="#e8336a" stroke="#9a1f1a" stroke-width=".6"/>
          <path d="M-2 -2 q3 -2 6 -1" stroke="#3a8a3a" stroke-width=".8"/>
        </g>`;
      break;
  }

  return `
    <svg viewBox="-40 -40 80 80" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg-${v.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e8f4ff" stop-opacity=".95"/>
          <stop offset="1" stop-color="#b5d8f0" stop-opacity=".75"/>
        </linearGradient>
      </defs>
      <!-- ガラス器 -->
      <path d="M-22 -4 q22 4 44 0 q-4 18 -22 20 q-18 -2 -22 -20 z" fill="url(#bg-${v.id})" stroke="#5a90b8" stroke-width="1.2"/>
      <rect x="-3" y="16" width="6" height="6" fill="#9bc3dc" opacity=".7"/>
      <ellipse cx="0" cy="24" rx="14" ry="3" fill="#5a90b8" opacity=".5"/>
      <!-- 氷の山 -->
      <path d="M-22 -4 q-4 -18 8 -28 q6 -10 14 -8 q12 -4 20 4 q8 12 4 24 q4 6 -2 8 q-22 4 -44 0 z" fill="#ffffff"/>
      <!-- 影 -->
      <path d="M-18 -6 q-2 -10 6 -16 q4 4 -2 12 q-2 4 -4 4z" fill="#d9eaf5" opacity=".75"/>
      <path d="M10 -12 q4 -6 10 -2 q-2 6 -6 8 z" fill="#d9eaf5" opacity=".75"/>
      <!-- シロップ -->
      <path d="M-18 -14 q14 -10 26 -6 q4 6 -2 8 q-6 -2 -10 4 q-8 -2 -14 -6z" fill="${v.syrupColor}" opacity=".82"/>
      <path d="M-10 -22 q6 -6 14 -2 q2 4 -2 6 q-6 0 -12 -4z" fill="${v.syrupColor}" opacity=".62"/>
      <path d="M-6 -28 q4 -4 9 0 q1 3 -2 5 q-4 0 -7 -5z" fill="${v.syrupLight}" opacity=".7"/>
      ${topping}
    </svg>`;
}

// ===== メニュー描画 =====
function renderMenu() {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = VARIANTS.map(v => `
    <div class="menu-card" data-id="${v.id}" role="button" tabindex="0">
      ${v.badge ? `<span class="tag" style="background:${v.color}">${v.badge}</span>` : ''}
      ${variantBowlSvg(v)}
      <div class="name">${v.name}</div>
      <div class="price">¥${v.price}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.menu-card').forEach(card => {
    const id = card.dataset.id;
    const start = () => {
      const v = VARIANTS.find(x => x.id === id);
      if (v) startCooking(v);
    };
    card.addEventListener('click', start);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
    });
  });
}

// ===== 調理アニメーション =====
const COOK_STEPS = [
  { t: 0,    msg: '氷をセット中…',           progress: 8  },
  { t: 700,  msg: 'シャリシャリ削ります…',     progress: 32 },
  { t: 1900, msg: 'ふんわり盛り付け…',         progress: 56 },
  { t: 2700, msg: 'シロップをかけて…',         progress: 78 },
  { t: 3500, msg: null /* variant.toppingLabel */, progress: 94 },
  { t: 4300, msg: 'はい、お待たせ！',           progress: 100 }
];

function cookingSvg(v) {
  // Pre-generate random flake positions
  const flakes = [...Array(18)].map((_,i) => {
    const dir = Math.random() > .5 ? -1 : 1;
    const fx = (10 + Math.random() * 30) * dir;
    const fx2 = fx * 1.4;
    const delay = Math.random() * .8;
    return { fx, fx2, delay, size: .8 + Math.random() * .8 };
  });

  return `
    <svg viewBox="0 0 360 290" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ck-ice" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e6f4ff"/>
          <stop offset=".5" stop-color="#b5e3ff"/>
          <stop offset="1" stop-color="#7ec0e8"/>
        </linearGradient>
        <linearGradient id="ck-mac" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e84a3a"/>
          <stop offset="1" stop-color="#9a2018"/>
        </linearGradient>
        <linearGradient id="ck-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e8f4ff" stop-opacity=".95"/>
          <stop offset="1" stop-color="#b5d8f0" stop-opacity=".75"/>
        </linearGradient>
        <g id="ck-snowflake">
          <line x1="0" y1="-3" x2="0" y2="3" stroke="#fff" stroke-width=".8"/>
          <line x1="-3" y1="0" x2="3" y2="0" stroke="#fff" stroke-width=".8"/>
          <line x1="-2" y1="-2" x2="2" y2="2" stroke="#fff" stroke-width=".5"/>
          <line x1="-2" y1="2" x2="2" y2="-2" stroke="#fff" stroke-width=".5"/>
        </g>
      </defs>

      <!-- 雰囲気の冷気（背景） -->
      <g id="cookCool" style="opacity:0">
        ${[80, 180, 280].map((x,i)=>`
          <path d="M${x-30} 40 q30 -10 60 0"
                stroke="#b5e3ff" stroke-width="1.4" fill="none" opacity=".6"
                style="animation: coolBreath 2.2s ${.3*i}s ease-in-out infinite;"/>
          <path d="M${x-25} 50 q25 -6 50 0"
                stroke="#b5e3ff" stroke-width="1" fill="none" opacity=".5"
                style="animation: coolBreath 2.6s ${.3*i+.4}s ease-in-out infinite;"/>
        `).join('')}
      </g>

      <!-- ===== かき氷機 (中央) ===== -->
      <g id="cookMachine" transform="translate(180 0)">
        <!-- クランプ -->
        <g id="cookClamp">
          <rect x="-30" y="50" width="60" height="14" rx="3" fill="#9a8a78" stroke="#3a1d0a" stroke-width="2"/>
          <circle cx="0" cy="42" r="6" fill="#9a8a78" stroke="#3a1d0a" stroke-width="2"/>
          <line x1="-4" y1="42" x2="4" y2="42" stroke="#3a1d0a" stroke-width="1.5"/>
          <line x1="0" y1="38" x2="0" y2="46" stroke="#3a1d0a" stroke-width="1.5"/>
        </g>

        <!-- 氷ブロック -->
        <g id="cookIce" style="transform-origin: 0 70px;">
          <rect x="-30" y="64" width="60" height="38" rx="3" fill="url(#ck-ice)" stroke="#5a90b8" stroke-width="2"/>
          <!-- ハイライト -->
          <line x1="-24" y1="70" x2="-6" y2="70" stroke="#fff" stroke-width="2" opacity=".9"/>
          <line x1="-26" y1="78" x2="-14" y2="78" stroke="#fff" stroke-width="1.4" opacity=".7"/>
          <line x1="10" y1="74" x2="22" y2="74" stroke="#fff" stroke-width="1.4" opacity=".7"/>
          <!-- 氷の罅 -->
          <path d="M0 80 l4 6 l-2 4" stroke="#9bc3dc" stroke-width="1" fill="none" opacity=".5"/>
          <path d="M-12 88 l-2 6" stroke="#9bc3dc" stroke-width="1" fill="none" opacity=".5"/>
        </g>

        <!-- 機械本体 -->
        <g>
          <!-- 上部チャンバー -->
          <rect x="-44" y="102" width="88" height="20" rx="4" fill="url(#ck-mac)" stroke="#4a0e0a" stroke-width="2"/>
          <!-- 本体 -->
          <rect x="-50" y="122" width="100" height="50" rx="6" fill="url(#ck-mac)" stroke="#4a0e0a" stroke-width="2"/>
          <!-- 銘板 -->
          <rect x="-28" y="132" width="56" height="22" rx="3" fill="#fdf6e3"/>
          <text x="0" y="148" text-anchor="middle" font-size="14" font-weight="900" fill="#c8302a">氷</text>
          <!-- スイッチ -->
          <circle cx="-38" cy="162" r="3.5" fill="#3a1d0a"/>
          <circle cx="-38" cy="162" r="1.8" fill="#ffd054"/>
          <circle cx="38"  cy="162" r="3.5" fill="#3a1d0a"/>
          <!-- 出口 -->
          <rect x="-32" y="170" width="64" height="8" rx="3" fill="#4a0e0a"/>
        </g>

        <!-- クランクハンドル（回転する） -->
        <g transform="translate(58 130)">
          <circle cx="0" cy="0" r="5" fill="#3a1d0a"/>
          <g id="cookCrank" style="transform-origin: 0 0;">
            <rect x="0" y="-2" width="18" height="4" fill="#5a3018"/>
            <circle cx="18" cy="0" r="4" fill="#a87040" stroke="#3a1d0a" stroke-width="1"/>
          </g>
        </g>

        <!-- 削れた氷が出てくる（flakes flying down） -->
        <g id="cookFlakes" style="opacity:0">
          ${flakes.map((f,i)=>`
            <g style="--fx:${f.fx}px; --fx2:${f.fx2}px; transform-origin: 0 178px;
                      animation: flakeFly 1.4s ${f.delay}s ease-in infinite;">
              <g transform="translate(0 178) scale(${f.size})">
                <use href="#ck-snowflake"/>
              </g>
            </g>
          `).join('')}
        </g>
      </g>

      <!-- ===== ガラス器（氷を受け取る） ===== -->
      <g id="cookGlass" transform="translate(180 240)">
        <!-- ガラス器ベース -->
        <path d="M-44 -16 q44 8 88 0 q-8 36 -44 40 q-36 -4 -44 -40 z" fill="url(#ck-glass)" stroke="#5a90b8" stroke-width="2"/>
        <rect x="-6" y="24" width="12" height="10" fill="#9bc3dc" opacity=".7"/>
        <ellipse cx="0" cy="36" rx="28" ry="6" fill="#5a90b8" opacity=".5"/>
        <!-- ガラスのハイライト -->
        <path d="M-32 -8 q-2 18 8 30" stroke="#fff" stroke-width="2" fill="none" opacity=".6"/>

        <!-- 氷の山（成長する） -->
        <g id="cookMound" style="opacity:0; transform-origin: 0 -10px;">
          <path d="M-44 -16 q-8 -36 16 -56 q12 -20 28 -16 q24 -8 40 8 q16 24 8 48 q8 12 -4 16 q-44 8 -88 0 z" fill="#ffffff"/>
          <!-- 影の谷 -->
          <path d="M-36 -20 q-4 -20 12 -32 q8 8 -4 24 q-4 8 -8 8z" fill="#d9eaf5" opacity=".7"/>
          <path d="M20 -32 q8 -12 20 -4 q-4 12 -12 16 z" fill="#d9eaf5" opacity=".7"/>
          <!-- 山頂のキラッ -->
          <use href="#ck-snowflake" transform="translate(-10 -50) scale(1.2)" opacity=".8"/>
          <use href="#ck-snowflake" transform="translate(14 -54) scale(1)" opacity=".7"/>
          <use href="#ck-snowflake" transform="translate(-26 -38) scale(.8)" opacity=".7"/>
        </g>

        <!-- シロップ -->
        <g id="cookSyrup" style="opacity:0">
          <!-- 流れるシロップの帯 -->
          <path d="M-36 -28 q14 -10 28 -2 q6 8 -2 12 q-6 -2 -16 4 q-12 -2 -18 -8 q-2 -4 8 -6z"
                fill="${v.syrupColor}" opacity=".85"
                style="transform-origin: 0 -20px; animation: syrupSpread .6s .1s both;"/>
          <path d="M-26 -42 q12 -10 26 -4 q4 6 -2 8 q-8 -2 -16 2 q-10 -2 -8 -6z"
                fill="${v.syrupColor}" opacity=".7"
                style="transform-origin: 0 -34px; animation: syrupSpread .6s .3s both;"/>
          <path d="M-14 -56 q8 -6 18 -2 q2 4 -2 6 q-8 0 -16 -4z"
                fill="${v.syrupLight}" opacity=".75"
                style="transform-origin: 0 -50px; animation: syrupSpread .6s .5s both;"/>
        </g>

        <!-- 注ぎストリーム -->
        <g id="cookStream" style="opacity:0">
          <rect x="-2" y="-90" width="5" height="60" rx="2" fill="${v.syrupColor}"
                style="transform-origin: 0 -90px; animation: syrupPour .6s both ease-out;"/>
        </g>

        <!-- バリアント別トッピング -->
        <g id="bowlTopping" style="opacity:0"></g>

        <!-- スプーン -->
        <g id="cookSpoon" style="opacity:0; transform: translate(28 -32) rotate(20);">
          <rect x="0" y="0" width="3.5" height="32" fill="#cfd2d8" stroke="#5a4250" stroke-width=".8"/>
          <ellipse cx="2" cy="0" rx="6" ry="4" fill="#cfd2d8" stroke="#5a4250" stroke-width="1"/>
        </g>
      </g>

      <!-- ===== シロップボトル（注ぐ） ===== -->
      <g id="cookBottle" style="opacity:0">
        <g style="transform-origin: 260px 100px; animation: bottleTilt 1.4s ease-in-out;">
          <!-- ボトル本体 -->
          <rect x="240" y="60" width="40" height="64" rx="6" fill="${v.syrupColor}" stroke="#3a1d0a" stroke-width="2"/>
          <rect x="240" y="60" width="40" height="14" rx="6" fill="#fdf6e3" stroke="#3a1d0a" stroke-width="2"/>
          <!-- ノズル -->
          <rect x="252" y="48" width="16" height="14" rx="2" fill="#3a1d0a"/>
          <rect x="256" y="44" width="8" height="6" rx="1" fill="#5a3018"/>
          <!-- ラベル -->
          <rect x="246" y="86" width="28" height="22" rx="2" fill="#fdf6e3" opacity=".95"/>
          <text x="260" y="102" text-anchor="middle" font-size="9" font-weight="900" fill="${v.syrupColor}">${v.id === 'matcha' ? '抹茶' : v.id === 'blue' ? 'BLUE' : v.id === 'milk-ichigo' ? '苺練乳' : '苺'}</text>
        </g>
      </g>
    </svg>
  `;
}

const COOK_TOPPING_SVG = {
  ichigo: `
    <g style="animation: sprinkle .5s .1s both;">
      <!-- いちごのスライス -->
      <g transform="translate(0 -68)">
        <path d="M-9 -2 q9 -12 18 0 q6 12 -2 18 q-6 6 -14 3 q-10 -4 -2 -19z" fill="#e8336a" stroke="#9a1f1a" stroke-width="1.2"/>
        <path d="M-5 -3 q5 -3 12 -2" stroke="#3a8a3a" stroke-width="2" fill="none"/>
        <path d="M-7 -1 q3 -4 8 -3" stroke="#3a8a3a" stroke-width="1.5" fill="none"/>
        <!-- 種 -->
        <ellipse cx="-3" cy="6" rx=".8" ry="1.2" fill="#fdf6e3"/>
        <ellipse cx="5"  cy="4" rx=".8" ry="1.2" fill="#fdf6e3"/>
        <ellipse cx="2"  cy="12" rx=".8" ry="1.2" fill="#fdf6e3"/>
        <ellipse cx="-5" cy="14" rx=".8" ry="1.2" fill="#fdf6e3"/>
        <ellipse cx="9"  cy="10" rx=".8" ry="1.2" fill="#fdf6e3"/>
      </g>
    </g>`,
  matcha: `
    <g style="animation: sprinkle .5s .1s both;">
      <!-- 白玉団子 -->
      <circle cx="-14" cy="-60" r="8" fill="#fdf6e3" stroke="#c9a878" stroke-width="1.2"/>
      <ellipse cx="-16" cy="-63" rx="3" ry="2" fill="#fff" opacity=".85"/>
      <circle cx="10" cy="-66" r="8" fill="#fdf6e3" stroke="#c9a878" stroke-width="1.2"/>
      <ellipse cx="8" cy="-69" rx="3" ry="2" fill="#fff" opacity=".85"/>
    </g>
    <g style="animation: sprinkle .5s .3s both;">
      <!-- 粒あん -->
      <g fill="#5a2a1a">
        <ellipse cx="-4" cy="-54" rx="3.5" ry="2.5"/>
        <ellipse cx="2"  cy="-50" rx="3" ry="2.2"/>
        <ellipse cx="8"  cy="-54" rx="3.5" ry="2.5"/>
        <ellipse cx="-10" cy="-48" rx="3" ry="2.2"/>
        <ellipse cx="14"  cy="-48" rx="2.8" ry="2"/>
      </g>
    </g>
    <g style="animation: sprinkle .4s .5s both;">
      <!-- 抹茶パウダー散らし -->
      <g fill="#3a8a3a" opacity=".8">
        <circle cx="-22" cy="-72" r="1.2"/>
        <circle cx="-8"  cy="-78" r="1"/>
        <circle cx="6"   cy="-80" r="1.2"/>
        <circle cx="20"  cy="-74" r="1"/>
      </g>
    </g>`,
  blue: `
    <g style="animation: sprinkle .5s .1s both;">
      <!-- パイナップル輪切り -->
      <g transform="translate(0 -68)">
        <ellipse cx="0" cy="0" rx="14" ry="8" fill="#ffe25b" stroke="#a88810" stroke-width="1.2"/>
        <ellipse cx="0" cy="0" rx="3" ry="2" fill="#fff9c4"/>
        <!-- 繊維 -->
        <line x1="-10" y1="-3" x2="-10" y2="3" stroke="#a88810" stroke-width=".8"/>
        <line x1="-5"  y1="-5" x2="-5"  y2="5" stroke="#a88810" stroke-width=".8"/>
        <line x1="5"   y1="-5" x2="5"   y2="5" stroke="#a88810" stroke-width=".8"/>
        <line x1="10"  y1="-3" x2="10"  y2="3" stroke="#a88810" stroke-width=".8"/>
        <!-- 葉 -->
        <path d="M-4 -8 q4 -6 8 0" fill="#3a8a3a" opacity=".7"/>
      </g>
    </g>
    <g style="animation: sprinkle .4s .3s both;">
      <!-- 青い氷の粒キラッ -->
      <g fill="#7ec0e8">
        <circle cx="-20" cy="-58" r="1.4"/>
        <circle cx="-12" cy="-78" r="1"/>
        <circle cx="14"  cy="-78" r="1.2"/>
        <circle cx="22"  cy="-58" r="1.4"/>
      </g>
    </g>`,
  'milk-ichigo': `
    <g style="animation: sprinkle .6s .1s both;">
      <!-- 練乳の流れ -->
      <path d="M-30 -36 q4 -10 12 -4 q-2 6 -8 4 q-4 6 -4 0z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".8"/>
      <path d="M0   -42 q4 -8 12 -2 q-2 6 -8 6 q-6 0 -4 -4z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".8"/>
      <path d="M-16 -56 q4 -6 12 -2 q-2 4 -8 4 q-4 0 -4 -2z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".8"/>
      <path d="M10  -60 q4 -6 12 -2 q-2 4 -8 4 q-4 0 -4 -2z" fill="#fdf6e3" stroke="#c9a878" stroke-width=".8"/>
    </g>
    <g style="animation: sprinkle .5s .35s both;">
      <!-- いちご飾り -->
      <g transform="translate(8 -70)">
        <path d="M-6 -2 q6 -8 12 0 q4 8 -2 12 q-4 4 -8 2 q-6 -3 -2 -14z" fill="#e8336a" stroke="#9a1f1a" stroke-width=".9"/>
        <path d="M-3 -3 q3 -3 8 -1" stroke="#3a8a3a" stroke-width="1.4"/>
        <ellipse cx="-1" cy="3" rx=".6" ry=".9" fill="#fdf6e3"/>
        <ellipse cx="3"  cy="2" rx=".6" ry=".9" fill="#fdf6e3"/>
        <ellipse cx="1"  cy="7" rx=".6" ry=".9" fill="#fdf6e3"/>
      </g>
      <!-- 練乳のドリップ -->
      <g fill="#fdf6e3" stroke="#c9a878" stroke-width=".5" opacity=".95">
        <ellipse cx="-26" cy="-22" rx="2" ry="3.5"/>
        <ellipse cx="-12" cy="-18" rx="1.6" ry="3"/>
        <ellipse cx="22"  cy="-22" rx="2" ry="3.5"/>
      </g>
    </g>`
};

// ===== 調理シーケンス =====
let cookingTimeouts = [];
function clearCookTimers() {
  cookingTimeouts.forEach(t => clearTimeout(t));
  cookingTimeouts = [];
}
function setStageStyle(el, props) {
  if (!el) return;
  for (const k in props) el.style[k] = props[k];
}

function startCooking(variant) {
  clearCookTimers();
  const overlay = document.getElementById('cookOverlay');
  const stageEl = document.getElementById('cookStage');
  const stepEl  = document.getElementById('cookStep');
  const barEl   = document.getElementById('progressBar');
  const titleEl = document.getElementById('cookTitle');
  const actions = document.getElementById('cookActions');

  titleEl.textContent = `${variant.name} を削ってます…`;
  stageEl.innerHTML = cookingSvg(variant);
  actions.style.display = 'none';
  stepEl.textContent = '';
  barEl.style.width = '0%';
  overlay.classList.add('show');

  const $ = id => stageEl.querySelector('#' + id);

  COOK_STEPS.forEach((step, i) => {
    cookingTimeouts.push(setTimeout(() => {
      const msg = step.msg !== null ? step.msg : variant.toppingLabel;
      stepEl.textContent = msg;
      barEl.style.width = step.progress + '%';

      switch (i) {
        case 0: // 氷をセット
          setStageStyle($('cookCool'), { opacity: 1 });
          break;
        case 1: // 削り中（クランク回転＋削れた氷飛び散り）
          setStageStyle($('cookCrank'), { animation: 'shaveSpin .5s linear infinite' });
          setStageStyle($('cookIce'), { animation: 'blockDescend 2.5s linear forwards' });
          setStageStyle($('cookFlakes'), { opacity: 1 });
          break;
        case 2: // 盛り付け（山が育つ）
          setStageStyle($('cookMound'), { opacity: 1, animation: 'moundGrow .8s cubic-bezier(.34,1.56,.64,1) both' });
          break;
        case 3: // シロップをかける
          setStageStyle($('cookCrank'), { animation: 'none' });
          setStageStyle($('cookFlakes'), { opacity: 0 });
          setStageStyle($('cookIce'), { animation: 'none', opacity: '.4' });
          setStageStyle($('cookBottle'), { opacity: 1 });
          setStageStyle($('cookStream'), { opacity: 1 });
          cookingTimeouts.push(setTimeout(() => {
            setStageStyle($('cookSyrup'), { opacity: 1 });
          }, 300));
          break;
        case 4: // バリアント別トッピング
          setStageStyle($('cookStream'), { opacity: 0 });
          setStageStyle($('cookBottle'), { opacity: 0 });
          {
            const t = $('bowlTopping');
            t.innerHTML = COOK_TOPPING_SVG[variant.id] || '';
            t.style.opacity = '1';
          }
          break;
        case 5: // 完成
          titleEl.textContent = '出来上がり！';
          actions.style.display = 'flex';
          setStageStyle($('cookSpoon'), { opacity: 1, animation: 'sprinkle .5s both' });
          // 機械をフェード
          setStageStyle($('cookMachine'), { transition: 'opacity .4s', opacity: '.35' });
          const glass = $('cookGlass');
          if (glass) glass.style.animation = 'bounce .5s ease-out';
          break;
      }
    }, step.t));
  });
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  renderMenu();

  document.getElementById('btnDone').addEventListener('click', () => {
    document.getElementById('cookOverlay').classList.remove('show');
    clearCookTimers();
  });
  document.getElementById('btnAgain').addEventListener('click', () => {
    document.getElementById('cookOverlay').classList.remove('show');
    clearCookTimers();
  });
  document.querySelector('.close-btn').addEventListener('click', () => {
    const m = document.getElementById('modal');
    m.style.transition = 'transform .2s ease';
    m.style.transform = 'scale(.96)';
    setTimeout(() => { m.style.transform = ''; }, 200);
  });

  // 吹き出しローテーション
  const speech = document.getElementById('speech');
  const phrases = ['ひんやり、いかが〜？','今日も暑いね〜！','シロップたっぷり！','氷、削りたて！'];
  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % phrases.length;
    speech.textContent = phrases[idx];
    speech.style.animation = 'none';
    void speech.offsetWidth;
    speech.style.animation = 'popIn .5s cubic-bezier(.34,1.56,.64,1) both, wiggle 4s ease-in-out 1s infinite';
  }, 5000);
});
