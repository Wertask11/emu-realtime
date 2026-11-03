/* 画面のエラーを運営に知らせる（11/3 点検 15）。
   これまでは、利用者のブラウザで起きたエラーを知る手段が無かった。

   送るのは「エラーの文（人につながる部分はサーバーでも伏せる）・このサイトのどのファイルの何行目か・どのページか」だけ。
   ログインの番号・ウォレット・名前・入力した文章・IP・端末の文字列は送らない。
   ほかのサイト（拡張機能など）のエラーは送らない。1ページで同じエラーは1回、合わせて5件まで。 */
(function () {
  "use strict";
  if (window.__emuClientErrors) return;
  window.__emuClientErrors = true;
  var API = "https://emu-realtime.onrender.com/api/client-errors";
  var sent = Object.create(null), count = 0;
  var IGNORE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured/i;

  function sameSite(url) {
    if (!url) return true;   // どこのファイルか分からないものは送る（サーバーでパスだけにする）
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  function report(kind, message, source, line, col) {
    message = String(message || "").slice(0, 300);
    if (!message || IGNORE.test(message) || !sameSite(source) || count >= 5) return;
    var key = kind + "|" + message + "|" + source + "|" + line;
    if (sent[key]) return;
    sent[key] = true; count += 1;
    var body = JSON.stringify({
      kind: kind, message: message, source: source || "", line: line || 0, col: col || 0,
      page: location.origin + location.pathname
    });
    try {
      /* text/plain にすると、ブラウザが前もって問い合わせずに送れる。ページを閉じる途中でも届くよう keepalive */
      fetch(API, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body, keepalive: true, credentials: "omit" })
        .catch(function () {});
    } catch (e) {}
  }

  window.addEventListener("error", function (e) {
    if (!e || e.target && e.target !== window) return;   // 画像などが読めなかっただけのものは除く
    report("error", e.message || (e.error && e.error.message), e.filename, e.lineno, e.colno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var message = r && (r.message || r.code) ? (r.name ? r.name + ": " : "") + (r.message || r.code) : String(r);
    var where = r && r.stack ? /(https?:\/\/[^\s)]+):(\d+):(\d+)/.exec(r.stack) : null;
    report("rejection", message, where ? where[1] : "", where ? Number(where[2]) : 0, where ? Number(where[3]) : 0);
  });
})();
