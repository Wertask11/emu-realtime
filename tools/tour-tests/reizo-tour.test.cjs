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
  // Explicitly requested shared header: normalize only the reviewed markup and
  // display condition; the byte-for-byte guard still covers all other behavior.
  current=current.replace('<link rel="stylesheet" href="/service-header.css">\n','');
  if(name==='index.html') {
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
   current=current.replace('class="service-header" data-sp-head','data-sp-head').replace('class="service-heading" style="display:flex; flex-direction:column; gap:5px; flex:1; min-width:0"','style="display:flex; flex-direction:column; gap:5px; flex:1; min-width:0"');
   const start=before.indexOf('        <div data-tour="fridge"'), end=before.indexOf('\n      </div>',start);
   assert.ok(start>0 && end>start);
   current=current.replace(/        <div class="service-tools" aria-label="アカウントとサポート">[\s\S]*?\n        <\/div>/, before.slice(start,end));
  }
  if(name==='knowledge.html')current=current.replace('<button type="button" data-command="experience">分類・出典を付けた経験知を書く →</button>','').replace("(['wallet','room1','knowledge-lab','experience'].includes(b.dataset.command))","(b.dataset.command==='wallet'||b.dataset.command==='room1')");
  assert.ok(current===before,file+' differs outside approved changes');
 }
});
