"""Real native UI + Firebase Auth/Firestore emulators. Never production writes."""
from facet_controls import select_facets
import json,pathlib,urllib.parse,os
from playwright.sync_api import sync_playwright
OUT=pathlib.Path(os.environ.get('LAB_TEST_OUTPUT','/workspace/outputs/knowledge-lab-release'));OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4201';results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':844});g=c.new_page();errors=[]
 g.on('pageerror',lambda e:errors.append(str(e)));g.on('dialog',lambda d:d.accept())
 trace=[]
 def trace_response(r):
  if '/api/knowledge-lab/' not in r.url:return
  record={'path':urllib.parse.urlparse(r.url).path,'status':r.status,'method':r.request.method}
  if '/admin/list/' in r.url and r.status==200:
   try:record['ids']=[i['id'] for i in r.json().get('items',[])]
   except Exception:pass
  trace.append(record);(OUT/'release-browser-http.json').write_text(json.dumps(trace,ensure_ascii=False,indent=2))
 g.on('response',trace_response)
 def isolate(route):
  u=urllib.parse.urlparse(route.request.url)
  if u.hostname in ['127.0.0.1','localhost'] or route.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:route.continue_()
  else:route.abort()
 c.route('**/*',isolate)
 g.goto(BASE+'/knowledge-lab-writers.html',wait_until='domcontentloaded');g.locator('#participate').click();g.wait_for_function('typeof window.__localEmulatorLogin==="function" && typeof window.__localEmulatorComplete==="function"')
 def login(role):
  g.evaluate('async role=>{if(window.auth?.currentUser) await auth.signOut();await window.__localEmulatorLogin(role)}',role)
  g.wait_for_function('(uid)=>window.auth?.currentUser?.uid===uid && window._chesEntered===true',arg='lab-'+role)
  g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
 def lab(view='library'):
  g.evaluate('v=>openEmuKnowledgeLab(v)',view);f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
  guide=f.locator('#rk-tour .rk-close')
  if guide.count() and guide.is_visible():guide.click()
  return f
 def view(f,name):f.locator('[data-view="'+name+'"]').click();f.locator('#'+name).wait_for(state='visible')
 def save_note(f):
  with g.expect_response(lambda r:r.url.endswith('/api/knowledge-lab/notes') and r.request.method=='PUT') as resp:f.locator('#noteForm button[type=submit]').click()
  assert resp.value.status==200,resp.value.text();return resp.value.json()
 login('alice');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000);f.locator('#writer').wait_for(state='visible');f.locator('#writerName').fill('最終検証用の書き手');f.locator('#writerBio').fill('エミュレーター内だけでプロフィールを保存します。');select_facets(f, '#writerFacets-field', ['field-education']);f.locator('#writerPublished').check();f.locator('#writerConsent').check();f.locator('#writerForm button[type=submit]').click();f.locator('#writers h3').filter(has_text='最終検証用の書き手').wait_for()
 f.locator('#writer [data-compose]').click();f.locator('#postTitle').fill('最終検証の教育経験');f.locator('#postBody').fill('小さく試してから条件を記録した経験です。検証環境だけのデータです。');select_facets(f, '#postFacets-field', 'field-education');f.locator('#postVisibility').select_option('public');f.locator('#postForm button[type=submit]').click();f.locator('#editorDialog').wait_for(state='hidden')
 view(f,'requests');f.locator('#requestQuestion').fill('最終検証：経験の条件を知りたい');f.locator('#requestContext').fill('エミュレーター内だけの募集です。');select_facets(f, '#requestFacets-field', 'field-it');f.locator('#requestForm button[type=submit]').click();f.locator('#requestItems h3').filter(has_text='最終検証：').wait_for()
 login('bob');f=lab('requests');row=f.locator('#requestItems .card').filter(has_text='最終検証：');row.locator('[data-answer]').click();g.locator('#emuAnswerSheet.open').wait_for();g.locator('#emuAnswerExperience').fill('小さな自動化を先に試した経験があります。');g.locator('#emuAnswerKnowledge').fill('条件を記録してから比較することを学びました。');g.locator('#emuAnswerLimits').fill('条件は環境によって変わります。');g.locator('#emuAnswerSubmit').click();g.locator('#emuAnswerSheet').wait_for(state='hidden',timeout=15000)
 f=lab('requests');f.locator('#requestItems .card').filter(has_text='最終検証：').locator('[data-lab-answers]').click();f.locator('[data-publish-answer]').click();f.locator('#editorDialog').wait_for(state='visible');assert '条件を記録' in f.locator('#postBody').input_value();f.locator('#postTitle').fill('最終検証：回答を経験知へ');select_facets(f, '#postFacets-field', 'field-it');select_facets(f, '#postFacets-industry', 'industry-information');select_facets(f, '#postFacets-occupation', 'occupation-engineer');f.locator('#postVisibility').select_option('public');f.locator('#answerPublicationConsent').check()
 with g.expect_response(lambda r:r.url.endswith('/api/knowledge-lab/posts') and r.request.method=='PUT') as resp:f.locator('#postForm button[type=submit]').click()
 assert resp.value.status==200,resp.value.text();converted=resp.value.json()['id'];f.locator('#editorDialog').wait_for(state='hidden');view(f,'library');f.locator('#query').fill('回答を経験知へ');select_facets(f, '#searchFacets-field', 'field-it');select_facets(f, '#searchFacets-industry', 'industry-information');select_facets(f, '#searchFacets-occupation', 'occupation-engineer');f.locator('#searchForm button[type=submit]').click();f.locator('#results [data-post]').first.click();f.locator('#detailBody').get_by_text('元募集',exact=False).wait_for();f.locator('#saveKnowledge').click();f.locator('#reportReason').fill('最終検証の通報です。本番の問題報告ではありません。');f.locator('#reportKnowledge').click();f.locator('#detailDialog').wait_for(state='hidden');g.screenshot(path=str(OUT/'local-390-answer-conversion.png'))
 f.locator('#resetFilters').click();f.locator('#results [data-source]').nth(0).click();f.locator('#results [data-source]').nth(1).click();view(f,'research');f.locator('#researchFields input[value="field-education"]').check();f.locator('#researchFields input[value="field-it"]').check();f.locator('#researchFind button').click();f.locator('#researchCandidates .card').first.wait_for();f.locator('#researchFields input[value="field-business"]').check();f.locator('#researchFind button').click();f.locator('#compareSources').click();f.locator('#comparison').wait_for(state='visible');f.locator('#noteTitle').fill('最終検証：履歴と保管復元');f.locator('#noteQuestion').fill('条件の違いをどのように確かめる？');f.locator('#noteHypothesis').fill('初期の非公開仮説');f.locator('#notePlan').fill('小さく試し、元の知識と区別して記録する。');f.locator('#noteVisibility').select_option('private');saved=save_note(f);note=saved['id']
 for i in range(3):f.locator('#noteResult').fill('UIで記録した結果'+str(i));save_note(f)
 view(f,'mine');f.locator('[data-mine="notes"]').click();f.locator('[data-note="'+note+'"]').click();f.locator('#noteHistory').click();f.locator('#historyRows .card').nth(2).wait_for();assert f.locator('#historyRows .card').count()==3;g.screenshot(path=str(OUT/'local-390-note-history.png'));f.locator('#historyBack').click();f.locator('#archiveNote').click();f.locator('#detailDialog').wait_for(state='hidden')
 login('bob');f=lab('mine');f.locator('[data-mine="archived-notes"]').click();f.locator('[data-note="'+note+'"]').click();f.locator('#detailBody').get_by_text('保管済み',exact=False).wait_for();f.locator('#noteHistory').click();f.locator('#historyRows .card').nth(3).wait_for();assert f.locator('#historyRows .card').count()==4;f.locator('#historyBack').click();g.screenshot(path=str(OUT/'local-390-archived-note.png'));f.locator('#restoreNote').click();f.locator('#continueNote').click();f.locator('#noteResult').fill('復元してからUIで編集・保存した結果');save_note(f)
 results.append({'scenario':'native writer/request/answer/conversion/filter/bookmark/report/2+3-fields/research/3-updates/history/archive/relogin/restore/edit','result':'PASS'})
 login('owner');f=lab('admin');f.locator('#adminSummary .metrics').wait_for()
 for kind in ['writers','posts','notes','requests','reports']:f.locator('[data-admin-list="'+kind+'"]').click();f.locator('#adminItems .card').first.wait_for()
 f.locator('#adminItems [data-report-note]').first.fill('検証用通報への対応を保存します。');f.locator('#adminItems [data-resolve]').first.click()
 f.locator('#termId').fill('genre-release-ui');f.locator('#termAxis').select_option('genre');f.locator('#termLabel').fill('最終UI検証ジャンル');f.locator('#taxonomyForm button[type=submit]').click();f.locator('[data-term="genre-release-ui"]').wait_for()
 with g.expect_response(lambda r:'/api/knowledge-lab/admin/list/posts' in r.url) as listing:f.locator('[data-admin-list="posts"]').click()
 if listing.value.status==429:
  remaining=max(0,listing.value.json()['retryAfterMs'])+100
  while remaining>0:
   wait=min(remaining,30000);g.wait_for_timeout(wait);remaining-=wait
  with g.expect_response(lambda r:'/api/knowledge-lab/admin/list/posts' in r.url) as retry:f.locator('[data-admin-list="posts"]').click()
  assert retry.value.status==200
  results.append({'scenario':'existing 90/minute read limit and retryAfterMs cooldown','result':'PASS','initialStatus':429,'retryStatus':200})
 else:assert listing.value.status==200
 button=f.locator('[data-moderate="feature"][data-id="'+converted+'"]');f.locator('[data-moderation-reason="'+converted+'"]').fill('検証用の注目知識');button.click();f.locator('[data-moderate="unfeature"][data-id="'+converted+'"]').wait_for();f.locator('[data-moderation-reason="'+converted+'"]').fill("検証用の公開停止");f.locator('[data-moderate="hide"][data-id="'+converted+'"]').click();f.locator('[data-admin-list="private_posts"]').click();f.locator('[data-moderation-reason="'+converted+'"]').fill('検証後に元の公開状態へ戻す');f.locator('[data-moderate="restore"][data-id="'+converted+'"]').click();f.locator('#reviewRewards').click();g.screenshot(path=str(OUT/'local-390-owner.png'));results.append({'scenario':'Owner writers/posts/notes/requests/reports/taxonomy/feature/hide/restore/read-only-reward-review','result':'PASS'})
 assert not errors,errors
 results.append({'pageErrors':errors,'auth':'actual emulator SDK + existing native flow','productionWrites':False,'result':'PASS'})
 (OUT/'release-browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2));b.close()
