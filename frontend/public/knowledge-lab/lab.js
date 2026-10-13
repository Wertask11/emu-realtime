/* Same-origin iframe integration. All private data passes the verified server API. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const axes = {
    field: "分野",
    job: "業種・職業",
    experience: "経験",
    purpose: "目的",
    kind: "知識の種類",
    genre: "ジャンル",
  };
  const state = {
    enabled: false,
    terms: [],
    me: null,
    view: "library",
    results: [],
    selected: new Map(),
    fields: [],
    post: null,
    note: null,
    writerRevision: 0,
    termRevision: 0,
    keys: new Map(),
    adminRows: new Map(),
    cursors: {},
    mineKind: "saved",
    adminKind: "writers",
    loadedViews: {},
  };
  const messages = {
    READER_PLAN_REQUIRED:
      "見学では新着20件を読めます。続きの知識は既存のEmu light以上で利用できます。",
    LAUNCH_HOLD: "公開準備中です。保存・投稿はまだ利用できません。",
    RULES_NOT_VERIFIED: "データ保護の確認中です。保存・投稿は停止しています。",
    AUTH_REQUIRED: "ログインしてから続けてください。",
    INVALID_AUTH_TOKEN: "ログインの状態を確認できません。入り直してください。",
    PASSPORT_REQUIRED:
      "Passport IDの連携が必要です。Emuへログインし、Passportを開いてから続けてください。",
    INDEX_NOT_READY: "検索の準備中です。運営が索引を作成すると利用できます。",
    SEARCH_CHANGED:
      "知識が更新されました。最初のページから検索し直してください。",
    PLAN_LIMIT_REACHED:
      "現在のプランの利用枠に達しています。既存の会員ページで条件を確認してください。",
    LIBRARY_FULL: "マイライブラリーの保存枠に達しています。",
    REVISION_CONFLICT:
      "別の画面で更新されています。内容を控えて、最新のデータを開き直してください。",
    IDEMPOTENCY_CONFLICT:
      "前回の送信と内容が変わっています。最新データを確認してください。",
    PRIVATE_SOURCE:
      "公開できない元知識が含まれています。自分用として保存してください。",
    SOURCE_WITHDRAWN:
      "元知識が取り下げられたため、この研究は現在公開されていません。",
    NOT_FOUND: "見つからないか、公開されていません。",
    NOT_OWNER: "この内容を編集する権限がありません。",
    OWNER_ONLY: "運営専用の操作です。",
    RATE_LIMITED: "操作が続いています。少し待ってからお試しください。",
    SERVICE_UNAVAILABLE:
      "通信できませんでした。入力内容はこの画面に残っています。",
    MODERATED_POST: "運営の確認中です。公開・編集は停止しています。",
    SELECT_TWO_TO_SIX_SOURCES: "元の知識を2〜6件選んでください。",
    SELECT_TWO_OR_THREE_FIELDS: "分野を2〜3つ選んでください。",
    SEARCH_CAPACITY_REACHED:
      "検索索引の上限に達しました。運営へお知らせください。",
  };
  function status(message, error = false) {
    $("#status").textContent = message;
    $("#status").classList.toggle("error", error);
  }
  function keyFor(scope, payload) {
    const sig = JSON.stringify(payload),
      old = state.keys.get(scope);
    if (old?.sig === sig) return old.key;
    const key = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
    state.keys.set(scope, { sig, key });
    return key;
  }
  async function headers() {
    if (parent !== window) {
      try {
        if (typeof parent.emuAuthHeaders === "function")
          return await parent.emuAuthHeaders(true, { interactive: false });
      } catch (_) {}
    }
    throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
  }
  async function api(
    path,
    { method = "GET", body, auth = false, optional = false } = {},
  ) {
    if (!state.enabled && path !== "/config") throw new Error("LAUNCH_HOLD");
    let h = { "Content-Type": "application/json" };
    if (auth || optional) {
      try {
        h = await headers();
      } catch (e) {
        if (auth) {
          showLogin();
          throw e;
        }
      }
    }
    const r = await fetch("/api/knowledge-lab" + path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (path === "/config" && r.status === 404)
      return { enabled: false, reason: "LAUNCH_HOLD", aiAvailable: false };
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(data.error || "SERVICE_UNAVAILABLE"), {
        status: r.status,
      });
    return data;
  }
  $(".brand").addEventListener("click", (e) => {
    if (parent !== window) {
      e.preventDefault();
      integration("close");
    }
  });
  function showLogin() {
    const link = $("#loginLink");
    link.href = "/?lab=" + encodeURIComponent(state.view);
    $("#loginBox").hidden = false;
  }
  function integration(action, payload = {}) {
    if (parent !== window) {
      parent.postMessage(
        { type: "emu-lab-action", action, ...payload },
        location.origin,
      );
      return;
    }
    const url = new URL("/", location.origin);
    url.searchParams.set("lab", state.view);
    if (payload.postId) url.searchParams.set("labPost", payload.postId);
    if (payload.noteId) url.searchParams.set("labNote", payload.noteId);
    url.searchParams.set("labAction", action);
    location.href = url;
  }
  async function run(action) {
    try {
      await action();
    } catch (e) {
      status(
        messages[e.message] ||
          "操作を完了できませんでした。入力内容を確認して、もう一度お試しください。",
        true,
      );
      if (e.status === 401) showLogin();
    }
  }
  function bindAsync(button, action) {
    button.onclick = () =>
      run(async () => {
        button.disabled = true;
        try {
          await action();
        } finally {
          button.disabled = false;
        }
      });
  }
  function facetUI(target, value = {}, include = Object.keys(axes)) {
    $(target).innerHTML = include
      .map((axis) => {
        const terms = state.terms.filter(
          (t) =>
            t.axis === axis &&
            ((t.active && !t.mergedInto) || (value[axis] || []).includes(t.id)),
        );
        if (!terms.length) return "";
        return `<div><label for="${target.slice(1)}-${axis}">${axes[axis]}（複数可）</label><select multiple data-axis="${axis}" id="${target.slice(1)}-${axis}" size="3">${terms.map((t) => `<option value="${esc(t.id)}" ${(value[axis] || []).includes(t.id) ? "selected" : ""}>${esc(t.label)}${t.active ? "" : "（既存の分類）"}</option>`).join("")}</select></div>`;
      })
      .join("");
  }
  function facetValue(target) {
    const value = {};
    $(target)
      .querySelectorAll("[data-axis]")
      .forEach(
        (el) =>
          (value[el.dataset.axis] = [...el.selectedOptions].map(
            (o) => o.value,
          )),
      );
    return value;
  }
  function names(ids) {
    return (ids || [])
      .map((id) => state.terms.find((t) => t.id === id)?.label || id)
      .join("・");
  }
  function badges(p) {
    const f = p.knowledgeLab?.facets || p.facets || {};
    return (
      (f.field || [])
        .map((id) => `<span class="badge">${esc(names([id]))}</span>`)
        .join("") || '<span class="badge">分類未設定</span>'
    );
  }
  function date(v) {
    return v ? new Date(v).toLocaleDateString("ja-JP") : "記録なし";
  }
  function card(p, choose = false) {
    return `<article class="card"><div>${p.knowledgeLab?.featured ? '<span class="badge">運営の注目知識</span>' : ""}${badges(p)}</div><h3>${esc(p.title)}</h3><p>${esc(p.body).slice(0, 160)}${p.body?.length > 160 ? "…" : ""}</p><small>${esc(p.displayName)}・更新 ${date(p.updatedAt)}${p.knowledgeLab ? "・本人の経験（自己申告）" : ""}</small><div class="actions"><button type="button" data-post="${esc(p.id)}">知識を読む</button><button type="button" data-source="${esc(p.id)}">${state.selected.has(p.id) ? "研究に選択済み" : "研究に使う"}</button>${p.editable && p.visibility !== "archived" ? `<button type="button" data-edit="${esc(p.id)}">編集</button>` : ""}</div></article>`;
  }
  function bindCards(target, posts) {
    posts.forEach(
      (p) => state.results.find((r) => r.id === p.id) || state.results.push(p),
    );
    $(target)
      .querySelectorAll("[data-post]")
      .forEach((b) => bindAsync(b, () => detail(b.dataset.post)));
    $(target)
      .querySelectorAll("[data-edit]")
      .forEach((b) =>
        bindAsync(b, async () =>
          edit(await api("/posts/" + b.dataset.edit, { auth: true })),
        ),
      );
    $(target)
      .querySelectorAll("[data-source]")
      .forEach((b) =>
        bindAsync(b, async () => {
          const p = await api("/posts/" + b.dataset.source, { optional: true });
          if (state.selected.has(p.id)) {
            state.selected.delete(p.id);
            b.textContent = "研究に使う";
          } else {
            if (state.selected.size >= 6)
              throw new Error("SELECT_TWO_TO_SIX_SOURCES");
            state.selected.set(p.id, p);
            b.textContent = "研究に選択済み";
          }
          selected();
        }),
      );
  }
  function conditions() {
    const params = new URLSearchParams();
    if ($("#query").value.trim()) params.set("q", $("#query").value.trim());
    params.set("sort", $("#sort").value);
    for (const [axis, values] of Object.entries(facetValue("#searchFacets")))
      if (values.length) params.set(axis, values.join(","));
    return params;
  }
  function sharedURL() {
    const u = new URL("/knowledge-lab.html", location.origin);
    u.search = conditions().toString();
    return u;
  }
  async function search(more = false) {
    const p = conditions();
    if (more && state.cursors.search) p.set("cursor", state.cursors.search);
    const data = await api("/search?" + p, { optional: true });
    if (!more) $("#results").innerHTML = "";
    $("#results").insertAdjacentHTML(
      "beforeend",
      data.items.map((p) => card(p)).join("") ||
        (!more
          ? '<article class="card empty"><h3>この条件の知識はまだありません。</h3><p>条件を緩めるか、知りたい知識を募集できます。</p><button type="button" id="emptyReset">条件を緩める</button><button type="button" data-request-empty>知識を募集する</button></article>'
          : ""),
    );
    bindCards("#results", data.items);
    $("#emptyReset")?.addEventListener("click", () =>
      $("#resetFilters").click(),
    );
    $("[data-request-empty]")?.addEventListener("click", () =>
      view("requests"),
    );
    state.cursors.search = data.next;
    $("#moreResults").hidden = !data.next;
    status(
      data.guestCapped
        ? "見学では新着20件から検索しています。それより前の知識は既存のEmu light以上で利用できます。"
        : "検索結果を表示しました。",
    );
    if (parent === window) history.replaceState(null, "", sharedURL());
  }
  async function view(name) {
    if (
      !["library", "research", "mine", "requests", "writer", "admin"].includes(
        name,
      )
    )
      name = "library";
    state.view = name;
    document
      .querySelectorAll(".view")
      .forEach((el) => (el.hidden = el.id !== name));
    document
      .querySelectorAll("[data-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.view === name)),
      );
    if (!state.enabled) return;
    if (["mine", "writer", "requests", "admin"].includes(name) && !state.me)
      showLogin();
    if (state.loadedViews[name] && Date.now() - state.loadedViews[name] < 30000)
      return;
    state.loadedViews[name] = Date.now();
    if (name === "mine") await loadMine();
    if (name === "research") await publicNotes();
    if (name === "requests") await loadRequests();
    if (name === "writer") await loadWriters();
    if (name === "admin" && state.me?.owner) await adminSummary();
  }
  async function detail(postId) {
    const p = await api("/posts/" + postId, { optional: true }),
      lab = p.knowledgeLab || {};
    $("#detailBody").innerHTML =
      `<h2 id="detailTitle">${esc(p.title)}</h2><p>${esc(p.displayName)}・更新 ${date(p.updatedAt)}</p>${badges(p)}<p class="hint">${esc(lab.quality || "投稿者が届けた知識")} ${lab.verification === "tested-by-author" ? "／投稿者が試した結果（自己申告）" : ""}</p>${p.updatedAt > 0 && Date.now() - p.updatedAt > 180 * 86400000 ? '<p class="notice">更新から6か月以上経過しています。制度・環境・条件が変わっている可能性があります。</p>' : ""}<div class="body">${esc(p.body)}</div>${[
        ["period", "経験した時期"],
        ["happened", "何が起きたか"],
        ["learned", "学んだこと"],
        ["advice", "助言・注意点"],
        ["sources", "参考資料・出典"],
      ]
        .filter(([key]) => lab[key])
        .map(
          ([key, title]) =>
            `<h3>${title}</h3><p class="body">${esc(lab[key])}</p>`,
        )
        .join(
          "",
        )}<p class="hint">医療・法律・金融などの内容は個人の経験であり、専門的な助言や結果を保証するものではありません。出典の有無と正しさの検証は別です。</p><div class="actions"><button type="button" id="saveKnowledge">マイライブラリーに保存</button><button type="button" id="unsaveKnowledge">保存を外す</button><button type="button" id="useKnowledge">研究に使う</button>${p.editable ? '<button type="button" id="editKnowledge">編集</button><button type="button" id="withdrawKnowledge">公開を取り下げる</button><button type="button" id="archiveKnowledge">削除して非公開で保管</button><button type="button" id="restoreKnowledge" hidden>下書きに復元</button><button type="button" id="postHistory">編集履歴</button>' : ""}${p.authorSchoolParkId ? '<button type="button" id="openWriter">書き手を見る</button>' : ""}<button type="button" id="goodKnowledge">役に立った</button><button type="button" id="changeKnowledge">改善案を届ける</button><button type="button" id="proposeKnowledge">議題にする</button><button type="button" id="discussKnowledge">議論へ</button></div><div class="report-controls"><label for="reportReason">通報する理由</label><textarea id="reportReason" maxlength="1500"></textarea><button type="button" id="reportKnowledge">運営へ通報</button></div>`;
    $("#detailDialog").showModal();
    bindAsync($("#saveKnowledge"), async () => {
      await api("/saved/" + p.id, {
        method: "PUT",
        body: { saved: true },
        auth: true,
      });
      status("マイライブラリーに保存しました。");
    });
    bindAsync($("#unsaveKnowledge"), async () => {
      await api("/saved/" + p.id, {
        method: "PUT",
        body: { saved: false },
        auth: true,
      });
      status("保存を外しました。");
    });
    bindAsync($("#useKnowledge"), async () => {
      if (state.selected.size >= 6 && !state.selected.has(p.id))
        throw new Error("SELECT_TWO_TO_SIX_SOURCES");
      state.selected.set(p.id, p);
      selected();
      $("#detailDialog").close();
      await view("research");
    });
    if (p.editable) {
      if (p.visibility === "archived") {
        $("#editKnowledge").hidden = true;
        $("#withdrawKnowledge").hidden = true;
        $("#archiveKnowledge").hidden = true;
        $("#restoreKnowledge").hidden = false;
      }
      bindAsync($("#archiveKnowledge"), async () => {
        if (
          !confirm(
            "一覧から削除して非公開で保管しますか？元の内容は「削除・保管した経験知」から下書きに復元できます。",
          )
        )
          return;
        await api("/posts/" + p.id + "/archive", {
          method: "POST",
          auth: true,
          body: { revision: p.revision },
        });
        $("#detailDialog").close();
        status("一覧から削除して非公開で保管しました。");
      });
      bindAsync($("#restoreKnowledge"), async () => {
        await api("/posts/" + p.id + "/restore", {
          method: "POST",
          auth: true,
          body: { revision: p.revision },
        });
        $("#detailDialog").close();
        status("下書きに復元しました。");
      });
      bindAsync($("#editKnowledge"), async () => {
        $("#detailDialog").close();
        edit(p);
      });
      bindAsync($("#withdrawKnowledge"), async () => {
        if (
          !confirm(
            "公開から取り下げ、自分用として保存しますか？関連する公開研究も他の人には表示されなくなります。",
          )
        )
          return;
        await api("/posts/" + p.id + "/withdraw", {
          method: "POST",
          auth: true,
          body: {
            revision: p.revision,
            key: keyFor("withdraw", { id: p.id, revision: p.revision }),
          },
        });
        $("#detailDialog").close();
        status("取り下げました。内容はマイライブラリーに残っています。");
        await search();
      });
      bindAsync($("#postHistory"), async () => {
        const data = await api("/posts/" + p.id + "/history", { auth: true });
        $("#detailBody").insertAdjacentHTML(
          "beforeend",
          "<h3>編集履歴（本人・運営のみ）</h3>" +
            data.items
              .map(
                (i) =>
                  `<details><summary>変更 ${date(i.changedAtMs)}・版 ${i.previous.knowledgeLab?.revision || 0}</summary><p class="body">${esc(i.previous.body)}</p></details>`,
              )
              .join(""),
        );
      });
    }
    if (p.authorSchoolParkId)
      bindAsync($("#openWriter"), () => showWriter(p.authorSchoolParkId));
    [
      ["#goodKnowledge", "good"],
      ["#changeKnowledge", "change"],
      ["#proposeKnowledge", "propose"],
      ["#discussKnowledge", "discussion"],
    ].forEach(
      ([selector, action]) =>
        ($(selector).onclick = () => {
          $("#detailDialog").close();
          integration(action, { postId: p.id });
        }),
    );
    bindAsync($("#reportKnowledge"), async () => {
      await api("/reports", {
        method: "POST",
        auth: true,
        body: {
          kind: "post",
          targetId: p.id,
          reason: $("#reportReason").value,
        },
      });
      status("通報を受け付けました。");
      $("#detailDialog").close();
    });
  }
  function edit(p = null) {
    state.post = p;
    $("#postForm").reset();
    $("#editorTitle").textContent = p ? "経験知を編集する" : "経験知を届ける";
    $("#postTitle").value = p?.title || "";
    $("#postBody").value = p?.body || "";
    $("#postTags").value = Array.isArray(p?.tags)
      ? p.tags.join(",")
      : p?.tags || "";
    $("#postVisibility").value = p?.visibility || "draft";
    const lab = p?.knowledgeLab || {};
    for (const key of [
      "period",
      "happened",
      "learned",
      "advice",
      "sources",
      "verification",
    ])
      $("#post" + key[0].toUpperCase() + key.slice(1)).value =
        lab[key] || (key === "verification" ? "self-reported" : "");
    facetUI("#postFacets", lab.facets);
    $("#editorDialog").showModal();
    $("#postTitle").focus();
  }
  $("#postForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const p = state.post,
        payload = {
          ...(p
            ? {
                id: p.id,
                revision: p.revision,
                previousFacets: p.knowledgeLab?.facets,
              }
            : {}),
          title: $("#postTitle").value,
          body: $("#postBody").value,
          tags: $("#postTags").value,
          facets: facetValue("#postFacets"),
          visibility: $("#postVisibility").value,
        };
      for (const key of [
        "period",
        "happened",
        "learned",
        "advice",
        "sources",
        "verification",
      ])
        payload[key] = $("#post" + key[0].toUpperCase() + key.slice(1)).value;
      const submit = $("#postForm button[type=submit]");
      submit.disabled = true;
      try {
        const result = await api("/posts", {
          method: "PUT",
          auth: true,
          body: { ...payload, key: keyFor("post", payload) },
        });
        state.post = await api("/posts/" + result.id, { auth: true });
        $("#editorDialog").close();
        status("経験知を保存しました。");
        await search();
      } finally {
        submit.disabled = false;
      }
    });
  });
  function selected() {
    $("#selectedSources").innerHTML =
      [...state.selected.values()]
        .map(
          (p) =>
            `<p class="source"><b>${esc(p.title)}</b> ${badges(p)} <button type="button" data-remove-source="${esc(p.id)}" aria-label="${esc(p.title)}を研究から外す">外す</button></p>`,
        )
        .join("") || "<p>まだ元知識を選んでいません。</p>";
    document.querySelectorAll("[data-remove-source]").forEach(
      (b) =>
        (b.onclick = () => {
          state.selected.delete(b.dataset.removeSource);
          selected();
        }),
    );
  }
  function selectedFields() {
    return [...$("#researchFields").querySelectorAll("input:checked")].map(
      (el) => el.value,
    );
  }
  async function researchFind(more = false) {
    const fields = selectedFields();
    if (fields.length < 2 || fields.length > 3)
      throw new Error("SELECT_TWO_OR_THREE_FIELDS");
    state.fields = fields;
    const params = new URLSearchParams({
      field: fields.join(","),
      sort: "relevance",
    });
    if (more && state.cursors.research)
      params.set("cursor", state.cursors.research);
    const data = await api("/search?" + params, { optional: true });
    if (!more) $("#researchCandidates").innerHTML = "";
    $("#researchCandidates").insertAdjacentHTML(
      "beforeend",
      data.items.map((p) => card(p, true)).join("") ||
        (!more
          ? '<p class="card empty">関連する知識はまだありません。知識募集で経験者に問いを届けられます。</p>'
          : ""),
    );
    bindCards("#researchCandidates", data.items);
    state.cursors.research = data.next;
    $("#researchMore").hidden = !data.next;
  }
  $("#researchFind").addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => researchFind());
  });
  bindAsync($("#researchMore"), () => researchFind(true));
  bindAsync($("#compareSources"), async () => {
    const data = await api("/compare", {
      method: "POST",
      auth: true,
      body: { sourceIds: [...state.selected.keys()] },
    });
    $("#comparison").hidden = false;
    $("#comparison").innerHTML =
      `<section class="card"><h3>比較：元の知識と、あなたの問い</h3><p>分類の共通点・違いを実データから表示しています。文章の意味をAIで分析した結果ではありません。</p><p><b>共通の分類：</b>${esc(Object.values(data.common).map(names).filter(Boolean).join("／") || "共通する分類は未登録です。")}</p><p><b>異なる分類：</b>${esc(Object.values(data.differences).map(names).filter(Boolean).join("／"))}</p>${data.sources.map((p) => `<div class="source"><a href="/knowledge-lab.html?post=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${esc(p.title)}</a><p>${esc(p.body.slice(0, 300))}</p><small>元知識・更新 ${date(p.updatedAt)} ${esc(p.displayName)}</small></div>`).join("")}<h3>考えるための問い（定型）</h3>${data.prompts.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="hint">この下に書く問い・仮説は、元投稿の事実や検証済みの結果とは別です。</p></section>`;
    status("比較を表示しました。あなたの問いと仮説を記入してください。");
  });
  $("#noteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const fields = selectedFields();
      const payload = {
        ...(state.note
          ? { id: state.note.id, revision: state.note.revision }
          : {}),
        title: $("#noteTitle").value,
        sourceIds: [...state.selected.keys()],
        fields,
        question: $("#noteQuestion").value,
        hypothesis: $("#noteHypothesis").value,
        plan: $("#notePlan").value,
        result: $("#noteResult").value,
        visibility: $("#noteVisibility").value,
      };
      const submit = $("#noteForm button[type=submit]");
      submit.disabled = true;
      try {
        const result = await api("/notes", {
          method: "PUT",
          auth: true,
          body: { ...payload, key: keyFor("note", payload) },
        });
        state.note = { ...payload, ...result };
        status(
          "研究ノートを保存しました。次回はマイライブラリーから結果を追記できます。",
        );
        await publicNotes();
      } finally {
        submit.disabled = false;
      }
    });
  });
  $("#newNote").onclick = () => {
    state.note = null;
    $("#noteForm").reset();
    state.selected.clear();
    selected();
    $("#comparison").hidden = true;
    status("新しい研究ノートを始めます。");
  };
  function noteCard(n) {
    return `<article class="card"><span class="badge">${n.result ? "投稿者による実践結果" : "未検証の仮説"}・手動で記入</span><h3>${esc(n.title)}</h3><p>${esc(n.question || n.hypothesis).slice(0, 150)}</p><small>更新 ${date(n.updatedAtMs)}</small><div class="actions"><button type="button" data-note="${esc(n.id)}">研究を読む・続ける</button></div></article>`;
  }
  function bindNotes(target) {
    $(target)
      .querySelectorAll("[data-note]")
      .forEach((b) => bindAsync(b, () => showNote(b.dataset.note)));
  }
  async function publicNotes(more = false) {
    const data = await api(
      "/notes" +
        (more && state.cursors.notes
          ? "?cursor=" + encodeURIComponent(state.cursors.notes)
          : ""),
      { optional: true },
    );
    if (!more) $("#publicNotes").innerHTML = "";
    $("#publicNotes").insertAdjacentHTML(
      "beforeend",
      data.items.map(noteCard).join("") ||
        (!more
          ? '<p class="card empty">公開されている研究はまだありません。</p>'
          : ""),
    );
    bindNotes("#publicNotes");
    state.cursors.notes = data.next;
    $("#publicNotesMore").hidden = !data.next;
  }
  bindAsync($("#publicNotesMore"), () => publicNotes(true));
  async function showNote(noteId) {
    const n = await api("/notes/" + noteId, { optional: true });
    $("#detailBody").innerHTML =
      `<h2 id="detailTitle">${esc(n.title)}</h2><p>${esc(names(n.fields))}・更新 ${date(n.updatedAtMs)}</p><span class="badge">手動で記入した${n.result ? "実践の記録（自己申告）" : "未検証の仮説"}</span>${[
        ["question", "問い"],
        ["hypothesis", "仮説（未検証）"],
        ["plan", "実践案・注意点"],
        ["result", "試した結果・改善点（自己申告）"],
      ]
        .map(
          ([key, title]) =>
            `<h3>${title}</h3><p class="body">${esc(n[key] || "未記入")}</p>`,
        )
        .join(
          "",
        )}<h3>元になった知識</h3>${n.sourceIds.map((id) => `<p><button type="button" data-post="${esc(id)}">元知識 ${esc(id)} を読む</button></p>`).join("")}<div class="actions">${state.me?.schoolParkId === n.authorSchoolParkId ? '<button type="button" id="continueNote">結果を追記・編集</button><button type="button" id="archiveNote">ノートを非公開で保管</button><button type="button" id="publishExperience">試した結果を経験知として書く</button>' : ""}<button type="button" id="discussNote">既存の議論へ</button><button type="button" id="practiceNote">Quest・Guildで実践する</button></div><div class="report-controls"><label for="noteReport">通報理由</label><textarea id="noteReport" maxlength="1500"></textarea><button type="button" id="reportNote">運営へ通報</button></div>`;
    $("#detailDialog").showModal();
    $("#detailBody")
      .querySelectorAll("[data-post]")
      .forEach((b) =>
        bindAsync(b, async () => {
          $("#detailDialog").close();
          await detail(b.dataset.post);
        }),
      );
    if ($("#continueNote")) {
      bindAsync($("#continueNote"), async () => {
        state.note = n;
        state.selected.clear();
        for (const id of n.sourceIds) {
          try {
            state.selected.set(id, await api("/posts/" + id, { auth: true }));
          } catch (e) {
            status(
              "元知識の一部は現在利用できません。別の知識を選び直してください。",
              true,
            );
          }
        }
        selected();
        $("#noteTitle").value = n.title;
        for (const key of ["question", "hypothesis", "plan", "result"])
          $("#note" + key[0].toUpperCase() + key.slice(1)).value = n[key] || "";
        $("#noteVisibility").value = n.visibility;
        $("#researchFields")
          .querySelectorAll("input")
          .forEach((el) => (el.checked = n.fields.includes(el.value)));
        $("#detailDialog").close();
        await view("research");
        $("#noteTitle").focus();
      });
      bindAsync($("#archiveNote"), async () => {
        await api("/notes/" + n.id + "/archive", {
          method: "POST",
          auth: true,
          body: { revision: n.revision },
        });
        $("#detailDialog").close();
        status("研究を非公開で保管しました。");
      });
      $("#publishExperience").onclick = () => {
        $("#detailDialog").close();
        edit();
        $("#postTitle").value = n.title;
        $("#postBody").value = [
          n.result,
          n.plan,
          "元の研究: " +
            new URL("/knowledge-lab.html?note=" + n.id, location.origin),
        ]
          .filter(Boolean)
          .join("\n\n");
        facetUI("#postFacets", { field: n.fields });
      };
    }
    $("#discussNote").onclick = () => {
      $("#detailDialog").close();
      integration("discussion", { noteId: n.id });
    };
    $("#practiceNote").onclick = () => {
      $("#detailDialog").close();
      integration("schoolpark", { noteId: n.id });
    };
    bindAsync($("#reportNote"), async () => {
      await api("/reports", {
        method: "POST",
        auth: true,
        body: { kind: "note", targetId: n.id, reason: $("#noteReport").value },
      });
      $("#detailDialog").close();
      status("通報を受け付けました。");
    });
  }
  async function loadMine(more = false) {
    const kind = state.mineKind,
      data = await api(
        "/me/" +
          kind +
          (more && state.cursors.mine
            ? "?cursor=" + encodeURIComponent(state.cursors.mine)
            : ""),
        { auth: true },
      );
    if (!more) $("#mineItems").innerHTML = "";
    $("#mineItems").insertAdjacentHTML(
      "beforeend",
      (kind === "notes"
        ? data.items.map(noteCard)
        : data.items.map((p) => card(p))
      ).join("") ||
        (!more
          ? '<p class="card empty">まだ記録はありません。保存・投稿・研究をここから続けられます。</p>'
          : ""),
    );
    if (kind === "notes") bindNotes("#mineItems");
    else bindCards("#mineItems", data.items);
    state.cursors.mine = data.next;
    $("#mineMore").hidden = !data.next;
  }
  document.querySelectorAll("[data-mine]").forEach((b) =>
    bindAsync(b, () => {
      state.mineKind = b.dataset.mine;
      return loadMine();
    }),
  );
  bindAsync($("#mineMore"), () => loadMine(true));
  $("#legacyLibrary").onclick = () => integration("library");
  function fillWriter() {
    const w = state.me?.writer;
    state.writerRevision = w?.revision || 0;
    $("#writerName").value = w?.displayName || "";
    $("#writerBio").value = w?.bio || "";
    $("#writerIcon").value = w?.icon || "";
    $("#writerPublished").checked = !!w?.published;
    $("#writerConsent").checked = !!w?.consentVersion;
    facetUI("#writerFacets", w?.facets, ["field", "job"]);
  }
  async function saveWriter(privateOnly = false) {
    const body = {
      displayName: $("#writerName").value,
      bio: $("#writerBio").value,
      icon: $("#writerIcon").value,
      facets: facetValue("#writerFacets"),
      published: !privateOnly && $("#writerPublished").checked,
      consent: $("#writerConsent").checked,
      revision: state.writerRevision,
    };
    const w = await api("/me/writer", { method: "PUT", body, auth: true });
    state.writerRevision = w.revision;
    state.me.writer = w;
    $("#writerPublished").checked = w.published;
    status(
      w.published
        ? "書き手プロフィールを公開しました。最初の経験知を届けられます。"
        : "プロフィールを非公開で保存しました。続きをここから再開できます。",
    );
    await loadWriters();
  }
  $("#writerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => saveWriter());
  });
  bindAsync($("#writerDraft"), () => saveWriter(true));
  $("#passportLink").onclick = () => integration("passport");
  async function loadWriters(more = false) {
    const data = await api(
      "/writers" +
        (more && state.cursors.writers
          ? "?cursor=" + encodeURIComponent(state.cursors.writers)
          : ""),
    );
    if (!more) $("#writers").innerHTML = "";
    $("#writers").insertAdjacentHTML(
      "beforeend",
      data.items
        .map(
          (w) =>
            `<article class="card">${w.icon ? `<img class="writer-icon" src="${esc(w.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<h3>${esc(w.displayName)}</h3><p>${esc(w.bio)}</p><small>経験分野・職業は自己申告：${esc(names(w.facets?.field))} ${esc(names(w.facets?.job))}</small><button type="button" data-writer="${esc(w.id)}">プロフィール・知識を見る</button></article>`,
        )
        .join("") ||
        (!more
          ? '<p class="card empty">書き手を募集しています。あなたの経験を届けてみませんか？</p>'
          : ""),
    );
    $("#writers")
      .querySelectorAll("[data-writer]")
      .forEach((b) => bindAsync(b, () => showWriter(b.dataset.writer)));
    state.cursors.writers = data.next;
    $("#writersMore").hidden = !data.next;
  }
  bindAsync($("#writersMore"), () => loadWriters(true));
  async function showWriter(spid) {
    const w = await api("/writers/" + spid, { optional: true });
    $("#detailBody").innerHTML =
      `<h2 id="detailTitle">${esc(w.displayName)}</h2><p class="body">${esc(w.bio)}</p><p>経験分野：${esc(names(w.facets?.field))}</p><p>業種・職業：${esc(names(w.facets?.job))}</p><p class="hint">経験・職歴・資格は自己申告です。認証済みの資格を示すものではありません。</p><p>SchoolPark ID：${esc(w.id)}</p><a href="/?lab=writer">Passport・星空へ（ログイン後）</a>`;
    $("#detailDialog").showModal();
    const contribution = await api("/writers/" + spid + "/contributions", {
      optional: true,
    });
    $("#detailBody").insertAdjacentHTML(
      "beforeend",
      '<h3>Knowledge Labで公開した知識</h3><div id="writerPosts">' +
        (contribution.posts.map((p) => card(p)).join("") ||
          "<p>まだ公開知識はありません。</p>") +
        '</div><h3>公開した研究</h3><div id="writerNotes">' +
        (contribution.notes.map(noteCard).join("") ||
          "<p>現在表示できる公開研究はありません。</p>") +
        '</div><p class="hint">通常投稿の過去の貢献履歴は、本人の既存Passport・価値プロフィール・星空から確認できます。</p>',
    );
    let postNext = contribution.postNext,
      noteNext = contribution.noteNext;
    $("#detailBody").insertAdjacentHTML(
      "beforeend",
      '<div class="actions"><button type="button" id="writerMorePosts">知識をさらに見る</button><button type="button" id="writerMoreNotes">研究をさらに見る</button></div><div class="report-controls"><label for="writerReportReason">書き手への通報理由</label><textarea id="writerReportReason" maxlength="1500"></textarea><button type="button" id="reportWriter">運営へ通報</button></div>',
    );
    function bindContribution() {
      $("#writerPosts")
        .querySelectorAll("[data-post]")
        .forEach((b) =>
          bindAsync(b, async () => {
            $("#detailDialog").close();
            await detail(b.dataset.post);
          }),
        );
      $("#writerPosts")
        .querySelectorAll("[data-source]")
        .forEach((b) => (b.hidden = true));
      $("#writerPosts")
        .querySelectorAll("[data-edit]")
        .forEach((b) => (b.hidden = true));
      $("#writerNotes")
        .querySelectorAll("[data-note]")
        .forEach((b) =>
          bindAsync(b, async () => {
            $("#detailDialog").close();
            await showNote(b.dataset.note);
          }),
        );
      $("#writerMorePosts").hidden = !postNext;
      $("#writerMoreNotes").hidden = !noteNext;
    }
    bindContribution();
    bindAsync($("#writerMorePosts"), async () => {
      const data = await api(
        "/writers/" +
          spid +
          "/contributions?cursor=" +
          encodeURIComponent(postNext),
        { optional: true },
      );
      $("#writerPosts").insertAdjacentHTML(
        "beforeend",
        data.posts.map((p) => card(p)).join(""),
      );
      postNext = data.postNext;
      bindContribution();
    });
    bindAsync($("#writerMoreNotes"), async () => {
      const data = await api(
        "/writers/" +
          spid +
          "/contributions?noteCursor=" +
          encodeURIComponent(noteNext),
        { optional: true },
      );
      $("#writerNotes").insertAdjacentHTML(
        "beforeend",
        data.notes.map(noteCard).join(""),
      );
      noteNext = data.noteNext;
      bindContribution();
    });
    bindAsync($("#reportWriter"), async () => {
      await api("/reports", {
        method: "POST",
        auth: true,
        body: {
          kind: "writer",
          targetId: spid,
          reason: $("#writerReportReason").value,
        },
      });
      status("書き手への通報を受け付けました。");
      $("#detailDialog").close();
    });
  }

  async function loadRequests(more = false) {
    const data = await api(
      "/requests" +
        (more && state.cursors.requests
          ? "?cursor=" + encodeURIComponent(state.cursors.requests)
          : ""),
      { auth: true },
    );
    if (!more) $("#requestItems").innerHTML = "";
    $("#requestItems").insertAdjacentHTML(
      "beforeend",
      data.items
        .map(
          (r) =>
            `<article class="card"><span class="badge">${r.status === "open" ? "募集中" : "終了"}・回答 ${r.answerCount || 0}</span><h3>${esc(r.question)}</h3><p>${esc(r.context)}</p><p>${esc(r.targetExperience || "")}</p>${badges(r)}<div class="actions"><button type="button" data-answer="${esc(r.id)}">経験を届ける</button><button type="button" data-answers="${esc(r.id)}">届いた知識・採用を確認</button></div></article>`,
        )
        .join("") ||
        (!more
          ? '<p class="card empty">まだ募集はありません。知りたい問いを届けてみませんか？</p>'
          : ""),
    );
    $("#requestItems")
      .querySelectorAll("[data-answer]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            integration("answer", { requestId: b.dataset.answer })),
      );
    $("#requestItems")
      .querySelectorAll("[data-answers]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            integration("answers", { requestId: b.dataset.answers })),
      );
    state.cursors.requests = data.next;
    $("#requestMore").hidden = !data.next;
  }
  bindAsync($("#requestMore"), () => loadRequests(true));
  $("#requestForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const payload = {
        question: $("#requestQuestion").value,
        context: $("#requestContext").value,
        targetExperience: $("#requestTarget").value,
        facets: facetValue("#requestFacets"),
      };
      try {
        await api("/requests", {
          method: "POST",
          auth: true,
          body: { ...payload, key: keyFor("request", payload) },
        });
        $("#requestForm").reset();
        status("募集を保存しました。既存の募集一覧にも表示されます。");
        await loadRequests();
      } catch (e) {
        if (e.message === "USE_EXISTING_REQUEST_FLOW") {
          integration("request");
          status("既存の募集画面で懸賞条件を確認して続けてください。");
        } else throw e;
      }
    });
  });
  async function adminSummary() {
    const s = await api("/admin/summary", { auth: true });
    const labels = {
      writers: "登録書き手",
      newWriters7: "直近7日の新規書き手",
      experiencePosts: "公開経験知",
      notes: "研究数",
      requests: "知識募集",
      unanswered: "未回答の募集",
      reports: "通報（全状態）",
      private_posts: "非公開・取り下げ",
      search: "検索索引",
    };
    $("#adminSummary").innerHTML = `<div class="metrics">${Object.entries(
      s.counts,
    )
      .map(([key, n]) => `<div><b>${n}</b>${esc(labels[key] || key)}</div>`)
      .join("")}</div><h3>分野別投稿数</h3><p>${Object.entries(s.fieldCounts)
      .map(([id, n]) => `${esc(names([id]))}: ${n}`)
      .join(
        "／",
      )}</p><h3>検索索引</h3><p>${esc(s.index?.state || "未作成")}・${s.index?.processed || 0}件・最終確認 ${date(s.index?.finishedAtMs)}</p><p class="hint">索引上限20,000件・64MiB。通常の表示は20件単位。AI利用費は発生しません。新しい報酬設定はありません。</p>`;
    renderTaxonomy();
  }
  bindAsync($("#adminRefresh"), adminSummary);
  bindAsync($("#adminInit"), async () => {
    await api("/admin/init", { method: "POST", auth: true, body: {} });
    state.terms = await api("/taxonomy");
    renderFacets();
    await adminSummary();
    status("初期分類を登録しました。既存分類は上書きしていません。");
  });
  bindAsync($("#adminIndex"), async () => {
    if (
      !confirm(
        "公開投稿を128件ずつ読み、検索索引を更新します。Firestoreの読み書きが発生します。開始しますか？",
      )
    )
      return;
    await api("/admin/index", { method: "POST", auth: true, body: {} });
    status(
      "検索索引の作成を開始しました。活動状況を更新して結果を確認してください。",
    );
    await adminSummary();
  });
  function renderTaxonomy() {
    $("#taxonomyList").innerHTML = state.terms
      .map(
        (t) =>
          `<p><button type="button" data-term="${esc(t.id)}">${esc(axes[t.axis])}：${esc(t.label)} ${t.active ? "" : "（非表示）"}${t.mergedInto ? " → " + esc(names([t.mergedInto])) : ""}</button></p>`,
      )
      .join("");
    document.querySelectorAll("[data-term]").forEach(
      (b) =>
        (b.onclick = () => {
          const t = state.terms.find((t) => t.id === b.dataset.term);
          $("#termId").value = t.id;
          $("#termId").readOnly = true;
          $("#termAxis").value = t.axis;
          $("#termAxis").disabled = true;
          $("#termLabel").value = t.label;
          $("#termActive").checked = t.active;
          $("#termMerge").value = t.mergedInto || "";
          state.termRevision = t.revision;
          $("#termLabel").focus();
        }),
    );
    if (!$("#newTaxonomy")) {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "newTaxonomy";
      b.textContent = "新しい分類";
      b.onclick = () => {
        $("#taxonomyForm").reset();
        $("#termId").readOnly = false;
        $("#termAxis").disabled = false;
        state.termRevision = 0;
        $("#termId").focus();
      };
      $("#taxonomyForm").append(b);
    }
  }
  $("#taxonomyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await api("/admin/taxonomy/" + encodeURIComponent($("#termId").value), {
        method: "PUT",
        auth: true,
        body: {
          label: $("#termLabel").value,
          axis: $("#termAxis").value,
          active: $("#termActive").checked,
          mergedInto: $("#termMerge").value,
          revision: state.termRevision,
        },
      });
      state.terms = await api("/taxonomy");
      renderTaxonomy();
      state.termRevision =
        state.terms.find((t) => t.id === $("#termId").value)?.revision || 0;
      status("分類を保存しました。表示名を変えても投稿のIDは維持されます。");
    });
  });
  async function adminList(more = false) {
    const kind = state.adminKind,
      data = await api(
        "/admin/list/" +
          kind +
          (more && state.cursors.admin
            ? "?cursor=" + encodeURIComponent(state.cursors.admin)
            : ""),
        { auth: true },
      );
    if (!more) {
      $("#adminItems").innerHTML = "";
      state.adminRows.clear();
    }
    data.items.forEach((item) => state.adminRows.set(item.id, item));
    $("#adminItems").insertAdjacentHTML(
      "beforeend",
      data.items
        .map(
          (item) =>
            `<article class="card"><small>${esc(item.id)}</small><h3>${esc(item.title || item.displayName || item.question || item.reason || "記録")}</h3><p>${esc(item.body || item.bio || item.context || item.reason || "").slice(0, 500)}</p>${kind === "posts" && item.updatedAt > 0 && Date.now() - item.updatedAt > 180 * 86400000 ? '<p class="notice">更新から6か月以上。情報更新を確認してください。</p>' : ""}${kind === "requests" && item.answerCount === 0 ? "<p>未回答</p>" : ""}${kind === "reports" ? `<p>状態：${esc(item.status)}／対象 ${esc(item.kind)} ${esc(item.targetId)}</p><label for="report-status-${esc(item.id)}">対応状態</label><select id="report-status-${esc(item.id)}" data-report-state="${esc(item.id)}"><option value="reviewing">確認中</option><option value="resolved">対応済み</option><option value="dismissed">対応不要</option></select><label for="report-note-${esc(item.id)}">運営の対応メモ</label><textarea id="report-note-${esc(item.id)}" data-report-note="${esc(item.id)}" maxlength="1500"></textarea><button type="button" data-resolve="${esc(item.id)}">対応を保存</button>` : ""}${["posts", "private_posts"].includes(kind) ? `<p>版 ${item.knowledgeLab?.revision || 0}・${esc(item.visibility || "public")}</p><label for="moderation-${esc(item.id)}">操作理由</label><input id="moderation-${esc(item.id)}" maxlength="500" data-moderation-reason="${esc(item.id)}"><div class="actions">${kind === "posts" ? `<button type="button" data-moderate="hide" data-id="${esc(item.id)}">非公開にして確認</button><button type="button" data-moderate="${item.knowledgeLab?.featured ? "unfeature" : "feature"}" data-id="${esc(item.id)}">${item.knowledgeLab?.featured ? "注目から外す" : "注目にする"}</button>` : item.knowledgeLab?.hidden && item.knowledgeLab.beforeModeration === "public" ? `<button type="button" data-moderate="restore" data-id="${esc(item.id)}">元の公開状態へ復元</button>` : ""}</div>` : ""}${["notes", "writers"].includes(kind) ? `<p>公開状態：${kind === "writers" ? (item.published ? "公開" : "非公開") : esc(item.visibility)}／運営確認：${item.moderated ? "停止中" : "通常"}</p>${kind === "notes" ? `<button type="button" data-admin-note="${esc(item.id)}">研究の内容を確認</button>` : ""}<label for="visibility-reason-${esc(item.id)}">操作理由</label><input id="visibility-reason-${esc(item.id)}" data-visibility-reason="${esc(item.id)}" maxlength="500"><button type="button" data-entity-visibility="${item.moderated ? "release" : "hide"}" data-id="${esc(item.id)}" data-kind="${kind === "writers" ? "writer" : "note"}">${item.moderated ? "確認解除（本人が再公開）" : "非公開にして確認"}</button>` : ""}</article>`,
        )
        .join("") ||
        (!more
          ? '<p class="card empty">この項目にはまだ記録がありません。</p>'
          : ""),
    );
    $("#adminItems")
      .querySelectorAll("[data-resolve]")
      .forEach((b) =>
        bindAsync(b, async () => {
          const id = b.dataset.resolve;
          await api("/admin/reports/" + id, {
            method: "POST",
            auth: true,
            body: {
              status: $(`[data-report-state="${id}"]`).value,
              note: $(`[data-report-note="${id}"]`).value,
            },
          });
          status("通報への対応を記録しました。");
          await adminList();
        }),
      );
    $("#adminItems")
      .querySelectorAll("[data-moderate]")
      .forEach((b) =>
        bindAsync(b, async () => {
          const item = state.adminRows.get(b.dataset.id);
          if (!item) return;
          await api("/admin/posts/" + item.id, {
            method: "POST",
            auth: true,
            body: {
              action: b.dataset.moderate,
              revision: item.knowledgeLab?.revision || 0,
              reason: $(`[data-moderation-reason="${item.id}"]`).value,
            },
          });
          status("公開状態を更新し、操作履歴を残しました。");
          await adminList();
        }),
      );
    $("#adminItems")
      .querySelectorAll("[data-admin-note]")
      .forEach((b) => bindAsync(b, () => showNote(b.dataset.adminNote)));
    $("#adminItems")
      .querySelectorAll("[data-entity-visibility]")
      .forEach((b) =>
        bindAsync(b, async () => {
          const item = state.adminRows.get(b.dataset.id);
          await api("/admin/visibility/" + b.dataset.kind + "/" + item.id, {
            method: "POST",
            auth: true,
            body: {
              action: b.dataset.entityVisibility,
              revision: item.revision,
              reason: $(`[data-visibility-reason="${item.id}"]`).value,
            },
          });
          status("公開停止・確認状態を更新しました。再公開は本人が選びます。");
          await adminList();
        }),
      );
    state.cursors.admin = data.next;
    $("#adminMore").hidden = !data.next;
  }
  $("#classifyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await api(
        "/admin/classify/" + encodeURIComponent($("#classifyId").value),
        {
          method: "POST",
          auth: true,
          body: {
            revision: Number($("#classifyRevision").value),
            facets: facetValue("#classifyFacets"),
            reason: $("#classifyReason").value,
          },
        },
      );
      $("#classifyRevision").value = Number($("#classifyRevision").value) + 1;
      status("本文を変えずに分類を保存しました。");
    });
  });
  document.querySelectorAll("[data-admin-list]").forEach((b) =>
    bindAsync(b, () => {
      state.adminKind = b.dataset.adminList;
      return adminList();
    }),
  );
  bindAsync($("#adminMore"), () => adminList(true));
  function renderFacets() {
    const params = new URLSearchParams(location.search),
      value = {};
    for (const axis of Object.keys(axes))
      value[axis] = (params.get(axis) || "").split(",").filter(Boolean);
    facetUI("#searchFacets", value);
    facetUI("#requestFacets");
    facetUI("#postFacets");
    facetUI("#classifyFacets");
    fillWriter();
    $("#researchFields").innerHTML = state.terms
      .filter((t) => t.axis === "field" && t.active && !t.mergedInto)
      .map(
        (t) =>
          `<label><input type="checkbox" value="${esc(t.id)}">${esc(t.label)}</label>`,
      )
      .join("");
    $("#query").value = params.get("q") || "";
    $("#sort").value = ["new", "relevance", "updated"].includes(
      params.get("sort"),
    )
      ? params.get("sort")
      : "new";
  }
  document.querySelectorAll("[data-compose]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!state.enabled) return status(messages.LAUNCH_HOLD, true);
        edit();
      }),
  );
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => bindAsync(b, () => view(b.dataset.view)));
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => search());
  });
  $("#resetFilters").onclick = () => {
    $("#searchForm").reset();
    $("#searchFacets")
      .querySelectorAll("option")
      .forEach((o) => (o.selected = false));
    run(() => search());
  };
  bindAsync($("#moreResults"), () => search(true));
  bindAsync($("#shareSearch"), async () => {
    try {
      await navigator.clipboard.writeText(sharedURL().href);
      status("検索条件のURLをコピーしました。");
    } catch (_) {
      status("共有URL：" + sharedURL());
    }
  });
  const tour = window.ReizoTour;
  if (tour) {
    tour.register(
      "emu-lab",
      [
        {
          target: "lab-intro",
          label: "経験から、次の発見へ",
          text: "知識図書館で経験知を探し、研究所で異なる知識を比較できるよ。",
        },
        {
          target: "lab-tabs",
          label: "図書館と研究所",
          text: "分野から探すなら図書館。2〜3分野の知識から問いを考えるなら研究所へ。保存した記録はマイライブラリーに残るよ。",
        },
        {
          target: "lab-library",
          label: "まず、必要な知識へ",
          text: "キーワードや複数の分類から探してみよう。見るだけで投稿や保存は行われないよ。",
        },
      ],
      {
        label: "Knowledge Lab",
        brand: "Emu",
        isReady: () =>
          state.enabled && state.terms.length > 0 && state.view === "library",
      },
    );
    $("#guide").onclick = () => {
      run(async () => {
        await view("library");
        tour.restart("emu-lab");
      });
    };
  }
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (e.data?.type === "emu-lab-feedback")
      status(e.data.message || "既存画面へ移動しました。");
  });
  async function init() {
    const initialParams = new URLSearchParams(location.search);
    const config = await api("/config");
    state.enabled = config.enabled;
    if (!config.enabled) {
      status(messages[config.reason] || messages.LAUNCH_HOLD);
      document
        .querySelectorAll("form button,.view>button,[data-compose]")
        .forEach((b) => (b.disabled = true));
      return;
    }
    state.terms = await api("/taxonomy");
    try {
      state.me = await api("/me", { auth: true });
      $("#loginBox").hidden = true;
      $("#adminTab").hidden = !state.me.owner;
    } catch (e) {
      showLogin();
    }
    renderFacets();
    await search();
    const p = initialParams,
      initial = p.get("view");
    if (initial && initial !== "library") await view(initial);
    if (p.get("post")) await detail(p.get("post"));
    if (p.get("note")) await showNote(p.get("note"));
    if (p.get("compose") === "1") edit();
    if (p.get("edit"))
      edit(await api("/posts/" + p.get("edit"), { auth: true }));
    if (tour && state.view === "library") tour.enter("emu-lab");
    document.documentElement.dataset.labReady = "true";
  }
  run(init);
})();
