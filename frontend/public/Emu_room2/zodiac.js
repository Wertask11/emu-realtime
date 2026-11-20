/* ───── 星空の黄道12星座（11/20 オーナー） ─────

   行動・貢献でできた星（room2.js の stars）が、本物の黄道12星座の形に順に埋まっていく。
     ・どの星でも順に埋まる（おひつじ座 → うお座）。1つ完成すると次の星座へ
     ・星の入れ替え：星座の中の星を入れ替えて、並び（色）を自分好みにできる
     ・自分だけの星座：持っている星を点に置き、線で結び、名前を付ける（3つまで）
     ・星座図鑑：12星座の進み具合と、完成した日。完成した星座は X でシェアできる
     ・星空モード／図鑑モードを切り替える。星空モードでは、空がゆっくり回る（room2.js）

   星の数は親（Emu 本体）が実データから数える。ここが持つのは「どの種類の星を、どの順に並べるか」と
   自分だけの星座・完成した日だけ。親が本人の記録（sp_star_layouts/{uid}）に保存する。
   星座の形は、本物の星図の主な星の並びをもとにした線画（明るさの細部は省いている）。 */
(function () {
  "use strict";

  /* 星座の形。座標は -1〜1（右が＋x、下が＋y）。lines は星の番号どうしを結ぶ線 */
  const ZODIAC = [
    { id: "aries", name: "おひつじ座", en: "Aries",
      p: [[-0.9, 0.35], [-0.35, 0.05], [0.25, -0.05], [0.85, -0.3]],
      l: [[0, 1], [1, 2], [2, 3]] },
    { id: "taurus", name: "おうし座", en: "Taurus",
      p: [[0.3, 0.15], [0.05, -0.05], [-0.2, -0.25], [-0.75, -0.8], [-0.05, 0.35], [-0.85, -0.05], [0.55, 0.45], [0.85, -0.45]],
      l: [[6, 0], [0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [1, 7]] },
    { id: "gemini", name: "ふたご座", en: "Gemini",
      p: [[-0.3, -0.9], [-0.4, -0.4], [-0.5, 0.1], [-0.55, 0.5], [-0.75, 0.62], [0.25, -0.85], [0.08, -0.25], [0.12, 0.25], [0.32, 0.82]],
      l: [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [1, 6]] },
    { id: "cancer", name: "かに座", en: "Cancer",
      p: [[0.6, 0.55], [0, 0.05], [-0.05, -0.35], [-0.15, -0.85], [-0.6, 0.6]],
      l: [[1, 0], [1, 2], [2, 3], [1, 4]] },
    { id: "leo", name: "しし座", en: "Leo",
      p: [[0.55, 0.45], [0.45, 0.05], [0.5, -0.3], [0.35, -0.6], [0.6, -0.8], [0.82, -0.62], [-0.85, 0.25], [-0.35, -0.15], [-0.35, 0.3]],
      l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 7], [7, 6], [6, 8], [8, 0]] },
    { id: "virgo", name: "おとめ座", en: "Virgo",
      p: [[0.1, 0.85], [-0.25, 0.35], [0.2, 0.0], [0.55, -0.1], [0.85, -0.35], [-0.05, -0.3], [-0.25, -0.7], [0.35, 0.35], [-0.7, 0.55], [-0.88, 0.78]],
      l: [[0, 7], [7, 2], [2, 3], [3, 4], [2, 5], [5, 6], [5, 1], [1, 8], [8, 9]] },
    { id: "libra", name: "てんびん座", en: "Libra",
      p: [[0.5, 0.2], [-0.05, -0.6], [-0.55, -0.25], [0.55, 0.75], [-0.6, 0.55]],
      l: [[0, 1], [1, 2], [2, 0], [0, 3], [2, 4]] },
    { id: "scorpius", name: "さそり座", en: "Scorpius",
      p: [[0.85, -0.75], [0.8, -0.45], [0.75, -0.15], [0.5, -0.4], [0.35, -0.22], [0.2, -0.02], [0.05, 0.25], [0.0, 0.55], [-0.05, 0.8], [-0.3, 0.92], [-0.6, 0.82], [-0.8, 0.58], [-0.7, 0.36], [-0.92, 0.3]],
      l: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]] },
    { id: "sagittarius", name: "いて座", en: "Sagittarius",
      p: [[0.75, 0.35], [0.45, 0.0], [0.55, 0.6], [-0.15, 0.5], [-0.4, -0.05], [-0.65, 0.2], [0.0, -0.05], [0.25, -0.5]],
      l: [[0, 1], [0, 2], [2, 3], [3, 6], [6, 1], [1, 7], [7, 6], [6, 4], [4, 5], [5, 3]] },
    { id: "capricornus", name: "やぎ座", en: "Capricornus",
      p: [[0.85, -0.45], [0.72, -0.18], [0.45, 0.35], [0.3, 0.6], [-0.1, 0.45], [-0.88, -0.2], [-0.6, -0.15], [-0.1, -0.25], [0.3, -0.3]],
      l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1]] },
    { id: "aquarius", name: "みずがめ座", en: "Aquarius",
      p: [[0.9, 0.2], [0.45, -0.15], [0.0, -0.45], [-0.2, -0.4], [-0.3, -0.58], [-0.42, -0.45], [-0.25, 0.15], [-0.1, 0.62], [-0.6, 0.3], [-0.78, 0.66]],
      l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [6, 8], [8, 9]] },
    { id: "pisces", name: "うお座", en: "Pisces",
      p: [[0.0, 0.78], [0.25, 0.42], [0.45, 0.1], [0.55, -0.25], [0.75, -0.55], [0.48, -0.8], [-0.35, 0.55], [-0.62, 0.35], [-0.85, 0.05], [-0.68, -0.18], [-0.95, -0.28], [-0.82, -0.48]],
      l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 3], [0, 6], [6, 7], [7, 8], [8, 9], [9, 11], [11, 10], [10, 8]] }
  ];
  /* 何番目の星が、どの星座のどの点に入るか */
  const SLOTS = [];
  ZODIAC.forEach((z, k) => { z.start = SLOTS.length; z.p.forEach((_, j) => SLOTS.push({ k, j })); z.end = SLOTS.length; });
  const TOTAL = SLOTS.length;
  const GRID = 5;                 // 自分だけの星座：5×5 の点
  const CUSTOM_MAX = 3, CUSTOM_POINTS = 12;

  /* 保存する中身。親が送ってくる（読めなかったときは loaded のまま false。そのあいだは保存しない） */
  const layout = { slots: [], customs: [], completed: {} };
  let layoutLoaded = false, layoutFailed = false;
  let order = [];                 // いまの並び（種類のキーの列）。order[i] が i 番目の星
  let geo = null;                 // 星座の位置（画面の大きさで変わる）
  let saveTimer = null;

  /* ───── 並びを決める ───── */
  function typeOf(st) { return st.type; }
  function lookOf(type) {
    const st = (typeof stars !== "undefined" ? stars : []).find(s => s.type === type);
    return st ? { color: st.baseColor, outline: st.outline } : { color: "#ffffff", outline: null };
  }
  function nameOfType(type) {
    const base = { post: "知識星", nft: "体験星", discussion: "議論星", learning: "学び星", change: "改善星" }[type];
    if (base) return base;
    const g = (typeof questStarLook !== "undefined" ? questStarLook : []).find(x => x.key === type);
    return g ? g.label : "星";
  }
  /* 保存してある並びを、いま持っている星に合わせる。増えた星は後ろに足し、減った星は外す */
  function reconcile(list) {
    const have = {};
    list.forEach(st => { have[st.type] = (have[st.type] || 0) + 1; });
    const out = [];
    (layout.slots || []).forEach(t => { if (have[t] > 0) { out.push(t); have[t]--; } });
    list.forEach(st => { if (have[st.type] > 0) { out.push(st.type); have[st.type]--; } });
    return out;
  }

  /* 星座を空のどこに置くか。いま作っている星座が、画面のいちばん見やすい場所に来るように回しておく */
  function geometry() {
    const reach = Math.max(120, ((typeof starLayerSize !== "undefined" && starLayerSize) || Math.hypot(W, H)) / 2);
    const ringR = reach * 0.6;
    /* スマホでは、下の札の横に収まるよう少し小さく描く */
    const f = ringR * Math.sin(Math.PI / 12) * (W < 520 ? 0.8 : 0.92);
    const current = currentIndex();
    /* 画面の中で、上のボタン・左下の「星座記録」の札・右下の「星空の見方」・地平に重ならず、
       いちばん離れて見える角度を探す */
    const avoid = ["starInfo", "detailBtn"].map(id => document.getElementById(id)).filter(Boolean)
      .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    let best = Math.PI, bestScore = -Infinity;
    for (let a = 0; a < 360; a += 5) {
      const t = a * Math.PI / 180, cx = POLE.x + Math.cos(t) * ringR, cy = POLE.y + Math.sin(t) * ringR;
      let score = Math.min(cx - f, W - cx - f, cy - f - 150, horizonY(cx) - cy - f - 24);
      avoid.forEach(r => {
        const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom);
        const gap = Math.hypot(dx, dy) - f - 12;
        if (gap < 0) score += gap * 2;
      });
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return { ringR, f, best, current };
  }
  function currentIndex() {
    const n = order.length;
    for (let k = 0; k < ZODIAC.length; k++) if (n < ZODIAC[k].end) return k;
    return ZODIAC.length - 1;
  }
  /* 星座 k の点 j の、空の上の位置（天の北極を原点にした、回る前の座標） */
  function slotSky(k, j) {
    const z = ZODIAC[k], g = geo;
    const a = g.best + (k - g.current) * (Math.PI / 6);
    const rot = (k - g.current) * (Math.PI / 6);
    const cx = Math.cos(a) * g.ringR, cy = Math.sin(a) * g.ringR;
    const lx = z.p[j][0] * g.f, ly = z.p[j][1] * g.f;
    return { x: cx + lx * Math.cos(rot) - ly * Math.sin(rot), y: cy + lx * Math.sin(rot) + ly * Math.cos(rot) };
  }
  function centerSky(k) {
    const a = geo.best + (k - geo.current) * (Math.PI / 6);
    return { x: Math.cos(a) * geo.ringR, y: Math.sin(a) * geo.ringR };
  }
  function customSky(c, i, gx, gy) {
    const a = geo.best + Math.PI + i * (Math.PI * 2 / 3);
    const r = geo.ringR * 0.4, size = geo.f * 0.9;
    return { x: Math.cos(a) * r + (gx / (GRID - 1) - 0.5) * 2 * size, y: Math.sin(a) * r + (gy / (GRID - 1) - 0.5) * 2 * size };
  }
  function toScreen(p) {
    const c = Math.cos(skyAngle), s = Math.sin(skyAngle);
    return { x: POLE.x + p.x * c - p.y * s, y: POLE.y + p.x * s + p.y * c };
  }

  /* room2.js が星を作り直したとき・画面の大きさが変わったときに呼ぶ。星を星座の点へ置く */
  function assign(list) {
    if (!list || !list.length) { order = []; geo = null; return; }
    order = reconcile(list);
    geo = geometry();
    const pools = {};
    list.forEach(st => { (pools[st.type] = pools[st.type] || []).push(st); });
    order.forEach((t, i) => {
      const st = pools[t].shift();
      if (!st) return;
      st.zIndex = i;
      let p;
      if (i < TOTAL) p = slotSky(SLOTS[i].k, SLOTS[i].j);
      else {
        /* 12星座に入りきらない星は、星座の輪の内側に散らす */
        const r = 40 + Math.random() * geo.ringR * 0.45, t2 = Math.random() * Math.PI * 2;
        p = { x: Math.cos(t2) * r, y: Math.sin(t2) * r };
      }
      st.r0 = Math.hypot(p.x, p.y);
      st.a0 = Math.atan2(p.y, p.x);
    });
    noteCompleted();
    if (panelOpen) renderPanel();
  }

  function filledIn(k) { return Math.max(0, Math.min(ZODIAC[k].p.length, order.length - ZODIAC[k].start)); }
  function noteCompleted() {
    if (!layoutLoaded) return;
    let changed = false;
    ZODIAC.forEach((z, k) => {
      if (filledIn(k) === z.p.length && !layout.completed[z.id]) { layout.completed[z.id] = Date.now(); changed = true; }
    });
    if (changed) save();
  }

  /* ───── 描く（room2.js の render から毎フレーム） ───── */
  function draw(ctx, time) {
    if (!geo) return;
    const cur = currentIndex();
    ZODIAC.forEach((z, k) => {
      const n = filledIn(k), done = n === z.p.length, started = n > 0;
      const pts = z.p.map((_, j) => toScreen(slotSky(k, j)));
      /* 線：完成＝金色の実線、作っている途中＝薄い点線、まだ＝ごく薄い点線（形だけ見える） */
      ctx.save();
      ctx.lineWidth = done ? 1.1 : 0.8;
      z.l.forEach(([a, b]) => {
        const both = a < n && b < n;
        ctx.setLineDash(both ? [] : [3, 5]);
        ctx.globalAlpha = done ? 0.55 : both ? 0.4 : started || k === cur ? 0.16 : 0.06;
        ctx.strokeStyle = done ? "#ffe2a8" : "rgba(190,210,255,1)";
        ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke();
      });
      ctx.setLineDash([]);
      /* まだ星が入っていない点（作っている途中の星座だけ）：小さな輪 */
      if (started || k === cur) {
        ctx.globalAlpha = 0.28 + (REDUCED_MOTION ? 0 : Math.sin(time * 0.002 + k) * 0.08);
        ctx.strokeStyle = "rgba(200,220,255,1)";
        for (let j = n; j < z.p.length; j++) { ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, 3.2, 0, Math.PI * 2); ctx.stroke(); }
      }
      /* 名前 */
      if (started || k === cur) {
        const c = toScreen(centerSky(k));
        ctx.globalAlpha = done ? 0.85 : 0.6;
        ctx.fillStyle = done ? "#ffe2a8" : "#c8d8ff";
        ctx.font = "600 12px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(z.name + (done ? "" : "  " + n + "/" + z.p.length), c.x, c.y + geo.f + 16);
      }
      ctx.restore();
    });
    /* 自分だけの星座 */
    (layout.customs || []).forEach((c, i) => {
      const pts = c.points.map(pt => toScreen(customSky(c, i, pt[0], pt[1])));
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#bfe8ff"; ctx.lineWidth = 0.9;
      c.lines.forEach(([a, b]) => { if (pts[a] && pts[b]) { ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke(); } });
      c.points.forEach((pt, j) => drawStarDot(ctx, pts[j].x, pts[j].y, lookOf(pt[2]).color, 3));
      const cc = toScreen(customSky(c, i, (GRID - 1) / 2, GRID - 1));
      ctx.globalAlpha = 0.7; ctx.fillStyle = "#bfe8ff"; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(c.name || "わたしの星座", cc.x, cc.y + 18);
      ctx.restore();
    });
  }
  function drawStarDot(ctx, x, y, color, r) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.3, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  /* ───── 保存（親へ頼む） ───── */
  function save() {
    if (!layoutLoaded || layoutFailed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      layout.slots = order.slice(0, 600);
      try {
        window.parent.postMessage({ type: "EMU_STAR_LAYOUT_SAVE", layout: {
          slots: layout.slots, customs: layout.customs, completed: layout.completed } }, window.location.origin);
      } catch (e) {}
    }, 600);
  }
  function receive(msg) {
    if (!msg || msg.ok !== true) { layoutFailed = true; layoutLoaded = false; return; }
    const d = msg.layout || {};
    layout.slots = Array.isArray(d.slots) ? d.slots.filter(t => typeof t === "string").slice(0, 600) : [];
    layout.customs = Array.isArray(d.customs) ? d.customs.filter(validCustom).slice(0, CUSTOM_MAX) : [];
    layout.completed = d.completed && typeof d.completed === "object" ? Object.assign({}, d.completed) : {};
    layoutLoaded = true; layoutFailed = false;
    if (typeof stars !== "undefined" && stars.length) assign(stars);
  }
  function validCustom(c) {
    return c && typeof c.name === "string" && Array.isArray(c.points) && Array.isArray(c.lines)
      && c.points.length <= CUSTOM_POINTS && c.points.every(p => Array.isArray(p) && p.length === 3);
  }

  /* ───── 星空モード／図鑑モード ───── */
  let panelOpen = false, view = { k: -1, sel: -1, custom: -1 };
  function ui() {
    const bar = document.createElement("div");
    bar.id = "zodiacModes"; bar.setAttribute("role", "tablist"); bar.setAttribute("aria-label", "表示の切り替え");
    bar.innerHTML = '<button type="button" role="tab" data-mode="sky" aria-selected="true">🌌 星空</button>'
      + '<button type="button" role="tab" data-mode="book" aria-selected="false">📖 星座図鑑</button>';
    document.body.appendChild(bar);
    bar.addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
    const panel = document.createElement("section");
    panel.id = "zodiacBook"; panel.hidden = true; panel.setAttribute("aria-label", "星座図鑑");
    document.body.appendChild(panel);
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("input", e => { if (e.target.id === "zodiacCustomName" && view.custom >= 0) draftName = e.target.value; });
  }
  function setMode(mode) {
    panelOpen = mode === "book";
    document.querySelectorAll("#zodiacModes button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    const panel = document.getElementById("zodiacBook");
    panel.hidden = !panelOpen;
    document.body.classList.toggle("zodiac-book-open", panelOpen);
    if (panelOpen) { view = { k: -1, sel: -1, custom: -1 }; renderPanel(); }
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function day(ms) { const d = new Date(Number(ms) + 9 * 3600000); return d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); }

  /* 小さな星座の絵（SVG）。図鑑のカードと、入れ替えの画面で使う */
  function figure(k, big) {
    const z = ZODIAC[k], n = filledIn(k), size = big ? 300 : 120, pad = big ? 26 : 12;
    const P = z.p.map(([x, y]) => [pad + (x + 1) / 2 * (size - pad * 2), pad + (y + 1) / 2 * (size - pad * 2)]);
    const lines = z.l.map(([a, b]) => `<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}" stroke="${n === z.p.length ? "#ffe2a8" : "#9fb4e6"}" stroke-opacity="${a < n && b < n ? 0.7 : 0.25}" ${a < n && b < n ? "" : 'stroke-dasharray="3 4"'} stroke-width="${big ? 1.6 : 1.2}"/>`).join("");
    const dots = z.p.map((_, j) => {
      const i = z.start + j, has = i < order.length, col = has ? lookOf(order[i]).color : "none";
      const r = big ? 9 : 4;
      const sel = big && view.sel === i ? `<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r + 7}" fill="none" stroke="#ffe2a8" stroke-width="2"/>` : "";
      return has
        ? `${sel}<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r * 1.9}" fill="${col}" opacity=".25"/><circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r}" fill="${col}" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>`
          + (big ? `<circle data-slot="${i}" cx="${P[j][0]}" cy="${P[j][1]}" r="22" fill="transparent" style="cursor:pointer"><title>${esc(nameOfType(order[i]))}</title></circle>` : "")
        : `<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r * 0.7}" fill="none" stroke="#9fb4e6" stroke-opacity=".5"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${lines}${dots}</svg>`;
  }

  function renderPanel() {
    const panel = document.getElementById("zodiacBook");
    if (!panel || !panelOpen) return;
    if (view.k >= 0) return renderDetail(panel);
    if (view.custom >= 0) return renderCustom(panel);
    const doneCount = ZODIAC.filter((z, k) => filledIn(k) === z.p.length).length;
    const saveNote = layoutFailed ? '<p class="zb-note">並びを読み込めなかったため、いまは入れ替え・保存ができません。開き直してください。</p>' : "";
    panel.innerHTML = `<header class="zb-head"><h2>📖 星座図鑑</h2><p>集めた星が、黄道12星座の形に順に埋まっていきます。完成 <b>${doneCount}</b> / 12　・　星 ${order.length} 個</p>${saveNote}</header>
      <div class="zb-grid">${ZODIAC.map((z, k) => {
        const n = filledIn(k), done = n === z.p.length, when = layout.completed[z.id];
        return `<button type="button" class="zb-card${done ? " done" : n ? " going" : ""}" data-open="${k}">
          ${figure(k, false)}<b>${esc(z.name)}</b><span>${done ? "完成" + (when ? "・" + day(when) : "") : n + " / " + z.p.length}</span></button>`;
      }).join("")}</div>
      <section class="zb-custom"><h3>✨ 自分だけの星座</h3><p>持っている星を点に置いて、線で結び、名前を付けます（${CUSTOM_MAX}つまで）。</p>
        <div class="zb-row">${(layout.customs || []).map((c, i) => `<button type="button" class="zb-chip" data-custom="${i}">${esc(c.name || "わたしの星座")}</button>`).join("")}
        ${(layout.customs || []).length < CUSTOM_MAX ? `<button type="button" class="zb-chip add" data-custom="${(layout.customs || []).length}"${canEdit() ? "" : " disabled"}>＋ つくる</button>` : ""}</div></section>`;
  }
  function canEdit() { return layoutLoaded && !layoutFailed && order.length > 0; }

  /* 入れ替えの画面 */
  function renderDetail(panel) {
    const k = view.k, z = ZODIAC[k], n = filledIn(k), done = n === z.p.length;
    const types = [...new Set(order)];
    const sel = view.sel;
    panel.innerHTML = `<header class="zb-head"><button type="button" class="zb-back" data-back>← 図鑑</button><h2>${esc(z.name)} <small>${esc(z.en)}</small></h2>
      <p>${done ? "完成" + (layout.completed[z.id] ? "（" + day(layout.completed[z.id]) + "）" : "") : n + " / " + z.p.length + "　あと " + (z.p.length - n) + " 個で完成"}</p></header>
      <div class="zb-figure">${figure(k, true)}</div>
      ${n ? `<p class="zb-note">${sel >= 0 ? "入れ替える相手の星を押すか、下の星の種類を選んでください。" : "星を押すと、ほかの星と入れ替えられます（並びが自分好みになります）。"}</p>
      ${sel >= 0 ? `<div class="zb-row">${types.map(t => `<button type="button" class="zb-chip" data-swaptype="${esc(t)}"><i style="background:${esc(lookOf(t).color)}"></i>${esc(nameOfType(t))}</button>`).join("")}<button type="button" class="zb-chip" data-cancel>やめる</button></div>` : ""}` : '<p class="zb-note">まだ星が入っていません。行動や貢献で星ができると、順に入っていきます。</p>'}
      ${done ? `<button type="button" class="zb-share" data-share="${k}">X でシェア</button>` : ""}`;
  }

  /* 自分だけの星座をつくる画面 */
  let draft = null, draftName = "", draftSel = -1, draftType = "";
  function renderCustom(panel) {
    const types = [...new Set(order)];
    if (!draftType) draftType = types[0] || "";
    const owned = {}; order.forEach(t => { owned[t] = (owned[t] || 0) + 1; });
    const used = {}; draft.points.forEach(p => { used[p[2]] = (used[p[2]] || 0) + 1; });
    const S = 300, pad = 30, step = (S - pad * 2) / (GRID - 1);
    const at = (g) => pad + g * step;
    let cells = "";
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      /* 見える点を先に、押せる大きな輪をあとに描く（あとのものが上に来て、押したときに拾える） */
      cells += `<circle cx="${at(gx)}" cy="${at(gy)}" r="2" fill="#5d6f9c"/><circle data-cell="${gx},${gy}" cx="${at(gx)}" cy="${at(gy)}" r="18" fill="transparent" style="cursor:pointer"/>`;
    }
    const lines = draft.lines.map(([a, b]) => { const A = draft.points[a], B = draft.points[b]; return `<line x1="${at(A[0])}" y1="${at(A[1])}" x2="${at(B[0])}" y2="${at(B[1])}" stroke="#bfe8ff" stroke-opacity=".75" stroke-width="1.6"/>`; }).join("");
    const pts = draft.points.map((p, i) => `<circle cx="${at(p[0])}" cy="${at(p[1])}" r="9" fill="${esc(lookOf(p[2]).color)}" stroke="${i === draftSel ? "#ffe2a8" : "#fff"}" stroke-width="${i === draftSel ? 3 : 1}"/><circle data-point="${i}" cx="${at(p[0])}" cy="${at(p[1])}" r="18" fill="transparent" style="cursor:pointer"/>`).join("");
    panel.innerHTML = `<header class="zb-head"><button type="button" class="zb-back" data-back>← 図鑑</button><h2>✨ 自分だけの星座</h2>
      <p>点を押すと星を置きます。置いた星を2つ続けて押すと線で結びます。選んだ星をもう一度押すと消えます。</p></header>
      <label class="zb-name">名前<input id="zodiacCustomName" maxlength="12" value="${esc(draftName)}" placeholder="例：はじまりの冷蔵庫座"></label>
      <div class="zb-row">${types.map(t => `<button type="button" class="zb-chip${t === draftType ? " on" : ""}" data-pick="${esc(t)}"><i style="background:${esc(lookOf(t).color)}"></i>${esc(nameOfType(t))} ${(owned[t] || 0) - (used[t] || 0)}</button>`).join("")}</div>
      <div class="zb-figure"><svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${cells}${lines}${pts}</svg></div>
      <p class="zb-note">置けるのは、持っている星の数まで・${CUSTOM_POINTS}個まで。</p>
      <div class="zb-row"><button type="button" class="zb-share" data-customsave>この星座を残す</button>${view.custom < (layout.customs || []).length ? '<button type="button" class="zb-chip" data-customdel>この星座を消す</button>' : ""}</div>`;
  }

  function onPanelClick(e) {
    const t = e.target.closest("[data-open],[data-back],[data-slot],[data-swaptype],[data-cancel],[data-share],[data-custom],[data-cell],[data-point],[data-pick],[data-customsave],[data-customdel]");
    if (!t) return;
    const d = t.dataset;
    if (d.open !== undefined) { view = { k: Number(d.open), sel: -1, custom: -1 }; return renderPanel(); }
    if (d.back !== undefined) { view = { k: -1, sel: -1, custom: -1 }; draft = null; return renderPanel(); }
    if (d.slot !== undefined) {
      if (!canEdit()) return;
      const i = Number(d.slot);
      if (view.sel < 0) view.sel = i;
      else if (view.sel === i) view.sel = -1;
      else { swap(view.sel, i); view.sel = -1; }
      return renderPanel();
    }
    if (d.swaptype !== undefined) {
      /* 選んだ星を、ほかの星座（または星座の外）にある同じ種類の星と入れ替える。後ろの星座から探す */
      const i = view.sel, z = ZODIAC[view.k];
      for (let j = order.length - 1; j >= 0; j--) {
        if ((j < z.start || j >= z.end) && order[j] === d.swaptype) { swap(i, j); break; }
      }
      view.sel = -1; return renderPanel();
    }
    if (d.cancel !== undefined) { view.sel = -1; return renderPanel(); }
    if (d.share !== undefined) return shareDone(Number(d.share));
    if (d.custom !== undefined) {
      if (!canEdit()) return;
      const i = Number(d.custom), c = (layout.customs || [])[i];
      draft = c ? { points: c.points.map(p => p.slice()), lines: c.lines.map(l => l.slice()) } : { points: [], lines: [] };
      draftName = c ? c.name : ""; draftSel = -1; draftType = "";
      view = { k: -1, sel: -1, custom: i }; return renderPanel();
    }
    if (d.pick !== undefined) { draftType = d.pick; return renderPanel(); }
    if (d.cell !== undefined) {
      const [gx, gy] = d.cell.split(",").map(Number);
      if (draft.points.some(p => p[0] === gx && p[1] === gy)) return;
      const owned = order.filter(t2 => t2 === draftType).length, used = draft.points.filter(p => p[2] === draftType).length;
      if (!draftType || used >= owned || draft.points.length >= CUSTOM_POINTS) return;
      draft.points.push([gx, gy, draftType]); draftSel = -1; return renderPanel();
    }
    if (d.point !== undefined) {
      const i = Number(d.point);
      if (draftSel < 0) draftSel = i;
      else if (draftSel === i) {
        draft.points.splice(i, 1);
        draft.lines = draft.lines.filter(([a, b]) => a !== i && b !== i).map(([a, b]) => [a > i ? a - 1 : a, b > i ? b - 1 : b]);
        draftSel = -1;
      } else {
        const a = Math.min(draftSel, i), b = Math.max(draftSel, i);
        const at = draft.lines.findIndex(l => l[0] === a && l[1] === b);
        if (at >= 0) draft.lines.splice(at, 1); else if (draft.lines.length < 30) draft.lines.push([a, b]);
        draftSel = -1;
      }
      return renderPanel();
    }
    if (d.customsave !== undefined) {
      if (!draft.points.length) return;
      const name = String(draftName || "").trim().slice(0, 12) || "わたしの星座";
      layout.customs = (layout.customs || []).slice();
      layout.customs[view.custom] = { name, points: draft.points, lines: draft.lines };
      save(); view = { k: -1, sel: -1, custom: -1 }; draft = null; return renderPanel();
    }
    if (d.customdel !== undefined) {
      layout.customs = (layout.customs || []).filter((_, i) => i !== view.custom);
      save(); view = { k: -1, sel: -1, custom: -1 }; draft = null; return renderPanel();
    }
  }
  function swap(i, j) {
    if (i === j || i < 0 || j < 0 || i >= order.length || j >= order.length) return;
    const t = order[i]; order[i] = order[j]; order[j] = t;
    layout.slots = order.slice();
    save();
    if (typeof stars !== "undefined") assign(stars);
  }
  function shareDone(k) {
    const z = ZODIAC[k], doneCount = ZODIAC.filter((zz, kk) => filledIn(kk) === zz.p.length).length;
    const text = `🌌 ${z.name}が完成しました（${doneCount}/12星座）\nEmu for SchoolPark で、行動と貢献が星になって星座に。\n\n#EmuforSchoolPark`;
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
  }

  window.Zodiac = { ZODIAC, TOTAL, assign, draw, receive, setMode, get order() { return order.slice(); }, get layout() { return JSON.parse(JSON.stringify(layout)); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ui); else ui();
})();
