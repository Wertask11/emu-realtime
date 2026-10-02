/* ══════════════════════════════════════════════════════════════
   Emu の画面文言（日本語）

   もとは日英中韓の4か国語を持ち、画面右上と SchoolPark の設定に
   切替を置いていた。使わないことにしたので、2026-10-02 に
   日本語だけにした。切替も、端末の言語からの推定も、
   localStorage の emu_lang も無くした。

   辞書そのものは残す。画面のあちこちから emuT() で引いていて、
   同じ言い回しを一か所にまとめておく値はそのままあるため。

   使い方:
     - HTML: <span data-i18n="tab.today">今日のEmu</span>
             属性に入れる場合は data-i18n-placeholder / data-i18n-title / data-i18n-aria
     - JS  : emuT('lb.toastGot', { n: 0.5 })

   ・辞書に無いキーは、キー名をそのまま返す。
   ・{name} のような波括弧は emuT の第2引数で置換する。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var EMU_I18N = {
    ja: {
      "header.searchPlaceholder": "検索...",
      "header.post": "投稿",
      "header.walletDisconnected": "ウォレット未接続",

      "home.title": "今日のEmu",
      "home.subtitle": "あなたの熱に、ついてこられる場所。",
      "home.tabsAria": "Emu画面",
      "tab.today": "今日のEmu",
      "tab.ichinichi": "一日シェア",
      "tab.feed": "知識を読む",
      "tab.requests": "知識を探す",
      "tab.discussion": "議論",

      "today.greeting": "こんにちは。今日は、どこから始める？",
      "today.greetingName": "{name}さん、今日はどこから始める？",
      "today.hint": "迷ったら、「今日の一歩」だけで大丈夫。",
      "today.step.title": "今日の一歩",
      "today.step.text": "誰かの体験から生まれた知識を1つ受け取る",
      "today.step.action": "読みに行く",
      "today.ichinichi.title": "今日の一日シェア",
      "today.ichinichi.text": "時間割を決めて、今日を有意義に",
      "today.ichinichi.action": "開く",
      "today.discussion.title": "開催中の議論",
      "today.discussion.loading": "今日の問いを読み込み中...",
      "today.discussion.action": "参加する",
      "today.request.title": "知識を探している人",
      "today.request.text": "あなたの経験を必要としている人を探す",
      "today.request.action": "募集を見る",
      "today.star.title": "あと{n}回の投稿行動で、新しい星",
      "today.star.text": "投稿・学び・議論で残した価値が、星空につながります。",

      "reward.badge": "現在の報酬",
      "reward.hint": "（　）内は、まだ実EMUERに換えていない分",
      "reward.nextLabel": "次の体験まで",
      "reward.note": "100 EMUERで特別体験と交換できます。",
      "reward.progressAria": "次の体験までの進み具合",
      "reward.uses": "使い道を見る",
      "unit.emuer": "EMUER",

      "lb.title": "今日のログインボーナス",
      "lb.note": "毎日ログインで +{n} EMUER",
      "lb.claim": "+{n} 受取",
      "lb.claimed": "受取済み",
      "lb.tomorrow": "また明日、受け取れます。",
      "lb.claimedElsewhere": "本日分は受取済みです（別の端末または自動付与）。また明日どうぞ。",
      "lb.unconverted": "まだ換えていない分：{n} EMUER",
      "lb.toastGot": "🎁 ログインボーナス +{n} EMUER",
      "lb.toastAlready": "本日はすでに受け取り済みです🧊",
      "lb.needWallet": "ウォレットを接続してください",
      "lb.failed": "受け取りに失敗しました",

      "uses.title": "EMUERでできること",
      "uses.desc": "集める理由を、獲得前から確認できます。",
      "uses.close": "閉じる",
      "uses.special.title": "特別な体験",
      "uses.special.text": "相談・イベント・限定企画への参加",
      "uses.special.badge": "みてみる",
      "uses.exchange": "取引所を見る",
      "uses.sp.title": "SchoolParkで利用",
      "uses.sp.text": "施設・遊び・サービスの利用へ",
      "uses.spAction": "SchoolParkへ",

      "profile.title": "あなたが渡した価値",
      "profile.desc": "日常の記録ではなく、誰かへ届き、改善され、学びになった価値だけを残します。",
      "profile.helpedPeople": "役に立った人",
      "profile.helpfulCount": "役に立った回数",
      "profile.acceptedChange": "採用したChange",
      "profile.changeGiven": "改善に参加",
      "profile.changeAccepted": "採用された改善",
      "profile.learned": "受け取った学び",
      "profile.delivered": "募集へ届けた知識",
      "profile.elevated": "学びへ昇華",
      "profile.noRecord": "記録なし",
      "unit.people": "{n}人",
      "unit.times": "{n}回",
      "unit.items": "{n}件",

      "wallet.title": "ウォレット",
      "wallet.desc": "渡した価値が、EMUERとして返ってきます。",
      "wallet.label": "使えるEMUER",
      "wallet.pendingLine": "（　）内の {n} EMUER は、まだ実EMUERに換えていない分です。",
      "wallet.convertNote": "実EMUERに換えるにはウォレットが必要です。ガス代（送金手数料）はご自身の負担になります。",
      "wallet.distributor": "実EMUERは運営のアドレス {address} から届きます。",
      "wallet.chesAddress": "あなたのCHESアドレス：{address}",
      "wallet.convert": "EMUERに変換",
      "wallet.exchange": "みてみる",
      "wallet.noBadges": "称号はまだありません",
      "wallet.convertUnavailable": "変換機能を利用できません。",
  "wallet.convertLocked": "いまは変換できません。無料パスは毎週月曜日のみ、パスがない場合は変換をご利用いただけません。",
  "dsc.disconnected": "接続が切れています。ページを再読み込みしてから、もう一度お試しください。",
  "exchange.loading": "交換できる体験を読み込んでいます…",
  "exchange.freeLimit": "無料パスの方は、毎週月曜日のみ交換できます。",
  "exchange.unavailable": "いま取引所に接続できません。時間をおいて、もう一度お試しください。",
  "exchange.empty": "いま交換できる体験はありません。",
  "exchange.error": "取引所の読み込みに失敗しました。時間をおいてお試しください。",
  "exchange.buyEmuer": "EMUERで交換",
  "exchange.buyJpyc": "JPYCで交換",
  "exchange.needWallet": "交換にはウォレットの接続が必要です。",
  "exchange.processing": "処理中…",
  "exchange.success": "交換が完了しました。",
  "exchange.failed": "交換に失敗しました。",
      "wallet.exchangeUnavailable": "取引所を利用できません。",

      "value.title": "残った価値",
      "value.desc": "投稿数ではなく、他者への影響を表示します。",
      "value.loading": "あなたの投稿と反応を読み込んでいます...",
      "value.emptyTitle": "まだ記録がありません",
      "value.emptyText": "知識を投稿し、誰かに届くとここに価値が残ります。",
      "value.firstTitle": "最初の価値を届けよう",
      "value.firstText": "投稿がGoodまたはChangeを受けると、ここに追加されます。",
      "value.errorTitle": "価値を読み込めませんでした",
      "value.errorText": "時間をおいて、もう一度開いてください。",
      "value.postDelivered": "「{title}」が誰かに届いた",
      "value.postDetail": "{parts}が、この知識の価値として残っています。",
      "value.changeAccepted": "「{title}」の改善が採用された",
      "value.changeGiven": "「{title}」の改善に参加した",
      "value.changeDetail": "具体的なChangeを投稿者へ渡しました。",
      "value.learnedTitle": "「{title}」から学びを受け取った",
      "value.learnedTheme": "テーマ：{tags}",
      "value.learnedDetail": "Goodを通じて、役立った知識として残しました。",
      "value.deliveredAccepted": "届けた知識が採用された",
      "value.delivered": "知識を必要な人へ届けた",
      "value.untitled": "無題の知識",
      "value.knowledge": "知識",

      "req.title": "知識を探しています",
      "req.desc": "まだ答えがない困りごとに、経験から得た知識を届け合う場所です。",
      "req.new": "＋ 知識を募集する",
      "req.loading": "募集を読み込んでいます...",
      "req.loadError": "募集を読み込めません。",

      /* SchoolPark ホーム（CHESハブ / マップ） */
      "hub.greet": "こんにちは、どこに行く？",
      "hub.notif": "お知らせ",
      "hub.settings": "設定",
      "hub.soon": "準備中",
      "hub.enter": "入場",
      "hub.foot": "学校より学べて、公園より楽しめて、会社より稼げる場所。",
      "hub.tag.camellia": "もう一度、自分を好きになる。",
      "hub.tag.heartoo": "♡を貴女に。",
      "hub.tag.emu": "知識を伝え合うSNS。",
      "hub.tag.schoolpark": "体験とコンテンツの街。",
      "hub.back": "← メイン画面に戻る",
      "sp.nav.home": "← メイン画面",
      "sp.nav.org": "合同会社型DAO SchoolPark",
      "sp.nav.gourmet": "グルメ",
      "sp.nav.shopping": "ショッピング",
      "sp.nav.cmd": "/ コマンド…",
      "sp.nav.reizo": "冷蔵庫くんに聞く",
      "sp.nav.ticket": "チケット購入",
      "sp.nav.menu": "メニュー",
      "sp.nav.settings": "設定",
      "sp.info.hours": "本日の営業時間",
      "sp.info.crowd": "混雑状況",
      "sp.info.loading": "取得中…",
      "sp.info.weather": "天気",
      "sp.side.title": "PARK MAP",
      "sp.side.pick": "エリアを選択してください",
      "sp.side.close": "閉じる",
      "sp.area.all": "すべて",
      "sp.area.center": "中央エリア",
      "sp.area.center.sub": "健康・運動・交流",
      "sp.area.east": "東エリア",
      "sp.area.east.sub": "生活・住居、商業・経済",
      "sp.area.west": "西エリア",
      "sp.area.west.sub": "安全・公共",
      "sp.area.south": "南エリア",
      "sp.area.south.sub": "遊び・自然",
      "sp.area.north": "北エリア",
      "sp.area.north.sub": "学び・文化",
      "sp.links.title": "LINKS",
      "sp.links.ticket": "チケットストア",
      "sp.links.company": "企業情報",
      "sp.links.faq": "よくあるご質問",
      "sp.links.contact": "お問い合わせ",
      "sp.notif.title": "お知らせ",
      "sp.notif.readAll": "すべて既読",
      "sp.notif.log": "ログ",
      "sp.notif.logRead": "既読にする",
      "sp.notif.loading": "読み込み中…"
    },
  };

  /* お題の訳は無くした。古い呼び出しが残っていても転ばないよう、口だけ残す。 */
  function emuTopic(text) { return String(text == null ? "" : text).trim(); }
  function emuRegisterTopics() { }

  function emuT(key, vars) {
    var text = EMU_I18N.ja[key];
    if (text == null) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  /* 別ファイル（emu-i18n-pages.js）から辞書を足す。
     日本語だけ受け取る。ほかの言語が来ても捨てる。 */
  function emuRegisterI18n(extra) {
    if (!extra || !extra.ja) return;
    Object.keys(extra.ja).forEach(function (key) { EMU_I18N.ja[key] = extra.ja[key]; });
    applyEmuI18n();
  }

  function emuLocaleTag() { return "ja-JP"; }
  function getEmuLang() { return "ja"; }
  /* 切替は無くした。呼ばれても何もしない（古い呼び出しで転ばないため）。 */
  function setEmuLang() { }

  // data-i18n を持つ要素をまとめて埋める。
  // 値が動的に入る要素（残高など）にはタグを付けず、JS側で emuT() を使うこと。
  function applyEmuI18n(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = emuT(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", emuT(el.getAttribute("data-i18n-placeholder")));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", emuT(el.getAttribute("data-i18n-title")));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", emuT(el.getAttribute("data-i18n-aria")));
    });
  }

  function initEmuI18n() {
    document.documentElement.setAttribute("lang", "ja-JP");
    applyEmuI18n();
  }

  window.emuT = emuT;
  window.emuTopic = emuTopic;
  window.emuLocaleTag = emuLocaleTag;
  window.getEmuLang = getEmuLang;
  window.setEmuLang = setEmuLang;
  window.applyEmuI18n = applyEmuI18n;
  window.initEmuI18n = initEmuI18n;
  window.emuRegisterI18n = emuRegisterI18n;
  window.emuRegisterTopics = emuRegisterTopics;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEmuI18n);
  } else {
    initEmuI18n();
  }
})();
