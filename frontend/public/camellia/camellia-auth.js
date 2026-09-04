/* ══════════════════════════════════════════════════════════════
   Camellia のログインと、SchoolParkパスポートの接続

   考え方:
     Camellia は自前のログインを持たない。
     Emu・SchoolPark と同じ Firebase のセッションをそのまま使う。
     同じドメインなので、Emu でログインしていればここでも入れている。

   なぜログインの仕組みを写さないか:
     ログインの本体（CHES）は index.html の中に664行あり、
     Emu 専用の関数を9つ借りている（読み込み中の演出・着地処理など）。
     切り出すと Emu のログインが壊れる危険があり、その代償が大きすぎる。
     写せば写したぶんだけ、あとで食い違う。
     管理画面（membership-admin.html）が同じやり方で動いているので、それに倣う。

   ここがやること:
     ① ログインしているかを見る。していなければ Emu へ送る
     ② ches_accounts/{uid} から SchoolParkパスポートの番号を読む
     ③ Camellia を使ってよい人かを確かめる（初回だけ、生年月日と同意）

   パスポート番号は Emu・SchoolPark・Camellia・Heartoo で共通。
   Camellia でだけ使う情報（生年月日など）は、パスポート側には置かない。
   必要な場所にだけ置く。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CFG = {
    apiKey: "AIzaSyBKHS1D8Or6gfMd4NbzhDI7dG5Je7BLtbs",
    authDomain: "schoolpark-emu.vercel.app",
    projectId: "emusch-2a111",
    storageBucket: "emusch-2a111.firebasestorage.app",
    messagingSenderId: "795496371585",
    appId: "1:795496371585:web:51deec91b8a2152e4c8480"
  };
  var SDK = "https://www.gstatic.com/firebasejs/10.8.0/";

  /* Camellia の対象。特商法・利用規約の記載と必ず同じにすること。 */
  var MIN_AGE = 18;
  var MAX_AGE = 45;

  var CA = {
    ready: false,
    user: null,          // Firebase のユーザー
    passport: "",        // SchoolParkパスポートの番号
    camelliaId: "",      // Camellia ID（門を通った人だけが持つ）
    account: null,       // ches_accounts の中身
    profile: null,       // camellia_users の中身（生年・同意など）
    fb: null             // Firestore の関数一式
  };
  window.CamelliaAuth = CA;

  var waiters = [];
  function announce() {
    CA.ready = true;
    waiters.splice(0).forEach(function (fn) { try { fn(CA); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent("camellia-auth", { detail: CA })); } catch (e) {}
  }
  /* 準備ができたら呼ぶ。すでに済んでいれば、その場で呼ぶ。 */
  CA.onReady = function (fn) {
    if (typeof fn !== "function") return;
    if (CA.ready) fn(CA); else waiters.push(fn);
  };

  /* 年齢を出す。生年月日から、今日時点の満年齢。 */
  CA.ageOf = function (birth) {
    if (!birth) return null;
    var d = new Date(birth);
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var age = now.getFullYear() - d.getFullYear();
    var m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  };
  CA.MIN_AGE = MIN_AGE;
  CA.MAX_AGE = MAX_AGE;

  /* Camellia を使い始める前に済ませることが残っているか。
       needLogin  … ログインしていない
       needEmu    … ログインはしているが、まだ Emu を一度も開いていない
       needIntake … 生年月日と同意がまだ
     どれでもなければ null。 */
  CA.blocker = function () {
    if (!CA.user) return "needLogin";
    if (!CA.passport) return "needEmu";
    if (!CA.profile || !CA.profile.birthDate || !CA.profile.agreedAt) return "needIntake";
    return null;
  };

  /* ───── Camellia ID ─────

     SchoolParkパスポートとは別のIDを持つ。
       SchoolParkパスポート … 全員が、ログインしたときに作られる
       Camellia ID          … Camellia を使う人だけが、門を通ったときに作られる

     18〜45歳の女性だけが2つを持ち、それ以外はパスポートだけになる。
     2つは camellia_users で紐づける。将来 KYC を入れるときも、
     両方に紐づける。

     パスポートから計算して作らない。計算で出せると、パスポート番号を
     知っている人が Camellia ID も分かってしまい、分けた意味がなくなる。
     その場で作った乱数を、一度だけ書いて持ち続ける。

     読み違えやすい文字（0 O 1 I）は使わない。人が声に出して伝えることがある。 */
  var ID_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  function makeCamelliaId() {
    var n = 12, out = "";
    var buf = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) {
      out += ID_CHARS[buf[i] % ID_CHARS.length];
      if (i === 3 || i === 7) out += "-";
    }
    return "CAM-" + out;
  }

  /* 初回の聞き取りを保存する。
     生年月日は Camellia のためだけに使うので、パスポート側には書かない。 */
  CA.saveIntake = async function (birthDate, agreed) {
    if (!CA.user || !CA.fb) throw new Error("NOT_READY");
    if (!agreed) throw new Error("NOT_AGREED");
    var age = CA.ageOf(birthDate);
    if (age === null) throw new Error("BAD_BIRTH");
    /* 対象は18〜45歳。範囲の外は登録できない。
       特商法・利用規約の記載と、ここの数字は必ず同じにすること。 */
    if (age < MIN_AGE || age > MAX_AGE) throw new Error("OUT_OF_RANGE");

    var rec = {
      uid: CA.user.uid,
      passport: CA.passport,
      birthDate: String(birthDate),
      ageAtSignup: age,
      agreedAt: new Date().toISOString(),
      agreedVersion: "2026-09-01",
      updatedAt: new Date().toISOString()
    };
    /* Camellia ID は一度だけ。すでにあるなら作り直さない。
       作り直すと、それまでの記録との結び付きが切れる。 */
    var had = (CA.profile && CA.profile.camelliaId) || "";
    rec.camelliaId = had || makeCamelliaId();
    await CA.fb.setDoc(CA.fb.doc(CA.db, "camellia_users", CA.user.uid), rec, { merge: true });
    CA.profile = Object.assign({}, CA.profile || {}, rec);
    CA.camelliaId = rec.camelliaId;
    return rec;
  };

  /* Emu のログイン画面へ送る。戻り先を控えておく。 */
  CA.goLogin = function () {
    try { sessionStorage.setItem("camellia_return", location.pathname + location.search); } catch (e) {}
    location.href = "/";
  };

  (async function boot() {
    var appMod, authMod, fsMod;
    try {
      appMod = await import(SDK + "firebase-app.js");
      authMod = await import(SDK + "firebase-auth.js");
      fsMod = await import(SDK + "firebase-firestore.js");
    } catch (e) {
      console.warn("Camellia: Firebase を読み込めませんでした:", e && e.message);
      announce();
      return;
    }
    var app = appMod.initializeApp(CFG);
    var auth = authMod.getAuth(app);
    CA.db = fsMod.getFirestore(app);
    CA.fb = fsMod;

    authMod.onAuthStateChanged(auth, async function (user) {
      CA.user = user || null;
      CA.passport = "";
      CA.account = null;
      CA.profile = null;
      CA.camelliaId = "";

      if (user) {
        try {
          var acc = await fsMod.getDoc(fsMod.doc(CA.db, "ches_accounts", user.uid));
          if (acc.exists()) {
            var d = acc.data() || {};
            CA.account = d;
            /* パスポート番号。CHESアドレスが正。
               古いアカウントには chesAddress が無いことがあるので、
               そのときは walletAddress を使う（Emu 側と同じ読み方）。 */
            CA.passport = String(d.chesAddress || d.walletAddress || "");
          }
        } catch (e) {
          console.warn("Camellia: パスポートを読めませんでした:", e && e.message);
        }
        if (CA.passport) {
          try {
            var me = await fsMod.getDoc(fsMod.doc(CA.db, "camellia_users", user.uid));
            if (me.exists()) CA.profile = me.data() || null;
            CA.camelliaId = (CA.profile && CA.profile.camelliaId) || "";
          } catch (e) {
            console.warn("Camellia: 利用者の記録を読めませんでした:", e && e.message);
          }
        }
      }
      announce();
    });
  })();
})();
