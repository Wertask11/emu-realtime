"""PRODUCTION public UI only; HTTPS verified by urllib; no auth or write requests."""
import json,pathlib,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-facet-checkboxes/production');OUT.mkdir(parents=True,exist_ok=True)
BASE='https://schoolpark-emu.vercel.app';blocked=[];errors=[];results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':844})
 def relay(route):
  request=route.request;u=urllib.parse.urlparse(request.url)
  if request.method!='GET' or u.hostname not in ['schoolpark-emu.vercel.app','fonts.googleapis.com','fonts.gstatic.com']:
   blocked.append({'method':request.method,'host':u.hostname});route.abort();return
  # Preserve actual response bodies. No app fixtures, credentials or TLS bypass.
  try:
   response=urllib.request.urlopen(urllib.request.Request(request.url,headers={'Accept-Encoding':'identity'}),timeout=25)
  except urllib.error.HTTPError as e:response=e
  headers={k:v for k,v in response.headers.items() if k.lower() not in ['transfer-encoding','connection']}
  route.fulfill(status=response.status,headers=headers,body=response.read())
 c.route('**/*',relay);g=c.new_page();g.on('pageerror',lambda e:errors.append(str(e)))
 g.goto(BASE+'/knowledge-lab.html',wait_until='domcontentloaded');g.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
 if g.locator('#rk-tour .rk-close').is_visible():g.locator('#rk-tour .rk-close').click()
 if not g.locator('#searchClassifications').evaluate('el=>el.open'):g.locator('#searchClassifications > summary').click()
 group=g.locator('#searchFacets-field');group.locator('input').nth(0).click();group.locator('input').nth(1).click()
 assert group.locator('input:checked').count()==2
 assert '2件選択' in group.locator('.facet-selection').inner_text()
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900});group.scroll_into_view_if_needed()
  assert g.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert group.locator('input:checked').count()==2
  g.screenshot(path=str(OUT/f'PRODUCTION-readonly-facet-checkboxes-{width}.png'))
  results.append({'width':width,'twoCheckedWithoutModifiers':True,'horizontalOverflow':False})
 group.locator('input').nth(0).click();assert group.locator('input:checked').count()==1
 assert not errors,errors
 report={'environment':'PRODUCTION public library','transport':'actual HTTPS responses verified by urllib and relayed unchanged to Chromium','authenticated':False,'writeRequestsSent':False,'generationCalls':0,'pageErrors':errors,'blockedRequests':blocked,'results':results}
 (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2));b.close()
