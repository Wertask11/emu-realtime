/* ══════════════════════════════════════════════════════════════
   ホームの並べ替え

   もとのホームは、カードが上から下へ一列に積まれていた。
   広い画面では右が空き、下へ長く伸びていた。

     左  今日のデイリー記録（カレンダー）
     右  わたしのことを／Camellia AIから／みんなのところへ

   出さないもの:
     今日のCamellia    … 下のカレンダーと同じことを言っていて重なる
     位置情報          … 本人の画面に出す必要がない
     引き継いだ文脈    … 同上

   カードはあとから足されたり作り直されたりする
   （managed-settings.js が1秒ごとに見に来る）。
   一度並べて終わりにせず、崩れていたら並べ直す。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* 見出しで消す。作っている場所がばらばらなので、見出しで見るのが確実。 */
  var HIDE = ["今日のCamellia", "位置情報", "引き継いだ文脈"];

  function css() {
    if (document.getElementById("camHomeStyle")) return;
    var s = document.createElement("style");
    s.id = "camHomeStyle";
    s.textContent =
      /* 中身の入れ物は 820px で止まっていた。1列で読む前提の幅。
         サイドバーが出て2列になったぶん、そのままだと真ん中に寄って
         左右が大きく空く。サイドバーがあるときだけ広げる。 */
      "body.has-camside .app{max-width:1180px}"
      + "#camHomeGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}"
      + "#camHomeGrid > div > .card:last-child{margin-bottom:0}"
      /* サイドバーを閉じると、そのぶん横幅が空く。
         右を縦に3枚積んだままだと画面からはみ出して、下が見切れる。
         空いた幅を使って2列にすると、縦が半分になって一枚に収まる。 */
      /* 3枚の高さをそろえる。align-items:start だと中身の量で高さが変わり、
         「Camellia AIから」だけ小さく見えていた。
         行の高さを等しくし（grid-auto-rows:1fr）、カードは行いっぱいに伸ばす。 */
      + "body.side-closed #camHomeR{display:grid;grid-template-columns:1fr 1fr;"
      + "gap:14px;align-items:stretch;grid-auto-rows:1fr}"
      + "body.side-closed #camHomeR > .card{margin-bottom:0;height:100%;"
      + "display:flex;flex-direction:column}"
      /* 見出しと本文を上に、ボタンを下にそろえる。伸びたぶんが真ん中に空くと、
         3枚の見え方がばらばらになる。 */
      + "body.side-closed #camHomeR > .card > .btn{margin-top:auto;align-self:flex-start}"
      /* 閉じたときだけ出る横並びは、縦を詰めて置く */
      + "body.side-closed nav.nav{padding:9px}"
      + "@media(max-width:900px){#camHomeGrid{grid-template-columns:1fr}"
      + "body.side-closed #camHomeR{grid-template-columns:1fr}}";
    document.head.appendChild(s);
  }

  function tidy() {
    var home = document.querySelector("#home");
    if (!home) return;

    home.querySelectorAll(".card").forEach(function (c) {
      var h = c.querySelector("h2");
      if (h && HIDE.indexOf(h.textContent.trim()) >= 0) c.remove();
    });

    var cal = document.querySelector("#homeDailyCalendar");
    if (!cal) return;
    var dailyCard = cal.closest(".card");
    if (!dailyCard) return;
    var wrap = dailyCard.parentElement;
    if (!wrap || wrap.id === "camHomeL") {
      /* すでに左に入っている。右へ回すものが残っていないかだけ見る。 */
      wrap = document.getElementById("camHomeGrid");
      if (wrap) wrap = wrap.parentElement;
    }
    if (!wrap) return;

    css();
    var grid = document.getElementById("camHomeGrid");
    if (!grid) {
      grid = document.createElement("div");
      grid.id = "camHomeGrid";
      var L = document.createElement("div"); L.id = "camHomeL";
      var R = document.createElement("div"); R.id = "camHomeR";
      grid.appendChild(L); grid.appendChild(R);
      wrap.insertBefore(grid, wrap.firstChild);
    }
    var left = document.getElementById("camHomeL");
    var right = document.getElementById("camHomeR");
    if (!left || !right) return;

    if (dailyCard.parentElement !== left) left.appendChild(dailyCard);

    /* 左右の外に取り残されたカードを、右へ回す。
       managed-settings.js は「今日のデイリー記録」の直後に足すので、
       放っておくと左の列に紛れ込む。 */
    [].slice.call(wrap.children).forEach(function (c) {
      if (c === grid) return;
      if (c.classList && c.classList.contains("card")) right.appendChild(c);
    });
    [].slice.call(left.children).forEach(function (c) {
      if (c !== dailyCard) right.appendChild(c);
    });
  }

  function start() {
    tidy();
    /* カードはあとから足される。しばらく見張って、崩れていたら並べ直す。 */
    var n = 0;
    var t = setInterval(function () {
      if (++n > 60) return clearInterval(t);
      try { tidy(); } catch (e) {}
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
