"""Real local Auth/Firestore + agent HTTP fixture. No external requests or production assets."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4257'
OUT=Path(os.environ.get('ECONOMY_EVIDENCE','/tmp/reizo-cross-browser'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage']);rows=[]
  for width in [375,390,412,768,1280,1440,1920]:
   c=await b.new_context(viewport={'width':width,'height':900});await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(BASE+'/') else r.abort())
   g=await c.new_page();errors=[];posts=[]
   g.on('pageerror',lambda e:errors.append(str(e)));g.on('request',lambda r:posts.append(r.url) if r.method=='POST' else None)
   await g.goto(BASE+'/test/shell');f=g.frame_locator('iframe');await f.locator('#crossOptions').wait_for(state='visible');await f.locator('#spendable').filter(has_text='EMUER').wait_for()
   if width>=1280:await g.evaluate("testSignIn('bob')");await f.locator('#history').filter(has_text='まだ依頼はありません').wait_for();await g.wait_for_timeout(1200)
   await f.get_by_role('button',name='Web3を試したい',exact=True).click();assert await f.locator('#goal').input_value()=='Web3を学んで実際に試したい';assert not any(x.endswith('/jobs') for x in posts)
   await f.locator('#goal').fill('コーヒーを学んで実際に試したい')
   if width==390:
    await f.get_by_text('本人の情報を参照して絞る（任意）',exact=True).click();await f.locator('#balanceConsent').check();await f.locator('#achievementsConsent').check();await f.locator('#inspectContext').click();await f.locator('#contextPreview').filter(has_text='100 EMUER').wait_for();assert not any(x.endswith('/jobs') for x in posts)
   await f.locator('#quoteButton').click();await f.locator('#approval').wait_for(state='visible');assert 'reizo-cross-20261107-v1' in await f.locator('#quoteTerms').inner_text();assert '5 EMUER' in await f.locator('#pay').inner_text()
   if width==390:
    await f.locator('#paymentConsent').check();await f.locator('#aiConsent').check();await f.locator('#pay').click()
    # The result must appear without clicking the manual history refresh.
    await f.get_by_text('次の行動（AIの提案）',exact=True).wait_for(timeout=45000);await f.get_by_text('調べた情報・出典',exact=True).wait_for();assert len([x for x in posts if x.endswith('/jobs')])==1
    assert '参照した領域' in await f.locator('#history').inner_text();assert 'AIへ送信していません' in await f.locator('#history').inner_text();assert 'LOCAL-OTHER-PERSON' not in await f.locator('#history').inner_text()
    await f.locator('#spendable').filter(has_text='95 EMUER').wait_for();await g.screenshot(path=str(OUT/'cross-result-390.png'),full_page=True)
    await g.evaluate("testSignIn('bob')");await g.wait_for_timeout(1300);await f.locator('#history').filter(has_text='まだ依頼はありません').wait_for();assert not await f.locator('#balanceConsent').is_checked();assert not await f.locator('#achievementsConsent').is_checked();assert await f.locator('#contextPreview').inner_text()==''
   if width in [375,1280]:await g.screenshot(path=str(OUT/f'cross-request-{width}.png'),full_page=True)
   assert not await f.locator('body').evaluate('()=>document.documentElement.scrollWidth>innerWidth+1');assert not errors,errors
   rows.append({'width':width,'overflow':False,'examplesDoNotPay':True,'scopedConsentShown':True,'pageErrors':errors,'scope':'isolated demo Auth/Firestore and model HTTP fixture only'})
   await c.close()
  await b.close();(OUT/'browser.json').write_text(json.dumps({'matrix':rows,'automaticCrossResult':'390px real local ledger 5 once, native Auth, model HTTP fixture','accountSwitch':'private consent and context cleared'},ensure_ascii=False,indent=2))
asyncio.run(main())
