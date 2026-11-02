import asyncio,json,pathlib,urllib.request,urllib.error,os
from playwright.async_api import async_playwright
assert os.environ.get('EMU_ANALYTICS_LIVE_TEST_CONFIRMED') == '1', 'Explicit confirmation required: sends internal test events to real PostHog'
OUT=pathlib.Path(os.environ.get('ANALYTICS_TEST_OUTPUT','/tmp/emu-analytics-live'));OUT.mkdir(parents=True,exist_ok=True);receipts=[];events=[]
def send(req):
 request=urllib.request.Request(req['url'],data=req['body'].encode(),headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:8761'},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=20) as r:status=r.status;headers=dict(r.headers);body=r.read()
 except urllib.error.HTTPError as r:status=r.code;headers=dict(r.headers);body=r.read()
 parsed=json.loads(body);receipts.append({'http_status':status,'accepted':parsed.get('status'),'event_names':[x['event'] for x in json.loads(req['body'])['batch']]});return status,headers,body
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=await b.new_context(viewport={'width':390,'height':950});errors=[]
  async def route(r):
   if r.request.url.startswith('https://us.i.posthog.com/batch/') and r.request.method=='POST':
    payload=json.loads(r.request.post_data);events.extend(payload['batch']);assert all(x['properties']['traffic_type']=='internal' for x in payload['batch']);assert 'api_key' in payload
    status,headers,body=await asyncio.to_thread(send,{'url':r.request.url,'body':r.request.post_data});await r.fulfill(status=status,headers={k:v for k,v in headers.items() if k.lower() not in ['transfer-encoding','content-encoding','connection']},body=body);return
   if r.request.url=='http://127.0.0.1:8761/__analytics-test.html':
    await r.fulfill(content_type='text/html',body='<!doctype html><html><head><script src="/emu-analytics.js"></script></head><body><iframe src="/knowledge.html" style="width:100%;height:900px;border:0"></iframe></body></html>');return
   if r.request.url.startswith('http://127.0.0.1:8761/'):await r.continue_();return
   await r.abort()
  await c.route('**/*',route);page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));await page.goto('http://127.0.0.1:8761/__analytics-test.html');await page.wait_for_timeout(500)
  assert not receipts
  await page.evaluate('EmuAnalytics.setTestTraffic(true);EmuAnalytics.consent(true)')
  await page.evaluate('''()=>document.querySelector('iframe').contentWindow.postMessage({type:'emu-knowledge-posts',posts:[{id:'LOCAL_SYNTHETIC',title:'LOCAL ONLY',body:'隔離された匿名計測検証です。'.repeat(100),createdAt:Date.now()}],account:'',canDraft:true},location.origin)''')
  f=page.frames[1];await f.locator('.more').first.click();await f.locator('[data-compose]').first.click();await page.evaluate('EmuAnalytics.flush()');await page.wait_for_timeout(700)
  await page.evaluate('EmuAnalytics.flush()');state=await page.evaluate('EmuAnalytics.status()');assert state['delivery']=='http_accepted',(state,receipts)
  names=[x['event'] for x in events]
  assert all(names.count(n)==1 for n in ['session_start','knowledge_list_view','knowledge_detail_view','post_create_start']),names
  assert 'LOCAL_SYNTHETIC' not in json.dumps(events);assert not errors
  await page.goto('http://127.0.0.1:8761/privacy.html#usage-measurement');await page.get_by_role('button',name='計測を停止する',exact=True).click();before=len(events);await page.evaluate("EmuAnalytics.track('post_publish',{surface:'feed'});EmuAnalytics.flush()");assert len(events)==before
  await b.close()
 result={'kind':'REAL_POSTHOG_INGESTION','production_data_writes':False,'synthetic_internal_traffic_only':True,'receipts':receipts,'events':events,'browser_errors':errors,'dashboard_query_verified':False}
 (OUT/'real-posthog-ingestion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'receipts':receipts,'event_count':len(events),'browser_errors':errors},ensure_ascii=False))
asyncio.run(main())
