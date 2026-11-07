"""Real local Auth/Firestore membership matrix; all non-local requests blocked."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4257'
OUT=Path(os.environ.get('ECONOMY_EVIDENCE','/tmp/reizo-plus-pro'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  records=[]
  for width in [390,1280]:
   for role,allowed in [('guest',False),('light',False),('alice',True),('pro',True)]:
    c=await b.new_context(viewport={'width':width,'height':900});await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(BASE+'/') else r.abort())
    g=await c.new_page();errors=[];g.on('pageerror',lambda e:errors.append(str(e)))
    await g.goto(BASE+'/test/shell');await g.wait_for_function('auth.currentUser?.uid === "economy-alice"')
    await g.evaluate('(role)=>testSignIn(role)',role);await g.wait_for_function('(role)=>auth.currentUser?.uid === "economy-"+role',arg=role)
    f=g.frame_locator('iframe');await f.locator('#spendable').filter(has_text='EMUER').wait_for()
    if allowed:await f.locator('#availability').filter(has_text='受付中').wait_for();assert await f.locator('#quoteButton').is_enabled()
    else:await f.locator('#availability').filter(has_text='Plus・Pro限定').wait_for();assert await f.locator('#quoteButton').is_disabled()
    assert not await f.locator('body').evaluate('()=>document.documentElement.scrollWidth>innerWidth+1');assert not errors
    await g.screenshot(path=str(OUT/f'plan-{role}-{width}.png'),full_page=True)
    records.append({'width':width,'plan':{'alice':'plus'}.get(role,role),'canQuote':allowed,'pageErrors':errors,'environment':'isolated demo only'})
    await c.close()
  await b.close();(OUT/'plans.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
asyncio.run(main())
