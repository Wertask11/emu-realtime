/* ───── 星空の黄道12星座（11/20 オーナー） ─────

   行動・貢献でできた星（room2.js の stars）が、本物の黄道12星座の形に順に埋まっていく。
     ・どの星でも順に埋まる（おひつじ座 → うお座）。1つ完成すると次の星座へ
     ・星の配置を自由に：どの星を、どの星座のどの点に使うかを選べる（入れ替え・しまう・ほかの星座から持ってくる）
   ・星座図鑑で学ぶ：見ごろ・主な星・お話・豆知識。星そのもの（色・明るさ・星座の数など）も
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
  /* 図鑑で学ぶ（11/20 オーナー：実際の星座や星についても図鑑で勉強できるように）。
     見ごろは「夜8時ごろ、南の空の高いところに来るころ」の目安。誕生星座の期間は、占いでよく使われるおよその日付
     （年によって1日ずれることがある）。実際に太陽がその星座の方向にいる時期とは、約1か月ずれている */
  const STUDY = {
    aries: { season: "秋〜冬（12月ごろ）", stars: "ハマル（α星・2等星）", birth: "3/21〜4/19",
      myth: "ギリシャ神話の、金色の毛をもつ空飛ぶ羊。継母にいじめられていた兄妹プリクソスとヘレを背中に乗せて逃がしたといわれます。",
      fact: "約2000年前は、春分の日に太陽がいる場所（春分点）がこの星座にありました。そのため黄道12星座の1番目になっています。" },
    taurus: { season: "冬（1月ごろ）", stars: "アルデバラン（α星・1等星。赤い星で牛の目）", birth: "4/20〜5/20",
      myth: "大神ゼウスが白い牛に姿を変えて、王女エウロパを背中に乗せて海を渡った話がもとです。ヨーロッパの名前はエウロパから来ています。",
      fact: "牛の肩のあたりに、日本で「すばる」と呼ばれるプレアデス星団があります。顔のV字はヒアデス星団です。" },
    gemini: { season: "冬〜春（2月ごろ）", stars: "ポルックス（β星・1等星）、カストル（α星・2等星）", birth: "5/21〜6/21",
      myth: "仲のよい双子の兄弟カストルとポルックス。兄が亡くなったとき、弟は自分の不死を分けて、二人いっしょに空に上がったといわれます。",
      fact: "12月の中ごろ、ふたご座流星群が見られます。1時間に数十個の流れ星が見えることもある、大きな流星群です。" },
    cancer: { season: "春（3月ごろ）", stars: "明るい星はありません（いちばん明るいβ星で4等星）", birth: "6/22〜7/22",
      myth: "英雄ヘラクレスが怪物ヒドラと戦っていたとき、女神ヘラの命で足をはさみに来た化けがに。踏みつぶされたあと、ヘラが空に上げました。",
      fact: "まん中に、プレセペ星団（M44）という星の集まりがあります。暗い空なら、ぼんやりした雲のように見えます。" },
    leo: { season: "春（4月ごろ）", stars: "レグルス（α星・1等星）、デネボラ（β星・2等星）", birth: "7/23〜8/22",
      myth: "ヘラクレスが退治した、ネメアの森の人食いライオン。どんな武器も通さない皮をもっていたといわれます。",
      fact: "頭の部分は「?」を裏返したような形で、「ししの大がま」と呼ばれます。11月にはしし座流星群が見られます。" },
    virgo: { season: "春〜初夏（5月ごろ）", stars: "スピカ（α星・1等星。青白い星）", birth: "8/23〜9/22",
      myth: "麦の穂を持つ、農業の女神デメテル（またはその娘ペルセポネ）といわれます。正義の女神アストライアとする話もあります。",
      fact: "黄道12星座の中でいちばん大きな星座です。スピカは、アークトゥルス・デネボラと「春の大三角」をつくります。" },
    libra: { season: "初夏（6月ごろ）", stars: "ズベン・エス・カマリ（β星）、ズベン・エル・ゲヌビ（α星）。どちらも2〜3等星", birth: "9/23〜10/23",
      myth: "正義の女神アストライアが、人の善い悪いをはかった天びんといわれます。黄道12星座で、ただ一つ生き物ではない星座です。",
      fact: "星の名前はアラビア語で「北のはさみ」「南のはさみ」。昔は、となりのさそり座のはさみの一部とされていました。" },
    scorpius: { season: "夏（7月ごろ・南の低い空）", stars: "アンタレス（α星・1等星。赤い星）", birth: "10/24〜11/22",
      myth: "狩人オリオンを刺したさそり。オリオン座は冬、さそり座は夏の星座で、今も同じ空にいっしょには出ないといわれます。",
      fact: "アンタレスは「火星（アレス）に対抗するもの」という意味。S字の形から、日本では「魚つり星」と呼ぶ地方もあります。" },
    sagittarius: { season: "夏（8月ごろ・南の低い空）", stars: "南斗六星（ひしゃくの形に並ぶ6つの星）", birth: "11/23〜12/21",
      myth: "上半身が人、下半身が馬のケンタウロス族の賢者ケイローンが、弓を引く姿といわれます。",
      fact: "この方向に、わたしたちの銀河系（天の川銀河）の中心があります。夏の天の川がいちばん濃く見えるあたりです。" },
    capricornus: { season: "秋（9月ごろ）", stars: "デネブ・アルゲディ（δ星・3等星）", birth: "12/22〜1/19",
      myth: "牧神パーンが怪物テュポーンから逃げようと川に飛び込んだとき、あわてて上半身がやぎ、下半身が魚の姿になったといわれます。",
      fact: "明るい星は少ないですが、全体で逆三角形（おにぎりのような形）に並んでいて、見つけやすい星座です。" },
    aquarius: { season: "秋（10月ごろ）", stars: "サダルスウド（β星）、サダルメリク（α星）。どちらも3等星", birth: "1/20〜2/18",
      myth: "大神ゼウスにさらわれ、神々の宴で酒をつぐ役になった美少年ガニメデが、水がめを持つ姿といわれます。",
      fact: "サダルスウドは「幸運の中の幸運」という意味。5月ごろには、ハレー彗星のちりが流れ星になる、みずがめ座η流星群が見られます。" },
    pisces: { season: "秋（11月ごろ）", stars: "アルレシャ（α星・4等星。「結び目」という意味）", birth: "2/19〜3/20",
      myth: "女神アフロディテと息子エロスが、怪物テュポーンから逃げるために魚に姿を変え、はぐれないようにリボンで結び合ったといわれます。",
      fact: "いまの春分点（春分の日に太陽がいる場所）は、うお座にあります。地球の首ふり運動（歳差）で、少しずつ動いています。" }
  };
  ZODIAC.forEach(z => { z.study = STUDY[z.id]; });
  /* 星そのものについて（図鑑のいちばん下） */
  const STAR_FACTS = [
    ["黄道12星座とは", "1年かけて太陽が星空の中を通っていく道（黄道）にある星座です。昔の人は、太陽がいまどの星座の方向にいるかで季節を知りました。"],
    ["星座はいくつある？", "いまは世界共通で88の星座が決まっています（1928年に国際天文学連合が決めました）。黄道12星座はその一部です。"],
    ["星の色と温度", "青白い星ほど温度が高く（1万度をこえるものも）、赤い星ほど低い（3000度くらい）。スピカは青白く、アンタレスやアルデバランは赤い星です。"],
    ["明るさ（等級）", "1等星は6等星の約100倍明るく見えます。数字が小さいほど明るい星です。6等星は、暗い空でやっと目に見える明るさです。"],
    ["星空が回る理由", "地球が1日に1回まわっているので、星は北極星のあたりを中心に回って見えます。この星空も、同じように少しずつ回っています。"],
    ["星の光は昔の光", "星の光は、何年も何百年もかけて地球に届きます。アンタレスの光は、約550年前に出た光です。"]
  ];

  /* 何番目の点が、どの星座のどの点か */
  const SLOTS = [];
  ZODIAC.forEach((z, k) => { z.start = SLOTS.length; z.p.forEach((_, j) => SLOTS.push({ k, j })); z.end = SLOTS.length; });
  const TOTAL = SLOTS.length;
  const GRID = 5;                 // 自分だけの星座：5×5 の点
  const CUSTOM_MAX = 3, CUSTOM_POINTS = 12;

  /* 保存する中身。親が送ってくる（読めなかったときは loaded のまま false。そのあいだは保存しない）
       slots … 星座の点ごとの星の種類（"" は空いている点。自分で外した点は空いたまま残す）
       held  … 自分で「しまった」星。星座には入れず、星空の内側に散らしておく */
  const layout = { slots: [], held: [], customs: [], completed: {} };
  let layoutLoaded = false, layoutFailed = false;
  let place = [];                 // 星座の点ごとの種類（長さ TOTAL、"" は空き）
  let held = [];                  // しまってある星
  let extra = [];                 // 12星座に入りきらない星（全部埋まったあとに増えた分）
  let geo = null;
  let saveTimer = null;

  /* ───── 並びを決める ───── */
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
  /* 保存してある並びを、いま持っている星に合わせる。
     置いてあった点・しまってあった星はそのまま。減った星は外す。新しく増えた星は、空いている点に前から順に入る */
  function reconcile(list) {
    const have = {};
    list.forEach(st => { have[st.type] = (have[st.type] || 0) + 1; });
    const pl = new Array(TOTAL).fill("");
    (layout.slots || []).slice(0, TOTAL).forEach((t, i) => { if (t && have[t] > 0) { pl[i] = t; have[t]--; } });
    const hd = [];
    (layout.held || []).forEach(t => { if (have[t] > 0) { hd.push(t); have[t]--; } });
    const ex = [];
    let i = 0;
    list.forEach(st => {
      if (!(have[st.type] > 0)) return;
      have[st.type]--;
      while (i < TOTAL && pl[i]) i++;
      if (i < TOTAL) pl[i] = st.type; else ex.push(st.type);
    });
    return { pl, hd, ex };
  }
  function ownedCount() { return place.filter(Boolean).length + held.length + extra.length; }
  function spareOf(type) { return held.filter(t => t === type).length + extra.filter(t => t === type).length; }
  function allTypes() { return [...new Set(place.filter(Boolean).concat(held, extra))]; }

  /* 星座を空のどこに置くか。いま作っている星座が、画面のいちばん見やすい場所に来るように回しておく。
     ほかの星座も同じ輪の上に30°ずつ並んでいて、空が回ると順に見えてくる */
  function geometry() {
    const reach = Math.max(120, ((typeof starLayerSize !== "undefined" && starLayerSize) || Math.hypot(W, H)) / 2);
    const ringR = reach * 0.6;
    /* スマホでは、下の札の横に収まるよう少し小さく描く */
    const f = ringR * Math.sin(Math.PI / 12) * (W < 520 ? 0.8 : 0.92);
    const current = currentIndex();
    /* 画面の中で、上のボタン・左下の「星座記録」の札・右下の「星空の見方」・地平に重ならず、
       いちばん離れて見える角度を探す */
    const avoid = ["starInfo", "detailBtn", "skyDetailToggle"].map(id => document.getElementById(id)).filter(Boolean)
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
  /* いま作っている星座：途中まで入っている最初の星座。無ければ、まだ完成していない最初の星座 */
  function currentIndex() {
    for (let k = 0; k < ZODIAC.length; k++) { const n = filledIn(k); if (n > 0 && n < ZODIAC[k].p.length) return k; }
    for (let k = 0; k < ZODIAC.length; k++) if (filledIn(k) < ZODIAC[k].p.length) return k;
    return ZODIAC.length - 1;
  }
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

  /* room2.js が星を作り直したとき・画面の大きさが変わったとき・並びを変えたときに呼ぶ。星を星座の点へ置く */
  function assign(list) {
    if (!list || !list.length) { place = []; held = []; extra = []; geo = null; return; }
    const r = reconcile(list);
    place = r.pl; held = r.hd; extra = r.ex;
    geo = geometry();
    const pools = {};
    list.forEach(st => { (pools[st.type] = pools[st.type] || []).push(st); });
    const at = (st, p) => { st.r0 = Math.hypot(p.x, p.y); st.a0 = Math.atan2(p.y, p.x); };
    place.forEach((t, i) => {
      if (!t) return;
      const st = pools[t].shift();
      if (st) { st.zIndex = i; at(st, slotSky(SLOTS[i].k, SLOTS[i].j)); }
    });
    /* しまってある星・入りきらない星は、星座の輪の内側に散らす（毎回同じ場所になるよう、番号で決める） */
    held.concat(extra).forEach((t, n) => {
      const st = pools[t].shift();
      if (!st) return;
      st.zIndex = TOTAL + n;
      const r2 = 40 + ((n * 0.618) % 1) * geo.ringR * 0.45, a2 = n * 2.39996;
      at(st, { x: Math.cos(a2) * r2, y: Math.sin(a2) * r2 });
    });
    noteCompleted();
    if (panelOpen) renderPanel();
  }

  function filledIn(k) { let n = 0; for (let i = ZODIAC[k].start; i < ZODIAC[k].end; i++) if (place[i]) n++; return n; }
  function isDone(k) { return filledIn(k) === ZODIAC[k].p.length; }
  function noteCompleted() {
    if (!layoutLoaded) return;
    let changed = false;
    ZODIAC.forEach((z, k) => { if (isDone(k) && !layout.completed[z.id]) { layout.completed[z.id] = Date.now(); changed = true; } });
    if (changed) save();
  }

  /* ───── 描く（room2.js の render から毎フレーム） ───── */
  function draw(ctx, time) {
    if (!geo) return;
    const cur = currentIndex();
    ZODIAC.forEach((z, k) => {
      const n = filledIn(k), done = n === z.p.length, started = n > 0;
      const has = j => !!place[z.start + j];
      const pts = z.p.map((_, j) => toScreen(slotSky(k, j)));
      /* 線：完成＝金色の実線、作っている途中＝薄い点線、まだ＝ごく薄い点線（形だけ見える） */
      ctx.save();
      ctx.lineWidth = done ? 1.1 : 0.8;
      z.l.forEach(([a, b]) => {
        const both = has(a) && has(b);
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
        z.p.forEach((_, j) => { if (!has(j)) { ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, 3.2, 0, Math.PI * 2); ctx.stroke(); } });
      }
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

  /* ───── 保存（親へ頼む。親はサーバーへ） ───── */
  function save() {
    if (!layoutLoaded || layoutFailed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const slots = place.slice();
      while (slots.length && !slots[slots.length - 1]) slots.pop();
      layout.slots = slots; layout.held = held.slice();
      try {
        window.parent.postMessage({ type: "EMU_STAR_LAYOUT_SAVE", layout: {
          slots: layout.slots, held: layout.held, customs: layout.customs, completed: layout.completed } }, window.location.origin);
      } catch (e) {}
    }, 600);
  }
  function receive(msg) {
    if (!msg || msg.ok !== true) { layoutFailed = true; layoutLoaded = false; if (panelOpen) renderPanel(); return; }
    const d = msg.layout || {};
    const okType = t => typeof t === "string" && t.length <= 60;
    layout.slots = Array.isArray(d.slots) ? d.slots.slice(0, TOTAL).map(t => (okType(t) ? t : "")) : [];
    layout.held = Array.isArray(d.held) ? d.held.filter(okType).slice(0, 600) : [];
    layout.customs = Array.isArray(d.customs) ? d.customs.filter(validCustom).slice(0, CUSTOM_MAX) : [];
    layout.completed = d.completed && typeof d.completed === "object" ? Object.assign({}, d.completed) : {};
    layoutLoaded = true; layoutFailed = false;
    if (typeof stars !== "undefined" && stars.length) assign(stars); else if (panelOpen) renderPanel();
  }
  function validCustom(c) {
    return c && typeof c.name === "string" && Array.isArray(c.points) && Array.isArray(c.lines)
      && c.points.length <= CUSTOM_POINTS && c.points.every(p => Array.isArray(p) && p.length === 3);
  }

  /* ───── 並びを変える（どの星を、どの星座のどの点に使うか） ─────
     変えたら layout に写して保存し、星を置き直す */
  function commit() {
    layout.slots = place.slice(); layout.held = held.slice();
    save();
    if (typeof stars !== "undefined") assign(stars);
  }
  /* 2つの点を入れ替える（片方が空いていれば、そこへ動かす） */
  function swapSlots(i, j) {
    if (i === j || i < 0 || j < 0 || i >= TOTAL || j >= TOTAL || (!place[i] && !place[j])) return;
    const t = place[i]; place[i] = place[j]; place[j] = t;
    commit();
  }
  /* 点の星をしまう（点は空いたまま） */
  function takeOut(i) {
    if (!place[i]) return;
    held.push(place[i]); place[i] = "";
    commit();
  }
  /* 点 i に、種類 type の星を置く。しまってある星 → 12星座に入りきらない星 → ほかの星座の星（後ろの星座から）の順に探す。
     点にいた星は、しまう（ほかの星座から持ってきたときは、その点と入れ替える） */
  function putType(i, type) {
    if (i < 0 || i >= TOTAL || place[i] === type) return;
    const old = place[i];
    let from = held.indexOf(type);
    if (from >= 0) { held.splice(from, 1); if (old) held.push(old); place[i] = type; return commit(); }
    from = extra.indexOf(type);
    if (from >= 0) { extra.splice(from, 1); if (old) held.push(old); place[i] = type; return commit(); }
    const k = SLOTS[i].k, z = ZODIAC[k];
    for (let j = TOTAL - 1; j >= 0; j--) {
      if (j >= z.start && j < z.end) continue;
      if (place[j] === type) { place[j] = old; place[i] = type; return commit(); }
    }
  }
  /* この星座の星を全部しまう */
  function clearConstellation(k) {
    const z = ZODIAC[k];
    for (let i = z.start; i < z.end; i++) if (place[i]) { held.push(place[i]); place[i] = ""; }
    commit();
  }
  /* しまってある星（と入りきらない星）で、この星座の空いている点を埋める */
  function fillConstellation(k) {
    const z = ZODIAC[k];
    for (let i = z.start; i < z.end; i++) {
      if (place[i]) continue;
      if (held.length) place[i] = held.shift();
      else if (extra.length) place[i] = extra.shift();
      else break;
    }
    commit();
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

  /* 小さな星座の絵（SVG）。図鑑のカードと、並べ替えの画面で使う。大きい絵では、どの点も押せる（空いている点も） */
  function figure(k, big) {
    const z = ZODIAC[k], n = filledIn(k), size = big ? 300 : 120, pad = big ? 26 : 12;
    const P = z.p.map(([x, y]) => [pad + (x + 1) / 2 * (size - pad * 2), pad + (y + 1) / 2 * (size - pad * 2)]);
    const has = j => !!place[z.start + j];
    const lines = z.l.map(([a, b]) => `<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}" stroke="${n === z.p.length ? "#ffe2a8" : "#9fb4e6"}" stroke-opacity="${has(a) && has(b) ? 0.7 : 0.25}" ${has(a) && has(b) ? "" : 'stroke-dasharray="3 4"'} stroke-width="${big ? 1.6 : 1.2}"/>`).join("");
    const dots = z.p.map((_, j) => {
      const i = z.start + j, t = place[i], r = big ? 9 : 4;
      const sel = big && view.sel === i ? `<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r + 7}" fill="none" stroke="#ffe2a8" stroke-width="2"/>` : "";
      const dot = t
        ? `<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r * 1.9}" fill="${esc(lookOf(t).color)}" opacity=".25"/><circle cx="${P[j][0]}" cy="${P[j][1]}" r="${r}" fill="${esc(lookOf(t).color)}" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>`
        : `<circle cx="${P[j][0]}" cy="${P[j][1]}" r="${big ? r * 0.8 : r * 0.7}" fill="none" stroke="#9fb4e6" stroke-opacity=".6" ${big ? 'stroke-dasharray="2 3"' : ""}/>`;
      const hit = big ? `<circle data-slot="${i}" cx="${P[j][0]}" cy="${P[j][1]}" r="22" fill="transparent" style="cursor:pointer"><title>${t ? esc(nameOfType(t)) : "空いている点"}</title></circle>` : "";
      return sel + dot + hit;
    }).join("");
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="${big ? "false" : "true"}">${lines}${dots}</svg>`;
  }
  function chip(t, extraHtml, data) {
    return `<button type="button" class="zb-chip" ${data}><i style="background:${esc(lookOf(t).color)}"></i>${esc(nameOfType(t))}${extraHtml}</button>`;
  }
  function spareSummary() {
    const types = [...new Set(held.concat(extra))];
    if (!types.length) return "";
    return `<p class="zb-note">しまってある星：${types.map(t => esc(nameOfType(t)) + " " + spareOf(t)).join("・")}</p>`;
  }

  function renderPanel() {
    const panel = document.getElementById("zodiacBook");
    if (!panel || !panelOpen) return;
    if (view.k >= 0) return renderDetail(panel);
    if (view.custom >= 0) return renderCustom(panel);
    const doneCount = ZODIAC.filter((z, k) => isDone(k)).length;
    const saveNote = layoutFailed ? '<p class="zb-note">並びを読み込めなかったため、いまは並べ替え・保存ができません。<button type="button" class="zb-chip" data-retry>もう一度読み込む</button></p>'
      : !layoutLoaded ? '<p class="zb-note">並びを読み込んでいます…</p>' : "";
    panel.innerHTML = `<header class="zb-head"><h2>📖 星座図鑑</h2><p>集めた星は、空いている点に前から順に入ります。星座を開くと、どの星をどの星座に使うかを自由に変えられます。完成 <b>${doneCount}</b> / 12　・　星 ${ownedCount()} 個</p>${spareSummary()}${saveNote}</header>
      <div class="zb-grid">${ZODIAC.map((z, k) => {
        const n = filledIn(k), done = n === z.p.length, when = layout.completed[z.id];
        return `<button type="button" class="zb-card${done ? " done" : n ? " going" : ""}" data-open="${k}">
          ${figure(k, false)}<b>${esc(z.name)}</b><span>${done ? "完成" + (when ? "・" + day(when) : "") : n + " / " + z.p.length}</span></button>`;
      }).join("")}</div>
      <section class="zb-custom"><h3>✨ 自分だけの星座</h3><p>持っている星を点に置いて、線で結び、名前を付けます（${CUSTOM_MAX}つまで）。</p>
        <div class="zb-row">${(layout.customs || []).map((c, i) => `<button type="button" class="zb-chip" data-custom="${i}"${canEdit() ? "" : " disabled"}>${esc(c.name || "わたしの星座")}</button>`).join("")}
        ${(layout.customs || []).length < CUSTOM_MAX ? `<button type="button" class="zb-chip add" data-custom="${(layout.customs || []).length}"${canEdit() ? "" : " disabled"}>＋ つくる</button>` : ""}</div>
        ${canEdit() ? "" : `<p class="zb-note">${ownedCount() ? "並びを読み込めると、つくれるようになります。" : "星ができると、つくれるようになります。"}</p>`}</section>
      <section class="zb-custom zb-learn"><h3>🔭 星を知る</h3>${STAR_FACTS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>`;
  }
  function canEdit() { return layoutLoaded && !layoutFailed && ownedCount() > 0; }

  /* 星座の画面：並べ替え（どの星を使うか）と、この星座を知る */
  function renderDetail(panel) {
    const k = view.k, z = ZODIAC[k], n = filledIn(k), done = n === z.p.length, sel = view.sel, st = z.study || {};
    const empties = z.p.length - n, spare = held.length + extra.length;
    let tools = "";
    if (canEdit()) {
      if (sel >= 0) {
        const types = allTypes().filter(t => t !== place[sel]);
        tools = `<p class="zb-note">${place[sel] ? "選んだ「" + esc(nameOfType(place[sel])) + "」の点。ほかの点を押すと入れ替え、下の星を選ぶと置きかえます。" : "空いている点。下の星を選ぶと、ここに置きます。ほかの点を押すと、その星をここへ動かします。"}</p>
          <div class="zb-row">${types.map(t => {
            const s = spareOf(t);
            return chip(t, s ? ` <small>しまってある ${s}</small>` : ' <small>ほかの星座から</small>', `data-put="${esc(t)}"`);
          }).join("")}${place[sel] ? '<button type="button" class="zb-chip" data-takeout>この星をしまう</button>' : ""}<button type="button" class="zb-chip" data-cancel>やめる</button></div>`;
      } else {
        tools = `<p class="zb-note">点を押すと選べます。どの星をどの星座に使うかは自由です（星をしまって、ほかの星座に回すこともできます）。</p>
          <div class="zb-row">${empties && spare ? '<button type="button" class="zb-chip" data-fill>しまってある星で埋める</button>' : ""}${n ? '<button type="button" class="zb-chip" data-clear>この星座の星を全部しまう</button>' : ""}</div>`;
      }
    } else if (layoutFailed) {
      tools = '<p class="zb-note">並びを読み込めなかったため、いまは並べ替えができません。<button type="button" class="zb-chip" data-retry>もう一度読み込む</button></p>';
    }
    panel.innerHTML = `<header class="zb-head"><button type="button" class="zb-back" data-back>← 図鑑</button><h2>${esc(z.name)} <small>${esc(z.en)}</small></h2>
      <p>${done ? "完成" + (layout.completed[z.id] ? "（" + day(layout.completed[z.id]) + "）" : "") : n + " / " + z.p.length + "　あと " + empties + " 個で完成"}</p></header>
      <div class="zb-figure">${figure(k, true)}</div>
      ${tools}${spareSummary()}
      ${done ? `<button type="button" class="zb-share" data-share="${k}">X でシェア</button>` : ""}
      <section class="zb-study"><h3>📚 ${esc(z.name)}を知る</h3>
        <dl><div><dt>見ごろ</dt><dd>${esc(st.season || "")}<small>夜8時ごろ、南の空に来るころ</small></dd></div>
        <div><dt>主な星</dt><dd>${esc(st.stars || "")}</dd></div>
        <div><dt>誕生星座</dt><dd>${esc(st.birth || "")}<small>占いでよく使われる、およその期間</small></dd></div></dl>
        <h4>お話</h4><p>${esc(st.myth || "")}</p>
        <h4>豆知識</h4><p>${esc(st.fact || "")}</p></section>`;
  }

  /* 自分だけの星座をつくる画面 */
  let draft = null, draftName = "", draftSel = -1, draftType = "";
  function ownedOf(t) { return place.filter(x => x === t).length + spareOf(t); }
  function renderCustom(panel) {
    const types = allTypes();
    if (!draftType) draftType = types[0] || "";
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
      <p>使う星を下で選んでから、点を押すと星を置きます。置いた星を2つ続けて押すと線で結びます。選んだ星をもう一度押すと消えます。</p></header>
      <label class="zb-name">名前<input id="zodiacCustomName" maxlength="12" value="${esc(draftName)}" placeholder="例：はじまりの冷蔵庫座"></label>
      <div class="zb-row">${types.map(t => `<button type="button" class="zb-chip${t === draftType ? " on" : ""}" data-pick="${esc(t)}"><i style="background:${esc(lookOf(t).color)}"></i>${esc(nameOfType(t))} ${ownedOf(t) - (used[t] || 0)}</button>`).join("")}</div>
      <div class="zb-figure"><svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${cells}${lines}${pts}</svg></div>
      <p class="zb-note">置けるのは、持っている星の数まで・${CUSTOM_POINTS}個まで（黄道12星座の星とは別に数えます）。</p>
      <div class="zb-row"><button type="button" class="zb-share" data-customsave${draft.points.length ? "" : " disabled"}>この星座を残す</button>${view.custom < (layout.customs || []).length ? '<button type="button" class="zb-chip" data-customdel>この星座を消す</button>' : ""}</div>`;
  }

  function onPanelClick(e) {
    const t = e.target.closest("[data-open],[data-back],[data-slot],[data-put],[data-takeout],[data-fill],[data-clear],[data-cancel],[data-share],[data-custom],[data-cell],[data-point],[data-pick],[data-customsave],[data-customdel],[data-retry]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.retry !== undefined) {
      layoutFailed = false;
      try { window.parent.postMessage({ type: "EMU_STAR_LAYOUT_RELOAD" }, window.location.origin); } catch (_) {}
      return renderPanel();
    }
    if (d.open !== undefined) { view = { k: Number(d.open), sel: -1, custom: -1 }; return renderPanel(); }
    if (d.back !== undefined) { view = { k: -1, sel: -1, custom: -1 }; draft = null; return renderPanel(); }
    if (d.slot !== undefined) {
      if (!canEdit()) return;
      const i = Number(d.slot);
      if (view.sel < 0) view.sel = i;
      else if (view.sel === i) view.sel = -1;
      else { swapSlots(view.sel, i); view.sel = -1; }
      return renderPanel();
    }
    if (d.put !== undefined) { putType(view.sel, d.put); view.sel = -1; return renderPanel(); }
    if (d.takeout !== undefined) { takeOut(view.sel); view.sel = -1; return renderPanel(); }
    if (d.fill !== undefined) { fillConstellation(view.k); return renderPanel(); }
    if (d.clear !== undefined) { clearConstellation(view.k); return renderPanel(); }
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
      const used = draft.points.filter(p => p[2] === draftType).length;
      if (!draftType || used >= ownedOf(draftType) || draft.points.length >= CUSTOM_POINTS) return;
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
  function shareDone(k) {
    const z = ZODIAC[k], doneCount = ZODIAC.filter((zz, kk) => isDone(kk)).length;
    const text = `🌌 ${z.name}が完成しました（${doneCount}/12星座）\nEmu for SchoolPark で、行動と貢献が星になって星座に。\n\n#EmuforSchoolPark`;
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
  }

  window.Zodiac = { ZODIAC, TOTAL, assign, draw, receive, setMode,
    get order() { return place.slice(); }, get held() { return held.slice(); }, get layout() { return JSON.parse(JSON.stringify(layout)); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ui); else ui();
})();
