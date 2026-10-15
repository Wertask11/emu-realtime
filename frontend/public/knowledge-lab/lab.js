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
    industry: "業種",
    occupation: "職業",
    experience: "経験の種類",
    purpose: "目的",
    kind: "知識の形式",
    genre: "ジャンル",
    difficulty: "難易度",
    audience: "対象者",
    period: "経験した時期",
    job: "以前の業種・職業分類（確認待ち）",
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
    originAnswer: null,
    originResearch: null,
    note: null,
    aiRun: null,
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
    AI_DISABLED: "AIは現在停止しています。手動の研究機能を利用できます。",
    AI_SOURCE_CONSENT_REQUIRED:
      "投稿者がAI利用に同意した公開知識を選んでください。",
    AI_REQUEST_CONSENT_REQUIRED:
      "送信内容とデータの取り扱いを確認して、確認欄にチェックしてください。",
    AI_FIELD_SOURCES_MISSING:
      "選んだ各分野の知識を、少なくとも1件ずつ選んでください。",
    AI_INSUFFICIENT_CONSENTED_SOURCES:
      "最近の関連知識の中に、投稿者がAI利用に同意した知識が2件以上ありません。元知識を自分で選ぶか、知識を募集してください。",
    AI_FREE_QUOTA_EXHAUSTED:
      "Geminiの無料枠に達しました。時間をおいて再度お試しください。課金へ切り替えません。",
    AI_MODEL_UNAVAILABLE:
      "設定したAIモデルを利用できません。運営にモデル設定の確認を依頼してください。",
    AI_PROVIDER_REQUEST_REJECTED:
      "AIへの送信を受け付けてもらえませんでした。手動研究を利用するか、運営へお問い合わせください。",
    AI_DAILY_LIMIT: "今日のAI利用上限に達しました。手動研究を利用できます。",
    AI_BUSY: "AIが処理中です。少し待ってからお試しください。",
    AI_SENSITIVE_SOURCE:
      "連絡先や秘密情報と思われる内容を含むため、AIへ送信できません。",
    AI_SOURCES_CHANGED:
      "元知識が更新・取り下げされました。選び直してください。",
    AI_INVALID_CITATION:
      "AIの出典を確認できなかったため、分析を採用しませんでした。",
    SAVED_METRICS_NOT_READY:
      "保存数の集計準備中です。他の表示順を選んでください。",

    IDENTITY_REVIEW_REQUIRED:
      "Passportの紐付けを確認できないため、運営による確認が必要です。回答・報酬は保留になります。",
    SELF_ANSWER: "自分と同じPassportの募集には回答・採用できません。",
    ANSWER_PUBLICATION_CONSENT_REQUIRED:
      "回答を公開する前に、内容と公開範囲の確認にチェックしてください。",
    ANSWER_ALREADY_POSTED:
      "この回答からの経験知は作成済みです。作成済みの投稿を編集してください。",
    ARCHIVED_NOTE_RESTORE_REQUIRED:
      "保管したノートは復元してから編集できます。",
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
      signal: AbortSignal.timeout(
        ["/ai/analyze", "/admin/semantic-index"].includes(path) ? 75000 : 20000,
      ),
    });
    if (path === "/config" && r.status === 404)
      return { enabled: false, reason: "LAUNCH_HOLD", aiAvailable: false };
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(data.error || "SERVICE_UNAVAILABLE"), {
        status: r.status,
        retryAfterMs: Number(data.retryAfterMs) || 0,
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
        (e.message === "RATE_LIMITED" && e.retryAfterMs
          ? `操作が続いています。${Math.ceil(e.retryAfterMs / 1000)}秒ほど待ってから、もう一度お試しください。`
          : messages[e.message]) ||
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
      .filter((axis) => axis !== "job" || (value.job || []).length > 0)
      .map((axis) => {
        const terms = state.terms.filter(
          (t) =>
            t.axis === axis &&
            ((t.active && !t.mergedInto) || (value[axis] || []).includes(t.id)),
        );
        if (!terms.length) return "";
        return `<fieldset class="facet-group" data-axis="${axis}" id="${target.slice(1)}-${axis}"><legend>${axes[axis]}（複数可）</legend><div class="facet-options">${terms.map((t) => `<label><input type="checkbox" value="${esc(t.id)}" ${(value[axis] || []).includes(t.id) ? "checked" : ""}><span>${esc(t.label)}${t.active ? "" : "（既存の分類）"}</span></label>`).join("")}</div><p class="facet-selection" aria-live="polite"></p></fieldset>`;
      })
      .join("");
    $(target)
      .querySelectorAll(".facet-group")
      .forEach((group) => {
        group.addEventListener("change", () => facetSelection(group));
        facetSelection(group);
      });
  }
  function facetSelection(group) {
    const selected = [...group.querySelectorAll("input:checked")];
    group.querySelector(".facet-selection").textContent = selected.length
      ? `${selected.length}件選択：${selected.map((input) => input.closest("label").textContent.trim()).join("、")}`
      : "未選択";
  }
  function facetValue(target) {
    const value = {};
    $(target)
      .querySelectorAll("[data-axis]")
      .forEach(
        (el) =>
          (value[el.dataset.axis] = [
            ...el.querySelectorAll("input:checked"),
          ].map((input) => input.value)),
      );
    return value;
  }
  document.addEventListener("reset", (event) => {
    // Native form reset restores checked defaults after the reset event.
    setTimeout(
      () =>
        event.target.querySelectorAll(".facet-group").forEach(facetSelection),
      0,
    );
  });
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
  function verificationLabel(p) {
    const lab = p.knowledgeLab || {},
      proof = lab.thirdPartyConfirmation;
    if (proof && proof.confirmedRevision === lab.revision)
      return "一部事項を運営が確認（記録あり）";
    return (
      {
        "tested-by-author": "投稿者の結果報告（自己申告）",
        "in-progress": "実践中（自己申告）",
        "needs-update": "情報更新が必要",
      }[lab.verification] || "未検証"
    );
  }
  function card(p, choose = false) {
    return `<article class="card"><div>${p.knowledgeLab?.featured ? '<span class="badge">運営の注目知識</span>' : ""}${badges(p)}<span class="badge">${esc(verificationLabel(p))}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.body).slice(0, 160)}${p.body?.length > 160 ? "…" : ""}</p>${p.searchEvidence?.method === "meaning" ? `<p class="hint">意味の近さ ${esc(p.searchEvidence.similarity)}（モデル ${esc(p.searchEvidence.model)}）。本文「${esc(p.searchEvidence.excerpt)}」を参照。事実や信頼性の点数ではありません。</p>` : ""}<small>${esc(p.displayName)}・更新 ${date(p.updatedAt)}${p.knowledgeLab?.quality ? "・" + esc(p.knowledgeLab.quality) : ""}</small>${p.updatedAt && Date.now() - p.updatedAt > 365 * 86400000 ? '<p class="hint">最終更新から1年以上経っています。現在の制度・状況と照らして確認してください。</p>' : ""}<div class="actions"><button type="button" data-post="${esc(p.id)}">知識を読む</button><button type="button" data-source="${esc(p.id)}">${state.selected.has(p.id) ? "研究に選択済み" : "研究に使う"}</button>${p.editable && p.visibility !== "archived" ? `<button type="button" data-edit="${esc(p.id)}">編集</button>` : ""}</div></article>`;
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
    params.set("mode", $("#searchMode").value);
    params.set(
      "sort",
      $("#searchMode").value === "semantic" ? "relevance" : $("#sort").value,
    );
    for (const key of [
      "keywordOp",
      "match",
      "facetOp",
      "withinAxis",
      "exclude",
    ])
      if ($("#" + key).value) params.set(key, $("#" + key).value);
    for (const [axis, values] of Object.entries(facetValue("#searchFacets")))
      if (values.length) params.set(axis, values.join(","));
    for (const [axis, values] of Object.entries(facetValue("#excludeFacets")))
      if (values.length) params.set("exclude_" + axis, values.join(","));
    return params;
  }
  function sharedURL() {
    const u = new URL("/knowledge-lab.html", location.origin);
    u.search = conditions().toString();
    return u;
  }
  async function search(more = false) {
    const p = conditions();
    if (p.get("mode") === "semantic") {
      if (!$("#semanticConsent").checked) {
        status(
          "検索文をGeminiへ送ることを確認し、確認欄を選んでから検索してください。",
        );
        return;
      }
      p.set("externalAIConsent", "true");
    }
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
    const p = await api("/posts/" + postId + "?intent=view", {
        optional: true,
      }),
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
        )}<p class="hint">医療・法律・金融などの内容は個人の経験であり、専門的な助言や結果を保証するものではありません。出典の有無と正しさの検証は別です。</p>${lab.sourceAnswer ? `<p class="hint">元募集 ${esc(lab.sourceAnswer.requestId)}・元回答 ${esc(lab.sourceAnswer.answerId)}</p><button type="button" id="answerSource">元の募集・回答を見る</button>` : ""}<div class="actions"><button type="button" id="saveKnowledge">マイライブラリーに保存</button><button type="button" id="unsaveKnowledge">保存を外す</button><button type="button" id="useKnowledge">研究に使う</button>${p.editable ? '<button type="button" id="editKnowledge">編集</button><button type="button" id="withdrawKnowledge">公開を取り下げる</button><button type="button" id="archiveKnowledge">削除して非公開で保管</button><button type="button" id="restoreKnowledge" hidden>下書きに復元</button><button type="button" id="postHistory">編集履歴</button>' : ""}${p.authorSchoolParkId ? '<button type="button" id="openWriter">書き手を見る</button>' : ""}<button type="button" id="goodKnowledge">役に立った</button><button type="button" id="changeKnowledge">改善案を届ける</button><button type="button" id="proposeKnowledge">議題にする</button><button type="button" id="discussKnowledge">議論へ</button></div><div class="report-controls"><label for="reportReason">通報する理由</label><textarea id="reportReason" maxlength="1500"></textarea><button type="button" id="reportKnowledge">運営へ通報</button></div>`;
    $("#detailDialog").showModal();
    if (lab.thirdPartyConfirmation) {
      const proof = lab.thirdPartyConfirmation;
      $("#detailBody").insertAdjacentHTML(
        "beforeend",
        `<p class="notice">第三者が確認した範囲：${esc(proof.summary)}・${date(proof.atMs)}・確認者 ${esc(proof.reviewerSchoolParkId)}。内容全体の正しさや専門資格を保証するものではありません。</p>`,
      );
    }
    if (p.editable || state.me?.owner) {
      $("#detailBody").insertAdjacentHTML(
        "beforeend",
        '<button type="button" id="verificationHistory">確認の履歴（本人・運営のみ）</button><div id="verificationRecords"></div>',
      );
      bindAsync($("#verificationHistory"), async () => {
        const data = await api("/posts/" + p.id + "/verification", {
          auth: true,
        });
        $("#verificationRecords").innerHTML =
          data.items
            .map(
              (v) =>
                `<details><summary>${date(v.atMs)}・版 ${v.confirmedRevision}・確認者 ${esc(v.reviewerSchoolParkId)}</summary><p>${esc(v.summary)}</p><p class="body">${esc(v.evidence)}</p></details>`,
            )
            .join("") || "<p>確認記録はありません。</p>";
      });
    }
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
      if ($("#answerSource"))
        bindAsync($("#answerSource"), () =>
          showAnswers(lab.sourceAnswer.requestId),
        );
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
    state.originResearch = null;
    $("#researchOrigin").hidden = true;
    $("#postForm").reset();
    state.originAnswer = p?.knowledgeLab?.sourceAnswer || null;
    $("#answerOrigin").hidden = !state.originAnswer;
    $("#answerOriginText").textContent = state.originAnswer
      ? "元の募集・回答への参照を保持します。内容と公開範囲を確認してください。"
      : "";
    $("#editorTitle").textContent = p ? "経験知を編集する" : "経験知を届ける";
    $("#postTitle").value = p?.title || "";
    $("#postBody").value = p?.body || "";
    $("#postTags").value = Array.isArray(p?.tags)
      ? p.tags.join(",")
      : p?.tags || "";
    $("#postVisibility").value = p?.visibility || "draft";
    const lab = p?.knowledgeLab || {};
    $("#postAIConsent").checked = lab.aiUseConsent?.allowed === true;
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
    facetUI("#postFacets", lab.facets || p?.facets || {});
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
          ...(state.originResearch
            ? {
                sourceNoteId: state.originResearch.id,
                researchPublicationConsent: $("#researchPublicationConsent")
                  .checked,
              }
            : {}),
          ...(state.originAnswer
            ? {
                answerId: state.originAnswer.answerId,
                answerPublicationConsent: $("#answerPublicationConsent")
                  .checked,
              }
            : {}),
          facets: facetValue("#postFacets"),
          visibility: $("#postVisibility").value,
          aiUseConsent: $("#postAIConsent").checked,
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
  const aiLabels = {
    summaries: "各経験知の要点",
    commonalities: "共通点",
    differences: "相違点",
    connections: "意外なつながり",
    applications: "応用",
    questions: "新しい問い",
    hypotheses: "仮説（未検証）",
    practice: "小さく試す実践案",
    verification: "確かめる方法",
    cautions: "注意点",
    unknowns: "不明な点",
  };
  function renderAI(run) {
    const references = (run.sources || run.aiSources || [])
      .map(
        (s) =>
          `<p><a href="/knowledge-lab.html?post=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">${esc(s.title)}</a>／${esc(s.displayName)}／参照 ${date(s.atMs)}・参照時は公開${s.truncated ? `・本文の先頭${s.inputCharacters}文字を分析（全${s.totalCharacters}文字）` : ""}</p>`,
      )
      .join("");
    return (
      `<h3>AIによる仮説・未検証</h3><p>モデル ${esc(run.model || run.aiModel)}。内容と出典を確認し、人が編集・検証してください。</p>${references}` +
      Object.entries(run.analysis || run.aiAnalysis || {})
        .map(
          ([key, claims]) =>
            `<h4>${esc(aiLabels[key] || key)}</h4>${claims.length ? claims.map((c) => `<p>${esc(c.text)}</p>${c.citations.map((q) => `<blockquote>${esc(q.quote)}<br><a href="/knowledge-lab.html?post=${encodeURIComponent(q.sourceId)}" target="_blank" rel="noopener">元の知識を読む</a></blockquote>`).join("")}`).join("") : "<p>根拠不足・提案なし</p>"}`,
        )
        .join("")
    );
  }
  function renderAIStatus(s) {
    state.aiStatus = s;
    $("#aiAvailability").textContent = s.available
      ? "実際の公開知識をGeminiで分析します。結果は未検証の仮説です。"
      : "AIは現在停止しています。手動の比較・研究ノートは利用できます。";
    $("#analyzeSources").disabled = !s.available;
    $("#reanalyzeSources").disabled = !s.available;
    $('#searchMode option[value="semantic"]').disabled = !s.semanticAvailable;
    $("#aiAdminStatus").textContent =
      `キー・無料枠確認：${s.configured ? "設定あり" : "未設定"}／Renderスイッチ：${s.environmentEnabled ? "有効" : "停止"}／運営停止：${s.stopped ? "停止" : "解除"}／モデル：${s.model || "未選択"}`;
  }
  async function refreshAI() {
    renderAIStatus(await api("/ai/status"));
  }
  let aiAdminBusy = false;
  function aiSettingsFeedback(message, error = false) {
    const el = $("#aiSettingsFeedback");
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("error", error);
  }
  async function aiAdminAction(pending, action) {
    if (aiAdminBusy) return;
    aiAdminBusy = true;
    const buttons = [
      $("#aiLoadModels"),
      $("#aiSettingsForm button[type=submit]"),
      $("#aiStop"),
    ];
    buttons.forEach((b) => {
      b.disabled = true;
    });
    $("#aiSettingsForm").setAttribute("aria-busy", "true");
    aiSettingsFeedback(pending);
    try {
      await action();
    } catch (e) {
      aiSettingsFeedback(
        messages[e.message] || messages.SERVICE_UNAVAILABLE,
        true,
      );
      throw e;
    } finally {
      aiAdminBusy = false;
      buttons.forEach((b) => {
        b.disabled = false;
      });
      $("#aiSettingsForm").setAttribute("aria-busy", "false");
    }
  }
  bindAsync($("#aiOpenResearch"), async () => {
    await view("research");
    $("#research").scrollIntoView({ block: "start" });
  });
  async function analyzeSources(forceRefresh = false) {
    const b = $("#analyzeSources");
    b.disabled = true;
    try {
      const run = await api("/ai/analyze", {
        method: "POST",
        auth: true,
        body: {
          fields: selectedFields(),
          sourceIds: [...state.selected.keys()],
          externalAIConsent: $("#aiRequestConsent").checked,
          ...(forceRefresh
            ? {
                forceRefresh: true,
                key: keyFor("ai-refresh", { at: Date.now() }),
              }
            : {}),
        },
      });
      state.aiRun = run;
      state.selected.clear();
      for (const source of run.sources)
        state.selected.set(source.id, { id: source.id, title: source.title });
      selected();
      $("#detachAI").hidden = false;
      $("#aiResult").hidden = false;
      $("#aiResult").innerHTML = renderAI(run);
      const asText = (k) =>
        (run.analysis[k] || []).map((c) => c.text).join("\n");
      if (!$("#noteTitle").value)
        $("#noteTitle").value = names(selectedFields()) + "の掛け合わせ";
      $("#noteQuestion").value = asText("questions").slice(0, 2000);
      $("#noteHypothesis").value = asText("hypotheses").slice(0, 3000);
      $("#notePlan").value = [
        asText("practice"),
        asText("verification"),
        asText("cautions"),
      ]
        .join("\n\n")
        .slice(0, 3000);
      status(
        "分析を表示しました。内容と出典を確認してから、研究ノートとして保存できます。",
      );
    } finally {
      await refreshAI();
    }
  }
  bindAsync($("#analyzeSources"), () => analyzeSources());
  bindAsync($("#reanalyzeSources"), () => analyzeSources(true));
  bindAsync($("#aiLoadModels"), () =>
    aiAdminAction("モデル一覧を取得しています…", async () => {
      const models = await api("/admin/ai/models", { auth: true });
      $("#aiModel").innerHTML =
        '<option value="">選択してください</option>' +
        models
          .filter((m) => m.methods.includes("generateContent"))
          .map((m) => `<option value="${esc(m.id)}">${esc(m.id)}</option>`)
          .join("");
      $("#aiEmbeddingModel").innerHTML =
        '<option value="">停止する</option>' +
        models
          .filter(
            (m) =>
              m.id === "gemini-embedding-001" &&
              m.methods.includes("embedContent"),
          )
          .map((m) => `<option value="${esc(m.id)}">${esc(m.id)}</option>`)
          .join("");
      const previous = state.aiStatus;
      if ([...$("#aiModel").options].some((o) => o.value === previous?.model))
        $("#aiModel").value = previous.model;
      if (
        [...$("#aiEmbeddingModel").options].some(
          (o) => o.value === previous?.embeddingModel,
        )
      )
        $("#aiEmbeddingModel").value = previous.embeddingModel;
      aiSettingsFeedback(
        "モデル一覧を取得しました。モデルと無料枠を確認して保存してください。",
      );
    }),
  );
  $("#aiSettingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(() =>
      aiAdminAction("設定を保存しています…", async () => {
        const saved = await api("/admin/ai", {
          method: "PUT",
          auth: true,
          body: {
            model: $("#aiModel").value,
            embeddingModel: $("#aiEmbeddingModel").value,
            freeTierAttested: $("#aiFreeConfirmed").checked,
          },
        });
        renderAIStatus(saved);
        aiSettingsFeedback(
          `保存しました。分析：${saved.available ? "有効" : "停止中"}／意味検索：${saved.semanticAvailable ? "有効" : "停止中"}。分析は掛け合わせ研究所から始められます。`,
        );
        $("#aiOpenResearch").hidden = !saved.available;
      }),
    );
  });
  bindAsync($("#aiStop"), () =>
    aiAdminAction("AIの停止を保存しています…", async () => {
      const saved = await api("/admin/ai", {
        method: "PUT",
        auth: true,
        body: { stopped: true },
      });
      renderAIStatus(saved);
      aiSettingsFeedback("AIと意味検索を停止しました。設定は保存済みです。");
      $("#aiOpenResearch").hidden = true;
    }),
  );
  $("#noteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const fields = selectedFields();
      const payload = {
        ...(state.note
          ? { id: state.note.id, revision: state.note.revision }
          : {}),
        title: $("#noteTitle").value,
        aiRunId: state.aiRun?.id || null,
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
    state.aiRun = null;
    $("#detachAI").hidden = true;
    $("#aiResult").hidden = true;
    $("#noteForm").reset();
    state.selected.clear();
    selected();
    $("#comparison").hidden = true;
    status("新しい研究ノートを始めます。");
  };
  $("#detachAI").onclick = () => {
    state.aiRun = null;
    $("#detachAI").hidden = true;
    $("#aiResult").hidden = true;
    status(
      "手動の研究として続けます。これまで保存したAIの出典と分析は更新履歴に残ります。元知識を確認して選び直してください。",
    );
  };
  function noteCard(n) {
    return `<article class="card"><span class="badge">${n.result ? "投稿者による実践結果" : "未検証の仮説"}・${n.aiRunId ? "AIによる仮説・人が編集" : "手動で記入"}</span><h3>${esc(n.title)}</h3><p>${esc(n.question || n.hypothesis).slice(0, 150)}</p><small>更新 ${date(n.updatedAtMs)}</small><div class="actions"><button type="button" data-note="${esc(n.id)}">研究を読む・続ける</button></div></article>`;
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
      `<h2 id="detailTitle">${esc(n.title)}</h2><p>${esc(names(n.fields))}・更新 ${date(n.updatedAtMs)}・版 ${n.revision}</p>${n.archived ? '<p class="notice">保管済み・他の人には表示されません。復元すると自分用のノートとして編集できます。</p>' : ""}<span class="badge">${n.aiRunId ? "AIの仮説を人が編集した" : "手動で記入した"}${n.result ? "実践の記録（自己申告）" : "未検証の仮説"}</span>${[
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
        )}<h3>元になった知識</h3>${n.sourceIds.map((id) => `<p><button type="button" data-post="${esc(id)}">元知識 ${esc(id)} を読む</button></p>`).join("")}<div class="actions">${state.me?.schoolParkId === n.authorSchoolParkId && !n.archived ? '<button type="button" id="continueNote">結果を追記・編集</button><button type="button" id="archiveNote">ノートを非公開で保管</button><button type="button" id="publishExperience">試した結果を経験知として書く</button>' : ""}${n.archived && state.me?.schoolParkId === n.authorSchoolParkId ? '<button type="button" id="restoreNote">自分用に復元</button>' : ""}${state.me?.schoolParkId === n.authorSchoolParkId || state.me?.owner ? '<button type="button" id="noteHistory">更新履歴</button>' : ""}<button type="button" id="discussNote" ${n.archived ? "disabled" : ""}>既存の議論へ</button><button type="button" id="practiceNote" ${n.archived ? "disabled" : ""}>Quest・Guildで実践する</button></div><div class="report-controls"><label for="noteReport">通報理由</label><textarea id="noteReport" maxlength="1500"></textarea><button type="button" id="reportNote">運営へ通報</button></div>`;
    if (n.aiAnalysis)
      $("#detailBody").insertAdjacentHTML("beforeend", renderAI(n));
    $("#detailBody").insertAdjacentHTML(
      "beforeend",
      '<h3>この研究から生まれた知識</h3><div id="derivedKnowledge"></div>',
    );
    const derived = await api("/notes/" + n.id + "/derived", {
      optional: true,
    });
    $("#derivedKnowledge").innerHTML =
      derived.items.map((p) => card(p)).join("") ||
      "<p>まだ派生した公開知識はありません。</p>";
    bindCards("#derivedKnowledge", derived.items);
    $("#detailDialog").showModal();
    $("#detailBody")
      .querySelectorAll("[data-post]")
      .forEach(
        (b) =>
          !b.closest("#derivedKnowledge") &&
          bindAsync(b, async () => {
            $("#detailDialog").close();
            await detail(b.dataset.post);
          }),
      );
    if ($("#restoreNote"))
      bindAsync($("#restoreNote"), async () => {
        await api("/notes/" + n.id + "/restore", {
          method: "POST",
          auth: true,
          body: { revision: n.revision },
        });
        state.loadedViews.mine = 0;
        await showNote(n.id);
        status("自分用に復元しました。公開範囲は自分で選び直せます。");
      });
    if ($("#noteHistory"))
      bindAsync($("#noteHistory"), () => showNoteHistory(n.id));
    if ($("#continueNote")) {
      bindAsync($("#continueNote"), async () => {
        state.note = n;
        state.aiRun = n.aiRunId ? { id: n.aiRunId } : null;
        $("#detachAI").hidden = !state.aiRun;
        $("#aiResult").hidden = !n.aiAnalysis;
        $("#aiResult").innerHTML = n.aiAnalysis ? renderAI(n) : "";
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
        state.loadedViews.mine = 0;
        if (state.view === "mine") await loadMine();
        status("研究を非公開で保管しました。");
      });
      $("#publishExperience").onclick = () => {
        $("#detailDialog").close();
        edit();
        state.originResearch = n;
        $("#researchOrigin").hidden = false;
        $("#postTitle").value = n.title;
        $("#postBody").value = [
          n.result,
          n.plan,
          n.visibility === "public"
            ? "元の研究: " +
              new URL("/knowledge-lab.html?note=" + n.id, location.origin)
            : "",
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
  async function showNoteHistory(noteId, cursor = null) {
    const data = await api(
      "/notes/" +
        noteId +
        "/history" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      { auth: true },
    );
    function version(v) {
      return (
        `<p>版 ${v.revision}・${esc(v.visibility)}${v.archived ? "・保管済み" : ""}</p>` +
        ["title", "question", "hypothesis", "plan", "result"]
          .map(
            (k) =>
              `<p class="body"><b>${esc({ title: "題名", question: "問い", hypothesis: "仮説", plan: "実践案", result: "結果" }[k])}</b>：${esc(v[k] || "未記入")}</p>`,
          )
          .join("") +
        (v.aiAnalysis
          ? `<details><summary>AIの生成時の記録・出典（未検証）</summary>${renderAI(v)}</details>`
          : "")
      );
    }
    const rows = data.items
      .map(
        (h) =>
          `<article class="card"><h3>更新 ${date(h.changedAtMs)}・更新者 ${esc(h.actorSchoolParkId || "以前の記録：更新者未記録")}</h3><details><summary>変更前</summary>${version(h.previous)}</details>${h.next ? `<details><summary>変更後</summary>${version(h.next)}</details>` : ""}</article>`,
      )
      .join("");
    if (!cursor)
      $("#detailBody").innerHTML =
        `<h2 id="detailTitle">研究ノートの更新履歴</h2><p>本人と運営だけが確認できます。以前の非公開内容を他の人には表示しません。</p><button type="button" id="historyBack">ノートへ戻る</button><details><summary>現在の版</summary>${version(data.current)}</details><div id="historyRows"></div><button type="button" id="historyMore">以前の記録をさらに確認</button>`;
    $("#historyRows").insertAdjacentHTML(
      "beforeend",
      rows || "<p>更新履歴はまだありません。</p>",
    );
    $("#historyBack").onclick = () => run(() => showNote(noteId));
    $("#historyMore").hidden = !data.next;
    $("#historyMore").onclick = () =>
      run(() => showNoteHistory(noteId, data.next));
  }
  async function showAnswers(requestId, cursor = null) {
    const data = await api(
      "/requests/" +
        requestId +
        "/answers" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      { auth: true },
    );
    if (!cursor)
      $("#detailBody").innerHTML =
        '<h2 id="detailTitle">回答から知識を届ける</h2><p>あなた自身の回答を確認し、経験知フォームへ引き継げます。回答だけで自動公開されることはありません。</p><div id="answerRows"></div><button type="button" id="answerMore">さらに表示</button>';
    $("#answerRows").insertAdjacentHTML(
      "beforeend",
      data.items
        .map(
          (a) =>
            `<article class="card"><p class="body">${esc(a.experience)}</p><p class="body">${esc(a.knowledge)}</p><p class="body">${esc(a.limits)}</p>${a.canPublish ? `<button type="button" data-publish-answer="${esc(a.id)}">この回答を知識として届ける</button>` : "<p>公開への引き継ぎは回答者本人が行います。</p>"}</article>`,
        )
        .join("") || "<p>まだ回答がありません。</p>",
    );
    $("#answerMore").hidden = !data.next;
    $("#answerMore").onclick = () =>
      run(() => showAnswers(requestId, data.next));
    $("#answerRows")
      .querySelectorAll("[data-publish-answer]")
      .forEach((b) =>
        bindAsync(b, async () => {
          const d = await api(
            "/answers/" + b.dataset.publishAnswer + "/draft",
            { auth: true },
          );
          $("#detailDialog").close();
          if (d.existingPostId) {
            await detail(d.existingPostId);
            status(
              "この回答からの経験知は作成済みです。編集または復元して続けてください。",
            );
            return;
          }
          edit();
          state.originAnswer = { answerId: d.answerId, requestId: d.requestId };
          $("#answerOrigin").hidden = false;
          $("#answerOriginText").textContent =
            "元募集 " +
            d.requestId +
            "・元回答 " +
            d.answerId +
            "。内容と公開範囲を確認してください。";
          $("#postTitle").value = d.title;
          $("#postBody").value = d.body;
          $("#postHappened").value = d.happened;
          $("#postAdvice").value = d.advice;
          facetUI("#postFacets", d.facets);
        }),
      );
    if (!$("#detailDialog").open) $("#detailDialog").showModal();
  }
  async function reviewRewards(more = false) {
    const data = await api(
      "/admin/reward-review" +
        (more && state.cursors.rewardReview
          ? "?cursor=" + encodeURIComponent(state.cursors.rewardReview)
          : ""),
      { auth: true },
    );
    if (!more)
      $("#adminItems").innerHTML =
        "<p>読み取りのみ。既存報酬の削除・回収・送金は行いません。</p>";
    $("#adminItems").insertAdjacentHTML(
      "beforeend",
      data.items
        .map(
          (v) =>
            `<article class="card"><p>${esc(v.id)}・${esc(v.status)}</p><p>${esc(v.identityCheck)}</p><small>募集 ${esc(v.requestId || "記録なし")}／回答 ${esc(v.answerId || "記録なし")}</small></article>`,
        )
        .join("") || "<p>確認対象の報酬はありません。</p>",
    );
    state.cursors.rewardReview = data.next;
    $("#rewardReviewMore").hidden = !data.next;
    $("#adminMore").hidden = true;
  }
  bindAsync($("#reviewRewards"), () => reviewRewards());
  bindAsync($("#rewardReviewMore"), () => reviewRewards(true));
  let mineLoadSequence = 0;
  async function loadMine(more = false) {
    const sequence = ++mineLoadSequence;
    const kind = state.mineKind,
      isNote = ["notes", "archived-notes"].includes(kind);
    const params = new URLSearchParams();
    if (kind === "archived-notes") params.set("archived", "1");
    if (more && state.cursors.mine) params.set("cursor", state.cursors.mine);
    const data = await api(
      "/me/" + (isNote ? "notes" : kind) + (params.size ? "?" + params : ""),
      { auth: true },
    );
    // A slower response from the previous category must not replace the
    // category the reader has just selected (e.g. saved → public posts).
    if (sequence !== mineLoadSequence || kind !== state.mineKind) return;
    if (!more) $("#mineItems").innerHTML = "";
    $("#mineItems").insertAdjacentHTML(
      "beforeend",
      (isNote ? data.items.map(noteCard) : data.items.map((p) => card(p))).join(
        "",
      ) ||
        (!more
          ? '<p class="card empty">まだ記録はありません。保存・投稿・研究をここから続けられます。</p>'
          : ""),
    );
    if (isNote) bindNotes("#mineItems");
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
    facetUI("#writerFacets", w?.facets, [
      "field",
      "industry",
      "occupation",
      "job",
    ]);
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
      `<h2 id="detailTitle">${esc(w.displayName)}</h2><p class="body">${esc(w.bio)}</p><p>経験分野：${esc(names(w.facets?.field))}</p><p>業種：${esc(names(w.facets?.industry))}</p><p>職業：${esc(names(w.facets?.occupation))}</p>${w.facets?.job?.length ? `<p>以前の業種・職業分類：${esc(names(w.facets.job))}</p>` : ""}<p class="hint">経験・職歴・資格は自己申告です。認証済みの資格を示すものではありません。</p><p>SchoolPark ID：${esc(w.id)}</p><a href="/?lab=writer">Passport・星空へ（ログイン後）</a>`;
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
            `<article class="card"><span class="badge">${r.status === "open" ? "募集中" : "終了"}・回答 ${r.answerCount || 0}</span><h3>${esc(r.question)}</h3><p>${esc(r.context)}</p><p>${esc(r.targetExperience || "")}</p>${badges(r)}<div class="actions"><button type="button" data-answer="${esc(r.id)}">経験を届ける</button><button type="button" data-answers="${esc(r.id)}">届いた知識・採用を確認</button><button type="button" data-lab-answers="${esc(r.id)}">回答を知識として届ける</button></div></article>`,
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
    $("#requestItems")
      .querySelectorAll("[data-lab-answers]")
      .forEach((b) => bindAsync(b, () => showAnswers(b.dataset.labAnswers)));
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
      publicPosts: "公開投稿（visibility明記）",
      answers: "知識募集の回答",
      practiceResults: "結果を報告した研究",
    };
    $("#adminSummary").innerHTML = `<div class="metrics">${Object.entries(
      s.counts,
    )
      .map(([key, n]) => `<div><b>${n}</b>${esc(labels[key] || key)}</div>`)
      .join("")}</div><h3>分野別投稿数</h3><p>${Object.entries(s.fieldCounts)
      .map(([id, n]) => `${esc(names([id]))}: ${n}`)
      .join(
        "／",
      )}</p><h3>保存数の集計</h3><p>${esc(s.savedMetrics?.state || "未開始")}・${s.savedMetrics?.processed || 0}件確認済み</p><h3>検索索引</h3><p>${esc(s.index?.state || "未作成")}・${s.index?.processed || 0}件・最終確認 ${date(s.index?.finishedAtMs)}</p><p class="hint">索引上限20,000件・64MiB。通常の表示は20件単位。外部AIは無料プロジェクト確認・同意・運営スイッチが必要です。新しい報酬設定はありません。</p>`;
    const rate = (v) =>
      v?.denominator
        ? `${Math.round(v.rate * 100)}%（${v.numerator}/${v.denominator}）`
        : "データ未蓄積";
    const analytics = s.analytics;
    $("#adminSummary").insertAdjacentHTML(
      "beforeend",
      `<h3>利用と知識の循環（直近30日）</h3><p>検索 ${analytics?.totals.search || 0}回／0件率 ${rate(analytics?.zeroSearchRate)}／閲覧 ${analytics?.totals.view || 0}／保存操作 ${analytics?.totals.save || 0}／活動中の書き手 ${analytics?.activeWriters30 || 0}</p><p>登録→初投稿 ${rate(analytics?.registrationToFirstPost)}／投稿→閲覧 ${rate(analytics?.publicationToView)}／閲覧→研究 ${rate(analytics?.viewToResearch)}／研究→実践 ${rate(analytics?.researchToPractice)}／再投稿 ${rate(analytics?.repeatPosting)}／継続 ${rate(analytics?.writerRetention)}</p><p class="hint">${esc(analytics?.definition || "")}</p><h3>よく探される分野</h3><p>${
        Object.entries(analytics?.fields || {})
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => `${esc(names([id]))}：${n}回`)
          .join("／") || "データ未蓄積"
      }</p><h3>検索0件が発生した分野（閲覧可能範囲）</h3><p>${
        Object.entries(analytics?.zeroFields || {})
          .map(([id, n]) => `${esc(names([id]))}：${n}回`)
          .join("／") || "データ未蓄積"
      }</p><h3>意味検索の索引</h3><p>待機 ${s.semanticStats?.queued || 0}／登録済み ${s.semanticStats?.indexed || 0}／送信制限による保留 ${s.semanticStats?.rejected || 0}。自動更新は1分ごと、1回8件・1日最大15回（無料枠制限で翌日へ繰越）。</p><h3>AI使用量（最大31日分）</h3>${(s.aiUsage || []).map((d) => `<p>${esc(d.day)}：呼び出し${d.attempts || 0}回・成功${d.successes || 0}・エラー${d.errors || 0}・キャッシュ${d.cacheHits || 0}・取得済みトークン${d.totalTokens || 0}・入力文字${d.inputCharacters || 0}・トークン未報告の成功${d.unreportedTokens || 0}</p>`).join("") || "<p>実行記録はありません。</p>"}<p class="hint">無料プロジェクトであることの運営確認を前提に、アプリから有料契約を開始しません。埋め込みAPIがトークン数を返さない場合、その使用量は呼び出し回数・入力文字数で管理します。未取得のトークン数を実測0として扱いません。</p>`,
    );
    await refreshAI();
    renderTaxonomy();
  }
  let activityCursor = null;
  bindAsync($("#syncActivities"), async () => {
    const s = await api("/me/activity/reconcile", {
      method: "POST",
      auth: true,
      body: { cursor: activityCursor },
    });
    activityCursor = s.next;
    $("#activityStatus").textContent =
      `採用済みの改善案を${s.confirmed}件確認しました。確認保留${s.needsReview}件。${s.next ? "もう一度押すと続きを確認します。" : "星空の活動履歴で確認できます。"}`;
  });
  let semanticSeedCursor = null;
  bindAsync($("#semanticSeed"), async () => {
    const s = await api("/admin/semantic-seed", {
      method: "POST",
      auth: true,
      body: { cursor: semanticSeedCursor },
    });
    semanticSeedCursor = s.next;
    status(
      `今回の確認：同意済み${s.queued}件・対象外${s.skipped}件。${s.next ? "もう一度押すと次の25件を確認します。" : "全投稿の確認が完了しました。"}`,
    );
  });
  bindAsync($("#semanticIndex"), async () => {
    const s = await api("/admin/semantic-index", {
      method: "POST",
      auth: true,
      body: {},
    });
    status(
      `意味索引へ${s.processed}件登録しました。残り${s.remaining ?? "確認中"}件。無料枠上限に達したら停止します。`,
    );
  });
  bindAsync($("#adminRefresh"), adminSummary);
  bindAsync($("#adminSaveMetrics"), async () => {
    const feedback = $("#saveMetricsFeedback");
    feedback.hidden = false;
    feedback.classList.remove("error");
    feedback.textContent = "保存記録を集計しています…";
    try {
      const result = await api("/admin/save-metrics", {
        method: "POST",
        auth: true,
        body: {},
      });
      feedback.textContent =
        result.state === "ready"
          ? `保存数の集計が完了しました（${result.processed}件確認済み）。知識図書館で「保存数順」を利用できます。`
          : `保存記録を${result.processed}件確認しました。もう一度押すと続きから集計します。`;
      // The successful write remains visible even if the separate summary refresh fails.
      await adminSummary();
    } catch (e) {
      if (feedback.textContent === "保存記録を集計しています…") {
        feedback.classList.add("error");
        feedback.textContent =
          (messages[e.message] || messages.SERVICE_UNAVAILABLE) +
          " 保存済みの進捗から再開できます。";
      }
      throw e;
    }
  });
  bindAsync($("#adminInit"), async () => {
    await api("/admin/init", { method: "POST", auth: true, body: {} });
    state.terms = await api("/taxonomy");
    await refreshAI();
    renderFacets();
    await adminSummary();
    status("初期分類を登録しました。既存分類は上書きしていません。");
  });
  bindAsync($("#adminIndex"), async () => {
    if (
      !confirm(
        "公開投稿を25件ずつ読み、検索索引を更新します。Firestoreの読み書きが発生します。開始しますか？",
      )
    )
      return;
    await api("/admin/index", { method: "POST", auth: true, body: {} });
    status(
      "検索索引の作成を開始しました。活動状況を更新して結果を確認してください。",
    );
    await adminSummary();
  });
  $("#verifyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await api(
        "/admin/verify/" + encodeURIComponent($("#verifyPostId").value),
        {
          method: "POST",
          auth: true,
          body: {
            revision: Number($("#verifyRevision").value),
            summary: $("#verifySummary").value,
            evidence: $("#verifyEvidence").value,
            reviewed: $("#verifyReviewed").checked,
          },
        },
      );
      status(
        "実際の確認範囲と記録を保存しました。投稿全体の正しさの保証ではありません。",
      );
    });
  });
  let legacyPage = null,
    legacyCursor = null,
    legacyMapping = null;
  $("#legacyMigrationForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const mapping = {
        job: $("#legacyJob").value,
        industry: $("#legacyIndustry").value
          ? [$("#legacyIndustry").value]
          : [],
        occupation: $("#legacyOccupation").value
          ? [$("#legacyOccupation").value]
          : [],
      };
      if (JSON.stringify(mapping) !== JSON.stringify(legacyMapping))
        legacyCursor = null;
      legacyMapping = mapping;
      legacyPage = await api("/admin/taxonomy-migration/preview", {
        method: "POST",
        auth: true,
        body: { ...mapping, cursor: legacyCursor },
      });
      legacyCursor = legacyPage.next;
      $("#legacyPreview").innerHTML =
        `<p>今回${legacyPage.scanned}投稿を確認・該当${legacyPage.items.length}件。${legacyPage.next ? "もう一度確認すると次の25件へ進みます。" : "最後まで確認しました。"}</p>${legacyPage.items.map((p) => `<p>${esc(p.title)}（版${p.revision}）</p>`).join("")}`;
      $("#legacyApply").disabled = !legacyPage.items.length;
    });
  });
  bindAsync($("#legacyApply"), async () => {
    if (!legacyPage?.items.length) return;
    const result = await api("/admin/taxonomy-migration/apply", {
      method: "POST",
      auth: true,
      body: {
        ...legacyMapping,
        posts: legacyPage.items.map((p) => ({
          id: p.id,
          revision: p.revision,
        })),
        confirmed: true,
        reason: $("#legacyReason").value,
      },
    });
    $("#legacyApply").disabled = true;
    status(
      `分類を確認しました：${result.items.filter((i) => i.status === "applied").length}件追加。本文・以前の分類は保持しました。`,
    );
  });
  function renderTaxonomy() {
    for (const [selector, axis] of [
      ["#legacyJob", "job"],
      ["#legacyIndustry", "industry"],
      ["#legacyOccupation", "occupation"],
    ]) {
      $(selector).innerHTML =
        (axis === "job"
          ? '<option value="">選択してください</option>'
          : '<option value="">追加しない</option>') +
        state.terms
          .filter((t) => t.axis === axis && t.active && !t.mergedInto)
          .map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`)
          .join("");
    }
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
          $("#termAliases").value = (t.aliases || []).join(", ");
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
          aliases: $("#termAliases")
            .value.split(",")
            .map((x) => x.trim())
            .filter(Boolean),
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
  let adminListSequence = 0;
  async function adminList(more = false) {
    const sequence = ++adminListSequence;
    if (!more)
      $("#adminItems").innerHTML =
        '<p role="status">一覧を読み込んでいます。</p>';
    $("#rewardReviewMore").hidden = true;
    const kind = state.adminKind;
    let data;
    try {
      data = await api(
        "/admin/list/" +
          kind +
          (more && state.cursors.admin
            ? "?cursor=" + encodeURIComponent(state.cursors.admin)
            : ""),
        { auth: true },
      );
    } catch (e) {
      if (sequence === adminListSequence)
        $("#adminItems").innerHTML =
          '<p class="notice">一覧を取得できませんでした。表示された待ち時間の後に、項目を選び直してください。</p>';
      throw e;
    }
    if (sequence !== adminListSequence || kind !== state.adminKind) return;
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
    const excluded = {};
    for (const axis of Object.keys(axes))
      excluded[axis] = (params.get("exclude_" + axis) || "")
        .split(",")
        .filter(Boolean);
    facetUI("#excludeFacets", excluded);
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
    $("#searchMode").value =
      params.get("mode") === "semantic" ? "semantic" : "lexical";
    for (const key of [
      "keywordOp",
      "match",
      "facetOp",
      "withinAxis",
      "exclude",
    ])
      if (params.has(key)) $("#" + key).value = params.get(key);
    $("#sort").value = [
      "new",
      "relevance",
      "updated",
      "popular",
      "saved",
    ].includes(params.get("sort"))
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
    for (const selector of ["#searchFacets", "#excludeFacets"])
      $(selector)
        .querySelectorAll("input[type=checkbox]")
        .forEach((input) => (input.checked = false));
    for (const selector of ["#searchFacets", "#excludeFacets"])
      $(selector).querySelectorAll(".facet-group").forEach(facetSelection);
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
    await refreshAI();
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
