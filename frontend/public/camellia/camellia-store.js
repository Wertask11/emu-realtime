/* ══════════════════════════════════════════════════════════════
   Camellia の記録を、サーバー（Firestore）に置く

   これまで記録はこの端末の中（localStorage）にしかなかった。
   端末を変えると消え、運営からも見えなかった。

   画面の作りには触らない。
   localStorage への書き込みを見張って、同じ中身をサーバーへ写す。
   画面はこれまでどおり localStorage を読み書きするだけでよい。
   何百行もある画面を書き換えずに済み、書き換え漏れも起きない。

   置き場所:
     camellia_users/{uid}                    生年月日・同意（camellia-auth.js が書く）
     camellia_users/{uid}/daily/{2026-09-02}  その日の記録
     camellia_users/{uid}/profile/basic       表示名・生年・職業・目標
     camellia_users/{uid}/profile/settings    設定
     camellia_users/{uid}/profile/location    位置情報
     camellia_users/{uid}/profile/chat        AIとの会話（新しい200件まで）
     camellia_users/{uid}/profile/personality 性格診断の結果
     camellia_users/{uid}/profile/control     支配構造シミュレーションの状態

   読めるのは本人だけ（firestore.rules）。
   運営はサーバー（Admin SDK）を通して管理画面から見る。

   プロフィール画像とコミュニティ投稿は、ここでは扱わない。
   画像は Storage が使えないので当面この端末だけ。
   コミュニティは camellia-community.js が別に扱う（みんなに見えるため）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CHAT_KEEP = 200;       /* 会話は新しいほうから、この件数まで置く */
  var IMPORT_KEEP = 150000;  /* 取り込んだ中身を、サーバーへ置く文字数の上限 */
  var WAIT = 1500;          /* まとめて送るまでの待ち時間（ミリ秒） */

  var KEYS = [
    "camellia-v2",
    "camellia-daily-full",
    "camellia-daily-history",
    "camellia-personality-full",
    "camellia-control-state",
    "camellia-activity",
    "camellia-ai-model"
  ];

  var CA = null, timer = null, ready = false;

  /* 運営が入れている機構。観察が切られていたら、送るものを減らす。
     これまでは切っても送っていたので、スイッチが飾りになっていた。 */
  var ctrl = {};
  function observing() { return ctrl.observe !== false; }

  /* ───── 行動の記録 ─────
     どの画面をいつ開いたか、誘導を出して押したか。
     観察が切られているときは、何も残さない。 */
  var ACT_KEY = "camellia-activity";
  var ACT_KEEP = 300;
  window.CamelliaActivity = {
    note: function (kind, extra) {
      if (!observing()) return;
      var list = readJSON(ACT_KEY) || [];
      list.push(Object.assign({ kind: String(kind), at: new Date().toISOString() }, extra || {}));
      if (list.length > ACT_KEEP) list = list.slice(-ACT_KEEP);
      writeJSON(ACT_KEY, list);
    }
  };

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function isEmpty(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v).length === 0;
    return false;
  }

  function ref(kind, id) {
    return CA.fb.doc(CA.db, "camellia_users", CA.user.uid, kind, id);
  }

  /* ───── 変わったものだけ送る ─────

     何かひとつ保存するたびに全部送っていると、
     記録が1年ぶん貯まった人は、1回の保存で365件書くことになる。
     Firebase の無料枠は1日20,000件なので、すぐ足りなくなる。

     いちど送った中身の指紋を控えておき、同じものは送らない。
     指紋は端末に残すので、開き直しても送り直さない。 */
  var SENT_KEY = "camellia-store-sent";
  var sent = readJSON(SENT_KEY) || {};

  function fingerprint(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + ":" + s.length;
  }
  function changed(path, data) {
    var f = fingerprint(JSON.stringify(data));
    if (sent[path] === f) return false;
    sent[path] = f;
    return true;
  }

  /* ───── 端末 → サーバー ───── */
  async function push() {
    if (!ready) return;
    var v2 = readJSON("camellia-v2") || {};
    var now = new Date().toISOString();
    var jobs = [];

    var put = function (kind, id, data) {
      if (isEmpty(data)) return;
      if (!changed(kind + "/" + id, data)) return;
      jobs.push(CA.fb.setDoc(ref(kind, id),
        Object.assign({}, data, { updatedAt: now }), { merge: true }));
    };

    put("profile", "basic", v2.profile);
    /* 話す相手の選択も設定の一部として送る。管理画面から見えるようにする。 */
    put("profile", "settings", Object.assign({}, v2.settings || {},
      { aiModel: (function(){ try { return localStorage.getItem("camellia-ai-model") || ""; } catch(e){ return ""; } })() }));

    /* ほかのアプリから取り込んだもの（ChatGPT・Claude・ルナルナなど）。
       1つの文書に入る大きさには上限（1MB）がある。日本語は1文字3バイトに
       なるので、文字数で切っておかないと入りきらない。
       全文はこの端末に残る。 */
    var imports = v2.imports || {};
    Object.keys(imports).forEach(function (k) {
      var im = imports[k] || {};
      var body = String(im.content || "");
      put("imports", k, {
        name: im.name || "",
        characters: Number(im.characters) || body.length,
        importedAt: im.importedAt || "",
        content: body.slice(0, IMPORT_KEEP),
        truncated: body.length > IMPORT_KEEP
      });
    });
    put("profile", "personality", readJSON("camellia-personality-full"));
    put("profile", "control", readJSON("camellia-control-state"));

    /* ここから下は「観察」が入っているときだけ送る。
       位置情報・会話・行動は、その人の記録そのものではなく、
       見るために集めるもの。切ったら集めない。 */
    if (observing()) {
      put("profile", "location", v2.location);
      /* 会話は多くなるので、新しいほうから決めた件数だけ。
         1つの文書に入る大きさには上限（1MB）があり、全部は入らない。 */
      var chats = v2.chats;
      if (Array.isArray(chats) && chats.length) {
        put("profile", "chat", { messages: chats.slice(-CHAT_KEEP), total: chats.length });
      }
      var acts = readJSON(ACT_KEY);
      if (Array.isArray(acts) && acts.length) {
        put("profile", "activity", { events: acts, total: acts.length });
      }
    }

    /* 日々の記録は、日付を文書のIDにする。同じ日は上書きになる。
       管理画面は新しい順に並べて出すので、IDが日付だと並べ替えが要らない。 */
    var seen = {};
    var one = function (d) {
      if (!d || !d.date || seen[d.date]) return;
      seen[d.date] = true;
      if (!changed("daily/" + d.date, d)) return;
      jobs.push(CA.fb.setDoc(ref("daily", String(d.date)),
        Object.assign({}, d, { updatedAt: now }), { merge: true }));
    };
    one(readJSON("camellia-daily-full"));
    (readJSON("camellia-daily-history") || []).forEach(one);

    if (!jobs.length) return;
    try {
      await Promise.all(jobs);
      writeJSON(SENT_KEY, sent);       /* 送れたぶんだけ、控えを残す */
    } catch (e) {
      /* 送れなかったものは控えから外す。次に必ずやり直せるように。 */
      sent = readJSON(SENT_KEY) || {};
      console.warn("Camellia: 記録を送れませんでした:", e && e.message);
    }
  }

  function schedulePush() {
    clearTimeout(timer);
    timer = setTimeout(push, WAIT);
  }

  /* ───── サーバー → 端末 ─────
     この端末に無いものだけ入れる。
     すでに端末にあるものは触らない。書きかけを消してしまわないため。 */
  async function pull() {
    var got = {};
    try {
      var snap = await CA.fb.getDocs(
        CA.fb.collection(CA.db, "camellia_users", CA.user.uid, "profile"));
      snap.forEach(function (d) { got[d.id] = d.data() || {}; });
    } catch (e) {
      console.warn("Camellia: 記録を読めませんでした:", e && e.message);
      return;
    }

    var v2 = readJSON("camellia-v2") || {};
    var touched = false;
    [["basic", "profile"], ["settings", "settings"], ["location", "location"]]
      .forEach(function (pair) {
        var from = got[pair[0]];
        if (from && isEmpty(v2[pair[1]])) {
          v2[pair[1]] = strip(from);
          touched = true;
        }
      });
    if (got.chat && Array.isArray(got.chat.messages) && isEmpty(v2.chats)) {
      v2.chats = got.chat.messages;
      touched = true;
    }
    if (touched) writeJSON("camellia-v2", v2);

    if (got.personality && isEmpty(readJSON("camellia-personality-full"))) {
      writeJSON("camellia-personality-full", strip(got.personality));
    }
    if (got.control && isEmpty(readJSON("camellia-control-state"))) {
      writeJSON("camellia-control-state", strip(got.control));
    }

    /* 日々の記録 */
    if (isEmpty(readJSON("camellia-daily-history"))) {
      try {
        var ds = await CA.fb.getDocs(
          CA.fb.collection(CA.db, "camellia_users", CA.user.uid, "daily"));
        var list = [];
        ds.forEach(function (d) { list.push(Object.assign({ date: d.id }, strip(d.data() || {}))); });
        list.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
        if (list.length) {
          writeJSON("camellia-daily-history", list);
          writeJSON("camellia-daily-full", list[list.length - 1]);
        }
      } catch (e) {
        console.warn("Camellia: 日々の記録を読めませんでした:", e && e.message);
      }
    }
  }

  /* サーバーの都合で足した欄は、端末には戻さない。 */
  function strip(o) {
    var c = Object.assign({}, o);
    delete c.updatedAt;
    return c;
  }

  /* ───── localStorage への書き込みを見張る ─────
     画面はこれまでどおり localStorage に書く。
     その書き込みを捕まえて、同じ中身をサーバーへ送る。 */
  function watch() {
    var origin = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      origin(key, value);
      if (KEYS.indexOf(key) >= 0) schedulePush();
    };
    /* ほかのタブで書き換わったときも拾う */
    window.addEventListener("storage", function (e) {
      if (e && KEYS.indexOf(e.key) >= 0) schedulePush();
    });
    /* 閉じる直前に、待っているぶんを送り切る */
    window.addEventListener("pagehide", function () {
      clearTimeout(timer);
      push();
    });
  }

  async function start(auth) {
    CA = auth;
    /* 門を通っていない人は、まだ置き場所が無い（生年月日と同意がまだ）。 */
    if (!CA || !CA.user || !CA.fb || CA.blocker()) return;
    ready = true;

    /* 先に、運営が入れている機構を読む。観察が切られていれば送るものを減らす。 */
    try {
      var c = await CA.fb.getDoc(
        CA.fb.doc(CA.db, "camellia_users", CA.user.uid, "admin", "control"));
      ctrl = c.exists() ? (c.data() || {}) : {};
    } catch (e) { ctrl = {}; }

    /* 観察が切られたら、集めた行動の記録は持たない。 */
    if (!observing()) { try { localStorage.removeItem(ACT_KEY); } catch (e) {} }

    /* どの画面を開いたかを控える。 */
    document.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest("nav.nav button[data-page]");
      if (b) window.CamelliaActivity.note("open", { page: b.dataset.page });
    });

    watch();
    await pull();
    await push();          /* この端末にしか無かったぶんを、はじめに送る */
  }

  if (window.CamelliaAuth) window.CamelliaAuth.onReady(start);
  else window.addEventListener("camellia-auth", function (e) { start(e.detail); }, { once: true });

  /* 門を通り終えた直後にも動かす（同意した直後は blocker が消えている）。

     CamelliaGateDone は user-db-sync.js も入れていて、そちらは
     restore-location.js から後から読み込まれる。ふつうに代入すると
     どちらかが消える。読み込みの順番に左右されないよう、
     入れ物のほうを差し替えて、あとから入ったものと並べて呼ぶ。 */
  var chain = window.CamelliaGateDone;
  try {
    Object.defineProperty(window, "CamelliaGateDone", {
      configurable: true,
      get: function () {
        return function (auth) {
          try { if (typeof chain === "function") chain(auth); } catch (e) {}
          start(auth || window.CamelliaAuth);
        };
      },
      set: function (fn) { chain = fn; }
    });
  } catch (e) {
    window.CamelliaGateDone = function (auth) {
      try { if (typeof chain === "function") chain(auth); } catch (e2) {}
      start(auth || window.CamelliaAuth);
    };
  }
})();
