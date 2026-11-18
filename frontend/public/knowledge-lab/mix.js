/* Knowledge Lab の掛け合わせ（11/18 オーナー）

   1. Knowledge Text と同じように、まず分野のカードを並べる（分野は Knowledge Lab の分類の「分野」）
   2. 分野を押すと、その分野の知識が出る。上の切り替えで Knowledge Text の教材も選べる
   3. 「掛け合わせる」をオンにすると、知識に「枠に入れる」が出る。最初の1つがメイン、あとから最大4つ
   4. 「混ぜる」で AI が掛け合わせる（1人1日3回。同じ組み合わせの2回目は数えない）。混ぜる → はじける → 新しい発見
   5. 出てきた発見は「自分だけに保存」「公開」「ギルドの議題にする」「クエストに参加する」へ

   AI に送れるのは、公開されていて書き手が AI の利用に同意した知識と、Knowledge Text の教材だけ（サーバーでも確かめる）。
   書いた文やえらんだ知識の中身は、計測（PostHog）へ送らない。送るのは件数と段階だけ。 */
(() => {
  "use strict";
  const core = () => window.EmuLabCore;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const MAX_OTHERS = 4;

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
  const MESSAGES = {
    AI_DISABLED: "AIの掛け合わせは、いま準備中です。少し待ってから試してね。",
    AI_STOPPED: "AIの掛け合わせは、いま準備中です。少し待ってから試してね。",
    AI_DAILY_LIMIT: "今日の掛け合わせは使い切ったよ（1日3回まで）。明日また混ぜられるよ。",
    AI_BUSY: "いま、ほかの人が混ぜているところ。少し待ってからもう一度押してね。",
    AI_SOURCE_CONSENT_REQUIRED: "書き手がAIの利用に同意していない知識が入っています。外してから混ぜてね。",
    AI_SENSITIVE_SOURCE: "メールアドレスや電話番号などが入っている知識は、AIに送れません。外してから混ぜてね。",
    AI_REQUEST_CONSENT_REQUIRED: "「外部のAIに送ることに同意」にチェックを入れてね。",
    AI_SOURCE_COUNT: "メイン1つと、掛け合わせる知識を1つ以上入れてね。",
    AI_SOURCES_CHANGED: "混ぜているあいだに、元の知識が書き換えられました。もう一度混ぜてね。",
    AI_INPUT_LIMIT: "知識が長すぎて送れませんでした。数を減らしてね。",
    AI_PROVIDER_UNAVAILABLE: "AIが混み合っています。少し待ってからもう一度押してね。",
    AI_FREE_QUOTA_EXHAUSTED: "今日のAIの枠がいっぱいです。明日また混ぜられるよ。",
    AUTH_REQUIRED: "混ぜるにはログインが必要です。",
    NOT_FOUND: "見つからない知識が入っています。外してから混ぜてね。",
    NOTE_LIMIT: "保存できる数がいっぱいです。マイライブラリーで整理してから保存してね。",
    PRIVATE_SOURCE: "公開されていない知識が入っているので、公開できません。自分だけに保存してね。",
  };
  const message = (e) => {
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(e?.message || "") ? e.message : "SERVICE_UNAVAILABLE";
    return (MESSAGES[code] || "うまくいきませんでした。少し待ってからもう一度試してね。") + "（" + code + "）";
  };

  const st = {
    built: false,
    source: "posts", // posts | texts
    field: null,
    textTheme: null,
    cursor: null,
    items: new Map(), // id → 表示した知識・教材
    main: null,
    others: [],
    mode: false,
    quota: null,
    run: null,
    note: null,
    texts: null,
    busy: false,
  };

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
      </div>
      <div id="mixTextHome" hidden>
        <p class="mix-title">どの教材を使う？</p>
        <div class="mix-grid" id="mixThemes"></div>
      </div>
      <div id="mixList" hidden>
        <button type="button" class="mix-back" id="mixBack">← もどる</button>
        <h2 id="mixListTitle"></h2>
        <div id="mixItems" class="mix-items"></div>
        <button type="button" id="mixMore" class="mix-more" hidden>もっと見る</button>
      </div>
      <aside id="mixTray" class="mix-tray" hidden data-tour="mix-tray" aria-label="掛け合わせる知識">
        <div class="mix-slots" id="mixSlots"></div>
        <label class="mix-consent"><input type="checkbox" id="mixConsent"> 選んだ知識を外部のAI（Google Gemini）に送ることに同意します</label>
        <div class="mix-go-row"><button type="button" id="mixGo" class="mix-go" disabled>混ぜる ⚗️</button><small id="mixQuota"></small></div>
      </aside>
      <div id="mixStage" class="mix-stage" hidden role="dialog" aria-modal="true" aria-label="掛け合わせ"></div>`;
    root().querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => setSource(b.dataset.src)));
    $("#mixMode").onchange = (e) => setMode(e.target.checked);
    $("#mixBack").onclick = () => (st.source === "posts" ? showHome() : showTextHome());
    $("#mixMore").onclick = () => core().run(() => loadField(true));
    $("#mixConsent").onchange = syncTray;
    $("#mixGo").onclick = () => core().run(go);
    renderFields();
  }

  /* ───── 分野・教材の一覧 ───── */
  /* 11/18 オーナー：分野ごとの知識の数を、カードの右上に出す。数えられなかったときは出さない（0件と見せない） */
  function countBadge(n) {
    return typeof n === "number" ? `<em class="mix-count" aria-label="${n}件の知識">${n}件</em>` : "";
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
  function renderFields() {
    const terms = (core().terms() || []).filter((t) => t.axis === "field" && t.active !== false && !t.mergedInto);
    $("#mixFields").innerHTML = terms.length
      ? terms.map((t) => `<button type="button" class="mix-card" data-field="${esc(t.id)}">${countBadge(st.counts?.[t.id])}<b>${esc(t.label)}</b><span>${esc(FIELD_NOTE[t.id] || "みんなの経験から")}</span></button>`).join("")
      : '<p class="mix-empty">分野を読み込めませんでした。少し待って、開き直してね。</p>';
    $("#mixFields").querySelectorAll("[data-field]").forEach((b) => (b.onclick = () => core().run(() => openField(b.dataset.field))));
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
  async function showTextHome() {
    $("#mixHome").hidden = true;
    $("#mixList").hidden = true;
    $("#mixTextHome").hidden = false;
    if (!st.texts) {
      $("#mixThemes").innerHTML = '<p class="mix-empty">教材を読み込んでいます…</p>';
      st.texts = await core().api("/texts");
    }
    const groups = {};
    st.texts.forEach((t) => (groups[t.theme] = (groups[t.theme] || 0) + 1));
    const keys = Object.keys(groups);
    $("#mixThemes").innerHTML = keys.length
      ? keys.map((k) => `<button type="button" class="mix-card" data-theme="${esc(k)}">${countBadge(groups[k])}<b>${esc(TEXT_THEMES[k] || k || "Knowledge Text")}</b><span>運営がまとめた学習教材</span></button>`).join("")
      : '<p class="mix-empty">まだ教材がありません。</p>';
    $("#mixThemes").querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => openTheme(b.dataset.theme)));
  }
  async function openField(id) {
    st.field = id;
    st.cursor = null;
    const term = (core().terms() || []).find((t) => t.id === id);
    $("#mixListTitle").textContent = term ? term.label : "知識";
    $("#mixItems").innerHTML = '<p class="mix-empty">読み込んでいます…</p>';
    showList();
    await loadField(false);
  }
  async function loadField(more) {
    const p = new URLSearchParams({ field: st.field, sort: "new", mode: "lexical" });
    if (more && st.cursor) p.set("cursor", st.cursor);
    const data = await core().api("/search?" + p, { optional: true });
    if (!more) $("#mixItems").innerHTML = "";
    data.items.forEach((x) => st.items.set(x.id, { ...x, kind: "post" }));
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
    list.forEach((t) => st.items.set(t.id, { ...t, kind: "text", body: t.excerpt, displayName: "Knowledge Text" }));
    $("#mixItems").innerHTML = list.map((t) => itemCard(st.items.get(t.id))).join("") || '<p class="mix-empty">このテーマの教材はまだありません。</p>';
    $("#mixMore").hidden = true;
    showList();
    bindItems();
  }
  function showList() {
    $("#mixHome").hidden = true;
    $("#mixTextHome").hidden = true;
    $("#mixList").hidden = false;
    $("#mixList").scrollIntoView?.({ block: "start" });
  }
  function usable(x) {
    return x.kind === "text" || x.knowledgeLab?.aiUseConsent?.allowed === true;
  }
  function placed(id) {
    return st.main?.id === id || st.others.some((o) => o.id === id);
  }
  function itemCard(x) {
    const label = x.kind === "text" ? [x.subTheme, x.subSubTheme].filter(Boolean).join("／") : x.displayName;
    let add = "";
    if (st.mode) {
      if (placed(x.id)) add = `<button type="button" class="mix-add on" data-take="${esc(x.id)}">✓ 枠に入っています</button>`;
      else if (!usable(x)) add = `<span class="mix-ng">書き手がAIの利用に同意していないので、混ぜられません</span>`;
      else add = `<button type="button" class="mix-add" data-take="${esc(x.id)}">＋ 枠に入れる</button>`;
    }
    return `<article class="mix-item${x.kind === "text" ? " is-text" : ""}" data-id="${esc(x.id)}">
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
    root().classList.toggle("mix-on", on);
    redrawItems();
    syncTray();
    if (on) core().measure?.("knowledge_lab_mix", { stage: "mode_on" });
    if (on && !core().me()) core().showLogin();
    if (on) quota().catch(() => {});
  }
  function take(id) {
    const x = st.items.get(id);
    if (!x) return;
    if (placed(id)) return drop(id);
    if (!usable(x)) return;
    if (!st.main) st.main = x;
    else if (st.others.length < MAX_OTHERS) st.others.push(x);
    else return core().status("枠がいっぱいです（メイン1つ＋4つまで）。枠を押すと外せます。", true);
    redrawItems();
    syncTray(true);
  }
  function drop(id) {
    if (st.main?.id === id) st.main = st.others.shift() || null;
    else st.others = st.others.filter((o) => o.id !== id);
    redrawItems();
    syncTray();
  }
  function slot(x, i) {
    const main = i === 0;
    if (!x) return `<div class="mix-slot${main ? " main" : ""} is-empty"><span>${main ? "メイン" : "掛け合わせ " + i}</span><small>${main ? "最初に入れた知識" : "空き"}</small></div>`;
    return `<button type="button" class="mix-slot${main ? " main" : ""}${x.kind === "text" ? " is-text" : ""}" data-drop="${esc(x.id)}" title="押すと外せます"><span>${main ? "メイン" : "掛け合わせ " + i}</span><b>${esc(x.title)}</b><small>外す ×</small></button>`;
  }
  function syncTray(pulse) {
    if (!st.built) return;
    const others = [0, 1, 2, 3].map((i) => st.others[i] || null);
    // 左に2つ、真ん中にメイン、右に2つ
    $("#mixSlots").innerHTML = slot(others[0], 1) + slot(others[1], 2) + slot(st.main, 0) + slot(others[2], 3) + slot(others[3], 4);
    $("#mixSlots").querySelectorAll("[data-drop]").forEach((b) => (b.onclick = () => drop(b.dataset.drop)));
    if (pulse && !reduced()) {
      $("#mixSlots").classList.remove("pulse");
      void $("#mixSlots").offsetWidth;
      $("#mixSlots").classList.add("pulse");
    }
    const ready = !!st.main && st.others.length > 0;
    const left = st.quota ? st.quota.remaining : null;
    $("#mixGo").disabled = st.busy || !ready || !$("#mixConsent").checked || left === 0 || st.quota?.available === false;
    $("#mixQuota").textContent =
      st.quota?.available === false ? "AIの掛け合わせは準備中です"
        : left === null ? "1日3回まで"
        : left === 0 ? "今日はもう混ぜられません（1日3回まで）"
        : "今日あと " + left + " 回";
  }
  async function quota() {
    if (!core().me()) return;
    st.quota = await core().api("/ai/mix/quota", { auth: true });
    syncTray();
  }

  /* ───── 混ぜる → はじける → 新しい発見 ───── */
  async function go() {
    if (st.busy) return;
    if (!core().me()) { core().showLogin(); throw new Error("AUTH_REQUIRED"); }
    const picked = [st.main, ...st.others];
    st.busy = true;
    syncTray();
    stage(picked);
    core().measure?.("knowledge_lab_mix", { stage: "start", count: picked.length });
    try {
      const startedAt = Date.now();
      const run = await mixRequest();
      // 混ぜる演出を少なくとも少しは見せる（すぐ返ってきたときに一瞬で終わらないように）
      const wait = reduced() ? 0 : Math.max(0, 1600 - (Date.now() - startedAt));
      await new Promise((r) => setTimeout(r, wait));
      st.run = run;
      st.note = null;
      if (run.quota) st.quota = { ...(st.quota || {}), ...run.quota, available: true };
      burst(run);
      core().measure?.("knowledge_lab_mix", { stage: "success", count: picked.length, cached: !!run.cacheHit });
    } catch (e) {
      stageError(message(e));
      core().measure?.("knowledge_lab_mix", { stage: "error" });
      quota().catch(() => {});
    } finally {
      st.busy = false;
      syncTray();
    }
  }
  async function mixRequest() {
    const body = {
      mainId: st.main.id,
      otherIds: st.others.map((o) => o.id),
      externalAIConsent: $("#mixConsent").checked,
    };
    return core().api("/ai/mix", { method: "POST", auth: true, body: { ...body, key: core().keyFor("mix", body) } });
  }
  function stage(picked) {
    const el = $("#mixStage");
    const n = picked.length;
    el.innerHTML = `<div class="mix-pot${reduced() ? " still" : ""}">
        ${picked.map((x, i) => `<span class="mix-orb${i === 0 ? " main" : ""}" style="--a:${Math.round((360 / n) * i)}deg">${esc(x.title)}</span>`).join("")}
        <span class="mix-core" aria-hidden="true"></span>
      </div>
      <p class="mix-stage-msg" role="status">混ぜています… <small>AIが ${n} つの知識を掛け合わせているよ（数十秒かかることがあります）</small></p>`;
    el.hidden = false;
    el.classList.remove("done", "burst");
  }
  function stageError(text) {
    const el = $("#mixStage");
    el.classList.add("done");
    el.innerHTML = `<div class="mix-result error"><h2>うまく混ざりませんでした</h2><p>${esc(text)}</p><div class="mix-result-actions"><button type="button" data-close-stage>枠にもどる</button></div></div>`;
    el.querySelector("[data-close-stage]").onclick = closeStage;
  }
  function closeStage() {
    $("#mixStage").hidden = true;
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
  function burst(run) {
    const el = $("#mixStage");
    const find = (claims("hypotheses", 1)[0] || claims("connections", 1)[0] || { text: "" });
    const sparks = reduced() ? "" : Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 26}deg;--d:${80 + (i % 4) * 26}px"></i>`).join("");
    el.classList.add("burst");
    el.innerHTML = `<div class="mix-pop" aria-hidden="true">${sparks}</div>
      <div class="mix-result">
        <p class="mix-badge">NEW DISCOVERY ✨</p>
        <h2>新しい発見</h2>
        <p class="mix-find">${esc(find.text)}</p>
        <p class="mix-note">AIが出した仮説です。まだ確かめていません。自分で試して確かめてね。</p>
        ${section("掛け合わせて見えたこと", "connections")}
        ${section("こんなふうに使える", "applications")}
        ${section("新しい問い", "questions")}
        ${section("気をつけること", "cautions", 3)}
        <p class="mix-sources">混ぜた知識：${(run.sources || []).map((s, i) => `<span class="${s.id === run.mainId ? "main" : ""}">${s.id === run.mainId ? "メイン " : ""}${esc(s.title)}</span>`).join("")}</p>
        <div class="mix-result-actions" id="mixActions">
          <button type="button" data-act="private">自分だけに保存</button>
          <button type="button" data-act="public" class="primary">公開する</button>
          <button type="button" data-act="guild">ギルドの議題にする</button>
          <button type="button" data-act="quest">クエストに参加する</button>
          <button type="button" data-act="again" class="quiet">枠にもどる</button>
          <p class="mix-act-msg" id="mixActMsg" role="status"></p>
        </div>
      </div>`;
    if (!reduced()) setTimeout(() => el.classList.add("done"), 700);
    else el.classList.add("done");
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
    const others = run.sources.filter((s) => s.id !== run.mainId);
    const main = run.sources.find((s) => s.id === run.mainId) || run.sources[0];
    const payload = {
      ...(st.note ? { id: st.note.id, revision: st.note.revision } : {}),
      mode: "mix",
      title: ("「" + main.title + "」×" + others.map((s) => "「" + s.title + "」").join("×")).slice(0, 160),
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
  async function act(what, button) {
    const msg = $("#mixActMsg");
    const say = (t, error) => { msg.textContent = t; msg.classList.toggle("error", !!error); };
    if (what === "again") return closeStage();
    if (what === "quest") {
      core().measure?.("knowledge_lab_mix", { stage: "quest" });
      core().integration("quests");
      return;
    }
    button.disabled = true;
    try {
      if (what === "private") {
        await save("private");
        say("自分だけに保存しました。プロフィールの「Knowledge Lab の記録」から、いつでも見られます。");
      } else if (what === "public") {
        await save("public");
        say("公開しました。みんなも、この発見を見られます。");
      } else if (what === "guild") {
        if (!st.note || st.note.visibility !== "public") {
          if (!window.confirm("ギルドの議題にするには、この発見を公開します。よいですか？")) return;
          await save("public");
        }
        core().measure?.("knowledge_lab_mix", { stage: "guild" });
        core().integration("guild-proposal", { noteId: st.note.id });
        say("ギルドの議題の画面を開きます。");
      }
    } catch (e) {
      say(message(e), true);
    } finally {
      button.disabled = false;
    }
  }

  window.EmuLabMix = {
    async enter() {
      if (!core()) return;
      build();
      renderFields();
      loadCounts();
      syncTray();
      if (st.mode) await quota().catch(() => {});
    },
    /* テストと冷蔵庫くんのガイド用 */
    state: () => ({ main: st.main?.id || null, others: st.others.map((o) => o.id), mode: st.mode, quota: st.quota }),
    setMode,
  };
})();
