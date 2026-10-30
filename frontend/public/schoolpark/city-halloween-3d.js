// city-halloween-3d.js — THE FIELD STORE ハロウィン飾り（10/31）
// Claude デザインで作ったもの（10/30）。city-world.js が毎年 10/24〜11/1（日本時間）だけ飾る。
// decorateHalloween(T, scene, h) → { obstacles:[[x,z,w,d],…], dispose() }
// 光：ランタンの PointLight 2つ（影なし）。かぼちゃの顔は MeshBasicMaterial。
// h.layout で位置を上書きできます（下の DEFAULTS 参照）。h.costume = 'witch' | 'ghost'

const DEFAULTS = {
  facadeZ: 4.0,          // 店の正面（入口の壁）
  signFrontZ: 4.3,       // 緑の帯の前面（中心 z4.12・厚み0.35）
  garlandY: 3.04,        // 緑の帯の下端（3.1）のすぐ下
  garlandHalf: 4.6,      // ガーランドの横幅の半分（柱 x=±5.1 の内側）
  ceilingY: 3.94,
  walls: { x0: -5.15, x1: 5.15, z0: -8.15, z1: 3.95 },
  table: [0, -1.55], tableTop: 0.9, tableSize: [2.5, 1.7],
  counterTop: 1.29, counterFrontZ: -3.3, counterX: [2.33, 4.87],
  bench: [7.9, 7.5], benchTop: 0.5, benchLen: 2.7,
};
const C = { orange: 0xd9822f, orangeD: 0xb8661f, plum: 0x5b3f63, night: 0x2a2230, cream: 0xf4ecda, cream2: 0xeee3ca,
  green: 0x244936, green2: 0x355a48, oak: 0xb88a57, brass: 0xb8954a, red: 0xc8412f, stem: 0x5a5a32, glow: 0xffb04a, flame: 0xffd27a, ink: 0x1f2722 };

export function decorateHalloween(T, scene, h = {}) {
  const L = { ...DEFAULTS, ...(h.layout || {}) };
  const root = new T.Group(); root.name = 'halloween'; scene.add(root);
  const obstacles = [];
  const std = (c, o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
  const mat = { orange: std(C.orange, { roughness: 0.6 }), cream: std(C.cream2, { roughness: 0.7 }), stem: std(C.stem), brass: std(C.brass, { metalness: 0.45, roughness: 0.38 }),
    green: std(C.green), oak: std(C.oak), night: std(C.night, { side: T.DoubleSide, roughness: 0.9 }), red: std(C.red), ink: std(C.ink),
    glow: new T.MeshBasicMaterial({ color: C.glow, side: T.DoubleSide }), flame: new T.MeshBasicMaterial({ color: C.flame }),
    glass: std(0xfff2d6, { transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }) };
  const add = (p, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); p.add(o); return o; };
  const at = (x, y, z, ry = 0, parent = root) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g; };
  const tex = (w, hh, draw) => { let t; if (h.texture) t = h.texture((ctx) => { ctx.save(); ctx.scale(ctx.canvas.width / w, ctx.canvas.height / hh); draw(ctx, w, hh); ctx.restore(); }, w, hh);
    else { const c = document.createElement('canvas'); c.width = w; c.height = hh; draw(c.getContext('2d'), w, hh); t = new T.CanvasTexture(c); } t.colorSpace = T.SRGBColorSpace; return t; };

  // ---- かぼちゃ（8つの膨らみ）：ジオメトリは共有 ----
  const lobe = (a) => 0.9 + 0.1 * Math.sqrt(Math.abs(Math.cos(4 * a)));
  const pumpGeo = new T.SphereGeometry(1, 16, 10);
  { const p = pumpGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = lobe(Math.atan2(z, x)); const dip = 1 - 0.12 * Math.pow(Math.abs(y), 6); p.setXYZ(i, x * k * dip, y * 0.74, z * k * dip); } pumpGeo.computeVertexNormals(); }
  const tri = (pts) => { const s = new T.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); return new T.ShapeGeometry(s); };
  const faceGeos = {
    eye: tri([[-0.14, -0.08], [0.14, -0.08], [0.0, 0.14]]),
    nose: tri([[-0.07, -0.05], [0.07, -0.05], [0, 0.07]]),
    mouth: tri([[-0.42, 0.06], [-0.28, -0.02], [-0.16, 0.06], [-0.04, -0.03], [0.08, 0.06], [0.2, -0.02], [0.32, 0.06], [0.42, 0.06], [0.24, -0.2], [-0.24, -0.2]]),
  };
  function pumpkin(parent, x, y, z, r, opt = {}) {
    const g = at(x, y, z, opt.ry || 0, parent);
    const body = add(g, pumpGeo, opt.cream ? mat.cream : mat.orange, 0, r * 0.74, 0); body.scale.set(r, r, r);
    add(g, new T.CylinderGeometry(r * 0.07, r * 0.1, r * 0.3, 6), mat.stem, r * 0.02, r * 1.52, 0, 0, 0, 0.25);
    if (opt.face) {
      const put = (geo, fx, fy, s = 1) => { const d = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)); const k = lobe(Math.atan2(d, fx));
        const o = add(g, geo, mat.glow, fx * r * k, r * 0.74 + fy * r * 0.74, d * r * k + r * 0.03, -fy * 0.6, Math.asin(fx) * 0.9); o.scale.setScalar(r * s); };
      put(faceGeos.eye, -0.32, 0.28); put(faceGeos.eye, 0.32, 0.28); put(faceGeos.nose, 0, 0.02); put(faceGeos.mouth, 0, -0.32, 0.9);
    }
    if (opt.block) obstacles.push([x, z, r * 2.2, r * 2.2]);
    return g;
  }

  // ---- ろうそくのランタン ----
  let lights = 0;
  function lantern(parent, x, y, z, s = 1, lit = false) {
    const g = at(x, y, z, 0, parent); g.scale.setScalar(s);
    add(g, new T.BoxGeometry(0.16, 0.02, 0.16), mat.green, 0, 0.01, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => add(g, new T.BoxGeometry(0.012, 0.22, 0.012), mat.brass, a * 0.072, 0.13, b * 0.072));
    add(g, new T.BoxGeometry(0.14, 0.2, 0.14), mat.glass, 0, 0.13, 0);
    add(g, new T.CylinderGeometry(0.0, 0.11, 0.08, 4), mat.green, 0, 0.28, 0, 0, Math.PI / 4);
    add(g, new T.TorusGeometry(0.035, 0.006, 4, 10, Math.PI), mat.brass, 0, 0.33, 0);
    add(g, new T.CylinderGeometry(0.025, 0.025, 0.08, 8), mat.cream, 0, 0.06, 0);
    const f = add(g, new T.SphereGeometry(0.014, 6, 4), mat.flame, 0, 0.115, 0); f.scale.y = 1.8;
    if (lit && lights < 2) { const pl = new T.PointLight(0xffa64d, 2.2, 3.2, 2); pl.castShadow = false; pl.position.set(0, 0.15, 0); g.add(pl); lights++; }
    return g;
  }

  // ---- ガーランド（1メッシュ：頂点カラー＋文字アトラス）----
  const letters = 'HAPYLOWEN';
  const atlas = tex(384, 384, (x, w) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, w); x.fillStyle = '#1f2722'; x.font = '800 56px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    [...letters].forEach((ch, i) => x.fillText(ch, (i % 4) * 96 + 48, Math.floor(i / 4) * 96 + 34)); });
  const gMat = new T.MeshStandardMaterial({ vertexColors: true, map: atlas, side: T.DoubleSide, roughness: 0.85 });
  const blank = gMat.clone(); blank.map = null;
  function garland(a, b, sag, n, size, word = null) {
    const palette = [C.cream, C.green2, C.cream, C.orange, C.cream, C.green2, C.cream, C.plum].map(c => new T.Color(c));
    const pt = (t) => new T.Vector3().lerpVectors(a, b, t).add(new T.Vector3(0, -sag * 4 * t * (1 - t), 0));
    const pos = [], col = [], uv = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, c = pt(t), dir = new T.Vector3().subVectors(b, a).normalize().multiplyScalar(size * 0.5);
      const p1 = c.clone().sub(dir), p2 = c.clone().add(dir), p3 = c.clone().add(new T.Vector3(0, -size * 1.15, 0));
      pos.push(...p1.toArray(), ...p3.toArray(), ...p2.toArray());
      const k = word ? (word[i] === ' ' ? palette[1] : palette[[0, 0, 3, 0, 0, 7][i % 6]]) : palette[i % palette.length];
      for (let j = 0; j < 3; j++) col.push(k.r, k.g, k.b);
      const li = word ? letters.indexOf(word[i]) : -1;
      if (li >= 0) { const u0 = (li % 4) / 4, v1 = 1 - Math.floor(li / 4) / 4; uv.push(u0 + 0.02, v1, u0 + 0.125, v1 - 0.22, u0 + 0.23, v1); } else uv.push(0.99, 0.01, 0.99, 0.01, 0.99, 0.01);
    }
    const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); gg.setAttribute('color', new T.Float32BufferAttribute(col, 3)); gg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); gg.computeVertexNormals();
    root.add(new T.Mesh(gg, word ? gMat : blank));
    const curve = new T.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => pt(i / 8)));
    root.add(new T.Mesh(new T.TubeGeometry(curve, 24, 0.006, 3), mat.brass));
  }

  // ---- コウモリ ----
  const batShape = new T.Shape();
  [[0, 0.05], [0.04, 0.09], [0.06, 0.04], [0.16, 0.1], [0.3, 0.06], [0.26, 0.0], [0.2, 0.02], [0.17, -0.04], [0.11, -0.01], [0.06, -0.05], [0, -0.03],
   [-0.06, -0.05], [-0.11, -0.01], [-0.17, -0.04], [-0.2, 0.02], [-0.26, 0.0], [-0.3, 0.06], [-0.16, 0.1], [-0.06, 0.04], [-0.04, 0.09]].forEach(([x, y], i) => i ? batShape.lineTo(x, y) : batShape.moveTo(x, y));
  const batGeo = new T.ShapeGeometry(batShape);
  const threadMat = new T.LineBasicMaterial({ color: 0x3a3338, transparent: true, opacity: 0.6 });
  function bat(x, y, z, s = 1, ry = 0, rz = 0, thread = 0) {
    const b = add(root, batGeo, mat.night, x, y, z, 0.15, ry, rz); b.scale.setScalar(s);
    if (thread) { const lg = new T.BufferGeometry().setFromPoints([new T.Vector3(x, y + 0.05 * s, z), new T.Vector3(x, y + thread, z)]); root.add(new T.LineSegments(lg, threadMat)); }
  }

  // ---- 角のクモの巣（線のみ・三角形0）----
  const webMat = new T.LineBasicMaterial({ color: 0xf4ecda, transparent: true, opacity: 0.7 });
  function cobweb(cx, cz, sx, sz, size = 0.75) {
    const y = L.ceilingY - 0.01, V1 = new T.Vector3(cx + sx * size, y, cz), V2 = new T.Vector3(cx, y, cz + sz * size), V3 = new T.Vector3(cx, y - size, cz);
    const hub = new T.Vector3().add(V1).add(V2).add(V3).multiplyScalar(1 / 3);
    const rim = []; [[V1, V2], [V2, V3], [V3, V1]].forEach(([a, b]) => { for (let i = 0; i < 4; i++) rim.push(new T.Vector3().lerpVectors(a, b, i / 4)); });
    const pts = [];
    rim.forEach(p => pts.push(hub, p));
    [0.25, 0.45, 0.65, 0.85].forEach(t => { for (let i = 0; i < rim.length; i++) { const p = (k) => new T.Vector3().lerpVectors(hub, rim[k % rim.length], t).add(new T.Vector3(0, -0.015 * t, 0)); const a = p(i), b = p(i + 1); const m = a.clone().lerp(b, 0.5).lerp(hub, 0.06); pts.push(a, m, m, b); } });
    root.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), webMat));
  }

  // ---- 冷蔵庫くん（仮装）----
  function reizo(x, z, ry, costume) {
    const g = at(x, 0, z, ry);
    const faceT = tex(256, 384, (c, w, hh) => { c.fillStyle = '#c8412f'; c.fillRect(0, 0, w, hh); c.strokeStyle = 'rgba(70,12,6,.5)'; c.lineWidth = 5; c.beginPath(); c.moveTo(10, hh * 0.42); c.lineTo(w - 10, hh * 0.42); c.stroke();
      c.fillStyle = 'rgba(255,240,225,.6)'; c.fillRect(w * 0.78, hh * 0.47, 14, 60);
      const eye = (ex) => { c.fillStyle = '#1f2722'; c.beginPath(); c.ellipse(ex, hh * 0.22, 34, 44, 0, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(ex + 12, hh * 0.18, 11, 0, 7); c.fill(); };
      eye(w * 0.31); eye(w * 0.69); c.strokeStyle = '#1f2722'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.arc(w / 2 - 12, hh * 0.31, 12, 0.1, Math.PI - 0.1); c.arc(w / 2 + 12, hh * 0.31, 12, 0.1, Math.PI - 0.1); c.stroke();
      c.beginPath(); c.arc(w / 2, hh * 0.24, 70, 0.25 * Math.PI, 0.75 * Math.PI); c.stroke(); });
    const body = new T.Mesh(new T.BoxGeometry(0.42, 0.7, 0.32), [mat.red, mat.red, mat.red, mat.red, new T.MeshStandardMaterial({ map: faceT, roughness: 0.6 }), mat.red]);
    body.position.y = 0.6; g.add(body);
    const pink = std(0xe9a08e);
    [-1, 1].forEach(s => add(g, new T.BoxGeometry(0.09, 0.25, 0.09), pink, s * 0.1, 0.125, 0));
    add(g, new T.BoxGeometry(0.24, 0.1, 0.03), pink, -0.31, 0.56, 0.02, 0, 0, 0.5);
    add(g, new T.BoxGeometry(0.24, 0.1, 0.03), pink, 0.31, 0.68, 0.02, 0, 0, 0.35);
    // 手に小さなかぼちゃバケツ
    const pail = at(-0.44, 0.38, 0.05, 0, g); add(pail, new T.CylinderGeometry(0.075, 0.06, 0.1, 12), mat.orange, 0, 0, 0); add(pail, new T.TorusGeometry(0.07, 0.005, 4, 10, Math.PI), mat.ink, 0, 0.05, 0);
    add(pail, faceGeos.eye, mat.glow, -0.025, 0.012, 0.072).scale.setScalar(0.12); add(pail, faceGeos.eye, mat.glow, 0.025, 0.012, 0.072).scale.setScalar(0.12);
    if (costume === 'ghost') {
      const prof = [[0.001, 0.0], [0.12, -0.01], [0.24, -0.06], [0.3, -0.16], [0.31, -0.32], [0.32, -0.5], [0.36, -0.62]].map(([r, y]) => new T.Vector2(r, y));
      const sheet = add(g, new T.LatheGeometry(prof, 18), std(0xf7f2e6, { side: T.DoubleSide, roughness: 0.95 }), 0, 1.02, 0); sheet.scale.z = 0.8;
      [-1, 1].forEach(s => { const e = add(g, new T.SphereGeometry(0.04, 8, 6), mat.ink, s * 0.09, 0.84, 0.24); e.scale.set(0.8, 1.2, 0.3); });
      const lf = add(g, new T.SphereGeometry(0.06, 8, 6), std(0x5f8f4e), 0.06, 1.07, 0, 0, 0, -0.8); lf.scale.set(0.5, 1.4, 0.25);
    } else {
      const hat = at(0.02, 0.95, 0, 0, g); hat.rotation.z = -0.08;
      const hm = std(C.night, { roughness: 0.85 });
      add(hat, new T.CylinderGeometry(0.33, 0.33, 0.016, 24), hm, 0, 0, 0);
      add(hat, new T.CylinderGeometry(0.1, 0.17, 0.24, 16), hm, 0, 0.13, 0);
      add(hat, new T.CylinderGeometry(0.172, 0.176, 0.045, 16), mat.orange, 0, 0.035, 0);
      add(hat, new T.BoxGeometry(0.05, 0.05, 0.012), mat.brass, 0, 0.035, 0.172);
      add(hat, new T.CylinderGeometry(0.0, 0.1, 0.2, 12), hm, 0.05, 0.31, 0, 0, 0, -0.45);
      const lf = add(g, new T.SphereGeometry(0.06, 8, 6), std(0x5f8f4e), 0.24, 0.99, 0.02, 0, 0, -1.1); lf.scale.set(0.5, 1.4, 0.25);
    }
    obstacles.push([x, z, 0.8, 0.6]);
  }

  // ================= 配置 =================
  const W = L.walls, FZ = L.facadeZ, SZ = L.signFrontZ;
  // 入口（外）：左は STEP INSIDE 看板（x-2.15, z5.7）の奥、右に冷蔵庫くん。開口 x-1.2〜1.2 と通路 x-1.5〜1.5 はあける
  pumpkin(root, -3.75, 0, FZ + 0.55, 0.34, { face: true, ry: 0.15 });
  pumpkin(root, -4.3, 0, FZ + 0.85, 0.2, { face: true, ry: 0.4 });
  pumpkin(root, -3.2, 0, FZ + 0.42, 0.15, { cream: true, ry: 1 });
  obstacles.push([-3.75, FZ + 0.6, 1.6, 0.9]);
  lantern(root, -1.72, 0, FZ + 0.35, 1.1, true);                     // PointLight ①
  obstacles.push([-1.72, FZ + 0.35, 0.25, 0.25]);
  reizo(2.15, FZ + 0.55, -0.15, h.costume || 'witch');
  pumpkin(root, 2.75, 0, FZ + 0.8, 0.16, { face: true, ry: -0.4 });
  lantern(root, 1.72, 0, FZ + 0.35, 1.1, false);
  obstacles.push([1.72, FZ + 0.35, 0.25, 0.25]);
  // 看板の下：HAPPY HALLOWEEN ガーランド（帯の下端3.1より下・文字板は隠さない）＋コウモリ
  const word = 'HAPPY  HALLOWEEN';
  garland(new T.Vector3(-L.garlandHalf, L.garlandY, SZ + 0.03), new T.Vector3(L.garlandHalf, L.garlandY, SZ + 0.03), 0.28, word.length + 4, 0.3, '  ' + word + '  ');
  bat(-4.2, 2.75, SZ + 0.05, 1.1, 0, 0.25); bat(-3.6, 2.55, SZ + 0.05, 0.8, 0, -0.2); bat(3.9, 2.7, SZ + 0.05, 1.0, 0, -0.3); bat(4.5, 2.5, SZ + 0.05, 0.7, 0, 0.15);
  // 店内：中央の台
  const [tx, tz] = L.table, ty = L.tableTop, [tw, td] = L.tableSize;
  [[-1, 1, true], [1, 1, false], [-1, -1, false], [1, -1, true]].forEach(([sx, sz, face], i) =>
    pumpkin(root, tx + sx * (tw / 2 - 0.14), ty, tz + sz * (td / 2 - 0.12), i % 2 ? 0.07 : 0.09, { face, cream: i === 2, ry: sz > 0 ? 0 : Math.PI }));
  lantern(root, tx, ty, tz, 1, true);                                 // PointLight ②
  const e = 0.02, y0 = ty - 0.035;
  garland(new T.Vector3(tx - tw / 2 + 0.05, y0, tz + td / 2 + e), new T.Vector3(tx + tw / 2 - 0.05, y0, tz + td / 2 + e), 0.04, 12, 0.11);
  garland(new T.Vector3(tx + tw / 2 - 0.05, y0, tz - td / 2 - e), new T.Vector3(tx - tw / 2 + 0.05, y0, tz - td / 2 - e), 0.04, 12, 0.11);
  // 吊り下げランプ (0,-1.5) を避けて、台の上の左右にコウモリ
  bat(tx - 0.95, 2.6, tz - 0.3, 0.9, 0.3, 0.1, L.ceilingY - 2.6); bat(tx + 0.9, 2.75, tz + 0.25, 0.7, -0.4, -0.15, L.ceilingY - 2.75); bat(tx - 0.6, 2.45, tz + 0.55, 0.8, 0.1, 0.2, L.ceilingY - 2.45);
  // カウンター（正面 +z、天板 x2.33〜4.87）：商品（x3.0）とマシン（z-5.3）を避けて右手前と左端
  const cy = L.counterTop, cfz = L.counterFrontZ, [cx0, cx1] = L.counterX;
  pumpkin(root, cx1 - 0.35, cy, cfz - 0.3, 0.1, { face: true });
  pumpkin(root, cx1 - 0.15, cy, cfz - 0.5, 0.065, { cream: true });
  lantern(root, cx0 + 0.2, cy, cfz - 0.35, 0.8, false);
  bat(cx1 - 0.4, 2.6, cfz + 0.15, 0.8, 0, 0.2, L.ceilingY - 2.6);
  // 角のクモの巣
  cobweb(W.x0, W.z0, 1, 1); cobweb(W.x1, W.z0, -1, 1); cobweb(W.x0, W.z1, 1, -1, 0.6); cobweb(W.x1, W.z1, -1, -1, 0.6);
  // 外のベンチ（座面 x6.55〜9.25）：右端に小さなかぼちゃ、左の足もとに大きいかぼちゃとランタン
  const [bx, bz] = L.bench, be = L.benchLen / 2;
  pumpkin(root, bx + be - 0.25, L.benchTop, bz, 0.13, { face: true });
  pumpkin(root, bx + be - 0.5, L.benchTop, bz + 0.08, 0.08, { cream: true });
  pumpkin(root, bx - be - 0.4, 0, bz + 0.1, 0.26, { face: true, block: true, ry: 0.3 });
  lantern(root, bx - be - 0.35, 0, bz - 0.38, 1, false);
  obstacles.push([bx - be - 0.35, bz - 0.38, 0.3, 0.3]);

  return {
    obstacles,
    group: root,
    dispose() {
      scene.remove(root);
      const geos = new Set(), mats = new Set();
      root.traverse(o => { if (o.geometry) geos.add(o.geometry); if (o.material) [].concat(o.material).forEach(m => mats.add(m)); if (o.isLight) o.dispose?.(); });
      geos.forEach(g => g.dispose()); mats.forEach(m => { m.map?.dispose(); m.dispose(); });
    },
  };
}

export const HALLOWEEN_LAYOUT_DEFAULTS = DEFAULTS;
