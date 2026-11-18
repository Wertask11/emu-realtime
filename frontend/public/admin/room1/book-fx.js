/* Knowledge Text：本を開くと、中からいろいろなものが飛び出して、最後に本文が出る（11/18 オーナー）
   もとの openPost（本文を出す処理）はそのまま使う。その前に演出をはさむだけ。
   ・押すと（どこでも）とばせる。Esc でもとばせる
   ・動きを減らす設定の端末では、演出をせずにすぐ本文を出す */
(function () {
  "use strict";
  if (typeof window.openPost !== "function") return;
  var original = window.openPost;
  var THINGS = {
    money: ["💰", "🪙", "📈", "🏦", "💴", "🐷", "💡", "✨"],
    net: ["📱", "💬", "🔒", "🌐", "🛡️", "📷", "💡", "✨"],
    life: ["🌱", "💗", "🧘", "🍳", "🤝", "☀️", "💡", "✨"],
    blue: ["📘", "🏆", "🎯", "💡", "🧭", "🚀", "🔥", "✨"]
  };
  var COLORS = { money: ["#ef7d00", "#f6a64a"], net: ["#2f7dd1", "#62a8f0"], life: ["#3c9b62", "#6fcf93"], blue: ["#1f4f9c", "#4d7fd0"] };
  var LABEL = { money: "MONEY LITERACY", net: "NET LITERACY", life: "LIFE LITERACY", blue: "BLUE FILE" };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function themeOf(post) {
    var t = String((post && post.theme) || (typeof currentMode !== "undefined" ? currentMode : "") || "");
    return THINGS[t] ? t : (typeof currentMode !== "undefined" && THINGS[currentMode] ? currentMode : "blue");
  }
  var busy = false;
  function reveal(index) {
    original(index);
    var body = document.getElementById("detailBody");
    if (body) { body.classList.remove("bk-reveal"); void body.offsetWidth; body.classList.add("bk-reveal"); }
    var detail = document.getElementById("detail");
    if (detail && detail.scrollIntoView) detail.scrollIntoView({ block: "start" });
  }
  window.openPost = function (index) {
    var hits = typeof currentHits !== "undefined" ? currentHits : [];
    var post = hits[index];
    if (!post || reduced() || busy) return reveal(index);
    busy = true;
    var theme = themeOf(post), things = THINGS[theme], color = COLORS[theme] || COLORS.blue;
    var title = post.summary || post.subSubTheme || post.subTheme || "Knowledge Text";
    var fly = "";
    for (var i = 0; i < 14; i++) {
      var ang = (i / 14) * Math.PI * 2 - Math.PI / 2, dist = 120 + (i % 3) * 45;
      fly += '<span style="--x:' + Math.round(Math.cos(ang) * dist * 1.35) + 'px;--y:' + Math.round(Math.sin(ang) * dist - 40) + 'px;--r:' + ((i * 47) % 70 - 35) + 'deg;--d:' + (0.85 + (i % 7) * 0.07).toFixed(2) + 's;--s:' + (28 + (i % 3) * 8) + 'px">' + things[i % things.length] + "</span>";
    }
    for (var k = 0; k < 16; k++) {
      var a2 = (k / 16) * Math.PI * 2;
      fly += '<i style="--x:' + Math.round(Math.cos(a2) * 200) + 'px;--y:' + Math.round(Math.sin(a2) * 160) + 'px;--d:' + (0.8 + (k % 4) * 0.08).toFixed(2) + 's"></i>';
    }
    var stage = document.createElement("div");
    stage.className = "bk-stage";
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-label", "本を開いています");
    stage.innerHTML = '<p class="bk-title">' + esc(title) + "</p>"
      + '<div class="bk-book" style="--b1:' + color[0] + ";--b2:" + color[1] + '"><div class="bk-back"></div><div class="bk-pages"><i></i><i></i><i></i></div>'
      + '<div class="bk-cover"><small>' + esc(LABEL[theme] || "KNOWLEDGE TEXT") + "</small>" + esc(title) + "</div></div>"
      + '<div class="bk-glow" aria-hidden="true"></div><div class="bk-fly" aria-hidden="true">' + fly + "</div>"
      + '<p class="bk-tap">タップでとばす</p>';
    document.body.appendChild(stage);
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      stage.remove();
      busy = false;
      reveal(index);
    }
    function onKey(e) { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(); }
    stage.addEventListener("click", finish);
    document.addEventListener("keydown", onKey);
    var timer = setTimeout(finish, 2650);
  };
})();
