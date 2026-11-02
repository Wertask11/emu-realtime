"""Read/post/search and shared account/guide compatibility using actual local SDK/API routes."""
from playwright.sync_api import sync_playwright
import json,pathlib,urllib.parse,os,time
BASE=os.environ.get('UNIFIED_BASE','http://127.0.0.1:4220');OUT=pathlib.Path(os.environ.get('UNIFIED_OUTPUT','/workspace/outputs/unified-emu-20261102'));results=[];errors=[];dialogs=[]
assert urllib.parse.urlparse(BASE).hostname in ['127.0.0.1','localhost'], 'Local emulator only'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':1280,'height':950})
 c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-guilds','sp-quests','sp-wisdom','sp-city','sp-passport','emu-feed','emu-requests','emu-practice'].map(k=>[k,'done']))))")
 c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
 g=c.new_page();g.set_default_timeout(20000);g.on('pageerror',lambda e:errors.append(str(e)));g.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
 try:
  g.goto(BASE+'/test/native.html');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult');g.wait_for_function('_chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.locator('#localEmulatorLogin').evaluate('e=>e.remove()')
  g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い',exact=True).click();m=g.frame_locator('#chesLegalFrame');m.locator('#main').wait_for(state='visible');assert 'plus' in m.locator('#entitlementNotice').inner_text();g.screenshot(path=str(OUT/'COMPAT-plan.png'));g.evaluate('closeLegal()');results.append({'plan':'shared authenticated billing status plus; no checkout executed'})
  g.locator('#esnPractice').click();ids=g.evaluate('ReizoTour.list().map(x=>x.id)');assert 'emu-practice' in ids
  for retired in ['sp-home','sp-park','sp-plaza','sp-contribution','sp-treasury','emu-share','emu-discussion']:assert retired not in ids
  assert g.evaluate('ReizoTour.restart("emu-practice")');g.locator('#rk-tour-title').get_by_text('知識を試す',exact=True).wait_for();g.screenshot(path=str(OUT/'COMPAT-new-guide.png'));g.evaluate('ReizoTour.later()');results.append({'tour':'new practice guide opens; retired guide registrations absent; saved progress retained until explicit restart'})
  g.locator('#esnFeed').click();g.evaluate('openPostForm()');g.locator('#postFormModal').wait_for(state='visible');title='LOCAL 統合導線の投稿検証 '+str(int(time.time()));g.locator('#postTitle').fill(title);g.locator('#postBody').fill('LOCAL 隔離エミュレーターの検証投稿です。知識を読んでから、新しい導線で投稿を保存できることを確かめます。');g.locator('#postTags').fill('経験');g.locator('#postForm button[type=submit]').click();g.locator('#postFormModal').wait_for(state='hidden',timeout=30000)
  assert g.evaluate('(async(title)=>{const s=await fbLib.getDocs(fbLib.query(fbLib.collection(db,"posts"),fbLib.where("title","==",title)));return s.docs.some(d=>d.data().body.includes("LOCAL"))})',title)
  g.evaluate('window.closeSakuraModal?.()');results.append({'post':'original production form published to actual local Firestore; no schema or quota logic replaced'})
  g.locator('#esnRequests').click();g.locator('#emuRequestsPage [data-tour="emu-lab-entry"] button').click();lab=g.frame_locator('#spRoomFrame');lab.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
  # Use the real Lab keyword-search form. No Google/Gemini request in this fixture.
  fields=lab.locator('#searchForm input');assert fields.count()>0
  fields.first.fill('LOCAL')
  with g.expect_response(lambda r:'/api/knowledge-lab/search' in r.url) as searched:lab.locator('#searchForm button[type=submit]').click()
  assert searched.value.status==200;g.screenshot(path=str(OUT/'COMPAT-lab-search.png'));g.evaluate('closeSpRoom()');results.append({'lab':'keyword search succeeded through unchanged API; no generated content or external AI request'})
  assert not errors,errors
  print(json.dumps(results,ensure_ascii=False,indent=2),flush=True)
 except Exception:
  g.screenshot(path=str(OUT/'COMPAT-FAIL.png'));print('DIAGNOSTIC',errors,dialogs,flush=True);raise
 finally:
  (OUT/'compatibility-results.json').write_text(json.dumps({'results':results,'page_errors':errors,'dialogs':dialogs,'production_writes':False},ensure_ascii=False,indent=2));b.close()
