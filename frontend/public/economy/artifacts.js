(() => {
  "use strict";
  window.ReizoArtifacts = function ({
    api,
    node,
    openTarget,
    notice,
    generation,
  }) {
    const $ = (id) => document.getElementById(id);
    let current = null;
    function reset() {
      current = null;
      $("artifactDialog").close();
      $("artifactList").replaceChildren();
      $("artifactTitle").value = "";
      $("artifactContent").value = "";
      $("artifactReferences").replaceChildren();
      $("artifactEditConsent").checked = false;
    }
    function denyAccess(error) {
      if (
        ![
          "SERVICE_NOT_ELIGIBLE",
          "AI_AUDIENCE_NOT_VERIFIED",
          "AUTH_REQUIRED",
          "PASSPORT_REQUIRED",
        ].includes(error.message)
      )
        return false;
      reset();
      notice(
        "成果物の利用には、有効なPlus・ProプランとAI提供資格が必要です。保存データは削除していません。",
      );
      return true;
    }
    function show(a) {
      current = a;
      $("artifactTitle").value = a.title;
      $("artifactContent").value = a.content || "";
      $("artifactNotice").textContent = a.notice;
      $("artifactTitle").disabled = !a.content;
      $("artifactContent").disabled = !a.content;
      $("copyArtifact").disabled = !a.content;
      $("saveArtifact").disabled = !a.content;
      $("artifactEditConsent").checked = false;
      $("artifactReferences").replaceChildren();
      for (const r of a.references || []) {
        const p = node("p"),
          b = node("button", r.title + " →");
        b.type = "button";
        b.onclick = () => openTarget(r.target);
        p.append(node("span", r.evidence));
        if (Number.isSafeInteger(r.facts?.priceEmuer))
          p.append(node("small", "公開価格：" + r.facts.priceEmuer + " EMUER"));
        if (Number.isSafeInteger(r.facts?.stockAvailable))
          p.append(
            node(
              "small",
              "確認時点の在庫：" +
                r.facts.stockAvailable +
                "（確保・購入はしていません）",
            ),
          );
        if (r.facts?.deadlineMs)
          p.append(
            node(
              "small",
              "受付期限：" +
                new Date(r.facts.deadlineMs).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                }) +
                "（日本時間）",
            ),
          );
        if (r.facts?.scenario === "exercise")
          p.append(
            node(
              "small",
              "公式の演習課題です。架空の店舗設定を実在の協力先として扱いません。",
            ),
          );
        p.append(b);
        $("artifactReferences").append(p);
      }
      if (!$("artifactDialog").open) $("artifactDialog").showModal();
    }
    async function open(id) {
      const g = generation();
      try {
        const d = await api("/artifacts/" + id);
        if (g === generation()) show(d.artifact);
      } catch (error) {
        if (g === generation() && denyAccess(error)) return;
        if (g === generation())
          notice(
            "成果物を確認できませんでした。引渡し・公開範囲・許諾を確認してから開き直してください。",
          );
      }
    }
    async function list() {
      const g = generation();
      $("loadArtifacts").disabled = true;
      try {
        const d = await api("/artifacts");
        if (g !== generation()) return;
        $("artifactList").replaceChildren();
        if (!d.artifacts.length)
          $("artifactList").textContent = "保存済みの成果物はありません。";
        for (const a of d.artifacts) {
          const row = node("p"),
            b = node("button", a.title + "を開く");
          b.type = "button";
          b.onclick = () => open(a.id);
          row.append(
            node(
              "small",
              new Date(a.createdAt).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              }) + "（日本時間） ",
            ),
            b,
          );
          $("artifactList").append(row);
        }
      } catch (error) {
        if (g === generation() && denyAccess(error)) return;
        if (g === generation()) notice("成果物一覧を確認できませんでした。");
      } finally {
        $("loadArtifacts").disabled = false;
      }
    }
    $("loadArtifacts").onclick = list;
    $("closeArtifact").onclick = () => $("artifactDialog").close();
    $("copyArtifact").onclick = async () => {
      if (!current?.content) return;
      const g = generation(),
        id = current.id;
      let verifiedReferences = [];
      try {
        const fresh = await api("/artifacts/" + id);
        if (g !== generation()) return;
        if (!fresh.artifact.content) {
          show(fresh.artifact);
          return;
        }
        verifiedReferences = fresh.artifact.references;
      } catch (error) {
        if (g === generation() && denyAccess(error)) return;
        if (g === generation())
          $("artifactNotice").textContent =
            "資料の許諾を確認できないため、コピーを中止しました。";
        return;
      }
      try {
        await navigator.clipboard.writeText(
          $("artifactTitle").value +
            "\n\n" +
            $("artifactContent").value +
            "\n\n参考資料（現在の公開・許諾を再確認）\n" +
            verifiedReferences
              .map((r) => r.title + " " + location.origin + r.target)
              .join("\n"),
        );
        if (g === generation())
          $("artifactNotice").textContent =
            "コピーしました。投稿画面にはご自身で貼り付けてください。公開はしていません。";
      } catch (_) {
        if (g !== generation()) return;
        $("artifactContent").focus();
        $("artifactContent").select();
        $("artifactNotice").textContent =
          "本文を選択しました。端末のコピー操作を使ってください。";
      }
    };
    $("saveArtifact").onclick = async () => {
      if (!current?.content) return;
      if (!$("artifactEditConsent").checked) {
        $("artifactNotice").textContent =
          "本人専用の編集保存に同意してください。";
        return;
      }
      const g = generation(),
        id = current.id;
      $("saveArtifact").disabled = true;
      try {
        const d = await api("/artifacts/" + id, {
          title: $("artifactTitle").value,
          content: $("artifactContent").value,
          revision: current.revision,
          editConsent: true,
        });
        if (g === generation()) {
          show(d.artifact);
          $("artifactNotice").textContent =
            "本人専用に編集保存しました。AI送信・投稿の公開はしていません。";
        }
      } catch (e) {
        if (g === generation() && denyAccess(e)) return;
        if (g === generation())
          $("artifactNotice").textContent =
            e.message === "ARTIFACT_VERSION_CONFLICT"
              ? "別の画面で編集されています。閉じて開き直してください。"
              : "保存できませんでした。許諾や期限を再確認してください。";
        if (
          g === generation() &&
          e.message === "ARTIFACT_REFERENCES_UNAVAILABLE"
        ) {
          current = null;
          $("artifactContent").value = "";
          $("artifactTitle").value = "";
          $("copyArtifact").disabled = true;
        }
      } finally {
        if (g === generation()) $("saveArtifact").disabled = !current?.content;
      }
    };
    return { open, reset };
  };
})();
