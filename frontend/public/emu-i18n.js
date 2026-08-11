/* ══════════════════════════════════════════════════════════════
   Emu 多言語辞書（日本語 / English / 中文 / 한국어 / Bahasa Indonesia）

   対象は「Emu」の画面テキストのみ。将来 CHES 全体（SchoolPark / Camellia /
   Heartoo）へ広げるときは、この辞書に名前空間を足して同じ仕組みを使う。

   使い方:
     - HTML: <span data-i18n="tab.today">今日のEmu</span>
             属性を訳す場合は data-i18n-placeholder / data-i18n-title / data-i18n-aria
     - JS  : emuT('lb.toastGot', { n: 0.5 })
     - 切替: setEmuLang('en')  … localStorage に保存し、画面を再描画する

   ・辞書に無いキーは日本語にフォールバックし、それも無ければキー名を返す。
   ・{name} のような波括弧は emuT の第2引数で置換する。
   ・ユーザーが書いた投稿本文・議論のお題などの「中身」は翻訳しない。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var EMU_LANGS = [
    { code: "ja", label: "日本語",           locale: "ja-JP" },
    { code: "en", label: "English",          locale: "en-US" },
    { code: "zh", label: "中文",             locale: "zh-CN" },
    { code: "ko", label: "한국어",            locale: "ko-KR" },
    { code: "id", label: "Bahasa Indonesia", locale: "id-ID" }
  ];

  var EMU_I18N = {
    ja: {
      "lang.label": "言語",
      "nav.mainScreen": "← メイン画面",
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
      "tab.profile": "価値プロフィール",
      "tab.discussion": "議論",
      "tab.play": "遊び",

      "today.greeting": "こんにちは。今日は、どこから始める？",
      "today.greetingName": "{name}さん、今日はどこから始める？",
      "today.hint": "迷ったら、一番上の「今日の一歩」だけで大丈夫。",
      "today.step.title": "今日の一歩",
      "today.step.text": "誰かの体験から生まれた知識を1つ受け取る",
      "today.step.action": "読みに行く",
      "today.ichinichi.title": "今日の一日シェア",
      "today.ichinichi.text": "時間割を決めて、今日の学びをひとつ残す",
      "today.ichinichi.action": "開く",
      "today.discussion.title": "開催中の議論",
      "today.discussion.loading": "今日の問いを読み込み中...",
      "today.discussion.action": "参加する",
      "today.play.title": "今日の遊び",
      "today.play.text": "ECHO FIELDで、伏せた駒の読み合いに挑む",
      "today.play.action": "遊ぶ",
      "today.request.title": "知識を探している人",
      "today.request.text": "あなたの経験を必要としている募集を探す",
      "today.request.action": "募集を見る",
      "today.star.title": "あと{n}回の投稿行動で、新しい星",
      "today.star.text": "投稿・学び・議論で残した価値が、星空につながります。",

      "reward.badge": "現在の報酬",
      "reward.hint": "（　）内は、まだ実EMUERに換えていない分",
      "reward.nextLabel": "次の体験まで",
      "reward.note": "100 Emuerで特別体験と交換できます。",
      "reward.progressAria": "次の体験までの進み具合",
      "reward.uses": "使い道を見る",
      "unit.emuer": "Emuer",

      "lb.title": "今日のログインボーナス",
      "lb.note": "毎日ログインで +{n} Emuer",
      "lb.claim": "+{n} 受取",
      "lb.claimed": "受取済み",
      "lb.tomorrow": "また明日、受け取れます。",
      "lb.claimedElsewhere": "本日分は受取済みです（別の端末または自動付与）。また明日どうぞ。",
      "lb.unconverted": "まだ換えていない分：{n} Emuer",
      "lb.toastGot": "🎁 ログインボーナス +{n} Emuer",
      "lb.toastAlready": "本日はすでに受け取り済みです🧊",
      "lb.needWallet": "ウォレットを接続してください",
      "lb.failed": "受け取りに失敗しました",

      "uses.title": "Emuerでできること",
      "uses.desc": "集める理由を、獲得前から確認できます。",
      "uses.close": "閉じる",
      "uses.special.title": "特別な体験",
      "uses.special.text": "相談・イベント・限定企画への参加",
      "uses.special.badge": "100 Emuer〜",
      "uses.nft.title": "限定体験NFT",
      "uses.nft.text": "参加権や、行動・経験の証",
      "uses.exchange": "取引所を見る",
      "uses.sp.title": "SchoolPark内の利用",
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
      "wallet.desc": "渡した価値が、Emuerとして返ってきます。",
      "wallet.label": "使えるEmuer",
      "wallet.pendingLine": "（　）内の {n} Emuer は、まだ実EMUERに換えていない分です。",
      "wallet.convertNote": "実EMUERに換えるにはウォレットが必要です。ガス代（送金手数料）はご自身の負担になります。",
      "wallet.distributor": "実EMUERは運営のアドレス {address} から届きます。",
      "wallet.chesAddress": "あなたのCHESアドレス：{address}",
      "wallet.convert": "Emuerに変換",
      "wallet.exchange": "取引所を見る",
      "wallet.noBadges": "称号はまだありません",
      "wallet.convertUnavailable": "変換機能を利用できません。",
  "wallet.convertLocked": "いまは変換できません。無料パスは毎週月曜日のみ、パスがない場合は変換をご利用いただけません。",
  "dsc.disconnected": "接続が切れています。ページを再読み込みしてから、もう一度お試しください。",
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
      "req.loadError": "募集を読み込めません。"
    },

    en: {
      "lang.label": "Language",
      "nav.mainScreen": "← Main screen",
      "header.searchPlaceholder": "Search...",
      "header.post": "Post",
      "header.walletDisconnected": "Wallet not connected",

      "home.title": "Emu Today",
      "home.subtitle": "A place that can keep up with your passion.",
      "home.tabsAria": "Emu screens",
      "tab.today": "Emu Today",
      "tab.ichinichi": "Share a Day",
      "tab.feed": "Read knowledge",
      "tab.requests": "Find knowledge",
      "tab.profile": "Value profile",
      "tab.discussion": "Discussion",
      "tab.play": "Play",

      "today.greeting": "Hello. Where would you like to start today?",
      "today.greetingName": "{name}, where would you like to start today?",
      "today.hint": "Not sure? Just do the first item, \"Today's step\".",
      "today.step.title": "Today's step",
      "today.step.text": "Receive one piece of knowledge born from someone's experience",
      "today.step.action": "Go read",
      "today.ichinichi.title": "Today's shared day",
      "today.ichinichi.text": "Plan your day and leave behind one thing you learned",
      "today.ichinichi.action": "Open",
      "today.discussion.title": "Ongoing discussion",
      "today.discussion.loading": "Loading today's question...",
      "today.discussion.action": "Join",
      "today.play.title": "Today's game",
      "today.play.text": "Read your opponent's hidden pieces in ECHO FIELD",
      "today.play.action": "Play",
      "today.request.title": "People looking for knowledge",
      "today.request.text": "Find requests that need your experience",
      "today.request.action": "See requests",
      "today.star.title": "{n} more posting actions until a new star",
      "today.star.text": "The value you leave through posts, learning and discussion becomes a night sky.",

      "reward.badge": "Current reward",
      "reward.hint": "The number in ( ) is not yet converted into real EMUER",
      "reward.nextLabel": "Until the next experience",
      "reward.note": "100 Emuer can be exchanged for a special experience.",
      "reward.progressAria": "Progress until the next experience",
      "reward.uses": "See what it's for",
      "unit.emuer": "Emuer",

      "lb.title": "Today's login bonus",
      "lb.note": "+{n} Emuer for logging in each day",
      "lb.claim": "Claim +{n}",
      "lb.claimed": "Claimed",
      "lb.tomorrow": "You can claim again tomorrow.",
      "lb.claimedElsewhere": "Today's bonus is already claimed (another device or automatic). See you tomorrow.",
      "lb.unconverted": "Not yet converted: {n} Emuer",
      "lb.toastGot": "🎁 Login bonus +{n} Emuer",
      "lb.toastAlready": "You have already claimed today's bonus 🧊",
      "lb.needWallet": "Please connect your wallet",
      "lb.failed": "Could not claim the bonus",

      "uses.title": "What Emuer can do",
      "uses.desc": "See what you are collecting it for, before you earn it.",
      "uses.close": "Close",
      "uses.special.title": "Special experiences",
      "uses.special.text": "Join consultations, events and limited projects",
      "uses.special.badge": "From 100 Emuer",
      "uses.nft.title": "Limited experience NFT",
      "uses.nft.text": "Entry rights and proof of what you did",
      "uses.exchange": "Open the exchange",
      "uses.sp.title": "Use inside SchoolPark",
      "uses.sp.text": "For facilities, games and services",
      "uses.spAction": "Go to SchoolPark",

      "profile.title": "The value you gave",
      "profile.desc": "Not a diary — only value that reached someone, was improved, and became learning.",
      "profile.helpedPeople": "People helped",
      "profile.helpfulCount": "Times it helped",
      "profile.acceptedChange": "Changes you accepted",
      "profile.changeGiven": "Improvements you joined",
      "profile.changeAccepted": "Improvements accepted",
      "profile.learned": "Learning received",
      "profile.delivered": "Knowledge sent to requests",
      "profile.elevated": "Turned into learning",
      "profile.noRecord": "No record",
      "unit.people": "{n}",
      "unit.times": "{n}",
      "unit.items": "{n}",

      "wallet.title": "Wallet",
      "wallet.desc": "The value you gave comes back as Emuer.",
      "wallet.label": "Emuer you can use",
      "wallet.pendingLine": "The {n} Emuer in ( ) has not been converted into real EMUER yet.",
      "wallet.convertNote": "Converting to real EMUER requires a wallet, and the gas fee is paid by you.",
      "wallet.distributor": "Real EMUER is sent from our address {address}.",
      "wallet.chesAddress": "Your CHES address: {address}",
      "wallet.convert": "Convert to Emuer",
      "wallet.exchange": "Open the exchange",
      "wallet.noBadges": "No titles yet",
      "wallet.convertUnavailable": "Conversion is not available.",
  "wallet.convertLocked": "Conversion is not available right now. Free passes can convert on Mondays only; without a pass, conversion is unavailable.",
  "dsc.disconnected": "You are disconnected. Please reload the page and try again.",
      "wallet.exchangeUnavailable": "The exchange is not available.",

      "value.title": "Value that remains",
      "value.desc": "We show your impact on others, not your number of posts.",
      "value.loading": "Loading your posts and reactions...",
      "value.emptyTitle": "No records yet",
      "value.emptyText": "Post knowledge — once it reaches someone, the value stays here.",
      "value.firstTitle": "Deliver your first value",
      "value.firstText": "Once a post receives a Good or a Change, it appears here.",
      "value.errorTitle": "Could not load your value",
      "value.errorText": "Please open this again in a little while.",
      "value.postDelivered": "\"{title}\" reached someone",
      "value.postDetail": "{parts} remain as the value of this knowledge.",
      "value.changeAccepted": "Your improvement to \"{title}\" was accepted",
      "value.changeGiven": "You joined the improvement of \"{title}\"",
      "value.changeDetail": "You gave a concrete Change to the author.",
      "value.learnedTitle": "You received learning from \"{title}\"",
      "value.learnedTheme": "Theme: {tags}",
      "value.learnedDetail": "Through Good, you kept it as knowledge that helped.",
      "value.deliveredAccepted": "The knowledge you sent was accepted",
      "value.delivered": "You delivered knowledge to someone who needed it",
      "value.untitled": "Untitled knowledge",
      "value.knowledge": "knowledge",

      "req.title": "Looking for knowledge",
      "req.desc": "A place to share experience-based knowledge for problems that have no answer yet.",
      "req.new": "＋ Request knowledge",
      "req.loading": "Loading requests...",
      "req.loadError": "Could not load requests."
    },

    zh: {
      "lang.label": "语言",
      "nav.mainScreen": "← 主页面",
      "header.searchPlaceholder": "搜索...",
      "header.post": "发布",
      "header.walletDisconnected": "钱包未连接",

      "home.title": "今日Emu",
      "home.subtitle": "一个跟得上你热情的地方。",
      "home.tabsAria": "Emu 页面",
      "tab.today": "今日Emu",
      "tab.ichinichi": "分享一天",
      "tab.feed": "阅读知识",
      "tab.requests": "寻找知识",
      "tab.profile": "价值档案",
      "tab.discussion": "讨论",
      "tab.play": "游戏",

      "today.greeting": "你好。今天想从哪里开始？",
      "today.greetingName": "{name}，今天想从哪里开始？",
      "today.hint": "拿不定主意的话，只做最上面的「今天的一步」就好。",
      "today.step.title": "今天的一步",
      "today.step.text": "接收一条源自他人经验的知识",
      "today.step.action": "去阅读",
      "today.ichinichi.title": "今天的一天分享",
      "today.ichinichi.text": "安排好时间表，留下今天的一个收获",
      "today.ichinichi.action": "打开",
      "today.discussion.title": "进行中的讨论",
      "today.discussion.loading": "正在加载今天的提问...",
      "today.discussion.action": "参加",
      "today.play.title": "今天的游戏",
      "today.play.text": "在 ECHO FIELD 中读懂对手暗置的棋子",
      "today.play.action": "去玩",
      "today.request.title": "正在寻找知识的人",
      "today.request.text": "寻找需要你经验的征集",
      "today.request.action": "查看征集",
      "today.star.title": "再有{n}次发布行动，就会诞生新的星星",
      "today.star.text": "你通过发布、学习和讨论留下的价值，会连成星空。",

      "reward.badge": "当前奖励",
      "reward.hint": "括号内是尚未兑换成实体EMUER的部分",
      "reward.nextLabel": "距离下一次体验",
      "reward.note": "100 Emuer 可兑换特别体验。",
      "reward.progressAria": "距离下一次体验的进度",
      "reward.uses": "查看用途",
      "unit.emuer": "Emuer",

      "lb.title": "今天的登录奖励",
      "lb.note": "每天登录 +{n} Emuer",
      "lb.claim": "领取 +{n}",
      "lb.claimed": "已领取",
      "lb.tomorrow": "明天可以再次领取。",
      "lb.claimedElsewhere": "今天的奖励已领取（其他设备或自动发放）。明天再来吧。",
      "lb.unconverted": "尚未兑换：{n} Emuer",
      "lb.toastGot": "🎁 登录奖励 +{n} Emuer",
      "lb.toastAlready": "今天已经领取过了🧊",
      "lb.needWallet": "请先连接钱包",
      "lb.failed": "领取失败",

      "uses.title": "Emuer 能做什么",
      "uses.desc": "在获得之前，先确认收集它的理由。",
      "uses.close": "关闭",
      "uses.special.title": "特别体验",
      "uses.special.text": "参加咨询、活动与限定企划",
      "uses.special.badge": "100 Emuer 起",
      "uses.nft.title": "限定体验NFT",
      "uses.nft.text": "参与资格，以及行动与经验的证明",
      "uses.exchange": "查看交易所",
      "uses.sp.title": "在 SchoolPark 内使用",
      "uses.sp.text": "用于设施、游戏与各项服务",
      "uses.spAction": "前往 SchoolPark",

      "profile.title": "你交付的价值",
      "profile.desc": "这里不是日常记录，只留下抵达他人、被改进并成为学习的价值。",
      "profile.helpedPeople": "帮助过的人",
      "profile.helpfulCount": "帮上忙的次数",
      "profile.acceptedChange": "采纳的Change",
      "profile.changeGiven": "参与改进",
      "profile.changeAccepted": "被采纳的改进",
      "profile.learned": "收到的学习",
      "profile.delivered": "送达征集的知识",
      "profile.elevated": "升华为学习",
      "profile.noRecord": "暂无记录",
      "unit.people": "{n}人",
      "unit.times": "{n}次",
      "unit.items": "{n}条",

      "wallet.title": "钱包",
      "wallet.desc": "你交付的价值，会以 Emuer 的形式回来。",
      "wallet.label": "可使用的 Emuer",
      "wallet.pendingLine": "括号内的 {n} Emuer 尚未兑换成实体EMUER。",
      "wallet.convertNote": "兑换成实体EMUER需要钱包，手续费（Gas费）由本人承担。",
      "wallet.distributor": "实体EMUER 会从运营地址 {address} 发送。",
      "wallet.chesAddress": "你的CHES地址：{address}",
      "wallet.convert": "兑换成 Emuer",
      "wallet.exchange": "查看交易所",
      "wallet.noBadges": "还没有称号",
      "wallet.convertUnavailable": "无法使用兑换功能。",
  "wallet.convertLocked": "目前无法兑换。免费通行证仅限每周一兑换；没有通行证则无法兑换。",
  "dsc.disconnected": "连接已断开。请重新载入页面后再试。",
      "wallet.exchangeUnavailable": "无法使用交易所。",

      "value.title": "留下的价值",
      "value.desc": "显示的不是发布数量，而是对他人的影响。",
      "value.loading": "正在加载你的发布与反应...",
      "value.emptyTitle": "还没有记录",
      "value.emptyText": "发布知识，当它抵达某个人时，价值就会留在这里。",
      "value.firstTitle": "去交付第一份价值吧",
      "value.firstText": "当发布收到 Good 或 Change 时，就会显示在这里。",
      "value.errorTitle": "无法加载价值",
      "value.errorText": "请稍后再打开一次。",
      "value.postDelivered": "「{title}」抵达了某个人",
      "value.postDetail": "{parts}作为这条知识的价值留了下来。",
      "value.changeAccepted": "你对「{title}」的改进被采纳了",
      "value.changeGiven": "你参与了「{title}」的改进",
      "value.changeDetail": "你把具体的 Change 交给了作者。",
      "value.learnedTitle": "你从「{title}」中获得了学习",
      "value.learnedTheme": "主题：{tags}",
      "value.learnedDetail": "通过 Good，把它留作有帮助的知识。",
      "value.deliveredAccepted": "你送出的知识被采纳了",
      "value.delivered": "你把知识送给了需要的人",
      "value.untitled": "无标题的知识",
      "value.knowledge": "知识",

      "req.title": "正在寻找知识",
      "req.desc": "在这里，为还没有答案的困扰，互相送上来自经验的知识。",
      "req.new": "＋ 征集知识",
      "req.loading": "正在加载征集...",
      "req.loadError": "无法加载征集。"
    },

    ko: {
      "lang.label": "언어",
      "nav.mainScreen": "← 메인 화면",
      "header.searchPlaceholder": "검색...",
      "header.post": "게시",
      "header.walletDisconnected": "지갑 미연결",

      "home.title": "오늘의 Emu",
      "home.subtitle": "당신의 열정을 따라올 수 있는 곳.",
      "home.tabsAria": "Emu 화면",
      "tab.today": "오늘의 Emu",
      "tab.ichinichi": "하루 공유",
      "tab.feed": "지식 읽기",
      "tab.requests": "지식 찾기",
      "tab.profile": "가치 프로필",
      "tab.discussion": "토론",
      "tab.play": "놀이",

      "today.greeting": "안녕하세요. 오늘은 어디부터 시작할까요?",
      "today.greetingName": "{name}님, 오늘은 어디부터 시작할까요?",
      "today.hint": "망설여진다면 맨 위의 「오늘의 한 걸음」만으로 충분합니다.",
      "today.step.title": "오늘의 한 걸음",
      "today.step.text": "누군가의 경험에서 태어난 지식을 하나 받아보기",
      "today.step.action": "읽으러 가기",
      "today.ichinichi.title": "오늘의 하루 공유",
      "today.ichinichi.text": "하루 일정을 정하고, 오늘의 배움을 하나 남기기",
      "today.ichinichi.action": "열기",
      "today.discussion.title": "진행 중인 토론",
      "today.discussion.loading": "오늘의 질문을 불러오는 중...",
      "today.discussion.action": "참여하기",
      "today.play.title": "오늘의 놀이",
      "today.play.text": "ECHO FIELD에서 뒤집힌 말의 수를 읽어보기",
      "today.play.action": "놀기",
      "today.request.title": "지식을 찾는 사람",
      "today.request.text": "당신의 경험이 필요한 요청 찾기",
      "today.request.action": "요청 보기",
      "today.star.title": "{n}번 더 활동하면 새로운 별이 생깁니다",
      "today.star.text": "게시·배움·토론으로 남긴 가치가 밤하늘로 이어집니다.",

      "reward.badge": "현재 보상",
      "reward.hint": "괄호 안은 아직 실제 EMUER로 바꾸지 않은 몫입니다",
      "reward.nextLabel": "다음 경험까지",
      "reward.note": "100 Emuer로 특별한 경험과 교환할 수 있습니다.",
      "reward.progressAria": "다음 경험까지의 진행도",
      "reward.uses": "쓰임새 보기",
      "unit.emuer": "Emuer",

      "lb.title": "오늘의 로그인 보너스",
      "lb.note": "매일 로그인하면 +{n} Emuer",
      "lb.claim": "+{n} 받기",
      "lb.claimed": "수령 완료",
      "lb.tomorrow": "내일 다시 받을 수 있습니다.",
      "lb.claimedElsewhere": "오늘 몫은 이미 받았습니다(다른 기기 또는 자동 지급). 내일 다시 만나요.",
      "lb.unconverted": "아직 바꾸지 않은 몫: {n} Emuer",
      "lb.toastGot": "🎁 로그인 보너스 +{n} Emuer",
      "lb.toastAlready": "오늘은 이미 받으셨습니다🧊",
      "lb.needWallet": "지갑을 연결해 주세요",
      "lb.failed": "받기에 실패했습니다",

      "uses.title": "Emuer로 할 수 있는 일",
      "uses.desc": "모으는 이유를, 얻기 전에 확인할 수 있습니다.",
      "uses.close": "닫기",
      "uses.special.title": "특별한 경험",
      "uses.special.text": "상담·이벤트·한정 기획 참여",
      "uses.special.badge": "100 Emuer~",
      "uses.nft.title": "한정 경험 NFT",
      "uses.nft.text": "참여 자격과 행동·경험의 증표",
      "uses.exchange": "거래소 보기",
      "uses.sp.title": "SchoolPark 안에서 사용",
      "uses.sp.text": "시설·놀이·서비스 이용에",
      "uses.spAction": "SchoolPark로",

      "profile.title": "당신이 건넨 가치",
      "profile.desc": "일상의 기록이 아니라, 누군가에게 닿고 개선되어 배움이 된 가치만 남깁니다.",
      "profile.helpedPeople": "도움을 준 사람",
      "profile.helpfulCount": "도움이 된 횟수",
      "profile.acceptedChange": "채택한 Change",
      "profile.changeGiven": "개선에 참여",
      "profile.changeAccepted": "채택된 개선",
      "profile.learned": "받은 배움",
      "profile.delivered": "요청에 전한 지식",
      "profile.elevated": "배움으로 승화",
      "profile.noRecord": "기록 없음",
      "unit.people": "{n}명",
      "unit.times": "{n}회",
      "unit.items": "{n}건",

      "wallet.title": "지갑",
      "wallet.desc": "건넨 가치가 Emuer로 돌아옵니다.",
      "wallet.label": "사용할 수 있는 Emuer",
      "wallet.pendingLine": "괄호 안의 {n} Emuer는 아직 실제 EMUER로 바꾸지 않은 몫입니다.",
      "wallet.convertNote": "실제 EMUER로 바꾸려면 지갑이 필요하며, 가스비(송금 수수료)는 본인 부담입니다.",
      "wallet.distributor": "실제 EMUER는 운영 주소 {address} 에서 전송됩니다.",
      "wallet.chesAddress": "나의 CHES 주소: {address}",
      "wallet.convert": "Emuer로 변환",
      "wallet.exchange": "거래소 보기",
      "wallet.noBadges": "아직 칭호가 없습니다",
      "wallet.convertUnavailable": "변환 기능을 사용할 수 없습니다.",
  "wallet.convertLocked": "지금은 변환할 수 없습니다. 무료 패스는 매주 월요일에만 가능하며, 패스가 없으면 변환할 수 없습니다.",
  "dsc.disconnected": "연결이 끊어졌습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
      "wallet.exchangeUnavailable": "거래소를 사용할 수 없습니다.",

      "value.title": "남은 가치",
      "value.desc": "게시물 수가 아니라, 타인에게 준 영향을 표시합니다.",
      "value.loading": "당신의 게시물과 반응을 불러오는 중...",
      "value.emptyTitle": "아직 기록이 없습니다",
      "value.emptyText": "지식을 올리고 누군가에게 닿으면, 여기에 가치가 남습니다.",
      "value.firstTitle": "첫 가치를 전해 보세요",
      "value.firstText": "게시물이 Good이나 Change를 받으면 여기에 추가됩니다.",
      "value.errorTitle": "가치를 불러오지 못했습니다",
      "value.errorText": "잠시 후 다시 열어 주세요.",
      "value.postDelivered": "「{title}」이(가) 누군가에게 닿았습니다",
      "value.postDetail": "{parts}이(가) 이 지식의 가치로 남아 있습니다.",
      "value.changeAccepted": "「{title}」의 개선이 채택되었습니다",
      "value.changeGiven": "「{title}」의 개선에 참여했습니다",
      "value.changeDetail": "구체적인 Change를 작성자에게 전달했습니다.",
      "value.learnedTitle": "「{title}」에서 배움을 받았습니다",
      "value.learnedTheme": "주제: {tags}",
      "value.learnedDetail": "Good을 통해 도움이 된 지식으로 남겼습니다.",
      "value.deliveredAccepted": "전한 지식이 채택되었습니다",
      "value.delivered": "필요한 사람에게 지식을 전했습니다",
      "value.untitled": "제목 없는 지식",
      "value.knowledge": "지식",

      "req.title": "지식을 찾고 있습니다",
      "req.desc": "아직 답이 없는 고민에, 경험에서 얻은 지식을 서로 전하는 곳입니다.",
      "req.new": "＋ 지식 요청하기",
      "req.loading": "요청을 불러오는 중...",
      "req.loadError": "요청을 불러올 수 없습니다."
    },

    id: {
      "lang.label": "Bahasa",
      "nav.mainScreen": "← Layar utama",
      "header.searchPlaceholder": "Cari...",
      "header.post": "Kirim",
      "header.walletDisconnected": "Dompet belum terhubung",

      "home.title": "Emu Hari Ini",
      "home.subtitle": "Tempat yang sanggup mengimbangi semangatmu.",
      "home.tabsAria": "Layar Emu",
      "tab.today": "Emu Hari Ini",
      "tab.ichinichi": "Bagikan Hari",
      "tab.feed": "Baca pengetahuan",
      "tab.requests": "Cari pengetahuan",
      "tab.profile": "Profil nilai",
      "tab.discussion": "Diskusi",
      "tab.play": "Main",

      "today.greeting": "Halo. Mau mulai dari mana hari ini?",
      "today.greetingName": "{name}, mau mulai dari mana hari ini?",
      "today.hint": "Kalau bingung, cukup kerjakan yang paling atas: \"Langkah hari ini\".",
      "today.step.title": "Langkah hari ini",
      "today.step.text": "Terima satu pengetahuan yang lahir dari pengalaman orang lain",
      "today.step.action": "Baca sekarang",
      "today.ichinichi.title": "Berbagi hari ini",
      "today.ichinichi.text": "Susun jadwalmu dan tinggalkan satu hal yang kamu pelajari",
      "today.ichinichi.action": "Buka",
      "today.discussion.title": "Diskusi yang sedang berlangsung",
      "today.discussion.loading": "Memuat pertanyaan hari ini...",
      "today.discussion.action": "Ikut",
      "today.play.title": "Permainan hari ini",
      "today.play.text": "Baca langkah bidak tersembunyi di ECHO FIELD",
      "today.play.action": "Main",
      "today.request.title": "Orang yang mencari pengetahuan",
      "today.request.text": "Cari permintaan yang membutuhkan pengalamanmu",
      "today.request.action": "Lihat permintaan",
      "today.star.title": "{n} aktivitas lagi untuk bintang baru",
      "today.star.text": "Nilai yang kamu tinggalkan lewat kiriman, pembelajaran, dan diskusi menjadi langit berbintang.",

      "reward.badge": "Imbalan saat ini",
      "reward.hint": "Angka dalam ( ) belum ditukar menjadi EMUER asli",
      "reward.nextLabel": "Menuju pengalaman berikutnya",
      "reward.note": "100 Emuer dapat ditukar dengan pengalaman spesial.",
      "reward.progressAria": "Kemajuan menuju pengalaman berikutnya",
      "reward.uses": "Lihat kegunaannya",
      "unit.emuer": "Emuer",

      "lb.title": "Bonus login hari ini",
      "lb.note": "+{n} Emuer setiap kali login harian",
      "lb.claim": "Ambil +{n}",
      "lb.claimed": "Sudah diambil",
      "lb.tomorrow": "Bisa diambil lagi besok.",
      "lb.claimedElsewhere": "Bonus hari ini sudah diambil (perangkat lain atau otomatis). Sampai jumpa besok.",
      "lb.unconverted": "Belum ditukar: {n} Emuer",
      "lb.toastGot": "🎁 Bonus login +{n} Emuer",
      "lb.toastAlready": "Bonus hari ini sudah diambil 🧊",
      "lb.needWallet": "Silakan hubungkan dompetmu",
      "lb.failed": "Gagal mengambil bonus",

      "uses.title": "Yang bisa dilakukan dengan Emuer",
      "uses.desc": "Ketahui alasan mengumpulkannya sebelum kamu mendapatkannya.",
      "uses.close": "Tutup",
      "uses.special.title": "Pengalaman spesial",
      "uses.special.text": "Ikut konsultasi, acara, dan proyek terbatas",
      "uses.special.badge": "Mulai 100 Emuer",
      "uses.nft.title": "NFT pengalaman terbatas",
      "uses.nft.text": "Hak ikut serta dan bukti tindakan serta pengalaman",
      "uses.exchange": "Lihat bursa",
      "uses.sp.title": "Digunakan di dalam SchoolPark",
      "uses.sp.text": "Untuk fasilitas, permainan, dan layanan",
      "uses.spAction": "Ke SchoolPark",

      "profile.title": "Nilai yang kamu berikan",
      "profile.desc": "Bukan catatan harian — hanya nilai yang sampai ke orang lain, diperbaiki, dan menjadi pembelajaran.",
      "profile.helpedPeople": "Orang yang terbantu",
      "profile.helpfulCount": "Berapa kali membantu",
      "profile.acceptedChange": "Change yang kamu terima",
      "profile.changeGiven": "Ikut memperbaiki",
      "profile.changeAccepted": "Perbaikan yang diterima",
      "profile.learned": "Pembelajaran diterima",
      "profile.delivered": "Pengetahuan untuk permintaan",
      "profile.elevated": "Menjadi pembelajaran",
      "profile.noRecord": "Belum ada catatan",
      "unit.people": "{n}",
      "unit.times": "{n}",
      "unit.items": "{n}",

      "wallet.title": "Dompet",
      "wallet.desc": "Nilai yang kamu berikan kembali sebagai Emuer.",
      "wallet.label": "Emuer yang bisa dipakai",
      "wallet.pendingLine": "{n} Emuer di dalam ( ) belum ditukar menjadi EMUER asli.",
      "wallet.convertNote": "Menukar ke EMUER asli memerlukan dompet, dan biaya gas ditanggung sendiri.",
      "wallet.distributor": "EMUER asli dikirim dari alamat pengelola {address}.",
      "wallet.chesAddress": "Alamat CHES kamu: {address}",
      "wallet.convert": "Tukar ke Emuer",
      "wallet.exchange": "Lihat bursa",
      "wallet.noBadges": "Belum ada gelar",
      "wallet.convertUnavailable": "Fitur penukaran tidak tersedia.",
  "wallet.convertLocked": "Penukaran belum bisa dilakukan. Pass gratis hanya bisa menukar pada hari Senin; tanpa pass, penukaran tidak tersedia.",
  "dsc.disconnected": "Koneksi terputus. Muat ulang halaman lalu coba lagi.",
      "wallet.exchangeUnavailable": "Bursa tidak tersedia.",

      "value.title": "Nilai yang tersisa",
      "value.desc": "Yang ditampilkan bukan jumlah kiriman, melainkan dampakmu bagi orang lain.",
      "value.loading": "Memuat kiriman dan reaksimu...",
      "value.emptyTitle": "Belum ada catatan",
      "value.emptyText": "Kirimkan pengetahuan — begitu sampai ke seseorang, nilainya tersimpan di sini.",
      "value.firstTitle": "Kirim nilai pertamamu",
      "value.firstText": "Begitu kirimanmu menerima Good atau Change, ia muncul di sini.",
      "value.errorTitle": "Gagal memuat nilai",
      "value.errorText": "Silakan buka lagi beberapa saat lagi.",
      "value.postDelivered": "\"{title}\" sampai ke seseorang",
      "value.postDetail": "{parts} tersisa sebagai nilai dari pengetahuan ini.",
      "value.changeAccepted": "Perbaikanmu untuk \"{title}\" diterima",
      "value.changeGiven": "Kamu ikut memperbaiki \"{title}\"",
      "value.changeDetail": "Kamu memberikan Change yang konkret kepada penulis.",
      "value.learnedTitle": "Kamu mendapat pembelajaran dari \"{title}\"",
      "value.learnedTheme": "Tema: {tags}",
      "value.learnedDetail": "Lewat Good, kamu menyimpannya sebagai pengetahuan yang membantu.",
      "value.deliveredAccepted": "Pengetahuan yang kamu kirim diterima",
      "value.delivered": "Kamu mengantar pengetahuan kepada yang membutuhkan",
      "value.untitled": "Pengetahuan tanpa judul",
      "value.knowledge": "pengetahuan",

      "req.title": "Sedang mencari pengetahuan",
      "req.desc": "Tempat saling mengantar pengetahuan dari pengalaman untuk masalah yang belum ada jawabannya.",
      "req.new": "＋ Minta pengetahuan",
      "req.loading": "Memuat permintaan...",
      "req.loadError": "Tidak dapat memuat permintaan."
    }
  };

  // 議論のお題。バックエンド(server.js)の topics 配列と同じ並び。
  // お題は socket 経由で日本語の文字列として届くため、日本語をキーに引いて訳す。
  var EMU_TOPICS = { ja: [] };

  var STORAGE_KEY = "emu_lang";
  var current = "ja";

  function supported(code) {
    for (var i = 0; i < EMU_LANGS.length; i++) if (EMU_LANGS[i].code === code) return true;
    return false;
  }

  // 端末の言語から推定（zh-TW も zh、id/in どちらの表記にも対応）
  function detectLang() {
    var list = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || "ja"];
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || "").toLowerCase();
      var base = tag.split("-")[0];
      if (base === "in") base = "id"; // 旧 ISO 表記
      if (supported(base)) return base;
    }
    return "ja";
  }

  function emuT(key, vars) {
    var dict = EMU_I18N[current] || EMU_I18N.ja;
    var text = dict[key];
    if (text == null) text = EMU_I18N.ja[key];
    if (text == null) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  // 別ファイル（emu-i18n-pages.js）から辞書を追加する。
  // Emu本体・各サブページで同じ辞書を共有し、キーの重複を避けるため名前空間を分ける。
  function emuRegisterI18n(extra) {
    if (!extra) return;
    Object.keys(extra).forEach(function (lang) {
      if (!EMU_I18N[lang]) EMU_I18N[lang] = {};
      Object.keys(extra[lang]).forEach(function (key) { EMU_I18N[lang][key] = extra[lang][key]; });
    });
    applyEmuI18n();
  }

  function emuRegisterTopics(topics) {
    if (!topics) return;
    Object.keys(topics).forEach(function (lang) { EMU_TOPICS[lang] = topics[lang]; });
  }

  // 議論のお題を訳す。一覧に無いお題（手動設定など）は原文のまま返す。
  function emuTopic(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw || !EMU_TOPICS.ja || !EMU_TOPICS.ja.length) return raw;
    var index = EMU_TOPICS.ja.indexOf(raw);
    if (index < 0) return raw;
    var list = EMU_TOPICS[current] || EMU_TOPICS.ja;
    return list[index] || raw;
  }

  function emuLocaleTag() {
    for (var i = 0; i < EMU_LANGS.length; i++) if (EMU_LANGS[i].code === current) return EMU_LANGS[i].locale;
    return "ja-JP";
  }

  // data-i18n を持つ要素をまとめて翻訳する。
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

  function getEmuLang() { return current; }

  function setEmuLang(code) {
    if (!supported(code)) code = "ja";
    current = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
    document.documentElement.setAttribute("lang", emuLocaleTag());
    var select = document.getElementById("emuLangSelect");
    if (select && select.value !== code) select.value = code;
    applyEmuI18n();
    // 動的に描画している箇所を作り直す（存在する画面だけ）
    ["updateEmuTodayHome", "updateEmuLoginBonusUI", "loadEmuWalletCard"].forEach(function (fn) {
      try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
    });
    try {
      if (typeof window.loadEmuValueProfile === "function" &&
          document.body.classList.contains("emu-profile-open")) window.loadEmuValueProfile();
    } catch (e) {}
    try {
      if (typeof window.renderKnowledgeRequests === "function" &&
          document.body.classList.contains("emu-requests-open")) window.renderKnowledgeRequests();
    } catch (e) {}
    // 各ページ（一日シェア等）が自前の再描画を登録できるフック
    try { if (typeof window.onEmuLangChange === "function") window.onEmuLangChange(current); } catch (e) {}
    // iframeで開いているサブページにも言語を伝える
    broadcastLangToFrames(current);
  }

  // 同一オリジンなので localStorage は共有される。初回表示はそれで揃うが、
  // 切り替え時は開いている iframe へ即時反映するために postMessage する。
  function broadcastLangToFrames(code) {
    try {
      document.querySelectorAll("iframe").forEach(function (frame) {
        try {
          if (frame.contentWindow) {
            frame.contentWindow.postMessage({ type: "emu-lang", lang: code }, location.origin);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type !== "emu-lang") return;
    if (event.data.lang && event.data.lang !== current) setEmuLang(event.data.lang);
  });

  function initEmuI18n() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    current = supported(saved) ? saved : detectLang();

    var select = document.getElementById("emuLangSelect");
    if (select && !select.options.length) {
      EMU_LANGS.forEach(function (lang) {
        var option = document.createElement("option");
        option.value = lang.code;
        option.textContent = lang.label;
        select.appendChild(option);
      });
    }
    if (select) select.value = current;
    document.documentElement.setAttribute("lang", emuLocaleTag());
    applyEmuI18n();
  }

  window.EMU_LANGS = EMU_LANGS;
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
