/* ══════════════════════════════════════════════════════════════
   運営からの返事を受け取る

   Camellia AI がモデルにつながっていないあいだ、運営が手で返事を書く。
   その返事がここへ届く。

   置き場所: camellia_users/{uid}/admin/replies/items/{id}
   本人は読めるが書けない（firestore.rules）。
   書けると、運営が書いた返事を本人が差し替えられてしまう。

   届いたら、いつもの会話（camellia-v2 の chats）に足す。
   同じものを二度足さないよう、足した id を控えておく。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SEEN_KEY = "camellia-reply-seen";
  var CA = null;

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }

  function add(items) {
    var seen = readJSON(SEEN_KEY) || [];
    var fresh = items.filter(function (it) { return seen.indexOf(it.id) < 0; });
    if (!fresh.length) return;

    fresh.forEach(function (it) { seen.push(it.id); });
    if (seen.length > 500) seen = seen.slice(-500);
    writeJSON(SEEN_KEY, seen);

    /* 画面が持っている会話に足してもらう。
       localStorage に書くだけでは画面に出てこない。画面は読み込んだときの
       写しを抱えたまま描いていて、その写しには入らないため。 */
    if (typeof window.camelliaAddMessage === "function") {
      fresh.forEach(function (it) {
        window.camelliaAddMessage("assistant", it.text || "", it.createdAt || "");
      });
      return;
    }

    /* 窓口が無いとき（古い画面が残っているなど）は、自分で足して出す。 */
    var v2 = readJSON("camellia-v2") || {};
    if (!Array.isArray(v2.chats)) v2.chats = [];
    fresh.forEach(function (it) {
      v2.chats.push({ role: "assistant", text: String(it.text || ""), at: it.createdAt || "" });
    });
    writeJSON("camellia-v2", v2);

    var chat = document.getElementById("chat");
    if (!chat) return;
    fresh.forEach(function (it) {
      var b = document.createElement("div");
      b.className = "bubble";
      b.textContent = String(it.text || "");
      chat.appendChild(b);
    });
    chat.scrollTop = chat.scrollHeight;
  }


  function start(auth) {
    CA = auth;
    if (!CA || !CA.user || !CA.fb || CA.blocker()) return;
    try {
      var q = CA.fb.query(
        CA.fb.collection(CA.db, "camellia_users", CA.user.uid, "admin", "replies", "items"),
        CA.fb.orderBy("createdAt", "asc"));
      CA.fb.onSnapshot(q, function (snap) {
        var items = [];
        snap.forEach(function (d) { items.push(Object.assign({ id: d.id }, d.data() || {})); });
        add(items);
      }, function (err) {
        /* 黙って握りつぶすと、届かない理由が誰にも分からない。 */
        console.warn("Camellia: 運営からの返事を受け取れません:", err && (err.code || err.message));
      });
    } catch (e) { /* 同上 */ }
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });
})();
