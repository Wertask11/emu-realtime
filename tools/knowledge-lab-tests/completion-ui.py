"""Actual native UI + emulator persistence. Gemini provider/vectors are MOCKS, never live AI proof."""
import json, pathlib, urllib.parse
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:4201'
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-completion/mock-ui');OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':844});g=c.new_page();errors=[]
 g.on('pageerror',lambda e:errors.append(str(e)))
 def isolate(route):
  host=urllib.parse.urlparse(route.request.url).hostname
  if host in ['localhost','127.0.0.1'] or route.request.resource_type in ['script','stylesheet','font','image'] and host in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:route.continue_()
  else:route.abort()
 c.route('**/*',isolate)
 g.goto(BASE+'/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof __localEmulatorLogin==="function"')
 def lab(role,view):
  g.evaluate('async role=>{if(window.auth?.currentUser)await auth.signOut();await __localEmulatorLogin(role)}',role)
  g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
  g.evaluate('v=>openEmuKnowledgeLab(v)',view);f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
  if f.locator('#rk-tour .rk-close').count() and f.locator('#rk-tour .rk-close').is_visible():f.locator('#rk-tour .rk-close').click()
  return f
 f=lab('owner','admin');f.locator('#aiLoadModels').click();f.locator('#aiModel option[value="gemini-test-flash"]').wait_for(state='attached')
 f.locator('#aiModel').select_option('gemini-test-flash');f.locator('#aiEmbeddingModel').select_option('gemini-embedding-001');f.locator('#aiFreeConfirmed').check()
 with g.expect_response(lambda r:r.request.method=='PUT' and '/admin/ai' in r.url) as configured:f.locator('#aiSettingsForm button[type=submit]').click()
 assert configured.value.status==200
 f=lab('bob','writer');f.locator('#writerName').fill('エミュレーター検証の書き手');f.locator('#writerBio').fill('AI表示と保存の検証用。外部AI応答は模擬です。');f.locator('#writerFacets-field').select_option('field-education');f.locator('#writerConsent').check();f.locator('#writerForm button[type=submit]').click()
 ids=[]
 for field,title in [('field-education','教育の検証記録'),('field-it','ITの検証記録')]:
  f.locator('#writer [data-compose]').click();f.locator('#postTitle').fill(title);f.locator('#postBody').fill('エミュレーターで保存してから、一覧を再表示して確認しました。検証用の記録です。');f.locator('#postFacets-field').select_option(field);f.locator('#postAIConsent').check();f.locator('#postVisibility').select_option('public')
  with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/posts') as saved:f.locator('#postForm button[type=submit]').click()
  assert saved.value.status==200;ids.append(saved.value.json()['id']);f.locator('#editorDialog').wait_for(state='hidden')
 f.locator('[data-view="research"]').click();f.locator('#researchFields input[value="field-education"]').check();f.locator('#researchFields input[value="field-it"]').check();f.locator('#aiRequestConsent').check()
 with g.expect_response(lambda r:'/ai/analyze' in r.url) as generated:f.locator('#analyzeSources').click()
 assert generated.value.status==200;assert set(s['id'] for s in generated.value.json()['sources'])==set(ids)
 f.locator('#aiResult blockquote').first.wait_for();assert f.locator('#aiResult').inner_text().count('未検証')>0
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/notes') as note:f.locator('#noteForm button[type=submit]').click()
 assert note.value.status==200;nid=note.value.json()['id']
 with g.expect_response(lambda r:'/ai/analyze' in r.url) as refresh:f.locator('#reanalyzeSources').click()
 assert refresh.value.status==200;assert refresh.value.json()['id']!=generated.value.json()['id']
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/notes') as revised:f.locator('#noteForm button[type=submit]').click()
 assert revised.value.status==200
 g.screenshot(path=str(OUT/'local-MOCK-gemini-citations.png'))
 f.locator('#detachAI').click();f.locator('#researchFields input[value="field-mind"]').check();f.locator('#noteResult').fill('模擬分析をもとに、人が検証用の結果を追記しました。')
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/notes') as manual:f.locator('#noteForm button[type=submit]').click()
 assert manual.value.status==200
 f.locator('[data-view="mine"]').click();f.locator('[data-mine="notes"]').click();f.locator('[data-note="'+nid+'"]').click();f.locator('#noteHistory').click();f.locator('#historyRows .card').first.wait_for();f.locator('#historyRows .card').first.locator('summary').first.click();f.locator('#historyRows .card').first.locator('summary').filter(has_text='AIの生成時の記録').first.click();assert 'AI' in f.locator('#detailBody').inner_text()
 g.screenshot(path=str(OUT/'local-MOCK-gemini-history.png'));f.locator('#detailDialog [data-close]').click()
 results.append({'scenario':'Owner model controls / author consent / automatic source retrieval / cited AI rendering / save / immutable reanalysis / manual continuation / history','result':'PASS','provider':'MOCK'})
 f=lab('owner','admin')
 with g.expect_response(lambda r:'/admin/semantic-index' in r.url) as indexed:f.locator('#semanticIndex').click()
 assert indexed.value.status==200
 f=lab('bob','library');f.locator('#searchMode').select_option('semantic');f.locator('#query').fill('教育の現場を比較したい');f.locator('#semanticConsent').check()
 with g.expect_response(lambda r:'/search?' in r.url and 'mode=semantic' in r.url) as found:f.locator('#searchForm button[type=submit]').click()
 assert found.value.status==200;assert found.value.json()['items'];f.locator('#results .card').first.wait_for()
 assert '意味の近さ' in f.locator('#results').inner_text();g.screenshot(path=str(OUT/'local-MOCK-semantic.png'))
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900 if width>=768 else 844});assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  f.locator('[data-view="research"]').click();assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1');g.screenshot(path=str(OUT/f'local-MOCK-{width}-ai-research.png'))
  results.append({'width':width,'result':'PASS','provider':'MOCK','horizontalOverflow':False})
 assert not errors,errors
 (OUT/'results.json').write_text(json.dumps({'environment':'local native Auth/Firestore emulators','provider':'MOCK, not actual Gemini success or meaning quality','productionWrites':False,'pageErrors':errors,'results':results},ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2));b.close()
