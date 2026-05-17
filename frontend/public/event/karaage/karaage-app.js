// 唐揚げ屋台 - インタラクティブロジック

const VARIANTS = [
  {
    id: 'soy',
    name: '醤油唐揚げ',
    price: 500,
    badge: '看板',
    color: '#c8302a',
    description: '王道の醤油ベース',
    toppingLabel: 'パセリとレモンを添えて'
  },
  {
    id: 'salt',
    name: '塩レモン',
    price: 550,
    badge: null,
    color: '#ffd054',
    description: 'さっぱり塩味＋レモン',
    toppingLabel: 'レモンをキュッと絞って…'
  },
  {
    id: 'spicy',
    name: 'スパイシー',
    price: 650,
    badge: '辛口',
    color: '#e63a1f',
    description: '一味と七味のピリ辛仕立て',
    toppingLabel: '唐辛子をパラパラっと'
  },
  {
    id: 'cheese',
    name: 'チーズ唐揚げ',
    price: 700,
    badge: 'NEW',
    color: '#ffc145',
    description: 'とろけるチーズソース',
    toppingLabel: 'とろ〜りチーズソースをかけて'
  }
];

// ===== メニュー用ミニイラスト =====
function variantCupSvg(v) {
  let topping = '';
  switch (v.id) {
    case 'soy':
      topping = `
        <g fill="#3a8a2a">
          <circle cx="-12" cy="-20" r="2.5"/>
          <circle cx="-10" cy="-22" r="1.8"/>
          <circle cx="-14" cy="-22" r="1.8"/>
        </g>
        <!-- レモン -->
        <g transform="translate(14 -22)">
          <path d="M-5 -2 q5 -5 10 0 q2 5 -2 7 q-2 3 -7 1 q-5 -2 -1 -8z" fill="#ffe25b" stroke="#a88810" stroke-width=".8"/>
        </g>`;
      break;
    case 'salt':
      topping = `
        <!-- 塩のキラッ -->
        <g fill="#ffffff">
          <circle cx="-10" cy="-26" r=".8"/><circle cx="-2" cy="-30" r=".8"/>
          <circle cx="6" cy="-26" r=".8"/><circle cx="14" cy="-30" r=".8"/>
          <circle cx="-14" cy="-22" r=".7"/><circle cx="10" cy="-22" r=".7"/>
        </g>
        <!-- レモン大きめ -->
        <g transform="translate(0 -26)">
          <path d="M-10 -3 q10 -8 20 0 q4 8 -2 12 q-4 6 -14 4 q-10 -2 -4 -16z" fill="#ffe25b" stroke="#a88810" stroke-width="1"/>
          <path d="M-6 -1 q6 -3 12 0" stroke="#fff" stroke-width=".8" fill="none" opacity=".6"/>
          <line x1="-2" y1="2" x2="6" y2="2" stroke="#a88810" stroke-width=".4"/>
        </g>`;
      break;
    case 'spicy':
      topping = `
        <!-- 唐辛子オイル -->
        <path d="M-18 -22 q9 -4 18 0 t18 0"
              stroke="#e63a1f" stroke-width="2" fill="none" stroke-linecap="round" opacity=".95"/>
        <!-- 一味の粉 -->
        <g fill="#e63a1f">
          <circle cx="-14" cy="-26" r=".9"/><circle cx="-6" cy="-30" r=".9"/>
          <circle cx="2" cy="-26" r="1"/><circle cx="10" cy="-30" r=".9"/>
          <circle cx="16" cy="-26" r="1"/><circle cx="-2" cy="-22" r=".9"/>
        </g>
        <!-- 唐辛子 -->
        <g transform="translate(12 -28) rotate(20)">
          <path d="M0 0 q-2 8 0 12 q4 0 4 -4 q0 -8 -4 -8z" fill="#e63a1f"/>
          <path d="M-1 0 q-1 -3 3 -3" stroke="#3a8a2a" stroke-width=".8" fill="none"/>
        </g>`;
      break;
    case 'cheese':
      topping = `
        <!-- チーズソース -->
        <path d="M-18 -22 q4 -8 12 -4 q4 4 -2 6 q6 0 9 -4 q4 4 -1 8 q7 -2 11 -6 q3 4 -1 8 q8 -2 12 -8"
              fill="#ffd66b" stroke="#e89f1a" stroke-width=".8" opacity=".9"/>
        <!-- パセリ -->
        <g fill="#3a8a2a">
          <circle cx="-10" cy="-30" r="1.5"/>
          <circle cx="-12" cy="-32" r="1.2"/>
        </g>`;
      break;
  }

  return `
    <svg viewBox="-40 -40 80 80" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="kara-${v.id}" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#ffd089"/>
          <stop offset=".5"  stop-color="#c47632"/>
          <stop offset="1"   stop-color="#6b2e0a"/>
        </radialGradient>
      </defs>
      <!-- 紙コップ -->
      <path d="M-22 -10 L-26 32 L26 32 L22 -10 Z" fill="#fdf6e3" stroke="#c97a3a" stroke-width="1.4"/>
      <g stroke="${v.color}" stroke-width=".9" opacity=".55">
        <line x1="-20" y1="-4" x2="-23" y2="20"/>
        <line x1="-12" y1="-6" x2="-14" y2="20"/>
        <line x1="-4" y1="-8" x2="-5" y2="22"/>
        <line x1="4" y1="-8" x2="5" y2="22"/>
        <line x1="12" y1="-6" x2="14" y2="20"/>
        <line x1="20" y1="-4" x2="23" y2="20"/>
      </g>
      <rect x="-8" y="4" width="16" height="6" rx="1.5" fill="${v.color}" opacity=".18"/>
      <!-- 唐揚げ（5個盛り） -->
      <g>
        <g transform="translate(-12 -14) rotate(-15)">
          <path d="M-9 -5 q-2 -7 5 -8 q7 -1 9 4 q5 -1 7 4 q3 6 -1 9 q3 5 -4 7 q-1 4 -8 3 q-6 4 -10 -1 q-7 -1 -5 -8 q-3 -5 3 -10z" fill="url(#kara-${v.id})" stroke="#3a1808" stroke-width=".8"/>
          <circle cx="-2" cy="-2" r="1.5" fill="#fff1c2" opacity=".5"/>
        </g>
        <g transform="translate(0 -18) rotate(5)">
          <path d="M-10 -5 q-2 -8 6 -9 q8 -2 10 4 q6 -1 8 5 q3 7 -2 10 q3 5 -4 7 q-1 5 -9 3 q-7 5 -11 -2 q-7 -2 -6 -9 q-4 -5 4 -10z" fill="url(#kara-${v.id})" stroke="#3a1808" stroke-width=".8"/>
          <circle cx="-2" cy="-2" r="1.5" fill="#fff1c2" opacity=".5"/>
        </g>
        <g transform="translate(12 -14) rotate(20)">
          <path d="M-9 -5 q-2 -7 5 -8 q7 -1 9 4 q5 -1 7 4 q3 6 -1 9 q3 5 -4 7 q-1 4 -8 3 q-6 4 -10 -1 q-7 -1 -5 -8 q-3 -5 3 -10z" fill="url(#kara-${v.id})" stroke="#3a1808" stroke-width=".8"/>
          <circle cx="-2" cy="-2" r="1.5" fill="#fff1c2" opacity=".5"/>
        </g>
        <g transform="translate(-6 -24) rotate(-8)">
          <path d="M-8 -4 q-2 -6 4 -7 q6 -1 8 3 q4 -1 6 3 q2 5 -1 8 q2 4 -3 6 q-1 3 -7 2 q-5 4 -9 -1 q-6 -1 -4 -7 q-3 -4 2 -8z" fill="url(#kara-${v.id})" stroke="#3a1808" stroke-width=".8"/>
        </g>
        <g transform="translate(8 -26) rotate(15)">
          <path d="M-8 -4 q-2 -6 4 -7 q6 -1 8 3 q4 -1 6 3 q2 5 -1 8 q2 4 -3 6 q-1 3 -7 2 q-5 4 -9 -1 q-6 -1 -4 -7 q-3 -4 2 -8z" fill="url(#kara-${v.id})" stroke="#3a1808" stroke-width=".8"/>
        </g>
      </g>
      ${topping}
    </svg>`;
}

// ===== メニュー描画 =====
function renderMenu() {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = VARIANTS.map(v => `
    <div class="menu-card" data-id="${v.id}" role="button" tabindex="0">
      ${v.badge ? `<span class="tag" style="background:${v.color}">${v.badge}</span>` : ''}
      ${variantCupSvg(v)}
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
  { t: 0,    msg: '油があったまり中…',          progress: 8  },
  { t: 700,  msg: '衣をつけた鶏肉を投入！',       progress: 26 },
  { t: 1500, msg: 'ジュワジュワ揚げてます…',      progress: 48 },
  { t: 2400, msg: 'カラッと揚がってきた…',        progress: 68 },
  { t: 3200, msg: '油を切って引き上げ！',          progress: 82 },
  { t: 3900, msg: '紙コップにポンッ！',           progress: 92 },
  { t: 4500, msg: null /* variant.toppingLabel */, progress: 97 },
  { t: 5200, msg: 'お待ちどおさま！',              progress: 100 }
];

function cookingSvg(v) {
  return `
    <svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ck-oil" cx=".5" cy=".5" r=".7">
          <stop offset="0" stop-color="#ffe98a"/>
          <stop offset=".5" stop-color="#d68a3e"/>
          <stop offset="1" stop-color="#7a3e15"/>
        </radialGradient>
        <linearGradient id="ck-pot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#5a5258"/>
          <stop offset="1" stop-color="#15090e"/>
        </linearGradient>
        <radialGradient id="ck-kara" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#ffd089"/>
          <stop offset=".5"  stop-color="#c47632"/>
          <stop offset="1"   stop-color="#6b2e0a"/>
        </radialGradient>
        <radialGradient id="ck-raw" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#fff1d6"/>
          <stop offset=".5"  stop-color="#e8c8a0"/>
          <stop offset="1"   stop-color="#a87248"/>
        </radialGradient>
        <radialGradient id="ck-hot" cx=".5" cy="1" r=".6">
          <stop offset="0" stop-color="#ff6b35" stop-opacity=".7"/>
          <stop offset="1" stop-color="#ff6b35" stop-opacity="0"/>
        </radialGradient>
        <g id="ck-piece">
          <path d="M-14 -8 q-2 -10 8 -11 q10 -2 14 5 q8 -2 10 6 q4 8 -2 14 q4 8 -6 10 q-2 6 -12 4 q-8 6 -14 -2 q-10 -2 -8 -12 q-4 -8 4 -14 z"
                fill="url(#ck-kara)" stroke="#3a1808" stroke-width="1.2"/>
          <circle cx="-4" cy="-3" r="2" fill="#fff1c2" opacity=".45"/>
          <circle cx="6"  cy="0"  r="1.5" fill="#fff1c2" opacity=".4"/>
          <circle cx="2"  cy="6"  r="1.6" fill="#5a2a0c" opacity=".5"/>
          <circle cx="-6" cy="5"  r="1.2" fill="#5a2a0c" opacity=".4"/>
          <circle cx="8"  cy="-6" r="1.2" fill="#5a2a0c" opacity=".5"/>
        </g>
        <g id="ck-raw-piece">
          <path d="M-14 -8 q-2 -10 8 -11 q10 -2 14 5 q8 -2 10 6 q4 8 -2 14 q4 8 -6 10 q-2 6 -12 4 q-8 6 -14 -2 q-10 -2 -8 -12 q-4 -8 4 -14 z"
                fill="url(#ck-raw)" stroke="#a87248" stroke-width="1"/>
          <!-- 衣のぽろぽろ -->
          <circle cx="-4" cy="-3" r="1.4" fill="#fdf6e3" opacity=".7"/>
          <circle cx="6"  cy="0"  r="1.2" fill="#fdf6e3" opacity=".5"/>
          <circle cx="2"  cy="6"  r="1.4" fill="#fdf6e3" opacity=".6"/>
        </g>
      </defs>

      <!-- 床影 -->
      <ellipse cx="180" cy="218" rx="170" ry="14" fill="#000" opacity=".5"/>

      <!-- 鍋本体 -->
      <rect x="60" y="130" width="240" height="60" rx="10" fill="url(#ck-pot)"/>
      <!-- 取っ手 -->
      <rect x="40" y="148" width="22" height="10" rx="3" fill="#3a1d0a"/>
      <rect x="298" y="148" width="22" height="10" rx="3" fill="#3a1d0a"/>
      <!-- 鍋の縁 -->
      <ellipse cx="180" cy="130" rx="120" ry="14" fill="#1a0d12"/>

      <!-- 油表面 -->
      <ellipse cx="180" cy="130" rx="115" ry="12" fill="url(#ck-oil)"/>
      <ellipse cx="180" cy="128" rx="110" ry="9" fill="#ffe98a" opacity=".4"/>
      <!-- 油のハイライト -->
      <path d="M110 124 q70 -6 140 0" stroke="#fffae0" stroke-width="1.5" fill="none" opacity=".55"/>
      <path d="M130 130 q50 -3 100 0" stroke="#fffae0" stroke-width="1" fill="none" opacity=".35"/>

      <!-- 熱気 -->
      <ellipse cx="180" cy="230" rx="180" ry="14" fill="url(#ck-hot)"/>

      <!-- ===== 加熱中の蜃気楼 ===== -->
      <g id="cookHeat" style="opacity:0">
        ${[100,140,180,220,260].map((x,i)=>`
          <path d="M${x} 120 q-4 -10 0 -18 q4 -10 0 -16"
                stroke="#ffd970" stroke-width="1.6" fill="none" stroke-linecap="round"
                style="animation: heatWave 1.6s ${.15*i}s ease-in-out infinite;"
                opacity=".7"/>`).join('')}
      </g>

      <!-- ===== 投入：生の鶏肉が落下 ===== -->
      <g id="cookDrop" style="opacity:0">
        ${[0,1,2,3,4].map(i=>{
          const x = 100 + i * 40;
          return `<g style="transform-origin: ${x}px 130px; animation: chickenDrop .7s ${.08*i}s both ease-in;">
            <use href="#ck-raw-piece" transform="translate(${x} 130) scale(.85)"/>
          </g>`;
        }).join('')}
      </g>

      <!-- 投入時のしぶき -->
      <g id="cookSplash" style="opacity:0">
        ${[100,140,180,220,260].map((x,i)=>`
          <g style="transform-origin: ${x}px 124px; animation: splash .5s ${.12*i+.4}s both;">
            <ellipse cx="${x}" cy="124" rx="10" ry="3" fill="#ffe98a" opacity=".8"/>
            <circle cx="${x-8}" cy="118" r="2" fill="#ffe98a" opacity=".7"/>
            <circle cx="${x+8}" cy="118" r="2" fill="#ffe98a" opacity=".7"/>
            <circle cx="${x-5}" cy="114" r="1.4" fill="#ffd970"/>
            <circle cx="${x+5}" cy="114" r="1.4" fill="#ffd970"/>
          </g>`).join('')}
      </g>

      <!-- ===== 揚げ中：唐揚げ ===== -->
      <g id="cookFrying" style="opacity:0">
        ${[0,1,2,3,4].map(i=>{
          const x = 100 + i * 40;
          const delay = .15*i;
          return `<g style="transform-origin: ${x}px 128px; animation: chickenBob 1.6s ${delay}s ease-in-out infinite;">
            <use href="#ck-piece" transform="translate(${x} 128) scale(.85)"/>
          </g>`;
        }).join('')}
      </g>

      <!-- 沸き立つ泡 -->
      <g id="cookBubbles" style="opacity:0">
        ${[...Array(12)].map((_,i)=>{
          const x = 90 + Math.random() * 180;
          const r = 1 + Math.random() * 2.5;
          const d = Math.random() * 1.5;
          return `<circle cx="${x}" cy="128" r="${r}" fill="#fff"
                          style="transform-origin: ${x}px 128px; animation: bubbleRise 1.6s ${d}s ease-out infinite;" opacity=".85"/>`;
        }).join('')}
      </g>

      <!-- 湯気 -->
      <g id="cookSteam" style="opacity:0">
        ${[100,150,200,250].map((x,i)=>`
          <g style="transform-origin: ${x}px 100px; animation: steamRise 2.6s ${.4*i}s infinite ease-in-out;">
            <ellipse cx="${x}" cy="100" rx="7" ry="11" fill="#fff" opacity=".7"/>
          </g>`).join('')}
      </g>

      <!-- ===== 引き上げ：網じゃくし ===== -->
      <g id="cookLift" style="opacity:0">
        <g style="transform-origin: 180px 130px; animation: lift 1s both ease-out;">
          <!-- 唐揚げが網に乗っている -->
          <g><use href="#ck-piece" transform="translate(140 110) scale(.85)"/></g>
          <g><use href="#ck-piece" transform="translate(170 100) scale(.95)"/></g>
          <g><use href="#ck-piece" transform="translate(200 108) scale(.85)"/></g>
          <g><use href="#ck-piece" transform="translate(220 96)  scale(.8)"/></g>
          <g><use href="#ck-piece" transform="translate(155 92)  scale(.75)"/></g>
          <!-- 網 -->
          <ellipse cx="180" cy="120" rx="56" ry="12" fill="none" stroke="#5a4250" stroke-width="2"/>
          <g stroke="#5a4250" stroke-width=".8" fill="none">
            <line x1="130" y1="120" x2="234" y2="120"/>
            <line x1="135" y1="116" x2="226" y2="116"/>
            <line x1="135" y1="124" x2="226" y2="124"/>
          </g>
          <!-- 取っ手 -->
          <line x1="236" y1="118" x2="290" y2="80" stroke="#a87040" stroke-width="3" stroke-linecap="round"/>
          <circle cx="290" cy="80" r="3" fill="#5a3018"/>
          <!-- 油が滴る -->
          <g fill="#ffd970">
            <ellipse cx="160" cy="130" rx="1.5" ry="3" style="animation: drip .8s .2s infinite;"/>
            <ellipse cx="195" cy="132" rx="1.4" ry="3" style="animation: drip .9s .5s infinite;"/>
            <ellipse cx="215" cy="130" rx="1.3" ry="2.8" style="animation: drip .8s .3s infinite;"/>
          </g>
        </g>
      </g>

      <!-- ===== 完成：紙コップ盛り ===== -->
      <g id="cookCup" style="opacity:0; transform: translateY(40px);">
        <!-- 紙コップ -->
        <path d="M120 90 L100 220 L260 220 L240 90 Z" fill="#fdf6e3" stroke="#c97a3a" stroke-width="2.4"/>
        <g stroke="${v.color}" stroke-width="1.5" opacity=".55">
          <line x1="128" y1="100" x2="108" y2="210"/>
          <line x1="148" y1="96"  x2="132" y2="212"/>
          <line x1="170" y1="94"  x2="160" y2="214"/>
          <line x1="190" y1="94"  x2="200" y2="214"/>
          <line x1="212" y1="96"  x2="228" y2="212"/>
          <line x1="232" y1="100" x2="252" y2="210"/>
        </g>
        <!-- ロゴ枠 -->
        <rect x="150" y="140" width="60" height="22" rx="3" fill="${v.color}" opacity=".18"/>
        <text x="180" y="156" text-anchor="middle" font-size="14" font-weight="900" fill="${v.color}" opacity=".85">からあげ</text>
        <!-- 唐揚げ盛り（コップから飛び出す） -->
        <g>
          <g><use href="#ck-piece" transform="translate(146 80) scale(1.1) rotate(-15)"/></g>
          <g><use href="#ck-piece" transform="translate(180 70) scale(1.25) rotate(5)"/></g>
          <g><use href="#ck-piece" transform="translate(216 80) scale(1.1) rotate(18)"/></g>
          <g><use href="#ck-piece" transform="translate(160 56) scale(.95) rotate(-8)"/></g>
          <g><use href="#ck-piece" transform="translate(200 52) scale(.95) rotate(12)"/></g>
        </g>
        <!-- バリアント別トッピング -->
        <g id="cupTopping" style="opacity:0"></g>
      </g>
    </svg>
  `;
}

// バリアント別の最終トッピングSVG断片
const COOK_TOPPING_SVG = {
  soy: `
    <!-- パセリ -->
    <g style="animation: sprinkle .5s .1s both;">
      <circle cx="170" cy="44" r="3" fill="#3a8a2a"/>
      <circle cx="168" cy="42" r="2" fill="#5aaa3a"/>
      <circle cx="172" cy="46" r="2" fill="#5aaa3a"/>
      <circle cx="200" cy="48" r="2.5" fill="#3a8a2a"/>
      <circle cx="198" cy="46" r="1.5" fill="#5aaa3a"/>
    </g>
    <!-- レモン（くし切り） -->
    <g transform="translate(150 92)" style="animation: sprinkle .6s .3s both;">
      <path d="M-10 -3 q10 -8 20 0 q4 8 -2 12 q-4 6 -14 4 q-10 -2 -4 -16z" fill="#ffe25b" stroke="#a88810" stroke-width="1.4"/>
      <path d="M-6 -1 q6 -3 12 0" stroke="#fff" stroke-width=".8" fill="none" opacity=".6"/>
      <line x1="-2" y1="2" x2="6" y2="2" stroke="#a88810" stroke-width=".6"/>
      <line x1="0" y1="-2" x2="0" y2="6" stroke="#a88810" stroke-width=".4"/>
    </g>`,
  salt: `
    <!-- 塩のキラッ -->
    <g fill="#ffffff" style="animation: sprinkle .5s .1s both;">
      <circle cx="160" cy="40" r="1"/><circle cx="180" cy="32" r="1.2"/>
      <circle cx="200" cy="40" r="1"/><circle cx="220" cy="48" r="1.1"/>
      <circle cx="150" cy="52" r="1"/><circle cx="170" cy="48" r=".9"/>
      <circle cx="195" cy="60" r="1.1"/><circle cx="215" cy="38" r=".9"/>
    </g>
    <!-- レモン（大きく中央） -->
    <g transform="translate(180 88)" style="animation: sprinkle .6s .25s both;">
      <path d="M-18 -6 q18 -14 36 0 q6 14 -4 22 q-8 10 -24 6 q-18 -4 -8 -28z" fill="#ffe25b" stroke="#a88810" stroke-width="1.6"/>
      <path d="M-12 -2 q12 -5 24 0" stroke="#fff" stroke-width="1" fill="none" opacity=".6"/>
      <line x1="-4" y1="3" x2="12" y2="3" stroke="#a88810" stroke-width=".8"/>
      <line x1="0" y1="-4" x2="0" y2="10" stroke="#a88810" stroke-width=".5"/>
      <line x1="-8" y1="6" x2="6" y2="-2" stroke="#a88810" stroke-width=".4" opacity=".6"/>
    </g>
    <!-- 絞り汁の水滴 -->
    <g fill="#ffe25b" style="animation: sprinkle .4s .5s both;" opacity=".85">
      <ellipse cx="170" cy="100" rx="1.5" ry="3"/>
      <ellipse cx="190" cy="104" rx="1.5" ry="3"/>
      <ellipse cx="200" cy="98" rx="1.2" ry="2.5"/>
    </g>`,
  spicy: `
    <!-- 唐辛子オイル ジグザグ -->
    <g style="animation: sprinkle .5s .1s both;">
      <path d="M140 60 q12 -16 24 0 t24 0 t24 0 t24 0"
            stroke="#e63a1f" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".95"/>
    </g>
    <!-- 一味唐辛子の粉 -->
    <g fill="#e63a1f" style="animation: sprinkle .5s .25s both;">
      <circle cx="146" cy="50" r="1.4"/><circle cx="160" cy="38" r="1.1"/>
      <circle cx="178" cy="46" r="1.4"/><circle cx="192" cy="34" r="1.1"/>
      <circle cx="208" cy="46" r="1.4"/><circle cx="222" cy="38" r="1.1"/>
      <circle cx="156" cy="60" r="1.1"/><circle cx="186" cy="62" r="1.2"/>
      <circle cx="216" cy="60" r="1.1"/>
    </g>
    <!-- 唐辛子（飾り） -->
    <g transform="translate(160 80) rotate(-25)" style="animation: sprinkle .5s .35s both;">
      <path d="M0 0 q-4 16 0 24 q8 0 8 -8 q0 -16 -8 -16z" fill="#e63a1f" stroke="#9a1f1a" stroke-width="1"/>
      <path d="M-2 0 q-2 -6 6 -6" stroke="#3a8a2a" stroke-width="1.4" fill="none"/>
    </g>
    <g transform="translate(210 78) rotate(20)" style="animation: sprinkle .5s .42s both;">
      <path d="M0 0 q-4 16 0 24 q8 0 8 -8 q0 -16 -8 -16z" fill="#e63a1f" stroke="#9a1f1a" stroke-width="1"/>
      <path d="M-2 0 q-2 -6 6 -6" stroke="#3a8a2a" stroke-width="1.4" fill="none"/>
    </g>`,
  cheese: `
    <!-- チーズソース：とろりとした波 -->
    <g style="animation: sprinkle .6s .1s both;">
      <path d="M130 64 q8 -14 22 -8 q4 8 -2 12 q9 -1 14 -8 q4 8 -2 14 q12 -2 16 -10 q4 8 -1 14 q11 -2 16 -12 q3 6 -2 12 q14 -3 20 -14"
            fill="#ffd66b" stroke="#e89f1a" stroke-width="1.4" opacity=".95"/>
      <path d="M140 76 q12 -6 22 2 t22 0 t22 0 t22 0 t14 0"
            stroke="#e89f1a" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
    </g>
    <!-- パセリ -->
    <g fill="#3a8a2a" style="animation: sprinkle .5s .35s both;">
      <circle cx="160" cy="44" r="1.6"/><circle cx="200" cy="42" r="1.6"/>
      <circle cx="222" cy="50" r="1.4"/>
    </g>
    <!-- 黒胡椒 -->
    <g fill="#2a1820" style="animation: sprinkle .5s .45s both;">
      <circle cx="150" cy="56" r=".8"/><circle cx="172" cy="58" r=".8"/>
      <circle cx="190" cy="54" r=".8"/><circle cx="208" cy="58" r=".8"/>
      <circle cx="220" cy="56" r=".8"/>
    </g>`,
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

  titleEl.textContent = `${variant.name} を調理中…`;
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
        case 0: // 油が温まる
          setStageStyle($('cookHeat'), { opacity: 1 });
          break;
        case 1: // 投入
          setStageStyle($('cookHeat'), { opacity: 0 });
          setStageStyle($('cookDrop'), { opacity: 1 });
          cookingTimeouts.push(setTimeout(() => {
            setStageStyle($('cookSplash'), { opacity: 1 });
          }, 400));
          break;
        case 2: // 揚げ中（泡＋湯気）
          setStageStyle($('cookDrop'), { opacity: 0 });
          setStageStyle($('cookSplash'), { opacity: 0 });
          setStageStyle($('cookFrying'), { opacity: 1 });
          setStageStyle($('cookBubbles'), { opacity: 1 });
          setStageStyle($('cookSteam'), { opacity: .8 });
          break;
        case 3: // カラッと → そのまま継続
          break;
        case 4: // 引き上げ
          setStageStyle($('cookFrying'), { opacity: 0 });
          setStageStyle($('cookBubbles'), { opacity: .35 });
          setStageStyle($('cookLift'), { opacity: 1 });
          break;
        case 5: // 紙コップに移し替え
          setStageStyle($('cookLift'), { opacity: 0 });
          setStageStyle($('cookSteam'), { opacity: 0 });
          {
            const cup = $('cookCup');
            cup.style.opacity = '1';
            cup.style.transition = 'transform .5s cubic-bezier(.34,1.56,.64,1), opacity .3s';
            cup.style.transform = 'translateY(0)';
          }
          break;
        case 6: // トッピング
          {
            const t = $('cupTopping');
            t.innerHTML = COOK_TOPPING_SVG[variant.id] || '';
            t.style.opacity = '1';
          }
          break;
        case 7: // 完成
          titleEl.textContent = '出来上がり！';
          actions.style.display = 'flex';
          const cup = $('cookCup');
          if (cup) cup.style.animation = 'bounce .5s ease-out';
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
  const phrases = ['あいよっ！揚げたてだよ！','カラッと美味しいよ〜','お一ついかが？','ジューシーだよ！'];
  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % phrases.length;
    speech.textContent = phrases[idx];
    speech.style.animation = 'none';
    void speech.offsetWidth;
    speech.style.animation = 'popIn .5s cubic-bezier(.34,1.56,.64,1) both, wiggle 4s ease-in-out 1s infinite';
  }, 5000);
});
