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
    busy = false;
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
    SERVICE_NOT_ELIGIBLE: "現在の利用条件では依頼できません。",
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
    identityKey = user();
    clearApproval();
    $("history").replaceChildren();
    $("operations").hidden = true;
    $("operationsStatus").textContent = "";
    $("goal").value = "";
    for (const id of ["spendable", "wallet", "pending", "held", "processing"])
      $(id).textContent = "—";
    $("quoteButton").disabled = true;
  }
  async function api(path, body) {
    const app = parentApp(),
      before = user();
    if (!before || typeof app.emuAuthHeaders !== "function")
      throw Error("AUTH_REQUIRED");
    const headers = await app.emuAuthHeaders(true, { interactive: false });
    if (user() !== before) throw Error("AUTH_REQUIRED");
    const r = await fetch("/api/economy" + path, {
      method: body ? "POST" : "GET",
      headers: { ...headers, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const d = await r.json();
    if (user() !== before) {
      reset();
      throw Error("AUTH_REQUIRED");
    }
    if (!r.ok) throw Error(d.error || "ECONOMY_UNAVAILABLE");
    return d;
  }
  function openTarget(target) {
    // No provider-generated URL is accepted. The server also derives all targets from source IDs.
    if (
      !/^\/(?:\?lab=library&labPost=[A-Za-z0-9_-]+|admin\/room1\/index\.html\?contentId=[A-Za-z0-9_-]+|schoolpark\/dao\.html\?screen=(?:experiments&explorer(?:Quest|Guild)=[A-Za-z0-9_-]+|city&productId=[A-Za-z0-9_-]+))$/.test(
        target,
      )
    )
      return;
    const app = parentApp();
    if (target.startsWith("/?lab="))
      app.openEmuKnowledgeLab?.("library", {
        post: new URL(target, location.origin).searchParams.get("labPost"),
      });
    else app.openSpRoom?.(target, "Emu for SchoolPark");
  }
  async function publicStatus() {
    try {
      const r = await fetch("/api/economy/status", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok || d.schema !== "economy-release-v2")
        throw Error("STATUS_UNAVAILABLE");
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
      for (const id of ["spendable", "wallet", "pending", "held", "processing"])
        $(id).textContent =
          me.balances[id] == null ? "未確認" : me.balances[id] + " EMUER";
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
      if (me.isOwner) operations();
      $("history").replaceChildren();
      if (!history.jobs.length)
        $("history").textContent = "まだ依頼はありません。";
      for (const job of history.jobs) {
        const article = node("article");
        article.append(
          node("b", labels[job.state] || "状態を確認中"),
          node(
            "p",
            new Date(job.createdAtMs).toLocaleString("ja-JP") +
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
              const d = await api("/jobs/" + job.id);
              const result = node("div");
              if (!d.job.result?.results?.length)
                result.append(
                  node("p", "目的に関連する公開情報は見つかりませんでした。"),
                );
              for (const r of d.job.result?.results || []) {
                result.append(
                  node("h3", r.title),
                  node("p", r.reason),
                  node("blockquote", r.evidence),
                  node("small", r.kind + " / ID: " + r.id),
                );
                const link = node("button", "内容を確認する →");
                link.type = "button";
                link.onclick = () => openTarget(r.target);
                result.append(node("p"), link);
              }
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
        if (job.result?.results?.length === 0)
          article.append(
            node(
              "p",
              "目的に関連する公開情報は見つかりませんでした。架空の候補は追加していません。",
            ),
          );
        for (const r of job.result?.results || []) {
          const card = node("div");
          card.append(
            node("h3", r.title),
            node("p", r.reason),
            node("blockquote", r.evidence),
            node("small", r.kind + " / ID: " + r.id),
          );
          const b = node("button", "内容を確認する →");
          b.type = "button";
          b.addEventListener("click", () => openTarget(r.target));
          card.append(node("p"), b);
          article.append(card);
        }
        $("history").append(article);
      }
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
      const d = await api("/quotes", { goal: $("goal").value });
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
      });
      if (g !== generation) return;
      clearApproval();
      await refresh();
      notice(labels[d.job.state] || "受付状態を確認しました。");
    } catch (e) {
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
  // No background polling that could overwrite unconfirmed input or double-submit a payment.
})();
