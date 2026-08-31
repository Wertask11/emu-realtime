/* ══════════════════════════════════════════════════════════════
   Camellia の入口

   Camellia は自前のログインを持たない。
   Emu・SchoolPark と同じ Firebase のセッションをそのまま使う。
   （理由は camellia-auth.js の頭に書いてある）

   入り方は2つ:
     ① SchoolPark のサイドバー → Camellia
        親（Emu）の中の iframe で開かれる。
        LINE や Google のログイン画面は iframe の中では開けないので、
        ログインが要るときは親のほうを動かす。
     ② ホームページ → もっと詳しく見る → 無料ではじめる
        ふつうのページとして開かれる。

   出す画面は4通り:
     未ログイン           … Emuでログインする
     ログイン済み・Emu未経験 … 一度Emuを開いてもらう
     ログイン済み・初回      … 生年月日と同意を聞く
     2回目以降            … そのまま入れる
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var inFrame = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();

  function css() {
    if (document.getElementById("camelliaGateStyle")) return;
    var s = document.createElement("style");
    s.id = "camelliaGateStyle";
    s.textContent =
      "#camelliaGate{border:1px solid var(--line);border-radius:16px;max-width:520px;color:var(--deep);padding:24px}"
      + "#camelliaGate::backdrop{background:#28151bc7}"
      + "#camelliaGate h2{margin:0 0 10px}"
      + "#camelliaGate .error{color:#8b2635;margin-top:10px;min-height:1.2em}"
      + "#camelliaGate .pass{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;"
      + "word-break:break-all;background:var(--soft);border-radius:9px;padding:10px;margin:10px 0}"
      + "#camelliaGate .agree{display:flex;gap:9px;align-items:flex-start;margin:14px 0;line-height:1.7}"
      + "#camelliaGate .agree input{width:auto;margin-top:3px;flex:0 0 auto}"
      + "#camelliaGate .note{color:var(--muted);font-size:12px;line-height:1.8}";
    document.head.appendChild(s);
  }

  function open(html) {
    css();
    var old = document.getElementById("camelliaGate");
    if (old) old.remove();
    var d = document.createElement("dialog");
    d.id = "camelliaGate";
    d.innerHTML = html;
    document.body.appendChild(d);
    d.showModal();
    return d;
  }

  /* ログインへ送る。iframe の中なら、親ごと動かす。 */
  function goLogin() {
    try { sessionStorage.setItem("camellia_return", location.pathname + location.search); } catch (e) {}
    if (inFrame) {
      /* 親が別ドメインだと触れない。そのときは新しいタブで開く。 */
      try { window.top.location.href = "/"; return; } catch (e) {}
      window.open("/", "_blank");
      return;
    }
    location.href = "/";
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ───── ① ログインしていない ───── */
  function paintNeedLogin() {
    var d = open(
      '<h2>Camelliaへようこそ</h2>'
      + '<p>Camellia は、SchoolPark のアカウントでそのまま使えます。'
      + '新しく登録する必要はありません。</p>'
      + '<p class="note">Emu・SchoolPark・Camellia・Heartoo は、どこから入っても同じ一人として扱われます。'
      + 'すでに Emu をお使いなら、そのアカウントがそのまま使えます。</p>'
      + '<button class="btn primary" id="cgLogin" style="margin-top:14px">ログインする</button>'
    );
    d.querySelector("#cgLogin").onclick = goLogin;
  }

  /* ───── ② ログインはしているが、パスポートがまだ無い ───── */
  function paintNeedEmu() {
    var d = open(
      '<h2>もう少しで使えます</h2>'
      + '<p>SchoolPark パスポートがまだ作られていません。'
      + '一度 Emu を開くと自動で作られます。手続きはありません。</p>'
      + '<p class="note">パスポートは、あなたの記録をどの端末からでも取り出すための番号です。'
      + 'Emu・SchoolPark・Camellia・Heartoo で共通のものを使います。</p>'
      + '<button class="btn primary" id="cgEmu" style="margin-top:14px">Emuを開く</button>'
    );
    d.querySelector("#cgEmu").onclick = goLogin;
  }

  /* ───── ③ 初回だけ、生年月日と同意を聞く ───── */
  function paintIntake(CA) {
    var name = (CA.account && CA.account.displayName) || "";
    var d = open(
      '<h2>Camelliaへようこそ</h2>'
      + (name ? '<p>' + esc(name) + 'さん、はじめまして。</p>' : '')
      + '<p>ログインは済んでいます。はじめに2つだけ確認させてください。</p>'
      + '<div class="pass">SchoolPark パスポート<br>' + esc(CA.passport) + '</div>'
      + '<form id="cgForm">'
      + '  <div class="field"><label>生年月日</label>'
      + '    <input name="birthDate" type="date" required></div>'
      + '  <label class="agree"><input name="eligible" type="checkbox" required>'
      + '    18〜45歳の女性向けプラットフォームの対象であることを確認します</label>'
      + '  <label class="agree"><input name="health" type="checkbox" required>'
      + '    Camellia に記録する心と体の状態（気分・症状・服薬・月経など）を、'
      + '    わたしの記録として保存することに同意します</label>'
      + '  <p class="note">これらは「要配慮個人情報」にあたります。'
      + '  あなたの記録として保存し、あなた以外には見せません。'
      + '  いつでも削除できます。</p>'
      + '  <button class="btn primary" style="margin-top:6px">はじめる</button>'
      + '  <div class="error" id="cgErr"></div>'
      + '</form>'
    );
    var err = d.querySelector("#cgErr");
    d.querySelector("#cgForm").onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      err.textContent = "";
      try {
        await CA.saveIntake(f.get("birthDate"), true);
        d.close(); d.remove();
        if (typeof window.CamelliaGateDone === "function") window.CamelliaGateDone(CA);
      } catch (ex) {
        var m = {
          OUT_OF_RANGE: "登録対象は18〜45歳です。",
          BAD_BIRTH: "生年月日をご確認ください。",
          NOT_AGREED: "確認にチェックを入れてください。",
          NOT_READY: "まだ準備ができていません。少し待ってからお試しください。"
        };
        err.textContent = m[ex && ex.message] || ("保存できませんでした（" + (ex && ex.message) + "）");
        btn.disabled = false;
      }
    };
  }

  /* 準備ができたら、その人の状態に応じて出し分ける。 */
  function decide(CA) {
    var b = CA.blocker();
    if (b === "needLogin") return paintNeedLogin();
    if (b === "needEmu") return paintNeedEmu();
    if (b === "needIntake") return paintIntake(CA);
    var old = document.getElementById("camelliaGate");
    if (old) { try { old.close(); } catch (e) {} old.remove(); }
    if (typeof window.CamelliaGateDone === "function") window.CamelliaGateDone(CA);
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(decide);
  else window.addEventListener("camellia-auth", function (e) { decide(e.detail); }, { once: true });
})();
