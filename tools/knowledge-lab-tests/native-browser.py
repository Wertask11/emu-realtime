from facet_controls import select_facets
import json,pathlib,urllib.parse,os
from playwright.sync_api import sync_playwright
OUT=pathlib.Path(os.environ.get('LAB_TEST_OUTPUT','/workspace/outputs/knowledge-lab-native'));OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':1366,'height':900});g=c.new_page();errors=[];blocked=[]
 g.on('pageerror',lambda e:errors.append(e.stack))
 def isolate(route):
  u=urllib.parse.urlparse(route.request.url)
  if u.hostname in ['127.0.0.1','localhost'] or route.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:
   route.continue_()
  else:
   blocked.append({'host':u.hostname,'path':u.path,'type':route.request.resource_type});route.abort()
 c.route('**/*',isolate)
 g.goto('http://127.0.0.1:4201/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof window.__localEmulatorLogin==="function" && typeof window.__localEmulatorComplete==="function"',timeout=30000)
 with g.expect_response(lambda r:'/api/auth/account' in r.url and r.status==200):g.locator('#localEmulatorLogin').click()
 g.evaluate('window.__localLoginResult')
 g.wait_for_function('window.auth?.currentUser?.uid === "lab-alice" && window._chesEntered === true',timeout=40000)
 g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
 g.evaluate('showEmuRequests()');g.locator('[data-tour="emu-lab-entry"] button').click();f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
 guide=f.locator('#rk-tour .rk-close')
 g.screenshot(path=str(OUT/'before-guide.png'))
 print(json.dumps({'cover':g.locator('#spLoadingOverlay').is_visible(),'classes':g.locator('html').get_attribute('class'),'bodyClass':g.locator('body').get_attribute('class')},ensure_ascii=False),flush=True)
 if guide.count() and guide.is_visible():guide.click()
 f.locator('#library [data-compose]').click();f.locator('#postTitle').fill('ネイティブ連携の検証投稿');f.locator('#postBody').fill('これは本番と分離したエミュレーター内の保存・連携検証用です。');select_facets(f, '#postFacets-field', 'field-education');f.locator('#postVisibility').select_option('public');f.locator('#postForm button[type=submit]').click();f.locator('#editorDialog').wait_for(state='hidden');f.locator('#results .card').filter(has_text='ネイティブ連携').locator('[data-post]').click();f.locator('#discussKnowledge').click()
 g.locator('#emuDiscussionFrame').wait_for(state='visible');discussion=g.frame_locator('#emuDiscussionFrame');discussion.locator('#ownTopic').wait_for();g.wait_for_function('document.getElementById("emuDiscussionFrame").contentDocument?.getElementById("ownTopic")?.value.includes("ネイティブ連携")',timeout=10000)
 g.screenshot(path=str(OUT/'discussion-prefill.png'))
 g.evaluate('openEmuKnowledgeLab("writer")');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for();f.locator('#passportLink').click();g.locator('#spPassport').wait_for(state='visible');g.screenshot(path=str(OUT/'passport.png'))
 g.evaluate('closeSpPassport();openEmuKnowledgeLab("mine")');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for();f.locator('#legacyLibrary').click();g.locator('#emuKnowledgeFrame').wait_for(state='visible');knowledge=g.frame_locator('#emuKnowledgeFrame');knowledge.locator('#panel.open').wait_for(timeout=15000)
 # A different real emulator user uses the unchanged native Good/Change UI.
 g.evaluate('window.__localEmulatorLogin("bob")');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.evaluate('showEmuRequests();openEmuKnowledgeLab()');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for();guide=f.locator('#rk-tour .rk-close')
 if guide.count() and guide.is_visible():guide.click()
 f.locator('#results .card').filter(has_text='ネイティブ連携').locator('[data-post]').click();f.locator('#goodKnowledge').click();g.locator('#emuGoodSheet.open').wait_for();g.locator('#emuGoodChoices button').first.click();g.locator('#emuGoodSubmit').click();g.locator('#emuGoodSheet').wait_for(state='hidden',timeout=15000)
 g.evaluate('openEmuKnowledgeLab()');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for();f.locator('#results .card').filter(has_text='ネイティブ連携').locator('[data-post]').click();f.locator('#changeKnowledge').click();g.locator('#emuChangeSheet.open').wait_for();g.locator('#emuChangeTarget').fill('経験の条件');g.locator('#emuChangeReason').fill('使える条件をより具体的に知りたいです。');g.locator('#emuChangeProposal').fill('試した環境と注意点も追加すると分かりやすいです。');g.locator('#emuChangeSubmit').click();g.locator('#emuChangeSheet').wait_for(state='hidden',timeout=15000)
 # No fabricated user data or token was used: the actual SDK state remains the local user.
 assert g.evaluate('auth.currentUser.uid')=='lab-bob'
 g.screenshot(path=str(OUT/'legacy-library.png'));result={'auth':'real local Firebase SDK + existing completeCommonFlow','labEntry':True,'save':True,'discussionPrefill':True,'passport':True,'legacyLibrary':True,'nativeGood':True,'nativeChange':True,'pageErrors':errors,'blockedExternalRequests':blocked}
 OUT.joinpath('results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2));b.close()
