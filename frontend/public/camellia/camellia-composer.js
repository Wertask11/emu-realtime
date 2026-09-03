/* ══════════════════════════════════════════════════════════════
   Camellia AI の入力欄

   ChatGPT の入力欄と同じ組み方にする。
     ひとつの丸い枠の中に、文章を書くところ
     その下の段に ＋（取り込み）／話す相手／送るボタン

   もとの form（#chatForm）と入力欄の名前（message）は残す。
   送る処理は control-user.html にあり、そこを書き換えずに済む。

   ＋ からは、ChatGPT・Claude・ルナルナ の書き出しファイルを入れられる。
   設定画面まで行かなくても、話しながら渡せる。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SOURCES = [
    ["ChatGPT", "ChatGPT の書き出し"],
    ["Claude", "Claude の書き出し"],
    ["ルナルナ", "ルナルナの書き出し"],
    ["そのほか", "そのほかのファイル"]
  ];

  function css() {
    if (document.getElementById("camComposerStyle")) return;
    var s = document.createElement("style");
    s.id = "camComposerStyle";
    s.textContent =
      "#chatForm.cam-composer{display:block;background:#fff;border:1px solid var(--line);"
      + "border-radius:18px;padding:10px 12px 8px;margin-top:10px;position:relative}"
      + "#chatForm.cam-composer textarea{width:100%;border:0;outline:none;resize:none;"
      + "background:transparent;color:var(--deep);font:inherit;font-size:15px;line-height:1.6;"
      + "padding:4px 2px;min-height:30px;max-height:180px;overflow-y:auto}"
      + "#chatForm.cam-composer .row{display:flex;align-items:center;gap:8px;margin-top:4px}"
      + "#chatForm.cam-composer .sp{flex:1}"
      + "#chatForm.cam-composer .rbtn{width:32px;height:32px;border-radius:50%;border:1px solid var(--line);"
      + "background:#fff;color:var(--deep);cursor:pointer;font-size:17px;line-height:1;padding:0;"
      + "display:flex;align-items:center;justify-content:center}"
      + "#chatForm.cam-composer .rbtn:hover{background:var(--soft)}"
      + "#chatForm.cam-composer .send{background:var(--main);color:#fff;border-color:var(--main)}"
      + "#chatForm.cam-composer .send:disabled{opacity:.4;cursor:default}"
      + "#chatForm.cam-composer select{width:auto;border:0;background:transparent;color:var(--muted);"
      + "font:inherit;font-size:13px;padding:4px 2px;cursor:pointer}"
      /* ＋ を押したときに出る一覧 */
      + "#camPick{position:absolute;left:8px;bottom:52px;background:#fff;border:1px solid var(--line);"
      + "border-radius:12px;padding:6px;min-width:210px;box-shadow:0 14px 34px #4a243026;z-index:8}"
      + "#camPick button{display:block;width:100%;text-align:left;border:0;background:transparent;"
      + "color:var(--deep);padding:9px 11px;border-radius:8px;cursor:pointer;font:inherit;font-size:14px}"
      + "#camPick button:hover{background:var(--soft)}"
      + "#camPick .cap{font-size:11px;color:var(--muted);padding:4px 11px 6px}";
    document.head.appendChild(s);
  }

  function build() {
    var form = document.getElementById("chatForm");
    if (!form || form.classList.contains("cam-composer")) return;
    css();

    /* 話す相手の選択欄は、すでに上に置いてある。入力欄の中へ移す。 */
    var sel = document.getElementById("aiModel");
    var note = document.getElementById("aiModelNote");
    var selWrap = sel && sel.parentElement;

    form.classList.remove("compose");
    form.classList.add("cam-composer");
    form.innerHTML =
      '<textarea name="message" id="camInput" rows="1" placeholder="Camellia にメッセージ"></textarea>'
      + '<div class="row">'
      + '  <button type="button" class="rbtn" id="camPlus" title="取り込む">＋</button>'
      + '  <span class="sp"></span>'
      + '  <span id="camModelSlot"></span>'
      + '  <button type="submit" class="rbtn send" id="camSend" title="送る">↑</button>'
      + '</div>'
      + '<input type="file" id="camFile" accept=".json,.txt,.csv" style="display:none">';

    if (sel) {
      document.getElementById("camModelSlot").appendChild(sel);
      if (note) note.remove();
      /* 入れ物ごと消す。ラベル（話す相手）だけが上に取り残されるため。 */
      if (selWrap) selWrap.remove();
    }

    var input = document.getElementById("camInput");
    var send = document.getElementById("camSend");

    /* 高さを中身に合わせる。1行のときは1行、書けば伸びる。 */
    function grow() {
      input.style.height = "auto";
      /* 空のときに 0 近くまで縮んで、書く場所が見えなくなることがある。下限を置く。 */
      input.style.height = Math.max(30, Math.min(input.scrollHeight, 180)) + "px";
      send.disabled = !input.value.trim();
    }
    input.addEventListener("input", grow);
    grow();
    /* 文字の読み込みが終わってから測り直す。先に測ると小さく出る。 */
    setTimeout(grow, 300);
    window.addEventListener("load", grow);

    /* Enter で送る。改行は Shift + Enter。 */
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (input.value.trim()) form.requestSubmit();
      }
    });
    /* 送ったあと、高さと送るボタンを戻す。 */
    form.addEventListener("submit", function () { setTimeout(grow, 0); });

    wireAttach(form);
  }

  function wireAttach(form) {
    var plus = document.getElementById("camPlus");
    var file = document.getElementById("camFile");
    var picking = "";

    function close() {
      var old = document.getElementById("camPick");
      if (old) old.remove();
    }

    plus.onclick = function (e) {
      e.stopPropagation();
      if (document.getElementById("camPick")) { close(); return; }
      var box = document.createElement("div");
      box.id = "camPick";
      box.innerHTML = '<div class="cap">書き出したファイルを渡す</div>'
        + SOURCES.map(function (s) {
            return '<button type="button" data-src="' + s[0] + '">' + s[1] + "</button>";
          }).join("");
      box.onclick = function (ev) {
        var src = ev.target && ev.target.getAttribute("data-src");
        if (!src) return;
        picking = src;
        close();
        file.value = "";
        file.click();
      };
      form.appendChild(box);
    };
    document.addEventListener("click", close);

    file.onchange = async function () {
      var f = file.files && file.files[0];
      if (!f || !picking) return;
      if (typeof window.camelliaImport !== "function") return;
      try {
        await window.camelliaImport(picking, f);
        /* 渡したことが会話に残るようにする。何を渡したか、あとから分かる。 */
        if (typeof window.camelliaAddMessage === "function") {
          window.camelliaAddMessage("user", picking + " の記録を渡しました（" + f.name + "）");
        }
      } catch (e) {
        alert("取り込めませんでした（" + (e && e.message) + "）");
      }
      picking = "";
    };
  }

  /* 話す相手の選択欄は、あとから作られる（camellia-model.js が一覧を取ってから）。
     組み替えたあとに来たときも、入力欄の中へ入るようにする。 */
  function watchModel() {
    var n = 0;
    var t = setInterval(function () {
      if (++n > 30) return clearInterval(t);
      var sel = document.getElementById("aiModel");
      var slot = document.getElementById("camModelSlot");
      if (sel && slot && sel.parentElement !== slot) {
        var wrap = sel.parentElement;
        slot.appendChild(sel);
        var note = document.getElementById("aiModelNote");
        if (note) note.remove();
        if (wrap && wrap.id !== "camModelSlot") wrap.remove();
      }
    }, 500);
  }

  function start() { build(); watchModel(); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
