const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {startFixture}=require('./city-3d-fixture.cjs');
let browser,fixture;
const qa=process.env.CITY_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'city-3d-'));
before(async()=>{
 fixture=await startFixture();fs.mkdirSync(qa,{recursive:true});
 browser=await chromium.launch({...(process.env.CITY_CHROMIUM_PATH?{executablePath:process.env.CITY_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
});
after(async()=>{await browser?.close();await fixture?.close();});
async function open(width){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700});
 const errors=[],requests=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push(url.pathname);
  if(url.hostname==='emu-realtime.onrender.com'){
   const r=await fetch(fixture.base+url.pathname,{method:req.method(),headers:req.headers(),body:req.postData()||undefined});
   return route.fulfill({status:r.status,body:await r.text(),contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.hostname==='fonts.googleapis.com'&&process.env.CITY_FONT_ROOT){
   const css=['zen-kaku-gothic-new/400.css','zen-kaku-gothic-new/700.css','zen-old-mincho/700.css','zen-old-mincho/900.css','inter/400.css','inter/600.css','inter/700.css'].map(file=>fs.readFileSync(path.join(process.env.CITY_FONT_ROOT,file),'utf8').replaceAll('./files/',fixture.base+'/test/fonts/'+file.split('/')[0]+'/files/')).join('\n');
   return route.fulfill({body:css,contentType:'text/css'});
  }
  if(url.origin!==fixture.base)return route.abort();return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))errors.push(m.text());});
 await page.goto(fixture.base+'/test/parent');
 const frame=page.frames().find(f=>f.url().endsWith('/schoolpark/dao.html'));
 await frame.waitForFunction(()=>window.app?.state.me.name==='テスト用Passport');
 assert.equal(requests.some(p=>p.includes('city-three')||p.includes('city-world')),false);
 if(width>=700&&!(await frame.getByText('08',{exact:true}).filter({visible:true}).count()))await frame.getByTitle('サイドバーを開く',{exact:true}).click();
 await frame.getByText('08',{exact:true}).filter({visible:true}).click();
 await frame.getByRole('button',{name:'3Dの街へ入る ↗',exact:true}).click();
 await frame.locator('.cs-canvas[data-ready="true"]').waitFor({timeout:30000});
 return {page,frame,context,touch:width<700,errors,requests,canvas:frame.locator('.cs-canvas'),close:()=>context.close()};
}
const pose=async canvas=>JSON.parse(await canvas.getAttribute('data-position')||'{}');
const tap=async(f,x,y)=>f.touch?f.page.touchscreen.tap(x,y):f.page.mouse.click(x,y);
async function stablePose(f){
 await f.page.waitForTimeout(250);let previous=await pose(f.canvas);
 for(let attempt=0;attempt<8;attempt++){await f.page.waitForTimeout(180);const current=await pose(f.canvas);if(Math.hypot(current.x-previous.x,current.z-previous.z)<.004&&Math.abs(current.yaw-previous.yaw)<.004)return current;previous=current;}
 return previous;
}
for(const width of [375,390,412,768,1440])test(`3D City ${width}px: click/tap move, swipe look, collision, product, Passport, exit`,async()=>{
 const f=await open(width);
 try{
  const gl=await f.canvas.evaluate(c=>({width:c.width,height:c.height,gl:!!c.getContext('webgl2'),calls:Number(c.dataset.drawCalls||0)}));assert.ok(gl.gl&&gl.width>0&&gl.height>0);
  await f.page.screenshot({path:path.join(qa,`city-3d-street-${width}.png`)});
  await f.frame.getByRole('button',{name:'入店する ↗',exact:true}).click();
  await f.frame.waitForFunction(()=>{const p=JSON.parse(document.querySelector('.cs-canvas').dataset.position||'{}');return p.z===2.6;});
  await f.page.screenshot({path:path.join(qa,`city-3d-entrance-${width}.png`)});
  const box=await f.canvas.boundingBox(),beforeTap=await pose(f.canvas);
  await tap(f,box.x+box.width*.5,box.y+box.height*.75);
  await f.frame.waitForFunction(old=>{const p=JSON.parse(document.querySelector('.cs-canvas').dataset.position||'{}');return Math.hypot(p.x-old.x,p.z-old.z)>.12;},beforeTap);
  await f.frame.waitForFunction(()=>document.querySelector('.cs-canvas').dataset.navigation!=='moving');
  const afterTap=await pose(f.canvas);assert.ok(Math.hypot(afterTap.x-beforeTap.x,afterTap.z-beforeTap.z)>.12,'tap walks toward visible floor');
  if(width>=700){
   await f.frame.getByRole('button',{name:'入店する ↗',exact:true}).click();const beforeDouble=await stablePose(f);
   await f.page.mouse.dblclick(box.x+box.width*.42,box.y+box.height*.7,{delay:70});
   await f.frame.waitForFunction(old=>{const p=JSON.parse(document.querySelector('.cs-canvas').dataset.position||'{}');return Math.hypot(p.x-old.x,p.z-old.z)>.12;},beforeDouble);
   await f.frame.waitForFunction(()=>document.querySelector('.cs-canvas').dataset.navigation!=='moving');
  }
  const beforeLook=await stablePose(f);
  if(width<700){
   await f.canvas.evaluate((c,{x,y})=>{
    const send=(type,clientX)=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'touch',button:0,clientX,clientY:y}));
    send('pointerdown',x);for(let step=1;step<=7;step++)send('pointermove',x+step*10);send('pointerup',x+70);
   },{x:box.x+box.width*.5,y:box.y+box.height*.45});
  }else{await f.page.mouse.move(box.x+box.width*.5,box.y+box.height*.45);await f.page.mouse.down();await f.page.mouse.move(box.x+box.width*.65,box.y+box.height*.45,{steps:8});await f.page.mouse.up();}
  await f.frame.waitForFunction(old=>Math.abs(JSON.parse(document.querySelector('.cs-canvas').dataset.position||'{}').yaw-old.yaw)>.08,beforeLook);
  await f.page.waitForTimeout(250);const afterLook=await pose(f.canvas);assert.ok(Math.hypot(afterLook.x-beforeLook.x,afterLook.z-beforeLook.z)<.04,'drag/swipe looks without walking');
  assert.notEqual(await f.canvas.getAttribute('data-navigation'),'moving');
  const gestureState=await f.frame.evaluate(()=>({touchAction:getComputedStyle(document.querySelector('.cs-canvas')).touchAction,scrollY}));
  assert.equal(gestureState.touchAction,'none');assert.equal(gestureState.scrollY,0,'3D swipe does not scroll the page');
  await f.frame.getByRole('button',{name:'入店する ↗',exact:true}).click();const beforeWall=await stablePose(f);
  await tap(f,box.x+box.width*.5,box.y+box.height*.23);await f.page.waitForTimeout(300);
  const afterWall=await pose(f.canvas);assert.ok(Math.hypot(afterWall.x-beforeWall.x,afterWall.z-beforeWall.z)<.04,'wall/object is not a destination');
  await f.frame.getByRole('button',{name:'商品を見る',exact:true}).click();await f.frame.locator('[data-shop="product"]').first().click();
  assert.equal(await f.frame.getByRole('button',{name:'販売準備中',exact:true}).isDisabled(),true);
  assert.ok((await f.frame.locator('.cs-panel').innerText()).includes('実際の注文・支払いは発生しません'));
  await f.page.screenshot({path:path.join(qa,`city-3d-product-${width}.png`)});
  await f.frame.getByRole('button',{name:'商品パネルを閉じる'}).click();
  if(width===390){await f.page.keyboard.press('e');await f.frame.locator('.cs-panel:not([hidden])').waitFor();assert.ok((await f.frame.locator('.cs-panel').innerText()).includes('探究ノート'));await f.frame.getByRole('button',{name:'商品パネルを閉じる'}).click();}
  const beforeProduct=await pose(f.canvas);await tap(f,box.x+box.width*.5,box.y+box.height*.5);
  await f.frame.locator('.cs-panel:not([hidden])').waitFor();assert.ok((await f.frame.locator('.cs-panel').innerText()).includes('探究ノート'));
  const afterProduct=await pose(f.canvas);assert.ok(Math.hypot(afterProduct.x-beforeProduct.x,afterProduct.z-beforeProduct.z)<.04,'product selection does not move the camera');
  await f.frame.getByRole('button',{name:'商品パネルを閉じる'}).click();
  await f.frame.locator('[data-shop="checkin"]').click();await f.frame.getByText('✓ 記録済み',{exact:true}).waitFor();
  assert.equal(f.requests.filter(p=>p.endsWith('/shops/checkout')).length,0,'demo never begins checkout');
  await f.frame.getByRole('button',{name:'カウンター',exact:true}).click();await f.page.waitForTimeout(150);
  await f.page.screenshot({path:path.join(qa,`city-3d-inside-${width}.png`)});
  const size=await f.frame.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,layer:document.querySelector('#city-explorer').getBoundingClientRect().toJSON()}));
  assert.ok(size.body<=size.width+1&&size.root<=size.width+1);assert.ok(size.layer.right<=size.width+1);
  assert.deepEqual(f.errors,[]);
  await f.frame.getByRole('button',{name:'← City',exact:true}).click();assert.equal(await f.frame.locator('#city-explorer').count(),0);
  assert.equal(await f.frame.evaluate(()=>app.state.screen),'city');
 }finally{await f.close();}
});
test('3D City logout disposes the scene and clears the product panel',async()=>{
 const f=await open(390);try{await f.frame.getByRole('button',{name:'商品を見る',exact:true}).click();await f.page.evaluate(()=>__logout());assert.equal(await f.frame.locator('#city-explorer').count(),0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('3D City recovers a lost context and can exit after a catalogue failure',async()=>{
 const f=await open(390);
 try{
  await f.canvas.evaluate(c=>c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await f.frame.getByRole('button',{name:'再開する',exact:true}).click();
  await f.frame.locator('.cs-canvas[data-ready="true"]').waitFor({timeout:30000});
  await f.context.route('**/api/schoolpark/city/shops',route=>route.fulfill({status:503,json:{error:'UNAVAILABLE'}}));
  await f.canvas.evaluate(c=>c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await f.frame.getByRole('button',{name:'再開する',exact:true}).click();
  await f.frame.getByRole('button',{name:'もう一度読み込む',exact:true}).waitFor();
  await f.frame.getByRole('button',{name:'← City',exact:true}).click();
  assert.equal(await f.frame.locator('#city-explorer').count(),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
