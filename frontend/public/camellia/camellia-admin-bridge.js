/* ══════════════════════════════════════════════════════════════
   Camellia の管理画面へ、本物の利用者を渡す

   管理画面（control-admin.html / control-admin-previous.html）は
   運営専用の membership-admin.html の中に、枠として置いてある。
   利用者の記録はサーバーにあり、読むには運営の鍵が要る。
   枠の中からは鍵を使えないので、外側から中へ渡す。

   これまでは架空の3人（Mina A-017 / Sora A-026 / Rin A-031）を
   その場で作って並べていた。本物と入れ替える。

   渡ってくるまでは、誰もいない状態で出す。
   架空の人を出しておくと、本物と見分けがつかなくなる。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  window.CamelliaMembers = window.CamelliaMembers || [];

  /* 数値を「不安6・ストレス7」のような一行にまとめる。
     記録がまだ無い人は空にする。無いものを 0 と書くと、
     「0だった」のか「書いていない」のかが分からなくなる。 */
  function line(rec, pairs) {
    if (!rec) return "";
    var out = [];
    pairs.forEach(function (p) {
      var v = rec[p[0]];
      if (v === undefined || v === null || v === "") return;
      out.push(p[1] + v + (p[2] || ""));
    });
    return out.join("・");
  }

  /* サーバーから来た形を、この画面が使ってきた形に合わせる。 */
  function toPersona(m) {
    var latest = (m.daily && m.daily.length) ? m.daily[0] : null;   /* 新しい順で届く */
    var loc = m.location;
    /* 名前は2つある。
         SchoolParkパスポートのお名前（ログインしたときのもの）
         Camellia で登録したお名前（プロフィールで自分で入れたもの）
       別のことがあるので、両方出す。同じなら1つだけ。 */
    var spName = m.name || "";
    var camName = (m.basic && m.basic.displayName) || "";
    var label = spName || camName || "（お名前なし）";
    if (camName && camName !== spName) {
      label = spName ? (spName + "／Camellia: " + camName) : camName;
    }

    return {
      uid: m.uid,
      name: label + (m.passport ? " " + m.passport.slice(0, 6) : ""),
      mind: line(latest, [["anxiety", "不安"], ["stress", "ストレス"], ["loneliness", "孤独感"]]) || "記録なし",
      body: line(latest, [["fatigue", "疲労"], ["sleep", "睡眠", "時間"]]) || "記録なし",
      location: loc && loc.latitude ? "取得済み" : "取得なし",
      behavior: latest ? ("最終記録 " + (latest.date || "")) : "記録なし",
      relations: "—",
      /* ここから下は、この画面の模型が使う目盛り。実データではない。
         本物の記録から決められる性質のものではないので、まん中に置く。 */
      /* 抵抗値・支援はサーバーが実際に数えたもの。
         収入は Camellia には無いので 0（依存度は支援で動く）。 */
      resistance: (m.assessment && typeof m.assessment.resistance === "number") ? m.assessment.resistance : 50,
      income: 0,
      support: (m.assessment && typeof m.assessment.support === "number") ? m.assessment.support : 0,
      assessment: m.assessment || null,
      /* 運営がこの方に入れている7つの機構。管理画面の初期状態にする。 */
      control: m.adminControl || {}
    };
  }


  var receivedMembers = [];
  var identityByUid = {};
  var identityLoadError = "";
  var activeUid = "";
  var activeView = "profile";
  var parentObserver = null;

  function valueText(value) {
    if (value === undefined || value === null || value === "") return "未記録";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (_) { return "表示できません"; }
    }
    return String(value);
  }

  function tableRows(items) {
    return '<table style="width:100%;border-collapse:collapse"><tbody>' +
      items.map(function (item) {
        return '<tr><th style="width:34%;text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #eee;color:#705d64">' +
          esc(item[0]) + '</th><td style="padding:8px;border-bottom:1px solid #eee;word-break:break-word;white-space:pre-wrap">' +
          esc(valueText(item[1])) + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  function parentIdentityPanel() {
    try {
      var doc = window.parent.document;
      var tab = doc.querySelector("#tab-camellia");
      if (!tab) return null;
      var panel = doc.querySelector("#camellia-profile-identity-sync");
      if (!panel) {
        panel = doc.createElement("section");
        panel.id = "camellia-profile-identity-sync";
        panel.className = "card";
        panel.style.cssText = "margin-top:14px;overflow:auto";
        panel.innerHTML = '<h2 style="margin:0 0 4px">Camellia Profile / Identity / Sync</h2>' +
          '<p class="hint">選択した利用者について、Firestoreのプロフィール・連携方式・同期概要を表示します。識別子や健康情報を含むため、権限のある運営者だけが閲覧してください。</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">' +
          '<button type="button" class="btn" data-cam-profile-view="profile">Profile</button>' +
          '<button type="button" class="btn" data-cam-profile-view="identity">Identity</button>' +
          '<button type="button" class="btn" data-cam-profile-view="sync">Sync</button>' +
          '<button type="button" class="btn" data-cam-profile-refresh>連携状態を更新</button></div>' +
          '<div data-cam-profile-status class="hint"></div><div data-cam-profile-content></div>' +
          '<p class="hint" style="margin:10px 0 0">表示は一覧の読込時点です。最新の記録を見るにはCamelliaタブを再読み込みしてください。</p>';
        var firstCard = tab.querySelector(":scope > .card");
        if (firstCard && firstCard.nextSibling) tab.insertBefore(panel, firstCard.nextSibling);
        else tab.appendChild(panel);
        panel.querySelectorAll("[data-cam-profile-view]").forEach(function (button) {
          button.addEventListener("click", function () {
            activeView = button.getAttribute("data-cam-profile-view");
            renderParentProfile();
          });
        });
        var refresh = panel.querySelector("[data-cam-profile-refresh]");
        if (refresh) refresh.addEventListener("click", function () {
          fetchParentIdentities().then(renderParentProfile);
        });
      }
      return panel;
    } catch (_) { return null; }
  }

  function fetchParentIdentities() {
    try {
      var api = window.parent.api;
      if (typeof api !== "function") {
        identityLoadError = "認証済み管理APIを利用できませんでした。";
        return Promise.resolve();
      }
      var panel = parentIdentityPanel();
      if (panel) panel.querySelector("[data-cam-profile-status]").textContent = "連携状態を読み込んでいます…";
      return api("/api/billing/admin/camellia-identities").then(function (result) {
        identityByUid = (result && result.identities) || {};
        identityLoadError = "";
      }).catch(function (error) {
        identityLoadError = "連携状態を取得できませんでした（" + (error.code || error.message || "ERROR") + "）。";
      });
    } catch (error) {
      identityLoadError = "連携状態を取得できませんでした。";
      return Promise.resolve();
    }
  }

  function filteredReceivedMembers(doc) {
    var input = doc.querySelector("#camFind");
    var query = String((input && input.value) || "").trim().toLowerCase();
    return receivedMembers.filter(function (m) {
      return [m.camelliaId, m.passport, m.uid, m.name, m.basic && m.basic.displayName]
        .some(function (value) { return String(value || "").toLowerCase().indexOf(query) >= 0; });
    });
  }

  function bindParentRows() {
    try {
      var doc = window.parent.document;
      var list = doc.querySelector("#camList");
      if (!list) return;
      var visible = filteredReceivedMembers(doc);
      Array.prototype.forEach.call(list.querySelectorAll(":scope > details"), function (row, index) {
        row.dataset.camelliaAdminUid = visible[index] ? visible[index].uid : "";
      });
      if (!list.dataset.camelliaProfileBound) {
        list.dataset.camelliaProfileBound = "1";
        list.addEventListener("click", function (event) {
          var summary = event.target && event.target.closest ? event.target.closest("summary") : null;
          var row = summary && summary.closest("details");
          if (!row || !row.dataset.camelliaAdminUid) return;
          activeUid = row.dataset.camelliaAdminUid;
          renderParentProfile();
        }, true);
        var search = doc.querySelector("#camFind");
        if (search) search.addEventListener("input", function () {
          setTimeout(function () { bindParentRows(); renderParentProfile(); }, 0);
        });
        if (typeof MutationObserver !== "undefined") {
          parentObserver = new MutationObserver(function () { bindParentRows(); });
          parentObserver.observe(list, { childList: true, subtree: true });
        }
      }
      if (!activeUid && visible.length) activeUid = visible[0].uid;
      renderParentProfile();
    } catch (_) {}
  }

  function renderParentProfile() {
    var panel = parentIdentityPanel();
    if (!panel) return;
    bindParentRows();
    var doc = window.parent.document;
    var member = receivedMembers.find(function (m) { return m.uid === activeUid; });
    var content = panel.querySelector("[data-cam-profile-content]");
    var status = panel.querySelector("[data-cam-profile-status]");
    if (!member) {
      status.textContent = "ユーザー一覧の名前を開くと、その方の情報が表示されます。";
      content.innerHTML = "";
      return;
    }
    status.textContent = "対象：" + (member.basic && member.basic.displayName || member.name || "名前未登録");
    var rows;
    if (activeView === "identity") {
      var identity = identityByUid[member.uid] || null;
      rows = [
        ["Camellia内部ID（Firebase UID）", member.uid],
        ["LINE", identityLoadError ? "状態を確認できません" : identity && identity.line ? "連携済み" : "連携記録なし"],
        ["SchoolPark Passport", identityLoadError ? "状態を確認できません" : identity && identity.schoolpark ? "連携済み" : member.passport ? "Passport番号あり（認証方式の連携記録なし）" : "連携記録なし"],
        ["Passport ID", member.passport || "未記録"],
        ["SchoolPark側ログイン方式", member.provider || "管理データなし"]
      ];
      status.textContent += identityLoadError ? " / " + identityLoadError : "";
    } else if (activeView === "sync") {
      var imports = Array.isArray(member.imports) ? member.imports : [];
      rows = [
        ["Firestoreの最終更新", member.updatedAt],
        ["日々のCheck保存数", Array.isArray(member.daily) ? member.daily.length : 0],
        ["プロフィール", member.basic ? "保存あり" : "未記録"],
        ["設定", member.settings ? "保存あり" : "未記録"],
        ["会話メッセージ数", member.chat && member.chat.total !== undefined ? member.chat.total : (member.chat && member.chat.messages || []).length],
        ["行動イベント数", member.activity && member.activity.total !== undefined ? member.activity.total : (member.activity && member.activity.events || []).length],
        ["localStorageアーカイブ数", imports.length],
        ["アーカイブ種別", imports.map(function (x) { return x.kind || x.type || "不明"; }).join("、") || "なし"],
        ["注意", "この画面はリアルタイム購読ではなく、一覧APIの取得結果です。"]
      ];
    } else {
      var basic = member.basic || {};
      rows = [
        ["Camelliaプロフィール名", basic.displayName],
        ["生年月日", basic.dateOfBirth || member.birthDate],
        ["年齢（現在の一覧計算）", member.age === null || member.age === undefined ? "不明" : member.age + "歳"],
        ["居住地域", basic.residencePrefecture],
        ["生活スタイル", basic.occupation],
        ["同居状況", basic.livingSituation],
        ["関心", basic.interests],
        ["利用目的", basic.goals || basic.goal],
        ["女性向けサービス確認", basic.womenWellbeingConfirmedAt],
        ["利用規約確認日時", basic.termsAcceptedAt],
        ["プライバシー確認日時", basic.privacyAcknowledgedAt],
        ["文書バージョン", basic.policyVersion]
      ];
    }
    content.innerHTML = tableRows(rows);
  }

  function apply(members) {
    receivedMembers = Array.isArray(members) ? members : [];
    window.CamelliaMembers = receivedMembers.map(toPersona);
    try {
      window.dispatchEvent(new CustomEvent("camellia-members", {
        detail: window.CamelliaMembers
      }));
    } catch (e) {}
    void fetchParentIdentities().then(bindParentRows);
  }

  window.addEventListener("message", function (ev) {
    /* 外側は同じサイトなので、別のところから来たものは受け取らない。 */
    if (ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.type !== "camellia-members") return;
    apply(d.members);
  });

  /* 用意ができたことを外側へ伝える。外側はこれを見てから送る。 */
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "camellia-admin-ready" }, location.origin);
    }
  } catch (e) {}
})();
