const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'frontend/public/tour/reizo-tour.js'),'utf8');
function load(raw,blocked=false){
 const stored=new Map([['unrelated-app','PRIVATE_APP_DATA']]);if(raw!==undefined)stored.set('rk-tour-v1',raw);
 const window={location:{hostname:'test.invalid'},localStorage:{getItem:k=>{if(blocked)throw new Error('blocked');return stored.get(k)||null;},setItem:(k,v)=>{if(blocked)throw new Error('blocked');stored.set(k,v);}}};
 vm.runInNewContext(source,{window,document:{},Map,Set,Number,Object,Array,JSON});return {tour:window.ReizoTour,stored};
}
const steps=[{target:'[data-tour="x"]',label:'読む',text:'閲覧だけで大丈夫'}];
test('new and unknown/corrupt state initialize safely without touching app data',()=>{
 for(const raw of [undefined,'{',JSON.stringify({version:999,tours:{}}),JSON.stringify({version:1,tours:[]})]){
  const {tour,stored}=load(raw);tour.register('sp-home',steps);assert.equal(tour.progress('sp-home').state,'not_started');assert.equal(stored.get('unrelated-app'),'PRIVATE_APP_DATA');
 }
});
test('restore only status/index; discard personal fields and invalid records',()=>{
 const {tour}=load(JSON.stringify({version:1,tours:{'sp-home':{state:'in_progress',index:3,name:'PRIVATE_NAME',wallet:'PRIVATE_WALLET'},'emu-feed':{state:'done',index:0},'sp-invalid':{state:'unknown',index:0}}}));
 tour.register('sp-home',[...steps,...steps]);tour.register('emu-feed',steps);tour.register('sp-invalid',steps);
 assert.deepEqual(JSON.parse(JSON.stringify(tour.progress('sp-home'))),{state:'in_progress',index:1,total:2});
 assert.equal(tour.progress('emu-feed').state,'done');assert.equal(tour.progress('sp-invalid').state,'not_started');assert.ok(!JSON.stringify(tour.progress()).includes('PRIVATE'));
});
test('blocked localStorage does not prevent definitions or progress reads',()=>{
 const {tour}=load(undefined,true);assert.doesNotThrow(()=>tour.register('emu-feed',steps));assert.equal(tour.progress('emu-feed').state,'not_started');
});
test('invalid definitions fail without registering an incomplete guide',()=>{
 const {tour}=load();assert.throws(()=>tour.register('post/private-id',steps));assert.throws(()=>tour.register('sp-home',[]));assert.throws(()=>tour.register('sp-home',[{}]));assert.equal(tour.list().length,0);
});
test('Room1 has one search entrance and no read-screen DOM entrance',()=>{
 const index=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8'),knowledge=fs.readFileSync(path.join(root,'frontend/public/knowledge.html'),'utf8');
 assert.ok(!knowledge.includes('data-command="room1"'));
 assert.equal((index.match(/class="emu-room1-entry"/g)||[]).length,1);
 const start=index.indexOf('id="emuRequestsPage"'),end=index.indexOf('id="emuIchinichiPage"');assert.ok(index.indexOf('data-tour="room1-entry emu-room1"')>start&&index.indexOf('data-tour="room1-entry emu-room1"')<end);
 assert.ok(index.includes("openSpRoom('/admin/room1/index.html', 'Room1')"));
});
test('core state/UI never dispatch network requests or app clicks',()=>{
 assert.ok(!/\b(?:fetch|XMLHttpRequest|sendBeacon|postMessage)\s*\(/.test(source));assert.ok(!/\.click\s*\(/.test(source));
 const adapters=fs.readFileSync(path.join(root,'frontend/public/tour/reizo-tour-pages.js'),'utf8');assert.ok(!/\b(?:fetch|XMLHttpRequest|sendBeacon|postMessage)\s*\(/.test(adapters));
});
test('SchoolPark readiness distinguishes default empty lists from delivered empty results',()=>{
 const dao=fs.readFileSync(path.join(root,'frontend/public/schoolpark/dao.html'),'utf8');
 const section=dao.slice(dao.indexOf('var DCLogic = function'),dao.indexOf('const EXPS ='));
 const sandbox={schedule(){},Object};vm.runInNewContext(section,sandbox);
 const app=new sandbox.DCLogic();app.state={quests:[],guilds:[]};app.tourDataReady=Object.create(null);
 app.setState({screen:'experiments'});assert.equal(app.tourDataReady.quests,undefined);
 app.setState({quests:[]});assert.equal(app.tourDataReady.quests,true);assert.equal(app.tourDataReady.guilds,undefined);
 app.setState(state=>({guilds:[],filter:state.filter||'すべて'}));assert.equal(app.tourDataReady.guilds,true);
 assert.equal(app.state.filter,'すべて');assert.deepEqual(Object.keys(app.tourDataReady).sort(),['guilds','quests']);
});
test('flat v2 storage restores status and numbers without importing content',()=>{
 const {tour}=load(JSON.stringify({'sp-home':6,'emu-feed':'done','emu-share':'skipped','sp-bad':{name:'PRIVATE'},'private/user':'done'}));
 tour.register('sp-home',Array(9).fill(steps[0]));tour.register('emu-feed',steps);tour.register('emu-share',steps);tour.register('sp-bad',steps);
 assert.equal(tour.progress('sp-home').index,6);assert.equal(tour.progress('emu-feed').state,'done');assert.equal(tour.progress('emu-share').state,'skipped');assert.equal(tour.progress('sp-bad').state,'not_started');assert.ok(!JSON.stringify(tour.progress()).includes('PRIVATE'));
});
test('legacy progress follows equivalent v2 steps rather than resetting',()=>{
 const {tour}=load(JSON.stringify({version:1,tours:{'sp-home':{state:'in_progress',index:5},'emu-feed':{state:'in_progress',index:1},'sp-park':{state:'done',index:1}}}));
 tour.register('sp-home',Array(9).fill(steps[0]));tour.register('emu-feed',Array(9).fill(steps[0]));tour.register('sp-park',Array(3).fill(steps[0]));
 assert.equal(tour.progress('sp-home').index,6);assert.equal(tour.progress('emu-feed').index,4);assert.equal(tour.progress('sp-park').state,'done');
});
test('existing navigation and native behavior remain identical outside the explicit Lab, chat and shared header integrations',()=>{
 const cp=require('node:child_process');
 const baseline='412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa';
 for(const name of ['index.html','schoolpark/dao.html','knowledge.html','ichinichi.html','discussion.html']) {
  const file='frontend/public/'+name;
  const before=cp.execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  let current=fs.readFileSync(path.join(root,file),'utf8');
  // Participation UX changes only these read/navigation regions. Keep the
  // previous full-file regression around the remaining native implementation.
  const uxBefore=cp.execFileSync('git',['show','f52dc21cbe20c7e09ea21bf7496a0f4e5487cd8a:'+file],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  const uxRegion=(source,a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
  const uxRestore=(a,b,oldA=a,oldB=b)=>{current=current.replace(uxRegion(current,a,b),uxRegion(uxBefore,oldA,oldB));};
  if(name==='index.html') {
   uxRestore('    <div class="esn-brand-wrap">','    <button type="button" class="esn-collapse"');
   uxRestore('<div class="service-heading"><button type="button" class="service-switch"','\n\n  <div class="header-right service-tools"','<div class="service-heading"><small>','\n\n  <div class="header-right service-tools"');
   current=current.replace(/^    <aside class="emu-practice-entry"[^\n]+\n/m,'');
   const {grab}=require('../year-goals-tests/extract.cjs');
   for(const fn of ['emuBrandToggle','emuBrandGo'])current=current.replace(grab(current,fn),grab(uxBefore,fn));
   current=current.replace("  document.querySelector('.esn-brand')?.setAttribute('aria-expanded', 'false');\n",'');
   uxRestore('let _spMenuReturnFocus = null;','\nfunction smmGo(brand)','window.openSpMobileMenu = function (current) {','\nfunction smmGo(brand)');
   uxRestore('    <div class="smm-label">SchoolPark / Emu を切り替える','    <button type="button" class="smm-row" data-brand="emu"','    <div class="smm-label">ブランドを切り替える','    <button type="button" class="smm-row" data-brand="emu"');
   current=current.replace("    stage: SpQuestStore.isValidStage(q.stage) ? q.stage : '',\n",'');
  }
  if(name==='schoolpark/dao.html') {
   current=current.replace('class="service-mobile-menu" data-tour="menu support-btn passport-entry"','data-tour="menu support-btn passport-entry"');
   // Display-only participation value panels; action/identity code remains guarded.
   current=current.replace(/^ *<!-- participation-value:start -->[\s\S]*?^ *<!-- participation-value:end -->\n/gm,'');
   current=current.replace(/^          <p class="sp-ux-note">Emuで読んだ知識や[^\n]+\n/m,'').replace(/^              <p class="sp-ux-note">関心の近い人が、[^\n]+\n/m,'');
   uxRestore('        <div class="service-heading service-schoolpark-heading"','        <div class="service-tools"','        <div class="service-heading"','        <div class="service-tools"');
   uxRestore('          <button type="button" class="sp-sidebar-switch"','          <sc-if value="{{ brandOpen }}">','          <div onClick="{{ toggleBrand }}"','          <sc-if value="{{ brandOpen }}">');
   uxRestore('            <div role="menu" aria-label="SchoolPark / Emu"','          </sc-if>','            <div style="position:absolute; top:38px;','          </sc-if>');
   current=current.replace(/^          <aside class="sp-ux-note sp-ux-home-entry"[^\n]+\n/m,'');
   current=current.replace(/^          <p class="sp-ux-note">まずは、[^\n]+\n/m,'').replace(/^          <div class="sp-ux-actions"><button[^\n]+\n/m,'').replace(/^          <sc-if value="{{ noShownQuests }}">[^\n]+\n/m,'');
   uxRestore('              <details data-keep-open="quest-purpose"','              <div onClick="{{ goPropose }}"','              <div style="flex:1 1 380px;','              <div onClick="{{ goPropose }}"');
   uxRestore('                      <button type="button" class="sp-ux-button" data-tour="quest-card"','\n                    </div>','                      <div data-tour="quest-card"','\n                    </div>');
   current=current.replace('まずは、ギルドの活動を見る</div>','ギルドを選ぶ</div>').replace(/^              <p class="sp-ux-note">ギルドは、[^\n]+\n/m,'');
   current=current.replace('role="button" tabindex="0" class="sp-ux-guild-card" data-tour="guild-card"','data-tour="guild-card"').replace(/^                      <span class="sp-ux-browse-label">[^\n]+\n/m,'');
   current=current.replace(/^            <section class="sp-ux-note" data-tour="guild-before-join">[^\n]+\n/m,'');
   for(const kind of ['join','support']) {
    const a='<button type="button" class="sp-ux-guild-action" onClick="{{ curGuild.'+kind+' }}"',oldA='<div onClick="{{ curGuild.'+kind+' }}"';
    const i=current.indexOf(a),j=current.indexOf('</button>',i)+9,oi=uxBefore.indexOf(oldA),oj=uxBefore.indexOf('</div>',oi)+6;
    assert.ok(i>=0&&oi>=0);current=current.slice(0,i)+uxBefore.slice(oi,oj)+current.slice(j);
   }
   current=current.replace(/^                <section class="sp-ux-before-accept"[^\n]+\n/m,'');
   uxRestore('                <button type="button" class="sp-ux-accept"','\n                <sc-if value="{{ cur.canWisdom }}">','                <div onClick="{{ cur.commit }}"','\n                <sc-if value="{{ cur.canWisdom }}">');
   current=current.replace('未完走なら「受けている」を押して降りる確認に進めます。完走後は記録を守るため降りられません。<br>出した報告は編集・削除できません。','受けると、締切までにログを1本出す約束になります。<br>やり終えたら、知恵カードを1枚置いてください。');
   current=current.replace(/^  openSwitch = \([^\n]+\n/m,'').replace('      openSwitch:this.openSwitch, openProfile:this.openProfile,','      openProfile:this.openProfile,');
   current=current.replace("series:'general', entryOnly:false, yearDoc:null","series:'general', yearDoc:null");
   current=current.replace(/^      previewLabel: [^\n]+\n/m,'');
   uxRestore('    const statusExps =','    const kind =','    const shownExps =','    const kind =');
   current=current.replace(/^      entryOnly:!!s.entryOnly,[^\n]+\n/m,'');
   current=current.replace("  const switchFocus = document.hasFocus() && document.activeElement?.matches('.service-switch,.sp-sidebar-switch')\n    ? (document.activeElement.matches('.service-switch') ? '.service-switch' : '.sp-sidebar-switch') : null;\n",'').replace("  if (switchFocus) host.querySelector(switchFocus)?.focus({preventScroll:true});\n",'');
   const a=current.indexOf('// Native keyboard activation'),b=current.indexOf('// Clicking elsewhere',a);assert.ok(a>=0&&b>a);current=current.slice(0,a)+current.slice(b);
  }
  // Reviewed profile-only integration. Restore these UI regions to the last
  // deployed version, then keep the existing guard over every other byte.
  // Native Auth/Firestore browser tests exercise the new profile/settings paths.
  if(name==='index.html') {
   const previous=cp.execFileSync('git',['show','f8dd91d45b83b20aaacd0c9be24d883a5ef7bf7d:'+file],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
   const region=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
   const oldAccount=region(previous,'    <div class="emu-account-wrap">','    <button type="button" class="service-tool" id="emuHeaderReizo"');
   const newAccount=region(current,'    <div class="emu-account-wrap" id="sharedAccountControls"','    <button type="button" class="service-tool service-profile" id="emuHeaderProfile"');
   assert.ok(newAccount.includes('accountGo(\'passport\')'));
   current=current.replace(newAccount,oldAccount).replace(/^    <button type="button" class="service-tool service-profile" id="emuHeaderProfile"[^\n]+\n/m,'');
   current=current.replace(region(current,'<script>\n// Keep the existing identity node','<!-- SchoolPark の中から開く小部屋'),'');
   current=current.replace('⚙️ SchoolPark・Emu 設定','⚙️ SchoolPark 設定');
   current=current.replace(region(current,'    <div class="sp-panel-section" id="emuIdentitySettings">','    <!-- 1. 招待リンク'),'');
   const oldSheet=region(previous,'<!-- 設定。スマホのアカウントメニューから開く。','<!-- FLOATING BUTTON -->');
   current=current.replace('<!-- FLOATING BUTTON -->',oldSheet+'<!-- FLOATING BUTTON -->');
   current=current.replace("  if (panelId === 'spSettingsPanel') { setTimeout(_loadSpSettings, 80); emuLoadIdentitySettings(); }","  if (panelId === 'spSettingsPanel') setTimeout(_loadSpSettings, 80);");
   const oldMenu=region(previous,'/* ───────── アカウントメニュー（ヘッダー右上）','/* ───────── 名前と写真');
   const newMenu=region(current,'/* ───────── アカウントメニュー（ヘッダー右上）','/* ───────── 名前と写真');
   current=current.replace(newMenu,oldMenu);
   const oldIdentity=region(previous,'/* 右上の表示（スマホ）。どちらを出すか','/* ───── SchoolPark ─────');
   const newIdentity=region(current,'/* プロフィール内の表示。どちらを出すか','/* ───── SchoolPark ─────');
   current=current.replace(newIdentity,oldIdentity);
   current=current.replace("  if (what === 'passport') { openSpPassport(); return; }\n",'');
   current=current.replace('function spDaoPlaceContact() {\n  emuPaintHeaderIdentity();','function spDaoPlaceContact() {');
  }
  if(name==='schoolpark/dao.html') {
   current=current.replace("  openProfile = () => { try { window.parent.toggleAccountMenu(null, document.querySelector('[data-sp-head] .service-profile')); } catch (e) {} };\n",'');
   current=current.replace('      openProfile:this.openProfile, openPassport:this.openPassport,','      openPassport:this.openPassport,');
   current=current.replace('  goElevator = () =>',"  openSettings = () => { try { window.parent.openSpPanel('spSettingsPanel'); } catch (e) {} };\n  goElevator = () =>");
   current=current.replace('      askReizo:this.askReizo, keyAskReizo:this.keyAskReizo,','      askReizo:this.askReizo, keyAskReizo:this.keyAskReizo,\n      openSettings:this.openSettings,');
   current=current.replace(/<script>\n\/\/ Clicking elsewhere inside the SchoolPark frame[\s\S]*?<\/script>\n/,'');
  }
  // Explicitly requested shared header: normalize only the reviewed markup and
  // display condition; the byte-for-byte guard still covers all other behavior.
  current=current.replace('<link rel="stylesheet" href="/service-header.css">\n','');
  if(name==='index.html') {
   // Reviewed subscription entry: preserve the guard for every other byte.
   current=current.replace('<button type="button" class="ches-legal-back" aria-label="前の画面に戻る" onclick="closeLegal()">← 戻る</button>','<button type="button" class="ches-legal-back" onclick="closeLegal()">← Emuに戻る</button>');
   current=current.replace("  // A user-opened membership overlay takes precedence over a late default landing.\n  if (window.auth?.currentUser && document.getElementById('chesLegalModal')?.style.display === 'flex'\n      && /^\\/membership\\.html(?:[?#]|$)/.test(document.getElementById('chesLegalFrame')?.getAttribute('src') || '')) return;\n",'');
   current=current.replace("    if (window.auth && !window.auth.currentUser && typeof emuEnsureSignedIn === 'function')\n      emuEnsureSignedIn({ interactive: true }).catch(() => {});\n",'');
   current=current.replace('<script src="/membership-entry.js"></script>\n','')
    .replace(/^    <button type="button" class="service-plan" id="emuHeaderPlan"[^\n]+\n/gm,'')
    .replace('プラン・お支払いを確認する</span>','プランをアップグレードする</span>')
    .replace('function accountGo(what, selectedPlan) {','function accountGo(what) {')
    .replace("    openLegal('membership', what, selectedPlan);","    openLegal('membership');\n    const frame = document.getElementById('chesLegalFrame');\n    if (frame) frame.src = '/membership.html#' + what;")
    .replace("membership:{ src: '/membership.html', title: 'プラン・お支払い' }","membership:{ src: '/membership.html', title: 'プランをアップグレードする' }")
    .replace('window.openLegal = function (kind, section, selectedPlan) {','window.openLegal = function (kind) {');
   const reviewedEntry="    if (kind === 'membership') {\n      const target = new URL(conf.src, location.origin);\n      target.hash = ['plan','profile','themes','sessions'].includes(section) ? section : 'plan';\n      if (['light','plus','pro'].includes(selectedPlan)) target.searchParams.set('plan', selectedPlan);\n      frame.src = target.pathname + target.search + target.hash;\n    } else frame.src = conf.src;\n    frame.title = conf.title;\n";
   assert.ok(current.includes(reviewedEntry));
   current=current.replace(reviewedEntry,"    frame.src = conf.src;\n");
   const reviewedResume="\n    try {\n      const intent = JSON.parse(sessionStorage.getItem('emu-membership-entry') || 'null');\n      sessionStorage.removeItem('emu-membership-entry');\n      if (intent && Date.now() - intent.at < 30 * 60 * 1000 && typeof accountGo === 'function')\n        accountGo('plan', intent.plan);\n    } catch (_) {}\n";
   assert.ok(current.includes(reviewedResume));
   current=current.replace(reviewedResume,"");
   current=current.replace('<header class="header service-header"','<header class="header"')
    .replace('<div class="service-heading"><small>知識と経験を、次の一歩へ</small><strong>Emu</strong></div>','<div style="flex-grow: 1;"></div>')
    .replace('class="header-right service-tools"','class="header-right"')
    .replace('class="wallet-button service-tool"','class="wallet-button"')
    .replace(/^    <button type="button" class="service-tool" id="emuHeader(?:Reizo|Settings)"[^\n]+\n/gm,'')
    .replace("if (!addr || (!_emuPhoneLayout() && !btn.closest('.service-tools'))) {",'if (!addr || !_emuPhoneLayout()) {')
    .replace('    /* 未接続時はログイン処理の表示を維持。共通ヘッダーではPCでも\n       本人が選んだ名前・画像の設定を利用する。 */','    /* パソコン・タブレット（とログイン前）は、ほかの処理が決めた表示のまま。\n       スマホの幅で描いたあとに幅が変わったときだけ、元に戻す。 */');

   // Preserve the latest main's reviewed Knowledge Lab hooks.
   const starHook='    window.emuLabSendActivity?.(iframe);\n';
   const reactionHook='    if (detail.ok) { syncKnowledgeFrame(); window.emuLabSyncIndex?.(detail.postId); }';
   assert.equal(current.split(starHook).length-1,1);
   assert.equal(current.split(reactionHook).length-1,1);
   current=current.replace(starHook,'').replace(reactionHook,'    if (detail.ok) syncKnowledgeFrame();');
   // Intentional chat-only extension; every other byte stays under this regression.
   const {grab}=require('../year-goals-tests/extract.cjs');
   // Approved membership migration: only the shared Passport counter keys and
   // returned own-Passport field change. Keep the rest of the monolith guarded.
   current=current.replace("      window.emuEntitlementSchoolParkId = s.schoolParkId || null;\n",'');
   current=current.replace("  const membershipEpoch = Date.now() >= Date.parse('2026-11-01T00:00:00+09:00') ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7) : 'legacy';\n  if (window.emuEntitlementEpoch !== membershipEpoch) force = true;\n",'').replace("      window.emuEntitlementEpoch = membershipEpoch;\n",'');
   for (const fn of ['_emuAddUsage','createKnowledgeDraft','deleteKnowledgeDraft']) {
    const changed=grab(current,fn),old=grab(before,fn);
    assert.equal(changed.replace(/\n\s+await emuEnsureEntitlement\(\);/,''),old,'Only entitlement preparation may change '+fn);
    current=current.replace(changed,old);
   }

   current=current.replace("  // Preserve an explicit Lab/guide navigation if the default login landing returns late.\n  if (window.auth?.currentUser && document.body.classList.contains('sp-room-open')\n      && /^\\/knowledge-lab(?:-guide)?\\.html(?:[?#]|$)/.test(document.getElementById('spRoomFrame')?.getAttribute('src') || '')) return;\n",'');

   for (const fn of ['_emuUsageDocId','_emuCountsRef']) current=current.replace(grab(current,fn),grab(before,fn));

   for (const fn of ['spReizoAnswer','spReizoSend','spReizoKeydown','_spReizoShowTyping']) current=current.replace(grab(current,fn),grab(before,fn));
   current=current.replace('<script src="/reizo/knowledge.js"></script>\n','').replace('<script src="/reizo/chat.js"></script>\n','');
   const kbStart=before.indexOf('const SP_REIZO_KB = ['), kbEnd=before.indexOf('function spReizoAnswer',kbStart);
   current=current.replace(grab(before,'spReizoAnswer'), before.slice(kbStart,kbEnd)+grab(before,'spReizoAnswer'));
   current=current.replace('placeholder="冷蔵庫くんに聞く…" aria-label="冷蔵庫くんに聞く" maxlength="1000"','placeholder="質問する..."').replace('class="sp-reizo-send" aria-label="送信"','class="sp-reizo-send"');

   current=current.replace('<script src="/knowledge-lab/integration.js"></script>\n','')
    .replace(/^    <div class="eth-card" data-tour="emu-lab-entry">.*<\/div>\n/m,'')
    .replace(/^      window\.emuLabSyncIndex\?\.\([^\n]+\);\n/gm,'')
    .replace('      const _labPostRef = window.fbLib.doc(window.fbLib.collection(window.db, "posts"));\n      _postBatch.set(_labPostRef, postData);','      _postBatch.set(window.fbLib.doc(window.fbLib.collection(window.db, "posts")), postData);')
    .replace('      const _labPhysicalLast = visibleDocs.length ? visibleDocs[visibleDocs.length - 1] : knowledgeLastDoc;\n      visibleDocs = visibleDocs.filter(d => !d.data().knowledgeLab?.tombstone);\n','')
    .replace('      knowledgeLastDoc = _labPhysicalLast;','      knowledgeLastDoc = visibleDocs.length ? visibleDocs[visibleDocs.length - 1] : knowledgeLastDoc;')
    .replace('      if (post.knowledgeLab) return window.openEmuKnowledgeLab("library", {edit:post.id});\n','')
    .replace("      if (message.command === 'knowledge-lab') window.openEmuKnowledgeLab();\n",'')
    .replace("      if (message.command === 'experience') window.openEmuKnowledgeLab('library', {compose:true});\n",'');
   const start=current.indexOf('  // Shared entry for trusted Knowledge Lab'), end=current.indexOf("\n  window.addEventListener('message', async function (event) {\n    const frame = knowledgeFrame();",start);
   const shared=current.slice(start,end),body=shared.slice(shared.indexOf('\n',shared.indexOf('window.emuKnowledgeReact'))+1,shared.lastIndexOf('\n  };'));
   current=current.slice(0,start)+current.slice(end+1);
   current=current.replace('      await window.emuKnowledgeReact(message);',body);
  }
  if(name==='schoolpark/dao.html') {
   current=current.replace("  openPlans = () => { try { window.parent.accountGo('plan'); } catch (e) {} };\n",'').replace('      openPlans:this.openPlans, openPassport:this.openPassport,','      openPassport:this.openPassport,');
   current=current.replace('class="service-header" data-sp-head','data-sp-head').replace('class="service-heading" style="display:flex; flex-direction:column; gap:5px; flex:1; min-width:0"','style="display:flex; flex-direction:column; gap:5px; flex:1; min-width:0"');
   const start=before.indexOf('        <div data-tour="fridge"'), end=before.indexOf('\n      </div>',start);
   assert.ok(start>0 && end>start);
   current=current.replace(/        <div class="service-tools" aria-label="アカウントとサポート">[\s\S]*?\n        <\/div>/, before.slice(start,end));
  }
  if(name==='knowledge.html')current=current.replace('<button type="button" data-command="experience">分類・出典を付けた経験知を書く →</button>','').replace("(['wallet','room1','knowledge-lab','experience'].includes(b.dataset.command))","(b.dataset.command==='wallet'||b.dataset.command==='room1')");
  // Reviewed 2026-10-23: the logo screen uses the visible mobile height (dvh)
  // so the logo stays centred while the address bar is shown.
  if(name==='index.html') {
   const dvh='  /* スマホは 100vh がアドレスバーを隠したときの高さになり、出ているあいだは画面より長い。\n     はみ出した分だけロゴが上下にずれるので、いま見えている高さ（dvh）にそろえる。 */\n  height: 100dvh;\n';
   assert.ok(current.includes(dvh));current=current.replace(dvh,'');
   // Reviewed 2026-10-24: Good/Change check the plan before writing and explain
   // a plan denial. tools/knowledge-lab-tests/reaction-rules.test.cjs covers the Rules.
   const allowedGood="      /* 「役に立った」を送るのは light 以上（9/1から。ルールの canWriteAs(1)）。\n         先に確かめないと、送ってから断られて「まだ保存できませんでした」になる。 */\n      if (!await emuReactionAllowed(postId, 'good')) return;\n";
   const allowedChange="      if (!await emuReactionAllowed(postId, 'change')) return;\n";
   const whyPlan="\n  // ルール: canWriteAs(1)。見学（無料）では送れない\n  if (typeof emuHasPlan === 'function' && !emuHasPlan('light')) {\n    return { message: label + 'を送るのは、Emu light（月額500円）以上です。' };\n  }\n";
   for(const s of [allowedGood,allowedChange,whyPlan]){assert.ok(current.includes(s),s);current=current.replace(s,'');}
   const a=current.indexOf('/* 反応（Good / Change）を送れる段か。'),b=current.indexOf('/* 反応（Good / Change）を保存する。',a);
   assert.ok(a>=0&&b>a);current=current.slice(0,a)+current.slice(b);
   // Reviewed 2026-10-24: the official-pass badge also uses the server-verified
   // Passport pass and the public paid_users list (LINE/Google logins showed "free").
   const passPost="  /* LINE・Google で入ると、上の印はログインのたびに false に戻る（ウォレットを\n     確かめる処理が走らないため）。Passport に連携したウォレットで公式パスを\n     持っていることは、サーバーが確かめて返している。それも見る。 */\n  if (window._spIdentity && window._spIdentity.hasOfficialPass) return \"paid\";\n";
   const passMark="      await markKnowledgePassHolders(rows, authorAddrs);\n";
   for(const s of [passPost,passMark]){assert.ok(current.includes(s),s);current=current.replace(s,'');}
   const pa=current.indexOf('  /* 書き手が公式パスの持ち主か。'),pb=current.indexOf('  function knowledgeAuthorAddrs(rows) {',pa);
   assert.ok(pa>=0&&pb>pa);current=current.slice(0,pa)+current.slice(pb);
  }
  // Reviewed 2026-10-23: the monthly theme chip looks like the others, and each
  // card can be shared (/p/<id>). tools/emu-tests/share-post.test.cjs covers both.
  if(name==='knowledge.html') {
   const cut=(a,b)=>{const i=current.indexOf(a),j=current.indexOf(b,i);assert.ok(i>=0&&j>i,a);current=current.slice(0,i)+current.slice(j);};
   const drop=(s)=>{assert.ok(current.includes(s),s);current=current.replace(s,'');};
   assert.ok(current.includes('padding:12px 16px}\n\n.field input[readonly]'));
   current=current.replace('padding:12px 16px}\n\n.field input[readonly]','padding:12px 16px}.choices button[data-monthly]{border-color:#e0c08a;background:#fdf6ea;color:#8a5726}\n.choices button[data-monthly].active{border-color:#c98b2e;background:#f8ead2;color:#7a4c17}\n.field input[readonly]');
   drop('<button class="share-btn" data-share data-id="${esc(p.id)}">${esc(emuT(\'k.action.share\'))}</button>');
   drop(";document.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>openShare(b.dataset.id))");
   drop(";if($('#shareSheet').classList.contains('open'))closeOverlay($('#shareSheet'))");
   cut('<div class="overlay" id="shareSheet"','<div class="toast" id="toast"');
   cut('/* シェア。行き先は投稿1件だけのページ','function openComposer(){');
   cut('.share-modal{','</style>');
  }
  assert.ok(current===before,file+' differs outside approved changes');
 }
});
