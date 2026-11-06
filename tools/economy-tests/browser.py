"""Local emulator only. Block every external browser request, including production Firebase."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4257'
OUT=Path(os.environ.get('ECONOMY_EVIDENCE','/tmp/emuer-stage2-evidence'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  records=[]
  for width in [375,390,412,768,1280,1440,1920]:
   context=await browser.new_context(viewport={'width':width,'height':900},device_scale_factor=1)
   await context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(BASE+'/') else route.abort())
   page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'/test/shell');frame=page.frame_locator('iframe')
   await frame.locator('#spendable').filter(has_text='EMUER').wait_for()
   if width>=1280:
    await page.evaluate("testSignIn('bob')");await page.wait_for_timeout(1600)
    await frame.locator('#spendable').filter(has_text='100 EMUER').wait_for()
   assert await frame.locator('#quoteButton').is_enabled()
   overflow=await frame.locator('body').evaluate('(el)=>document.documentElement.scrollWidth>innerWidth')
   assert not overflow,f'overflow at {width}'
   await frame.locator('#goal').fill('コーヒーを学びたい')
   await frame.locator('#quoteButton').click();await frame.locator('#approval').wait_for(state='visible')
   assert '5 EMUER' in await frame.locator('#pay').inner_text()
   # Quotes do not debit anything. Actual payment once, in this isolated demo environment only.
   if width==390:
    await frame.locator('#pay').click();assert '両方' in await frame.locator('#notice').inner_text()
    await frame.locator('#paymentConsent').check();await frame.locator('#aiConsent').check();await frame.locator('#pay').click()
    await page.wait_for_timeout(1600);await frame.locator('#refresh').click()
    await frame.locator('#history').filter(has_text='完了').wait_for()
    assert await frame.locator('#spendable').inner_text()=='95 EMUER'
    await frame.locator('#simulate').click();await frame.locator('#simulation').filter(has_text='停止').wait_for()
    show=frame.get_by_role('button',name='結果を見る')
    if await show.count(): await show.first.click()
    await frame.locator('#history').filter(has_text='ID:').wait_for()
    await page.screenshot(path=str(OUT/'mobile-result-390.png'),full_page=True)
    await frame.locator('body').evaluate('()=>window.scrollTo(0,0)')
    await page.screenshot(path=str(OUT/'mobile-390.png'),full_page=True)
    # Account change must immediately clear another person's history and unsubmitted input.
    await frame.locator('#goal').fill('保存しない目的')
    await page.evaluate("testSignIn('bob')");await page.wait_for_timeout(1600)
    assert await frame.locator('#goal').input_value()==''
    await frame.locator('#history').filter(has_text='まだ依頼はありません').wait_for()
    assert await frame.locator('#spendable').inner_text()=='100 EMUER'
   if width==1280:
    await page.screenshot(path=str(OUT/'desktop-approval-1280.png'),full_page=True)
    await frame.locator('body').evaluate('()=>window.scrollTo(0,0)')
    await page.screenshot(path=str(OUT/'desktop-1280.png'),full_page=True)
   if await frame.locator('#cancel').is_visible(): await frame.locator('#cancel').click()
   await frame.locator('#back').click();assert await page.evaluate('window.closedEconomy')
   assert not errors,errors
   records.append({'width':width,'overflow':False,'quote':True,'back':True,'consoleErrors':errors})
   await context.close()
  # Inject a truthful pending-refund HTTP fixture solely to check presentation; not evidence of a financial refund.
  context=await browser.new_context(viewport={'width':390,'height':900});page=await context.new_page()
  async def pending(route):
   if route.request.url==BASE+'/api/economy/jobs':
    return await route.fulfill(json={'ok':True,'jobs':[{'id':'test','state':'refund_pending','price':5,'createdAtMs':1793952000000,'payment':{'status':'paid','amount':5},'result':None}]})
   if route.request.url.startswith(BASE+'/'):return await route.continue_()
   await route.abort()
  await context.route('**/*',pending);await page.goto(BASE+'/test/shell');f=page.frame_locator('iframe');await f.locator('#history').filter(has_text='返却はまだ確定していません').wait_for()
  await page.screenshot(path=str(OUT/'refund-pending-390.png'),full_page=True)
  await browser.close();(OUT/'browser.json').write_text(json.dumps({'matrix':records,'paymentAndIdentitySwitch':'390px isolated demo','pendingRefundPresentation':'HTTP fixture only'},ensure_ascii=False,indent=2))
asyncio.run(main())
