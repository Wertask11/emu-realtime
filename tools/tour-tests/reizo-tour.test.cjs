const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {grab}=require('../year-goals-tests/extract.cjs');
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
test('Knowledge Text (formerly Room1) has one search entrance, as a card beside Knowledge Lab, and no read-screen DOM entrance',()=>{
 const index=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8'),knowledge=fs.readFileSync(path.join(root,'frontend/public/knowledge.html'),'utf8');
 assert.ok(!knowledge.includes('data-command="room1"'));
 assert.equal((index.match(/emu-text-entry/g)||[]).length,1);
 assert.equal((index.match(/data-tour="room1-entry emu-room1"/g)||[]).length,1);
 const start=index.indexOf('id="emuRequestsPage"'),end=index.indexOf('id="emuPracticePage"');assert.ok(index.indexOf('data-tour="room1-entry emu-room1"')>start&&index.indexOf('data-tour="room1-entry emu-room1"')<end);
 // Knowledge Lab と同じ並び（emu-knowledge-pair）の中に、同じ eth-card として置く
 const pair=index.slice(index.indexOf('<div class="emu-knowledge-pair">'),index.indexOf('<div class="eth-section-head">',index.indexOf('<div class="emu-knowledge-pair">')));
 assert.ok(pair.includes('data-tour="emu-lab-entry"')&&pair.includes('<div class="eth-card" data-tour="room1-entry emu-room1"><h3>Emu Knowledge Text</h3>'));
 assert.ok(index.includes("openSpRoom('/admin/room1/index.html', 'Knowledge Text')"));
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
test('unified navigation preserves existing auth, contracts, Quest business logic and game/storage implementations',()=>{
 const cp=require('node:child_process'),baseline='6b0d03c1eb5bf1f7ddf9b6ee6b003fc24eeb723f';
 const readBefore=file=>cp.execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 // 11/3: the only allowed addition is the screen-error reporter line (client-errors.js; it sends no personal data).
 const withoutErrorReporter=src=>src.replace(/[ \t]*<script src="\/client-errors\.js"><\/script><!--[^\n]*-->\n/,'');
 // 11/7: knowledge.html のマイライブラリー（下書きを30件ずつ・Knowledge Lab の下書きも並べる）を変えた。
 // 認めた変更（approved-2026-11-07.json）をそれぞれちょうど1か所だけ元に戻してから比べる。ほかの変更は今までどおり落ちる。
 const undoApproved=(file,src)=>{for(const [now,was] of (require('./approved-2026-11-07.json')[file.replace('frontend/public/','')]||[])){assert.equal(src.split(now).length,2,file+': 認めた変更が見つからない');src=src.replace(now,was);}return src;};
 const before=readBefore('frontend/public/index.html'),current=fs.readFileSync(path.join(root,'frontend/public/index.html'),'utf8');
 // These functions enforce identity, authorisation, saves, completion and rewards.
 // Presentation adapters may change; these underlying implementations must not.
 // spPassportLoad changed on purpose on 11/3 (#267): the cached Passport is tied to the signed-in UID so a
 // previous user's Passport is never shown (tools/unified-navigation-tests/navigation.test.cjs covers it).
 assert.ok(grab(current,'spPassportLoad').includes('window.auth?.currentUser?.uid'),'spPassportLoad must stay tied to the signed-in UID');
 // backend/dialogue.js changed on purpose on 11/3 (#267, booked dialogue security); backend/dialogue*.test.js cover it.
 for(const fn of ['spEnsureSchoolParkAccess','emuAuthHeaders','accountGo','spQuestToggle','spQuestLog','spQuestWisdom','spWisdomSubmit','spWisdomCite','spOpenPlay']) assert.equal(grab(current,fn),grab(before,fn),fn);
 for(const file of ['firestore.rules','backend/identity.js','backend/entitlement.js','backend/membership-policy.js','backend/quest-completion.js','frontend/public/knowledge.html','frontend/public/Emu_room2/echo-field.html','frontend/public/ringo-game.html','frontend/public/daily-gods/index.html','frontend/public/daily-gods/game.js','frontend/public/schoolpark/south-elevator.html']) assert.equal(withoutErrorReporter(undoApproved(file,fs.readFileSync(path.join(root,file),'utf8'))),readBefore(file),file);
 const retired=fs.readFileSync(path.join(root,'frontend/public/schoolpark/dao.html'),'utf8');
 for(const view of ['isHome','isPark','isPlaza','isMembers','isTreasury']) assert.ok(!retired.includes('value="{{ '+view+' }}"'),view);
 for(const view of ['ichinichi','discussion']) assert.match(fs.readFileSync(path.join(root,'frontend/public/'+view+'.html'),'utf8'),/view=practice/);
});
test('removed service brand is absent from current public UI, including privacy and City',()=>{
 const publicRoot=path.join(root,'frontend/public');
 const files=fs.readdirSync(publicRoot,{recursive:true}).filter(n=>/\.(?:html|js|json)$/.test(n));
 for(const file of files){const text=fs.readFileSync(path.join(publicRoot,file),'utf8');assert.ok(!/SchoolPark Explorer|Explorer専用|Explorer · Coming Soon|本日のExplorer受付/.test(text),file);}
});
