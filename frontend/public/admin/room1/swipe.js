/* Knowledge Text：スマホだけ、分野（マネー・ネット・ライフ・BLUE FILE）を左右のスワイプで切り替える（11/20 オーナー）。
   ・パソコン（761px 以上）は今までどおり上のボタン。ここは何もしない
   ・スマホは上の大きなボタンの代わりに、いまの位置の点（押しても切り替わる）と「左右にスワイプで切り替え」を出す
   ・スワイプを見るのは「どれを磨く？」の本棚（#list）だけ。本文・小見出しの画面では切り替えない
   ・縦のスクロールは邪魔しない（横に大きく動いたときだけ切り替える）
   ・切り替えの中身は今までの switchMode をそのまま使う */
(function () {
  "use strict";
  if (typeof window.switchMode !== "function") return;
  var ORDER = ["money", "net", "life", "blue"];
  var LABEL = { money: "マネーリテラシー", net: "ネットリテラシー", life: "ライフリテラシー", blue: "ブルーファイル" };
  var phone = window.matchMedia ? window.matchMedia("(max-width: 760px)") : { matches: false, addListener: function () {} };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var bar = document.querySelector(".mode-btns");
  var list = document.getElementById("list");
  if (!bar || !list) return;

  var css = document.createElement("style");
  css.textContent =
    ".kt-swipe{display:none}" +
    "@media(max-width:760px){" +
    ".mode-btns{display:none!important}" +
    ".kt-swipe{display:flex;flex-direction:column;align-items:center;gap:6px;margin:0 0 14px}" +
    ".kt-swipe__dots{display:flex;gap:10px;align-items:center}" +
    ".kt-swipe__dot{appearance:none;width:12px;height:12px;padding:0;border-radius:50%;border:2px solid #3a2a20;background:#fffaf0;cursor:pointer}" +
    ".kt-swipe__dot[aria-current=\"true\"]{background:#3a2a20;width:28px;border-radius:999px}" +
    ".kt-swipe__dot:focus-visible{outline:3px solid #b85f00;outline-offset:2px}" +
    ".kt-swipe__hint{font-size:12px;color:#6e5a48;margin:0}" +
    "#list{touch-action:pan-y}" +
    "#list.kt-in-left{animation:ktInLeft .22s ease}" +
    "#list.kt-in-right{animation:ktInRight .22s ease}" +
    "}" +
    "@keyframes ktInLeft{from{opacity:.2;transform:translateX(36px)}to{opacity:1;transform:none}}" +
    "@keyframes ktInRight{from{opacity:.2;transform:translateX(-36px)}to{opacity:1;transform:none}}";
  document.head.appendChild(css);

  var ind = document.createElement("div");
  ind.className = "kt-swipe";
  ind.innerHTML = '<div class="kt-swipe__dots" role="group" aria-label="分野"></div>'
    + '<p class="kt-swipe__hint">← 左右にスワイプで切り替え →</p>';
  bar.insertAdjacentElement("afterend", ind);
  var dots = ind.querySelector(".kt-swipe__dots");
  dots.innerHTML = ORDER.map(function (m) {
    return '<button type="button" class="kt-swipe__dot" data-mode="' + m + '" aria-label="' + LABEL[m] + '"></button>';
  }).join("");

  function cur() { return (typeof currentMode !== "undefined" && ORDER.indexOf(currentMode) >= 0) ? currentMode : "money"; }
  function paint() {
    var m = cur();
    [].forEach.call(dots.children, function (b) { b.setAttribute("aria-current", b.getAttribute("data-mode") === m ? "true" : "false"); });
  }
  function go(mode, dir) {
    if (mode === cur()) return;
    window.switchMode(mode);
    paint();
    if (!reduce && dir) {
      list.classList.remove("kt-in-left", "kt-in-right");
      void list.offsetWidth;
      list.classList.add(dir > 0 ? "kt-in-left" : "kt-in-right");
    }
  }
  dots.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".kt-swipe__dot");
    if (!b) return;
    var to = b.getAttribute("data-mode");
    go(to, ORDER.indexOf(to) - ORDER.indexOf(cur()));
  });
  list.addEventListener("animationend", function () { list.classList.remove("kt-in-left", "kt-in-right"); });

  /* 上のボタンで切り替えたときも、点をそろえる */
  var original = window.switchMode;
  window.switchMode = function (mode) { var r = original.apply(this, arguments); paint(); return r; };

  var sx = 0, sy = 0, st = 0, tracking = false;
  list.addEventListener("touchstart", function (e) {
    tracking = false;
    if (!phone.matches || !e.touches || e.touches.length !== 1) return;
    if (list.style.display === "none") return;
    var t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now(); tracking = true;
  }, { passive: true });
  list.addEventListener("touchend", function (e) {
    if (!tracking || !phone.matches) return;
    tracking = false;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    /* 横に 50px 以上、縦の動きの 1.5 倍以上、1秒以内のときだけ。縦のスクロールや本を押すのは邪魔しない */
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - st > 1000) return;
    var i = ORDER.indexOf(cur()), next = dx < 0 ? i + 1 : i - 1;
    if (next < 0 || next >= ORDER.length) return;
    go(ORDER[next], dx < 0 ? 1 : -1);
  }, { passive: true });
  list.addEventListener("touchcancel", function () { tracking = false; }, { passive: true });

  paint();
  window.KnowledgeTextSwipe = { order: ORDER.slice(), go: function (m) { go(m, ORDER.indexOf(m) - ORDER.indexOf(cur())); } };
})();
