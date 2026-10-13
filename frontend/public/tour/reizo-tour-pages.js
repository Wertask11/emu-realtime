/* Adapters for existing navigation only. No Firebase, authentication, content writes, or analytics. */
(function (window, document) {
  'use strict';
  var tour = window.ReizoTour; if (!tour) return;
  var SP = {home:'home',logs:'guilds',guild:'guild',experiments:'quests',detail:'quest-detail',library:'wisdom',park:'park',plaza:'plaza',members:'contribution',treasury:'treasury',city:'city',tasks:'tasks',yeargoals:'year-goals'};
  var EMU = {'emu-knowledge-open':'feed','emu-requests-open':'requests','emu-ichinichi-open':'share','emu-discussion-open':'discussion'};
  function frameDoc(id) { try { var fr = document.getElementById(id); return fr && fr.contentDocument; } catch (error) { return null; } }
  function dao() { try { var fr = document.getElementById('spDaoFrame'); return fr && fr.contentWindow && fr.contentWindow.app; } catch (error) { return null; } }
  function visible(el) { return !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function ready(spScreen) {
    // Wait until the existing cover is actually removed, including its ready/fade phase.
    if (document.documentElement.classList.contains('ches-resuming') ||
        ['spLoadingOverlay','loadingOverlay'].some(function (id) { return visible(document.getElementById(id)); })) return false;
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
  function screen() {
    if (document.getElementById('emu-contact-panel')?.classList.contains('open')) return null;
    if (document.getElementById('spReizoPanel')?.classList.contains('open')) return null;
    if (Array.from(document.querySelectorAll('.modal')).some(visible)) return null;
    if (/(?:^|\s)sp-(?:room|menu|passport|vote|quest|wisdom|log)-open(?:\s|$)/.test(document.body.className)) return null;
    if (document.body.classList.contains('sp-dao-open')) { var app = dao(); return app && SP[app.state.screen] ? 'sp-' + SP[app.state.screen] : null; }
    if (!visible(document.getElementById('mainApp'))) return null;
    for (var cls of Object.keys(EMU)) if (document.body.classList.contains(cls)) {
      var doc = frameDoc(cls === 'emu-knowledge-open' ? 'emuKnowledgeFrame' : cls === 'emu-ichinichi-open' ? 'emuIchinichiFrame' : 'emuDiscussionFrame');
      if (doc && doc.querySelector('.overlay.open')) return null;
      return 'emu-' + EMU[cls];
    }
    return null;
  }
  function synchronize() { tour.enter(screen()); }
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
      isReady:function () { return ready(spScreen); },
      getDocuments:function () { return [frameDoc(spScreen?'spDaoFrame':emuFrame),document]; },
      bottomInset:function () { return bottomInset(brand); },
      restoreFocus:function (source) {
        var panel=document.getElementById('emu-contact-panel');
        if(source?.closest('#emu-contact-panel')&&panel&&!panel.classList.contains('open')&&typeof window.toggleContactPanel==='function')window.toggleContactPanel();
      },
      navigate:function () { closeSupport(); return spScreen ? goSchoolPark(spScreen) : goEmu(id.slice(4)); }
    });
  }
  register('sp-home','ホーム',[
    step('home-main','ホームの概要','知恵や進行中の仕事の概要を確認できます。'),
    step('menu','メニューの見方','ホーム、ギルド、クエスト、知恵、公園、貢献、treasury、CITYの順です。'),
    step('home-wisdom','生まれた知恵','経験から残った一文を読めます。'),
    step('home-quests','進行中のクエスト','仕事の内容や締切を一覧から確認できます。'),
    step('home-todo','自分の宿題','自分が取り組むことを確認する場所です。完了の操作はこの案内では不要です。'),
    step('fridge','冷蔵庫くん','画面のガイドと、質問するチャットを選べます。'),
    step('support-btn','困ったとき','メニューやサポートから、問い合わせとガイドの再生へ進めます。')
  ],'home');
  register('sp-guilds','ギルド',[
    step('guild-intro','ギルドとは','活動のまとまりと決めごとを見る場所です。'),
    step('guild-list','ギルド一覧','カードから活動とルールを確認できます。ここで参加する必要はありません。')
  ],'logs');
  register('sp-guild','ギルドの詳細',[
    step('screen-heading','ギルドの詳細','活動や参加条件を確認できます。'),
    step('guild-detail','決めごとの見方','ルールと議題を読んでから判断できます。投票や参加はこの案内の条件ではありません。')
  ],'guild');
  register('sp-quests','クエスト',[
    step('quest-intro','クエストとは','仕事や実験の内容を確認する場所です。'),
    step('quest-filter','絞り込み','表示する種類を切り替えられます。次へだけでも進めます。',function () { return dao()?.state.filter; }),
    step('quest-list','一覧から詳細へ','内容や期限を読んで検討できます。応募・参加は案内の条件ではありません。')
  ],'experiments');
  register('sp-quest-detail','クエストの詳細',[
    step('screen-heading','内容を読む','概要と現場の資料を確認する画面です。'),
    step('quest-detail','条件を確かめる','期限や報告の説明を読んでから判断してください。受ける・提出する必要はありません。')
  ],'detail');
  register('sp-wisdom','知恵',[
    step('wisdom-intro','知恵とは','元の知識を実際に試し、残った一文を読む場所です。'),
    step('wisdom-tags','分類で探す','タグで表示を絞れます。次へだけでも進めます。',function () { return dao()?.state.wtag; }),
    step('wisdom-list','カードを読む','必要なら詳細を開いて、経験の背景を読めます。引用や投稿は必須ではありません。')
  ],'library');
  register('sp-park','公園',[
    step('park-intro','公園とは','遊びや活動の入口を見る場所です。'),
    step('park-map','地図の見方','気になる場所を確認できます。移動や参加をしなくても案内を終えられます。')
  ],'park');
  register('sp-plaza','公園の広場',[
    step('screen-heading','広場の見方','活動の表示内容を確認できます。'),
    step('plaza-list','一覧を読む','予定や挑戦を見られます。参加・投稿は必要ありません。')
  ],'plaza');
  register('sp-contribution','貢献',[
    step('contribution-intro','貢献とは','活動の記録を確認する場所です。'),
    step('contribution-list','一覧の見方','知恵や完走、引用の記録を見られます。表示だけでは支払いは発生しません。')
  ],'members');
  register('sp-treasury','treasury',[
    step('treasury-card','treasuryとは','予算とお金の記録を確認する場所です。'),
    step('treasury-transactions','取引の見方','表示された記録を読む案内です。送金・購入は行いません。'),
    step('support-btn','分からないとき','メニューやサポートから問い合わせできます。')
  ],'treasury');
  register('sp-city','CITY',[
    step('screen-heading','CITYの入口','SchoolPark Cityへ広がる入口です。詳細な移動・購入・チェックインの案内は今回ありません。')
  ],'city');
  register('sp-tasks','自分の宿題',[
    step('screen-heading','自分の宿題','取り組むことを確認できます。'),
    step('tasks-list','一覧の見方','締切やメモを読めます。追加・完了・削除はこの案内では行いません。')
  ],'tasks');
  register('sp-year-goals','年内目標',[
    step('screen-heading','年内目標','SchoolParkの目標と資料を読む場所です。'),
    step('year-goals','資料を読む','必要な箇所を確認してください。提出・編集は必要ありません。')
  ],'yeargoals');
  register('emu-feed','知識を読む',[
    step('knowledge-sort','一覧の見方','並び替えて知識を探せます。次へだけでも進めます。',function () { return frameDoc('emuKnowledgeFrame')?.querySelector('#topFilters .active')?.dataset.filter; }),
    step('knowledge-card','カードを読む','本文はカード内で読めます。長い本文は「続きを読む」から確認できます。'),
    step('emu-tabs','画面の切り替え','知識を読む、知識を探す、一日シェア、議論の4画面です。保存・投稿は案内の条件ではありません。')
  ],null,'emuKnowledgeFrame');
  register('emu-requests','知識を探す',[
    step('request-intro','知識を探す','まだ答えがない困りごとを確認する場所です。'),
    step('request-list','募集を読む','内容を読んで、自分に合うものを探せます。募集や回答を出す必要はありません。'),
    step('room1-entry','Room1の入口','分野別の学習コンテンツはここから開けます。案内は次へだけでも完了できます。')
  ]);
  register('emu-share','一日シェア',[
    step('share-frame','一日シェアとは','日々のシェアを読む画面です。'),
    step('emu-tabs','次の画面へ','下部または左のタブで移れます。投稿や＋ボタンの操作は不要です。')
  ],null,'emuIchinichiFrame');
  register('emu-discussion','議論',[
    step('discussion-frame','議論とは','開催中の議論を確認する画面です。'),
    step('emu-tabs','画面の切り替え','読むだけでも大丈夫です。発言やルーム作成は案内の条件ではありません。')
  ],null,'emuDiscussionFrame');
  function closeSupport() {
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
    var mo=new MutationObserver(function(){scheduleRoute();});
    mo.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    fr.contentWindow.addEventListener('pagehide',function(){mo.disconnect();},{once:true});
  }
  ['spDaoFrame','emuKnowledgeFrame','emuIchinichiFrame','emuDiscussionFrame'].forEach(function(id){var fr=document.getElementById(id);if(fr){fr.addEventListener('load',function(){watchFrame(fr);scheduleRoute();});watchFrame(fr);}});
  var observer=new MutationObserver(function(records){if(records.some(function(record){return !record.target.closest?.('#rk-tour,#rk-guide-catalog');}))scheduleRoute();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','hidden']});
  synchronize();
})(window, document);
