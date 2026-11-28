/* 11/28 オーナー：「旧SchoolParkの願いの泉を、SchoolPark City の真ん中の置物でできない？ 朝・昼・夜で変わる」
   - 夜（やぐら）：太鼓に近づいて願いを書く → 太鼓を叩く → 音とともに花火が上がる → 「あなたの願いが叶いますように！」
   - 朝（噴水）・昼（クリスタル）：置物に近づいて願いを書く → 願いが光になって空へ浮かんでいく → 「あなたの願いが叶いますように！」
   書いた願いは、この端末の画面に出すだけ。サーバーにも計測（PostHog）にも送らない（どこにも残さない）。
   音は、願いを届けるボタンを押したときだけ鳴らす（その場で作る音。外の音のファイルは読まない）。 */
export const WISH_NEAR = 6.2;
export const WISH_MAX = 60;

export function createWish(T, { scene, disposables, texture, at, mode = 'day', viewCamera }) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keep = (x) => { disposables.add(x); return x; };
  const noRay = (o) => { o.raycast = () => {}; o.castShadow = false; o.receiveShadow = false; return o; };
  const night = mode === 'night';
  const root = new T.Group(); root.visible = false; scene.add(root);
  const glowMap = texture((c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,240,200,.85)'); g.addColorStop(1, 'rgba(255,220,150,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }, 128, 128);
  const glowMaterial = (color, opacity = 1) => keep(new T.MeshBasicMaterial({ color, map: glowMap, transparent: true, opacity, depthWrite: false, blending: 2, fog: false, toneMapped: false }));
  const plane = (w, h, material) => noRay(new T.Mesh(keep(new T.PlaneGeometry(w, h)), material));
  // 願いの光（朝・昼）と、太鼓の波（夜）
  const orb = plane(1.6, 1.6, glowMaterial(night ? '#ffd27a' : mode === 'morning' ? '#ffc6a8' : '#a8f2ff')); root.add(orb);
  const ring = noRay(new T.Mesh(keep(new T.TorusGeometry(1, .06, 8, 48)), glowMaterial('#ffcf6a', .9))); root.add(ring);
  // 光の粒（尾・花火）
  const SPARKS = 160;
  const sparkMaterial = keep(new T.MeshBasicMaterial({ color: '#ffffff', map: glowMap, transparent: true, depthWrite: false, blending: 2, fog: false, toneMapped: false }));
  const sparks = noRay(new T.InstancedMesh(keep(new T.PlaneGeometry(.5, .5)), sparkMaterial, SPARKS)); sparks.frustumCulled = false; root.add(sparks);
  const colors = night ? ['#ff5f6d', '#ffd166', '#ff9ad5', '#7ae7ff', '#ffffff', '#b28dff'] : mode === 'morning' ? ['#ffd1b8', '#fff3c4', '#ffb3c7', '#ffffff'] : ['#bff8ff', '#e3fbff', '#ffe9a8', '#ffffff'];
  const tint = new T.Color(), dummy = new T.Object3D();
  const dirs = Array.from({ length: SPARKS }, () => [0, 0, 0, 0]);
  for (let i = 0; i < SPARKS; i++) sparks.setColorAt(i, tint.set(colors[i % colors.length]));
  sparks.instanceColor.needsUpdate = true;
  let card = null, cardMaterial = null, cardMap = null;
  let run = null;   // { kind, start, text, done }
  const center = new T.Vector3(at.x, night ? 4.15 : mode === 'morning' ? 2.6 : 3.5, at.z);
  // 花火・光がのぼっていく先。置物の真上ではなく、見ている人から見て置物の向こうの空（やぐらの屋根やアバターに隠れない）
  const sky = new T.Vector3(at.x, 16, at.z);

  function makeCard(text) {
    if (card) { root.remove(card); cardMap?.dispose(); cardMaterial?.dispose(); card.geometry.dispose(); }
    cardMap = texture((c, w, h) => {
      c.clearRect(0, 0, w, h);
      const r = 60; c.fillStyle = night ? 'rgba(40,20,60,.62)' : 'rgba(255,255,255,.55)';
      c.beginPath(); c.moveTo(r, 0); c.arcTo(w, 0, w, h, r); c.arcTo(w, h, 0, h, r); c.arcTo(0, h, 0, 0, r); c.arcTo(0, 0, w, 0, r); c.fill();
      c.fillStyle = night ? '#fff6e0' : '#5a3b2a'; c.textAlign = 'center'; c.textBaseline = 'middle';
      let size = 64; c.font = `700 ${size}px 'Zen Kaku Gothic New', system-ui, sans-serif`;
      while (c.measureText(text).width > w - 80 && size > 28) { size -= 4; c.font = `700 ${size}px 'Zen Kaku Gothic New', system-ui, sans-serif`; }
      const words = [...text]; let line = '', lines = [];
      for (const ch of words) { if (c.measureText(line + ch).width > w - 80) { lines.push(line); line = ch; } else line += ch; }
      lines.push(line); lines = lines.slice(0, 2);
      lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.2));
    }, 1024, 256);
    disposables.delete(cardMap);
    cardMaterial = new T.MeshBasicMaterial({ map: cardMap, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    // 願いの文字は、やぐらの屋根や木に隠れないよう、いちばん手前に描く
    card = noRay(new T.Mesh(new T.PlaneGeometry(4, 1), cardMaterial)); card.renderOrder = 20; root.add(card);
  }

  /* ── 音（その場で作る） ── */
  let audio = null;
  function ctx() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); return audio; } catch (_) { return null; } }
  function noise(a, when, length, freq, gain) {
    const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = a.createBufferSource(), filter = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = freq; g.gain.value = gain;
    src.connect(filter).connect(g).connect(a.destination); src.start(when);
  }
  function tone(a, when, from, to, length, gain, type = 'sine') {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(from, when); o.frequency.exponentialRampToValueAtTime(to, when + length);
    g.gain.setValueAtTime(gain, when); g.gain.exponentialRampToValueAtTime(.0001, when + length);
    o.connect(g).connect(a.destination); o.start(when); o.stop(when + length + .05);
  }
  function drumSound() { const a = ctx(); if (!a) return; const t = a.currentTime; tone(a, t, 120, 42, .9, .9); tone(a, t, 240, 90, .25, .25, 'triangle'); noise(a, t, .18, 900, .35); }
  function fireworkSound(delay) { const a = ctx(); if (!a) return; const t = a.currentTime + delay; tone(a, t - .9, 500, 1400, .8, .05, 'triangle'); noise(a, t, 1.2, 2400, .5); noise(a, t + .05, .9, 600, .6); }
  function chimeSound() { const a = ctx(); if (!a) return; const t = a.currentTime; [[880, 0], [1318.5, .12], [1760, .24], [2637, .4]].forEach(([f, d]) => tone(a, t + d, f, f * .998, 1.6, .12)); }

  /* 願いを届ける。終わったら resolve（画面に「叶いますように！」を出すのは呼ぶ側） */
  function play(text, away) {
    const ax = Number(away && away.x) || 0, az = Number(away && away.z) || 0, len = Math.hypot(ax, az) || 1;
    const off = night ? 13 : 9;
    sky.set(center.x + ax / len * off, night ? 19 : 15, center.z + az / len * off);
    const wish = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, WISH_MAX);
    if (!wish) return Promise.resolve(false);
    makeCard(wish);
    root.visible = true;
    if (night) drumSound(); else chimeSound();
    if (night) fireworkSound(1.25);
    return new Promise((resolve) => { run = { start: -1, wish, resolve }; });
  }
  const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  function face(o) { const cam = viewCamera(); o.quaternion.copy(cam.quaternion); }
  function update(time) {
    if (!run) return;
    if (run.start < 0) {
      run.start = time;
      // 粒の向きを決める（夜は花火の広がり、朝・昼は光の尾）
      for (const d of dirs) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, f = Math.sqrt(1 - u * u), s = .6 + Math.random() * .4; d[0] = Math.cos(a) * f * s; d[1] = u * s; d[2] = Math.sin(a) * f * s; d[3] = Math.random(); }
    }
    const age = time - run.start, total = reduced ? 2.4 : night ? 5.2 : 5;
    if (night) {
      // 太鼓の波 → 打ち上げ → 花火の中に願い
      const hit = age / .7;
      ring.visible = hit < 1; ring.position.copy(center); ring.scale.setScalar(.7 + ease(hit) * 3.2); ring.material.opacity = .9 * (1 - hit); face(ring);
      const rise = (age - .35) / .9, burst = (age - 1.25) / 3.4;
      orb.visible = rise > 0 && rise < 1; orb.position.lerpVectors(center, sky, ease(rise)); orb.scale.setScalar(.6); face(orb);
      for (let i = 0; i < SPARKS; i++) {
        const d = dirs[i], spread = 8 * (1 - Math.exp(-4 * Math.max(0, burst)));
        dummy.position.set(sky.x + d[0] * spread, sky.y + d[1] * spread - 2.5 * burst * burst, sky.z + d[2] * spread);
        const fade = burst <= 0 || burst >= 1 ? 0 : Math.pow(1 - burst, .7) * (.7 + .3 * Math.sin(age * 25 + i));
        dummy.scale.setScalar(Math.max(.0001, fade * 1.3)); face(dummy); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
      }
      if (card) { card.visible = burst > .05; card.position.set(sky.x, sky.y - .3, sky.z); cardMaterial.opacity = burst < .15 ? burst / .15 : burst > .8 ? Math.max(0, (1 - burst) / .2) : 1; card.scale.setScalar(2.2); face(card); }
    } else {
      // 置物から、願いが光になって空へ
      ring.visible = age < .8; ring.position.copy(center); ring.scale.setScalar(.6 + ease(age / .8) * 2.4); ring.material.opacity = .7 * (1 - age / .8); face(ring);
      const rise = age / 4.2, k0 = ease(rise);
      const px = center.x + (sky.x - center.x) * k0 + Math.sin(age * 1.3) * .5, py = center.y + .4 + (sky.y + 4 - center.y) * k0, pz = center.z + (sky.z - center.z) * k0;
      orb.visible = rise < 1; orb.position.set(px, py, pz); orb.scale.setScalar(1 + Math.sin(age * 6) * .08); orb.material.opacity = rise > .8 ? (1 - rise) / .2 : 1; face(orb);
      for (let i = 0; i < SPARKS; i++) {
        const d = dirs[i], lag = d[3] * 1.4, k = Math.max(0, age - lag) / 4.2;
        const kk = ease(k);
        dummy.position.set(center.x + (sky.x - center.x) * kk + d[0] * .8, center.y + .4 + (sky.y + 4 - center.y) * kk - d[3] * 1.2, center.z + (sky.z - center.z) * kk + d[2] * .8);
        const fade = k <= 0 || k >= 1 ? 0 : (1 - k) * (.5 + .5 * Math.sin(age * 9 + i));
        dummy.scale.setScalar(Math.max(.0001, fade * .5)); face(dummy); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
      }
      if (card) { card.visible = rise < 1; card.position.set(px, py + 1.2, pz); cardMaterial.opacity = rise > .75 ? Math.max(0, (1 - rise) / .25) : Math.min(1, age / .4); card.scale.setScalar(1); face(card); }
    }
    sparks.instanceMatrix.needsUpdate = true;
    if (age >= total) { const r = run.resolve; run = null; root.visible = false; r(true); }
  }
  return { play, update, get busy() { return !!run; }, center, sky };
}
