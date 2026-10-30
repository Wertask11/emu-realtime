// city-products-3d.js — THE FIELD STORE 公式ショップ 11品（Three.js r186 / 外部ファイル無し）
// Claude デザインで作ったもの（10/30）。city-world.js が読み込み、お店の h（mat / texture / label / image）を渡す。
// buildProduct(T, product, h) → THREE.Group（底 y=0・正面 +z・値札付き）
// 使うヘルパー：h.mat(color, more) / h.texture(draw, w, h) / h.image(file)
// 商品画像（1200×900, 4:3）は h.image で読み、texture.repeat / offset で必要な部分だけ切り抜いて貼ります。

const CSS = { green:'#244936', green2:'#355a48', cream:'#eee3ca', cream2:'#f4ecda', brass:'#b8954a',
  red:'#e0261c', ink:'#1a1a1a', pink:'#e9a08e', mustard:'#f2cf4a', sky:'#8ccbe6', leaf:'#a8d15c' };
const FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const IW = 1200, IH = 900;

export const CATALOG = {
  'reizo-kun-sticker-v1':          { name:'冷蔵庫くん デジタルステッカー', price:5,   image:'01_shop_sticker.webp' },
  'official-wallpaper-icons-v1':   { name:'壁紙・アイコンセット（全9点）', price:15,  image:'02_shop_wallpaper-set.webp' },
  'official-wisdom-cards-v1':      { name:'知恵カード 限定版6枚セット', price:25,     image:'03_shop_card-set.webp' },
  'official-tankyu-note-v1':       { name:'探究ノート（A4・PDF）', price:30,          image:'04_shop_note.webp' },
  'official-goods-vote-1':         { name:'次回グッズの投票権', price:30,             image:'05_shop_vote.webp' },
  'official-sticker-set-v1':       { name:'限定ステッカーセット（5枚組）', price:80,  image:'06_shop_sticker-set.webp' },
  'official-event-seat-v1':        { name:'イベント優先席・限定参加枠', price:150,    image:'07_shop_event-ticket.webp' },
  'official-acrylic-keyholder-v1': { name:'アクリルキーホルダー', price:150,          image:'08_shop_acrylic.webp' },
  'official-can-badge-v1':         { name:'缶バッジ（直径57mm）', price:100,          image:'09_shop_canbadge.webp' },
  'official-guild-badge-v1':       { name:'Guild バッジ5種', price:100,               image:'10_shop_guild-badges.webp' },
  'official-planning-meeting-v1':  { name:'企画会議への参加権', price:300,            image:'11_shop_meeting-ticket.webp' },
};

const HP = Math.PI / 2;
// 棚板は中心の高さ 1.55・厚み 0.07 なので、上面は 1.585（組み込むときに合わせた。10/30）
const SHELF = 1.585;
// [x, y, z, rotationY]
export const PLACEMENTS = {
  'reizo-kun-sticker-v1':          [ 3.00, 1.29, -3.70, 0 ],     // コーヒーカウンター手前（+z 向き・マシンの前）
  'official-wallpaper-icons-v1':   [-4.62, SHELF, -5.75, HP ],   // 左壁の棚・目の高さの段（+x 向き）
  'official-wisdom-cards-v1':      [-4.62, SHELF, -4.55, HP ],
  'official-tankyu-note-v1':       [-4.62, SHELF, -3.30, HP ],
  'official-sticker-set-v1':       [ 1.35, SHELF, -7.56, 0 ],    // 奥の棚・目の高さの段（この段のびんは外した）
  'official-goods-vote-1':         [ 2.55, SHELF, -7.56, 0 ],
  'official-guild-badge-v1':       [ 3.75, SHELF, -7.56, 0 ],
  'official-event-seat-v1':        [-0.62, 0.90, -1.98, 0.12 ],  // 中央の台（高額品）
  'official-planning-meeting-v1':  [ 0.62, 0.90, -1.98, -0.12 ],
  'official-can-badge-v1':         [-0.55, 0.90, -1.08, 0.18 ],
  'official-acrylic-keyholder-v1': [ 0.55, 0.90, -1.08, -0.18 ],
};

let T;
const KITS = new WeakMap();
const add = (p, geo, m, x=0, y=0, z=0, rx=0, ry=0, rz=0) => { const o = new T.Mesh(geo, m); o.position.set(x,y,z); o.rotation.set(rx,ry,rz); p.add(o); return o; };
const B = (w,h,d) => new T.BoxGeometry(w,h,d);
const C = (rt,rb,h,s=16) => new T.CylinderGeometry(rt,rb,h,s);
const P = (w,h) => new T.PlaneGeometry(w,h);
function lean(parent, z, y, tilt) { const g = new T.Group(); g.position.set(0,y,z); g.rotation.x = -tilt; parent.add(g); return g; }
const fb = (w,h,d, side, front, back=side) => new T.Mesh(B(w,h,d), [side,side,side,side,front,back]);

function kit(h) {
  if (KITS.has(h)) return KITS.get(h);
  const mat = (c, o = {}) => h.mat ? h.mat(c, o) : new T.MeshStandardMaterial({ color:c, roughness:0.85, ...o });
  const tex = (w, hh, draw) => {
    if (h.texture) return h.texture(draw, w, hh);
    const c = document.createElement('canvas'); c.width = w; c.height = hh; draw(c.getContext('2d'), w, hh);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  };
  const imgs = {};
  const image = (file) => imgs[file] ??= (h.image ? h.image(file)
    : (() => { const t = new T.TextureLoader().load((h.imageBase ?? '/schoolpark/shop/official/') + file); t.colorSpace = T.SRGBColorSpace; return t; })());
  const K = {
    mat, tex,
    tm: (t, o = {}) => mat(0xffffff, { map:t, roughness:0.8, ...o }),
    // 1200×900 の画像から [x0,y0]-[x1,y1]（px）を切り抜いた Texture
    crop: (file, x0, y0, x1, y1) => { const t = image(file).clone(); t.repeat.set((x1-x0)/IW, (y1-y0)/IH); t.offset.set(x0/IW, 1 - y1/IH); return t; },
    oak: mat(0xb88a57), oakD: mat(0x8a6440), cream: mat(0xeee3ca), cream2: mat(0xf4ecda),
    green: mat(0x244936), green2: mat(0x355a48), ink: mat(0x2a302c), red: mat(0xc8412f),
    brass: mat(0xb8954a, { metalness:0.45, roughness:0.38 }),
    paper: mat(0xf7f3ea, { roughness:0.92 }),
  };
  KITS.set(h, K); return K;
}

// ---------- canvas ----------
function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X+r,Y); x.arcTo(X+W,Y,X+W,Y+H,r); x.arcTo(X+W,Y+H,X,Y+H,r); x.arcTo(X,Y+H,X,Y,r); x.arcTo(X,Y,X+W,Y,r); x.closePath(); }
const ell = (x,cx,cy,rx,ry) => { x.beginPath(); x.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); x.fill(); };
function txt(x, s, X, Y, size, col, weight=700, align='center', font=FONT) {
  x.font = `${weight} ${size}px ${font}`; x.fillStyle = col; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(s, X, Y);
}
// 冷蔵庫くん（手描き風）：赤い縦長の箱・黒い丸い目・ωの口・ピンクの手足・頭の葉っぱ。s=胴の高さ、全体は約 1.6s×1.45s
function drawReizo(x, cx, cy, s) {
  const w = s*0.66, h = s, ink = CSS.ink;
  x.save(); x.translate(cx, cy); x.lineJoin='round'; x.lineCap='round'; x.strokeStyle = ink; x.lineWidth = s*0.022;
  x.fillStyle = CSS.pink;
  [-1,1].forEach(d => { rr(x, d*w*0.2 - w*0.06, h*0.47, w*0.12, h*0.11, s*0.02); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(d*w*0.48, -h*0.04); x.lineTo(d*w*0.86, -h*0.13); x.lineTo(d*w*0.78, -h*0.03); x.lineTo(d*w*0.92, h*0.02); x.lineTo(d*w*0.74, h*0.07); x.lineTo(d*w*0.8, h*0.13); x.lineTo(d*w*0.48, h*0.12); x.closePath(); x.fill(); x.stroke(); });
  x.lineWidth = s*0.026; for (let i=-2;i<=2;i++){ x.beginPath(); x.moveTo(i*w*0.03, -h*0.5); x.quadraticCurveTo(i*w*0.08, -h*0.6, i*w*0.11, -h*0.66 + Math.abs(i)*h*0.03); x.stroke(); }
  x.fillStyle = CSS.red; x.lineWidth = s*0.028; x.beginPath(); x.moveTo(-w/2, -h/2+s*0.02); x.lineTo(w/2, -h/2); x.lineTo(w/2+s*0.015, h/2); x.lineTo(-w/2+s*0.01, h/2-s*0.01); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = ink; ell(x,-w*0.2,-h*0.24,w*0.15,w*0.14); ell(x,w*0.19,-h*0.24,w*0.15,w*0.14);
  x.fillStyle = '#4a0d08'; ell(x,-w*0.16,-h*0.24,w*0.04,w*0.04); ell(x,w*0.23,-h*0.24,w*0.04,w*0.04);
  x.lineWidth = s*0.022; x.beginPath(); x.arc(-w*0.06,-h*0.1,w*0.06,0.1,Math.PI-0.1); x.arc(w*0.06,-h*0.1,w*0.06,0.1,Math.PI-0.1); x.stroke();
  x.beginPath(); x.arc(0,-h*0.2,w*0.3,0.25*Math.PI,0.75*Math.PI); x.stroke();
  x.restore();
}
function dieCut(x, w, h, draw, border) {
  const a = document.createElement('canvas'); a.width=w; a.height=h; draw(a.getContext('2d'), w, h);
  const m = document.createElement('canvas'); m.width=w; m.height=h; const mx = m.getContext('2d');
  for (let i=0;i<16;i++){ const t=i/16*Math.PI*2; mx.drawImage(a, Math.cos(t)*border, Math.sin(t)*border); }
  mx.globalCompositeOperation='source-in'; mx.fillStyle='#fffdf6'; mx.fillRect(0,0,w,h);
  x.drawImage(m,0,0); x.drawImage(a,0,0);
}

// ---------- 値札（看板と同じ Georgia）----------
function priceTag(K, price) {
  const g = new T.Group(); g.name = 'price-tag';
  const t = K.tex(256, 128, (x,w,h) => {
    x.fillStyle=CSS.cream2; x.fillRect(0,0,w,h); x.strokeStyle=CSS.green; x.lineWidth=5; rr(x,7,7,w-14,h-14,10); x.stroke();
    txt(x, String(price), w/2, 56, 62, CSS.green, 700, 'center', SERIF);
    if ('letterSpacing' in x) x.letterSpacing = '5px'; txt(x, 'EMUER', w/2, 100, 22, CSS.green2, 700, 'center', SERIF);
  });
  add(g, B(0.06,0.008,0.035), K.oak, 0, 0.004, 0);
  add(g, C(0.0025,0.0025,0.04,6), K.brass, 0, 0.028, -0.004);
  add(g, P(0.1,0.05), K.tm(t,{side:T.DoubleSide}), 0, 0.068, 0, -0.32);
  return g;
}
const base = (g, K, w, d, lip = true) => { add(g, B(w,0.016,d), K.oak, 0, 0.008, 0); if (lip) add(g, B(w-0.02,0.022,0.012), K.oakD, 0, 0.027, d*0.28); };

// ---------- 11品 ----------
const MODELS = {
  'reizo-kun-sticker-v1'(g, K, f) {
    base(g, K, 0.18, 0.1);
    const L = lean(g, 0.012, 0.016, 0.2);
    const card = K.tex(256, 360, (x,w,h) => { x.fillStyle=CSS.cream2; x.fillRect(0,0,w,h); x.fillStyle=CSS.mustard; x.fillRect(0,h-110,w,72);
      txt(x,'チャットに',w/2,h-88,22,CSS.ink,800); txt(x,'ぺたっ。',w/2,h-60,22,CSS.ink,800); txt(x,'01',28,26,18,CSS.red,800); });
    const c = fb(0.15,0.21,0.004, K.cream2, K.tm(card)); c.position.set(0,0.105,0); L.add(c);
    const st = K.tex(256, 280, (x,w,h) => dieCut(x,w,h,(y)=>drawReizo(y,w/2,h*0.52,140),12));
    add(L, P(0.13,0.142), K.tm(st,{alphaTest:0.5}), 0, 0.13, 0.0025);
    return [0.135, 0.03];
  },

  'official-wallpaper-icons-v1'(g, K, f) {
    add(g, B(0.52,0.018,0.2), K.oak, 0, 0.009, 0);
    const scr = (t) => new T.MeshBasicMaterial({ map:t, color:0xe8e8e8 });
    const tab = lean(g, -0.03, 0.018, 0.18); tab.position.x = -0.08;
    add(tab, B(0.35,0.225,0.012), K.cream, 0, 0.113, 0);
    add(tab, P(0.33,0.2), scr(K.crop(f, 96,316,664,660)), 0, 0.113, 0.0062);
    add(g, B(0.36,0.02,0.02), K.oakD, -0.08, 0.028, 0.012);
    const ph = lean(g, 0.06, 0.018, 0.16); ph.position.x = 0.18;
    add(ph, B(0.088,0.175,0.009), K.cream, 0, 0.088, 0);
    add(ph, P(0.08,0.163), scr(K.crop(f, 800,124,1128,792)), 0, 0.088, 0.0047);
    return [-0.18, 0.14];
  },

  'official-wisdom-cards-v1'(g, K, f) {
    base(g, K, 0.32, 0.13);
    const L = lean(g, 0.012, 0.016, 0.22);
    const back = K.tex(64, 96, (x,w,h) => { x.fillStyle=CSS.cream2; x.fillRect(0,0,w,h); x.strokeStyle=CSS.red; x.lineWidth=4; rr(x,4,4,w-8,h-8,5); x.stroke(); txt(x,'知恵',w/2,h/2,16,CSS.red,800); });
    const backM = K.tm(back);
    const xs = [518,711,904], ys = [[270,462],[477,669]];
    const order = [[1,0],[1,1],[2,1],[0,1],[2,0],[0,0]]; // 最前面に Quest #000
    order.forEach(([cx,ry],i) => {
      const t = K.crop(f, xs[cx], ys[ry][0], xs[cx]+137, ys[ry][1]);
      const piv = new T.Group(); piv.position.set(0,0.012,0.003*i); piv.rotation.z = 0.55 - i*0.22; L.add(piv);
      const m = fb(0.1,0.14,0.002, K.paper, K.tm(t), backM); m.position.y = 0.078; piv.add(m);
    });
    add(L, C(0.01,0.01,0.006,12), K.brass, 0, 0.02, 0.02, HP);
    return [0.13, 0.11];
  },

  'official-tankyu-note-v1'(g, K, f) {
    base(g, K, 0.46, 0.18);
    const L = lean(g, 0.015, 0.016, 0.32);
    [[-1,[785,365,1060,778]],[1,[354,120,774,750]]].forEach(([s,r]) => {
      const pg = new T.Group(); pg.rotation.y = -s*0.14; L.add(pg);
      add(pg, B(0.212,0.31,0.004), K.red, s*0.106, 0.155, -0.006);
      const m = fb(0.2,0.3,0.008, K.paper, K.tm(K.crop(f, ...r))); m.position.set(s*0.1,0.155,0); pg.add(m);
    });
    const pen = new T.Group(); pen.position.set(0.05,0.042,0.06); pen.rotation.set(0,0.15,HP); g.add(pen);
    add(pen, C(0.005,0.005,0.15,6), K.mat(0x8ccbe6), 0, 0, 0);
    add(pen, C(0.0,0.005,0.02,6), K.mat(0xf1d9b5), 0, -0.085, 0);
    return [-0.17, 0.14];
  },

  'official-goods-vote-1'(g, K, f) {
    add(g, B(0.38,0.012,0.3), K.oak, 0, 0.006, 0);
    const body = fb(0.3,0.2,0.18, K.cream2, K.tm(K.crop(f, 215,186,985,700))); body.position.set(0,0.112,-0.05); g.add(body);
    add(g, B(0.32,0.022,0.2), K.green, 0, 0.223, -0.05);
    add(g, B(0.12,0.004,0.014), K.ink, 0, 0.2355, -0.05);
    const bt = K.tex(160,112,(x,w,h)=>{ x.fillStyle='#fbf7ec'; x.fillRect(0,0,w,h); txt(x,'投票用紙',w/2,20,16,CSS.red,800);
      ['A トート','B マグ','C てぬぐい'].forEach((s,i)=>{ const y=46+i*22; x.strokeStyle=CSS.ink; x.lineWidth=2; x.strokeRect(22,y-7,14,14); txt(x,s,46,y,14,CSS.ink,700,'left');
        if(i===1){ x.strokeStyle=CSS.red; x.lineWidth=3; x.beginPath(); x.moveTo(23,y); x.lineTo(29,y+6); x.lineTo(38,y-9); x.stroke(); } }); });
    const btm = K.tm(bt, { side:T.DoubleSide });
    add(g, P(0.1,0.07), btm, 0.01, 0.265, -0.05, 0, 0, 0.06);
    const tray = lean(g, 0.1, 0.012, 1.25);
    add(tray, P(0.12,0.084), btm, 0, 0.042, 0.002);
    add(tray, B(0.13,0.094,0.003), K.oakD, 0, 0.042, -0.001);
    return [-0.13, 0.2];
  },

  'official-sticker-set-v1'(g, K, f) {
    base(g, K, 0.3, 0.14);
    const L = lean(g, 0.016, 0.016, 0.2);
    add(L, B(0.24,0.31,0.012), K.oakD, 0, 0.155, -0.008);
    const m = fb(0.21,0.28,0.003, K.paper, K.tm(K.crop(f, 228,165,622,690))); m.position.set(0,0.16,0); L.add(m);
    add(L, C(0.012,0.012,0.006,12), K.brass, 0, 0.29, 0.004, HP);
    return [0.2, 0.06];
  },

  'official-event-seat-v1'(g, K, f) {
    add(g, C(0.15,0.15,0.014,24), K.oakD, -0.05, 0.007, -0.03);
    const ch = new T.Group(); ch.position.set(-0.05,0.014,-0.04); g.add(ch);
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b]) => add(ch, B(0.012,0.1,0.012), K.oak, a*0.05, 0.05, b*0.05));
    add(ch, B(0.124,0.012,0.124), K.oak, 0, 0.106, 0);
    add(ch, B(0.112,0.014,0.112), K.green2, 0, 0.119, 0.002);
    [-1,1].forEach(a => add(ch, B(0.012,0.12,0.012), K.oak, a*0.05, 0.17, -0.056));
    add(ch, B(0.124,0.05,0.012), K.oak, 0, 0.205, -0.056);
    const pl = K.tex(128,48,(x,w,h)=>{ x.fillStyle='#c9a65a'; x.fillRect(0,0,w,h); txt(x,'優先席',w/2,h/2+1,24,CSS.ink,800); });
    add(ch, P(0.07,0.026), K.tm(pl,{metalness:0.35,roughness:0.4}), 0, 0.205, -0.0495);
    add(g, B(0.25,0.016,0.07), K.oak, 0.04, 0.008, 0.13);
    add(g, B(0.24,0.012,0.008), K.brass, 0.04, 0.02, 0.15);
    const L = lean(g, 0.135, 0.016, 0.28); L.position.x = 0.04;
    const tk = fb(0.22,0.111,0.003, K.paper, K.tm(K.crop(f, 135,185,1065,655))); tk.position.y = 0.056; L.add(tk);
    return [0.2, 0.06];
  },

  'official-acrylic-keyholder-v1'(g, K, f) {
    add(g, C(0.085,0.09,0.02,20), K.oak, 0, 0.01, 0);
    add(g, C(0.006,0.006,0.32,8), K.brass, -0.06, 0.18, 0);
    add(g, C(0.005,0.005,0.1,8), K.brass, -0.012, 0.335, 0, 0, 0, HP);
    add(g, C(0.009,0.009,0.01,10), K.brass, -0.06, 0.341, 0);
    const steel = K.mat(0xd8d6d0, { metalness:0.5, roughness:0.3 });
    const ball = new T.SphereGeometry(0.0035, 6, 4);
    for (let i=0;i<9;i++){ const a = i/8; add(g, ball, steel, 0.032 + Math.sin(a*Math.PI)*0.006, 0.33 - a*0.04, 0); }
    add(g, new T.TorusGeometry(0.008,0.0015,4,12), steel, 0.032, 0.284, 0);
    const t = K.tex(256,300,(x,w,h)=>{
      x.fillStyle='rgba(235,242,240,.3)'; rr(x,10,10,w-20,h-20,50); x.fill(); x.strokeStyle='rgba(255,255,255,.9)'; x.lineWidth=5; x.stroke();
      x.globalCompositeOperation='destination-out'; ell(x,w/2,28,10,10); x.globalCompositeOperation='source-over';
      x.strokeStyle='rgba(255,255,255,.95)'; x.lineWidth=3; x.beginPath(); x.arc(w/2,28,11,0,Math.PI*2); x.stroke();
      drawReizo(x, w/2, h*0.58, 150);
      x.strokeStyle='rgba(255,255,255,.5)'; x.lineWidth=8; x.beginPath(); x.moveTo(110,110); x.lineTo(70,260); x.stroke(); });
    const am = K.mat(0xffffff, { map:t, transparent:true, roughness:0.15, side:T.DoubleSide, depthWrite:false });
    add(g, P(0.1,0.117), am, 0.032, 0.218, 0.003);
    add(g, P(0.1,0.117), am, 0.032, 0.218, -0.003);
    return [0.0, 0.13];
  },

  'official-can-badge-v1'(g, K, f) {
    base(g, K, 0.22, 0.11);
    const rim = K.mat(0x86b548, { roughness:0.45 });
    const back = K.mat(0xd2d0c8, { metalness:0.5, roughness:0.35 });
    const L = lean(g, 0.012, 0.016, 0.2);
    add(L, C(0.09,0.09,0.016,28), [rim, rim, back], 0, 0.092, 0, HP);
    add(L, new T.CircleGeometry(0.088,32), K.tm(K.crop(f, 330,254,614,538),{roughness:0.35}), 0, 0.092, 0.0085);
    const sm = new T.Group(); sm.position.set(0.075,0.022,0.07); sm.rotation.set(-1.2,0,0.2); g.add(sm);
    add(sm, C(0.0285,0.0285,0.007,16), [rim, rim, back], 0, 0, 0, HP);
    add(sm, new T.CircleGeometry(0.0278,24), K.tm(K.crop(f, 330,254,614,538),{roughness:0.35}), 0, 0, 0.0037);
    return [-0.16, 0.06];
  },

  'official-guild-badge-v1'(g, K, f) {
    base(g, K, 0.46, 0.14);
    const L = lean(g, 0.012, 0.016, 0.2);
    add(L, B(0.44,0.32,0.02), K.oak, 0, 0.16, -0.004);
    const g5 = [['LEARN',0x1f5c3f,228,310],['WORK',0x1a1a1a,497,260],['PLAY',0xb8693a,767,300],['CONNECT',0xa8405a,347,570],['WEB3',0x3a3833,627,550]];
    const ft = K.tex(400,272,(x,w,h)=>{ x.fillStyle=CSS.green; x.fillRect(0,0,w,h);
      if ('letterSpacing' in x) x.letterSpacing='6px'; txt(x,'GUILD BADGES',w/2,40,24,CSS.cream2,700,'center',SERIF); x.strokeStyle=CSS.brass; x.lineWidth=2; x.beginPath(); x.moveTo(120,64); x.lineTo(w-120,64); x.stroke();
      if ('letterSpacing' in x) x.letterSpacing='1px'; g5.forEach(([n],i)=>txt(x,n,40+i*80,214,12,CSS.cream,700,'center',SERIF));
      if ('letterSpacing' in x) x.letterSpacing='4px'; txt(x,'5 KINDS · 44mm',w/2,h-20,12,CSS.brass,700,'center',SERIF); });
    add(L, P(0.4,0.272), K.tm(ft), 0, 0.16, 0.0062);
    const r = 92;
    g5.forEach(([n,col,cx,cy],i) => {
      const x0 = -0.16 + i*0.08, y0 = 0.17;
      add(L, C(0.031,0.031,0.008,16), K.mat(col, {roughness:0.4}), x0, y0, 0.01, HP);
      add(L, new T.CircleGeometry(0.0295,24), K.tm(K.crop(f, cx-r, cy-r, cx+r, cy+r),{roughness:0.35}), x0, y0, 0.0142);
    });
    return [0.18, 0.06];
  },

  'official-planning-meeting-v1'(g, K, f) {
    const d = new T.Group(); d.position.set(-0.1,0,0.04); g.add(d);
    add(d, C(0.06,0.065,0.008,16), K.oakD, 0, 0.004, 0);
    add(d, C(0.011,0.011,0.13,8), K.oakD, 0, 0.07, 0);
    add(d, C(0.115,0.115,0.012,24), K.oak, 0, 0.14, 0);
    [0,1,2].forEach(i => { const a = i*2.1+0.4; const sx=Math.sin(a)*0.15, sz=Math.cos(a)*0.15;
      add(d, C(0.03,0.03,0.008,12), K.green2, sx, 0.085, sz); add(d, C(0.006,0.006,0.08,6), K.oak, sx, 0.04, sz); });
    const env = new T.Group(); env.position.set(0.0,0.147,0.02); env.rotation.y = 0.35; d.add(env);
    add(env, B(0.1,0.004,0.068), K.paper, 0,0,0);
    add(env, C(0.011,0.011,0.004,12), K.red, 0, 0.004, 0.006);
    add(g, B(0.25,0.016,0.1), K.oak, 0.1, 0.008, -0.06);
    add(g, B(0.24,0.02,0.01), K.brass, 0.1, 0.026, -0.02);
    const L = lean(g, -0.06, 0.016, 0.2); L.position.x = 0.1;
    const c = fb(0.22,0.124,0.004, K.paper, K.tm(K.crop(f, 138,178,1088,712))); c.position.y = 0.064; L.add(c);
    return [0.22, 0.06];
  },
};

export function buildProduct(T_, product, h = {}) {
  T = T_;
  const p = typeof product === 'string' ? { id: product } : product;
  const def = CATALOG[p.id];
  if (!def) throw new Error('unknown product: ' + p.id);
  const K = kit(h), g = new T.Group(); g.name = 'product:' + p.id;
  const [tx, tz] = MODELS[p.id](g, K, p.image ?? def.image);
  const price = p.price ?? def.price;
  const tag = priceTag(K, price); tag.position.set(tx, 0, tz); g.add(tag);
  g.userData = { id: p.id, name: p.name ?? def.name, price };
  return g;
}

export function buildAllProducts(T_, h = {}, products = Object.keys(CATALOG)) {
  const root = new T_.Group(); root.name = 'city-products';
  products.forEach(pr => { const id = typeof pr === 'string' ? pr : pr.id; const g = buildProduct(T_, pr, h); const [x,y,z,r] = PLACEMENTS[id]; g.position.set(x,y,z); g.rotation.y = r; root.add(g); });
  return root;
}

export function countTriangles(obj) {
  let n = 0; obj.traverse(o => { if (!o.isMesh) return; const gm = o.geometry; n += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; });
  return Math.round(n);
}

// 確認用：お店の h と同じ形のヘルパー（imageBase に画像フォルダ、ext で拡張子を差し替え）
export function createDefaultHelpers(T_, { imageBase = '/schoolpark/shop/official/', ext = null } = {}) {
  const loader = new T_.TextureLoader();
  const helpers = {
    mat: (color, more = {}) => new T_.MeshStandardMaterial({ color, roughness: 0.85, ...more }),
    texture(draw, w = 512, h = 512) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T_.CanvasTexture(c); t.colorSpace = T_.SRGBColorSpace; return t; },
    image(file) { const t = loader.load(imageBase + (ext ? file.replace(/\.\w+$/, ext) : file)); t.colorSpace = T_.SRGBColorSpace; return t; },
    label(text, x, y, z, w, h, bg = '#244936', fg = '#f6f0df', size = 46, rotationY = 0, parent = null) {
      const t = helpers.texture((c, W, H) => { c.fillStyle = bg; c.fillRect(0, 0, W, H); c.fillStyle = fg; c.font = `${size * 2}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, W / 2, H / 2); }, 1024, 256);
      const m = new T_.Mesh(new T_.PlaneGeometry(w, h), new T_.MeshBasicMaterial({ map: t, side: T_.DoubleSide })); m.position.set(x, y, z); m.rotation.y = rotationY; parent?.add(m); return m;
    },
  };
  return helpers;
}
