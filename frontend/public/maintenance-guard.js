/* ══════════════════════════════════════════════════════════════
   メンテナンス・ガード（Camellia / Heartoo / SchoolPark）

   index.html の中だけで止めても、これらのページは静的HTMLなので
   URLを直接開けば入れてしまう。ホームページや過去に共有された
   リンクからの流入も同じ。ここで各ページ自身にも同じ判定を置く。

   判定はウォレットアドレスのみ。ログイン方法（メール / Google / LINE /
   ウォレット）に関係なく、オーナーのアドレスでなければ止める。
   CHESユーザーは uid から決定論的にアドレスが作られるため、
   オーナー以外は必ず別のアドレスになる。

   再開するときは index.html の BRAND_MAINTENANCE と、
   このファイルの MAINTENANCE を false にする。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var MAINTENANCE = true;
  var OWNER = "0xdcc687c05f130e57597a8525771299a4efb6edf7";

  if (!MAINTENANCE) return;

  function currentAddress() {
    try {
      // 親（index.html）の中で開かれている場合も見る
      var fromParent = "";
      try {
        if (window.parent && window.parent !== window && window.parent.connectedAccount) {
          fromParent = String(window.parent.connectedAccount);
        }
      } catch (e) { /* 別オリジンなら読めない。無視してよい */ }
      return String(
        fromParent ||
        window.connectedAccount ||
        localStorage.getItem("emuWallet") ||
        ""
      ).toLowerCase();
    } catch (e) { return ""; }
  }

  if (currentAddress() === OWNER.toLowerCase()) return;

  // 画面を差し替える。中身を一瞬でも見せないよう、DOMを待たずに実行する。
  function paint() {
    var html =
      '<div style="position:fixed;inset:0;z-index:2147483647;background:#faf8f5;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Hiragino Sans\',\'Noto Sans JP\',sans-serif;">' +
      '<div style="max-width:420px;text-align:center;color:#1a1840;">' +
      '<p style="font-size:11px;letter-spacing:.18em;color:#8b8698;margin:0 0 14px;">CHES</p>' +
      '<h1 style="font-size:22px;line-height:1.6;margin:0 0 14px;">ただいま準備中です</h1>' +
      '<p style="font-size:14px;line-height:1.9;color:#6f6a86;margin:0 0 26px;">' +
      'よりよい形でお届けするため、一時的に公開を停止しています。<br>' +
      '再開までもうしばらくお待ちください。</p>' +
      '<p style="font-size:13px;line-height:1.9;color:#6f6a86;margin:0 0 22px;">' +
      'Emu は通常どおりご利用いただけます。</p>' +
      '<a href="/" style="display:inline-block;background:#f08300;color:#fff;text-decoration:none;' +
      'border-radius:999px;padding:14px 28px;font-weight:700;font-size:14px;">Emu へ行く</a>' +
      '</div></div>';
    document.documentElement.innerHTML = "<head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>準備中 | CHES</title></head><body>" + html + "</body>";
  }

  if (document.readyState === "loading") {
    // 読み込み中でも中身が動き出さないよう、その場で止めてから差し替える
    document.addEventListener("DOMContentLoaded", paint);
    try { document.documentElement.style.visibility = "hidden"; } catch (e) {}
    document.addEventListener("DOMContentLoaded", function () {
      try { document.documentElement.style.visibility = ""; } catch (e) {}
    });
  } else {
    paint();
  }
})();
