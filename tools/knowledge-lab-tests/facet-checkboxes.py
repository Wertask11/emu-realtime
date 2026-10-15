"""Modifier-free facet selection with real local Auth/Firestore persistence."""
import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright
from facet_controls import select_facets
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-facet-checkboxes');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4203';PID='000-legacy-public-ui'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 errors=[]
 def page(touch=False):
  c=b.new_context(viewport={'width':390 if touch else 1366,'height':900},has_touch=touch,is_mobile=touch)
  c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
  g=c.new_page();g.on('pageerror',lambda e:errors.append(str(e)));g.goto(BASE+'/test/lab-shell.html')
  return g
 def login(g):
  g.locator('#role').select_option('bob')
  with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/me'):
   g.locator('#signin').click()
  f=g.frame_locator('#lab');f.locator('html[data-lab-ready="true"]').wait_for()
  f.locator('[data-view="mine"]').click()
  with g.expect_response(lambda r:'/me/public-posts' in r.url):f.locator('[data-mine="public-posts"]').click()
  f.locator('#mineItems [data-edit="'+PID+'"]').click();f.locator('#editorDialog').wait_for(state='visible')
  return f
 g=page();f=login(g);expected={}
 groups=f.locator('#postFacets .facet-group');assert groups.count()==10
 for group in groups.all():
  axis=group.get_attribute('data-axis');inputs=group.locator('input[type=checkbox]')
  for item in inputs.all():item.uncheck()
  # Ordinary clicks, no Ctrl/Command/Shift and no select_option helper.
  inputs.nth(0).click();inputs.nth(1).click()
  assert group.locator('input:checked').count()==2
  assert '2件選択' in group.locator('.facet-selection').inner_text()
  expected[axis]=[inputs.nth(i).get_attribute('value') for i in [0,1]]
 first=f.locator('#postFacets-field input').first;first.focus();g.keyboard.press('Space')
 assert f.locator('#postFacets-field input:checked').count()==1
 g.keyboard.press('Space');assert f.locator('#postFacets-field input:checked').count()==2
 f.locator('#postTitle').fill('LOCAL：複数分類チェック');f.locator('#postAIConsent').uncheck()
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900})
  f.locator('#postFacets-field').scroll_into_view_if_needed()
  assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  assert f.locator('#editorDialog').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
  assert f.locator('#postFacets .facet-options label').evaluate_all('xs=>xs.every(e=>e.getBoundingClientRect().height>=44)')
  g.screenshot(path=str(OUT/f'LOCAL-checkbox-facets-{width}.png'))
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/posts') as saved:
  f.locator('#postForm button[type=submit]').click()
 assert saved.value.status==200 and saved.value.json()['id']==PID
 assert saved.value.request.post_data_json['facets']==expected
 f.locator('#editorDialog').wait_for(state='hidden')
 f=login(g)
 for axis,ids in expected.items():
  actual=f.locator('#postFacets-'+axis+' input:checked').evaluate_all('xs=>xs.map(e=>e.value)')
  assert set(actual)==set(ids),(axis,actual,ids)
 f.locator('#editorDialog [data-close]').click()
 f.locator('[data-view="library"]').click();f.locator('#query').fill('複数分類チェック')
 for axis in ['field','industry','occupation','experience']:
  select_facets(f,'#searchFacets-'+axis,expected[axis])
 with g.expect_response(lambda r:'/search?' in r.url) as found:f.locator('#searchForm button[type=submit]').click()
 assert found.value.status==200 and any(x['id']==PID for x in found.value.json()['items'])
 url=urllib.parse.urlparse(found.value.url);params=urllib.parse.parse_qs(url.query)
 for axis in ['field','industry','occupation','experience']:assert set(params[axis][0].split(','))==set(expected[axis])
 # Clear the first checkbox without dropping the other choice.
 f.locator('#searchFacets-field input[value="'+expected['field'][0]+'"]').click()
 assert f.locator('#searchFacets-field input:checked').count()==1
 f.locator('#advancedSearch > summary').click()
 f.locator('#advancedSearch > details > summary').click()
 select_facets(f,'#excludeFacets-field',[expected['field'][1]])
 with g.expect_response(lambda r:'/search?' in r.url):f.locator('#resetFilters').click()
 assert f.locator('#searchFacets input:checked,#excludeFacets input:checked').count()==0
 assert all(x.inner_text()=='未選択' for x in f.locator('#searchFacets .facet-selection,#excludeFacets .facet-selection').all())
 # Shared search URLs restore multiple checkboxes.
 g.evaluate('u=>document.querySelector("#lab").src=u','/knowledge-lab.html?field='+','.join(expected['field']))
 f=g.frame_locator('#lab');f.locator('html[data-lab-ready="true"]').wait_for()
 assert f.locator('#searchFacets-field input:checked').count()==2
 f.locator('[data-view="writer"]').click()
 for axis in ['field','industry','occupation']:select_facets(f,'#writerFacets-'+axis,expected[axis])
 f.locator('#writerName').fill('LOCAL：分類の保存検証');f.locator('#writerBio').fill('検証環境のプロフィールです。')
 with g.expect_response(lambda r:r.request.method=='PUT' and '/me/writer' in r.url) as profile:f.locator('#writerDraft').click()
 assert profile.value.status==200
 for axis in ['field','industry','occupation']:assert set(profile.value.json()['facets'][axis])==set(expected[axis])
 f.locator('[data-view="requests"]').click()
 select_facets(f,'#requestFacets-field',expected['field'])
 f.locator('#requestQuestion').fill('LOCAL：分類の複数選択を確かめる');f.locator('#requestContext').fill('エミュレーター内の保存確認です。')
 with g.expect_response(lambda r:r.request.method=='POST' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/requests') as request:f.locator('#requestForm button[type=submit]').click()
 assert request.value.status==200
 assert set(request.value.request.post_data_json['facets']['field'])==set(expected['field'])
 f.locator('#requestQuestion').wait_for()
 g.wait_for_timeout(100)
 assert f.locator('#requestFacets input:checked').count()==0
 assert all(x.inner_text()=='未選択' for x in f.locator('#requestFacets .facet-selection').all())
 # Real touch input toggles individual choices without clearing other selections.
 t=page(True);tf=login(t);group=tf.locator('#postFacets-field')
 group.locator('input[value="'+expected['field'][0]+'"]').tap()
 assert group.locator('input:checked').count()==1
 group.locator('input[value="'+expected['field'][0]+'"]').tap()
 assert group.locator('input:checked').count()==2
 assert '2件選択' in group.locator('.facet-selection').inner_text()
 t.screenshot(path=str(OUT/'LOCAL-touch-multiselect-390.png'))
 assert not errors,errors
 report={'environment':'LOCAL real Auth/Firestore emulators','productionWrites':False,'externalAICalls':0,'allTenAxesClickMultipleWithoutModifiers':True,'saveAndReloginRetainsAllSelections':True,'individualClearAndKeyboardSpace':True,'searchPayloadAndURLRestore':True,'resetClearsCheckboxesAndSummaries':True,'writerProfileAndKnowledgeRequestPersistence':True,'touchTogglesWithoutClearingOtherSelections':True,'widths':[375,390,412,768,1024,1366],'pageErrors':errors}
 (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2));b.close()
