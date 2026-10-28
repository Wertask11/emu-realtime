/* Adapters for existing navigation only. No Firebase, authentication, content writes, or analytics. */
(function (window, document) {
  'use strict';
  var tour = window.ReizoTour; if (!tour) return;
  var SP = {home:'home',logs:'guilds',guild:'guild',experiments:'quests',detail:'quest-detail',library:'wisdom',park:'park',plaza:'plaza',members:'contribution',treasury:'treasury',city:'city',tasks:'tasks',yeargoals:'year-goals',passport:'passport'};
  var EMU = {'emu-knowledge-open':'feed','emu-requests-open':'requests','emu-ichinichi-open':'share','emu-discussion-open':'discussion'};
  function frameDoc(id) { try { var fr = document.getElementById(id); return fr && fr.contentDocument; } catch (error) { return null; } }
  function dao() { try { var fr = document.getElementById('spDaoFrame'); return fr && fr.contentWindow && fr.contentWindow.app; } catch (error) { return null; } }
  function visible(el) { return !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function ready(spScreen) {
    // Wait until the existing cover is actually removed, including its ready/fade phase.
    if (document.documentElement.classList.contains('ches-resuming') ||
        ['spLoadingOverlay','loadingOverlay'].some(function (id) { return visible(document.getElementById(id)); })) return false;
    if (spScreen === 'passport') return !!document.querySelector('#sppPage1 [data-tour~=pp-id]');
    if (!spScreen) return true;
    var app = dao();
    if (!app || app.tourRenderedScreen !== spScreen || !visible(document.getElementById('spDaoFrame'))) return false;
    var required = {
      // Homework has an independent request that may fail after the main home content is ready.
      // Its guide only points to the existing section heading, so it must not block the whole tour.
      home:['me','wisdom','quests'], logs:['guilds'], guild:[],
      experiments:['quests'], detail:['quests'], library:['wisdom'],
      park:['board'], plaza:['board'], members:['members'], treasury:['treasury'],
      tasks:['tasks'], yeargoals:['yearDoc'], city:[]
    }[spScreen];
    if (!required || !required.every(function (key) { return app.tourRenderedDataReady?.[key] === true; })) return false;
    if (spScreen === 'guild') return app.state.curGuild?.loading === false;
    if (spScreen === 'experiments' || spScreen === 'detail') {
      if (app.state.questsDenied) return false;
      if (spScreen === 'detail') return app.state.quests.some(function (quest) { return quest.id === app.state.expId; });
    }
    if (spScreen === 'members' && app.state.membersNote && !app.state.members.length) return false;
    if (spScreen === 'yeargoals') return !!app.state.yearDoc;
    return true;
  }
  var deliveries=new WeakMap();
  function emuReady(id,frame,item) {
    var doc=frameDoc(frame);
    if(frame && (!doc?.body || !visible(document.getElementById(frame)))) return false;
    if(id==='emu-feed') {
      if(!deliveries.get(doc)?.posts && !doc.documentElement.hasAttribute('data-tour-posts-ready')) return false;
      if(item?.target.includes('emu-lib-list') && doc.querySelector('#panel.open') && !deliveries.get(doc)?.library && !doc.documentElement.hasAttribute('data-tour-library-ready')) return false;
    }
    if(id==='emu-share' && doc.querySelector('[data-tour-ready="false"]')) return false;
    if(id==='emu-discussion' && !deliveries.get(doc)?.rooms && !doc.documentElement.hasAttribute('data-tour-rooms-ready')) return false;
    if(id==='emu-requests') {
      var list=document.getElementById('emuRequestList');
      // A real result (including an empty result) replaces the native loading/retry status.
      if(!list?.children.length || list.querySelector('.emu-request-empty button')) return false;
      if(list.querySelector('.emu-request-empty') && /読み込|ログイン/.test(list.textContent)) return false;
    }
    if(id==='sp-passport' && item?.target.includes('pp-record') && /読み込/.test(document.getElementById('sppRecords')?.textContent||'')) return false;
    return true;
  }
  function screen() {
    var running=tour.running();
    if(document.querySelector('#emuRequestSheet.open') && !(running?.id==='emu-requests' && [2,3].includes(running.index))) return null;
    if (document.getElementById('emu-contact-panel')?.classList.contains('open')) return null;
    if (document.getElementById('spReizoPanel')?.classList.contains('open')) return null;
    if (Array.from(document.querySelectorAll('.modal,.emu-sheet.open')).some(function(el){return el.id !== 'emuRequestSheet' && visible(el);})) return null;
    if (document.body.classList.contains('sp-passport-open')) return 'sp-passport';
    if (/(?:^|\s)sp-(?:room|menu|passport|vote|quest|wisdom|log)-open(?:\s|$)/.test(document.body.className)) return null;
    if (document.body.classList.contains('sp-dao-open')) { var app = dao(); return app && SP[app.state.screen] ? 'sp-' + SP[app.state.screen] : null; }
    if (!visible(document.getElementById('mainApp'))) return null;
    for (var cls of Object.keys(EMU)) if (document.body.classList.contains(cls)) {
      var doc = frameDoc(cls === 'emu-knowledge-open' ? 'emuKnowledgeFrame' : cls === 'emu-ichinichi-open' ? 'emuIchinichiFrame' : 'emuDiscussionFrame');
      if (doc && doc.querySelector('.overlay.open:not(#panel)')) return null;
      if(doc?.querySelector('#panel.open') && !(running?.id==='emu-feed' && [6,7].includes(running.index))) return null;
      return 'emu-' + EMU[cls];
    }
    return null;
  }
  function synchronize() { var doc=frameDoc('spDaoFrame');var names=['home','guild','quest','wisdom','park','contrib','treasury','city'];if(doc)names.forEach(function(name,i){doc.querySelectorAll('[data-tour~=nav-0'+(i+1)+']').forEach(function(el){if(!el.dataset.tour.includes('nav-'+name))el.dataset.tour+=' nav-'+name;});});tour.enter(screen()); }
  var routeFrame = 0;
  function scheduleRoute() { if (!routeFrame) routeFrame = requestAnimationFrame(function () { routeFrame = 0; synchronize(); }); }
  function step(target, label, text, read) {
    var item = {target:'[data-tour~="' + target + '"]',label:label,text:text};
    if (read) item.advanceOn = {read:read};
    return item;
  }
  function bottomInset(brand) {
    if (brand === 'SchoolPark') {
      var app = dao(), bar = app && app.bottomRef.current;
      return bar && bar.getBoundingClientRect().height && bar.ownerDocument.defaultView.getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height : 0;
    }
    var nav = document.getElementById('emuBottomNav'); return visible(nav) ? nav.getBoundingClientRect().height : 0;
  }
  function waitFor(test, message) {
    return new Promise(function (resolve,reject) {
      var started = Date.now();
      function check() { if (test()) return resolve(); if (Date.now()-started >= 2500) return reject(new Error(message)); setTimeout(check,50); }
      check();
    });
  }
  async function goSchoolPark(name) {
    if (!document.body.classList.contains('sp-dao-open')) {
      if (typeof window.chesHubGo !== 'function') throw new Error('SchoolParkの入口を開けませんでした。');
      await window.chesHubGo('schoolpark');
      await waitFor(function () { return document.body.classList.contains('sp-dao-open') && dao(); },'SchoolParkに入れる状態で、もう一度お試しください。');
    }
    var app = dao(); if (!app) throw new Error('画面の読み込みが終わっていません。');
    if (name === 'detail') {
      if (app.state.screen === 'detail') return;
      var quest = app.state.quests.find(function (row) { return !row.isFounder; });
      if (!quest) throw new Error('表示できるクエストの詳細がありません。一覧から開いたあとでご利用ください。');
      app.openExp(quest.id)();
    } else if (name === 'guild') {
      if (app.state.screen === 'guild') return;
      var guild = app.state.guilds.find(function (row) { return typeof row.open === 'function'; });
      if (!guild) throw new Error('表示できるギルドがありません。一覧から開いたあとでご利用ください。');
      guild.open(); // The same read-only action as the existing guild card; never join/support/vote.
    } else if (name === 'yeargoals') {
      if (!app.state.yearDoc) throw new Error('年内目標の資料がまだ読み込まれていません。');
      app.setState({screen:'yeargoals'}); app.toTop();
    } else app.go(name)();
    await waitFor(function () { return app.state.screen === name; },'対象画面を開けませんでした。');
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
  }
  async function goEmu(name) {
    if (document.body.classList.contains('sp-room-open') && typeof window.closeSpRoom === 'function') window.closeSpRoom();
    if (document.body.classList.contains('sp-dao-open')) {
      if (typeof window.chesHubGo !== 'function') throw new Error('Emuの入口を開けませんでした。');
      await window.chesHubGo('emu');
    }
    var fn = {feed:'showEmuFeed',requests:'showEmuRequests',share:'showEmuIchinichi',discussion:'showEmuDiscussion'}[name];
    if (typeof window[fn] !== 'function') throw new Error('この画面の入口を開けませんでした。');
    window[fn]();
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
  }
  function register(id, label, steps, spScreen, emuFrame) {
    var brand = spScreen ? 'SchoolPark' : 'Emu';
    tour.register(id,steps,{
      label:label,brand:brand,isActive:function () { return screen() === id; },
      isReady:function (item) { return ready(spScreen) && emuReady(id,emuFrame,item); },
      getDocuments:function () { return [frameDoc(spScreen && spScreen !== 'passport'?'spDaoFrame':emuFrame),document]; },
      bottomInset:function () { return bottomInset(brand); },
      restoreFocus:function (source) {
        var panel=document.getElementById('emu-contact-panel');
        if(source?.closest('#emu-contact-panel')&&panel&&!panel.classList.contains('open')&&typeof window.toggleContactPanel==='function')window.toggleContactPanel();
      },
      auto:!['sp-guild','sp-quest-detail','sp-plaza','sp-tasks','sp-year-goals'].includes(id),
      navigate:function () { closeSupport(); if(spScreen === 'passport') { if(!document.body.classList.contains('sp-passport-open')) window.openSpPassport(); return waitFor(function(){return document.body.classList.contains('sp-passport-open');},'パスポートを開けませんでした。'); } return spScreen ? goSchoolPark(spScreen) : goEmu(id.slice(4)); }
    });
  }
  var v2 = {
  "home": {
    "name": "ホーム",
    "steps": [
      {
        "target": "home-main",
        "label": "THIS WEEK",
        "text": "ここがSchoolParkのホームだよ。これまでの知恵や、走っているクエストをここで見られるよ。",
        "screen": "home"
      },
      {
        "target": "menu",
        "label": "メニュー",
        "text": "上の「SchoolPark 切替」からEmuやパスポート、お問い合わせを開けるよ。活動の画面には下のナビやサイドバーから移動できるよ。",
        "screen": "home"
      },
      {
        "target": "home-wisdom",
        "label": "今週生まれた知恵",
        "text": "今週生まれた知恵はここ。カードを押すと知恵のページへ行けるよ。",
        "click": true,
        "screen": "home"
      },
      {
        "target": "home-quests",
        "label": "走っているクエスト",
        "text": "いま走っているクエストはここ。押すと一覧を見られるよ。",
        "click": true,
        "screen": "home"
      },
      {
        "target": "home-todo",
        "label": "自分の宿題",
        "text": "受けているクエストや、自分のタスクはここにまとまるよ。",
        "screen": "home"
      },
      {
        "target": "passport-entry",
        "label": "SchoolPark パスポート",
        "text": "自分の名前を押すと、SchoolPark パスポートが開くよ。スマホは左上の ☰ から開けるよ。",
        "click": true,
        "screen": "home"
      },
      {
        "target": "fridge",
        "label": "冷蔵庫くん",
        "text": "わからないときは、ここを押してね。この画面のガイドも、ぼくへの質問もここからだよ。",
        "screen": "home"
      },
      {
        "target": "support-btn",
        "label": "お問い合わせ",
        "text": "困ったときは、お問い合わせからいつでもガイドや動画を見返せるよ。",
        "screen": "home"
      },
      {
        "target": "nav-guild",
        "label": "メニュー「ギルド」",
        "text": "次はギルドへ行ってみよう。押すとギルドの案内が始まるよ。",
        "click": true,
        "screen": "home"
      }
    ]
  },
  "guild": {
    "name": "ギルド",
    "steps": [
      {
        "target": "guild-list",
        "label": "ギルドを選ぶ",
        "text": "ここではギルドを見つけられるよ。まずは気になるギルドをのぞいてみよう。",
        "screen": "guild"
      },
      {
        "target": "guild-rules",
        "label": "ギルドの決まり",
        "text": "ギルド・議題・クエストの関係は、ここで確かめられるよ。",
        "screen": "guild"
      },
      {
        "target": "guild-card",
        "label": "ギルドのカード",
        "text": "カードは「活動を見る」入口だよ。開いても参加にはならないよ。議題やクエストを読んで、関わりたいと思ったら別のボタンで選べるよ。",
        "click": true,
        "note": "「参加したい」「応援」は完了条件にしない",
        "screen": "guild"
      }
    ]
  },
  "quest": {
    "name": "クエスト",
    "steps": [
      {
        "target": "quest-intro",
        "label": "クエストの説明",
        "text": "ここではクエストの内容を見られるよ。参加するかは説明を見てから決めてね。",
        "screen": "quest"
      },
      {
        "target": "quest-filters",
        "label": "絞り込み",
        "text": "シリーズや状態で絞り込めるよ。「入門」に絞ると、運営が入門と設定したクエストだけを探せるよ。",
        "screen": "quest"
      },
      {
        "target": "quest-card",
        "label": "内容を見る",
        "text": "「内容を見る」は閲覧だけ。まだ参加にはならないよ。やることや締切・完走条件を確かめてから、受けるか決めてね。",
        "click": true,
        "note": "「受ける」・応募・報告・報酬受取は完了条件にしない",
        "screen": "quest"
      }
    ]
  },
  "wisdom": {
    "name": "知恵",
    "steps": [
      {
        "target": "wisdom-hero",
        "label": "知恵",
        "text": "ここから、経験から生まれた知恵を見つけられるよ。カードを開いて読んでみよう。",
        "screen": "wisdom"
      },
      {
        "target": "wisdom-tags",
        "label": "分類",
        "text": "分類を選ぶと、知恵を絞り込めるよ。",
        "screen": "wisdom"
      },
      {
        "target": "wisdom-card",
        "label": "知恵カード",
        "text": "カードは「元の知識 → 通した経験 → 残った一文」でできているよ。",
        "note": "「参考にする（引用）」は完了条件にしない",
        "screen": "wisdom"
      }
    ]
  },
  "park": {
    "name": "公園",
    "steps": [
      {
        "target": "park-hero",
        "label": "公園",
        "text": "ここは公園。みんなが集まる場所だよ。まずは中を見てみよう。",
        "screen": "park"
      },
      {
        "target": "park-side",
        "label": "遊び・エレベーター",
        "text": "右のならびから、遊びやエレベーターにも行けるよ。",
        "note": "「公園に置く」（投稿）は案内の対象外",
        "screen": "park"
      },
      {
        "target": "park-map",
        "label": "公園の地図",
        "text": "地図の「広場」や「すべり台」を押すと、その場所へ行けるよ。",
        "click": true,
        "screen": "park"
      }
    ]
  },
  "contrib": {
    "name": "貢献",
    "steps": [
      {
        "target": "contrib-intro",
        "label": "貢献",
        "text": "ここでは、SchoolParkへの貢献が見られるよ。貢献は「知恵を残したか」で測るんだ。",
        "screen": "contrib"
      },
      {
        "target": "contrib-note",
        "label": "お支払いについて",
        "text": "分配はまだ計算額だけ。お支払いの始まりはここで知らせるよ。",
        "screen": "contrib"
      },
      {
        "target": "contrib-table",
        "label": "メンバー一覧",
        "text": "知恵・完走・引用され・分配（計算額）が並ぶよ。今日は見るだけでも大丈夫。",
        "screen": "contrib"
      }
    ]
  },
  "treasury": {
    "name": "treasury",
    "steps": [
      {
        "target": "treasury-card",
        "label": "TREASURY",
        "text": "treasuryの入口だよ。お金の情報は、表示を読んで確かめよう。",
        "screen": "treasury"
      },
      {
        "target": "treasury-tx",
        "label": "直近の動き",
        "text": "入金や支出の記録は、ここに並ぶよ。",
        "screen": "treasury"
      },
      {
        "target": "treasury-help",
        "label": "言葉の意味",
        "text": "「ある」「渡したぶん」「使える」の意味は、ここに書いてあるよ。",
        "screen": "treasury"
      }
    ]
  },
  "city": {
    "name": "CITY",
    "steps": [
      {
        "target": "city-doors",
        "label": "CITYでできること",
        "text": "CITYでできることは3つ。公式ショップ・街のお店・3Dの街だよ。",
        "screen": "city"
      },
      {
        "target": "city-shop",
        "label": "公式ショップ",
        "text": "SchoolPark公式のお店。活動でたまったEMUERで、商品と交換できるよ。ウォレットのEMUERでも、ウォレットに移す前のEMUERでも払えるよ。",
        "note": "EMUERでの交換は Light・Plus・Pro プラン",
        "screen": "city"
      },
      {
        "target": "city-showcase",
        "label": "公式ショップの商品",
        "text": "公式ショップの商品は、ここに並ぶよ。押すと交換の画面に進むよ。",
        "screen": "city"
      },
      {
        "target": "city-partners",
        "label": "街のお店",
        "text": "SchoolParkとつながる街のお店だよ。支払いは円・JPYCで、お店でするよ（EMUERは使えないよ）。",
        "screen": "city"
      },
      {
        "target": "city-3d",
        "label": "3Dの街",
        "text": "3Dの街では、お店に入って歩いて、商品を見られるよ。公式ショップも3Dにあるよ。",
        "screen": "city"
      },
      {
        "target": "city-orders",
        "label": "交換履歴",
        "text": "交換した商品と引換コードはここ。受付で引換コードを見せて受け取ってね。デジタルの商品は、ここからダウンロードできるよ。",
        "screen": "city"
      },
      {
        "target": "city-join",
        "label": "出店のご案内",
        "text": "お店の人は、ここから出店の相談ができるよ。",
        "screen": "city"
      }
    ]
  },
  "passport": {
    "name": "SchoolPark パスポート",
    "steps": [
      {
        "target": "pp-id",
        "label": "SchoolPark ID",
        "text": "ここはあなたのパスポート。1ページ目は「私は誰なのか」。SchoolPark IDはここにあるよ。",
        "pp": 1
      },
      {
        "target": "pp-verify",
        "label": "本人であること",
        "text": "LINE・Google・ウォレットは、ここで追加や連携ができるよ。どれで入っても、同じパスポートになるよ。",
        "pp": 1,
        "note": "ログイン方法の追加・ウォレット連携・本人確認（KYC）は完了条件にしない"
      },
      {
        "target": "pp-next1",
        "label": "次のページへ",
        "text": "「私は何をしてきたのか」を押すと、2ページ目へ進むよ。",
        "pp": 1,
        "click": true
      },
      {
        "target": "pp-starfield",
        "label": "星空を見る",
        "text": "歩いてきた記録は、星空に残るよ。星の色で、どんな行動だったかがわかるんだ。",
        "pp": 2
      },
      {
        "target": "pp-record",
        "label": "SchoolParkの記録",
        "text": "投票した議題や完了したクエストは、ここに並ぶよ。",
        "pp": 2,
        "note": "証明書NFTの受け取りは完了条件にしない"
      },
      {
        "target": "pp-next2",
        "label": "次のページへ",
        "text": "「私はどんな価値を渡してきたのか」を押すと、3ページ目へ進むよ。",
        "pp": 2,
        "click": true
      },
      {
        "target": "pp-value",
        "label": "価値プロフィール",
        "text": "3ページ目は、あなたの行動が誰にどう届いたか。Emuの価値プロフィールで見られるよ。",
        "pp": 3
      },
      {
        "target": "pp-travels",
        "label": "価値が渡っていく道すじ",
        "text": "知識を届けた → 誰かの役に立った → 改善された → 学びにつながった。この順に価値が渡っていくよ。",
        "pp": 3
      }
    ]
  },
  "emu-read": {
    "name": "01 知識を読む",
    "steps": [
      {
        "target": "emu-give",
        "label": "知識を届ける",
        "text": "やってみてわかったことは、ここから知識として届けられるよ。",
        "note": "投稿は完了条件にしない",
        "screen": "read"
      },
      {
        "target": "emu-search",
        "label": "検索",
        "text": "悩み・体験・タグから、知識を探せるよ。",
        "screen": "read"
      },
      {
        "target": "emu-sort",
        "label": "並び替え",
        "text": "おすすめ・新着・今月のテーマ・役に立った・改善された、で並べ替えられるよ。",
        "screen": "read"
      },
      {
        "target": "emu-theme",
        "label": "今月のテーマ",
        "text": "毎月のテーマはここ。「テーマの知識を見る」を押すと、そのテーマの知識だけが並ぶよ。",
        "click": true,
        "screen": "read"
      },
      {
        "target": "emu-card",
        "label": "知識カード",
        "text": "「続きを読む」で本文を読めるよ。下には、この知識が誰の次の一歩になったかが出るよ。",
        "screen": "read"
      },
      {
        "target": "emu-card-acts",
        "label": "役に立った・改善案",
        "text": "役に立ったら「役に立った」、もっと良くできそうなら「改善案を届ける」を押してね。",
        "note": "役に立った・改善案・議題にするは完了条件にしない",
        "screen": "read"
      },
      {
        "target": "emu-library",
        "label": "マイライブラリー",
        "text": "自分の投稿は、マイライブラリーにまとまるよ。押して開いてみよう。",
        "click": true,
        "screen": "read"
      },
      {
        "target": "emu-lib-list",
        "label": "自分の投稿",
        "text": "自分の投稿が並ぶよ。Good（役に立った）とChange（改善）の数もここで見られるよ。",
        "lib": true,
        "screen": "read"
      },
      {
        "target": "emu-tabs",
        "label": "タブ",
        "text": "ほかの画面へは、ここで切り替えられるよ。",
        "screen": "read"
      }
    ]
  },
  "emu-search": {
    "name": "02 知識を探す",
    "steps": [
      {
        "target": "emu-req-head",
        "label": "知識を探しています",
        "text": "ここには、みんなが探している知識が並ぶよ。",
        "screen": "search"
      },
      {
        "target": "emu-req-list",
        "label": "募集の一覧",
        "text": "答えられそうな募集があったら、知識を届けてみよう。採用されるとEMUERがもらえるよ。",
        "note": "回答・採用は完了条件にしない",
        "screen": "search"
      },
      {
        "target": "emu-req-btn",
        "label": "知識を募集する",
        "text": "自分が知りたいことは「知識を募集する」から募集できるよ。押してみよう。",
        "click": true,
        "screen": "search"
      },
      {
        "target": "emu-req-form",
        "label": "募集の書き方",
        "text": "何について知りたいか、困っている状況、回答期限を書くよ。今日は見るだけでOK。「やめる」で閉じられるよ。",
        "req": true,
        "note": "募集の公開は完了条件にしない",
        "screen": "search"
      },
      {
        "target": "emu-room1",
        "label": "Room1の入口",
        "text": "Room1もここから入れるよ。",
        "click": true,
        "note": "Room1は「知識を探す」の中だけに表示",
        "screen": "search"
      }
    ]
  },
  "emu-share": {
    "name": "03 一日シェア",
    "steps": [
      {
        "target": "emu-share-tabs",
        "label": "一日シェアのタブ",
        "text": "一日シェアは「今日の一日」「みんなの一日」「わたしの記録」の3つだよ。",
        "tab": "everyone",
        "screen": "share"
      },
      {
        "target": "emu-everyone",
        "label": "みんなの一日",
        "text": "みんなの一日の過ごし方を見られるよ。気になる予定は「＋取り入れる」で自分の今日に入れられるよ。",
        "tab": "everyone",
        "note": "取り入れる・投稿は完了条件にしない",
        "screen": "share"
      },
      {
        "target": "emu-filter",
        "label": "カテゴリ",
        "text": "生活・学び・仕事・健康などで絞り込めるよ。",
        "tab": "everyone",
        "screen": "share"
      },
      {
        "target": "emu-today",
        "label": "今日の一日",
        "text": "今日の予定と学びは「今日の一日」に書くよ。公開するかは自分で決められるよ。",
        "tab": "today",
        "note": "入力内容は案内・計測の対象外",
        "screen": "share"
      },
      {
        "target": "emu-mystats",
        "label": "わたしの記録",
        "text": "連続日数・達成率・役に立った人の数はここ。毎日がちゃんと積み重なっていくよ。",
        "tab": "mine",
        "screen": "share"
      },
      {
        "target": "emu-history",
        "label": "これまでの一日シェア",
        "text": "これまでの一日シェアは、ここで見返したり消したりできるよ。",
        "tab": "mine",
        "screen": "share"
      }
    ]
  },
  "emu-debate": {
    "name": "04 議論",
    "steps": [
      {
        "target": "emu-debate-list",
        "label": "議論",
        "text": "問いについて考える場所だよ。読むだけでも参加できるよ。",
        "note": "発言は完了条件にしない",
        "screen": "debate"
      }
    ]
  }
};
  function viewState() {
    var kd=frameDoc('emuKnowledgeFrame');
    return [document.body.className.split(/\s+/).filter(function(cls){return /^(?:sp-(?:passport|menu|room)-open|emu-(?:knowledge|requests|ichinichi|discussion)-open)$/.test(cls);}).join(' '),dao()?.state.screen,!!document.querySelector('#emuRequestSheet.open'),kd?.querySelector('#panel')?.classList.contains('open'),kd?.querySelector('#topFilters .active')?.dataset.filter,window._sppCurrentPage?.()].join('|');
  }
  function openView(item) {
    if(item.target==='emu-library' && window.innerWidth<=700 && !document.querySelector('#emuAccountMenu.open')) { requestAnimationFrame(function(){var running=tour.running();if(running?.id==='emu-feed' && running.index===6 && !document.querySelector('#emuAccountMenu.open'))window.toggleAccountMenu?.();}); }
    if(item.target==='passport-entry' && dao()?.state.device !== 'mobile' && dao()?.state.sidebarOpen === false) dao().toggleSidebar();
    if(item.pp && window._sppCurrentPage?.() !== item.pp) window.spPassportGoPage?.(item.pp);
    // CITY steps point at City's own home page; bring City back there if it is on another page.
    if(item.screen==='city' && /^city-/.test(item.target||'')) frameDoc('spDaoFrame')?.getElementById('sp-city')?.dispatchEvent(new CustomEvent('city-tour-home'));
    var kd=frameDoc('emuKnowledgeFrame'), kw=kd?.defaultView;
    if(item.lib && !kd?.querySelector('#panel.open')) { kd?.documentElement.removeAttribute('data-tour-library-ready'); kw?.openPanel?.('library'); }
    if(item.target === 'emu-tabs' && kd?.querySelector('#panel.open')) kw?.closeOverlay?.(kd.querySelector('#panel'));
    if(item.req && !document.querySelector('#emuRequestSheet.open')) {
      // Keep existing access checks; never open a purchase prompt or reset a draft.
      if(window.emuHasPlan?.('light') && window._emuAddress?.()) window.openEmuSheet?.('emuRequestSheet');
    }
    if(item.target === 'emu-room1' && document.querySelector('#emuRequestSheet.open')) window.closeEmuSheet?.('emuRequestSheet');
    if(item.tab) {
      var doc=frameDoc('emuIchinichiFrame'), tab=item.tab==='everyone'?'explore':item.tab;
      if(doc && !doc.querySelector('[data-tab="'+tab+'"].active')) doc.defaultView.selectTab?.(tab);
    }
  }
  function specificationStep(item) {
    var entry=step(item.target,item.label,item.text);
    if(item.target==='nav-guild') entry.target='[data-tour~=nav-guild],[data-tour~=nav-02]';
    entry.note=item.note;entry.open=function(){openView(item);};
    if(item.pp)entry.pending=function(){return window._sppCurrentPage?.()!==item.pp;};
    // On smaller widths the native monthly filter is the visible equivalent.
    if(item.target==='emu-theme') entry.target='[data-tour~=emu-theme],#topFilters [data-filter="monthly"]';
    if(item.click) entry.advanceOn={read:viewState};
    if(item.lib) entry.advanceOn={target:'[data-panel-close]',cancel:true,read:function(){return !!frameDoc('emuKnowledgeFrame')?.querySelector('#panel.open');}};
    if(item.req) entry.avoid='[data-tour~=emu-req-actions]';
    if(item.req) entry.advanceOn={target:'.emu-sheet-actions button:first-child',read:function(){return !!document.querySelector('#emuRequestSheet.open');}};
    return entry;
  }
  register("sp-home","ホーム",v2["home"].steps.map(specificationStep),"home",null);
  register("sp-guilds","ギルド",v2["guild"].steps.map(specificationStep),"logs",null);
  register("sp-quests","クエスト",v2["quest"].steps.map(specificationStep),"experiments",null);
  register("sp-wisdom","知恵",v2["wisdom"].steps.map(specificationStep),"library",null);
  register("sp-park","公園",v2["park"].steps.map(specificationStep),"park",null);
  register("sp-contribution","貢献",v2["contrib"].steps.map(specificationStep),"members",null);
  register("sp-treasury","treasury",v2["treasury"].steps.map(specificationStep),"treasury",null);
  register("sp-city","CITY",v2["city"].steps.map(specificationStep),"city",null);
  register("sp-passport","SchoolPark パスポート",v2["passport"].steps.map(specificationStep),"passport",null);
  register("emu-feed","01 知識を読む",v2["emu-read"].steps.map(specificationStep),null,"emuKnowledgeFrame");
  register("emu-requests","02 知識を探す",v2["emu-search"].steps.map(specificationStep),null,null);
  register("emu-share","03 一日シェア",v2["emu-share"].steps.map(specificationStep),null,"emuIchinichiFrame");
  register("emu-discussion","04 議論",v2["emu-debate"].steps.map(specificationStep),null,"emuDiscussionFrame");
  register('sp-guild','ギルドの詳細',[
    step('screen-heading','ギルドの詳細','まずは活動を読むだけでも大丈夫。「参加したい」は意思の登録で、クエストの受注とは別の操作です。'),
    step('guild-detail','決めごとの見方','ルールと議題を読んでから判断できます。投票や参加はこの案内の条件ではありません。')
  ],'guild');
  register('sp-quest-detail','クエストの詳細',[
    step('screen-heading','内容を読む','概要と現場の資料を確認する画面です。'),
    step('quest-detail','条件を確かめる','期限や報告の説明を読んでから判断してください。受ける・提出する必要はありません。')
  ],'detail');
  register('sp-plaza','公園の広場',[
    step('screen-heading','広場の見方','活動の表示内容を確認できます。'),
    step('plaza-list','一覧を読む','予定や挑戦を見られます。参加・投稿は必要ありません。')
  ],'plaza');
  register('sp-tasks','自分の宿題',[
    step('screen-heading','自分の宿題','取り組むことを確認できます。'),
    step('tasks-list','一覧の見方','締切やメモを読めます。追加・完了・削除はこの案内では行いません。')
  ],'tasks');
  register('sp-year-goals','年内目標',[
    step('screen-heading','年内目標','SchoolParkの目標と資料を読む場所です。'),
    step('year-goals','資料を読む','必要な箇所を確認してください。提出・編集は必要ありません。')
  ],'yeargoals');  function closeSupport() {
    var panel = document.getElementById('emu-contact-panel');
    if (panel?.classList.contains('open') && typeof window.toggleContactPanel === 'function') window.toggleContactPanel();
  }
  function element(tag, text, className) { var el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  var catalog = document.getElementById('rk-guide-catalog'), mode = 'guides';
  function catalogButton(label, action, id) { var el = element('button',label); el.type='button';el.onclick=action;if(id)el.dataset.rkSource=id;return el; }
  function statusText(p) { return {not_started:'未視聴',done:'完了',skipped:'スキップ',in_progress:'途中 '+(p.index+1)+'/'+p.total}[p.state]; }
  function guideRow(def, prefix) {
    var p=tour.progress(def.id), row=element('article',undefined,'rk-guide-row');
    row.append(element('strong',def.label),element('small',statusText(p)));
    var buttons=element('div',undefined,'rk-row-actions');
    var source=(prefix||'all-')+def.id;
    buttons.append(catalogButton(p.state==='in_progress'?'続きから再開':'再生',function(){tour.navigate(def.id,false);},source+'-resume'),
      catalogButton('最初から見る',function(){tour.restart(def.id);},source+'-restart'));
    row.append(buttons);return row;
  }
  function renderCatalog() {
    if (!catalog) return;
    var scrolling=catalog.parentElement.scrollTop, focused=document.activeElement?.dataset.rkSource;
    catalog.replaceChildren();catalog.className='rk-catalog';
    var choices=element('div',undefined,'rk-mode');
    ['guides','videos'].forEach(function(which){var b=catalogButton(which==='guides'?'画面別ガイド':'動画で見る',function(){mode=which;renderCatalog();},'catalog-'+which);b.setAttribute('aria-pressed',String(mode===which));choices.append(b);});catalog.append(choices);
    if (mode==='guides') {
      var defs=tour.list(), unfinished=defs.filter(function(def){return tour.progress(def.id).state==='in_progress';});
      if(unfinished.length){var resume=element('section',undefined,'rk-resume-list');resume.append(element('h3','途中のガイド'));unfinished.forEach(function(def){resume.append(guideRow(def,'unfinished-'));});catalog.append(resume);}
      ['SchoolPark','Emu'].forEach(function(brand){catalog.append(element('h3',brand));defs.filter(function(def){return def.brand===brand;}).forEach(function(def){catalog.append(guideRow(def));});});
    } else {
      catalog.append(element('p','実際の操作動画は準備中です。画面別ガイドは今すぐ使えます。'));
      ['SchoolPark','Emu'].forEach(function(brand){['PC版','スマホ版'].forEach(function(device){var row=element('section',undefined,'rk-video-row');row.append(element('strong',brand+' · '+device),element('p','動画準備中'));catalog.append(row);});});
    }
    var link=element('a','文章のチュートリアルを読む');link.href='/schoolpark/tutorial.html';link.target='_blank';link.rel='noopener';catalog.append(link);
    catalog.parentElement.scrollTop=scrolling;
    if(focused){var replacement=catalog.querySelector('[data-rk-source="'+focused+'"]');if(replacement)replacement.focus({preventScroll:true});}
  }
  tour.subscribe(renderCatalog);renderCatalog();
  window.ReizoTourCatalogRefresh=renderCatalog;
  window.ReizoTourSchoolParkRendered=function(){if(document.body.classList.contains('sp-dao-open'))scheduleRoute();tour.refresh();};
  window.ReizoTourAsk=function(source){var id=screen();tour.choose(id,function(){if(typeof window.spReizoOpen==='function')window.spReizoOpen();},source);};
  var observed=new WeakSet();
  function watchFrame(fr) {
    var doc;try{doc=fr.contentDocument;}catch(error){return;}
    if(!doc||!doc.body||observed.has(doc))return;observed.add(doc);
    deliveries.set(doc,{});
    fr.contentWindow.addEventListener('message',function(event){
      if(event.origin!==window.location.origin || event.source!==window) return;
      var type=event.data?.type, meta=deliveries.get(doc);
      if(type==='emu-knowledge-loading'){meta.posts=false;}
      if(type==='emu-knowledge-posts'){meta.posts=true;}
      if(type==='emu-knowledge-panel-data' && event.data.kind==='library'){meta.library=true;}
      if(type==='emu-discussion-rooms'){meta.rooms=true;}
      tour.refresh();
    });
    var wasLibrary=false;
    var mo=new MutationObserver(function(){var open=!!doc.querySelector('#panel.open');if(!open && wasLibrary)deliveries.get(doc).library=false;wasLibrary=open;scheduleRoute();});
    mo.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    fr.contentWindow.addEventListener('pagehide',function(){mo.disconnect();},{once:true});
  }
  ['spDaoFrame','emuKnowledgeFrame','emuIchinichiFrame','emuDiscussionFrame'].forEach(function(id){var fr=document.getElementById(id);if(fr){fr.addEventListener('load',function(){watchFrame(fr);scheduleRoute();});watchFrame(fr);}});
  var observer=new MutationObserver(function(records){if(records.some(function(record){return !record.target.closest?.('#rk-tour,#rk-guide-catalog');}))scheduleRoute();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','hidden']});
  synchronize();
})(window, document);
