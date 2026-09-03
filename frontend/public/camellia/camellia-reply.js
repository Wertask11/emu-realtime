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
    var v2 = readJSON("camellia-v2") || {};
    if (!Array.isArray(v2.chats)) v2.chats = [];
    var added = 0;

    items.forEach(function (it) {
      if (seen.indexOf(it.id) >= 0) return;
      seen.push(it.id);
      v2.chats.push({ role: "assistant", text: String(it.text || ""), at: it.createdAt || "" });
      added++;
    });

    if (!added) return;
    /* 控えは増え続けるので、新しいほうから決めた数だけ持つ。 */
    if (seen.length > 500) seen = seen.slice(-500);
    writeJSON(SEEN_KEY, seen);
    writeJSON("camellia-v2", v2);

    /* 画面に出す。会話の描き直しは control-user.html 側が持っている。 */
    if (typeof window.renderChats === "function") {
      try { window.renderChats(); } catch (e) {}
    } else {
      var chat = document.getElementById("chat");
      if (chat) {
        items.slice(-added).forEach(function (it) {
          var b = document.createElement("div");
          b.className = "bubble";
          b.textContent = String(it.text || "");
          chat.appendChild(b);
        });
        chat.scrollTop = chat.scrollHeight;
      }
    }
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
      }, function () { /* 読めなくても画面は動かす */ });
    } catch (e) { /* 同上 */ }
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });
})();
