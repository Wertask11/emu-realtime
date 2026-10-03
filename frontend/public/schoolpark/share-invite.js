/* ══════════════════════════════════════════════════════════════
   招待リンクを配る（一般クエスト #005）

   #005 は「発信」か「招待」のどちらか片方で完走する。
   どちらも、いまは手でやることになっている。
     発信 … 自分で文面を書いて、リンクを貼って、URLを報告する
     招待 … 相手の名前を聞いて報告し、運営が発行日を照合する

   ここで両方を一押しにする。合言葉つきのリンクから入ってパスポートが
   できれば、サーバーが「誰の招待か」を自分で数える。
   運営の照合も、参加者の報告も、手で書くところが消える。

   文面に気をつけること:
     ・EMUER を「儲かる」「値上がりする」のように投資として書かない
       （#005 の参加のルール。ここで配る文面が、そのまま使われる）
     ・約束するのは「残ること」で、「増えること」ではない
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var API = (window.CHES_CONFIG && window.CHES_CONFIG.identityEndpoint)
    || "https://emu-realtime.onrender.com/api/identity";
  var SITE = "https://schoolpark-emu.vercel.app";
  var LAND = "/invite.html";

  /* 配る文面。ここを直せば、共有ボタン・コピー・動画の台本がそろう。 */
  var TEXT = "学んだこと・やったことが、ひとつのパスポートに記録されていく場所をつくっています。\n"
    + "最初の一歩は3分。ウォレットは要りません。";

  var cache = null;      /* { code, total } 一度取れば使い回す */
  var busy = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function linkFor(code) { return SITE + LAND + "?ref=" + encodeURIComponent(code); }

  async function headers() {
    if (typeof window.emuAuthHeaders !== "function") throw new Error("NO_AUTH");
    return window.emuAuthHeaders(false, { interactive: false });
  }

  /* 自分の合言葉。サーバーが無ければ一度だけ作って返す。 */
  async function code() {
    if (cache && cache.code) return cache;
    if (busy) return busy;
    busy = (async function () {
      try {
        var res = await fetch(API + "/invite", { headers: await headers(), cache: "no-store" });
        var data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok || !data || !data.code) {
          throw new Error((data && data.error) || ("invite " + res.status));
        }
        cache = { code: String(data.code), total: Number(data.total) || 0 };
        return cache;
      } finally { busy = null; }
    })();
    return busy;
  }

  function openWin(url) {
    try { window.open(url, "_blank", "noopener,noreferrer"); }
    catch (e) { try { location.href = url; } catch (e2) { } }
  }

  function shareX(url) {
    openWin("https://x.com/intent/post?text=" + encodeURIComponent(TEXT)
      + "&url=" + encodeURIComponent(url));
  }
  function shareLine(url) {
    openWin("https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(url)
      + "&text=" + encodeURIComponent(TEXT));
  }
  async function copy(url, btn) {
    var body = TEXT + "\n" + url;
    try {
      await navigator.clipboard.writeText(body);
      if (btn) { var was = btn.textContent; btn.textContent = "コピーしました"; setTimeout(function () { btn.textContent = was; }, 1600); }
      return true;
    } catch (e) {
      /* クリップボードを使えない端末がある。選んで写せる形で出す。 */
      try { window.prompt("この文をコピーしてください", body); } catch (e2) { }
      return false;
    }
  }
  /* 端末の共有（Instagram・メール・その他）。あるときだけ出す。 */
  function canNative() { return typeof navigator !== "undefined" && typeof navigator.share === "function"; }
  async function native(url) {
    try { await navigator.share({ title: "SchoolPark", text: TEXT, url: url }); return true; }
    catch (e) { return false; }
  }

  var BTN = "display:block;width:100%;padding:11px;border-radius:10px;font-size:13px;"
    + "font-weight:700;cursor:pointer;border:0;text-align:center";

  /* 受け皿の中に、共有の一式を描く。
     合言葉がまだ取れていなければ「読み込み中」を出し、
     取れなかったら理由を出す（黙って消えると、壊れたのと見分けが付かない）。 */
  function mount(el, opts) {
    if (!el) return null;
    var o = opts || {};
    el.innerHTML = '<div style="font-size:12px;color:rgba(244,241,234,.6)">招待リンクを用意しています…</div>';

    code().then(function (got) {
      var url = linkFor(got.code);
      el.innerHTML =
        '<div style="font-size:12px;color:rgba(244,241,234,.6);margin-bottom:6px">'
        + 'あなたの招待リンク'
        + (got.total > 0 ? '（これまで ' + got.total + '人）' : '')
        + '</div>'
        + '<div class="spsi-url" style="font-size:11px;font-family:ui-monospace,Menlo,Consolas,monospace;'
        + 'background:rgba(244,241,234,.07);border-radius:8px;padding:9px 10px;margin-bottom:10px;'
        + 'word-break:break-all;color:rgba(244,241,234,.85)">' + esc(url) + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
        + '<button type="button" data-s="x" style="' + BTN + ';background:#F4F1EA;color:#15131a">Xで共有</button>'
        + '<button type="button" data-s="line" style="' + BTN + ';background:#06C755;color:#fff">LINEで送る</button>'
        + '</div>'
        + '<button type="button" data-s="copy" style="' + BTN + ';background:transparent;'
        + 'border:1px solid rgba(244,241,234,.25);color:#F4F1EA;margin-top:8px">文とリンクをコピー</button>'
        + (canNative()
          ? '<button type="button" data-s="native" style="' + BTN + ';background:transparent;'
            + 'border:1px solid rgba(244,241,234,.25);color:#F4F1EA;margin-top:8px">ほかのアプリで共有</button>'
          : '');

      el.querySelectorAll("[data-s]").forEach(function (b) {
        b.onclick = function () {
          var kind = b.getAttribute("data-s");
          if (kind === "x") shareX(url);
          else if (kind === "line") shareLine(url);
          else if (kind === "copy") copy(url, b);
          else if (kind === "native") native(url);
          try { window.dispatchEvent(new CustomEvent("sp-invite-shared", { detail: { kind: kind, from: o.from || "" } })); } catch (e) { }
        };
      });
    }).catch(function (e) {
      var why = String((e && e.message) || "");
      el.innerHTML = '<div style="font-size:12px;color:rgba(244,241,234,.6)">'
        + (why.indexOf("NO_PASSPORT") >= 0
          ? 'パスポートができてから、招待リンクをお渡しします。'
          : '招待リンクを用意できませんでした。あとでもう一度お試しください。')
        + '</div>';
    });
    return el;
  }

  /* どこからでも開ける小窓。設定パネルなどから呼ぶ。 */
  function open() {
    var old = document.getElementById("spInviteSheet");
    if (old) { try { old.remove(); } catch (e) { } }
    var box = document.createElement("div");
    box.id = "spInviteSheet";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;"
      + "align-items:center;justify-content:center;padding:20px;"
      + "background:rgba(20,18,24,.74);backdrop-filter:blur(4px)";
    box.innerHTML =
      '<div style="max-width:420px;width:100%;background:#1E1B24;color:#F4F1EA;'
      + 'border-radius:18px;padding:24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.45);'
      + 'font-size:14px;line-height:1.9;max-height:90vh;overflow-y:auto">'
      + '<div style="font-size:17px;font-weight:700;margin-bottom:6px">SchoolParkを、誰かに届ける</div>'
      + '<p style="margin:0 0 14px;color:rgba(244,241,234,.7);font-size:13px">'
      + 'このリンクから入った人がパスポートを作ると、一般クエスト #005 の完走として数えられます。</p>'
      + '<div id="spInviteShare"></div>'
      + '<button type="button" id="spInviteClose" style="width:100%;padding:12px;margin-top:14px;'
      + 'border:1px solid rgba(244,241,234,.25);border-radius:12px;background:transparent;'
      + 'color:#F4F1EA;font-size:14px;cursor:pointer">閉じる</button>'
      + '</div>';
    document.body.appendChild(box);
    box.querySelector("#spInviteClose").onclick = function () { try { box.remove(); } catch (e) { } };
    box.addEventListener("click", function (ev) { if (ev.target === box) { try { box.remove(); } catch (e) { } } });
    mount(box.querySelector("#spInviteShare"), { from: "sheet" });
    return box;
  }

  window.SpShareInvite = {
    mount: mount, open: open, code: code, linkFor: linkFor,
    text: TEXT, site: SITE, landing: LAND
  };
})();
