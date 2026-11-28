/* 11/28 オーナー：「リアルタイム天気の同期と、カスタム天候の追加」。
   - リアル：福岡（SchoolPark のある街）のいまの天気を Open-Meteo（鍵の要らない公開の天気API）から読む。
     送るのは決まった緯度・経度だけ。使う人の場所・名前・ID などは送らない。30分は同じ答えを使う。
     読めないときは晴れのまま（City はいつもどおり歩ける）。
   - カスタム：晴れ・くもり・雨・雪・霧・雷雨から選べる（選んだものは、この端末に覚えておく）。
   - 雨と雪は、自分のまわりだけに降らせる（軽い）。お店の中・あそび場の屋根の下には降らない。
   - 雷の光は、動きを減らす設定（prefers-reduced-motion）の人には出さない。 */
export const WEATHER_KINDS = ['real', 'clear', 'cloudy', 'rain', 'snow', 'fog', 'storm'];
export const WEATHER_LABEL = { real: 'リアル', clear: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪', fog: '霧', storm: '雷雨' };
export const WEATHER_ICON = { real: '📡', clear: '☀️', cloudy: '☁️', rain: '🌧️', snow: '❄️', fog: '🌫️', storm: '⛈️' };
const SPOT = { name: '福岡', latitude: 33.59, longitude: 130.40 };
const CACHE_KEY = 'sp-city-weather-real-v1', CACHE_MS = 30 * 60 * 1000;

/* WMO の天気コード → City の天気 */
export function weatherFromCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'clear';
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 2 || c === 3) return 'cloudy';
  return 'clear';
}

export async function fetchRealWeather({ fetchImpl = globalThis.fetch, storage = safeStorage(), now = Date.now(), timeoutMs = 6000 } = {}) {
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
    if (cached && now - cached.at < CACHE_MS && WEATHER_KINDS.includes(cached.kind)) return cached;
  } catch (_) {}
  if (typeof fetchImpl !== 'function') return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : 0;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${SPOT.latitude}&longitude=${SPOT.longitude}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
    const response = await fetchImpl(url, { signal: abort?.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const data = await response.json();
    const code = data?.current?.weather_code;
    const temp = Number(data?.current?.temperature_2m);
    if (!Number.isFinite(Number(code))) return null;
    const result = { at: now, kind: weatherFromCode(code), code: Number(code), temp: Number.isFinite(temp) ? Math.round(temp) : null, place: SPOT.name };
    try { storage?.setItem(CACHE_KEY, JSON.stringify(result)); } catch (_) {}
    return result;
  } catch (_) {
    return null;
  } finally { clearTimeout(timer); }
}
function safeStorage() { try { return globalThis.localStorage || null; } catch (_) { return null; } }

/* 3D の天気。createAtmosphere（朝・昼・夜）が決めた空・霧・光を「もと」にして、そこから暗くする・霧を濃くする */
const LOOK = {
  clear: { light: 1, sun: 1, deck: 0, near: 1, far: 1, mix: 0, color: '#9aa3a8', rain: 0, snow: 0 },
  cloudy: { light: .7, sun: .35, deck: .42, near: .8, far: .75, mix: .35, color: '#a2abb1', rain: 0, snow: 0 },
  rain: { light: .55, sun: .18, deck: .62, near: .45, far: .55, mix: .6, color: '#7f8a92', rain: 1400, snow: 0 },
  storm: { light: .4, sun: .1, deck: .8, near: .35, far: .45, mix: .75, color: '#4d5660', rain: 2400, snow: 0 },
  snow: { light: .85, sun: .4, deck: .5, near: .55, far: .6, mix: .65, color: '#dfe4ea', rain: 0, snow: 1300 },
  fog: { light: .78, sun: .3, deck: .6, near: .08, far: .3, mix: .9, color: '#cdd3d6', rain: 0, snow: 0 }
};
const BOX = 22, HIGH = 12;
export function createWeather(T, { scene, lights, disposables, mode = 'day', roofs = [] }) {
  const keep = (x) => { disposables.add(x); return x; };
  const night = mode === 'night';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = { hemi: lights.hemi.intensity, sun: lights.sun.intensity, near: scene.fog?.near ?? 24, far: scene.fog?.far ?? 70, fog: scene.fog?.color?.clone() || new T.Color('#dce3da') };
  // 雲の天井：自分を囲む大きな球（空の手前、街のうしろ）。濃さで空を曇らせる
  const deckMaterial = keep(new T.MeshBasicMaterial({ color: '#9aa3a8', transparent: true, opacity: 0, side: 1 /* 裏側（内側から見る） */, fog: false, depthWrite: false, toneMapped: false }));
  const deck = new T.Mesh(keep(new T.SphereGeometry(70, 24, 12)), deckMaterial); deck.renderOrder = 4; deck.visible = false; scene.add(deck);
  // 雨（細い棒）と雪（小さな粒）。同じ形をたくさん並べる（InstancedMesh）。動かすのは位置だけ
  const RAIN = 2400, SNOW = 1300;
  const rainSeed = new Float32Array(RAIN * 3), snowSeed = new Float32Array(SNOW * 3);
  const drop = keep(new T.BoxGeometry(.014, .42, .014)); drop.rotateZ(-.08);
  const rainMaterial = keep(new T.MeshBasicMaterial({ color: night ? '#8f9bb5' : '#d4dcea', transparent: true, opacity: night ? .42 : .55, depthWrite: false }));
  const rain = new T.InstancedMesh(drop, rainMaterial, RAIN);
  const flake = keep(new T.SphereGeometry(.035, 5, 4));
  const snowMaterial = keep(new T.MeshBasicMaterial({ color: night ? '#c9d3ff' : '#ffffff', transparent: true, opacity: .92, depthWrite: false }));
  const snow = new T.InstancedMesh(flake, snowMaterial, SNOW);
  for (const im of [rain, snow]) {
    const dummy = new T.Object3D(); dummy.updateMatrix();
    for (let i = 0; i < im.count; i++) im.setMatrixAt(i, dummy.matrix);
    im.count = 0; im.frustumCulled = false; im.visible = false; scene.add(im);
  }
  const rainArray = rain.instanceMatrix.array, snowArray = snow.instanceMatrix.array;
  for (const o of [deck, rain, snow]) { o.raycast = () => {}; o.castShadow = false; o.receiveShadow = false; }
  const under = (x, z) => roofs.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  const rnd = Math.random;
  let center = { x: 0, z: 0 }, seeded = false;
  function seedAll() {
    for (let i = 0; i < RAIN; i++) { rainSeed[i * 3] = center.x + (rnd() - .5) * BOX; rainSeed[i * 3 + 1] = rnd() * HIGH; rainSeed[i * 3 + 2] = center.z + (rnd() - .5) * BOX; }
    for (let i = 0; i < SNOW; i++) { snowSeed[i * 3] = center.x + (rnd() - .5) * BOX; snowSeed[i * 3 + 1] = rnd() * HIGH; snowSeed[i * 3 + 2] = center.z + (rnd() - .5) * BOX; }
    seeded = true;
  }
  const wrap = (v, c) => { const d = v - c; return d > BOX / 2 ? v - BOX : d < -BOX / 2 ? v + BOX : v; };
  let kind = 'clear', target = LOOK.clear;
  const cur = { ...LOOK.clear }, deckColor = new T.Color(LOOK.clear.color), want = new T.Color(), fogColor = new T.Color(), flashColor = new T.Color('#e8eeff');
  let flash = 0, nextFlash = 0, lastTime = 0;
  function set(next) {
    kind = LOOK[next] ? next : 'clear'; target = LOOK[kind];
    want.set(target.color); if (night) want.multiplyScalar(kind === 'snow' ? .45 : .22);
    if (!seeded) seedAll();
    if (kind !== 'storm') flash = 0;
  }
  set('clear');
  function apply() {
    lights.hemi.intensity = base.hemi * cur.light * (1 + flash * 2.2);
    lights.sun.intensity = base.sun * cur.sun;
    if (scene.fog) { scene.fog.near = base.near * cur.near; scene.fog.far = base.far * cur.far; fogColor.copy(base.fog).lerp(deckColor, cur.mix); scene.fog.color.copy(fogColor); }
    deckMaterial.opacity = cur.deck; deck.visible = cur.deck > .01;
    deckMaterial.color.copy(deckColor); if (flash > 0) deckMaterial.color.lerp(flashColor, flash * .7);
  }
  return {
    get kind() { return kind; },
    set,
    /* 毎フレーム。time は秒、center は自分のいる所（雨・雪・雲の天井がついてくる） */
    update(time, dt, at) {
      dt = Math.min(Math.max(dt || 0, 0), .05); center = at;
      const k = Math.min(1, dt * 1.6);
      for (const key of ['light', 'sun', 'deck', 'near', 'far', 'mix']) cur[key] += (target[key] - cur[key]) * k;
      deckColor.lerp(want, k);
      // 雷：ときどき2回光る
      if (kind === 'storm' && !reduced) {
        if (!nextFlash) nextFlash = time + 3 + Math.random() * 6;
        if (time >= nextFlash) { flash = 1; nextFlash = time + 4 + Math.random() * 8; lastTime = time; }
        else if (flash > 0) { flash = Math.max(0, flash - dt * 6); if (flash === 0 && time - lastTime < .4 && Math.random() < .5) { flash = .8; lastTime = 0; } }
      } else flash = 0;
      apply();
      deck.position.set(at.x, 0, at.z);
      // 雨
      const rainCount = target.rain;
      rain.visible = rainCount > 0;
      if (rain.visible) {
        const fall = kind === 'storm' ? 19 : 14;
        for (let i = 0; i < rainCount; i++) {
          const s = i * 3; let y = rainSeed[s + 1] - fall * dt;
          if (y < 0) { y += HIGH; rainSeed[s] = at.x + (rnd() - .5) * BOX; rainSeed[s + 2] = at.z + (rnd() - .5) * BOX; }
          rainSeed[s + 1] = y; const x = rainSeed[s] = wrap(rainSeed[s], at.x), z = rainSeed[s + 2] = wrap(rainSeed[s + 2], at.z);
          const m = i * 16;
          rainArray[m + 12] = x; rainArray[m + 13] = under(x, z) ? -60 : y; rainArray[m + 14] = z;
        }
        rain.count = rainCount; rain.instanceMatrix.needsUpdate = true;
      }
      // 雪
      const snowCount = target.snow;
      snow.visible = snowCount > 0;
      if (snow.visible) {
        for (let i = 0; i < snowCount; i++) {
          const s = i * 3; let y = snowSeed[s + 1] - (.8 + (i % 5) * .12) * dt;
          if (y < 0) { y += HIGH; snowSeed[s] = at.x + (rnd() - .5) * BOX; snowSeed[s + 2] = at.z + (rnd() - .5) * BOX; }
          snowSeed[s + 1] = y;
          const x = snowSeed[s] = wrap(snowSeed[s], at.x), z = snowSeed[s + 2] = wrap(snowSeed[s + 2], at.z);
          const sway = Math.sin(time * .9 + i) * .25;
          const m = i * 16;
          snowArray[m + 12] = x + sway; snowArray[m + 13] = under(x, z) ? -60 : y; snowArray[m + 14] = z + Math.cos(time * .7 + i * 1.3) * .2;
        }
        snow.count = snowCount; snow.instanceMatrix.needsUpdate = true;
      }
    }
  };
}
