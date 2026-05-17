// たこ焼き屋台 - インタラクティブロジック

const VARIANTS = [
  {
    id: 'plain',
    name: 'たこ',
    price: 500,
    badge: '看板',
    color: '#ff6b35',
    description: 'ソース・マヨ・青のり・かつおぶし',
    toppingLabel: 'かつおぶしをふわっと'
  },
  {
    id: 'negi',
    name: 'ネギたこ',
    price: 600,
    badge: null,
    color: '#5a8a3a',
    description: 'たっぷりの刻みネギとポン酢',
    toppingLabel: '刻みネギをパラパラっと'
  },
  {
    id: 'mentai',
    name: '明太子たこ',
    price: 700,
    badge: 'NEW',
    color: '#ff7aa0',
    description: 'ピリ辛明太マヨがけ',
    toppingLabel: '明太マヨをトロリ…'
  },
  {
    id: 'cheese',
    name: 'チーズたこ',
    price: 650,
    badge: null,
    color: '#ffc145',
    description: 'とろけるチーズトッピング',
    toppingLabel: 'とろ〜りチーズを乗せて…'
  }
];

// ===== ミニ・たこ焼きSVG（メニュー用） =====
function variantBoatSvg(v) {
  // 舟皿に7個のたこ焼き、各バリアントのトッピング
  let topping = '';
  switch (v.id) {
    case 'plain':
      topping = `
        <path d="M-36 -3 q6 -5 11 0 t11 0 t11 0 t11 0 t11 0 t5 0"
              stroke="#3a1a06" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".88"/>
        <path d="M-38 1 q7 -5 12 1 t12 0 t12 0 t12 0 t12 0 t6 0"
              stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"/>
        <g fill="#5a8a3a">
          <circle cx="-20" cy="-7" r=".9"/><circle cx="-6" cy="-3" r=".9"/>
          <circle cx="8" cy="-6" r=".9"/><circle cx="22" cy="-4" r=".9"/>
        </g>
        <g fill="#f4c290" stroke="#d28a4a" stroke-width=".4">
          <path d="M-20 -16 q6 -2 8 2 q-4 4 -8 2z"/>
          <path d="M-4 -18 q6 0 8 4 q-5 3 -9 0z"/>
          <path d="M14 -16 q6 -1 8 3 q-5 3 -9 0z"/>
        </g>`;
      break;
    case 'negi':
      topping = `
        <path d="M-36 -3 q6 -5 11 0 t11 0 t11 0 t11 0 t11 0 t5 0"
              stroke="#3a1a06" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".85"/>
        <g stroke="#7ab84a" stroke-width="1.6" stroke-linecap="round">
          <line x1="-26" y1="-10" x2="-18" y2="-13"/>
          <line x1="-14" y1="-8"  x2="-6"  y2="-11"/>
          <line x1="-2"  y1="-12" x2="6"   y2="-9"/>
          <line x1="10"  y1="-9"  x2="18"  y2="-13"/>
          <line x1="22"  y1="-10" x2="30"  y2="-7"/>
          <line x1="-22" y1="-4"  x2="-14" y2="-2"/>
          <line x1="0"   y1="-4"  x2="8"   y2="-6"/>
          <line x1="16"  y1="-2"  x2="24"  y2="-4"/>
          <line x1="-8"  y1="2"   x2="0"   y2="4"/>
        </g>
        <g fill="#fff8e1">
          <ellipse cx="-30" cy="2" rx="3" ry="1.4"/>
          <ellipse cx="32" cy="0" rx="3" ry="1.4"/>
        </g>`;
      break;
    case 'mentai':
      topping = `
        <path d="M-36 -2 q6 -6 11 0 t11 0 t11 0 t11 0 t11 0 t5 0"
              stroke="#ff7aa0" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".92"/>
        <path d="M-38 2 q7 -5 12 1 t12 0 t12 0 t12 0 t12 0 t6 0"
              stroke="#ffd6e0" stroke-width="2" fill="none" stroke-linecap="round"/>
        <g fill="#d83b6a">
          <circle cx="-26" cy="-6" r=".8"/><circle cx="-14" cy="-3" r=".8"/>
          <circle cx="-2" cy="-8" r=".8"/><circle cx="8" cy="-4" r=".8"/>
          <circle cx="22" cy="-7" r=".8"/><circle cx="-20" cy="2" r=".8"/>
          <circle cx="16" cy="3" r=".8"/>
        </g>
        <g fill="#5a8a3a">
          <circle cx="-30" cy="-12" r=".8"/><circle cx="28" cy="-10" r=".8"/>
        </g>`;
      break;
    case 'cheese':
      topping = `
        <path d="M-40 -2 q6 -8 13 -2 q3 6 -2 8 q6 0 9 -4 q4 6 -2 10 q8 -2 12 -6 q3 4 -2 8 q7 -2 11 -8 q4 6 0 10 q8 -3 14 -8"
              fill="#ffd66b" stroke="#e89f1a" stroke-width="1.2" opacity=".95"/>
        <path d="M-36 -1 q6 -6 12 0 t12 0 t12 0 t12 0 t12 0 t6 0"
              stroke="#3a1a06" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".8"/>
        <g fill="#5a8a3a">
          <circle cx="-20" cy="-10" r=".9"/><circle cx="10" cy="-12" r=".9"/>
          <circle cx="26" cy="-8" r=".9"/>
        </g>`;
      break;
  }

  return `
    <svg viewBox="-50 -30 100 60" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="tk-${v.id}" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#ffd089"/>
          <stop offset=".5"  stop-color="#d68a3e"/>
          <stop offset="1"   stop-color="#7a3e15"/>
        </radialGradient>
      </defs>
      <!-- 舟皿 -->
      <path d="M-46 -8 Q-42 16 -32 22 L32 22 Q42 16 46 -8 Z" fill="#fdf6e3" stroke="#c97a3a" stroke-width="1.4"/>
      <g stroke="#ff6b35" stroke-width=".6" opacity=".25">
        <line x1="-32" y1="0" x2="-32" y2="20"/>
        <line x1="-20" y1="-2" x2="-20" y2="22"/>
        <line x1="-8" y1="-4" x2="-8" y2="22"/>
        <line x1="4" y1="-4" x2="4" y2="22"/>
        <line x1="16" y1="-2" x2="16" y2="22"/>
        <line x1="28" y1="0" x2="28" y2="20"/>
      </g>
      <!-- 7個の球 -->
      <g>
        <g transform="translate(-28 4)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(-10 4)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(10 4)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(28 4)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(-18 -10)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(0 -12)"><circle r="10" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
        <g transform="translate(18 -10)"><circle r="9.5" fill="url(#tk-${v.id})"/><ellipse cx="-2.5" cy="-3.5" rx="3.5" ry="2" fill="#fff1c2" opacity=".5"/></g>
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
      ${variantBoatSvg(v)}
      <div class="name">${v.name}</div>
      <div class="price">¥${v.price}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.menu-card').forEach(card => {
    const id = card.dataset.id;
    const startBuy = () => {
      const v = VARIANTS.find(x => x.id === id);
      if (v) startCooking(v);
    };
    card.addEventListener('click', startBuy);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startBuy(); }});
  });
}

// ===== 調理アニメーション =====
const COOK_STEPS = [
  { t: 0,     msg: '鉄板をあたためて…',           progress: 0   },
  { t: 700,   msg: '生地をジュワッと流し込み…',     progress: 18  },
  { t: 1500,  msg: 'ぷりっとタコを投入！',          progress: 38  },
  { t: 2300,  msg: 'くるっとひっくり返して…',       progress: 60  },
  { t: 3100,  msg: 'こんがり焼き上げて…',          progress: 78  },
  { t: 3700,  msg: 'ソースとマヨをトロリ…',         progress: 88  },
  { t: 4400,  msg: null /* variant.toppingLabel */, progress: 96  },
  { t: 5100,  msg: 'おまち！',                     progress: 100 }
];

function cookingSvg(v) {
  // 中央に大きな鉄板、たこ焼きが各ステージで変化
  // 各ステージ用のグループを stage data-stage で区別、JSで表示制御
  return `
    <svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="cookplate" cx=".5" cy=".5" r=".7">
          <stop offset="0" stop-color="#4c3046"/>
          <stop offset="1" stop-color="#15090e"/>
        </radialGradient>
        <radialGradient id="cookball" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#ffd089"/>
          <stop offset=".5"  stop-color="#d68a3e"/>
          <stop offset="1"   stop-color="#7a3e15"/>
        </radialGradient>
        <radialGradient id="cookbatter" cx=".4" cy=".35" r=".7">
          <stop offset="0"   stop-color="#fff1b8"/>
          <stop offset="1"   stop-color="#e8c878"/>
        </radialGradient>
        <radialGradient id="hot" cx=".5" cy="1" r=".6">
          <stop offset="0" stop-color="#ff6b35" stop-opacity=".7"/>
          <stop offset="1" stop-color="#ff6b35" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- ベース：鉄板の影＋上面 -->
      <ellipse cx="180" cy="200" rx="160" ry="22" fill="#000" opacity=".5"/>
      <rect x="40" y="120" width="280" height="80" rx="10" fill="#0a0306"/>
      <rect x="48" y="100" width="264" height="40" rx="6" fill="url(#cookplate)"/>
      <!-- ハンドル -->
      <rect x="20" y="135" width="28" height="10" rx="3" fill="#3a1d0a"/>
      <rect x="312" y="135" width="28" height="10" rx="3" fill="#3a1d0a"/>
      <!-- 熱気 -->
      <ellipse cx="180" cy="220" rx="180" ry="14" fill="url(#hot)"/>

      <!-- 5x2 = 10個 穴 -->
      <g id="holes">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 112 + row * 22;
          return `<circle cx="${cx}" cy="${cy}" r="14" fill="#0a0306"/>`;
        }).join('')}
      </g>

      <!-- 生地（ステージ batter で表示） -->
      <g id="cookBatter" style="opacity:0">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 112 + row * 22;
          return `<g style="animation: batterDrop .5s ${.05*i}s both ease-out;">
            <ellipse cx="${cx}" cy="${cy}" rx="12" ry="6" fill="url(#cookbatter)"/>
          </g>`;
        }).join('')}
      </g>

      <!-- 流し込みストリーム -->
      <g id="cookStream" style="opacity:0">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 112 + row * 22;
          return `<rect x="${cx-2}" y="20" width="4" height="${cy-30}" fill="#ffd66b" opacity=".7" rx="2" style="animation: batterDrop .35s ${.04*i}s both ease-in;"/>`;
        }).join('')}
      </g>

      <!-- タコ -->
      <g id="cookOcto" style="opacity:0">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 112 + row * 22;
          return `<g style="animation: ballGrow .35s ${.05*i}s both;">
            <circle cx="${cx}" cy="${cy-1}" r="3.5" fill="#e84a3a"/>
            <circle cx="${cx-1}" cy="${cy-2}" r="1" fill="#fff" opacity=".7"/>
          </g>`;
        }).join('')}
      </g>

      <!-- 球（焼き中） -->
      <g id="cookBalls" style="opacity:0">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 110 + row * 22;
          return `<g class="cb cb-${i}" style="transform-origin: ${cx}px ${cy}px; animation: ballGrow .4s ${.04*i}s both;">
            <circle cx="${cx}" cy="${cy}" r="12" fill="url(#cookball)"/>
            <ellipse cx="${cx-3}" cy="${cy-4}" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/>
          </g>`;
        }).join('')}
      </g>

      <!-- ひっくり返し中 -->
      <g id="cookFlip" style="opacity:0">
        ${[...Array(10)].map((_,i)=>{
          const col = i % 5;
          const row = Math.floor(i / 5);
          const cx = 80 + col * 50;
          const cy = 110 + row * 22;
          const delay = .03*i;
          return `<g style="transform-origin: ${cx}px ${cy}px; animation: flip .6s ${delay}s ease-in-out both;">
            <circle cx="${cx}" cy="${cy}" r="12" fill="url(#cookball)"/>
            <ellipse cx="${cx-3}" cy="${cy-4}" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/>
          </g>`;
        }).join('')}
      </g>

      <!-- ピック（つつくモーション） -->
      <g id="cookPick" style="opacity:0; transform-origin: 240px 80px; animation: pickPoke .6s ease-in-out infinite;">
        <line x1="240" y1="80" x2="290" y2="40" stroke="#a87040" stroke-width="3" stroke-linecap="round"/>
        <circle cx="290" cy="40" r="3" fill="#5a3018"/>
        <circle cx="240" cy="80" r="2" fill="#3a1d0a"/>
      </g>

      <!-- 湯気 -->
      <g id="cookSteam" style="opacity:0">
        ${[...Array(8)].map((_,i)=>{
          const col = i % 5;
          const cx = 80 + col * 50;
          const delay = .25*i;
          return `<g style="transform-origin: ${cx}px 80px; animation: steamRise 2.2s ${delay}s infinite ease-in-out;">
            <ellipse cx="${cx}" cy="80" rx="6" ry="9" fill="#fff" opacity=".7"/>
          </g>`;
        }).join('')}
      </g>

      <!-- 完成：舟皿（最終ステージで表示） -->
      <g id="cookBoat" style="opacity:0; transform: translateY(20px);">
        <ellipse cx="180" cy="208" rx="120" ry="14" fill="#000" opacity=".4"/>
        <path d="M70 170 Q80 220 110 232 L250 232 Q280 220 290 170 Z" fill="#fdf6e3" stroke="#c97a3a" stroke-width="2.4"/>
        <g stroke="#ff6b35" stroke-width=".8" opacity=".25">
          <line x1="100" y1="190" x2="100" y2="225"/>
          <line x1="130" y1="184" x2="130" y2="230"/>
          <line x1="160" y1="180" x2="160" y2="232"/>
          <line x1="180" y1="180" x2="180" y2="232"/>
          <line x1="200" y1="180" x2="200" y2="232"/>
          <line x1="230" y1="184" x2="230" y2="230"/>
          <line x1="260" y1="190" x2="260" y2="225"/>
        </g>
        <g>
          <g><circle cx="115" cy="200" r="14" fill="url(#cookball)"/><ellipse cx="111" cy="196" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="145" cy="200" r="14" fill="url(#cookball)"/><ellipse cx="141" cy="196" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="180" cy="200" r="14" fill="url(#cookball)"/><ellipse cx="176" cy="196" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="215" cy="200" r="14" fill="url(#cookball)"/><ellipse cx="211" cy="196" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="245" cy="200" r="14" fill="url(#cookball)"/><ellipse cx="241" cy="196" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="130" cy="180" r="14" fill="url(#cookball)"/><ellipse cx="126" cy="176" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="180" cy="178" r="15" fill="url(#cookball)"/><ellipse cx="176" cy="174" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
          <g><circle cx="230" cy="180" r="14" fill="url(#cookball)"/><ellipse cx="226" cy="176" rx="4" ry="2.5" fill="#fff1c2" opacity=".5"/></g>
        </g>
        <!-- ソース -->
        <g id="boatSauce" style="opacity:0">
          <path d="M105 184 q10 -10 22 0 t22 0 t22 0 t22 0 t22 0 t22 0 t10 0"
                stroke="#3a1a06" stroke-width="4.5" fill="none" stroke-linecap="round"
                stroke-dasharray="200" style="animation: saucePour .8s .1s both ease-out;"/>
        </g>
        <!-- マヨ -->
        <g id="boatMayo" style="opacity:0">
          <path d="M100 190 q12 -8 22 2 t22 0 t22 0 t22 0 t22 0 t22 0 t14 0"
                stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round"
                stroke-dasharray="200" style="animation: mayoPour .8s .1s both ease-out;"/>
        </g>
        <!-- バリアントトッピング -->
        <g id="boatTopping" style="opacity:0"></g>
      </g>
    </svg>
  `;
}

const COOK_TOPPING_SVG = {
  plain: `
    <g fill="#5a8a3a" style="animation: sprinkle .5s .1s both;"><circle cx="115" cy="170" r="1.6"/><circle cx="140" cy="178" r="1.4"/><circle cx="170" cy="172" r="1.6"/><circle cx="200" cy="180" r="1.4"/><circle cx="230" cy="175" r="1.6"/><circle cx="255" cy="172" r="1.4"/><circle cx="160" cy="195" r="1.4"/><circle cx="220" cy="195" r="1.6"/></g>
    <g fill="#f4c290" stroke="#d28a4a" stroke-width=".6" style="animation: sprinkle .6s .3s both;">
      <path d="M120 160 q8 -3 12 2 q-4 6 -12 4 q-3 -3 0 -6z"/>
      <path d="M160 154 q10 -2 14 4 q-5 6 -14 4 q-3 -4 0 -8z"/>
      <path d="M200 152 q12 0 14 6 q-7 6 -16 2 q-3 -4 2 -8z"/>
      <path d="M236 158 q10 -1 14 5 q-6 5 -16 3 q-3 -4 2 -8z"/>
    </g>`,
  negi: `
    <g stroke="#7ab84a" stroke-width="2.5" stroke-linecap="round" style="animation: sprinkle .5s .1s both;">
      <line x1="105" y1="170" x2="125" y2="166"/>
      <line x1="130" y1="172" x2="148" y2="168"/>
      <line x1="152" y1="166" x2="170" y2="170"/>
      <line x1="175" y1="172" x2="195" y2="168"/>
      <line x1="200" y1="166" x2="220" y2="170"/>
      <line x1="225" y1="172" x2="245" y2="168"/>
      <line x1="115" y1="184" x2="135" y2="180"/>
      <line x1="145" y1="186" x2="165" y2="182"/>
      <line x1="180" y1="188" x2="200" y2="184"/>
      <line x1="215" y1="186" x2="235" y2="182"/>
    </g>
    <g stroke="#5a8a3a" stroke-width="2" stroke-linecap="round" style="animation: sprinkle .5s .25s both;">
      <line x1="120" y1="178" x2="138" y2="174"/>
      <line x1="160" y1="180" x2="178" y2="176"/>
      <line x1="200" y1="180" x2="218" y2="176"/>
      <line x1="148" y1="194" x2="166" y2="190"/>
      <line x1="195" y1="194" x2="213" y2="190"/>
    </g>`,
  mentai: `
    <g style="animation: sprinkle .6s .1s both;">
      <path d="M105 178 q12 -10 22 -2 t22 -2 t22 -2 t22 -2 t22 -2 t22 -2 t10 0"
            stroke="#ff7aa0" stroke-width="5" fill="none" stroke-linecap="round" opacity=".95"/>
      <path d="M105 182 q12 -8 22 0 t22 0 t22 0 t22 0 t22 0 t22 0 t10 0"
            stroke="#ffd6e0" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g>
    <g fill="#d83b6a" style="animation: sprinkle .5s .35s both;">
      <circle cx="115" cy="170" r="1.3"/><circle cx="138" cy="178" r="1.1"/>
      <circle cx="160" cy="170" r="1.3"/><circle cx="182" cy="176" r="1.1"/>
      <circle cx="205" cy="170" r="1.3"/><circle cx="228" cy="176" r="1.1"/>
      <circle cx="248" cy="172" r="1.3"/><circle cx="148" cy="190" r="1.1"/>
      <circle cx="210" cy="192" r="1.3"/>
    </g>`,
  cheese: `
    <g style="animation: sprinkle .6s .1s both;">
      <path d="M95 178 q8 -12 20 -8 q4 8 -3 12 q9 -1 14 -7 q5 9 -4 14 q12 -2 18 -10 q4 6 -3 12 q11 -2 17 -12 q4 8 0 14 q12 -3 20 -12 q4 8 -2 14 q14 -4 20 -14"
            fill="#ffd66b" stroke="#e89f1a" stroke-width="1.6" opacity=".95"/>
      <path d="M105 184 q12 -6 22 2 t22 0 t22 0 t22 0 t22 0 t22 0 t14 0"
            stroke="#3a1a06" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
    </g>
    <g fill="#5a8a3a" style="animation: sprinkle .5s .35s both;">
      <circle cx="125" cy="166" r="1.4"/><circle cx="170" cy="160" r="1.4"/>
      <circle cx="215" cy="166" r="1.4"/><circle cx="248" cy="170" r="1.4"/>
    </g>`,
};

// ===== 調理シーケンス =====
let cookingTimeouts = [];

function clearCookTimers() {
  cookingTimeouts.forEach(t => clearTimeout(t));
  cookingTimeouts = [];
}

function setStageStyle(el, props) {
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

  // 個別ステージ要素の参照
  const $ = id => stageEl.querySelector('#' + id);

  // ステップごとに進行
  COOK_STEPS.forEach((step, i) => {
    cookingTimeouts.push(setTimeout(() => {
      const msg = step.msg !== null ? step.msg : variant.toppingLabel;
      stepEl.textContent = msg;
      barEl.style.width = step.progress + '%';

      switch (i) {
        case 1: // 生地ストリーム
          setStageStyle($('cookStream'), { opacity: 1 });
          setStageStyle($('cookSteam'), { opacity: .5 });
          cookingTimeouts.push(setTimeout(() => {
            setStageStyle($('cookStream'), { opacity: 0 });
            setStageStyle($('cookBatter'), { opacity: 1 });
          }, 350));
          break;
        case 2: // タコ
          setStageStyle($('cookOcto'), { opacity: 1 });
          break;
        case 3: // ひっくり返し
          setStageStyle($('cookBatter'), { opacity: 0 });
          setStageStyle($('cookOcto'), { opacity: 0 });
          setStageStyle($('cookFlip'), { opacity: 1 });
          setStageStyle($('cookPick'), { opacity: 1 });
          setStageStyle($('cookSteam'), { opacity: .85 });
          break;
        case 4: // 焼き上がり
          setStageStyle($('cookFlip'), { opacity: 0 });
          setStageStyle($('cookPick'), { opacity: 0 });
          setStageStyle($('cookBalls'), { opacity: 1 });
          break;
        case 5: // 舟皿登場
          setStageStyle($('cookBalls'), { opacity: 0 });
          setStageStyle($('holes'), { opacity: .3 });
          setStageStyle($('cookSteam'), { opacity: 0 });
          {
            const boat = $('cookBoat');
            boat.style.opacity = '1';
            boat.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1), opacity .25s';
            boat.style.transform = 'translateY(0)';
            setStageStyle($('boatSauce'), { opacity: 1 });
            cookingTimeouts.push(setTimeout(() => setStageStyle($('boatMayo'), { opacity: 1 }), 350));
          }
          break;
        case 6: // バリアントトッピング
          {
            const t = $('boatTopping');
            t.innerHTML = COOK_TOPPING_SVG[variant.id] || '';
            t.style.opacity = '1';
          }
          break;
        case 7: // 完成
          titleEl.textContent = '出来上がり！';
          actions.style.display = 'flex';
          // ぴょこんと跳ねる
          const boat = $('cookBoat');
          boat.style.animation = 'bounce .5s ease-out';
          break;
      }
    }, step.t));
  });
}

// ===== ボタン =====
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
    // 屋台モーダルを閉じる風アニメーション（ここでは振動だけ）
    const m = document.getElementById('modal');
    m.style.transition = 'transform .2s ease';
    m.style.transform = 'scale(.96)';
    setTimeout(() => { m.style.transform = ''; }, 200);
  });

  // 吹き出しを定期的に再アニメ
  const speech = document.getElementById('speech');
  const phrases = ['へい！いらっしゃい！','焼きたて、あるよ〜','おひとつどう？','たこ焼きあつあつ！'];
  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % phrases.length;
    speech.textContent = phrases[idx];
    speech.style.animation = 'none';
    void speech.offsetWidth;
    speech.style.animation = 'popIn .5s cubic-bezier(.34,1.56,.64,1) both, wiggle 4s ease-in-out 1s infinite';
  }, 5000);
});
