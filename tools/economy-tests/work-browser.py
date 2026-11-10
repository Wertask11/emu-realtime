import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
# Dedicated local fixture only. Remote requests are aborted below.
OUT=Path(os.environ.get('ECONOMY_EVIDENCE','/tmp/reizo-work-browser'));OUT.mkdir(parents=True,exist_ok=True)
TASK=os.environ.get('ECONOMY_TEST_WORK','guild_plan')
LABEL={'guild_plan':'ギルド活動の準備','quest_plan':'クエスト挑戦の準備','city_comparison':'Cityの利用支援','knowledge_draft':'知識投稿の準備','wil_plan':'探究・WILの支援'}[TASK]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  results=[]
  for width in [375,390,412,768,1280,1440,1920]:
   context=await browser.new_context(viewport={'width':width,'height':900})
   blocked=[]
   async def guard(route):
    if route.request.url.startswith('http://127.0.0.1:4257/') or route.request.url.startswith('http://127.0.0.1:9292/') or route.request.url.startswith('http://127.0.0.1:8892/'): await route.continue_()
    else: blocked.append(route.request.url.split('?')[0]);await route.abort()
   await context.grant_permissions(['clipboard-read','clipboard-write']);await context.route('**/*',guard)
   page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:4257/test/shell');f=page.frame_locator('iframe')
   await f.locator('#quoteButton').wait_for(state='visible');await f.locator('#workOptions').wait_for(state='visible')
   assert await f.locator('#taskType option:not([disabled])').count()==6
   if width==375:
    await f.locator('#taskType').select_option(TASK);await f.locator('#goal').fill('コーヒーを学びWeb3を実践するギルド活動を準備したい')
    await f.locator('#quoteButton').click();await f.locator('#approval').wait_for(state='visible');assert await f.locator('#executionPlan li').count()==5
    await f.locator('#cancel').click();assert await f.locator('#approval').is_hidden()
    await f.locator('#quoteButton').click();await f.locator('#paymentConsent').check();await f.locator('#aiConsent').check();await f.locator('#pay').click()
    await f.locator('#history article').first.get_by_role('button',name='保存した下書き・計画を開く').wait_for(timeout=20000)
    await f.locator('#history article').first.get_by_role('button',name='保存した下書き・計画を開く').click();await f.locator('#artifactDialog').wait_for(state='visible')
    assert '本人が確認・記入' in await f.locator('#artifactContent').input_value()
   else:
    await f.locator('#loadArtifacts').click();await f.get_by_role('button',name=LABEL+'を開く').first.click();await f.locator('#artifactDialog').wait_for(state='visible')
   assert await f.locator('#artifactStructured input[type=checkbox]').count()>=5
   await f.locator('#artifactStructured input[type=checkbox]').first.check();await f.locator('#saveChecklist').click();await f.locator('#artifactNotice').filter(has_text='チェック状態を本人専用に保存').wait_for()
   await f.locator('#closeArtifact').click();await f.locator('#loadArtifacts').click();await f.get_by_role('button',name=LABEL+'を開く').first.click();await f.locator('#artifactDialog').wait_for(state='visible');assert await f.locator('#artifactStructured input[type=checkbox]').first.is_checked()
   await f.locator('#artifactEditor summary').click()
   await f.locator('#artifactTitle').fill('本人が確認した計画');await f.locator('#artifactContent').fill('資料を確認して、小さく実践する計画です。')
   await f.locator('#artifactEditConsent').check();await f.locator('#saveArtifact').click();await f.locator('#artifactNotice').filter(has_text='編集保存しました').wait_for()
   assert not await f.locator('body').evaluate('(el)=>el.scrollWidth>innerWidth');assert not await f.locator('#artifactDialog').evaluate('(el)=>el.scrollWidth>el.clientWidth+2')
   await f.locator('#copyArtifact').click();await f.locator('#artifactNotice').filter(has_text='コピーしました').wait_for()
   await page.evaluate("window.openEmuKnowledgeLab=(view,options)=>{window.postingArgs={view,options}}");await f.locator('#openPosting').click();assert await page.evaluate("window.postingArgs")=={'view':'library','options':{'compose':True}}
   if width in [390,1280]:await page.screenshot(path=str(OUT/f'artifact-{width}.png'),full_page=True)
   await f.locator('#closeArtifact').click();await f.locator('#loadArtifacts').click();await f.get_by_role('button',name=LABEL+'を開く').first.click();await f.locator('#artifactDialog').wait_for(state='visible');assert await f.locator('#artifactContent').input_value()=='資料を確認して、小さく実践する計画です。'
   if width==1920:
    r=await context.request.post('http://127.0.0.1:4257/test/membership',data={'role':'alice','plan':'light'});assert r.ok
    await f.locator('#artifactEditor summary').click()
    await f.locator('#copyArtifact').click();await f.locator('#artifactDialog').wait_for(state='hidden');assert await f.locator('#artifactContent').input_value()==''
    await context.request.post('http://127.0.0.1:4257/test/membership',data={'role':'alice','plan':'plus'})
    await f.locator('#loadArtifacts').click();await f.get_by_role('button',name=LABEL+'を開く').first.click();await f.locator('#artifactDialog').wait_for(state='visible')
    assert await f.locator('#artifactContent').input_value()=='資料を確認して、小さく実践する計画です。'
   # Account switch resets sensitive state and closes the editor.
   await page.evaluate("window.testSignIn('bob')");await f.locator('#artifactDialog').wait_for(state='hidden');assert await f.locator('#artifactContent').input_value()==''
   assert not errors,errors;assert not blocked,blocked
   results.append({'width':width,'generatedSavedEditedReopened':True,'privateChecklistSavedReopened':True,'accountSwitchCleared':True,'overflow':False,'pageErrors':errors,'blockedExternal':blocked})
   await context.close()
  await browser.close();(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
asyncio.run(main())
