/* ══════════════════════════════════════════════════════════════
   話す相手を選ぶ

   ChatGPT や Claude と同じように、相手を選べるようにする。
   名前は Camellia のもの。中身のモデル名は画面に出さない。
   差し替えたときに、画面の言葉を直さずに済む。

   選んだものは設定（camellia-v2 の settings.aiModel）に残る。
   設定はサーバーへも写るので、端末を変えても引き継がれるし、
   管理画面からも「この方は誰と話しているか」が見える。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var API = "https://emu-realtime.onrender.com";

  /* 選んだ相手は専用の置き場に持つ。
     camellia-v2 の中に入れると、画面が持っている古い写しで上書きされて消える
     （画面は読み込み時の中身を抱えたまま、保存のたびに丸ごと書き戻すため）。 */
  var KEY = "camellia-ai-model";
  function current() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function save(key) {
    try { localStorage.setItem(KEY, key); } catch (e) {}
  }

  function paint(list, defaultKey) {
    var sel = document.getElementById("aiModel");
    var note = document.getElementById("aiModelNote");
    if (!sel) return;
    var cur = current() || defaultKey;

    sel.innerHTML = list.map(function (m) {
      return '<option value="' + m.key + '"' + (m.key === cur ? " selected" : "") + ">"
        + String(m.label).replace(/[&<>]/g, "") + "</option>";
    }).join("");

    var showNote = function () {
      var m = list.filter(function (x) { return x.key === sel.value; })[0];
      if (note) note.textContent = m ? m.note : "";
    };
    showNote();
    sel.onchange = function () { save(sel.value); showNote(); };

    /* まだ何も選んでいない人にも、既定を入れておく。
       入れておかないと、設定が空のままで管理画面から誰と話しているか分からない。 */
    if (!current()) save(cur);
  }

  async function start(auth) {
    if (!auth || !auth.user || auth.blocker()) return;
    var sel = document.getElementById("aiModel");
    if (!sel) return;
    try {
      var token = await auth.user.getIdToken();
      var r = await fetch(API + "/api/camellia/models", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var out = await r.json();
      paint(out.models || [], out.defaultKey || "");
    } catch (e) {
      /* 一覧が取れないときは、選択欄を出さない。
         中身の分からない選択肢を出すより、無いほうが混乱しない。 */
      /* 選択欄そのものを隠す。入れ物は入力欄の中なので、
         入れ物を隠すと送るボタンまで消える。 */
      sel.style.display = "none";
      var note = document.getElementById("aiModelNote");
      if (note) note.style.display = "none";
    }
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });
})();
