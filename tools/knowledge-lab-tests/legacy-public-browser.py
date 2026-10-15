"""Legacy Emu publication → own list → actual edit/save → re-login. LOCAL only."""
import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-legacy-public');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':844})
 c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
 g=c.new_page();errors=[];g.on('pageerror',lambda e:errors.append(str(e)))
 g.goto('http://127.0.0.1:4203/test/lab-shell.html')
 def login(role):
  g.locator('#role').select_option(role)
  with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/me'):
   g.locator('#signin').click()
  f=g.frame_locator('#lab');f.locator('html[data-lab-ready="true"]').wait_for()
  f.locator('[data-view="mine"]').click()
  with g.expect_response(lambda r:'/me/public-posts' in r.url) as response:
   f.locator('[data-mine="public-posts"]').click()
  assert response.value.status==200
  return f,response.value.json()
 f,listed=login('bob');pid='000-legacy-public-ui'
 assert any(x['id']==pid and x['editable'] for x in listed['items'])
 # Hold the old category's real response until the public list has rendered.
 pending=[]
 g.route('**/api/knowledge-lab/me/saved',lambda r:pending.append(r))
 f.locator('[data-mine="saved"]').click()
 with g.expect_response(lambda r:'/me/public-posts' in r.url):
  f.locator('[data-mine="public-posts"]').click()
 f.locator('#mineItems [data-edit="'+pid+'"]').wait_for()
 assert len(pending)==1
 with g.expect_response(lambda r:'/me/saved' in r.url):
  held=pending.pop();held.fulfill(response=held.fetch())
 g.wait_for_timeout(150)
 assert f.locator('#mineItems [data-edit="'+pid+'"]').count()==1
 g.unroute('**/api/knowledge-lab/me/saved')
 f.locator('#mineItems [data-edit="'+pid+'"]').click()
 f.locator('#editorDialog').wait_for(state='visible')
 assert f.locator('#postTitle').input_value()=='LOCAL：旧Emuの公開投稿'
 f.locator('#postTitle').fill('LOCAL：旧投稿をそのまま更新')
 f.locator('#postFacets-field').select_option('field-it')
 # User explicitly checks consent. Provider disabled in this fixture; no external AI call.
 f.locator('#postAIConsent').check()
 f.locator('#postVisibility').select_option('public')
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/posts') as saved:
  f.locator('#postForm button[type=submit]').click()
 assert saved.value.status==200 and saved.value.json()['id']==pid
 f.locator('#editorDialog').wait_for(state='hidden')
 f,again=login('bob')
 assert sum(x['id']==pid for x in again['items'])==1
 assert next(x for x in again['items'] if x['id']==pid)['knowledgeLab']['aiUseConsent']['allowed'] is True
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900})
  assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  g.screenshot(path=str(OUT/f'LOCAL-legacy-public-{width}.png'))
 f,other=login('alice');assert all(x['id']!=pid for x in other['items'])
 assert not errors,errors
 report={'environment':'LOCAL Auth/Firestore emulators','productionWrites':False,'externalAICalls':0,'legacyListedEditable':True,'staleCategoryResponseIgnored':True,'samePostIdAfterSave':True,'explicitConsentRetainedAfterRelogin':True,'otherUserExcluded':True,'widths':[375,390,412,768,1024,1366],'pageErrors':errors}
 (OUT/'browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2));b.close()
