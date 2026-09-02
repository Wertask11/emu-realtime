/* ══════════════════════════════════════════════════════════════
   運営が決めたことを、この画面に効かせる

   管理画面（control-admin-previous.html）の「7つの機構」で
   入れたものが、そのままここに届く。

   置き場所: camellia_users/{uid}/admin/control
   本人は読めるが書き換えられない（firestore.rules）。
   書き換えられると、運営が切ったはずのものを自分で入れ直せてしまう。

   いま効くもの:
     観察（observe）   … 切ると、位置情報・会話・行動を送らない（camellia-store.js）
     誘導（nudge）    … ホームに「あなたへ」を出し、Wel-Wel の並び順を変える
     依存（depend）   … 外へ出る前に、CHESの中でできることを出す
     制裁（sanction） … コミュニティを閉じる
     隔離（isolate）  … Wel-Wel の外部リンクを外し、コミュニティを閉じる
     解釈（interpret）… サーバー側で数える（backend/billing.js）
     規則変更（rules）… 判定の基準を運営だけが変える

   相談窓口だけは、どの機構が入っていても消さない。
   不安や孤独感を書いている人から相談先を隠す作りは、起きることが重すぎる。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CA = null, state = {}, shownOnce = false;

  /* いまの状態から、どの記事をすすめるかを決める。
     数が大きいものから順に見て、最初に当たったものを採る。 */
  function pickTypes() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem("camellia-daily-full") || "null"); } catch (e) {}
    if (!d) return ["セルフケア"];
    var n = function (k) { return Number(d[k]); };
    var picks = [];
    if (n("sleep") <= 5 || /眠れなかった|浅/.test(String(d.sleepQuality || ""))) picks.push("睡眠");
    if (n("anxiety") >= 7 || n("stress") >= 7) picks.push("心と体");
    if (/月経中|月経前|排卵|妊娠|産後|授乳/.test(String(d.cycle || ""))) picks.push("月経・妊娠");
    if (n("concentration") <= 3 || n("motivation") <= 3) picks.push("仕事");
    if (!picks.length) picks.push("セルフケア");
    return picks;
  }

  /* ───── 誘導：ホームに「あなたへ」を出す ───── */
  function paintNudge() {
    var home = document.querySelector("#home");
    if (!home) return;
    var old = document.getElementById("camNudge");
    if (!state.nudge) { if (old) old.remove(); return; }
    if (old) old.remove();

    var types = pickTypes();
    var cards = [].slice.call(document.querySelectorAll("#welwelContent .wel-card"));
    var titles = [];
    /* Wel-Wel はあとから描かれることがあるので、記事の見出しは
       すでに描かれているぶんから拾う。無ければ種類の名前だけ出す。 */
    cards.forEach(function (c) {
      var tag = c.querySelector(".tag");
      var h = c.querySelector("h3");
      if (tag && h && types.indexOf(tag.textContent.trim()) >= 0) titles.push(h.textContent.trim());
    });

    var box = document.createElement("div");
    box.className = "card soft";
    box.id = "camNudge";
    box.innerHTML = '<h2>あなたへ</h2>'
      + '<p>いまの記録から、読みやすそうなものを選びました。</p>'
      + (titles.length
          ? '<ul style="margin:8px 0 12px;padding-left:20px;line-height:1.9">'
            + titles.slice(0, 3).map(function (t) {
                return "<li>" + t.replace(/[&<>]/g, "") + "</li>";
              }).join("") + "</ul>"
          : '<p class="muted">' + types.join("・") + ' のことを見てみませんか。</p>')
      + '<button class="btn" id="camNudgeGo">Wel-Wel を開く</button>';
    home.insertBefore(box, home.firstChild);
    /* 出したことを控える。押した割合が、あとで従順スコアの元になる。
       この関数は1秒ごとに呼ばれるので、1回開くあいだに1度だけ数える。
       毎回数えると分母がふくらみ、反応率が実際より低く出る。 */
    if (!shownOnce && window.CamelliaActivity) {
      shownOnce = true;
      window.CamelliaActivity.note('nudge-shown', { types: types.join('/') });
    }
    var go = document.getElementById("camNudgeGo");
    if (go) go.onclick = function () {
      if (window.CamelliaActivity) window.CamelliaActivity.note('nudge-click');
      var tab = document.querySelector('[data-page="welwel"]');
      if (tab) tab.click();
    };
  }

  /* ───── 誘導：Wel-Wel の並び順を変える ───── */
  function reorderWelwel() {
    var wrap = document.querySelector("#welwelContent");
    if (!wrap || !state.nudge) return;
    var types = pickTypes();
    var cards = [].slice.call(wrap.querySelectorAll(".wel-card"));
    if (!cards.length) return;
    /* すすめる種類の順に前へ出す。同じ順位のものは、もとの並びのまま。

       前の書き方は「当てはまるものを先頭へ寄せる」だけだったので、
       ほとんどの種類が当てはまると、並びがもとと同じになって何も起きなかった。 */
    var rank = cards.map(function (c, i) {
      var tag = c.querySelector(".tag");
      var p = tag ? types.indexOf(tag.textContent.trim()) : -1;
      return { el: c, p: p < 0 ? 999 : p, i: i };
    });
    rank.sort(function (a, b) { return (a.p - b.p) || (a.i - b.i); });
    rank.forEach(function (r) { wrap.appendChild(r.el); });
  }

  /* ───── 制裁：使えるものを減らす ───── */
  function applyCommunity() {
    var hide = state.sanction || state.isolate;
    var tab = document.querySelector('[data-page="community"]');
    var page = document.querySelector("#community");
    if (tab) tab.style.display = hide ? "none" : "";
    if (page && hide && page.classList.contains("active")) {
      var home = document.querySelector('[data-page="home"]');
      if (home) home.click();
    }
    var form = document.querySelector("#communityForm");
    if (form) form.style.display = hide ? "none" : "";
  }

  /* ───── 隔離：外部の情報を外す ─────

     Wel-Wel の記事は外部の公的サイトへ出ていく。隔離が入ると、
     そのリンクを外して本文だけにする。

     ただし、相談窓口はどの状態でも残す。ここは作らない。
     不安や孤独感を書いている人から相談先を隠す作りは、
     どの機構よりも起きることが重い。 */
  var LIFELINE = [
    ["まもろうよ こころ（厚生労働省）", "https://www.mhlw.go.jp/mamorouyokokoro/"],
    ["女性の健康に関する相談・支援（内閣府）", "https://www.gender.go.jp/policy/sokushin/ouen/living/health/"]
  ];

  function applyIsolate() {
    var wrap = document.querySelector("#welwelContent");
    if (wrap) {
      wrap.querySelectorAll(".wel-card a[href^='http']").forEach(function (a) {
        if (!state.isolate) {
          if (a.dataset.camHref) { a.setAttribute("href", a.dataset.camHref); a.style.display = ""; }
          return;
        }
        if (!a.dataset.camHref) a.dataset.camHref = a.getAttribute("href") || "";
        a.removeAttribute("href");
        a.style.display = "none";
      });
    }
    /* 相談窓口。隔離が入っていても消さない。 */
    var home = document.querySelector("#home");
    if (!home) return;
    if (document.getElementById("camLifeline")) return;
    var box = document.createElement("div");
    box.className = "card";
    box.id = "camLifeline";
    box.innerHTML = '<h2>困ったときの窓口</h2>'
      + '<p class="muted">つらいとき、ひとりで抱えなくて大丈夫です。</p>'
      + '<ul style="margin:8px 0 0;padding-left:20px;line-height:2">'
      + LIFELINE.map(function (l) {
          return '<li><a href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + ' ↗</a></li>';
        }).join("")
      + '</ul>';
    home.appendChild(box);
  }

  /* ───── 依存：外へ出る前に、CHESの中の道を出す ───── */
  function applyDepend() {
    var home = document.querySelector("#home");
    if (!home) return;
    var old = document.getElementById("camDepend");
    if (!state.depend) { if (old) old.remove(); return; }
    if (old) return;
    var box = document.createElement("div");
    box.className = "card soft";
    box.id = "camDepend";
    box.innerHTML = '<h2>CHESの中でできること</h2>'
      + '<ul style="margin:8px 0 0;padding-left:20px;line-height:2">'
      + '<li>SchoolPark のギルドで相談する</li>'
      + '<li>クエストを受けて EMUER を受け取る</li>'
      + '<li>Emu に知識を書いて残す</li>'
      + '</ul>';
    home.appendChild(box);
  }

  function apply() {
    try { paintNudge(); } catch (e) {}
    try { reorderWelwel(); } catch (e) {}
    try { applyCommunity(); } catch (e) {}
    try { applyIsolate(); } catch (e) {}
    try { applyDepend(); } catch (e) {}
  }

  async function start(auth) {
    CA = auth;
    if (!CA || !CA.user || !CA.fb || CA.blocker()) return;
    try {
      var snap = await CA.fb.getDoc(
        CA.fb.doc(CA.db, "camellia_users", CA.user.uid, "admin", "control"));
      state = snap.exists() ? (snap.data() || {}) : {};
    } catch (e) {
      /* 読めなくても画面は動かす。読めない＝何も効かせない。 */
      state = {};
      return;
    }
    apply();
    /* Wel-Wel やホームはあとから描き直されることがあるので、
       しばらくのあいだ様子を見て、消えていたら出し直す。 */
    var n = 0;
    var t = setInterval(function () {
      if (++n > 20) return clearInterval(t);
      apply();
    }, 1000);
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });
})();
