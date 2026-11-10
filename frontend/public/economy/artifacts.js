(() => {
  "use strict";
  window.ReizoArtifacts = function ({
    api,
    node,
    openTarget,
    notice,
    generation,
    practiceAvailable = () => false,
    startPractice,
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
      $("artifactStructured").replaceChildren();
      $("saveChecklist").hidden = true;
      $("artifactStructuredNote").hidden = true;
      $("startPractice").hidden = true;
      $("artifactFormatNotice").textContent = "";
      $("artifactFormatNotice").hidden = true;
      $("legacyPracticeItems").value = "";
      $("legacyPracticeSetup").hidden = true;
      $("artifactEditor").open = false;
      $("artifactPlanName").textContent = "";
      $("artifactSavedAt").textContent = "";
    }
    function denyAccess(error) {
      if (error.message === "ARTIFACT_REFERENCES_UNAVAILABLE") {
        reset();
        notice(
          "資料の公開・利用許諾を確認できないため、成果物を閉じました。保存データは保持しています。",
        );
        return true;
      }
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
    function structured(a) {
      const root = $("artifactStructured");
      root.replaceChildren();
      const d = a.document;
      $("saveChecklist").hidden = !d;
      $("saveChecklist").disabled = false;
      $("artifactStructuredNote").hidden = !d;
      if (!d || !a.content) return;
      const section = (title) => {
        const s = node("section"),
          h = node("h3", title);
        s.append(h);
        root.append(s);
        return s;
      };
      section("目的と結論・提案").append(node("p", d.summary));
      if (d.learningGoal) {
        section("学習目標（提案）").append(node("p", d.learningGoal));
        const list = node("ul");
        for (const x of d.preparation) list.append(node("li", x));
        section("準備物（所持・利用条件は本人確認）").append(list);
      }

      const cs = section("候補比較（公開資料の事実と選定理由）");
      for (const c of d.candidates) {
        const card = node("article");
        card.append(
          node("h4", (c.recommended ? "推奨：" : "候補：") + c.title),
          node("p", c.reason),
          node("blockquote", c.details),
        );
        if (Number.isSafeInteger(c.facts?.priceEmuer))
          card.append(node("p", "公開価格：" + c.facts.priceEmuer + " EMUER"));
        if (c.facts?.deadlineMs)
          card.append(
            node(
              "p",
              "受付期限：" +
                new Date(c.facts.deadlineMs).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                }) +
                "（日本時間）",
            ),
          );
        const b = node("button", "公式ページを開く →");
        b.type = "button";
        b.onclick = () => openTarget(c.target);
        card.append(b);
        cs.append(card);
      }
      const evidenceName = (key) =>
        (d.evidence || []).find((x) => x.kind + ":" + x.id === key)?.title ||
        "参照元を下で確認";
      const steps = node("ol");
      for (const s of d.steps) {
        const li = node("li");
        li.append(
          node("p", s.action),
          node("small", "完了条件：" + s.done),
          node("small", "根拠：" + s.references.map(evidenceName).join("・")),
        );
        steps.append(li);
      }
      section("順番付きの実行手順").append(steps);
      const checks = section("実行チェックリスト");
      for (const c of d.checklist) {
        const label = node("label"),
          input = node("input");
        input.type = "checkbox";
        input.value = c.id;
        input.checked = (a.checkedItems || []).includes(c.id);
        label.className = "check";
        label.append(input, node("span", c.text));
        checks.append(label);
      }
      for (const [title, items] of [
        ["未確認事項・本人の確認が必要な点", d.unknowns],
        ["実践後の記録・振り返り", d.reflection],
      ]) {
        const list = node("ul");
        for (const x of items) list.append(node("li", x));
        section(title).append(list);
      }
      if (d.recordSheet) {
        const sheet = section("観察・記録シート");
        sheet.append(
          node(
            "p",
            "下の本文欄で記入・編集して保存できます。未実践の記録は空欄です。",
          ),
        );
        for (const r of d.recordSheet) {
          const card = node("article");
          card.append(
            node("h4", r.timing),
            node("p", "日時：" + r.datetime),
            node("p", "試した方法：" + r.method),
            node("p", "観察：" + r.observation),
            node("p", "次の条件：" + r.nextCondition),
          );
          sheet.append(card);
        }
      }
      if (d.draft)
        section("知識として残す本文下書き").append(node("pre", d.draft));
    }
    $("saveChecklist").onclick = async () => {
      if (!current?.content) return;
      if (
        $("artifactTitle").value !== current.title ||
        $("artifactContent").value !== current.content
      ) {
        $("artifactNotice").textContent =
          "本文の変更を先に保存してから、チェック状態を保存してください。";
        return;
      }
      const g = generation();
      $("saveChecklist").disabled = true;
      try {
        const d = await api("/artifacts/" + current.id, {
          editConsent: true,
          revision: current.revision,
          checkedItems: [
            ...$("artifactStructured").querySelectorAll(
              'input[type="checkbox"]:checked',
            ),
          ].map((x) => x.value),
        });
        if (g === generation()) {
          show(d.artifact);
          $("artifactNotice").textContent =
            "チェック状態を本人専用に保存しました。追加のAI実行・課金はありません。";
        }
      } catch (e) {
        if (g === generation() && !denyAccess(e))
          $("artifactNotice").textContent =
            "保存できませんでした。再度開いて状態と許諾を確認してください。";
      } finally {
        if (g === generation()) $("saveChecklist").disabled = false;
      }
    };
    function show(a) {
      const opening = current?.id !== a.id || !$("artifactDialog").open;
      current = a;
      $("startPractice").hidden = !a.content || !practiceAvailable();
      const prep = window.ReizoPracticePlan(a);
      $("artifactFormatNotice").hidden =
        !a.content || (!prep.legacy && !prep.invalid);
      $("artifactFormatNotice").textContent =
        prep.notice ||
        (prep.invalid
          ? "実践項目を確認できません。計画を開き直してください。"
          : "");
      $("legacyPracticeSetup").hidden =
        !a.content || !prep.legacy || !practiceAvailable();
      $("legacyPracticeItems").value = prep.items.join("\n");
      $("startPractice").disabled = !a.content || prep.invalid;
      if (opening) $("artifactEditor").open = false;
      structured(a);
      $("artifactTitle").value = a.title;
      $("artifactContent").value = a.content || "";
      $("artifactNotice").textContent =
        a.content && prep.legacy
          ? "確認項目を確認・編集して「やってみる」へ進めます。実践の記録は本人専用です。"
          : a.notice;
      $("artifactPlanName").textContent = a.title;
      $("artifactSavedAt").textContent =
        "計画の保存：" +
        new Date(a.createdAt).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        }) +
        "（日本時間）";
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
      if (opening) $("artifactDialog").scrollTop = 0;
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
      let verifiedChecklist = "";
      try {
        const fresh = await api("/artifacts/" + id);
        if (g !== generation()) return;
        if (!fresh.artifact.content) {
          show(fresh.artifact);
          return;
        }
        verifiedReferences = fresh.artifact.references;
        if (fresh.artifact.document)
          verifiedChecklist =
            "\n\n生成時のチェック項目（保存済みの本人記録）\n" +
            fresh.artifact.document.checklist
              .map(
                (c) =>
                  ((fresh.artifact.checkedItems || []).includes(c.id)
                    ? "[x] "
                    : "[ ] ") + c.text,
              )
              .join("\n");
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
            verifiedChecklist +
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
    $("startPractice").onclick = async () => {
      if (!current?.content || !practiceAvailable()) return;
      const prep = window.ReizoPracticePlan(current);
      if (prep.invalid) return;
      const manualItems = prep.legacy
        ? $("legacyPracticeItems")
            .value.split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined;
      if (
        prep.legacy &&
        (!manualItems.length ||
          manualItems.length > 20 ||
          manualItems.some((x) => x.length > 300))
      ) {
        $("artifactNotice").textContent =
          "実践する項目を1〜20件、1行300文字以内で入力してください。追加料金は発生していません。";
        $("legacyPracticeItems").focus();
        return;
      }
      if (
        $("artifactTitle").value !== current.title ||
        $("artifactContent").value !== current.content
      ) {
        $("artifactEditor").open = true;
        $("artifactNotice").textContent =
          "下書きの編集中です。編集を保存してから実践へ進むと、途中入力を失わずに使えます。";
        return;
      }
      const g = generation();
      $("startPractice").disabled = true;
      $("artifactDialog").close();
      try {
        await startPractice(current, manualItems);
      } catch (e) {
        if (g === generation() && !denyAccess(e)) {
          $("artifactNotice").textContent =
            "実践を開始できませんでした。通信状態・資料の期限を確認して開き直してください。追加料金は発生していません。";
          if (!$("artifactDialog").open) $("artifactDialog").showModal();
        }
      } finally {
        if (g === generation()) $("startPractice").disabled = !current?.content;
      }
    };
    return { open, reset };
  };
})();
