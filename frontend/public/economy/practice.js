(() => {
  "use strict";
  window.ReizoPractice = function ({
    api,
    node,
    generation,
    identity,
    openPosting,
  }) {
    const $ = (id) => document.getElementById(id),
      prefix = "reizo-practice-v1:";
    const observationLabels = {
      actions: "実際に行ったこと",
      method: "試した方法・手順",
      result: "結果",
      failures: "失敗・注意点",
      insights: "気づいたこと",
      next: "次に試したいこと",
    };
    const reflectionLabels = {
      goal: "何を目指したか",
      actual: "何を実際に行ったか",
      success: "何がうまくいったか",
      failure: "何がうまくいかなかったか",
      learning: "何を学んだか",
      next: "次に何を試すか",
    };
    const statusLabels = {
      active: "実践中",
      paused: "一時中断",
      completed: "完了",
      cancelled: "中止",
    };
    let current = null,
      enabled = false,
      dirty = false,
      pending = null,
      previousOwner = null,
      saving = false;
    const draftTimers = new Map();
    const message = (s) => {
      $("practiceNotice").textContent = s;
      $("practiceSaveStatus").textContent = s;
    };
    const key = (id) => prefix + identity() + ":" + id;
    function removeDraft(id) {
      try {
        sessionStorage.removeItem(key(id));
        clearTimeout(draftTimers.get(key(id)));
        draftTimers.delete(key(id));
      } catch (_) {}
    }
    function reset() {
      // Initial null can mean Firebase is still restoring login, not logout.
      // Never display a buffer before its owner is authenticated.
      try {
        for (const k of Object.keys(sessionStorage))
          if (
            k.startsWith(prefix) &&
            ((identity() && !k.startsWith(prefix + identity() + ":")) ||
              (!identity() && previousOwner) ||
              Date.now() - JSON.parse(sessionStorage.getItem(k) || "{}").at >
                7200000)
          )
            sessionStorage.removeItem(k);
      } catch (_) {}
      previousOwner = identity();
      for (const timer of draftTimers.values()) clearTimeout(timer);
      draftTimers.clear();
      current = null;
      dirty = false;
      pending = null;
      saving = false;
      $("practiceDialog").close();
      $("practiceFields").replaceChildren();
      $("practiceList").replaceChildren();
      $("practicePreview").value = "";
      $("practiceRecovery").value = "";
      $("practiceRecovery").hidden = true;
      $("practiceRecoveryLabel").hidden = true;
      $("practiceStatus").textContent = "";
      $("practiceNotice").textContent = "";
      $("practiceSaveStatus").textContent = "";
      for (const c of $("practicePostingChecks").querySelectorAll("input"))
        c.checked = false;
    }
    function configure(c) {
      enabled = c?.enabled === true;
      $("practiceSection").hidden = !enabled;
    }
    function error(e) {
      const denied = [
        "SERVICE_NOT_ELIGIBLE",
        "AI_AUDIENCE_NOT_VERIFIED",
        "AUTH_REQUIRED",
        "PASSPORT_REQUIRED",
        "PRACTICE_NOT_FOUND",
        "PRACTICE_EXPIRED",
        "PRACTICE_DISABLED",
      ].includes(e.message);
      if (denied) {
        if (current) removeDraft(current.id);
        reset();
        $("notice").textContent =
          "実践記録の利用資格・保存期限を確認できません。記録は本人専用です。";
        return;
      }
      message(
        e.message === "PRACTICE_VERSION_CONFLICT" ||
          e.message === "PRACTICE_REQUEST_CONFLICT"
          ? "別の画面で更新されています。入力はこのタブに保持しています。「最新を確認」で照合し、必要な部分を戻してください。"
          : e.message === "PRACTICE_COMPLETION_CONFIRMATION_REQUIRED"
            ? "未完了の項目があります。確認してから完了してください。"
            : e.message === "ARTIFACT_REFERENCES_UNAVAILABLE"
              ? "元資料の許諾を確認できません。記録だけを保存するため、いったん閉じて開き直してください。"
              : "保存を確認できません。入力はこのタブに保持しています。通信回復後に「保存・再送」を押してください。新しい決済は行いません。",
      );
    }
    function input(label, id, value, max = 3000) {
      const l = node("label", label),
        v = node("textarea");
      l.htmlFor = id;
      v.id = id;
      v.rows = 3;
      v.maxLength = max;
      v.value = value || "";
      v.oninput = remember;
      $("practiceFields").append(l, v);
      return v;
    }
    function read() {
      const out = {
        postingChecks: [
          ...$("practicePostingChecks").querySelectorAll("input:checked"),
        ].map((c) => c.value),
        notes: $("practiceNotes").value,
        postTitle: $("practicePostTitle").value,
        advice: $("practiceAdvice").value,
        observations: Object.fromEntries(
          Object.keys(observationLabels).map((k) => [
            k,
            $("practiceObservation-" + k).value,
          ]),
        ),
        reflections: Object.fromEntries(
          Object.keys(reflectionLabels).map((k) => [
            k,
            $("practiceReflection-" + k).value,
          ]),
        ),
      };
      out.checklistItems = current.checklistItems.map((c, i) => ({
        id: c.id,
        state: $("practiceState-" + i).value,
        note: $("practiceNote-" + i).value,
      }));
      return out;
    }
    function stash(data) {
      try {
        sessionStorage.setItem(
          key(current.id),
          JSON.stringify({
            at: Date.now(),
            revision: current.revision,
            data,
            pending,
          }),
        );
        armDraftTimer(key(current.id), 7200000);
      } catch (_) {
        message(
          "端末に途中入力を保持できません。閉じる前にサーバーへ保存してください。",
        );
      }
    }
    function armDraftTimer(k, remaining) {
      clearTimeout(draftTimers.get(k));
      draftTimers.set(
        k,
        setTimeout(
          () => {
            try {
              sessionStorage.removeItem(k);
            } catch (_) {}
            draftTimers.delete(k);
          },
          Math.max(1, remaining),
        ),
      );
    }
    function remember() {
      if (!current) return;
      dirty = true;
      pending = null;
      stash(read());
      message(
        "未保存の入力があります。このタブに2時間まで保持します。「保存・再送」で本人専用に保存できます。",
      );
    }
    function apply(data) {
      $("practiceNotes").value = data.notes || "";
      $("practicePostTitle").value = data.postTitle || "";
      $("practiceAdvice").value = data.advice || "";
      for (const c of $("practicePostingChecks").querySelectorAll("input"))
        c.checked = (data.postingChecks || []).includes(c.value);
      for (const k of Object.keys(observationLabels))
        $("practiceObservation-" + k).value = data.observations?.[k] || "";
      for (const k of Object.keys(reflectionLabels))
        $("practiceReflection-" + k).value = data.reflections?.[k] || "";
      for (const [i, c] of current.checklistItems.entries()) {
        const saved = data.checklistItems?.find((x) => x.id === c.id);
        if (saved && current.sourceAvailable) {
          $("practiceState-" + i).value = saved.state;
          $("practiceNote-" + i).value = saved.note;
        }
      }
    }
    function render(s) {
      $("practiceRecovery").value = "";
      $("practiceRecovery").hidden = true;
      $("practiceRecoveryLabel").hidden = true;
      current = s;
      dirty = false;
      pending = null;
      $("practiceFields").replaceChildren();
      $("practiceHeading").textContent = "やってみる・実践の記録";
      $("practiceStatus").textContent =
        statusLabels[s.status] +
        " · " +
        s.progress.done +
        "/" +
        s.progress.total +
        "項目完了";
      $("practiceProgress").max = s.progress.total || 1;
      $("practiceProgress").value = s.progress.done;
      $("practiceRetention").textContent =
        s.notice +
        " 保存期限：" +
        new Date(s.deleteAfterMs).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        }) +
        "（日本時間）";
      const heading = (id, text) => {
        const h = node("h3", text);
        h.id = id;
        return h;
      };
      $("practiceFields").append(
        heading("practiceChecklistHeading", "実践チェックリスト"),
        node(
          "p",
          s.sourceAvailable
            ? s.sourceTitle
            : "元資料の利用期限・許諾が変わりました。元の計画は表示せず、本人が入力した記録だけを保存できます。",
        ),
      );
      for (const [i, c] of s.checklistItems.entries()) {
        const l = node("label", c.text),
          select = node("select");
        select.id = "practiceState-" + i;
        l.htmlFor = select.id;
        for (const [value, label] of [
          ["not_started", "未着手"],
          ["in_progress", "進行中"],
          ["done", "完了"],
          ["on_hold", "保留"],
        ]) {
          const o = node("option", label);
          o.value = value;
          select.append(o);
        }
        select.value = c.state;
        select.disabled = !s.sourceAvailable;
        select.onchange = remember;
        $("practiceFields").append(l, select);
        const memo = input(
          "項目のメモ " + (i + 1),
          "practiceNote-" + i,
          c.note,
          1000,
        );
        memo.disabled = false;
      }
      $("practiceFields").append(heading("practiceRecordHeading", "記録する"));
      input("全体のメモ", "practiceNotes", s.notes);
      for (const [k, label] of Object.entries(observationLabels))
        input(label, "practiceObservation-" + k, s.observations[k]);
      $("practiceFields").append(
        heading("practiceReflectionHeading", "振り返る"),
      );
      for (const [k, label] of Object.entries(reflectionLabels))
        input(label, "practiceReflection-" + k, s.reflections[k]);
      $("practiceFields").append(
        heading("practicePostingHeading", "知識として届ける"),
      );
      input(
        "投稿タイトル案（自分で編集）",
        "practicePostTitle",
        s.postTitle,
        100,
      );
      input("次の人へのアドバイス", "practiceAdvice", s.advice);
      $("practicePreview").value = s.postingDraft.content;
      for (const c of $("practicePostingChecks").querySelectorAll("input"))
        c.checked = (s.postingChecks || []).includes(c.value);
      $("practiceMissing").textContent =
        "未記入：" +
        (s.postingDraft.missing.join("・") || "なし") +
        "。入力した経験だけで整理し、不足内容は補いません。";
      $("pausePractice").hidden = s.status !== "active";
      $("resumePractice").hidden = s.status !== "paused";
      $("completePractice").hidden = s.status !== "active";
      $("cancelPractice").hidden = !["active", "paused"].includes(s.status);
    }
    function restore(s) {
      try {
        const value = JSON.parse(sessionStorage.getItem(key(s.id)) || "null");
        if (!value) return;
        if (Date.now() - value.at > 7200000) {
          removeDraft(s.id);
          return;
        }
        armDraftTimer(key(s.id), 7200000 - (Date.now() - value.at));
        if (value.revision === s.revision) {
          apply(value.data);
          dirty = true;
          pending = value.pending;
          message("このタブの途中入力を復元しました。保存・再送できます。");
        } else {
          $("practiceRecovery").hidden = false;
          $("practiceRecoveryLabel").hidden = false;
          $("practiceRecovery").value = JSON.stringify(value.data, null, 2);
          message(
            "サーバーに新しい更新があります。以前の入力を下の復元欄で確認し、必要な部分だけ戻してください。自動で上書きしません。",
          );
        }
      } catch (_) {
        removeDraft(s.id);
      }
    }
    async function open(id) {
      if (
        dirty &&
        !confirm("未保存の入力はこのタブに保持します。別の実践を開きますか？")
      )
        return;
      const g = generation();
      try {
        const d = await api("/practice/" + id);
        if (g !== generation()) return;
        render(d.session);
        $("practiceRecovery").hidden = true;
        $("practiceRecovery").value = "";
        message(
          "保存済みの実践記録を開きました（更新" +
            d.session.revision +
            "）。本人専用で、操作・保存に追加料金はかかりません。",
        );
        restore(d.session);
        if (!$("practiceDialog").open) $("practiceDialog").showModal();
        $("practiceDialog").scrollTop = 0;
      } catch (e) {
        if (g === generation()) error(e);
      }
    }
    async function start(a, manualItems) {
      const g = generation();
      try {
        const d = await api("/practice", {
          sourceArtifactId: a.id,
          ...(manualItems ? { manualItems } : {}),
        });
        if (g !== generation()) return false;
        render(d.session);
        message(
          "この計画の実践記録を開きました。元の計画は変更していません。追加料金はありません。",
        );
        restore(d.session);
        $("practiceDialog").showModal();
        $("practiceDialog").scrollTop = 0;
        return true;
      } catch (e) {
        if (g === generation()) error(e);
        throw e;
      }
    }
    async function save(status) {
      if (!current || saving) return false;
      const g = generation(),
        id = current.id;
      if (
        status === "cancelled" &&
        !confirm(
          "この実践を中止しますか？入力済みの記録は保存期間内に閲覧できます。",
        )
      )
        return false;
      const data = read();
      let confirmIncomplete = false;
      if (
        (status === "completed" ||
          (current.status === "completed" &&
            (data.checklistItems || []).filter((c) => c.state === "done")
              .length !== current.progress.done)) &&
        (data.checklistItems || current.checklistItems).some(
          (c) => c.state !== "done",
        )
      ) {
        if (
          !confirm(
            "未完了・保留の項目があります。内容を確認したうえで、この実践を完了しますか？",
          )
        )
          return false;
        confirmIncomplete = true;
      }
      const body =
        !status && pending
          ? pending
          : {
              ...data,
              requestId: crypto.randomUUID(),
              revision: current.revision,
              ...(status ? { status } : {}),
              ...(confirmIncomplete ? { confirmIncomplete: true } : {}),
            };
      pending = body;
      stash(data);
      saving = true;
      $("savePractice").disabled = true;
      const controls = [
        ...$("practiceDialog").querySelectorAll("input,textarea,select,button"),
      ].filter((x) => !x.disabled);
      controls.forEach((x) => {
        x.disabled = true;
      });
      try {
        const d = await api("/practice/" + id, body);
        if (g !== generation()) return false;
        removeDraft(id);
        render(d.session);
        message(
          "本人専用に保存しました（更新" +
            d.session.revision +
            "）。追加料金・外部送信・公開はありません。",
        );
        return true;
      } catch (e) {
        if (g === generation()) error(e);
        return false;
      } finally {
        if (g === generation()) {
          saving = false;
          controls.forEach((x) => {
            if (x.isConnected) x.disabled = false;
          });
          $("savePractice").disabled = false;
        }
      }
    }
    $("savePractice").onclick = () => save();
    for (const b of $("practiceJourney").querySelectorAll("button"))
      b.onclick = () => {
        $(b.dataset.practiceSection)?.scrollIntoView({ block: "start" });
      };
    for (const c of $("practicePostingChecks").querySelectorAll("input"))
      c.onchange = remember;
    for (const [id, state] of [
      ["pausePractice", "paused"],
      ["resumePractice", "active"],
      ["completePractice", "completed"],
      ["cancelPractice", "cancelled"],
    ])
      $(id).onclick = () => save(state);
    $("closePractice").onclick = () => $("practiceDialog").close();
    $("refreshPractice").onclick = () => current && open(current.id);
    $("copyPractice").onclick = async () => {
      if (!current || (dirty && !(await save()))) return;
      const g = generation();
      try {
        const d = await api("/practice/" + current.id);
        if (g !== generation()) return;
        render(d.session);
        await navigator.clipboard.writeText(d.session.postingDraft.content);
        if (g === generation())
          message(
            "投稿用の文章をコピーしました。投稿画面で確認・編集し、ご自身で公開してください。",
          );
      } catch (e) {
        if (g === generation()) {
          error(e);
          $("practicePreview").focus();
          $("practicePreview").select();
        }
      }
    };
    $("practicePosting").onclick = () => openPosting();
    $("loadPractice").onclick = async () => {
      const g = generation();
      try {
        const d = await api("/practice");
        if (g !== generation()) return;
        $("practiceList").replaceChildren();
        if (!d.sessions.length)
          $("practiceList").append(
            node("p", "保存した計画を開き、「やってみる」から始められます。"),
          );
        for (const s of d.sessions) {
          const b = node("button", s.label + "の実践記録を開く");
          b.onclick = () => open(s.id);
          $("practiceList").append(b);
        }
      } catch (e) {
        if (g === generation()) error(e);
      }
    };
    // Local-only draft protection; no polling, analytics or background model call.
    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    window.addEventListener("online", () => {
      if (dirty)
        message("通信が戻りました。「保存・再送」で入力を保存できます。");
    });
    return { reset, configure, start, enabled: () => enabled };
  };
})();
