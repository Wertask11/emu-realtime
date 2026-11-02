"""Real native shell + emulator Auth/Firestore + existing APIs. Blocks all production traffic.
Start fixture.cjs and the Auth/Firestore emulators described in README.md first.
"""
from playwright.sync_api import sync_playwright
import json, os, pathlib, urllib.parse, urllib.request
BASE=os.environ.get('UNIFIED_BASE','http://127.0.0.1:4220')
assert urllib.parse.urlparse(BASE).hostname in ['127.0.0.1','localhost'], 'Local emulator only'
OUT=pathlib.Path(os.environ.get('UNIFIED_OUTPUT','/workspace/outputs/unified-emu-20261102'))
OUT.mkdir(parents=True,exist_ok=True)
WIDTHS=[375,390,412,768,1280,1440,1920]
RESULTS=[]
TOURS=['sp-guilds','sp-quests','sp-wisdom','sp-city','sp-passport','emu-feed','emu-requests','emu-practice','sp-guild','sp-quest-detail','sp-tasks','sp-year-goals']
def state():
 with urllib.request.urlopen(BASE+'/test/unified-state') as r:return json.load(r)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in WIDTHS:
  errors=[]; failed=[]
  c=b.new_context(viewport={'width':width,'height':950 if width>=768 else 844},has_touch=width<768)
  c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify("+json.dumps({x:'done' for x in TOURS})+"));")
  def isolate(r):
   if urllib.parse.urlparse(r.request.url).hostname in ['localhost','127.0.0.1']:r.continue_()
   else:r.abort()
  c.route('**/*',isolate)
  g=c.new_page();g.on('pageerror',lambda e:errors.append(str(e)));g.on('dialog',lambda d:d.accept())
  def response(r):
   if '/api/' in r.url and r.status>=400:failed.append({'path':urllib.parse.urlparse(r.url).path,'status':r.status})
  g.on('response',response)
  try:
   g.goto(BASE+'/test/native.html');g.wait_for_function('typeof window.__localEmulatorLogin==="function"')
   g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult');g.wait_for_function('window._chesEntered===true')
   g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.locator('#localEmulatorLogin').evaluate('e=>e.remove()')
   g.wait_for_function('typeof window.showEmuPractice==="function"');g.locator('#emuHeaderProfile').wait_for(state='visible');g.wait_for_timeout(300)
   nav='#emuBottomNav' if width<=700 else '#emuSideNav' if width>1024 else '.eth-tabs'
   assert g.locator(nav+' [data-unified-view]').count()==5
   def go(view):g.locator(nav+' [data-unified-view="'+view+'"]').click()
   def fits():
    assert g.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('parent overflow',width)
    f=g.locator('#spDaoFrame')
    if f.is_visible():
     assert f.evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}'),('workspace clipping',width)
     assert f.content_frame.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1'),('child overflow',width)
   go('read');g.locator('#emuKnowledgePage').wait_for(state='visible')
   feed=g.frame_locator('#emuKnowledgeFrame');feed.get_by_text('LOCAL 導線検証の知識',exact=True).first.wait_for(timeout=20000)
   go('search');g.locator('#emuRequestsPage').wait_for(state='visible');search=g.locator('#emuRequestsPage .emu-knowledge-pair').bounding_box();fits()
   assert g.locator('#emuRequestsPage .emu-knowledge-pair > .eth-card').count()==2
   assert g.locator('#emuRequestsPage').get_by_text('Knowledge Text',exact=False).count()>0
   go('practice');g.locator('#emuPracticePage').wait_for(state='visible');fits()
   pair=g.locator('#emuPracticePage .emu-knowledge-pair');assert pair.locator('> .eth-card').count()==2
   assert abs(pair.bounding_box()['width']-search['width'])<2
   cols=pair.evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length');assert cols==(1 if width<=700 else 2),(width,cols)
   assert g.locator('#emuPracticePage').get_by_role('button',name='ギルドの活動を見る →').is_visible()
   g.screenshot(path=str(OUT/f'AFTER-{width}-practice.png'))
   before=state()
   g.locator('#emuPracticePage').get_by_role('button',name='ギルドの活動を見る →').click()
   g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="logs"')
   f=g.frame_locator('#spDaoFrame');f.locator('[data-tour~=guild-list]').wait_for();fits()
   g.locator('#emuWorkspaceBack').click();g.locator('#emuPracticePage').get_by_role('button',name='クエストの内容を見る →').click()
   g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="experiments"')
   f.get_by_text('LOCAL 知識を試すクエスト',exact=False).first.wait_for();fits()
   g.screenshot(path=str(OUT/f'AFTER-{width}-quests.png'))
   go('wisdom');g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="library"')
   f.get_by_text('LOCAL 試した結果を、次の人が使える知恵として残す。',exact=True).wait_for();fits()
   assert f.get_by_text('引用',exact=False).count()>0
   # A long card exposes its existing detail toggle. Short cards are already fully expanded.
   detail=f.get_by_text('詳細を見る',exact=False)
   if detail.count() and detail.first.is_visible():detail.first.click()
   g.screenshot(path=str(OUT/f'AFTER-{width}-wisdom.png'))
   go('city');g.wait_for_function('document.getElementById("spDaoFrame").contentWindow.app?.tourRenderedScreen==="city"')
   f.locator('.city-play-card').nth(3).wait_for();fits();assert f.locator('.city-play-card').count()==4
   assert g.evaluate('document.getElementById("spDaoFrame").contentDocument.querySelectorAll(".bottom-nav,.sidebar").length')==0
   assert state()==before,'Viewing Guild/Quest/Wisdom/City must not join, commit, publish, cite or reward'
   g.screenshot(path=str(OUT/f'AFTER-{width}-city.png'))
   assert g.evaluate('auth.currentUser!==null')
   # The shared account/profile and fridge triggers remain available above the child workspace.
   assert g.locator('#emuHeaderProfile').is_visible();assert g.locator('#emuHeaderReizo').is_visible()
   g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu [data-help=contact]').click();g.locator('#emu-contact-panel').wait_for(state='visible');g.evaluate('toggleContactPanel()')
   assert g.locator('#emuIchinichiPage,#emuDiscussionPage').count()==0
   assert g.locator('[onclick*=showEmuIchinichi],[onclick*=showEmuDiscussion]').count()==0
   assert not errors,errors
   RESULTS.append({'width':width,'navigation':'5 real shell entries','read':'existing seeded post','search_cards':2,'practice_columns':cols,'guild_quest':'existing APIs; no joins','wisdom':'existing stored card/detail/citation entry','city_games':4,'viewing_writes':False,'page_errors':errors,'fixture_api_errors':failed})
   print('PASS',width,flush=True)
  except Exception:
   g.screenshot(path=str(OUT/f'FAIL-{width}.png'));print('DIAGNOSTIC',width,errors,failed,flush=True);raise
  finally:c.close()
 b.close()
(OUT/'browser-results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2))
