/* ══════════════════════════════════════════════════════════════
   Passport ができた直後に出す画面

   一般クエスト #005 の年末目標は「SP Passport 500〜1,000件発行」。
   ところが #005 の招待で完走できるのは1人1件なので、100人が完走しても
   積み上がるのは100件しかない。500件には届かない。

   届かせるには、招待された人が次の招待者になる連鎖が要る。
   その連鎖の起点がここ。発行できた瞬間に「次はあなたが届ける番」まで
   一息で見せる。あとから案内しても、その人はもう画面を離れている。

   出す相手は「いま初めて番号ができた人」だけ。サーバーが resolve の
   返事に isNew を入れていて、それが schoolpark-id の催しで届く。
   同じ番号には二度出さない（localStorage に印を置く）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SEEN_KEY = "sp_passport_welcome_seen";
  var QUEST_LABEL = "一般クエスト #005「SchoolParkを、誰かに届ける」";

  function seen(spid) {
    try { return (localStorage.getItem(SEEN_KEY) || "") === String(spid); }
    catch (e) { return false; }
  }
  function markSeen(spid) {
    try { localStorage.setItem(SEEN_KEY, String(spid)); } catch (e) { }
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function close() {
    var el = document.getElementById("spPassportWelcome");
    if (el) { try { el.remove(); } catch (e) { } }
  }

  /* SchoolPark を開く。クエストの一覧はあちらにある。
     開き方は index.html が持っているので、あれば借りる。 */
  function goSchoolPark() {
    close();
    if (typeof window.openSpDao === "function") { try { window.openSpDao(); return; } catch (e) { } }
    try { location.href = "/schoolpark/dao.html"; } catch (e) { }
  }

  function paint(data) {
    close();
    var spid = String((data && data.schoolParkId) || "");
    var box = document.createElement("div");
    box.id = "spPassportWelcome";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "spwTitle");
    box.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;"
      + "align-items:center;justify-content:center;padding:20px;"
      + "background:rgba(20,18,24,.74);backdrop-filter:blur(4px)";
    box.innerHTML =
      '<div style="max-width:440px;width:100%;background:#1E1B24;color:#F4F1EA;'
      + 'border-radius:18px;padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.45);'
      + 'font-size:14px;line-height:1.9;max-height:90vh;overflow-y:auto">'

      + '<div style="font-size:10px;letter-spacing:.2em;color:rgba(244,241,234,.5);margin-bottom:10px">'
      + 'SCHOOLPARK PASSPORT</div>'
      + '<div id="spwTitle" style="font-size:19px;font-weight:700;margin-bottom:6px">'
      + 'パスポートができました</div>'
      + (spid
        ? '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;'
          + 'letter-spacing:.04em;background:rgba(244,241,234,.07);border-radius:9px;'
          + 'padding:10px 12px;margin:10px 0 14px;word-break:break-all">' + esc(spid) + '</div>'
        : '')
      + '<p style="margin:0 0 18px;color:rgba(244,241,234,.78)">'
      + 'ここから先、やったこと・学んだことは、この番号に積み上がっていきます。'
      + '消えませんし、持ち運べます。</p>'

      /* ここが連鎖の起点。祝って終わらせない。 */
      + '<div style="border-top:1px solid rgba(244,241,234,.14);padding-top:16px">'
      + '<div style="font-size:16px;font-weight:700;margin-bottom:8px">'
      + '次は、あなたが誰かに届ける番</div>'
      + '<p style="margin:0 0 6px;color:rgba(244,241,234,.78)">'
      + esc(QUEST_LABEL) + ' を受けると、'
      + 'あなたが誘った人がパスポートを作った時点で完走になります。</p>'
      + '<p style="margin:0 0 14px;color:rgba(244,241,234,.55);font-size:12px">'
      + '完走すると 100 EMUER・信用スコア +10・星空に星が1つ増えます。'
      + '（EMUER の受け取りにはウォレットが要ります）</p>'

      /* 共有の口。中身は share-invite.js が入れる。
         まだ読み込まれていなければ、ここは空のまま出す。 */
      + '<div id="spwShare" style="margin:0 0 14px"></div>'

      + '<div style="display:flex;flex-direction:column;gap:10px">'
      + '<button type="button" id="spwGo" style="width:100%;padding:13px;border:0;border-radius:12px;'
      + 'background:#D0E2BE;color:#1E1B24;font-weight:700;font-size:14px;cursor:pointer">'
      + 'クエスト #005 を見る</button>'
      + '<button type="button" id="spwLater" style="width:100%;padding:12px;'
      + 'border:1px solid rgba(244,241,234,.25);border-radius:12px;background:transparent;'
      + 'color:#F4F1EA;font-size:14px;cursor:pointer">あとで</button>'
      + '</div></div>';

    document.body.appendChild(box);

    var go = box.querySelector("#spwGo");
    var later = box.querySelector("#spwLater");
    if (go) go.onclick = goSchoolPark;
    if (later) later.onclick = close;
    /* 外側を押しても閉じる。中は閉じない。 */
    box.addEventListener("click", function (ev) { if (ev.target === box) close(); });

    /* 読み込み中の覆いが残っていると、この上に重なって固まって見える。 */
    if (typeof window._hideSpLoadingOverlay === "function") {
      try { window._hideSpLoadingOverlay(); } catch (e) { }
    }
    try { if (go) go.focus(); } catch (e) { }

    /* 共有ボタンを入れる相手が居れば、入れてもらう。 */
    try {
      if (window.SpShareInvite && typeof window.SpShareInvite.mount === "function") {
        window.SpShareInvite.mount(box.querySelector("#spwShare"), { from: "welcome" });
      }
    } catch (e) { }
    return box;
  }

  /* 番号ができた催し。初めての人にだけ出す。 */
  window.addEventListener("schoolpark-id", function (ev) {
    var d = ev && ev.detail;
    if (!d || !d.isNew || !d.schoolParkId) return;
    if (seen(d.schoolParkId)) return;
    markSeen(d.schoolParkId);
    try { paint(d); } catch (e) { }
  });

  /* 手で出せるようにしておく（確かめ用・あとから見たい人用）。 */
  window.SpPassportWelcome = {
    show: paint,
    close: close,
    seen: seen,
    markSeen: markSeen
  };
})();
