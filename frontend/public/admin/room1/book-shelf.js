/* Knowledge Text の本棚と、本を開く演出のつなぎ（11/18 オーナー：「リアルじゃないから Claude Design に直させる」→ 受け取ったものを組み込む）
   見た目と演出は book-fx.css / book-fx.js（Claude Design）。ここは、いまのページの一覧を本棚の形に置き換えるだけ。
   ・テーマ（どれを磨く？）・BLUE FILE の小見出し・コンテンツの一覧を、本棚の本にする
   ・テーマの本は押すと、いままでどおりその一覧へ（演出なし）
   ・コンテンツの本を押すと、本を開く演出 → 本文（本文の出し方 openPost はそのまま）
   ・押す／Esc でとばせる。動きを減らす設定では演出なし（book-fx.js が決める） */
(function () {
  "use strict";
  if (!window.BookFX || typeof window.openPost !== "function") return;
  var LABEL = { money: "マネーリテラシー", net: "ネットリテラシー", life: "ライフリテラシー", blue: "BLUE FILE" };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mode() { return typeof currentMode !== "undefined" && LABEL[currentMode] ? currentMode : "money"; }
  function themeOf(post) { return post && LABEL[post.theme] ? post.theme : mode(); }

  /* 本棚1段ぶんの HTML。books は { title, label, theme, attrs } */
  function shelf(heading, books) {
    var t = mode();
    return '<div class="bfx-shelf"><div class="bfx-theme" data-theme="' + t + '">'
      + '<div class="bfx-theme__head"><span class="bfx-theme__tag">' + esc(LABEL[t]) + '</span><h2>' + esc(heading) + '</h2></div>'
      + '<div class="bfx-case"><div class="bfx-row">'
      + books.map(function (b) {
        return '<button type="button" class="bfx-book" data-bfx-manual data-theme="' + b.theme + '" data-title="' + esc(b.title) + '"'
          + (b.label ? ' data-label="' + esc(b.label) + '"' : '') + (b.tip ? ' title="' + esc(b.tip) + '"' : '') + b.attrs + '></button>';
      }).join("")
      + '</div></div></div></div>';
  }

  /* ── テーマの一覧（どれを磨く？） ── */
  function dressList() {
    var list = document.getElementById("list");
    if (!list || !list.querySelector(".grid")) return;
    var books = [].map.call(list.querySelectorAll(".grid .card"), function (card) {
      var h = card.querySelector("h2"), p = card.querySelector("p");
      return { title: h ? h.textContent : card.textContent, label: p ? p.textContent : "", tip: p ? p.textContent : "",
        theme: mode(), attrs: ' onclick="' + esc(card.getAttribute("onclick") || "") + '"' };
    });
    list.innerHTML = shelf("どれを磨く？", books);
    BookFX.init(list);
  }
  /* ── BLUE FILE の小見出し ── */
  function dressSub() {
    var ul = document.getElementById("subList");
    if (!ul) return;
    var host = document.getElementById("bfxSubShelf");
    if (!host) { host = document.createElement("div"); host.id = "bfxSubShelf"; ul.insertAdjacentElement("afterend", host); }
    ul.hidden = true;
    var title = (document.getElementById("subTitle") || {}).textContent || "";
    var books = [].map.call(ul.querySelectorAll("li"), function (li) {
      return { title: li.textContent, label: title, theme: "blue", attrs: ' onclick="' + esc(li.getAttribute("onclick") || "") + '"' };
    });
    host.innerHTML = shelf("どれを読む？", books);
    BookFX.init(host);
  }
  /* ── コンテンツの一覧 ── */
  function dressHits() {
    var box = document.getElementById("detailList");
    var body = document.getElementById("detailBody");
    if (body && !body.innerHTML.trim()) body.classList.remove("bfx-reader", "bfx-in");
    if (!box || !box.querySelector(".card")) return;
    var hits = typeof currentHits !== "undefined" ? currentHits : [];
    var books = hits.map(function (h, i) {
      var t = themeOf(h);
      return { title: h.summary || "学習コンテンツ", label: "", theme: t,
        tip: h.createdAt ? new Date(h.createdAt).toLocaleDateString() : "", attrs: ' data-index="' + i + '" onclick="openPost(' + i + ')"' };
    });
    box.innerHTML = shelf("どれを読む？", books);
    BookFX.init(box);
  }

  function wrap(name, after) {
    var fn = window[name];
    if (typeof fn !== "function") return;
    window[name] = function () { var r = fn.apply(this, arguments); try { after(); } catch (e) { console.error("book-shelf:", e); } return r; };
  }
  wrap("renderList", function () { dressList(); var s = document.getElementById("bfxSubShelf"); if (s) s.innerHTML = ""; });
  wrap("openBlueMain", dressSub);
  wrap("renderHitList", dressHits);
  wrap("openDetail", dressHits);

  /* ── 本を開く：演出 → 本文 ── */
  var original = window.openPost;
  function reveal(index) {
    original(index);
    var body = document.getElementById("detailBody");
    if (body && body.innerHTML.trim()) {
      body.classList.add("bfx-reader");
      body.classList.remove("bfx-in"); void body.offsetWidth; body.classList.add("bfx-in");
    }
    var detail = document.getElementById("detail");
    if (detail && detail.scrollIntoView) detail.scrollIntoView({ block: "start" });
  }
  window.openPost = function (index) {
    var hits = typeof currentHits !== "undefined" ? currentHits : [];
    var post = hits[index];
    if (!post) return original(index);
    var book = document.querySelector('#detailList .bfx-book[data-index="' + index + '"]');
    if (!book) {   // リンクで直接開いたとき（棚に本が無い）
      book = document.createElement("button");
      book.dataset.theme = themeOf(post);
      book.dataset.title = post.summary || post.subSubTheme || post.subTheme || "Knowledge Text";
    }
    var done = false;
    BookFX.open(book, { onOpen: function () { if (done) return; done = true; reveal(index); } });
  };

  /* 最初の表示がもう済んでいたら、その分も本棚にする */
  dressList();
})();
