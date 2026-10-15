"""Actual emulator auth/consent/save; Gemini provider is MOCK, no real AI proof."""
import json,pathlib,urllib.parse,urllib.request
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-analysis-feedback');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4204'
def calls():
 with urllib.request.urlopen(BASE+'/test/provider-count') as r:return json.load(r)['generationCalls']
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':390,'height':900})
 c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
 g=c.new_page();errors=[];g.on('pageerror',lambda e:errors.append(str(e)))
 g.goto(BASE+'/test/lab-shell.html');g.locator('#role').select_option('bob')
 with g.expect_response(lambda r:urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/me'):g.locator('#signin').click()
 f=g.frame_locator('#lab');f.locator('html[data-lab-ready="true"]').wait_for()
 for pid in ['feedback-education','feedback-it','feedback-unconsented']:
  f.locator('#results [data-source="'+pid+'"]').click()
 f.locator('[data-view="research"]').click()
 for field in ['field-education','field-it']:f.locator('#researchFields input[value="'+field+'"]').check()
 assert 'AI利用同意なし' in f.locator('#selectedSources .source').filter(has_text='LOCAL：AI利用に未同意の知識').inner_text()
 with g.expect_response(lambda r:'/compare' in r.url) as comparison:f.locator('#compareSources').click()
 assert comparison.value.status==200
 assert '文章の意味をAIで分析した結果ではありません' in f.locator('#comparison').inner_text()
 assert all(f.locator('#'+id).input_value()=='' for id in ['noteQuestion','noteHypothesis','notePlan'])
 f.locator('#aiRequestConsent').check()
 with g.expect_response(lambda r:'/ai/analyze' in r.url) as denied:f.locator('#analyzeSources').click()
 assert denied.value.status==403 and denied.value.json()['error']=='AI_SOURCE_CONSENT_REQUIRED'
 f.locator('#aiAnalysisFeedback.error').wait_for()
 assert 'LOCAL：AI利用に未同意の知識' in f.locator('#aiAnalysisFeedback').inner_text()
 assert '③には今回の分析結果を入力していません' in f.locator('#aiAnalysisFeedback').inner_text()
 assert all(f.locator('#'+id).input_value()=='' for id in ['noteQuestion','noteHypothesis','notePlan'])
 assert calls()==0
 for id in ['noteQuestion','noteHypothesis','notePlan']:f.locator('#'+id).fill('人が書いた内容を保持：'+id)
 with g.expect_response(lambda r:'/ai/analyze' in r.url):f.locator('#analyzeSources').click()
 f.locator('#aiAnalysisFeedback.error').wait_for()
 assert all(f.locator('#'+id).input_value()=='人が書いた内容を保持：'+id for id in ['noteQuestion','noteHypothesis','notePlan'])
 assert calls()==0
 g.screenshot(path=str(OUT/'LOCAL-no-consent-403.png'))
 # Explicit author opt-in through the existing form, not an automatic data change.
 f.locator('[data-review-source="feedback-unconsented"]').click();f.locator('#detailDialog').wait_for(state='visible')
 assert 'AI利用同意なし' in f.locator('#detailBody').inner_text()
 f.locator('#editKnowledge').click();f.locator('#editorDialog').wait_for(state='visible')
 f.locator('#postAIConsent').check()
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/posts') as opted:f.locator('#postForm button[type=submit]').click()
 assert opted.value.status==200;f.locator('#editorDialog').wait_for(state='hidden')
 assert 'AI利用同意なし' not in f.locator('#selectedSources .source').filter(has_text='LOCAL：AI利用に未同意の知識').inner_text()
 # Hold the actual local request to test progress and repeated click protection.
 held=[];g.route('**/api/knowledge-lab/ai/analyze',lambda r:held.append(r))
 g.route('**/api/knowledge-lab/ai/status',lambda r:r.fulfill(status=503,content_type='application/json',body='{"error":"SERVICE_UNAVAILABLE"}'))
 f.locator('#analyzeSources').click()
 assert f.locator('#analyzeSources').is_disabled() and f.locator('#reanalyzeSources').is_disabled()
 assert '分析しています' in f.locator('#aiAnalysisFeedback').inner_text()
 f.locator('#reanalyzeSources').dispatch_event('click');assert len(held)==1
 with g.expect_response(lambda r:'/ai/analyze' in r.url) as analyzed:
  route=held.pop();route.fulfill(response=route.fetch())
 assert analyzed.value.status==200
 f.locator('#aiAnalysisFeedback').filter(has_text='分析が完了しました').wait_for()
 assert calls()==1
 assert f.locator('#aiResult blockquote').count()>0
 for id in ['noteQuestion','noteHypothesis','notePlan']:
  value=f.locator('#'+id).input_value();assert value and not value.startswith('人が書いた内容')
 assert '分析時にAI利用同意を確認済み' in f.locator('#selectedSources').inner_text()
 for width in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':width,'height':900});f.locator('#aiAnalysisFeedback').scroll_into_view_if_needed()
  assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  g.screenshot(path=str(OUT/f'LOCAL-MOCK-analysis-feedback-{width}.png'))
 f.locator('#noteVisibility').select_option('private')
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/notes') as saved:f.locator('#noteForm button[type=submit]').click()
 assert saved.value.status==200
 f.locator('#newNote').click();assert f.locator('#aiAnalysisFeedback').is_hidden()
 assert not errors,errors
 result={'environment':'isolated LOCAL Auth 9299 / Firestore namespace','provider':'MOCK, not live Gemini or Production proof','productionWrites':False,'consentDenied403BeforeGeneration':True,'manualComparisonDoesNotAutofill':True,'failureKeepsBlankOrHumanInput':True,'authorExplicitOptInRefreshesSelectedState':True,'busyProgressAndDuplicateRequestGuard':True,'successfulMockAutofillsAndSaves':True,'statusRefreshFailureDoesNotMaskSuccess':True,'modelGenerationCalls':calls(),'widths':[375,390,412,768,1024,1366],'pageErrors':errors}
 (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2));b.close()
