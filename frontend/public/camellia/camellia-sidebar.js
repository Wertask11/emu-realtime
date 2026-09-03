/* ══════════════════════════════════════════════════════════════
   Camellia のサイドバー

   SchoolPark（dao.html）と同じ骨格にする:
     幅248px ／ 番号付きの並び ／ 左上でブランドを切り替え ／
     下にパスポート ／ ‹ で畳む

   色だけ Camellia のものにする。
   骨格を合わせるのは「同じ世界の別の場所」に見せるため、
   色を変えるのは、どのブランドに居るかが一目で分かるようにするため。

   もとの横並びタブ（nav.nav）は消さない。押す先として使い続ける。
   画面の作りに触らずに済み、タブが増えてもここが自動で追いつく。
   狭い画面ではサイドバーを畳み、もとの横並びに戻す。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var W = 248;                    /* dao.html と同じ幅 */
  var INK = "#2A1419";            /* Camellia の濃い色（門の背景と同じ系統） */
  var PAPER = "#FDF3F1";
  var ACCENT = "#E8A0A8";
  var ROSE = "#8B2635";

  var inFrame = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();
  var collapsed = false;
  try { collapsed = localStorage.getItem("camellia-side-collapsed") === "1"; } catch (e) {}

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function css() {
    if (document.getElementById("camSideStyle")) return;
    var s = document.createElement("style");
    s.id = "camSideStyle";
    s.textContent =
      "#camSide{position:fixed;left:0;top:0;bottom:0;width:" + W + "px;background:" + INK + ";"
      + "color:" + PAPER + ";display:flex;flex-direction:column;overflow-y:auto;z-index:60;"
      + "font-family:inherit}"
      + "#camSide.closed{width:0;overflow:hidden}"
      + "body.has-camside{padding-left:" + W + "px}"
      + "body.has-camside.side-closed{padding-left:0}"
      + "#camSide .head{padding:24px 18px 22px 24px;display:flex;align-items:flex-start;gap:12px;"
      + "border-bottom:1px solid rgba(253,243,241,.12)}"
      + "#camSide .name{font-size:23px;font-weight:900;letter-spacing:.02em;cursor:pointer}"
      + "#camSide .caret{font-size:12px;color:" + ACCENT + "}"
      + "#camSide .fold{width:32px;height:32px;border:1px solid rgba(253,243,241,.18);border-radius:7px;"
      + "display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;color:" + ACCENT + "}"
      + "#camSide .fold:hover{background:rgba(253,243,241,.1)}"
      + "#camSide .list{flex:1;padding:16px 12px;display:flex;flex-direction:column;gap:2px}"
      + "#camSide .item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:8px;"
      + "cursor:pointer;font-size:14px;font-weight:500;line-height:1.3;color:rgba(253,243,241,.72);"
      + "background:transparent;border:0;width:100%;text-align:left}"
      + "#camSide .item:hover{background:rgba(253,243,241,.09)}"
      + "#camSide .item.on{background:" + ROSE + ";color:" + PAPER + "}"
      + "#camSide .no{font-size:10px;letter-spacing:.12em;width:18px;opacity:.55}"
      + "#camSide .foot{padding:18px 20px 22px;border-top:1px solid rgba(253,243,241,.12);"
      + "display:flex;flex-direction:column;gap:12px}"
      + "#camSide .foot .cap{font-size:10px;letter-spacing:.2em;opacity:.5}"
      + "#camSide .who{display:flex;align-items:center;gap:10px;padding:4px 8px 6px;margin:0 -8px;"
      + "border-radius:8px;cursor:default}"
      + "#camSide .ic{width:32px;height:32px;border-radius:50%;background:" + ROSE + ";display:flex;"
      + "align-items:center;justify-content:center;font-size:13px;font-weight:700}"
      + "#camSide .pass{font-size:10px;letter-spacing:.1em;color:" + ACCENT + ";word-break:break-all}"
      /* ブランドの切り替え。寸法は SchoolPark（dao.html）と同じ値にそろえる。 */
      + "#camSide .brands{position:absolute;top:38px;left:0;z-index:20;min-width:168px;"
      + "background:#3A2026;border:1px solid rgba(253,243,241,.16);border-radius:10px;padding:6px;"
      + "display:flex;flex-direction:column;gap:2px;box-shadow:0 18px 40px -14px rgba(0,0,0,.7)}"
      + "#camSide .brands button{display:block;width:100%;text-align:left;border:0;"
      + "padding:9px 11px;border-radius:7px;cursor:pointer;font-size:14px;font-weight:700;"
      + "font-family:inherit}"
      + "#camSide .brands button:hover{background:rgba(253,243,241,.09)!important}"
      /* 畳んだときに戻す取っ手 */
      + "#camSideOpen{position:fixed;left:12px;top:12px;z-index:60;width:34px;height:34px;"
      + "border-radius:8px;border:1px solid rgba(42,20,25,.2);background:" + INK + ";color:" + ACCENT + ";"
      + "cursor:pointer;font-size:18px;display:none}"
      + "body.side-closed #camSideOpen{display:block}"
      /* もとの横並びタブは、広い画面では隠す（同じものが2つ出てしまう） */
      + "body.has-camside:not(.side-closed) nav.nav{display:none}"
      /* ヘッダーの「✿ Camellia／お名前」も隠す。サイドバーに同じものが出ていて、
         SchoolPark・Emu のヘッダーにはブランド名も名前も出ていない。
         畳んだときと狭い画面では、どこに居るか分からなくなるので戻す。 */
      + "body.has-camside header.top .brand{display:none}"
      /* ブランドを消すと、右にあったメニューが左へ寄ってしまう。右端に留める。 */
      + "body.has-camside header.top{justify-content:flex-end}"
      + "header.top .brand small{display:none}"
      /* 畳んだときは、取っ手のぶんだけヘッダーを右へずらす（文字と重なる） */
      + ""
      + "@media (max-width:900px){"
      + "  #camSide,#camSideOpen{display:none!important}"
      + "  body.has-camside{padding-left:0}"
      /* 狭い画面ではサイドバーを出さないので、もとの横並びを必ず戻す。
         ここを空文字にすると値として無効で、上の display:none が残り、
         行き先がひとつも出ない画面になる。 */
      + "  body.has-camside nav.nav{display:flex!important}"
      /* この幅ではサイドバーを出さないので、どこに居るか分かるよう見出しを戻す */
      + "  body.has-camside header.top .brand{display:block}"
      + "  body.has-camside header.top{justify-content:space-between}"
      + "}";
    document.head.appendChild(s);
  }

  /* もとのタブを読む。ここを正とするので、タブが増えても直さなくていい。 */
  function tabs() {
    return [].slice.call(document.querySelectorAll("nav.nav button[data-page]"));
  }

  function paintItems() {
    var list = document.getElementById("camSideList");
    if (!list) return;
    list.innerHTML = "";
    tabs().forEach(function (b, i) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "item" + (b.classList.contains("active") ? " on" : "");
      el.innerHTML = '<span class="no">' + ("0" + (i + 1)).slice(-2) + "</span>"
        + "<span>" + esc((b.textContent || "").trim()) + "</span>";
      /* もとのタブを押す。画面の切り替えはこれまでどおりの仕組みに任せる。 */
      el.onclick = function () { b.click(); setTimeout(paintItems, 0); };
      list.appendChild(el);
    });
  }

  function paintWho() {
    var CA = window.CamelliaAuth;
    var nameEl = document.getElementById("camSideWho");
    var passEl = document.getElementById("camSidePass");
    var icEl = document.getElementById("camSideIc");
    if (!nameEl) return;
    var name = (CA && CA.account && CA.account.displayName) || "";
    var pass = (CA && CA.passport) || "";
    nameEl.textContent = name || "ゲスト";
    if (icEl) icEl.textContent = name ? name.slice(0, 1) : "ー";
    if (passEl) {
      passEl.textContent = pass
        ? "パスポート " + pass.slice(0, 6) + "…" + pass.slice(-4)
        : "パスポートなし";
    }
  }

  /* サイドバーが出ているかどうかを親（Emu）に伝える。
     お問い合わせの丸ボタンは親のもので、サイドバーの上に重なる。
     SchoolPark も同じ考えで、出ていないあいだは引っ込めている。 */
  function tellParent(open) {
    if (!inFrame) return;
    try { window.parent.camelliaSideState(open); } catch (e) {}
  }

  function setCollapsed(v) {
    collapsed = v;
    document.body.classList.toggle("side-closed", v);
    var side = document.getElementById("camSide");
    if (side) side.classList.toggle("closed", v);
    try { localStorage.setItem("camellia-side-collapsed", v ? "1" : "0"); } catch (e) {}
    tellParent(!v && window.innerWidth > 900);
  }

  function build() {
    if (document.getElementById("camSide")) return;
    css();

    var side = document.createElement("div");
    side.id = "camSide";
    side.innerHTML =
      '<div class="head">'
      + '  <div style="display:flex;flex:1;flex-direction:column;gap:6px;position:relative" id="camSideBrandWrap">'
      + '    <div style="display:flex;align-items:center;gap:8px;cursor:pointer" title="ブランドを切り替える" id="camSideBrandBtn">'
      + '      <div class="name">Camellia</div>'
      + '      <div class="caret" id="camSideCaret">▾</div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="fold" id="camSideFold" title="サイドバーを閉じる">‹</div>'
      + '</div>'
      + '<div class="list" id="camSideList"></div>'
      + '<div class="foot">'
      + '  <div class="cap">SCHOOLPARK PASSPORT</div>'
      + '  <div class="who">'
      + '    <div class="ic" id="camSideIc">ー</div>'
      + '    <div style="display:flex;flex-direction:column;gap:2px;min-width:0">'
      + '      <div style="font-size:13px;font-weight:500" id="camSideWho">ゲスト</div>'
      + '      <div class="pass" id="camSidePass">パスポートなし</div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(side);

    var open = document.createElement("button");
    open.id = "camSideOpen";
    open.type = "button";
    open.title = "サイドバーを開く";
    open.textContent = "›";
    open.onclick = function () { setCollapsed(false); };
    document.body.appendChild(open);

    document.body.classList.add("has-camside");
    setCollapsed(collapsed);

    document.getElementById("camSideFold").onclick = function () { setCollapsed(true); };

    /* ブランドの切り替え。並び・色・寸法は SchoolPark（dao.html）と同じ。
       いま居るブランドも並べて、薄い下地を敷いて示す。
       色は各ブランドのもの。CHES_BRAND_PAGES とも合わせてある。 */
    var BRANDS = [
      ["camellia", "Camellia", "#E0576F"],
      ["emu", "Emu", "#F08300"],
      ["schoolpark", "SchoolPark", "#D0E2BE"]
    ];
    var HERE = "camellia";

    function closeBrands() {
      var old = side.querySelector(".brands");
      if (old) old.remove();
      var c = document.getElementById("camSideCaret");
      if (c) c.textContent = "▾";
    }

    document.getElementById("camSideBrandBtn").onclick = function (ev) {
      ev.stopPropagation();
      if (side.querySelector(".brands")) { closeBrands(); return; }
      var box = document.createElement("div");
      box.className = "brands";
      box.innerHTML = BRANDS.map(function (b) {
        return '<button data-b="' + b[0] + '" style="color:' + b[2] + ';background:'
          + (b[0] === HERE ? "rgba(253,243,241,.08)" : "transparent") + '">' + b[1] + "</button>";
      }).join("");
      box.onclick = function (e2) {
        var b = e2.target && e2.target.getAttribute("data-b");
        if (!b) return;
        closeBrands();
        if (b === HERE) return;                 /* いま居る場所なので何もしない */
        if (inFrame) {
          try {
            /* 先にこの枠を閉じる。閉じずに切り替えると、行った先が
               Camellia の後ろに出るだけで、見た目には何も起きない。 */
            window.parent.chesBrandFrameClose();
            window.parent.chesHubGo(b);
            return;
          } catch (e) {}
        }
        location.href = "/";
      };
      document.getElementById("camSideBrandWrap").appendChild(box);
      document.getElementById("camSideCaret").textContent = "▴";
    };
    /* ほかを押したら閉じる。開きっぱなしにならないように。 */
    document.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest("#camSideBrandWrap")) closeBrands();
    });

    paintItems();
    paintWho();

    /* もとのタブが別の場所から押されたときも、印を合わせる。 */
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("nav.nav")) setTimeout(paintItems, 0);
    });

    /* 幅が変わるとサイドバーの出方が変わる（900px以下では出さない）。
       親のお問い合わせボタンの出し入れも、それに合わせる。 */
    window.addEventListener("resize", function () {
      tellParent(!collapsed && window.innerWidth > 900);
    });
  }

  function start() {
    build();
    if (window.CamelliaAuth) window.CamelliaAuth.onReady(paintWho);
    else window.addEventListener("camellia-auth", paintWho, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
