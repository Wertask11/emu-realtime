/* Knowledge Lab・Knowledge Text を Emu の中（パソコンで左のメニューの右）に開いているとき、
   html に emu-embedded を付ける（11/7）。そのときは画面の上の帯（← 戻る・冷蔵庫くん）を出さない。
   左のメニューと Emu の上の帯（冷蔵庫くん）がそのまま使えるため。
   11/17 オーナー：スマホ（700px 以下）も同じにする。Emu の上の帯（Emu for SchoolPark・プロフィール・冷蔵庫くん）と
   下のナビを残し、そのあいだに出す。戻るのは下のナビから。
   タブレット（画面いっぱいで開く）や、単独で開いたときは付けない（「← 戻る」が要る）。 */
(function () {
  'use strict';
  function check() {
    var on = false;
    try { on = window.parent !== window && window.parent.document.body.classList.contains('sp-room-embed') && (window.parent.innerWidth >= 1025 || window.parent.innerWidth <= 700); } catch (_) {}
    document.documentElement.classList.toggle('emu-embedded', on);
  }
  check();
  window.addEventListener('resize', check);
  document.addEventListener('DOMContentLoaded', check);
})();
