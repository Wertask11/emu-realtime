import asyncio,json,pathlib,os,urllib.parse
from playwright.async_api import async_playwright
BASE=os.environ.get('ANALYTICS_TEST_BASE','http://127.0.0.1:8761').rstrip('/')
assert urllib.parse.urlparse(BASE).hostname in ('127.0.0.1','localhost'), 'Local fixture only; never Production'
OUT=pathlib.Path(os.environ.get('ANALYTICS_TEST_OUTPUT','/tmp/emu-analytics-browser'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 result=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width in [375,390,412,768,1280]:
   c=await browser.new_context(viewport={'width':width,'height':950});packets=[];errors=[]
   async def route(r):
    url=r.request.url
    if url==BASE+'/__analytics-test.html':
     await r.fulfill(body='<!DOCTYPE html><html><head><script src="/emu-analytics.js"></script></head><body style="margin:0"><iframe src="/knowledge.html" style="border:0;width:100%;height:900px"></iframe></body></html>',content_type='text/html');return
    if url.startswith('https://us.i.posthog.com/batch/'):
     packets.extend(json.loads(r.request.post_data)['batch']);await r.fulfill(json={'status':1});return
    if url.startswith(BASE+'/'):
     await r.continue_();return
    await r.abort()
   await c.route('**/*',route);page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'/__analytics-test.html');await page.wait_for_timeout(700)
   assert len(packets)==0
   # Fixture is not a production route, so explicit test controller chooses consent; no phantom UI flow.
   await page.evaluate('EmuAnalytics.setTestTraffic(true); EmuAnalytics.consent(true)')
   frame=page.frames[1];await frame.locator('#posts').wait_for()
   await page.evaluate('''()=>document.querySelector('iframe').contentWindow.postMessage({type:'emu-knowledge-posts',posts:[{id:'LOCAL_ONLY_POST',title:'LOCAL ONLY',body:'これは隔離したテスト用の長い本文です。'.repeat(90),address:'LOCAL_PRIVATE_WALLET',createdAt:Date.now()}],account:'',canDraft:true,canSchedule:false},location.origin)''')
   await frame.locator('.more').first.wait_for();await frame.locator('.more').first.click();await page.wait_for_timeout(350)
   await frame.locator('[data-compose]').first.click();assert await frame.locator('#composer').get_attribute('aria-hidden')=='false';await page.wait_for_timeout(350)
   await page.evaluate('EmuAnalytics.flush()');assert not errors,errors
   names=[x['event'] for x in packets]
   for event in ['session_start','knowledge_list_view','knowledge_detail_view','post_create_start']:assert names.count(event)==1,(width,event,names)
   assert 'post_publish' not in names
   assert 'LOCAL_PRIVATE' not in json.dumps(packets) and 'LOCAL_ONLY_POST' not in json.dumps(packets)
   assert all(x['properties']['traffic_type']=='internal' for x in packets)
   await page.screenshot(path=str(OUT/f'LOCAL-analytics-composer-{width}.png'))
   await page.goto(BASE+'/privacy.html#usage-measurement');await page.get_by_role('button',name='計測を停止する',exact=True).click();assert '停止' in await page.locator('#analyticsConsentStatus').inner_text()
   before=len(packets);await page.evaluate("EmuAnalytics.track('post_publish',{surface:'feed'});EmuAnalytics.flush()");assert len(packets)==before
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   await page.screenshot(path=str(OUT/f'LOCAL-privacy-{width}.png'))
   result.append({'width':width,'events':names,'pageErrors':errors,'piiExcluded':True,'optOutVerified':True,'transport':'intercepted local contract test; not real ingestion'})
   await c.close();print('PASS',width,flush=True)
  await browser.close()
 (OUT/'LOCAL-analytics-browser.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
asyncio.run(main())
