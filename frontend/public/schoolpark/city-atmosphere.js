// Cityの外の世界。時間帯（朝・昼・夜）で、空・光・広場がまるごと変わる。
//   朝 … 朝焼けの広場（噴水・旗・風船・朝市・鳥）
//   昼 … 雲の上に浮かぶ街（浮島・クリスタル・気球・虹）
//   夜 … 夜祭り（やぐら・提灯・屋台・花火・星空）
// 店内・商品・歩き方・決済には触れない。ここで足すものは飾りで、
// 動くもの・光るものはクリックの当たり判定から外してある（商品や床のタップを邪魔しない）。
// 形もテクスチャもその場で作る。外部の画像・CDNは使わない。
export const PLAZA = { x: -3, z: 14 };

export function createAtmosphere(T, kit, mode = 'day') {
  const { scene, camera, renderer, lights, texture, label, obstacle, disposables } = kit;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tickers = [];
  const dummy = new T.Object3D();
  const tint = new T.Color();
  let seed = 20261110;
  const rnd = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const pick = list => list[Math.floor(rnd() * list.length)];

  const std = (color, more = {}) => { const m = new T.MeshStandardMaterial({ color, roughness: .85, ...more }); disposables.add(m); return m; };
  const basic = (color, more = {}) => { const m = new T.MeshBasicMaterial({ color, ...more }); disposables.add(m); return m; };
  // 光るもの。足し算で重ねるので、暗い空で明るく見える。
  const glow = (color, opacity = 1, more = {}) => basic(color, { transparent: true, opacity, blending: 2, depthWrite: false, fog: false, toneMapped: false, ...more });
  const noRay = o => { o.raycast = () => {}; return o; };
  // solid:true のものは壁と同じ扱い（その向こうの床はタップしても行き先にならない）
  function add(geometry, material, x, y, z, parent = scene, { solid = false, shadow = false } = {}) {
    disposables.add(geometry);
    const o = new T.Mesh(geometry, material); o.position.set(x, y, z);
    o.castShadow = shadow; o.receiveShadow = shadow; if (!solid) noRay(o); parent.add(o); return o;
  }
  const box = (x, y, z, w, h, d, m, parent, opt) => add(new T.BoxGeometry(w, h, d), m, x, y, z, parent, opt);
  const cyl = (x, y, z, r1, r2, h, m, parent, opt, seg = 16) => add(new T.CylinderGeometry(r1, r2, h, seg), m, x, y, z, parent, opt);
  const ball = (x, y, z, r, m, parent, opt, w = 12, h = 9) => add(new T.SphereGeometry(r, w, h), m, x, y, z, parent, opt);
  function instanced(geometry, material, count, parent = scene) {
    disposables.add(geometry);
    const im = new T.InstancedMesh(geometry, material, count);
    im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; noRay(im); parent.add(im); return im;
  }
  const group = (x = 0, y = 0, z = 0, parent = scene) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const stripes = (a, b, n = 8) => texture((c, w, h) => { for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? b : a; c.fillRect(i * w / n, 0, w / n + 1, h); } }, 256, 64);
  const radial = (inner, outer) => texture((c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, inner); g.addColorStop(1, outer); c.fillStyle = g; c.fillRect(0, 0, w, h); }, 256, 256);
  // 地面に落とす、やわらかい丸い影（太陽の影は店のまわりだけなので、広場はこれで足す）
  const blobMap = radial('rgba(0,0,0,.55)', 'rgba(0,0,0,0)');
  const blobMaterial = basic('#000000', { map: blobMap, transparent: true, opacity: mode === 'night' ? .5 : .32, depthWrite: false });
  function blob(x, z, r) { const o = add(new T.CircleGeometry(r, 20), blobMaterial, x, -.018, z); o.rotation.x = -Math.PI / 2; return o; }

  // ── 空 ────────────────────────────────────────────────
  // カメラについて回るので、どこまで歩いても空の端には届かない。
  const sky = group();
  tickers.push(() => { sky.position.copy(camera.position); });
  function skyDome(stops) {
    const map = texture((c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); for (const [at, color] of stops) g.addColorStop(at, color); c.fillStyle = g; c.fillRect(0, 0, w, h); }, 16, 512);
    const dome = add(new T.SphereGeometry(180, 24, 16), basic('#ffffff', { map, side: 1, fog: false }), 0, 0, 0, sky);
    dome.renderOrder = -10; return dome;
  }
  function atmosphere(background, fogNear, fogFar) {
    scene.background = new T.Color(background); scene.fog = new T.Fog(background, fogNear, fogFar);
  }
  function stars(count, opacity, minHeight = .12) {
    const material = basic('#ffffff', { transparent: true, opacity, fog: false, depthWrite: false, toneMapped: false });
    const im = instanced(new T.SphereGeometry(.5, 5, 4), material, count, sky);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, up = minHeight + rnd() * (1 - minHeight), flat = Math.sqrt(1 - up * up);
      dummy.position.set(Math.cos(a) * flat * 170, up * 170, Math.sin(a) * flat * 170);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(.35 + rnd() * rnd() * 1.3); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    }
    return material;
  }
  function ground(color) { cyl(0, -.24, 0, 190, 190, .1, std(color, { roughness: 1 }), scene, {}, 48); }

  // ── 街の共通の部品 ────────────────────────────────────────
  function skyline({ wall, lit, count = 64, colors }) {
    const map = texture((c, w, h) => {
      c.fillStyle = wall; c.fillRect(0, 0, w, h);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) {
        if (rnd() < .58) { c.globalAlpha = .45 + rnd() * .55; c.fillStyle = pick(lit); c.fillRect(8 + x * 20, 8 + y * 24, 10, 14); }
      }
      c.globalAlpha = 1;
    }, 128, 256);
    const im = instanced(new T.BoxGeometry(1, 1, 1), basic('#ffffff', { map }), count);
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + rnd() * .08, r = 34 + rnd() * 30, w = 4 + rnd() * 5, h = 5 + rnd() * rnd() * 22, d = 4 + rnd() * 5;
      dummy.position.set(Math.cos(a) * r, h / 2 - .2, 3 + Math.sin(a) * r); dummy.rotation.set(0, rnd() * Math.PI, 0); dummy.scale.set(w, h, d);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, tint.set(pick(colors)));
    }
  }
  function trees(leafColors, trunkColor) {
    const spots = [];
    for (let z = -7; z <= 24; z += 3.6) spots.push([-18 - rnd() * 1.4, z + rnd()]);
    for (let x = -15; x <= 12; x += 3.6) spots.push([x + rnd(), 26 + rnd() * 1.4]);
    for (let z = 6; z <= 24; z += 3.6) spots.push([14 + rnd() * 1.4, z + rnd()]);
    for (let x = -14; x <= 12; x += 3.8) spots.push([x + rnd(), -11.5 - rnd() * 2]);
    const trunks = instanced(new T.CylinderGeometry(.16, .24, 1, 7), std(trunkColor), spots.length);
    const leaves = instanced(new T.SphereGeometry(1, 9, 7), std('#ffffff', { roughness: 1 }), spots.length * 3);
    spots.forEach(([x, z], i) => {
      const h = 2.2 + rnd() * 1.6, s = 1.15 + rnd() * .7;
      dummy.rotation.set(0, 0, 0); dummy.position.set(x, h / 2, z); dummy.scale.set(1, h, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + rnd();
        dummy.position.set(x + Math.cos(a) * .55 * (k ? 1 : 0), h + s * (.35 + k * .32), z + Math.sin(a) * .55 * (k ? 1 : 0));
        dummy.scale.setScalar(s * (1 - k * .18)); dummy.updateMatrix(); leaves.setMatrixAt(i * 3 + k, dummy.matrix);
        leaves.setColorAt(i * 3 + k, tint.set(pick(leafColors)));
      }
      blob(x, z, 1.6);
    });
  }
  // たるんだひも。提灯や旗をさげる。
  const ropeSegments = [];
  function sagLine(a, b, n, sag) {
    const points = [];
    for (let i = 0; i <= n; i++) { const t = i / n; points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t]); }
    for (let i = 0; i < n; i++) ropeSegments.push([points[i], points[i + 1]]);
    return points;
  }
  function buildRopes(color) {
    if (!ropeSegments.length) return;
    const im = instanced(new T.BoxGeometry(.014, .014, 1), basic(color), ropeSegments.length);
    ropeSegments.forEach(([p, q], i) => {
      dummy.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2); dummy.scale.set(1, 1, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
      dummy.lookAt(q[0], q[1], q[2]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
  }
  function pole(x, z, h, material) { cyl(x, h / 2, z, .05, .07, h, material, scene, { solid: true }, 8); obstacle(x, z, .22, .22); blob(x, z, .35); }
  // 屋台（正面は +z）。朝は朝市、夜は縁日。
  function stall(x, z, rotation, { roof, name, sign, goods, lit = false }) {
    const g = group(x, 0, z); g.rotation.y = rotation;
    const wood = std('#9a7650'), dark = std('#4f3b2a');
    box(0, .45, .55, 2.6, .9, .7, wood, g, { solid: true });
    box(0, .92, .55, 2.75, .06, .85, dark, g, { solid: true });
    box(0, 1.2, -.85, 2.6, 2.4, .08, lit ? basic('#ffd9a0') : std('#f1e6d2'), g, { solid: true });
    for (const px of [-1.28, 1.28]) for (const pz of [-.85, .95]) box(px, 1.3, pz, .07, 2.6, .07, dark, g);
    const top = box(0, 2.72, .05, 3.1, .08, 2.5, std('#ffffff', { map: stripes(roof[0], roof[1]) }), g, { solid: true }); top.rotation.x = .2;
    const board = label(name, 0, 2.2, 1.12, 2.6, .5, sign[0], sign[1], 120, 0, g); noRay(board);
    goods.forEach((color, i) => {
      const gx = -1 + i * (2 / Math.max(1, goods.length - 1));
      if (i % 2) cyl(gx, 1.08, .55, .1, .08, .26, std(color), g, {}, 10); else ball(gx, 1.09, .55, .14, std(color), g);
    });
    if (lit) {
      const halo = add(new T.PlaneGeometry(5, 4), glow('#ffb45e', .3, { map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)') }), 0, 1.5, 1.2, g);
      halo.renderOrder = 5;
    }
    const sideways = Math.abs(Math.sin(rotation)) > .7;
    obstacle(x, z, sideways ? 2.4 : 3, sideways ? 3 : 2.4); blob(x, z, 2.6);
    return g;
  }
  // ふわふわ上っていく粒（朝の光、昼のきらめき、夜の火の粉）
  function motes(count, color, opacity, size, area) {
    const im = instanced(new T.SphereGeometry(size, 5, 4), glow(color, opacity), count);
    const list = Array.from({ length: count }, () => ({ x: area.x + (rnd() - .5) * area.w, z: area.z + (rnd() - .5) * area.d, phase: rnd() * 10, speed: .25 + rnd() * .5, sway: .3 + rnd() * .8 }));
    const place = time => list.forEach((p, i) => {
      const y = .4 + ((time * p.speed + p.phase) % 1) * area.h * (.6 + p.sway * .4);
      dummy.position.set(p.x + Math.sin(time * .6 + p.phase) * p.sway, y, p.z + Math.cos(time * .5 + p.phase * 2) * p.sway);
      dummy.scale.setScalar(.6 + .4 * Math.sin(time * 3 + p.phase * 7)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    });
    place(0); tickers.push((time) => { if (reduced) return; place(time * .12); im.instanceMatrix.needsUpdate = true; });
  }
  function birds(count, color, centerY) {
    const geometry = new T.CircleGeometry(.5, 3); geometry.rotateX(-Math.PI / 2); geometry.scale(1, 1, .42);
    const im = instanced(geometry, basic(color, { side: 2 }), count * 2);
    const body = new T.Object3D(), right = new T.Object3D(), left = new T.Object3D(); body.add(right); body.add(left); left.scale.x = -1;
    const list = Array.from({ length: count }, (_, i) => ({ r: 13 + rnd() * 16, y: centerY + rnd() * 6, phase: rnd() * 6.3 + i, speed: (.1 + rnd() * .08) * (i % 2 ? 1 : -1), flap: 5 + rnd() * 3 }));
    const place = time => list.forEach((b, i) => {
      const a = b.phase + time * b.speed, flap = Math.sin(time * b.flap + b.phase) * .65;
      body.position.set(Math.cos(a) * b.r - 2, b.y + Math.sin(time * .7 + b.phase) * .8, 6 + Math.sin(a) * b.r);
      body.rotation.y = -a + (b.speed > 0 ? Math.PI : 0); right.rotation.z = flap; left.rotation.z = -flap;
      body.updateMatrixWorld(true); im.setMatrixAt(i * 2, right.matrixWorld); im.setMatrixAt(i * 2 + 1, left.matrixWorld);
    });
    place(0); tickers.push(time => { if (reduced) return; place(time); im.instanceMatrix.needsUpdate = true; });
  }

  // ── 朝：朝焼けの広場 ──────────────────────────────────────
  function morning() {
    skyDome([[0, '#141c45'], [.16, '#2c3266'], [.3, '#6a5a8f'], [.4, '#c9858a'], [.46, '#f4b98e'], [.5, '#ffd9a8'], [.56, '#e9b99a'], [1, '#b98f8a']]);
    atmosphere('#f3c8a4', 30, 150); ground('#b9a88e');
    lights.hemi.color.set('#ffe6d2'); lights.hemi.groundColor.set('#8a7168'); lights.hemi.intensity = 2.05;
    lights.sun.color.set('#ffc898'); lights.sun.intensity = 3.3;
    stars(70, .5, .5);
    // 朝日。最初に見える向き（店の奥の空）からのぼる。
    const sun = add(new T.PlaneGeometry(150, 150), glow('#ffd9a0', .9, { map: radial('rgba(255,244,220,1)', 'rgba(255,170,110,0)') }), -122, 17, -86, sky);
    sun.lookAt(0, 0, 0);
    const disc = add(new T.CircleGeometry(9, 32), basic('#fff6e0', { fog: false, toneMapped: false }), -120, 16.5, -84.5, sky); disc.lookAt(0, 0, 0);
    tickers.push(time => { if (!reduced) sun.material.opacity = .82 + Math.sin(time * .6) * .08; });
    skyline({ wall: '#e9d9cc', lit: ['#fff3d0', '#c9d6e6', '#f7c9a8'], colors: ['#f6d9c8', '#e8c9d2', '#d9cfe6', '#f3e2c4', '#cfdcea'] });
    trees(['#5c8a5a', '#6f9c62', '#86a86a', '#e9a0ae'], '#7a5a44');

    // 噴水
    const stone = std('#d9d0c0'), water = std('#8fd0e0', { transparent: true, opacity: .82, roughness: .15, metalness: .1 });
    const { x: fx, z: fz } = PLAZA;
    cyl(fx, .22, fz, 2.5, 2.6, .5, stone, scene, { solid: true }, 28); cyl(fx, .47, fz, 2.2, 2.2, .04, water, scene, {}, 28);
    cyl(fx, .9, fz, .32, .5, 1.4, stone, scene, { solid: true }); cyl(fx, 1.62, fz, 1.15, .4, .2, stone, scene, { solid: true }, 20);
    cyl(fx, 1.73, fz, 1.02, 1.02, .03, water, scene, {}, 20); cyl(fx, 2.1, fz, .14, .2, .8, stone); ball(fx, 2.6, fz, .2, std('#e9c07a', { metalness: .5, roughness: .35 }));
    obstacle(fx, fz, 5.3, 5.3); blob(fx, fz, 3.6);
    const drops = instanced(new T.SphereGeometry(.034, 6, 4), basic('#f4fcff', { transparent: true, opacity: .8 }), 132);
    const spray = time => {
      for (let i = 0; i < 132; i++) {
        const arc = i % 12, t = ((i / 12 | 0) / 11 + time * .55 + arc * .083) % 1;
        if (i < 96) { // 上の皿から外へ落ちる8本
          const a = (arc % 8) / 8 * Math.PI * 2 + (i / 12 | 0) * .02, r = .2 + 1.65 * t;
          dummy.position.set(fx + Math.cos(a) * r, 2.6 + 1.5 * t - 3.63 * t * t, fz + Math.sin(a) * r);
        } else { const a = arc / 12 * Math.PI * 2, r = 1.05 + .95 * t; dummy.position.set(fx + Math.cos(a) * r, 1.75 + .5 * t - 1.75 * t * t, fz + Math.sin(a) * r); }
        dummy.scale.setScalar(.7 + t * .8); dummy.updateMatrix(); drops.setMatrixAt(i, dummy.matrix);
      }
    };
    spray(.3); tickers.push(time => { if (reduced) return; spray(time); drops.instanceMatrix.needsUpdate = true; });

    // 旗（ガーランド）
    const poleMaterial = std('#f4efe2'), flagColors = ['#e8695a', '#f2b84b', '#5fa98f', '#5b8fd0', '#e98fb0', '#f6f0e2'];
    const posts = [[6, 15.5], [2.2, 21.8], [-7, 21], [-11, 14]];
    posts.forEach(([x, z]) => { pole(x, z, 4.4, poleMaterial); ball(x, 4.5, z, .12, std('#e9c07a', { metalness: .5, roughness: .4 })); });
    const lines = [];
    posts.forEach(([x, z], i) => { const [nx, nz] = posts[(i + 1) % posts.length]; lines.push(sagLine([x, 4.35, z], [nx, 4.35, nz], 12, .7)); });
    lines.push(sagLine([posts[3][0], 4.35, posts[3][1]], [-4.9, 3.2, 4.5], 12, .6), sagLine([posts[0][0], 4.35, posts[0][1]], [4.9, 3.2, 4.5], 12, .6));
    lines.push(sagLine([-4.9, 3.05, 4.55], [4.9, 3.05, 4.55], 16, .22));
    const flagCount = lines.reduce((n, l) => n + l.length - 2, 0);
    const flags = instanced(new T.CircleGeometry(.2, 3), basic('#ffffff', { side: 2 }), flagCount);
    let f = 0;
    for (const points of lines) for (let i = 1; i < points.length - 1; i++) {
      const [px, py, pz] = points[i], [qx, , qz] = points[i + 1];
      dummy.position.set(px, py - .1, pz); dummy.rotation.set(0, Math.atan2(-(qz - pz), qx - px), -Math.PI / 2); dummy.scale.set(1, .8, 1);
      dummy.updateMatrix(); flags.setMatrixAt(f, dummy.matrix); flags.setColorAt(f, tint.set(flagColors[f % flagColors.length])); f++;
    }
    dummy.rotation.set(0, 0, 0); buildRopes('#f6efe0');

    // 風船。店のうしろや広場から、ゆっくり空へ。
    const balloonColors = ['#ef6f5e', '#f6c04e', '#62b89a', '#5d95dd', '#ee93b6', '#a98fe0'];
    const N = 22, balloons = instanced(new T.SphereGeometry(.34, 12, 9), std('#ffffff', { roughness: .35 }), N), strings = instanced(new T.BoxGeometry(.008, .8, .008), basic('#f4efe2'), N);
    const fleet = Array.from({ length: N }, (_, i) => {
      const tied = i < 6; // 店先に結んだ風船
      const home = tied ? [[-5.5, 4.5], [5.5, 4.5]][i % 2] : (i % 3 ? [-14 + rnd() * 24, -10 - rnd() * 8] : [PLAZA.x - 8 + rnd() * 16, PLAZA.z - 6 + rnd() * 12]);
      balloons.setColorAt(i, tint.set(balloonColors[i % balloonColors.length]));
      return { tied, x: home[0], z: home[1], phase: rnd() * 30, speed: .5 + rnd() * .5, k: (i / 2 | 0) };
    });
    const float = time => fleet.forEach((b, i) => {
      let x = b.x, y, z = b.z;
      if (b.tied) { x += (b.k - 1) * .28 + Math.sin(time * .9 + i) * .06; y = 2.5 + b.k * .22 + Math.sin(time * 1.1 + i) * .05; z += Math.cos(time * .8 + i) * .05; }
      else { const lift = (time * b.speed + b.phase) % 30; y = 1.2 + lift; x += Math.sin(time * .35 + b.phase) * 1.2 + lift * .12; z += Math.cos(time * .3 + b.phase) * .8; }
      dummy.position.set(x, y, z); dummy.scale.set(1, 1.22, 1); dummy.updateMatrix(); balloons.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y - .8, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); strings.setMatrixAt(i, dummy.matrix);
    });
    float(4); tickers.push(time => { if (reduced) return; float(time); balloons.instanceMatrix.needsUpdate = true; strings.instanceMatrix.needsUpdate = true; });

    // 朝市
    stall(-14, 9, Math.PI / 2, { roof: ['#e8695a', '#fbf4e6'], name: '朝のパン', sign: ['#fbf4e6', '#a5492f'], goods: ['#d9a25e', '#c98a45', '#e6bd7c', '#b9783c', '#deb06a'] });
    stall(-14, 14, Math.PI / 2, { roof: ['#5fa98f', '#fbf4e6'], name: 'くだもの', sign: ['#fbf4e6', '#2f6b56'], goods: ['#e4573f', '#f2b134', '#8dbb4c', '#f08a3c', '#c7374a'] });
    stall(-14, 19, Math.PI / 2, { roof: ['#f2b84b', '#fbf4e6'], name: '花', sign: ['#fbf4e6', '#9a6a12'], goods: ['#ee93b6', '#f6f0e2', '#a98fe0', '#f6c04e', '#ef6f5e'] });
    birds(9, '#3b3556', 11);
    motes(46, '#ffe2b0', .55, .05, { x: -2, z: 11, w: 26, d: 22, h: 7 });
  }

  // ── 昼：雲の上に浮かぶ街 ────────────────────────────────────
  function day() {
    skyDome([[0, '#2f86e0'], [.2, '#4f9fe8'], [.36, '#86c2f2'], [.46, '#c4e3f8'], [.5, '#e8f5fd'], [.56, '#d3eafa'], [.75, '#a9d2f1'], [1, '#7fb7e6']]);
    atmosphere('#d9eefb', 55, 210);
    lights.hemi.color.set('#e6f4ff'); lights.hemi.groundColor.set('#9aa68a'); lights.hemi.intensity = 2.45;
    lights.sun.color.set('#fff6dc'); lights.sun.intensity = 3.9;
    const sunGlow = add(new T.PlaneGeometry(120, 120), glow('#ffffff', .85, { map: radial('rgba(255,255,240,1)', 'rgba(255,255,255,0)') }), -70, 118, 70, sky); sunGlow.lookAt(0, 0, 0);

    // 街がのっている浮島。草のふち、その下は岩。
    const grass = std('#8fbf6a', { roughness: 1 }), rock = std('#8d7b68', { roughness: 1, flatShading: true }), rockDark = std('#6f6052', { roughness: 1, flatShading: true });
    cyl(0, -.22, 3, 38, 37, .3, grass, scene, {}, 40); cyl(0, -15.4, 3, 37, 6, 30, rock, scene, {}, 11); cyl(4, -34, 1, 9, 1, 14, rockDark, scene, {}, 7);
    trees(['#6fae5c', '#86c06a', '#5a9a58', '#a5d07a'], '#7a5a44');

    // 雲。足もとの雲海と、空の高い雲が、別々の速さでゆっくり回る。
    function clouds(count, radius, height, size, speed) {
      const holder = group(0, 0, 3);
      const im = instanced(new T.SphereGeometry(1, 10, 7), std('#ffffff', { roughness: 1, emissive: '#bcd9ee', emissiveIntensity: .6, fog: false }), count * 6, holder);
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2 + rnd() * .5, r = radius[0] + rnd() * (radius[1] - radius[0]), y = height[0] + rnd() * (height[1] - height[0]), s = size * (.7 + rnd() * .9);
        for (let k = 0; k < 6; k++) {
          dummy.position.set(Math.cos(a) * r + (k - 2.5) * s * .75 + rnd() * s * .4, y + (k % 2 ? .25 : 0) * s + rnd() * s * .2, Math.sin(a) * r + (rnd() - .5) * s * 1.2);
          dummy.scale.set(s * (.9 + rnd() * .6), s * (.5 + rnd() * .3), s * (.8 + rnd() * .5)); dummy.updateMatrix(); im.setMatrixAt(i * 6 + k, dummy.matrix);
        }
      }
      tickers.push((time) => { if (!reduced) holder.rotation.y = time * speed; });
    }
    clouds(34, [48, 150], [-16, -5], 7, .006); clouds(16, [42, 140], [22, 60], 6, -.004); clouds(7, [26, 40], [9, 16], 2.2, .012);

    // 遠くに浮かぶ島々。小さな家と木、いくつかは滝つき。
    const fall = texture((c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${.25 + rnd() * .6})`; c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 20 + rnd() * 60); } }, 64, 256);
    fall.wrapS = fall.wrapT = T.RepeatWrapping;
    const fallMaterial = basic('#dff3ff', { map: fall, transparent: true, opacity: .85, side: 2, depthWrite: false });
    tickers.push((time) => { if (!reduced) fall.offset.y = time * .35; });
    const roofs = ['#e0705a', '#5b8fd0', '#f2b84b'];
    const islands = [[-34, 15, -46, 2.2, 1], [-42, 18, -6, 2.4, 0], [-8, 23, -48, 2.8, 1], [14, 15, -38, 1.5, 0], [-34, 7, 24, 1.9, 1], [30, 12, 32, 2.1, 0], [42, 20, -8, 2.6, 1], [-14, 27, 44, 2.2, 0]].map(([x, y, z, s, withFall], i) => {
      const g = group(x, y, z); g.scale.setScalar(s);
      cyl(0, -2, 0, 3, .4, 4, i % 2 ? rock : rockDark, g, {}, 7); cyl(0, .12, 0, 3.15, 3, .3, grass, g, {}, 7);
      box(-.4, .75, .2, 1.1, .9, .9, std('#f6efe2'), g); const roof = cyl(-.4, 1.5, .2, 0, .95, .65, std(roofs[i % 3]), g, {}, 4); roof.rotation.y = Math.PI / 4;
      for (const [tx, tz] of [[1.4, -.6], [1.1, 1.2], [-1.7, -1]]) { cyl(tx, .6, tz, .07, .1, .8, std('#7a5a44'), g, {}, 6); cyl(tx, 1.5, tz, 0, .55, 1.3, std('#5a9a58'), g, {}, 7); }
      if (withFall) { const w = add(new T.PlaneGeometry(.9, 7), fallMaterial, 2.2, -3.3, 2.2, g); w.rotation.y = Math.PI / 4; }
      return { g, y, phase: i * 1.3 };
    });
    tickers.push((time) => { if (!reduced) for (const it of islands) it.g.position.y = it.y + Math.sin(time * .35 + it.phase) * .7; });

    // 広場のまんなか：浮かぶクリスタル
    const { x: cx, z: cz } = PLAZA, stone = std('#e6e2d6'), gold = std('#e9c46a', { metalness: .7, roughness: .3, emissive: '#b98a2a', emissiveIntensity: .35 });
    cyl(cx, .15, cz, 2.3, 2.5, .3, stone, scene, { solid: true }, 8); cyl(cx, .42, cz, 1.7, 1.9, .26, stone, scene, { solid: true }, 8); cyl(cx, .75, cz, 1, 1.25, .4, stone, scene, { solid: true }, 8);
    obstacle(cx, cz, 4.6, 4.6); blob(cx, cz, 3.4);
    const crystal = ball(cx, 3.5, cz, .75, std('#aef6ff', { emissive: '#18b8f0', emissiveIntensity: .7, roughness: .12, metalness: .1, flatShading: true }), scene, {}, 4, 2); crystal.scale.y = 1.8;
    const halo = add(new T.PlaneGeometry(5.5, 5.5), glow('#8fe9ff', .3, { map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)') }), cx, 3.5, cz);
    const beam = add(new T.CylinderGeometry(.25, .8, 46, 16, 1, true), glow('#bff3ff', .08, { side: 2 }), cx, 26, cz);
    const rings = [[1.5, .04], [1.95, .032], [2.4, .026]].map(([r, tube], i) => { const ring = add(new T.TorusGeometry(r, tube, 8, 56), gold, cx, 3.5, cz); ring.rotation.set(i * 1.1, i * .7, 0); return ring; });
    const pebbles = Array.from({ length: 7 }, (_, i) => ball(cx, 3, cz, .16 + rnd() * .16, i % 2 ? rock : rockDark, scene, {}, 5, 3));
    const light = new T.PointLight('#7fe6ff', 16, 15, 2); light.position.set(cx, 3.4, cz); scene.add(light);
    const spin = time => {
      crystal.position.y = 3.5 + Math.sin(time * .9) * .22; crystal.rotation.y = time * .5; halo.position.y = crystal.position.y; halo.lookAt(camera.position);
      halo.material.opacity = .26 + Math.sin(time * 1.7) * .08; beam.material.opacity = .075 + Math.sin(time * 1.3) * .02;
      rings.forEach((ring, i) => { ring.position.y = crystal.position.y; ring.rotation.x = i * 1.1 + time * (.35 + i * .12); ring.rotation.y = i * .7 + time * (.22 - i * .09); });
      pebbles.forEach((p, i) => { const a = time * (.3 + i * .02) + i * .9; p.position.set(cx + Math.cos(a) * (3.3 + (i % 3) * .45), 1.7 + Math.sin(time * .8 + i) * .4 + (i % 3) * .35, cz + Math.sin(a) * (3.3 + (i % 3) * .45)); p.rotation.set(time * .4 + i, time * .3, 0); });
    };
    spin(0); tickers.push(time => spin(reduced ? 0 : time));

    // 気球
    const balloonArt = [['#ef6f5e', '#fbf4e6'], ['#5d95dd', '#fbf4e6'], ['#f2b84b', '#62b89a']];
    const fleet = balloonArt.map(([a, b], i) => {
      const g = group();
      const envelope = ball(0, 0, 0, 2.3, std('#ffffff', { map: stripes(a, b, 12), roughness: .6 }), g, {}, 18, 12); envelope.scale.y = 1.18;
      cyl(0, -2.9, 0, .9, .35, 1.1, std(a), g, {}, 10); box(0, -4.1, 0, .8, .6, .8, std('#9a7650'), g);
      for (const [rx, rz] of [[-.36, -.36], [.36, -.36], [-.36, .36], [.36, .36]]) box(rx, -3.6, rz, .02, .7, .02, basic('#5c4938'), g);
      return { g, r: 22 + i * 9, y: 11 + i * 4.5, phase: i * 2.2, speed: (.035 + i * .01) * (i % 2 ? -1 : 1) };
    });
    const drift = time => fleet.forEach(b => { const a = b.phase + time * b.speed; b.g.position.set(Math.cos(a) * b.r - 4, b.y + Math.sin(time * .4 + b.phase) * 1.2, -2 + Math.sin(a) * b.r); b.g.rotation.y = time * .1 + b.phase; });
    drift(0); tickers.push(time => { if (!reduced) drift(time); });

    // 虹。最初の景色（店の奥の空）にかかる。
    const rainbow = group(-16, -7, -40); rainbow.rotation.y = .45;
    ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'].forEach((color, i) => add(new T.TorusGeometry(40 - i * .75, .4, 6, 64, Math.PI), basic(color, { transparent: true, opacity: .34, fog: false, depthWrite: false }), 0, 0, 0, rainbow));

    birds(8, '#ffffff', 12);
    motes(60, '#fff6c8', .7, .05, { x: -2, z: 10, w: 28, d: 26, h: 8 });
  }

  // ── 夜：夜祭り ───────────────────────────────────────────
  function night() {
    skyDome([[0, '#040714'], [.22, '#0a1026'], [.4, '#111a3a'], [.5, '#1f2c5e'], [.56, '#141c40'], [1, '#080c1e']]);
    atmosphere('#141c40', 26, 140); ground('#161a2a');
    lights.hemi.color.set('#8c9be0'); lights.hemi.groundColor.set('#3a2a30'); lights.hemi.intensity = 1.0;
    lights.sun.color.set('#a9b9ff'); lights.sun.intensity = .9;
    lights.fill.intensity = 36; lights.fill.distance = 19;
    renderer.toneMappingExposure = 1.15;
    const twinkleA = stars(260, .95), twinkleB = stars(220, .6);
    tickers.push(time => { if (reduced) return; twinkleA.opacity = .8 + Math.sin(time * 1.3) * .2; twinkleB.opacity = .55 + Math.sin(time * 2.1 + 2) * .3; });
    const moon = add(new T.CircleGeometry(8, 40), basic('#fff6dc', { fog: false, toneMapped: false }), -70, 62, -125, sky); moon.lookAt(0, 0, 0);
    const moonHalo = add(new T.PlaneGeometry(70, 70), glow('#bcc8ff', .5, { map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)') }), -70.5, 62.5, -126, sky); moonHalo.lookAt(0, 0, 0);
    skyline({ wall: '#0e1328', lit: ['#ffd58a', '#ffb86b', '#9fd0ff', '#ffe9b8'], colors: ['#ffffff', '#c9cdf0', '#e8d6c0', '#a9b4e6'] });
    trees(['#1f3a36', '#243f3a', '#1a302f'], '#2a2019');

    // やぐら
    const { x: yx, z: yz } = PLAZA, timber = std('#8a5a3a'), red = std('#c8372d'), kohaku = stripes('#d83a2e', '#fbf4e6', 10);
    for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) box(yx + px, 1.6, yz + pz, .24, 3.2, .24, timber, scene, { solid: true });
    box(yx, 3.25, yz, 3.7, .22, 3.7, timber, scene, { solid: true });
    for (let side = 0; side < 4; side++) {
      const a = side * Math.PI / 2, curtain = add(new T.PlaneGeometry(3.5, 1.15), basic('#ffffff', { map: kohaku, side: 2 }), yx + Math.sin(a) * 1.78, 2.6, yz + Math.cos(a) * 1.78, scene, { solid: true }); curtain.rotation.y = a;
      const rail = box(yx + Math.sin(a) * 1.78, 3.85, yz + Math.cos(a) * 1.78, 3.6, .08, .08, red); rail.rotation.y = a;
    }
    for (const [px, pz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) box(yx + px, 4.75, yz + pz, .14, 2.8, .14, red);
    const roof = cyl(yx, 6.75, yz, 0, 3.3, 1.5, std('#7a1f1c'), scene, {}, 4); roof.rotation.y = Math.PI / 4;
    const drum = cyl(yx, 4.15, yz, .62, .62, 1.1, std('#7a3a22'), scene, {}, 18); drum.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) { const skin = cyl(yx + side * .56, 4.15, yz, .56, .56, .02, basic('#f6ead2'), scene, {}, 18); skin.rotation.z = Math.PI / 2; }
    box(yx, 3.6, yz, .9, .5, .5, timber);
    obstacle(yx, yz, 3.9, 3.9); blob(yx, yz, 3.4);

    // 提灯。やぐらから柱と店先へ。店の軒にも一列。
    const poleMaterial = std('#5c4938'), posts = [[6, 15.5], [2.2, 21.4], [-6.9, 20.75], [-10.8, 14]], lanterns = [];
    posts.forEach(([x, z]) => pole(x, z, 3.9, poleMaterial));
    const hang = (points, skipEnds = 1) => { for (let i = skipEnds; i < points.length - skipEnds; i++) lanterns.push([points[i][0], points[i][1] - .24, points[i][2]]); };
    for (const [x, z] of posts) hang(sagLine([yx + Math.sign(x - yx) * 1.2, 6.1, yz + Math.sign(z - yz) * 1.2], [x, 3.85, z], 7, .5));
    hang(sagLine([yx - 1.2, 6.1, yz - 1.2], [-4.9, 3.3, 4.55], 9, .6)); hang(sagLine([yx + 1.2, 6.1, yz - 1.2], [3.4, 3.3, 4.55], 9, .6));
    posts.forEach(([x, z], i) => { const [nx, nz] = posts[(i + 1) % posts.length]; if (i < 3) hang(sagLine([x, 3.85, z], [nx, 3.85, nz], 8, .45)); });
    hang(sagLine([-5.1, 3.12, 4.62], [5.1, 3.12, 4.62], 12, .1));
    hang(sagLine([6.1, 3.1, 3.25], [9.9, 3.1, 3.25], 5, .1));
    buildRopes('#2a2019');
    const bodies = instanced(new T.SphereGeometry(.17, 12, 9), basic('#ffffff', { fog: false, toneMapped: false }), lanterns.length);
    // ぼんやりした光。いつもカメラのほうを向く板。
    const halos = instanced(new T.PlaneGeometry(1.5, 1.5), glow('#ff9a4a', .5, { map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)') }), lanterns.length);
    const caps = instanced(new T.CylinderGeometry(.08, .08, .44, 8), basic('#1c1512'), lanterns.length);
    const lanternColors = ['#ff6a3c', '#ff6a3c', '#ffcf6a', '#ff5340'];
    lanterns.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z); dummy.scale.set(1, 1.28, 1); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix); bodies.setColorAt(i, tint.set(lanternColors[i % 4]));
      dummy.scale.set(1, 1, 1); dummy.updateMatrix(); caps.setMatrixAt(i, dummy.matrix);
    });
    const faceCamera = () => { dummy.scale.setScalar(1); lanterns.forEach(([x, y, z], i) => { dummy.position.set(x, y, z); dummy.quaternion.copy(camera.quaternion); dummy.updateMatrix(); halos.setMatrixAt(i, dummy.matrix); }); dummy.rotation.set(0, 0, 0); halos.instanceMatrix.needsUpdate = true; };
    faceCamera();
    tickers.push(time => { faceCamera(); if (!reduced) halos.material.opacity = .48 + Math.sin(time * 2.3) * .06 + Math.sin(time * 7.1) * .025; });
    for (const [lx, ly, lz, power, reach] of [[yx, 5.2, yz, 60, 24], [-11.5, 3, 15, 34, 16], [-3, 3, 20.5, 34, 16]]) { const l = new T.PointLight('#ffb36b', power, reach, 1.8); l.position.set(lx, ly, lz); scene.add(l); }

    // 屋台
    const cream = '#fbf4e6';
    stall(-14, 9, Math.PI / 2, { lit: true, roof: ['#3f8fd8', cream], name: 'かき氷', sign: ['#1f5fa8', cream], goods: ['#ff7b8a', '#7fd6ff', '#ffe066', '#9be37a', '#ff9ad5'] });
    stall(-14, 14, Math.PI / 2, { lit: true, roof: ['#d83a2e', cream], name: '射的', sign: ['#a5261d', cream], goods: ['#f2b84b', '#5fa98f', '#e8695a', '#5b8fd0', '#f6f0e2'] });
    stall(-14, 19, Math.PI / 2, { lit: true, roof: ['#f2a02e', cream], name: 'からあげ', sign: ['#a85a0e', cream], goods: ['#c98a45', '#d9a25e', '#b9783c', '#deb06a', '#c98a45'] });
    stall(-8.5, 23.2, Math.PI, { lit: true, roof: ['#e0503a', cream], name: '金魚すくい', sign: ['#b53220', cream], goods: ['#ff5a3c', '#ffb03c', '#ff5a3c', '#ffffff', '#ff7a4a'] });
    stall(-3, 23.2, Math.PI, { lit: true, roof: ['#8a4fc8', cream], name: 'たこ焼き', sign: ['#5e2f96', cream], goods: ['#c98a45', '#b9783c', '#c98a45', '#b9783c', '#c98a45'] });
    stall(2.5, 23.2, Math.PI, { lit: true, roof: ['#2fa58a', cream], name: 'ヨーヨー', sign: ['#1c7560', cream], goods: ['#ff6fa5', '#5fd0ff', '#ffe066', '#9be37a', '#c79bff'] });

    // 花火
    const SHELLS = 4, SPARKS = 72, sparks = instanced(new T.SphereGeometry(.5, 5, 4), glow('#ffffff', 1), SHELLS * SPARKS);
    const palette = ['#ff5f6d', '#ffd166', '#7ae7ff', '#b28dff', '#8dffb0', '#ff9ad5', '#ffffff'];
    const shells = Array.from({ length: SHELLS }, (_, s) => ({ start: -s * 1.15, life: 3, origin: [0, 0, 0], size: 1, dirs: Array.from({ length: SPARKS }, () => [0, 0, 0]), index: s }));
    function launch(shell, time) {
      // 半分は店の奥の空（最初に見える向き）、半分は広場の上
      const far = rnd() < .6, a = far ? Math.PI * (1.05 + rnd() * .55) : rnd() * Math.PI * 2, r = far ? 34 + rnd() * 26 : 20 + rnd() * 22;
      shell.origin = [Math.cos(a) * r, 22 + rnd() * 18, (far ? 0 : 10) + Math.sin(a) * r]; shell.start = time; shell.life = 2.7 + rnd() * .9; shell.size = 12 + rnd() * 8;
      const main = pick(palette), second = pick(palette), ring = rnd() < .3;
      shell.dirs.forEach((d, i) => {
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, flat = Math.sqrt(1 - u * u), speed = ring ? 1 : .55 + rnd() * .45;
        d[0] = Math.cos(t) * flat * speed; d[1] = (ring ? u * .25 : u) * speed; d[2] = Math.sin(t) * flat * speed;
        sparks.setColorAt(shell.index * SPARKS + i, tint.set(i % 3 ? main : second));
      });
      sparks.instanceColor.needsUpdate = true;
    }
    const burn = time => {
      for (const shell of shells) {
        let age = time - shell.start;
        if (age > shell.life + .5 && !reduced) { launch(shell, time); age = 0; }
        const t = Math.max(0, age) / shell.life, spread = shell.size * (1 - Math.exp(-4.2 * t)), fade = age < 0 || t >= 1 ? 0 : Math.pow(1 - t, .7) * (.75 + .25 * Math.sin(age * 30 + shell.index));
        shell.dirs.forEach((d, i) => {
          dummy.position.set(shell.origin[0] + d[0] * spread, shell.origin[1] + d[1] * spread - 3.2 * t * t, shell.origin[2] + d[2] * spread);
          dummy.scale.setScalar(Math.max(.0001, fade)); dummy.updateMatrix(); sparks.setMatrixAt(shell.index * SPARKS + i, dummy.matrix);
        });
      }
      sparks.instanceMatrix.needsUpdate = true;
    };
    shells.forEach((shell, s) => { launch(shell, 0); shell.start = reduced ? -1.1 : -s * 1.15 + .4; });
    burn(0); tickers.push(time => { if (!reduced) burn(time); });

    motes(54, '#ffb35c', .8, .045, { x: -5, z: 14, w: 22, d: 20, h: 6 });
  }

  ({ morning, day, night }[mode] || day)();
  return {
    mode,
    update(ms) { const time = ms / 1000; for (const tick of tickers) tick(time); }
  };
}
