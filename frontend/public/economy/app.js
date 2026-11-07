(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    node = (tag, value) => {
      const el = document.createElement(tag);
      if (value != null) el.textContent = value;
      return el;
    };
  const parentApp = () => (window.parent !== window ? window.parent : window);
  let quote = null,
    requestId = null,
    identityKey = null,
    generation = 0,
    busy = false,
    progressTimer = null,
    progressBusy = false,
    searchProfile = null;
  const watchedJobs = new Map();
  const activeStates = new Set([
    "awaiting_payment",
    "queued",
    "running",
    "result_saved",
    "refund_pending",
  ]);
  const labels = {
    awaiting_payment: "決済確認待ち",
    queued: "支払い済み・実行待ち",
    running: "探索中",
    result_saved: "結果保存済み・引渡し確認中",
    completed: "完了",
    refund_pending: "返却待ち",
    refunded: "未受取EMUERへ返却済み",
    failed: "依頼を受付できませんでした",
    expired: "決済期限切れ",
  };
  const messages = {
    AUTH_REQUIRED: "ログインしてから開いてください。",
    PASSPORT_REQUIRED: "SchoolParkパスポートの連携を確認してください。",
    SERVICE_DISABLED:
      "提供条件の確認中のため、現在は依頼を受け付けていません。",
    SERVICE_NOT_ELIGIBLE:
      "「冷蔵庫くんに頼む」はPlus・Pro限定です。Free・Light（7日間のLight体験を含む）では利用できません。",
    AI_AUDIENCE_NOT_VERIFIED:
      "AI提供対象の確認が済んでいないため、依頼できません。",
    SENSITIVE_INPUT:
      "連絡先や個人を識別する情報を含めず、目的だけを入力してください。",
    AI_DAILY_LIMIT: "本日の利用枠に達しました。",
    AI_BUDGET_LIMIT: "本日のAI受付を停止しています。",
    AI_PROVIDER_DAY_LIMIT:
      "無料AI枠を保護するため、本日の「冷蔵庫くんに頼む」の受付は終了しました。",
    AI_ADMISSION_RATE_LIMIT:
      "依頼が続いています。1分ほど待って料金を確認し直してください。料金は請求していません。",
    INSUFFICIENT_EMUER: "支払いに使える未受取EMUERが不足しています。",
    CROSS_SEARCH_DISABLED:
      "横断探索を停止しています。料金確認からやり直してください。",
    PRIVATE_CONTEXT_UNAVAILABLE:
      "本人情報の参照は現在利用できません。チェックを外して料金を確認してください。",
    SEARCH_SOURCES_UNAVAILABLE:
      "検索元を確認できないため、処理を提供できませんでした。支払い済みの場合は返却状態を確認してください。",
    QUOTE_EXPIRED_OR_CHANGED:
      "料金確認の期限が切れたか、条件が変わりました。もう一度確認してください。",
  };
  const notice = (v) => {
    $("notice").textContent = v;
  };
  function user() {
    return parentApp().auth?.currentUser?.uid || null;
  }
  function clearApproval() {
    quote = null;
    requestId = null;
    $("approval").hidden = true;
    $("paymentConsent").checked = false;
    $("aiConsent").checked = false;
  }
  function reset() {
    generation++;
    clearTimeout(progressTimer);
    progressTimer = null;
    watchedJobs.clear();
    identityKey = user();
    searchProfile = null;
    $("crossOptions").hidden = true;
    $("balanceConsent").checked = false;
    $("achievementsConsent").checked = false;
    $("contextPreview").textContent = "";
    clearApproval();
    $("history").replaceChildren();
    $("operations").hidden = true;
    $("operationsStatus").textContent = "";
    $("goal").value = "";
    for (const id of ["spendable", "wallet", "pending", "held", "processing"])
      $(id).textContent = "—";
    $("quoteButton").disabled = true;
  }
  function syncIdentity() {
    if (user() === identityKey) return;
    reset();
    // An old response can arrive before the periodic identity check. Reload the
    // new account once, rather than leaving it with cleared balances forever.
    queueMicrotask(refresh);
  }
  async function api(path, body) {
    const app = parentApp(),
      before = user();
    if (!before || typeof app.emuAuthHeaders !== "function")
      throw Error("AUTH_REQUIRED");
    const headers = new Headers(
      await app.emuAuthHeaders(true, { interactive: false }),
    );
    headers.set("Content-Type", "application/json");
    if (user() !== before) {
      syncIdentity();
      throw Error("AUTH_REQUIRED");
    }
    const r = await fetch("/api/economy" + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const d = await r.json();
    if (user() !== before) {
      syncIdentity();
      throw Error("AUTH_REQUIRED");
    }
    if (!r.ok) throw Error(d.error || "ECONOMY_UNAVAILABLE");
    return d;
  }
  function openTarget(target) {
    if (!window.ReizoRequestTargets?.allowed(target)) return;
    const app = parentApp();
    if (target.startsWith("/?lab=")) {
      const url = new URL(target, location.origin);
      app.openEmuKnowledgeLab?.(url.searchParams.get("lab"), {
        post: url.searchParams.get("labPost"),
        note: url.searchParams.get("labNote"),
      });
    } else if (target.startsWith("/?view=")) {
      const view = new URL(target, location.origin).searchParams.get("view");
      if (app.EmuNavigation?.go) {
        app.closeSpRoom?.();
        app.EmuNavigation.go(view);
      } else location.assign(target);
    } else if (app !== window && app.openSpRoom)
      app.openSpRoom(target, "Emu for SchoolPark");
    else location.assign(target);
  }
  const domainNames = {
    knowledge_lab: "Knowledge Lab",
    knowledge_text: "Knowledge Text",
    guild: "ギルド",
    quest: "クエスト",
    city: "City",
    emuer: "EMUER",
    passport: "Passport・星空",
    activities: "遊び・体験",
    service: "使い方・プラン",
  };
  function paintService(service) {
    const next = service.searchProfile || null;
    if (
      quote &&
      (quote.searchProfile?.fingerprint || null) !== (next?.fingerprint || null)
    )
      clearApproval();
    searchProfile = next;
    $("crossOptions").hidden = !searchProfile;
    $("balanceOption").hidden = !searchProfile?.balanceAvailable;
    $("achievementsOption").hidden = !searchProfile?.achievementsAvailable;
    if (!searchProfile?.balanceAvailable) $("balanceConsent").checked = false;
    if (!searchProfile?.achievementsAvailable)
      $("achievementsConsent").checked = false;
    if (searchProfile) {
      $("workScope").textContent =
        "目的に関連する公開資料を複数の機能から探し、比較と次の行動を提案します。利用できなかった領域も結果に表示します。";
      $("workTypes").replaceChildren(
        node(
          "li",
          "検索を試す領域：" +
            searchProfile.domains
              .map((d) => domainNames[d] || "確認中")
              .join("・"),
        ),
        node("li", "閲覧権限・AI利用許諾を確認できた資料だけを使います。"),
      );
      $("aiConsentText").textContent =
        "目的から抽出した定義済みのテーマ・種類と、許諾済みの公開資料をGoogle Geminiへ送信することに同意します。入力原文・残高・本人実績は送りません。";
    } else {
      $("workScope").textContent =
        "初期運用では、公式5ギルドの名称と短い説明から、あなたの目的に関連する活動を探します。";
      $("workTypes").replaceChildren(
        node("li", "LEARN・WORK・PLAY・CONNECT・WEB3の公式ギルドを探す"),
        node("li", "公式の説明を比較し、活動紹介の画面へ案内する"),
      );
      $("aiConsentText").textContent =
        "目的の種類と対象の公開資料をGoogle Geminiへ送信することに同意します。";
    }
  }
  async function publicStatus() {
    try {
      const r = await fetch("/api/economy/status", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok || d.schema !== "economy-release-v2")
        throw Error("STATUS_UNAVAILABLE");
      paintService(d.service);
      $("availability").textContent = d.service.enabled
        ? "受付状況はログイン後に確認できます。"
        : d.service.blockers?.includes("AI_PROVIDER_DAY_LIMIT")
          ? messages.AI_PROVIDER_DAY_LIMIT
          : "有料受付は停止中です。提供条件・予算・運用設定を確認しています。";
    } catch (_) {
      $("availability").textContent =
        "サービスは準備中です。提供状態を確認できるまで有料依頼はできません。";
    }
  }
  async function operations() {
    try {
      const d = await api("/admin/operations"),
        o = d.operations;
      $("operationsStatus").textContent = JSON.stringify(
        {
          worker: o.worker?.healthy ? "稼働確認済み" : "未確認・停止",
          lastSuccess: o.worker?.lastSuccessAtMs || null,
          tokenReservations: o.usage.reservedTokens || 0,
          reportedTokens: o.usage.observedTokens || 0,
          unknownCalls: o.usage.unknownCalls || 0,
          freeTier: o.freeTier,
          providerSafety: o.providerSafety,
          pending: o.pending,
          blockers: d.service.blockers,
        },
        null,
        2,
      );
    } catch (_) {
      $("operationsStatus").textContent = "運用状況を確認できません。";
    }
  }
  function sourceInfo(r) {
    const details = node("details");
    details.className = "source-info";
    details.append(
      node("summary", "出典情報"),
      node("small", r.kind + " / ID: " + r.id),
    );
    return details;
  }
  function answerNode(answer) {
    const content = node("div");
    if (answer.profileVersion) {
      const names = [
        ...new Set(
          (answer.results || [])
            .map((r) => domainNames[r.domain])
            .filter(Boolean),
        ),
      ];
      content.append(
        node(
          "p",
          "参照した領域：" +
            (names.join("・") || "今回利用できる参照情報はありません"),
        ),
        node("h3", "調べた情報・出典"),
      );
    }
    if (!answer.results?.length)
      content.append(
        node(
          "p",
          "目的に関連する公開情報は見つかりませんでした。架空の候補は追加していません。",
        ),
      );
    for (const r of answer.results || []) {
      const card = node("div");
      card.className = "source-card";
      card.append(
        node("h3", r.title),
        node("p", r.reason),
        node("blockquote", r.evidence),
        sourceInfo(r),
      );
      if (Number.isSafeInteger(r.facts?.priceEmuer))
        card.append(
          node(
            "p",
            "公開価格：" +
              r.facts.priceEmuer +
              " EMUER（利用条件・在庫・期限は移動先で再確認）",
          ),
        );
      if (r.updatedAtMs)
        card.append(
          node(
            "p",
            "資料の更新：" +
              new Date(r.updatedAtMs).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              }) +
              "（日本時間）",
          ),
        );
      const link = node("button", "内容を確認する →");
      link.type = "button";
      link.onclick = () => openTarget(r.target);
      card.append(link);
      content.append(card);
    }
    if (answer.comparisons?.length) {
      content.append(node("h3", "比較（AIの提案）"));
      for (const c of answer.comparisons)
        content.append(node("p", c.titles.join(" ／ ") + "：" + c.text));
    }
    if (answer.steps?.length) {
      content.append(node("h3", "次の行動（AIの提案）"));
      const list = node("ol");
      for (const step of answer.steps) {
        const item = node("li");
        item.append(node("strong", step.title), node("p", step.text));
        const link = node("button", "参照先を開く");
        link.type = "button";
        link.onclick = () => openTarget(step.target);
        item.append(link);
        list.append(item);
      }
      content.append(list);
      content.append(
        node(
          "p",
          "この順序は提案です。参加・投稿・購入などは、移動先で条件を確認して自分で判断してください。",
        ),
      );
    }
    if (answer.privateContext?.balance?.state === "ready")
      content.append(
        node(
          "p",
          "本人の許可に基づき、依頼料金支払い後の利用可能残高で商品候補を確認しました。残高はAIへ送信していません。",
        ),
      );
    const own = answer.privateContext?.achievements;
    if (own?.state === "ready")
      content.append(
        node(
          "p",
          "本人にだけ表示する確認結果：クエスト証明書の記録 " +
            own.questCertificateRecords +
            "件・星の記録 " +
            own.starRecords +
            "件。" +
            (own.truncated ? "先頭200件ずつまでの確認です。" : "") +
            "AIへは送信していません。公的本人確認や年齢の証明とは別です。",
        ),
      );
    if (answer.coverage || answer.limitations?.length) {
      const details = node("details");
      details.append(node("summary", "調べた領域・今回の制限"));
      const stateNames = {
        ready: "許諾済み資料を確認",
        disabled: "連携対象外・停止中",
        unavailable: "取得できませんでした",
        no_approved_data: "AI許諾済み資料なし",
        empty: "該当資料なし",
        not_requested: "今回の検索対象外",
      };
      for (const d of answer.coverage || [])
        details.append(
          node("p", d.label + "：" + (stateNames[d.state] || "未確認")),
        );
      for (const v of answer.limitations || []) details.append(node("p", v));
      content.append(details);
    }
    return content;
  }
  function renderJob(job) {
    const article = node("article");
    article.dataset.jobId = job.id;
    article.dataset.state = job.state;
    article.dataset.progress = job.progress || "";
    article.tabIndex = -1;
    article.append(
      node("b", labels[job.state] || "状態を確認中"),
      node(
        "p",
        new Date(job.createdAtMs).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        }) +
          "（日本時間）" +
          " · " +
          job.price +
          " EMUER",
      ),
    );
    if (job.payment)
      article.append(
        node(
          "p",
          job.payment.refunded
            ? "支払いを全額返却しました。"
            : "支払い：" +
                ({ paid: "確認済み", fulfilled: "提供完了" }[
                  job.payment.status
                ] || job.payment.status),
        ),
      );
    const stage = {
      collecting_public_sources:
        "公開範囲・AI許諾を確認しながら、関連する領域を探しています。",
      comparing_verified_sources:
        "確認できた資料を意味で比較し、出典付きの提案を組み立てています。",
    }[job.progress];
    if (stage && job.state === "running") article.append(node("p", stage));
    if (activeStates.has(job.state))
      article.append(
        node(
          "p",
          "状態は自動で確認します。このままお待ちください。再度依頼する必要はありません。",
        ),
      );
    if (job.state === "refund_pending")
      article.append(
        node(
          "p",
          "返却はまだ確定していません。処理の確認・再開を待っています。",
        ),
      );
    if (job.error && messages[job.error])
      article.append(node("p", messages[job.error]));
    if (job.hasResult && !job.result) {
      const show = node("button", "結果を見る");
      show.type = "button";
      show.onclick = async () => {
        show.disabled = true;
        try {
          const g = generation;
          const d = await api("/jobs/" + job.id);
          if (g !== generation) return;
          const result = answerNode(d.job.result || { results: [] });
          show.replaceWith(result);
        } catch (_) {
          show.disabled = false;
          notice(
            "結果を再確認できませんでした。公開範囲が変わった場合は表示されません。",
          );
        }
      };
      article.append(show);
    }
    if (job.result) article.append(answerNode(job.result));
    return article;
  }
  function showJob(job) {
    const old = Array.from($("history").children).find(
      (el) => el.dataset.jobId === job.id,
    );
    const article = renderJob(job);
    if (old) old.replaceWith(article);
    else $("history").prepend(article);
    return article;
  }
  function scheduleProgress() {
    if (!progressTimer && watchedJobs.size)
      progressTimer = setTimeout(checkProgress, 5000);
  }
  function watchJobs(jobs) {
    const active = jobs.filter((j) => activeStates.has(j.state));
    const ids = new Set(active.map((j) => j.id));
    for (const id of watchedJobs.keys())
      if (!ids.has(id)) watchedJobs.delete(id);
    for (const job of active)
      if (!watchedJobs.has(job.id))
        watchedJobs.set(job.id, Date.now() + 180000);
    scheduleProgress();
  }
  async function checkProgress() {
    progressTimer = null;
    for (const [id, until] of watchedJobs) {
      if (Date.now() > until) {
        watchedJobs.delete(id);
        if (!quote)
          notice(
            "状態確認に時間がかかっています。再依頼せず、履歴の「更新」で確認してください。",
          );
      }
    }
    if (!watchedJobs.size) return;
    if (progressBusy || busy || document.hidden) {
      scheduleProgress();
      return;
    }
    const g = generation;
    progressBusy = true;
    let terminal = false;
    try {
      for (const id of watchedJobs.keys()) {
        const d = await api("/jobs/" + id);
        if (g !== generation) return;
        const shown = Array.from($("history").children).find(
          (el) => el.dataset.jobId === id,
        );
        if (
          !shown ||
          shown.dataset.state !== d.job.state ||
          shown.dataset.progress !== (d.job.progress || "")
        )
          showJob(d.job);
        if (!activeStates.has(d.job.state)) {
          watchedJobs.delete(id);
          terminal = true;
          if (!quote)
            notice(
              d.job.state === "completed"
                ? "依頼が完了しました。結果を下に表示しています。"
                : labels[d.job.state] || "依頼の状態を更新しました。",
            );
        }
      }
      if (terminal) {
        const me = await api("/me");
        if (g !== generation) return;
        updateBalances(me);
      }
    } catch (_) {
      if (g === generation && !quote)
        notice("状態を再確認しています。追加の支払いは行いません。");
    } finally {
      progressBusy = false;
      scheduleProgress();
    }
  }
  function updateBalances(me) {
    for (const id of ["spendable", "wallet", "pending", "held", "processing"])
      $(id).textContent =
        me.balances[id] == null ? "未確認" : me.balances[id] + " EMUER";
  }
  async function refresh() {
    const g = generation;
    if (!user()) {
      await publicStatus();
      notice("ログインして残高・依頼履歴を確認してください。");
      return;
    }
    try {
      const [me, history] = await Promise.all([api("/me"), api("/jobs")]);
      if (g !== generation) return;
      updateBalances(me);
      paintService(me.service);
      $("availability").textContent = me.service.enabled
        ? "受付中です。料金と条件を確認してから依頼できます。"
        : me.service.blockers?.includes("AI_PROVIDER_DAY_LIMIT")
          ? messages.AI_PROVIDER_DAY_LIMIT
          : "提供準備中です。条件確認が完了するまで有料依頼は停止しています。";
      $("quoteButton").disabled =
        !me.service.enabled || me.eligibility?.eligible === false;
      if (me.service.enabled && me.eligibility?.eligible === false)
        $("availability").textContent =
          messages[me.eligibility.reason] ||
          "現在の提供条件では依頼できません。";
      $("operations").hidden = !me.isOwner;
      if (me.isOwner && $("operationsPanel").open) operations();
      $("history").replaceChildren();
      if (!history.jobs.length)
        $("history").textContent = "まだ依頼はありません。";
      for (const job of history.jobs) $("history").append(renderJob(job));
      watchJobs(history.jobs);
      notice("残高と履歴を更新しました。");
    } catch (e) {
      if (g === generation)
        notice(
          messages[e.message] ||
            "読み込めませんでした。時間をおいて更新してください。",
        );
    }
  }
  $("requestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const g = generation;
    clearApproval();
    try {
      const d = await api("/quotes", {
        goal: $("goal").value,
        balanceConsent: $("balanceConsent").checked,
        achievementsConsent: $("achievementsConsent").checked,
      });
      if (g !== generation) return;
      quote = d.quote;
      requestId = crypto.randomUUID();
      $("quoteTerms").textContent =
        quote.scope + " " + quote.refund + " " + quote.notice;
      $("approval").hidden = false;
      $("approval").scrollIntoView({ block: "nearest" });
    } catch (e) {
      notice(messages[e.message] || "料金を確認できませんでした。");
    } finally {
      busy = false;
    }
  });
  $("goal").addEventListener("input", clearApproval);
  for (const id of ["balanceConsent", "achievementsConsent"])
    $(id).addEventListener("change", () => {
      clearApproval();
      $("contextPreview").textContent = "";
    });
  $("requestExamples").addEventListener("click", (event) => {
    const example = event.target.closest("[data-example]");
    if (!example) return;
    $("goal").value = example.dataset.example;
    clearApproval();
    $("goal").focus();
  });
  $("inspectContext").addEventListener("click", async () => {
    if (!$("balanceConsent").checked && !$("achievementsConsent").checked) {
      $("contextPreview").textContent =
        "参照する本人情報をチェックしてください。";
      return;
    }
    const g = generation;
    try {
      const d = await api("/context", {
        balanceConsent: $("balanceConsent").checked,
        achievementsConsent: $("achievementsConsent").checked,
      });
      if (g !== generation) return;
      const parts = [];
      if (d.context.balance.state === "ready")
        parts.push("利用可能：" + d.context.balance.spendable + " EMUER");
      if (d.context.achievements.state === "ready")
        parts.push(
          "確認できた証明書の記録：" +
            d.context.achievements.questCertificateRecords +
            "件、星：" +
            d.context.achievements.starRecords +
            "件",
        );
      $("contextPreview").textContent =
        (parts.join("。") || "許可した情報を現在確認できません。") +
        " AIへは送信していません。";
    } catch (_) {
      if (g === generation)
        $("contextPreview").textContent = "本人情報を確認できませんでした。";
    }
  });
  $("cancel").addEventListener("click", clearApproval);
  $("pay").addEventListener("click", async () => {
    if (busy || !quote) return;
    if (!$("paymentConsent").checked || !$("aiConsent").checked) {
      notice("料金とAI送信の両方を確認してください。");
      return;
    }
    busy = true;
    $("pay").disabled = true;
    const g = generation;
    try {
      const d = await api("/jobs", {
        quoteId: quote.id,
        termsVersion: quote.termsVersion,
        requestId,
        paymentConsent: true,
        aiConsent: true,
        searchConsentVersion: quote.searchProfile?.version,
        balanceConsent: $("balanceConsent").checked,
        achievementsConsent: $("achievementsConsent").checked,
      });
      if (g !== generation) return;
      clearApproval();
      await refresh();
      const current = await api("/jobs/" + d.job.id);
      if (g !== generation) return;
      const article = showJob(current.job);
      if (activeStates.has(current.job.state)) {
        if (!watchedJobs.has(current.job.id))
          watchedJobs.set(current.job.id, Date.now() + 180000);
        scheduleProgress();
      } else watchedJobs.delete(current.job.id);
      notice(
        current.job.state === "completed"
          ? "依頼が完了しました。結果を下に表示しています。"
          : labels[current.job.state] || "受付状態を確認しました。",
      );
      article.scrollIntoView({ block: "start" });
      article.focus({ preventScroll: true });
    } catch (e) {
      if (
        [
          "SERVICE_NOT_ELIGIBLE",
          "AI_AUDIENCE_NOT_VERIFIED",
          "AUTH_REQUIRED",
        ].includes(e.message)
      ) {
        clearApproval();
        $("quoteButton").disabled = true;
      }
      notice(
        messages[e.message] ||
          "受付を確認できませんでした。同じ依頼の再送では二重に請求しません。履歴を更新してください。",
      );
    } finally {
      busy = false;
      $("pay").disabled = false;
    }
  });
  $("refresh").addEventListener("click", refresh);
  $("refreshOperations").addEventListener("click", operations);
  $("operationsPanel").addEventListener("toggle", () => {
    if ($("operationsPanel").open && !$("operations").hidden) operations();
  });
  $("simulate").addEventListener("click", async () => {
    try {
      const d = await api("/external/simulate", {
        chainId: 137,
        token: "EMUER",
        amount: "5",
      });
      $("simulation").textContent =
        d.simulation.reason === "TRANSFER_RESTRICTED"
          ? "模擬確認：移転制限を確認し、見積もり・署名・送金の前に停止しました。"
          : "接続に対応していません。";
    } catch (_) {
      $("simulation").textContent = "模擬確認を実行できませんでした。";
    }
  });
  $("city").addEventListener("click", () =>
    parentApp().openSpRoom?.(
      "/schoolpark/dao.html?screen=city&cityView=shops",
      "SchoolPark City",
    ),
  );
  $("back").addEventListener("click", () => {
    clearTimeout(progressTimer);
    progressTimer = null;
    watchedJobs.clear();
    const a = parentApp();
    if (a !== window && typeof a.closeSpRoom === "function") a.closeSpRoom();
    else location.assign("/");
  });
  reset();
  refresh();
  setInterval(() => {
    if (user() !== identityKey) {
      reset();
      refresh();
    }
  }, 1000);
  window.addEventListener("pagehide", () => {
    clearTimeout(progressTimer);
    progressTimer = null;
    watchedJobs.clear();
  });
  // Poll only active, owned jobs with GETs for up to 3 minutes. Never resubmit a
  // payment, reset the form/consents, or poll completed history indefinitely.
})();
