/* ══════════════════════════════════════════════════════════════
   Camellia のコミュニティ

   これまでは端末の中だけだった（書いても、その端末にしか残らない）。
   みんなで見える場所にする。

   置き場所: camellia_community
     読めるのは Camellia に入った人だけ（生年月日と同意を済ませた人）
     書けるのは自分の名義で、新しく置くときだけ
     いちど置いた投稿は書き換えられない
     消せるのは、本人と運営
   通報は camellia_reports。出すことしかできない。
   誰が誰を通報したかは、ほかの人には見えない。

   名前は Camellia で登録したもの → SchoolParkパスポートのお名前 の順。
   どちらも無ければ「名前なし」。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var LIMIT = 100;        /* 出すのは新しい100件まで */
  var MAX = 500;          /* 1回に書ける長さ。ルール側と同じにすること */

  var CA = null, unsub = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function myName() {
    var v2 = null;
    try { v2 = JSON.parse(localStorage.getItem("camellia-v2") || "null"); } catch (e) {}
    return (v2 && v2.profile && v2.profile.displayName)
      || (CA && CA.account && CA.account.displayName)
      || "名前なし";
  }

  function when(ts) {
    try {
      var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      if (!d || isNaN(d.getTime())) return "";
      return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function isOwnerAddr(a) {
    return ["0xdcc687c05f130e57597a8525771299a4efb6edf7",
            "0x195f4478ee3865ee1dd360b79e121c638bdd42ac"]
      .indexOf(String(a || "").toLowerCase()) >= 0;
  }
  function amOwner() {
    return isOwnerAddr(CA && CA.passport)
      || isOwnerAddr(CA && CA.account && CA.account.walletAddress);
  }

  function paint(rows) {
    var box = document.querySelector("#communityMessages");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<p class="muted">まだ投稿はありません。はじめの一言をどうぞ。</p>';
      return;
    }
    var me = CA.user.uid;
    box.innerHTML = rows.map(function (r) {
      var mine = r.uid === me;
      return '<div class="community-post" style="border-bottom:1px solid var(--line);padding:10px 0">'
        + '<b>' + esc(r.name || "名前なし") + '</b>'
        + (mine ? ' <small class="muted">あなた</small>' : '')
        + '<div style="margin:4px 0;white-space:pre-wrap">' + esc(r.text) + '</div>'
        + '<small class="muted">' + esc(when(r.createdAt)) + '</small>'
        + ' <button class="btn" style="padding:2px 8px;font-size:11px" data-report="' + esc(r.id) + '">通報</button>'
        + ((mine || amOwner())
            ? ' <button class="btn" style="padding:2px 8px;font-size:11px" data-del="' + esc(r.id) + '">消す</button>'
            : '')
        + '</div>';
    }).join("");

    box.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = async function () {
        if (!confirm("この投稿を消します。よろしいですか？")) return;
        try {
          await CA.fb.deleteDoc(CA.fb.doc(CA.db, "camellia_community", b.dataset.del));
        } catch (e) { alert("消せませんでした（" + (e.code || e.message) + "）"); }
      };
    });
    box.querySelectorAll("[data-report]").forEach(function (b) {
      b.onclick = async function () {
        var reason = prompt("どんなところが気になりましたか。（任意・300文字まで）", "");
        if (reason === null) return;
        try {
          await CA.fb.addDoc(CA.fb.collection(CA.db, "camellia_reports"), {
            by: CA.user.uid, postId: b.dataset.report,
            reason: String(reason).slice(0, 300), createdAt: new Date().toISOString()
          });
          alert("お知らせありがとうございます。運営が確認します。");
        } catch (e) { alert("送れませんでした（" + (e.code || e.message) + "）"); }
      };
    });
  }

  function listen() {
    var q = CA.fb.query(
      CA.fb.collection(CA.db, "camellia_community"),
      CA.fb.orderBy("createdAt", "desc"),
      CA.fb.limit(LIMIT));
    /* 開いているあいだ、ほかの人の投稿も出る。
       読み込みの回数を抑えるため、出すのは新しい100件まで。 */
    unsub = CA.fb.onSnapshot(q, function (snap) {
      var rows = [];
      snap.forEach(function (d) { rows.push(Object.assign({ id: d.id }, d.data() || {})); });
      paint(rows);
    }, function (e) {
      var box = document.querySelector("#communityMessages");
      if (box) box.innerHTML = '<p class="muted">読み込めませんでした（' + esc(e.code || e.message) + '）</p>';
    });
  }

  function hookForm() {
    var form = document.querySelector("#communityForm");
    if (!form) return;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var input = e.target.elements.message;
      var text = String(input.value || "").trim();
      if (!text) return;
      if (text.length > MAX) { alert(MAX + "文字までです。"); return; }
      var btn = e.target.querySelector("button");
      if (btn) btn.disabled = true;
      try {
        await CA.fb.addDoc(CA.fb.collection(CA.db, "camellia_community"), {
          uid: CA.user.uid, name: myName(), text: text, createdAt: new Date().toISOString()
        });
        input.value = "";
        if (window.CamelliaActivity) window.CamelliaActivity.note("community-post");
      } catch (err) {
        alert("投稿できませんでした（" + (err.code || err.message) + "）");
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  /* 画面の説明を、実際の扱いに合わせる。
     「この端末以外には投稿されません」と書いたままにはできない。 */
  function fixNotice() {
    var page = document.querySelector("#community");
    if (!page) return;
    var p = page.querySelector("p.muted");
    if (p && /ローカル|この端末/.test(p.textContent)) {
      p.textContent = "ここに書いたことは、Camellia を使っているほかの方にも見えます。"
        + "お名前は、プロフィールで登録したものが出ます。";
    }
  }

  function start(auth) {
    CA = auth;
    if (!CA || !CA.user || !CA.fb || CA.blocker()) return;
    fixNotice();
    hookForm();
    listen();
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });

  /* 門を通り終えた直後にも動かす */
  var chain = window.CamelliaGateDone;
  try {
    Object.defineProperty(window, "CamelliaGateDone", {
      configurable: true,
      get: function () {
        return function (auth) {
          try { if (typeof chain === "function") chain(auth); } catch (e) {}
          if (!unsub) start(auth || window.CamelliaAuth);
        };
      },
      set: function (fn) { chain = fn; }
    });
  } catch (e) {}
})();
