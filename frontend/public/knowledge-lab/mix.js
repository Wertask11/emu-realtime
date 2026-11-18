/* Knowledge Lab の掛け合わせ（11/18 オーナー）

   1. Knowledge Text と同じように、まず分野のカードを並べる（分野は Knowledge Lab の分類の「分野」）。右上にその分野の数
   2. 分野を押すと、その分野の知識が出る。上の切り替えで Knowledge Text の教材も選べる
   3. 「掛け合わせる」をオンにすると、知識に「枠に入れる」が出る。最初の1つがメイン、あとから最大4つ
      ・枠を押すと、その枠に入れる知識を選び直せる（メインにする・外すも）
      ・カードを枠へドラッグして入れられる（スマホは長押ししてから動かす）。右へスワイプでも入る。左へスワイプで外れる
   4. 「混ぜる」で掛け合わせる（1人1日3回。同じ組み合わせの2回目は数えない）。ゲームのように、混ぜる → カプセル → 開ける → 新しい発見
   5. 出てきた発見は「自分だけに保存」「公開（みんなの発見に載る）」「ギルドの議題にする（Lab の中で出す）」「クエストに参加する」へ

   画面では「AI」と言わない（11/18 オーナー）。送る先と決まりはプライバシーポリシーに書いてある。
   書いた文やえらんだ知識の中身は、計測（PostHog）へ送らない。送るのは件数と段階だけ。 */
(() => {
  "use strict";
  const core = () => window.EmuLabCore;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const SLOTS = 5; // 0 がメイン、1〜4 が掛け合わせ

  /* 分野のひとこと（Knowledge Text の「どれを磨く？」のカードと同じ形にする） */
  const FIELD_NOTE = {
    "field-money": "稼ぐ・貯める・守るの経験",
    "field-work": "働き方と転機の経験",
    "field-business": "立ち上げて、続けるための工夫",
    "field-education": "教える・学ぶの現場から",
    "field-it": "技術を使いこなした経験",
    "field-beauty": "見た目と心を整える知恵",
    "field-health": "体と向き合った経験",
    "field-mind": "気持ちと付き合うコツ",
    "field-law": "知らないと損するしくみ",
    "field-welfare": "支える・支えられる経験",
    "field-family": "家族と暮らす知恵",
    "field-life": "毎日をよくする工夫",
    "field-sales": "人に届ける技術",
    "field-food": "お店を回す現場の知恵",
  };
  const TEXT_THEMES = { money: "マネーリテラシー", net: "ネットリテラシー", life: "ライフリテラシー", blue: "ブルーファイル" };
  /* ギルドは5つ（schoolpark/guild-store.js と同じ ID）。議題を出すときに、発見の中身からおすすめを選ぶ（11/18 オーナー） */
  const GUILDS = [
    { id: "learn", short: "LEARN", concept: "知識を、やってみるに変える。", fields: ["field-education"],
      words: ["学", "勉強", "教育", "授業", "資格", "試験", "習慣", "知識", "練習", "読書", "探究", "子ども", "先生"] },
    { id: "work", short: "WORK", concept: "貢献を、仕事と次の機会へ。", fields: ["field-work", "field-business", "field-sales", "field-food", "field-money"],
      words: ["仕事", "営業", "商談", "接客", "経営", "起業", "開業", "店", "売上", "顧客", "お客", "常連", "報酬", "案件", "キャリア", "転職", "資金", "副業", "稼"] },
    { id: "play", short: "PLAY", concept: "遊びから、挑戦と出会いを。", fields: ["field-beauty", "field-life"],
      words: ["遊", "ゲーム", "謎解き", "イベント", "ライブ", "旅", "趣味", "公園", "宝探し", "体験", "楽し", "推し", "スポーツ", "運動"] },
    { id: "connect", short: "CONNECT", concept: "孤立ではなく、つながりながら自立する。", fields: ["field-family", "field-welfare", "field-mind", "field-health"],
      words: ["つなが", "コミュニティ", "居場所", "交流", "支え", "仲間", "友", "家族", "子育て", "孤独", "孤立", "心", "感情", "気持ち", "相談", "介護", "福祉"] },
    { id: "web3", short: "WEB3", concept: "信用・価値・実績を持ち運べる社会基盤をつくる。", fields: ["field-it", "field-law"],
      words: ["Web3", "ブロックチェーン", "NFT", "DAO", "トークン", "暗号", "ウォレット", "EMUER", "Passport", "パスポート", "信用", "証明", "デジタル", "AI", "IT"] },
  ];
  const MESSAGES = {
    AI_DISABLED: "掛け合わせは、いま準備中です。少し待ってから試してね。",
    AI_STOPPED: "掛け合わせは、いま準備中です。少し待ってから試してね。",
    AI_DAILY_LIMIT: "今日の掛け合わせは使い切ったよ（1日3回まで）。明日また混ぜられるよ。",
    AI_BUSY: "いま、ほかの人が混ぜているところ。少し待ってからもう一度押してね。",
    AI_SENSITIVE_SOURCE: "メールアドレスや電話番号などが入っている知識は混ぜられません。外してから混ぜてね。",
    AI_SOURCE_COUNT: "メイン1つと、掛け合わせる知識を1つ以上入れてね。",
    AI_SOURCES_CHANGED: "混ぜているあいだに、元の知識が書き換えられました。もう一度混ぜてね。",
    AI_INPUT_LIMIT: "知識が長すぎて混ぜられませんでした。数を減らしてね。",
    AI_PROVIDER_UNAVAILABLE: "混み合っています。少し待ってからもう一度押してね。",
    AI_FREE_QUOTA_EXHAUSTED: "今日はもう混ぜられません。明日また混ぜられるよ。",
    AI_OUTPUT_BLOCKED_OR_TRUNCATED: "うまく混ざりませんでした。組み合わせを変えて試してね。",
    AI_INVALID_OUTPUT: "うまく混ざりませんでした。もう一度押してね。",
    AUTH_REQUIRED: "混ぜるにはログインが必要です。",
    NOT_FOUND: "見つからない知識が入っています。外してから混ぜてね。",
    NOTE_LIMIT: "保存できる数がいっぱいです。プロフィールの「Knowledge Lab の記録」で整理してから保存してね。",
    PRIVATE_SOURCE: "公開されていない知識が入っているので、公開できません。自分だけに保存してね。",
  };
  const message = (e) => {
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(e?.message || "") ? e.message : "SERVICE_UNAVAILABLE";
    return MESSAGES[code] || "うまくいきませんでした。少し待ってからもう一度試してね。";
  };

  const st = {
    built: false,
    source: "posts", // posts | texts
    field: null,
    textTheme: null,
    cursor: null,
    items: new Map(), // id → 表示した知識・教材
    slots: Array(SLOTS).fill(null),
    mode: false,
    quota: null,
    run: null,
    note: null,
    texts: null,
    busy: false,
    counts: null,
    countsAt: 0,
    feed: null,
  };
  const main = () => st.slots[0];
  const others = () => st.slots.slice(1).filter(Boolean);

  function root() { return $("#mix"); }
  function build() {
    if (st.built) return;
    st.built = true;
    root().innerHTML = `
      <div class="mix-top">
        <div class="mix-source" role="group" aria-label="材料">
          <button type="button" data-src="posts" aria-pressed="true">みんなの知識</button>
          <button type="button" data-src="texts" aria-pressed="false">Knowledge Text</button>
        </div>
        <label class="mix-switch" data-tour="mix-toggle"><input type="checkbox" id="mixMode"><span class="mix-knob" aria-hidden="true"></span><span>掛け合わせる</span></label>
      </div>
      <div id="mixHome">
        <p class="mix-title">どの分野を見る？</p>
        <div class="mix-grid" id="mixFields" data-tour="mix-fields"></div>
        <section class="mix-feed" id="mixFeed" aria-labelledby="mixFeedTitle" hidden>
          <h2 id="mixFeedTitle">みんなの新しい発見 <span aria-hidden="true">✨</span></h2>
          <div id="mixFeedList"></div>
        </section>
      </div>
      <div id="mixTextHome" hidden>
        <p class="mix-title">どの教材を使う？</p>
        <div class="mix-grid" id="mixThemes"></div>
      </div>
      <div id="mixList" hidden>
        <button type="button" class="mix-back" id="mixBack">← もどる</button>
        <h2 id="mixListTitle"></h2>
        <p class="mix-hint" id="mixHint" hidden>カードを枠へドラッグ／右へスワイプで入れられるよ</p>
        <div id="mixItems" class="mix-items"></div>
        <button type="button" id="mixMore" class="mix-more" hidden>もっと見る</button>
      </div>
      <aside id="mixTray" class="mix-tray" hidden data-tour="mix-tray" aria-label="掛け合わせる知識">
        <div class="mix-slots" id="mixSlots"></div>
        <div class="mix-go-row"><button type="button" id="mixGo" class="mix-go" disabled>混ぜる ⚗️</button><small id="mixQuota"></small></div>
      </aside>
      <div id="mixPick" class="mix-pick" hidden role="dialog" aria-modal="true" aria-labelledby="mixPickTitle"></div>
      <div id="mixStage" class="mix-stage" hidden role="dialog" aria-modal="true" aria-label="掛け合わせ"></div>`;
    root().querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => setSource(b.dataset.src)));
    $("#mixMode").onchange = (e) => setMode(e.target.checked);
    $("#mixBack").onclick = () => (st.source === "posts" ? showHome() : showTextHome());
    $("#mixMore").onclick = () => core().run(() => loadField(true));
    $("#mixGo").onclick = () => core().run(go);
    bindTrayDrop();
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#mixPick").hidden) closePick();
      else if (!$("#mixStage").hidden && !st.busy && !$("#mixStage").classList.contains("mixing")) closeStage();
    });
    renderFields();
  }

  /* ───── 分野・教材の一覧 ───── */
  function countBadge(n) {
    return typeof n === "number" ? `<em class="mix-count" aria-label="${n}件">${n}件</em>` : "";
  }
  async function loadCounts() {
    if (st.countsAt && Date.now() - st.countsAt < 300000) return;
    try {
      st.counts = (await core().api("/field-counts")).counts || null;
      st.countsAt = Date.now();
    } catch (_) {
      st.counts = null;
    }
    renderFields();
  }
  function fieldTerms() {
    return (core().terms() || []).filter((t) => t.axis === "field" && t.active !== false && !t.mergedInto);
  }
  function renderFields() {
    const terms = fieldTerms();
    $("#mixFields").innerHTML = terms.length
      ? terms.map((t) => `<button type="button" class="mix-card" data-field="${esc(t.id)}">${countBadge(st.counts?.[t.id])}<b>${esc(t.label)}</b><span>${esc(FIELD_NOTE[t.id] || "みんなの経験から")}</span></button>`).join("")
      : '<p class="mix-empty">分野を読み込めませんでした。少し待って、開き直してね。</p>';
    $("#mixFields").querySelectorAll("[data-field]").forEach((b) => (b.onclick = () => core().run(() => openField(b.dataset.field))));
  }
  /* みんなの新しい発見（公開された掛け合わせ。新しい順） */
  async function loadFeed() {
    try {
      st.feed = (await core().api("/discoveries")).items || [];
    } catch (_) {
      st.feed = st.feed || [];
    }
    renderFeed();
  }
  function feedCard(d, fresh) {
    return `<button type="button" class="mix-feed-card${fresh ? " fresh" : ""}" data-note="${esc(d.id)}">
      <b>${esc(d.find || d.title)}</b>
      <span>${(d.sources || []).map((x) => `<i class="${x.main ? "main" : ""}">${esc(x.title)}</i>`).join("")}</span>
    </button>`;
  }
  function renderFeed(freshId) {
    const list = st.feed || [];
    $("#mixFeed").hidden = !list.length;
    $("#mixFeedList").innerHTML = list.slice(0, 12).map((d) => feedCard(d, d.id === freshId)).join("");
    $("#mixFeedList").querySelectorAll("[data-note]").forEach((b) => (b.onclick = () => core().note?.(b.dataset.note)));
  }
  function setSource(src) {
    st.source = src;
    root().querySelectorAll("[data-src]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === src)));
    if (src === "posts") showHome();
    else core().run(showTextHome);
  }
  function showHome() {
    $("#mixHome").hidden = false;
    $("#mixTextHome").hidden = true;
    $("#mixList").hidden = true;
  }
  async function texts() {
    if (!st.texts) st.texts = await core().api("/texts");
    st.texts.forEach((t) => st.items.has(t.id) || st.items.set(t.id, { ...t, kind: "text", body: t.excerpt, displayName: "Knowledge Text" }));
    return st.texts;
  }
  async function showTextHome() {
    $("#mixHome").hidden = true;
    $("#mixList").hidden = true;
    $("#mixTextHome").hidden = false;
    if (!st.texts) $("#mixThemes").innerHTML = '<p class="mix-empty">教材を読み込んでいます…</p>';
    const list = await texts();
    const groups = {};
    list.forEach((t) => (groups[t.theme] = (groups[t.theme] || 0) + 1));
    const keys = Object.keys(groups);
    $("#mixThemes").innerHTML = keys.length
      ? keys.map((k) => `<button type="button" class="mix-card" data-theme="${esc(k)}">${countBadge(groups[k])}<b>${esc(TEXT_THEMES[k] || k || "Knowledge Text")}</b><span>運営がまとめた学習教材</span></button>`).join("")
      : '<p class="mix-empty">まだ教材がありません。</p>';
    $("#mixThemes").querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => openTheme(b.dataset.theme)));
  }
  async function openField(id) {
    st.field = id;
    st.cursor = null;
    const term = fieldTerms().find((t) => t.id === id);
    $("#mixListTitle").textContent = term ? term.label : "知識";
    $("#mixItems").innerHTML = '<p class="mix-empty">読み込んでいます…</p>';
    showList();
    await loadField(false);
  }
  async function searchField(field, cursor) {
    const p = new URLSearchParams({ field, sort: "new", mode: "lexical" });
    if (cursor) p.set("cursor", cursor);
    const data = await core().api("/search?" + p, { optional: true });
    data.items.forEach((x) => st.items.set(x.id, { ...x, kind: "post", fieldId: field }));
    return data;
  }
  async function loadField(more) {
    const data = await searchField(st.field, more ? st.cursor : null);
    if (!more) $("#mixItems").innerHTML = "";
    $("#mixItems").insertAdjacentHTML(
      "beforeend",
      data.items.map((x) => itemCard(st.items.get(x.id))).join("") ||
        (!more ? '<p class="mix-empty">この分野の知識はまだありません。ほかの分野も見てみてね。</p>' : ""),
    );
    st.cursor = data.next || null;
    $("#mixMore").hidden = !st.cursor;
    bindItems();
  }
  function openTheme(theme) {
    st.textTheme = theme;
    $("#mixListTitle").textContent = "Knowledge Text｜" + (TEXT_THEMES[theme] || theme);
    const list = (st.texts || []).filter((t) => t.theme === theme);
    $("#mixItems").innerHTML = list.map((t) => itemCard(st.items.get(t.id))).join("") || '<p class="mix-empty">このテーマの教材はまだありません。</p>';
    $("#mixMore").hidden = true;
    showList();
    bindItems();
  }
  function showList() {
    $("#mixHome").hidden = true;
    $("#mixTextHome").hidden = true;
    $("#mixList").hidden = false;
    $("#mixHint").hidden = !st.mode;
    $("#mixList").scrollIntoView?.({ block: "start" });
  }
  function slotOf(id) {
    return st.slots.findIndex((x) => x && x.id === id);
  }
  function itemCard(x) {
    const label = x.kind === "text" ? [x.subTheme, x.subSubTheme].filter(Boolean).join("／") : x.displayName;
    const at = slotOf(x.id);
    const add = !st.mode ? ""
      : at >= 0 ? `<button type="button" class="mix-add on" data-take="${esc(x.id)}">✓ ${at === 0 ? "メイン" : "掛け合わせ " + at}に入っています</button>`
      : `<button type="button" class="mix-add" data-take="${esc(x.id)}">＋ 枠に入れる</button>`;
    return `<article class="mix-item${x.kind === "text" ? " is-text" : ""}${at >= 0 ? " is-placed" : ""}" data-id="${esc(x.id)}"${st.mode ? ' draggable="true"' : ""}>
      <small>${x.kind === "text" ? "📘 Knowledge Text" : "📗 みんなの知識"}${label ? "・" + esc(label) : ""}</small>
      <h3>${esc(x.title)}</h3>
      <p>${esc(String(x.body || "").slice(0, 120))}${String(x.body || "").length > 120 ? "…" : ""}</p>
      <div class="mix-item-actions">${x.kind === "post" ? `<button type="button" data-read="${esc(x.id)}">読む</button>` : `<button type="button" data-read-text="${esc(x.id)}">${x.full ? "閉じる" : "読む"}</button>`}${add}</div>
      ${x.kind === "text" && x.full ? `<div class="mix-text-full">${esc(x.full)}</div>` : ""}
    </article>`;
  }
  function bindItems() {
    $("#mixItems").querySelectorAll("[data-read]").forEach((b) => (b.onclick = () => core().detail(b.dataset.read)));
    $("#mixItems").querySelectorAll("[data-take]").forEach((b) => (b.onclick = () => take(b.dataset.take)));
    /* Knowledge Text の教材は、この場で全文を開く（Lab から離れない） */
    $("#mixItems").querySelectorAll("[data-read-text]").forEach((b) => (b.onclick = () => core().run(async () => {
      const x = st.items.get(b.dataset.readText);
      if (!x) return;
      if (x.full) x.full = "";
      else x.full = (await core().api("/texts/" + encodeURIComponent(x.id))).body || "";
      redrawItems();
    })));
    if (st.mode) $("#mixItems").querySelectorAll(".mix-item").forEach(bindItemGestures);
  }
  function redrawItems() {
    $("#mixItems").querySelectorAll(".mix-item").forEach((el) => {
      const x = st.items.get(el.dataset.id);
      if (x) el.outerHTML = itemCard(x);
    });
    bindItems();
  }

  /* ───── 枠（メイン1つ＋最大4つ） ───── */
  function setMode(on) {
    st.mode = on;
    $("#mixMode").checked = on;
    $("#mixTray").hidden = !on;
    $("#mixHint").hidden = !on;
    root().classList.toggle("mix-on", on);
    redrawItems();
    syncTray();
    if (on) core().measure?.("knowledge_lab_mix", { stage: "mode_on" });
    if (on && !core().me()) core().showLogin();
    if (on) quota().catch(() => {});
  }
  function changed(pulse) {
    redrawItems();
    syncTray(pulse);
  }
  /* i 番の枠に入れる。ほかの枠に入っていたら、そこからは外す（入れ替え） */
  function put(i, x) {
    if (!x || i < 0 || i >= SLOTS) return;
    const from = slotOf(x.id);
    if (from === i) return;
    const prev = st.slots[i];
    st.slots[i] = x;
    if (from >= 0) st.slots[from] = prev; // 別の枠から動かしたときは、入れ替える
    if (!st.slots[0]) promote();
    changed(true);
  }
  function swap(a, b) {
    if (a === b) return;
    [st.slots[a], st.slots[b]] = [st.slots[b], st.slots[a]];
    if (!st.slots[0]) promote();
    changed(true);
  }
  /* メインが空いたら、掛け合わせの最初の知識をメインにする */
  function promote() {
    const i = st.slots.findIndex((x, k) => k > 0 && x);
    if (i > 0) { st.slots[0] = st.slots[i]; st.slots[i] = null; }
  }
  function take(id) {
    const x = st.items.get(id);
    if (!x) return;
    const at = slotOf(id);
    if (at >= 0) return removeAt(at);
    const free = st.slots.findIndex((s) => !s);
    if (free < 0) return core().status("枠がいっぱいです（メイン1つ＋4つまで）。枠を押すと入れ替えられます。", true);
    st.slots[free] = x;
    changed(true);
  }
  function removeAt(i) {
    st.slots[i] = null;
    if (i === 0) promote();
    changed();
  }
  function slotHtml(i) {
    const x = st.slots[i];
    const name = i === 0 ? "メイン" : "掛け合わせ " + i;
    if (!x) return `<button type="button" class="mix-slot${i === 0 ? " main" : ""} is-empty" data-slot="${i}" aria-label="${name}の枠（空き）を選ぶ"><span>${name}</span><small>${i === 0 ? "押して選ぶ" : "空き・押して選ぶ"}</small></button>`;
    return `<button type="button" class="mix-slot${i === 0 ? " main" : ""}${x.kind === "text" ? " is-text" : ""}" data-slot="${i}" draggable="true" aria-label="${name}：${esc(x.title)}（押すと選び直せます）"><span>${name}</span><b>${esc(x.title)}</b><small>押して選び直す</small></button>`;
  }
  function syncTray(pulse) {
    if (!st.built) return;
    // 左に2つ、真ん中にメイン、右に2つ
    $("#mixSlots").innerHTML = [1, 2, 0, 3, 4].map(slotHtml).join("");
    $("#mixSlots").querySelectorAll("[data-slot]").forEach((b) => {
      b.onclick = () => { if (!b.dataset.dragged) openPick(Number(b.dataset.slot)); delete b.dataset.dragged; };
      bindSlotGestures(b);
    });
    if (pulse && !reduced()) {
      $("#mixSlots").classList.remove("pulse");
      void $("#mixSlots").offsetWidth;
      $("#mixSlots").classList.add("pulse");
    }
    const ready = !!main() && others().length > 0;
    const left = st.quota ? st.quota.remaining : null;
    $("#mixGo").disabled = st.busy || !ready || left === 0 || st.quota?.available === false;
    $("#mixQuota").textContent =
      st.quota?.available === false ? "掛け合わせは準備中です"
        : left === null ? "1日3回まで"
        : left === 0 ? "今日はもう混ぜられません（1日3回まで）"
        : "今日あと " + left + " 回";
  }
  async function quota() {
    if (!core().me()) return;
    st.quota = await core().api("/ai/mix/quota", { auth: true });
    syncTray();
  }

  /* ───── 枠を押して選ぶ ───── */
  let pickSlot = 0, pickTab = "posts", pickField = null;
  function openPick(i) {
    pickSlot = i;
    pickField = pickField || st.field || fieldTerms()[0]?.id || null;
    $("#mixPick").hidden = false;
    renderPick();
  }
  function closePick() {
    $("#mixPick").hidden = true;
    $("#mixPick").innerHTML = "";
  }
  function renderPick() {
    const x = st.slots[pickSlot];
    const name = pickSlot === 0 ? "メインの枠" : "掛け合わせ " + pickSlot + " の枠";
    const pool = [...st.items.values()].filter((y) => (pickTab === "texts" ? y.kind === "text" : y.kind === "post" && (!pickField || y.fieldId === pickField || (y.facets?.field || []).includes(pickField))));
    $("#mixPick").innerHTML = `<div class="mix-pick-veil" data-pick-close></div>
      <div class="mix-pick-card">
        <div class="mix-pick-head"><h2 id="mixPickTitle">${esc(name)}</h2><button type="button" class="mix-pick-x" data-pick-close aria-label="閉じる">×</button></div>
        ${x ? `<div class="mix-pick-now"><small>いま入っている知識</small><b>${esc(x.title)}</b><div>${pickSlot ? '<button type="button" data-pick-main>メインにする</button>' : ""}<button type="button" data-pick-remove>外す</button></div></div>` : ""}
        <div class="mix-source mix-pick-tabs"><button type="button" data-pick-tab="posts" aria-pressed="${pickTab === "posts"}">みんなの知識</button><button type="button" data-pick-tab="texts" aria-pressed="${pickTab === "texts"}">Knowledge Text</button></div>
        ${pickTab === "posts" ? `<select id="mixPickField" aria-label="分野">${fieldTerms().map((t) => `<option value="${esc(t.id)}"${t.id === pickField ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select>` : ""}
        <div class="mix-pick-list" id="mixPickList">${pool.length ? pool.map((y) => {
          const at = slotOf(y.id);
          return `<button type="button" class="mix-pick-row${at >= 0 ? " is-placed" : ""}" data-pick="${esc(y.id)}"><b>${esc(y.title)}</b><small>${at === pickSlot ? "この枠に入っています" : at >= 0 ? (at === 0 ? "メイン" : "掛け合わせ " + at) + "に入っています（入れ替え）" : y.kind === "text" ? "📘 Knowledge Text" : "📗 " + esc(y.displayName || "")}</small></button>`;
        }).join("") : '<p class="mix-empty">読み込んでいます…</p>'}</div>
      </div>`;
    $("#mixPick").querySelectorAll("[data-pick-close]").forEach((b) => (b.onclick = closePick));
    $("#mixPick").querySelector("[data-pick-main]")?.addEventListener("click", () => { swap(pickSlot, 0); closePick(); });
    $("#mixPick").querySelector("[data-pick-remove]")?.addEventListener("click", () => { removeAt(pickSlot); closePick(); });
    $("#mixPick").querySelectorAll("[data-pick-tab]").forEach((b) => (b.onclick = () => { pickTab = b.dataset.pickTab; renderPick(); }));
    $("#mixPickField")?.addEventListener("change", (e) => { pickField = e.target.value; renderPick(); });
    $("#mixPick").querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
      const y = st.items.get(b.dataset.pick);
      if (!y) return;
      if (slotOf(y.id) !== pickSlot) put(pickSlot, y);
      closePick();
    }));
    // まだ読んでいない分野・教材は、ここで読む
    if (!pool.length) {
      const need = pickTab === "texts" ? texts() : pickField ? searchField(pickField) : Promise.resolve();
      need.then((r) => { if (!$("#mixPick").hidden && (pickTab === "texts" || (r && r.items && r.items.length))) renderPick(); else if (!$("#mixPick").hidden) $("#mixPickList").innerHTML = '<p class="mix-empty">この分野の知識はまだありません。</p>'; })
        .catch(() => { if (!$("#mixPick").hidden) $("#mixPickList").innerHTML = '<p class="mix-empty">読み込めませんでした。少し待ってからもう一度開いてね。</p>'; });
    }
  }

  /* ───── ドラッグとスワイプ ─────
     パソコン：カードを枠へドラッグ。枠どうしをドラッグすると入れ替え。
     スマホ：カードを右へスワイプで入れる・左へスワイプで外す。長押ししてから動かすと、好きな枠へ入れられる */
  let dragPayload = null;
  function slotAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("#mixSlots [data-slot]") : null;
  }
  function dropTo(slotEl, payload) {
    if (!payload) return;
    if (payload.kind === "item") {
      const x = st.items.get(payload.id);
      if (!slotEl) return take(payload.id);
      put(Number(slotEl.dataset.slot), x);
    } else if (payload.kind === "slot" && slotEl) {
      swap(payload.index, Number(slotEl.dataset.slot));
    }
  }
  function bindTrayDrop() {
    const tray = $("#mixTray");
    tray.addEventListener("dragover", (e) => {
      if (!dragPayload) return;
      e.preventDefault();
      mark(e.target.closest?.("[data-slot]"));
    });
    tray.addEventListener("dragleave", () => mark(null));
    tray.addEventListener("drop", (e) => {
      if (!dragPayload) return;
      e.preventDefault();
      const target = e.target.closest?.("[data-slot]");
      const payload = dragPayload;
      dragPayload = null;
      mark(null);
      dropTo(target, payload);
    });
  }
  function mark(el) {
    $("#mixSlots")?.querySelectorAll(".is-target").forEach((s) => s.classList.remove("is-target"));
    if (el) el.classList.add("is-target");
    $("#mixTray")?.classList.toggle("is-dropping", !!dragPayload);
  }
  function bindItemGestures(el) {
    const id = el.dataset.id;
    el.addEventListener("dragstart", (e) => {
      if (e.target.closest?.("button")) { e.preventDefault(); return; }
      dragPayload = { kind: "item", id };
      e.dataTransfer?.setData("text/plain", id);
      e.dataTransfer && (e.dataTransfer.effectAllowed = "move");
      el.classList.add("is-dragging");
      mark(null);
    });
    el.addEventListener("dragend", () => { el.classList.remove("is-dragging"); dragPayload = null; mark(null); });
    touchGesture(el, {
      swipe: (dx) => {
        const at = slotOf(id);
        if (dx > 0 && at < 0) take(id);
        else if (dx < 0 && at >= 0) removeAt(at);
      },
      drop: (slotEl) => dropTo(slotEl, { kind: "item", id }),
      label: () => st.items.get(id)?.title || "",
    });
  }
  function bindSlotGestures(b) {
    const i = Number(b.dataset.slot);
    if (!st.slots[i]) return;
    b.addEventListener("dragstart", () => { dragPayload = { kind: "slot", index: i }; b.dataset.dragged = "1"; mark(null); });
    b.addEventListener("dragend", () => { dragPayload = null; mark(null); setTimeout(() => delete b.dataset.dragged, 0); });
    touchGesture(b, {
      drop: (slotEl) => { b.dataset.dragged = "1"; if (slotEl) swap(i, Number(slotEl.dataset.slot)); },
      label: () => st.slots[i]?.title || "",
    });
  }
  function touchGesture(el, h) {
    let sx = 0, sy = 0, mode = null, timer = null, ghost = null, lastSlot = null;
    const reset = () => {
      clearTimeout(timer);
      timer = null;
      el.style.transform = "";
      el.classList.remove("is-swiping", "is-dragging");
      ghost?.remove();
      ghost = null;
      mode = null;
      dragPayload = null;
      mark(null);
    };
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || e.target.closest?.("button:not([data-slot])") && el.classList.contains("mix-item")) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; mode = "wait";
      timer = setTimeout(() => {
        if (mode !== "wait") return;
        mode = "drag";
        dragPayload = { kind: "touch" };
        el.classList.add("is-dragging");
        ghost = document.createElement("div");
        ghost.className = "mix-ghost";
        ghost.textContent = h.label();
        document.body.appendChild(ghost);
        ghost.style.transform = `translate(${sx}px, ${sy}px)`;
        navigator.vibrate?.(15);
        mark(null);
      }, 320);
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!mode) return;
      const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (mode === "wait") {
        if (h.swipe && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.6) { mode = "swipe"; clearTimeout(timer); el.classList.add("is-swiping"); }
        else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { clearTimeout(timer); mode = null; return; }
        else return;
      }
      if (e.cancelable) e.preventDefault();
      if (mode === "swipe") el.style.transform = `translateX(${Math.max(-120, Math.min(120, dx))}px)`;
      if (mode === "drag" && ghost) {
        ghost.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        lastSlot = slotAt(t.clientX, t.clientY);
        mark(lastSlot);
      }
    }, { passive: false });
    el.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0], dx = t ? t.clientX - sx : 0;
      const was = mode, target = lastSlot;
      reset();
      lastSlot = null;
      if (was === "swipe" && Math.abs(dx) > 70) h.swipe(dx);
      if (was === "drag") { e.preventDefault?.(); h.drop(target); }
    });
    el.addEventListener("touchcancel", reset);
    el.addEventListener("contextmenu", (e) => { if (mode === "drag" || mode === "wait") e.preventDefault(); });
  }

  /* ───── 混ぜる（実験のように。11/18 オーナー「ナレッジラボの絵のようなワクワクする演出に」） ─────
     ① 選んだ知識が1つずつフラスコへ落ちる（落ちるたびに液が増える）
     ② かき混ぜる。混ぜている時間で液の色が変わっていく（オレンジ → 赤 → 紫 → 青 → 緑 …）
     ③ できあがり：いい発見ほど、フラスコが強く光る（★1〜3）。栓がポンと抜けて、新しい発見
        見つからなかったとき：フラスコがガタガタ揺れて「ボン！」と爆発。「見つからなかったよ」 */
  let labTimer = null, labStart = 0, labHue = 30;
  const EXPLODE = new Set(["AI_OUTPUT_BLOCKED_OR_TRUNCATED", "AI_INVALID_OUTPUT", "AI_INCOMPLETE_OUTPUT", "AI_MISSING_CITATION",
    "AI_INVALID_CITATION", "AI_MISSING_SOURCE_SUMMARY", "AI_SOURCE_EVIDENCE_MISSING", "NOTHING_FOUND"]);
  async function go() {
    if (st.busy) return;
    if (!core().me()) { core().showLogin(); throw new Error("AUTH_REQUIRED"); }
    const picked = [main(), ...others()];
    st.busy = true;
    syncTray();
    stage(picked);
    core().measure?.("knowledge_lab_mix", { stage: "start", count: picked.length });
    try {
      const run = await mixRequest();
      // 全部の知識がフラスコに入って、少し混ぜるところまでは見せる
      const wait = reduced() ? 0 : Math.max(0, 1200 + picked.length * 450 - (Date.now() - labStart));
      await new Promise((r) => setTimeout(r, wait));
      st.run = run;
      st.note = null;
      if (run.quota) st.quota = { ...(st.quota || {}), ...run.quota, available: true };
      if (!quality(run)) throw new Error("NOTHING_FOUND");
      await finish(run);
      core().measure?.("knowledge_lab_mix", { stage: "success", count: picked.length, cached: !!run.cacheHit });
    } catch (e) {
      const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(e?.message || "") ? e.message : "SERVICE_UNAVAILABLE";
      if (EXPLODE.has(code)) await explode();
      else stageError(message(e));
      core().measure?.("knowledge_lab_mix", { stage: EXPLODE.has(code) ? "nothing" : "error" });
      quota().catch(() => {});
    } finally {
      clearInterval(labTimer);
      st.busy = false;
      syncTray();
    }
  }
  async function mixRequest() {
    const body = { mainId: main().id, otherIds: others().map((o) => o.id), externalAIConsent: true };
    return core().api("/ai/mix", { method: "POST", auth: true, body: { ...body, key: core().keyFor("mix", body) } });
  }
  /* 発見の多さ（0 なら「見つからなかった」） */
  function quality(run) {
    const a = run?.analysis || {};
    return ["hypotheses", "connections", "applications", "questions"].reduce((n, k) => n + ((a[k] || []).length), 0);
  }
  const SAYS = ["フラスコに入れています…", "ぐるぐる混ぜています…", "色が変わってきた…！", "化学反応中…", "ひらめきが生まれそう…", "もうすぐ…！"];
  function stage(picked) {
    const el = $("#mixStage");
    const n = picked.length;
    labStart = Date.now();
    labHue = 30;
    el.className = "mix-stage lab mixing" + (reduced() ? " still" : "");
    el.innerHTML = `<div class="lx-sky" aria-hidden="true"><i class="lx-cloud c1"></i><i class="lx-cloud c2"></i><i class="lx-cloud c3"></i><i class="lx-rainbow"></i><i class="lx-star s1">✦</i><i class="lx-star s2">✦</i></div>
      <div class="lx-scene" aria-hidden="true">
        ${picked.map((x, i) => `<span class="lx-drop${i === 0 ? " main" : ""}" style="--i:${i};--x:${Math.round((i - (n - 1) / 2) * 70)}px">${esc(x.title)}</span>`).join("")}
        <div class="lx-flask" style="--hue:${labHue};--level:0">
          <span class="lx-cork"></span><span class="lx-neck"></span>
          <span class="lx-body"><span class="lx-liquid">${Array.from({ length: 7 }, (_, k) => `<i style="--k:${k}"></i>`).join("")}</span><span class="lx-shine"></span></span>
        </div>
        <span class="lx-table"></span>
      </div>
      <p class="lx-timer">混ぜ時間 <b>0.0</b> 秒</p>
      <p class="mx-say" role="status">${SAYS[0]}</p>`;
    el.hidden = false;
    const flask = $(".lx-flask", el);
    // 知識が1つ落ちるたびに液が増える
    picked.forEach((_, k) => setTimeout(() => flask?.style.setProperty("--level", String(Math.min(0.85, 0.25 + (k + 1) * (0.6 / n)))), reduced() ? 0 : 500 + k * 450));
    clearInterval(labTimer);
    labTimer = setInterval(() => {
      const sec = (Date.now() - labStart) / 1000;
      labHue = (30 + sec * 22) % 360; // 混ぜた時間で色が変わる
      flask?.style.setProperty("--hue", labHue.toFixed(0));
      const t = $(".lx-timer b", el);
      if (t) t.textContent = sec.toFixed(1);
      const say = $(".mx-say", el);
      if (say) say.textContent = SAYS[Math.min(SAYS.length - 1, Math.floor(sec / 2.2))];
      if (!reduced() && Math.floor(sec * 10) % 30 === 0 && sec > 2) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
    }, 100);
  }
  /* できあがり。いい発見ほど強く光る（★1〜3） */
  function finish(run) {
    clearInterval(labTimer);
    const el = $("#mixStage");
    const q = quality(run);
    const stars = q >= 9 ? 3 : q >= 5 ? 2 : 1;
    const sec = ((Date.now() - labStart) / 1000).toFixed(1);
    el.classList.remove("mixing");
    el.classList.add("glow-" + stars);
    $(".mx-say", el).textContent = stars === 3 ? "すごい！ 光ってる…！" : stars === 2 ? "いい感じに光ってきた！" : "できた！";
    return new Promise((resolve) => setTimeout(() => {
      el.classList.add("pop");
      setTimeout(() => {
        try { burst(run, stars, sec); } catch (e) { stageError(message(e)); }
        resolve();
      }, reduced() ? 0 : 700);
    }, reduced() ? 0 : 1100));
  }
  /* 見つからなかったときは、爆発 */
  function explode() {
    clearInterval(labTimer);
    const el = $("#mixStage");
    el.classList.remove("mixing");
    el.classList.add("boom-wait");
    $(".mx-say", el).textContent = "あれ…？ ゆれてる…！";
    return new Promise((resolve) => setTimeout(() => {
      el.className = "mix-stage lab boom done";
      el.insertAdjacentHTML("beforeend", `<div class="lx-boom" aria-hidden="true"><b>ボン！</b>${Array.from({ length: 9 }, (_, k) => `<i style="--k:${k}"></i>`).join("")}</div>
        <div class="mix-result error"><p class="lx-boom-icon" aria-hidden="true">💥</p><h2>爆発！ 今回は見つからなかったよ</h2><p>この組み合わせからは、新しい発見が出てこなかった。知識を入れ替えたり、メインを変えたりして、もう一度実験してみてね。</p><div class="mix-result-actions"><button type="button" data-close-stage class="primary">枠にもどって入れ替える</button></div></div>`);
      el.querySelector("[data-close-stage]").onclick = closeStage;
      resolve();
    }, reduced() ? 0 : 1300));
  }
  function stageError(text) {
    clearInterval(labTimer);
    const el = $("#mixStage");
    el.className = "mix-stage lab done";
    el.innerHTML = `<div class="mix-result error"><h2>うまく混ざりませんでした</h2><p>${esc(text)}</p><div class="mix-result-actions"><button type="button" data-close-stage>枠にもどる</button></div></div>`;
    el.querySelector("[data-close-stage]").onclick = closeStage;
  }
  function closeStage() {
    clearInterval(labTimer);
    $("#mixStage").hidden = true;
    $("#mixStage").className = "mix-stage";
    $("#mixStage").innerHTML = "";
  }
  function titleOf(id) {
    const s = st.run?.sources?.find((x) => x.id === id);
    return s ? s.title : (st.items.get(id)?.title || "元の知識");
  }
  function claims(key, max = 4) {
    return (st.run?.analysis?.[key] || []).slice(0, max);
  }
  function claimHtml(c) {
    const from = [...new Set((c.citations || []).map((q) => q.sourceId))];
    return `<li><p>${esc(c.text)}</p>${from.length ? `<small>元：${from.map((id) => "「" + esc(titleOf(id)) + "」").join("・")}</small>` : ""}</li>`;
  }
  function findText() {
    return (claims("hypotheses", 1)[0] || claims("connections", 1)[0] || { text: "" }).text;
  }
  function burst(run, stars, sec) {
    const el = $("#mixStage");
    const count = 10 + stars * 8;
    const sparks = reduced() ? "" : Array.from({ length: count }, (_, i) => `<i style="--a:${(360 / count) * i}deg;--d:${90 + (i % 5) * 34}px"></i>`).join("");
    const label = stars === 3 ? "すごい発見！" : stars === 2 ? "いい発見！" : "新しい発見";
    el.className = "mix-stage lab burst done glow-" + stars;
    el.style.setProperty("--hue", labHue.toFixed(0));
    el.innerHTML = `<div class="mx-rays" aria-hidden="true"></div><div class="mix-pop" aria-hidden="true">${sparks}</div>
      <div class="mix-result shine-${stars}" style="--hue:${labHue.toFixed(0)}">
        <p class="mix-badge"><span class="mix-stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</span> NEW DISCOVERY</p>
        <h2>${label}</h2>
        <p class="mix-find">${esc(findText())}</p>
        <p class="mix-brew"><span class="mix-swatch" aria-hidden="true"></span>混ぜ時間 ${esc(sec)} 秒・${(run.sources || []).length} つの知識</p>
        ${section("掛け合わせて見えたこと", "connections")}
        ${section("こんなふうに使える", "applications")}
        ${section("新しい問い", "questions")}
        ${section("気をつけること", "cautions", 3)}
        <p class="mix-sources">混ぜた知識：${(run.sources || []).map((s) => `<span class="${s.id === run.mainId ? "main" : ""}">${s.id === run.mainId ? "メイン " : ""}${esc(s.title)}</span>`).join("")}</p>
        <div class="mix-result-actions" id="mixActions">
          <button type="button" data-act="private">自分だけに保存</button>
          <button type="button" data-act="public" class="primary">公開する</button>
          <button type="button" data-act="guild">ギルドの議題にする</button>
          <button type="button" data-act="quest">クエストに参加する</button>
          <button type="button" data-act="again" class="quiet">枠にもどる</button>
          <p class="mix-act-msg" id="mixActMsg" role="status"></p>
        </div>
      </div>`;
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => core().run(() => act(b.dataset.act, b))));
  }
  function section(label, key, max) {
    const list = claims(key, max);
    return list.length ? `<h3>${esc(label)}</h3><ul>${list.map(claimHtml).join("")}</ul>` : "";
  }

  /* ───── 結果の行き先 ───── */
  async function save(visibility) {
    const run = st.run;
    const text = (k) => (run.analysis?.[k] || []).map((c) => c.text).join("\n");
    const rest = run.sources.filter((s) => s.id !== run.mainId);
    const top = run.sources.find((s) => s.id === run.mainId) || run.sources[0];
    const payload = {
      ...(st.note ? { id: st.note.id, revision: st.note.revision } : {}),
      mode: "mix",
      title: ("「" + top.title + "」×" + rest.map((s) => "「" + s.title + "」").join("×")).slice(0, 160),
      aiRunId: run.id,
      sourceIds: run.sources.map((s) => s.id),
      fields: [],
      question: text("questions").slice(0, 2000),
      hypothesis: text("hypotheses").slice(0, 3000),
      plan: [text("applications"), text("practice"), text("verification"), text("cautions")].filter(Boolean).join("\n\n").slice(0, 3000),
      result: "",
      visibility,
    };
    const result = await core().api("/notes", { method: "PUT", auth: true, body: { ...payload, key: core().keyFor("mix-note", payload) } });
    st.note = { ...payload, ...result };
    core().measure?.("knowledge_lab_mix", { stage: "save", visibility });
    return st.note;
  }
  /* 公開したら、発見のカードが「みんなの新しい発見」へ飛んでいく */
  function publishFx() {
    const run = st.run;
    const item = {
      id: st.note.id,
      title: st.note.title,
      find: findText(),
      sources: (run.sources || []).map((s) => ({ title: s.title, main: s.id === run.mainId })),
      createdAtMs: Date.now(),
    };
    st.feed = [item, ...(st.feed || []).filter((d) => d.id !== item.id)];
    renderFeed(item.id);
    const el = $("#mixStage");
    if (reduced()) return;
    const confetti = Array.from({ length: 36 }, (_, i) => `<i style="--x:${(i * 37) % 100}vw;--r:${(i * 53) % 360}deg;--t:${0.9 + (i % 5) * 0.18}s;--c:${["#ef7d00", "#6b4fd8", "#2f7dd1", "#f2c94c", "#e8547a"][i % 5]}"></i>`).join("");
    el.insertAdjacentHTML("beforeend", `<div class="mx-confetti" aria-hidden="true">${confetti}</div><div class="mx-posted" aria-hidden="true"><span>📮</span><b>みんなの新しい発見に載りました！</b></div>`);
    el.querySelector(".mix-result")?.classList.add("posting");
    setTimeout(() => { el.querySelector(".mix-result")?.classList.remove("posting"); el.querySelector(".mx-confetti")?.remove(); el.querySelector(".mx-posted")?.remove(); }, 2200);
  }
  async function act(what, button) {
    const msg = $("#mixActMsg");
    const say = (t, error) => { msg.textContent = t; msg.classList.toggle("error", !!error); };
    if (what === "again") return closeStage();
    button.disabled = true;
    try {
      if (what === "private") {
        await save("private");
        say("自分だけに保存しました。プロフィールの「Knowledge Lab の記録」から、いつでも見られます。");
      } else if (what === "public") {
        await save("public");
        publishFx();
        say("公開しました！ Knowledge Lab の「みんなの新しい発見」に載りました。");
      } else if (what === "guild") {
        openGuildSheet();
      } else if (what === "quest") {
        // 結果を失わないように、まだ保存していなければ自分だけに保存してから移る
        if (!st.note) await save("private");
        core().measure?.("knowledge_lab_mix", { stage: "quest" });
        say("この発見は「Knowledge Lab の記録」に保存しました。クエストの一覧を開きます。");
        core().integration("quests");
      }
    } catch (e) {
      say(message(e), true);
    } finally {
      button.disabled = false;
    }
  }

  /* ───── ギルドの議題（Lab の中で出す。ほかの画面へ移らない） ───── */
  function guessGuild() {
    const run = st.run || {};
    const text = [findText(), ...claims("connections").map((c) => c.text), ...claims("applications").map((c) => c.text), ...(run.sources || []).map((s) => s.title)].join(" ");
    const fields = (run.sources || []).flatMap((s) => st.items.get(s.id)?.facets?.field || (st.items.get(s.id)?.fieldId ? [st.items.get(s.id).fieldId] : []));
    let best = GUILDS[0], score = -1;
    for (const g of GUILDS) {
      let n = 0;
      g.words.forEach((w) => { if (text.includes(w)) n += 2; });
      [...new Set(fields)].forEach((f) => { if (g.fields.includes(f)) n += 1; }); // 分野は手がかりの1つ。中身の言葉を重く見る
      if (n > score) { best = g; score = n; }
    }
    return score > 0 ? best : GUILDS[0];
  }
  let guildPick = null;
  function openGuildSheet() {
    guildPick = guessGuild();
    const el = $("#mixStage");
    el.querySelector(".mix-guild")?.remove();
    const top = (st.run.sources || []).find((s) => s.id === st.run.mainId) || {};
    el.insertAdjacentHTML("beforeend", `<div class="mix-guild" role="dialog" aria-modal="true" aria-labelledby="mixGuildTitle">
      <div class="mix-guild-card">
        <h2 id="mixGuildTitle">ギルドの議題にする</h2>
        <p class="mix-guild-pick">おすすめのギルド：<b id="mixGuildName"></b></p>
        <div class="mix-guild-chips">${GUILDS.map((g) => `<button type="button" data-guild="${g.id}" aria-pressed="false">${g.short}</button>`).join("")}</div>
        <label for="mixGuildTitleIn">議題</label>
        <input id="mixGuildTitleIn" maxlength="120" value="${esc(("この発見を試す：" + findText()).slice(0, 120))}">
        <label for="mixGuildBody">説明</label>
        <textarea id="mixGuildBody" maxlength="600">${esc(("Knowledge Lab で「" + (top.title || "") + "」をメインに掛け合わせて出た発見です。\n" + findText()).slice(0, 600))}</textarea>
        <label>選択肢</label>
        <input id="mixGuildOpt1" maxlength="60" value="クエストにして試す">
        <input id="mixGuildOpt2" maxlength="60" value="いまはやらない">
        <p class="mix-act-msg" id="mixGuildMsg" role="status"></p>
        <div class="mix-guild-actions"><button type="button" class="primary" id="mixGuildGo">議題を出す</button><button type="button" id="mixGuildCancel">やめる（発見にもどる）</button></div>
      </div></div>`);
    const sync = () => {
      $("#mixGuildName").textContent = guildPick.short + "（" + guildPick.concept + "）";
      el.querySelectorAll("[data-guild]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.guild === guildPick.id)));
    };
    sync();
    el.querySelectorAll("[data-guild]").forEach((b) => (b.onclick = () => { guildPick = GUILDS.find((g) => g.id === b.dataset.guild) || guildPick; sync(); }));
    $("#mixGuildCancel").onclick = () => el.querySelector(".mix-guild")?.remove();
    $("#mixGuildGo").onclick = () => core().run(submitGuild);
  }
  async function submitGuild() {
    const go = $("#mixGuildGo"), msg = $("#mixGuildMsg");
    const say = (t, error) => { msg.textContent = t; msg.classList.toggle("error", !!error); };
    go.disabled = true;
    try {
      if (!st.note || st.note.visibility !== "public") {
        say("発見を公開しています…");
        await save("public");
        publishFx();
      }
      const host = (() => { try { return parent !== window && typeof parent.emuSubmitGuildProposal === "function" ? parent : null; } catch (_) { return null; } })();
      if (!host) { core().integration("guild-proposal", { noteId: st.note.id }); return; }
      const top = (st.run.sources || []).find((s) => s.id === st.run.mainId);
      const link = new URL("/knowledge-lab.html?note=" + st.note.id, location.origin).href;
      const r = await host.emuSubmitGuildProposal({
        guildId: guildPick.id,
        title: $("#mixGuildTitleIn").value,
        body: ($("#mixGuildBody").value.trim() + "\n" + link).slice(0, 600),
        options: [$("#mixGuildOpt1").value, $("#mixGuildOpt2").value],
        days: 7,
        fromPostId: top && !/^kt_/.test(top.id) ? top.id : "",
        fromPostTitle: top ? top.title : "",
      });
      if (!r || !r.ok) return say((r && r.reason) || "議題を出せませんでした。もう一度お試しください。", true);
      core().measure?.("knowledge_lab_mix", { stage: "guild" });
      const card = $("#mixStage .mix-guild-card");
      card.innerHTML = `<div class="mix-guild-done"><span aria-hidden="true">🎉</span><h2>${esc(guildPick.short)} Guild に議題を出しました！</h2><p>みんなの投票が始まります。</p>
        <div class="mix-guild-actions"><button type="button" class="primary" id="mixGuildView">ギルドで見る</button><button type="button" id="mixGuildBack">発見にもどる</button></div></div>`;
      $("#mixGuildView").onclick = () => core().integration("guild-view", { guildId: r.guildId });
      $("#mixGuildBack").onclick = () => $("#mixStage .mix-guild")?.remove();
    } catch (e) {
      say(message(e), true);
    } finally {
      if (document.body.contains(go)) go.disabled = false;
    }
  }

  window.EmuLabMix = {
    async enter() {
      if (!core()) return;
      build();
      renderFields();
      loadCounts();
      loadFeed();
      syncTray();
      if (st.mode) await quota().catch(() => {});
    },
    /* テストと冷蔵庫くんのガイド用 */
    state: () => ({ main: main()?.id || null, others: others().map((o) => o.id), slots: st.slots.map((x) => x?.id || null), mode: st.mode, quota: st.quota }),
    setMode,
    guessGuild: () => guessGuild().id,
  };
})();
