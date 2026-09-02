/* ══════════════════════════════════════════════════════════════
   Camellia の管理画面へ、本物の利用者を渡す

   管理画面（control-admin.html / control-admin-previous.html）は
   運営専用の membership-admin.html の中に、枠として置いてある。
   利用者の記録はサーバーにあり、読むには運営の鍵が要る。
   枠の中からは鍵を使えないので、外側から中へ渡す。

   これまでは架空の3人（Mina A-017 / Sora A-026 / Rin A-031）を
   その場で作って並べていた。本物と入れ替える。

   渡ってくるまでは、誰もいない状態で出す。
   架空の人を出しておくと、本物と見分けがつかなくなる。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  window.CamelliaMembers = window.CamelliaMembers || [];

  /* 数値を「不安6・ストレス7」のような一行にまとめる。
     記録がまだ無い人は空にする。無いものを 0 と書くと、
     「0だった」のか「書いていない」のかが分からなくなる。 */
  function line(rec, pairs) {
    if (!rec) return "";
    var out = [];
    pairs.forEach(function (p) {
      var v = rec[p[0]];
      if (v === undefined || v === null || v === "") return;
      out.push(p[1] + v + (p[2] || ""));
    });
    return out.join("・");
  }

  /* サーバーから来た形を、この画面が使ってきた形に合わせる。 */
  function toPersona(m) {
    var latest = (m.daily && m.daily.length) ? m.daily[0] : null;   /* 新しい順で届く */
    var loc = m.location;
    return {
      uid: m.uid,
      name: (m.name || "（お名前なし）") + (m.passport ? " " + m.passport.slice(0, 6) : ""),
      mind: line(latest, [["anxiety", "不安"], ["stress", "ストレス"], ["loneliness", "孤独感"]]) || "記録なし",
      body: line(latest, [["fatigue", "疲労"], ["sleep", "睡眠", "時間"]]) || "記録なし",
      location: loc && loc.latitude ? "取得済み" : "取得なし",
      behavior: latest ? ("最終記録 " + (latest.date || "")) : "記録なし",
      relations: "—",
      /* ここから下は、この画面の模型が使う目盛り。実データではない。
         本物の記録から決められる性質のものではないので、まん中に置く。 */
      resistance: 50, income: 50, support: 50
    };
  }

  function apply(members) {
    window.CamelliaMembers = (members || []).map(toPersona);
    try {
      window.dispatchEvent(new CustomEvent("camellia-members", {
        detail: window.CamelliaMembers
      }));
    } catch (e) {}
  }

  window.addEventListener("message", function (ev) {
    /* 外側は同じサイトなので、別のところから来たものは受け取らない。 */
    if (ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.type !== "camellia-members") return;
    apply(d.members);
  });

  /* 用意ができたことを外側へ伝える。外側はこれを見てから送る。 */
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "camellia-admin-ready" }, location.origin);
    }
  } catch (e) {}
})();
