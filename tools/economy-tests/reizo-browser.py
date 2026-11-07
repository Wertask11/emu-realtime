"""Local Auth/Firestore + native mascot/controller/entry. All external requests blocked."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4257'
OUT=Path(os.environ.get('REIZO_REQUEST_EVIDENCE','/tmp/reizo-request-evidence'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage']);matrix=[]
  for width in [375,390,412,768,1280,1440,1920]:
   c=await b.new_context(viewport={'width':width,'height':900});await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(BASE+'/') else r.abort());g=await c.new_page();errors=[];posts=[]
   g.on('pageerror',lambda e:errors.append(str(e)));g.on('request',lambda r:posts.append(r.url) if r.method=='POST' else None)
   await g.goto(BASE+'/test/reizo-shell');await g.wait_for_function('auth.currentUser?.uid === "economy-alice"');await g.locator('#emuHeaderReizo').click();panel=g.locator('.rk-choice');await panel.wait_for(state='visible')
   buttons=panel.locator('.rk-actions button:visible');assert await buttons.all_text_contents()==['この画面のガイドを見る','冷蔵庫くんに聞く','冷蔵庫くんに頼む']
   for btn in await buttons.all():
    assert await btn.evaluate('(e)=>parseFloat(getComputedStyle(e).minHeight)>=44')
    assert (await btn.bounding_box())['height']>=43.99  # Chromium subpixel rounding during entry animation
   rect=await panel.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=width+1
   # A completed guide stays completed after using the other two choices.
   await buttons.first.click();await g.get_by_role('button',name='完了',exact=True).click();assert await g.evaluate('ReizoTour.progress("emu-local-request").state')=='done'
   await g.locator('#emuHeaderReizo').click();await g.get_by_role('button',name='冷蔵庫くんに聞く',exact=True).click();await g.locator('#spReizoPanel.open').wait_for()
   await g.locator('#spReizoInput').fill('クエストって何？');await g.locator('.sp-reizo-send').click();await g.locator('#spReizoMessages').filter(has_text='クエスト').wait_for();assert not any('/api/economy/' in x for x in posts)
   # Native chat close/open preserves its conversation. Request is a separate screen.
   await g.locator('.sp-reizo-close').click();await g.locator('#emuHeaderReizo').click();await g.keyboard.press('Tab');await g.keyboard.press('Tab');assert await g.get_by_role('button',name='冷蔵庫くんに頼む',exact=True).evaluate('(e)=>e===document.activeElement');await g.keyboard.press('Enter')
   f=g.frame_locator('#spRoomFrame');await f.locator('#spendable').filter(has_text='EMUER').wait_for();assert not any('/jobs' in x for x in posts)
   await f.locator('#availability').wait_for();assert 'SchoolPark Explorer' not in await f.locator('body').inner_text();assert '候補が見つからなくても5 EMUER' in await f.locator('body').inner_text();assert not await g.locator('#spReizoPanel').evaluate('(e)=>e.classList.contains("open")')
   overflow=await f.locator('body').evaluate('()=>document.documentElement.scrollWidth>innerWidth');assert not overflow
   if width==390:
    assert await f.locator('#spendable').inner_text()=='100 EMUER';await f.locator('#goal').fill('コーヒーを学びたい');await f.locator('#quoteButton').click();await f.locator('#approval').wait_for(state='visible');assert '5 EMUER' in await f.locator('#pay').inner_text();assert not any('/jobs' in x for x in posts)
    await f.locator('#pay').click();assert '両方' in await f.locator('#notice').inner_text();assert not any('/jobs' in x for x in posts)
    await f.locator('#paymentConsent').check();await f.locator('#aiConsent').check();await g.screenshot(path=str(OUT/'reizo-approval-390.png'),full_page=True)
    await f.locator('#pay').dispatch_event('click');await f.locator('#pay').dispatch_event('click');await g.wait_for_timeout(1800);await f.locator('#refresh').click();await f.locator('#history').filter(has_text='完了').wait_for();assert await f.locator('#spendable').inner_text()=='95 EMUER';assert len([x for x in posts if x.endswith('/jobs')])==1
    await f.get_by_role('button',name='結果を見る').first.click();await f.locator('#history').filter(has_text='ID:').wait_for();await g.screenshot(path=str(OUT/'reizo-result-390.png'),full_page=True)
    await f.locator('#goal').fill('引き継がない入力');await g.evaluate('testSignIn("bob")');await g.wait_for_timeout(1400);assert await f.locator('#goal').input_value()=='';await f.locator('#history').filter(has_text='まだ依頼はありません').wait_for()
   if width in [375,1280]:await g.screenshot(path=str(OUT/f'reizo-request-{width}.png'),full_page=True)
   await f.locator('#back').click();assert not await g.locator('body').evaluate('(e)=>e.classList.contains("sp-room-open")');await g.locator('#emuHeaderReizo').click();await panel.wait_for(state='visible');assert await g.evaluate('ReizoTour.progress("emu-local-request").state')=='done'
   if width in [375,390,1280]:
    await g.wait_for_timeout(300)
    await g.screenshot(path=str(OUT/f'reizo-menu-{width}.png'),full_page=True)
   assert not errors,errors
   matrix.append({'width':width,'threeOrderedChoices':True,'guideProgressPreserved':True,'chatSeparate':True,'keyboard':True,'tapHeightMin44':True,'noChargeOnEntry':True,'back':True,'overflow':False,'pageErrors':errors});await c.close()
  await b.close();(OUT/'reizo-browser.json').write_text(json.dumps({'matrix':matrix,'payment':'390px actual local ledger/Auth/provider mock, one POST and 5 EMUER once','identitySwitch':'alice to bob, history/input cleared','scope':'native mascot markup/core/adapter/entry and local auth fixture; not production or live Gemini'},ensure_ascii=False,indent=2))
asyncio.run(main())
