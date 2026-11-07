"""Reproduce duplicate Content-Type against the real parent auth helper and Express parser."""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4257'
OUT=Path(os.environ.get('ECONOMY_EVIDENCE','/tmp/reizo-headers'));OUT.mkdir(parents=True,exist_ok=True)
OLD=subprocess.check_output(['git','show','c935497d8a4011b31e16a9fc8e660dede525a479:frontend/public/economy/app.js'],text=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage']);rows=[]
  for before in [True,False]:
   c=await b.new_context(viewport={'width':390,'height':900})
   async def route(r):
    if not r.request.url.startswith(BASE+'/'):return await r.abort()
    if before and r.request.url==BASE+'/economy/app.js':return await r.fulfill(body=OLD,content_type='text/javascript')
    await r.continue_()
   await c.route('**/*',route);g=await c.new_page();await g.goto(BASE+'/test/shell');f=g.frame_locator('iframe');await f.locator('#spendable').filter(has_text='EMUER').wait_for()
   await f.locator('#goal').fill('学んだ知識を実際に試すギルドを探したい')
   async with g.expect_response(lambda r:r.url.endswith('/api/economy/quotes')) as info:await f.locator('#quoteButton').click()
   res=await info.value;data=await res.json();ct=await res.request.header_value('content-type')
   if before:
    assert res.status==400 and data.get('error')=='INVALID_INPUT';assert ct=='application/json, application/json'
   else:
    assert res.status==200 and data['quote']['price']==5;assert ct=='application/json';await f.locator('#approval').wait_for(state='visible')
   rows.append({'version':'before fix' if before else 'fixed','http':res.status,'requestContentType':ct,'error':data.get('error'),'quotePrice':data.get('quote',{}).get('price'),'paymentSubmitted':False,'scope':'local native Auth/Firestore and production auth-header function'})
   await g.screenshot(path=str(OUT/('headers-before.png' if before else 'headers-fixed.png')),full_page=True);await c.close()
  await b.close();(OUT/'headers.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
asyncio.run(main())
