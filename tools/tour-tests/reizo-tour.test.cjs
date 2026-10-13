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
 const start=index.indexOf('id="emuRequestsPage"'),end=index.indexOf('id="emuIchinichiPage"');assert.ok(index.indexOf('data-tour="room1-entry"')>start&&index.indexOf('data-tour="room1-entry"')<end);
 assert.ok(index.includes("openSpRoom('/admin/room1/index.html', 'Room1')"));
});
test('core state/UI never dispatch network requests or app clicks',()=>{
 assert.ok(!/\b(?:fetch|XMLHttpRequest|sendBeacon|postMessage)\s*\(/.test(source));assert.ok(!/\.click\s*\(/.test(source));
 const adapters=fs.readFileSync(path.join(root,'frontend/public/tour/reizo-tour-pages.js'),'utf8');assert.ok(!/\b(?:fetch|XMLHttpRequest|sendBeacon|postMessage)\s*\(/.test(adapters));
});
