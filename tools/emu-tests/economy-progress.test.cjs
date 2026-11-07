'use strict';
// Browser UI tests only: real app/auth-header code, isolated HTTP responses. No Firebase/payment/provider access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const evidence=process.env.ECONOMY_UX_EVIDENCE;
if(evidence)fs.mkdirSync(evidence,{recursive:true});
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../../frontend/public');
const auth=require('../year-goals-tests/extract.cjs').grab(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),'emuAuthHeaders');
let server,base,browser;
before(async()=>{
 server=http.createServer((req,res)=>{
  if(req.url==='/shell'){res.setHeader('Content-Type','text/html');return res.end(`<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><iframe style="border:0;width:100%;height:100vh" src="/economy/index.html"></iframe><script>window.auth={currentUser:null};${auth};window.testSignIn=(uid)=>{auth.currentUser={uid,getIdToken:async()=>"local-"+uid};};testSignIn('alice');</script>`);}
  const file=path.join(ROOT,new URL(req.url,'http://local').pathname);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(r=>server?.close(r));});
async function page(width=390){
 const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage();await p.clock.install();
 const state={paid:false,jobState:'queued',polls:0,payments:0,operations:0,hold:null};
 const result={kind:'guild',id:'learn',title:'LEARN Guild',reason:'公開説明を根拠に選びました。',evidence:'知識を、やってみるに変える。',target:'/schoolpark/dao.html?screen=experiments&explorerGuild=learn'};
 const job=(full=false)=>({id:'local-job',state:state.jobState,price:5,createdAtMs:1794034126000,hasResult:state.jobState==='completed',payment:{status:state.jobState==='refunded'?'refunded':state.jobState==='completed'?'fulfilled':'paid',refunded:state.jobState==='refunded'},result:full&&state.jobState==='completed'?{results:[result]}:null});
 await c.route('**/*',async r=>{
  const req=r.request();if(!req.url().startsWith(base+'/'))return r.abort();
  const route=new URL(req.url()).pathname.replace('/api/economy','');if(!new URL(req.url()).pathname.startsWith('/api/'))return r.continue();
  const alice=req.headers().authorization==='Bearer local-alice';let data;
  if(route==='/me')data={service:{enabled:true},eligibility:{eligible:true},isOwner:true,balances:{spendable:alice&&state.paid&&state.jobState!=='refunded'?'95':'100',wallet:null,pending:'100',held:'0',processing:'0'}};
  else if(route==='/jobs'&&req.method()==='GET')data={jobs:alice&&state.paid?[job()]:[]};
  else if(route==='/quotes')data={quote:{id:'quote',price:5,termsVersion:'local',scope:'公式ギルドを探します。',refund:'失敗時は全額返却',notice:'候補0件も料金対象'}};
  else if(route==='/jobs'&&req.method()==='POST'){state.paid=true;state.payments++;data={job:job()};}
  else if(route==='/jobs/local-job'){state.polls++;if(state.hold)await state.hold;data={job:job(true)};}
  else if(route==='/admin/operations'){state.operations++;data={operations:{worker:{healthy:true},usage:{},pending:[]},service:{blockers:[]}};}
  else throw Error('unexpected UI request '+route);
  return r.fulfill({json:{ok:true,...data}});
 });
 await p.goto(base+'/shell');const f=p.frameLocator('iframe');await f.locator('#spendable').filter({hasText:'100 EMUER'}).waitFor();
 return {c,p,f,state,async submit(){await f.locator('#goal').fill('学んだ知識を実際に試すギルドを探したい');await f.locator('#quoteButton').click();await f.locator('#paymentConsent').check();await f.locator('#aiConsent').check();await f.locator('#pay').click();await f.locator('#history article').filter({hasText:'支払い済み・実行待ち'}).waitFor();await f.locator('#pay').waitFor({state:'hidden'});},async tick(ms=5100){await p.clock.runFor(ms);}};
}
test('completion and result appear automatically without resubmission, losing a new draft/consent, or extra polling',async()=>{
 const t=await page();try{
 await t.submit();assert.equal(t.state.payments,1);assert.equal(t.state.operations,0);assert.ok((await t.f.locator('#history').innerText()).includes('15:48:46（日本時間）'));
 await t.f.locator('#goal').fill('次の依頼の下書き');await t.f.locator('#quoteButton').click();await t.f.locator('#paymentConsent').check();await t.f.locator('#goal').focus();
 t.state.jobState='completed';await t.tick();await t.f.locator('#history h3').filter({hasText:'LEARN Guild'}).waitFor();
 assert.equal(await t.f.locator('#goal').inputValue(),'次の依頼の下書き');assert.equal(await t.f.locator('#paymentConsent').isChecked(),true);
 assert.equal(await t.f.locator('#goal').evaluate(e=>document.activeElement===e),true);assert.equal(t.state.payments,1);
 await t.f.locator('#spendable').filter({hasText:'95 EMUER'}).waitFor();const polls=t.state.polls;await t.tick(16000);assert.equal(t.state.polls,polls);
 if(evidence){await t.f.locator('#historySection').scrollIntoViewIfNeeded();await t.p.screenshot({path:path.join(evidence,'auto-result-390.png'),fullPage:true});}
 await t.f.locator('#operationsPanel > summary').click();await t.p.clock.runFor(50);await t.f.locator('#operationsStatus').filter({hasText:'稼働確認済み'}).waitFor();assert.equal(t.state.operations,1);
 }finally{await t.c.close();}
});
test('an in-flight old-account poll cannot display another account result or continue polling it',async()=>{
 const t=await page();let release;try{
 await t.submit();t.state.hold=new Promise(r=>{release=r;});await t.tick();
 await t.p.evaluate(()=>testSignIn('bob'));await t.tick(1100);await t.f.locator('#history').filter({hasText:'まだ依頼はありません'}).waitFor();
 t.state.jobState='completed';release();await t.p.waitForTimeout(50);
 assert.equal(await t.f.locator('#history').innerText(),'まだ依頼はありません。');assert.equal(await t.f.locator('#goal').inputValue(),'');
 const polls=t.state.polls;await t.tick(11000);assert.equal(t.state.polls,polls);assert.equal(t.state.payments,1);
 }finally{release?.();await t.c.close();}
});
test('pending refund is shown until confirmation, then auto-updated without another payment',async()=>{
 const t=await page();try{
 await t.submit();t.state.jobState='refund_pending';await t.tick();await t.f.locator('#history').filter({hasText:'返却はまだ確定していません'}).waitFor();
 t.state.jobState='refunded';await t.tick();await t.f.locator('#history').filter({hasText:'支払いを全額返却しました'}).waitFor();
 await t.f.locator('#spendable').filter({hasText:'100 EMUER'}).waitFor();assert.equal(t.state.payments,1);
 }finally{await t.c.close();}
});
test('layouts show spendable balance, fold operations/other balances, and place result before diagnostics at seven widths',async()=>{
 for(const width of [375,390,412,768,1280,1440,1920]){const t=await page(width);try{
 assert.equal(await t.f.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.equal(await t.f.locator('#operationsPanel').evaluate(e=>e.open),false);assert.equal(await t.f.locator('#wallet').isVisible(),false);assert.equal(await t.f.locator('#spendable').isVisible(),true);
 assert.equal(await t.f.locator('#historySection').evaluate(e=>Boolean(e.compareDocumentPosition(document.querySelector('#operations'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.equal(t.state.operations,0);
 if(evidence&&[390,1280].includes(width))await t.p.screenshot({path:path.join(evidence,'request-'+width+'.png'),fullPage:true});
 }finally{await t.c.close();}}
});
