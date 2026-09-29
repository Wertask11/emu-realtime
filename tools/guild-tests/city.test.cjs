/* Real dao.html + City modules + City Express router in an isolated browser.
 * Auth/provider calls and Firestore are fixtures, never production accounts.
 * Run: node --test tools/guild-tests/city.test.cjs
 * Optional: CITY_CHROMIUM_PATH=/path/to/chromium CITY_QA_DIR=/tmp/city-qa */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
const express = require('../../backend/node_modules/express');
const { makeFirestore } = require('../../backend/fake-firestore');
const { createIdentity } = require('../../backend/identity');
const { createCityRouter, SPOTS } = require('../../backend/city');

const PUB = path.join(__dirname, '../../frontend/public');
const SPID = 'SP-AAAA-AAAA-AAAA-AAAA';
const OTHER = 'SP-BBBB-BBBB-BBBB-BBBB';
const PARENT = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>City isolated integration fixture — not production</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}#external{position:fixed;inset:0;background:#F4F1EA;padding:30px}</style>
<script>
window.auth = {currentUser:{uid:'alice'}};
window._spIdentity = {schoolParkId:'${SPID}'};
window.__listeners = []; window.__quests = []; window.__calls = [];
window.fbAuth = {onAuthStateChanged(auth,fn){__listeners.push(fn);queueMicrotask(()=>fn(auth.currentUser));return ()=>{};}};
window.__login = uid => {auth.currentUser=uid?{uid}:null;__listeners.forEach(fn=>fn(auth.currentUser));};
window.emuAuthHeaders = async json => ({Authorization:'Bearer city-fixture-'+(auth.currentUser?.uid||''),...(json?{'Content-Type':'application/json'}:{})});
window.spEnsureSchoolParkAccess = async () => ({allowed:!!auth.currentUser});
window.spPassportLoad = async () => ({uid:auth.currentUser?.uid,addr:auth.currentUser?.uid,spid:auth.currentUser?.uid==='bob'?'${OTHER}':'${SPID}'});
window.spCompletedQuests = async () => __quests;
window.spGuildDefs = async () => [{id:'learn',name:'LEARN'}];
window._spReadAll = async path => path.endsWith('/joins') ? [{id:'alice'}] : [];
window.spDaoLoadQuests = async () => {};
window.spDaoReloadAll = app => {window.__app=app;app.setState({me:{name:'テスト用Passport',initial:'テ',line:'WISDOM 0 · クエスト 0'},guilds:[{id:'learn',name:'LEARN',meLabel:'参加したい'}]});};
window.spGuildOpen = async (id,app) => {__calls.push('guild:'+id);app.setState({screen:'guild',curGuild:{id,name:id.toUpperCase(),concept:'既存Guildへの接続テスト',noVotes:true,noQuests:true}});};
window.chesHubGo = async brand => {__calls.push(brand);document.getElementById('external').hidden=brand==='schoolpark';document.getElementById('externalLabel').textContent=brand;};
window.openSpPassport = async () => {__calls.push('passport');document.getElementById('external').hidden=false;document.getElementById('externalLabel').textContent='Passport / 星空（既存画面の呼出し確認）';};
</script>
<iframe id="dao" title="SchoolPark" src="/schoolpark/dao.html"></iframe>
<div id="external" hidden><h1 id="externalLabel"></h1><button onclick="chesHubGo('schoolpark')">SchoolParkへ戻る</button></div></html>`;

let browser, server, base, db;
const qa = process.env.CITY_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'city-qa-'));
before(async () => {
  db = makeFirestore({
    ches_accounts:{alice:{spid:SPID,walletAddress:'alice'},bob:{spid:OTHER,walletAddress:'bob'}},
    sp_auth_links:{'fb:alice':{spid:SPID},'fb:bob':{spid:OTHER}},
    sp_identities:{[SPID]:{spid:SPID,status:'active'},[OTHER]:{spid:OTHER,status:'active'}}
  });
  const collection = db.collection;
  db.collection = name => {
    const col = collection(name);
    col.orderBy = () => ({limit:n => ({get:async()=>({docs:(await col.get()).docs.sort((a,b)=>b.data().occurredAt-a.data().occurredAt).slice(0,n)})})});
    return col;
  };
  const app = express(); app.use(express.json());
  app.use('/api/schoolpark/city',createCityRouter({db,identity:createIdentity({db}),
    now:()=>Date.parse('2026-09-28T12:00:00Z'), entitlement:{holdsOfficialPass:async()=>true},
    rateLimit:()=> (_req,_res,next)=>next(),
    requireFirebaseUser(req,res,next){
      const uid=String(req.headers.authorization||'').replace('Bearer city-fixture-','');
      if(!['alice','bob'].includes(uid)) return res.status(401).json({error:'AUTH_REQUIRED'});
      req.identity={uid};next();
    }
  }));
  app.get('/test/parent.html',(_req,res)=>res.type('html').send(PARENT));
  app.get('/favicon.ico',(_req,res)=>res.sendStatus(204));
  if(process.env.CITY_FONT_ROOT) app.use('/test/fonts',express.static(process.env.CITY_FONT_ROOT));
  app.use(express.static(PUB));
  server=http.createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({...(process.env.CITY_CHROMIUM_PATH?{executablePath:process.env.CITY_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  fs.mkdirSync(qa,{recursive:true});
});
after(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());});

async function fixture(width=390, visits=[]) {
  for(const spid of [SPID,OTHER]) {
    const col=db.collection('sp_identities/'+spid+'/city_checkins');
    for(const row of (await col.get()).docs) await col.doc(row.id).delete();
  }
  for(const id of visits) {
    const spot=SPOTS.find(s=>s.spotId===id);
    const result=await fetch(base+'/api/schoolpark/city/checkins',{method:'POST',headers:{Authorization:'Bearer city-fixture-alice','Content-Type':'application/json'},body:JSON.stringify({spotId:id,checkInType:spot.checkInType})});
    assert.equal(result.status,200);
  }
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<700});
  const requests=[],errors=[],control={historyFailure:false,historyGate:null};
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='fonts.googleapis.com' && process.env.CITY_FONT_ROOT) {
      const css=['zen-kaku-gothic-new/400.css','zen-kaku-gothic-new/700.css','zen-old-mincho/700.css','zen-old-mincho/900.css','inter/400.css','inter/600.css','inter/700.css']
        .map(file=>fs.readFileSync(path.join(process.env.CITY_FONT_ROOT,file),'utf8').replaceAll('./files/',base+'/test/fonts/'+file.split('/')[0]+'/files/')).join('\n');
      return route.fulfill({body:css,contentType:'text/css'});
    }
    if(url.hostname==='emu-realtime.onrender.com') {
      requests.push({path:url.pathname,method:req.method(),body:req.postData()});
      if(url.pathname.endsWith('/stars/mine')) return route.fulfill({json:{ok:true,stars:[]}});
      if(control.historyFailure && url.pathname.endsWith('/me')) return route.fulfill({status:503,json:{error:'CITY_HISTORY_UNAVAILABLE'}});
      const response=await fetch(base+url.pathname,{method:req.method(),headers:req.headers(),body:req.postData()||undefined});
      const body=await response.text();
      if(url.pathname.endsWith('/me') && control.historyGate) await control.historyGate;
      return route.fulfill({status:response.status,body,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(url.origin!==base) return route.abort();
    return route.continue();
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  const modules=[];page.on('request',r=>{if(/\/city(?:-bridge)?\.(js|css)$/.test(r.url()))modules.push(r.url());});
  await page.goto(base+'/test/parent.html');
  const frame=page.frames().find(f=>f.url().endsWith('/schoolpark/dao.html'));
  await frame.waitForFunction(()=>window.app?.state.me.name==='テスト用Passport');
  async function nav(n) {
    const names={'01':/広場/,'02':/ギルド/,'03':/クエスト/,'04':/知恵/,'05':/公園/,'06':/メンバー/,'07':/会計|トレジャリー/,'08':/CITY/};
    const item=frame.getByText(n,{exact:true}).locator('..').filter({hasText:names[n]}).filter({visible:true});
    if(width>=700 && !(await item.count())) {
      await frame.getByTitle('サイドバーを開く',{exact:true}).click();
    }
    await item.click();
  }
  async function city(){await nav('08');await frame.locator('.city-grid .city-card').first().waitFor();}
  return {context,page,frame,nav,city,requests,modules,errors,control,close:()=>context.close()};
}
async function noOverflow(f) {
  const widths=await f.frame.evaluate(()=>({window:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,city:document.querySelector('#sp-city')?.getBoundingClientRect().toJSON(),x:scrollX}));
  assert.ok(widths.body<=widths.window+1 && widths.root<=widths.window+1,JSON.stringify(widths));
  if(widths.city) assert.ok(widths.city.right<=widths.window+1,JSON.stringify(widths));
  assert.equal(widths.x,0);
}

for(const width of [375,390,412,768,1440]) test(`City UI ${width}px: 01–08, REAL/VIRTUAL, check-in, Quest/Guild return, MyCity, share`,async()=>{
  const f=await fixture(width);
  try {
    assert.equal(f.modules.length,0,'no City module at SchoolPark startup');
    assert.equal(f.requests.length,0,'no City API at SchoolPark startup');
    const screens=['home','logs','experiments','library','park','members','treasury'];
    for(let i=0;i<7;i++) {await f.nav('0'+(i+1));assert.equal(await f.frame.evaluate(()=>app.state.screen),screens[i]);await noOverflow(f);}
    await f.city();
    assert.equal(await f.frame.locator('.city-card').count(),3);
    assert.equal(f.requests.filter(r=>r.path.endsWith('/spots')).length,1);
    assert.equal(f.requests.filter(r=>r.path.endsWith('/me')).length,0,'private history waits for MY CITY');
    await noOverflow(f);
    await f.page.screenshot({path:path.join(qa,`city-home-${width}.png`)});
    // Parent data updates redraw the entire DAO. City's DOM and state survive.
    await f.frame.evaluate(()=>{window.__savedCity=document.querySelector('#sp-city');app.setState({today:'test'});});
    assert.equal(await f.frame.evaluate(()=>window.__savedCity===document.querySelector('#sp-city')),true);
    assert.equal(f.requests.filter(r=>r.path.endsWith('/spots')).length,1);
    await f.frame.locator('.city-nav [data-value="real"]').click();
    assert.equal(await f.frame.locator('.city-card').count(),2);
    await f.frame.locator('[data-action="spot"][data-value="demo-book"]').click();
    await noOverflow(f);
    await f.frame.locator('[data-action="checkin"]').click();
    await f.frame.getByText(/記録済み ·/).waitFor();
    assert.match(await f.frame.locator('#sp-city').innerText(),/現地訪問を証明するものではありません/);
    await f.frame.locator('[data-action="checkin"]').click();
    await f.frame.getByText('今日のチェックインは記録済みです。二重には増えません。').waitFor();
    await f.frame.locator('.city-detail [data-action="quest"]').click();
    await f.frame.getByRole('button',{name:'← Cityへ戻る',exact:true}).waitFor();
    assert.equal(await f.frame.evaluate(()=>app.state.screen),'experiments');
    await f.frame.getByRole('button',{name:'← Cityへ戻る',exact:true}).click();
    await f.frame.locator('[data-action="guild"][data-value="learn"]').click();
    await f.frame.getByRole('button',{name:'← Cityへ戻る',exact:true}).waitFor();
    assert.equal(await f.frame.evaluate(()=>app.state.screen),'guild');
    await f.frame.getByRole('button',{name:'← Cityへ戻る',exact:true}).click();
    await f.frame.locator('[data-action="emu"]').click();
    await f.page.getByRole('heading',{name:'emu',exact:true}).waitFor();
    await f.page.getByRole('button',{name:'SchoolParkへ戻る',exact:true}).click();
    await f.frame.locator('.city-nav [data-value="virtual"]').click();
    assert.equal(await f.frame.locator('.city-card').count(),1);
    await f.frame.locator('[data-action="spot"]').click();
    await f.frame.getByRole('button',{name:'このVirtual Spotに入る',exact:true}).click();
    await f.frame.getByText(/記録済み ·/).waitFor();
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText(SPID,{exact:true}).waitFor();
    await f.frame.getByText('限定Starの記録はありません',{exact:true}).waitFor();
    assert.equal(await f.frame.locator('.city-room .city-card').count(),2);
    await noOverflow(f);
    await f.page.screenshot({path:path.join(qa,`city-my-${width}.png`)});
    await f.frame.locator('[data-action="preview-share"]').click();
    const share=await f.frame.locator('.city-share pre').innerText();
    assert.match(share,/DEMO/);assert.doesNotMatch(share,/SP-AAAA|alice|uid|wallet|kyc/i);
    await f.frame.locator('[data-action="cancel-share"]').click();
    assert.equal(await f.frame.locator('.city-share').count(),0);
    await f.frame.locator('[data-action="passport"]').first().click();
    await f.page.getByRole('heading',{name:/Passport \/ 星空/}).waitFor();
    await f.page.getByRole('button',{name:'SchoolParkへ戻る',exact:true}).click();
    await f.frame.locator('[data-action="home"]').click();
    assert.equal(await f.frame.evaluate(()=>app.state.screen),'home');
    assert.deepEqual(f.errors,[]);
    for(const req of f.requests.filter(r=>r.method==='POST')) assert.deepEqual(Object.keys(JSON.parse(req.body)).sort(),['checkInType','spotId']);
  } finally {await f.close();}
});

test('City UI: logout clears private UI; new account has no inherited records; login reloads saved records',async()=>{
  const f=await fixture(390,['demo-book','schoolpark-lab']);
  try {
    await f.city();await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText(SPID,{exact:true}).waitFor();
    await f.page.evaluate(()=>__login(null));
    assert.doesNotMatch(await f.frame.locator('#sp-city').innerText(),/SP-AAAA/);
    await f.frame.locator('[data-action="retry"]').click();
    await f.frame.getByText('ログインしてからCityを開いてください。',{exact:true}).waitFor();
    await f.page.evaluate(()=>__login('bob'));
    await f.frame.locator('[data-action="retry"]').click();
    await f.frame.locator('.city-grid .city-card').first().waitFor();
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText(OTHER,{exact:true}).waitFor();
    await f.frame.getByText('まだCityの記録はありません',{exact:true}).waitFor();
    await f.frame.getByText('限定Starの記録はありません',{exact:true}).waitFor();
    assert.equal(await f.frame.getByRole('button',{name:'LEARN · 参加したい',exact:true}).count(),0,'previous account Guild label must not carry over');
    await f.page.evaluate(()=>__login('alice'));
    await f.frame.locator('[data-action="retry"]').click();
    await f.frame.locator('.city-grid .city-card').first().waitFor();
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText(SPID,{exact:true}).waitFor();
    assert.equal(await f.frame.locator('.city-room .city-card').count(),2);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('City UI: read failure is not an empty collection; old-account late response is discarded',async()=>{
  const f=await fixture();let release;
  try {
    await f.city(); f.control.historyFailure=true;
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.locator('[role="alert"]').waitFor();
    assert.equal(await f.frame.getByText('まだCityの記録はありません',{exact:true}).count(),0);
    f.control.historyFailure=false;
    f.control.historyGate=new Promise(r=>{release=r;});
    await f.frame.locator('[data-action="refresh"]').click();
    await f.frame.getByText('自分のCity記録を読み込んでいます…',{exact:true}).waitFor();
    await f.page.evaluate(()=>__login('bob')); release(); f.control.historyGate=null;
    await f.frame.locator('[data-action="retry"]').click();
    await f.frame.locator('.city-grid .city-card').first().waitFor();
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText(OTHER,{exact:true}).waitFor();
    assert.doesNotMatch(await f.frame.locator('#sp-city').innerText(),/SP-AAAA/);
    assert.deepEqual(f.errors,[]);
  } finally {release?.();await f.close();}
});

test('City UI: in-flight history cannot erase a later check-in; founder-only records show empty Quest state',async()=>{
  const f=await fixture(390,['demo-book','schoolpark-lab']);let release;
  try {
    await f.page.evaluate(()=>{__quests=[{id:'founder',isFounder:true}];});
    await f.city(); f.control.historyGate=new Promise(r=>{release=r;});
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText('自分のCity記録を読み込んでいます…',{exact:true}).waitFor();
    await f.frame.locator('.city-nav [data-value="real"]').click();
    await f.frame.locator('[data-action="spot"][data-value="demo-cafe"]').click();
    await f.frame.locator('[data-action="checkin"]').click();
    await f.frame.getByText(/記録済み ·/).waitFor();
    release();f.control.historyGate=null;
    await f.frame.locator('.city-nav [data-value="my"]').click();
    await f.frame.getByText('まだ承認済みのQuestはありません',{exact:true}).waitFor();
    assert.equal(await f.frame.locator('.city-room .city-card').count(),3);
    assert.deepEqual(f.errors,[]);
  } finally {release?.();await f.close();}
});
