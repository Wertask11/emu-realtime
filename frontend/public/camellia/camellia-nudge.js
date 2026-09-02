/* ══════════════════════════════════════════════════════════════
   運営が決めたことを、この画面に効かせる

   管理画面（control-admin-previous.html）の「7つの機構」で
   入れたものが、そのままここに届く。

   置き場所: camellia_users/{uid}/admin/control
   本人は読めるが書き換えられない（firestore.rules）。
   書き換えられると、運営が切ったはずのものを自分で入れ直せてしまう。

   いま目に見える形で効くもの:
     誘導（nudge）  … ホームに「あなたへ」を出し、Wel-Wel の並び順を変える
     制裁（sanction）… コミュニティを閉じる
     孤立（isolate）… コミュニティの投稿欄だけ閉じる（読むのはできる）

   ほかの機構（観察・解釈・依存・報酬）は、いまは記録するだけで
   画面には出さない。効かせるときはここに足す。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CA = null, state = {};

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
    var go = document.getElementById("camNudgeGo");
    if (go) go.onclick = function () {
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

  /* ───── 制裁・孤立：コミュニティを閉じる ───── */
  function applyCommunity() {
    var tab = document.querySelector('[data-page="community"]');
    var page = document.querySelector("#community");
    if (tab) tab.style.display = state.sanction ? "none" : "";
    if (page && state.sanction && page.classList.contains("active")) {
      var home = document.querySelector('[data-page="home"]');
      if (home) home.click();
    }
    var form = document.querySelector("#communityForm");
    if (form) form.style.display = (state.sanction || state.isolate) ? "none" : "";
  }

  function apply() {
    try { paintNudge(); } catch (e) {}
    try { reorderWelwel(); } catch (e) {}
    try { applyCommunity(); } catch (e) {}
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
