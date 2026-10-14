import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-release');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4201';results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':390,'height':844});g=c.new_page();errors=[]
 g.on('pageerror',lambda e:errors.append(str(e)))
 def isolate(route):
  u=urllib.parse.urlparse(route.request.url)
  if u.hostname in ['127.0.0.1','localhost'] or route.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:route.continue_()
  else:route.abort()
 c.route('**/*',isolate)
 g.goto(BASE+'/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof window.__localEmulatorLogin==="function" && typeof window.__localEmulatorComplete==="function"');g.evaluate('window.__localEmulatorLogin("bob")');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.evaluate('openEmuKnowledgeLab()');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
 guide=f.locator('#rk-tour .rk-close')
 if guide.count() and guide.is_visible():guide.click()
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900 if width>=768 else 844})
  for view in ['library','research','mine','writer','requests']:
   f.locator('[data-view="'+view+'"]').click();f.locator('#'+view).wait_for(state='visible')
   m=f.locator('html').evaluate('(e)=>({width:innerWidth,scroll:e.scrollWidth})');assert m['scroll']<=m['width']+1,(width,view,m)
   overflow=f.locator('#'+view).evaluate('(e)=>Array.from(e.querySelectorAll("button,input,select,textarea")).filter(x=>{const b=x.getBoundingClientRect();return b.width>0 && (b.left < -1 || b.right>innerWidth+1)}).map(x=>x.id||x.textContent.slice(0,40))');assert not overflow,(width,view,overflow)
   g.screenshot(path=str(OUT/f'local-native-{width}-{view}.png'))
  f.locator('[data-view="library"]').click();f.locator('#library [data-compose]').click();f.locator('#postTitle').fill('モバイル入力検証');assert f.locator('#postTitle').evaluate('(e)=>e===document.activeElement');g.keyboard.press('Tab');assert f.locator('#postBody').evaluate('(e)=>e===document.activeElement');m=f.locator('#editorDialog').evaluate('(e)=>({width:e.clientWidth,scroll:e.scrollWidth})');assert m['scroll']<=m['width']+1,(width,'modal',m);g.screenshot(path=str(OUT/f'local-native-{width}-modal.png'));g.keyboard.press('Escape');f.locator('#editorDialog').wait_for(state='hidden')
  f.locator('[data-view="mine"]').click();f.locator('[data-mine="notes"]').click();note=f.locator('#mineItems [data-note]').first;note.wait_for();note.click();f.locator('#noteHistory').click();f.locator('#historyRows .card').first.wait_for();m=f.locator('#detailDialog').evaluate('(e)=>({width:e.clientWidth,scroll:e.scrollWidth})');assert m['scroll']<=m['width']+1,(width,'history',m);g.screenshot(path=str(OUT/f'local-native-{width}-history.png'));f.locator('#detailDialog [data-close]').click()
  results.append({'width':width,'nativeLabViews':['library','research','mine','writer','requests','postModal','privateHistory'],'horizontalOverflow':False,'controlOverflow':False,'postFormKeyboard':'title→body→Escape PASS','result':'PASS'})
 # Public information pages: the actual local static HTML, with the same API hold status.
 page=c.new_page()
 for width in [375,390,412,768,1024,1366]:
  page.set_viewport_size({'width':width,'height':900 if width>=768 else 844})
  for name in ['writers','intro','guide']:
   r=page.goto(BASE+'/knowledge-lab-'+name+'.html',wait_until='domcontentloaded');assert r.status==200;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert page.locator('h1').is_visible();page.screenshot(path=str(OUT/f'local-static-{width}-{name}.png'))
  results.append({'width':width,'staticViews':['recruitment','intro','guide'],'horizontalOverflow':False,'result':'PASS'})
 assert not errors,errors
 (OUT/'responsive-results.json').write_text(json.dumps({'environment':'local native + actual Auth/Firestore emulators','pageErrors':errors,'results':results},ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2));b.close()
