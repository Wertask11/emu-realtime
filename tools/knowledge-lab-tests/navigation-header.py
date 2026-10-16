import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/workspace/outputs/knowledge-lab-navigation')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':1366,'height':950})
 c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-home','emu-feed','emu-requests','emu-share','emu-discussion'].map(x=>[x,'skipped']))))")
 def isolate(r):
  u=urllib.parse.urlparse(r.request.url)
  if u.hostname in ['127.0.0.1','localhost'] or r.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:r.continue_()
  else:r.abort()
 c.route('**/*',isolate);g=c.new_page();errors=[];g.on('pageerror',lambda e:errors.append(str(e)));g.goto('http://127.0.0.1:4206/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof window.__localEmulatorLogin==="function"')
 with g.expect_response(lambda r:'/api/auth/account' in r.url and r.status==200):g.locator('#localEmulatorLogin').click()
 g.evaluate('window.__localLoginResult');g.wait_for_function('window._chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.evaluate('showEmuFeed()')
 g.locator('#emuHeaderProfile').click();assert g.locator('#emuAccountMenu.open').is_visible();assert g.locator('#emuAccountMenu').get_by_role('menuitem',name='プラン・お支払い').is_visible();g.evaluate('closeAccountMenu()')
 g.locator('#emuHeaderProfile').click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='設定',exact=True).click();g.locator('#spSettingsPanel.open').wait_for();g.evaluate('closeSettingsSheet()')
 g.locator('#emuHeaderReizo').click();g.locator('#rk-tour .rk-panel:not([hidden])').wait_for();g.locator('#rk-tour .rk-close').click()
 dimensions=[]
 for w in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':w,'height':950})
  for id in ['emuHeaderProfile','emuHeaderReizo']:
   box=g.locator('#'+id).bounding_box();assert box and box['width']==44 and box['height']==44,(w,id,box)
  assert g.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  dimensions.append({'width':w,'emuHeaderHeight':g.locator('#mainApp > .header').bounding_box()['height']});g.screenshot(path=str(OUT/f'LOCAL-Emu-header-{w}.png'))
 g.evaluate('openSpDao()');d=g.frame_locator('#spDaoFrame');d.locator('[data-sp-head]').wait_for()
 for w in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':w,'height':950})
  snapshot=d.locator('html').evaluate("""async root=>{for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const h=document.querySelector('[data-sp-head]');const bs=[...document.querySelectorAll('[data-sp-head] .service-tool')].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height}));if(h?.offsetHeight && bs.length===2 && bs.every(b=>b.width===44&&b.height===44))return {height:h.getBoundingClientRect().height,overflow:root.scrollWidth>innerWidth+1};}throw Error('HEADER_NOT_READY')}""")
  assert not snapshot['overflow'];dimensions[[x['width'] for x in dimensions].index(w)]['schoolParkHeaderHeight']=snapshot['height'];g.screenshot(path=str(OUT/f'LOCAL-SchoolPark-header-{w}.png'))
 d.locator('[data-sp-head]').get_by_role('button',name='プロフィール',exact=True).click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='SchoolParkパスポート').click();g.locator('#spPassport').wait_for(state='visible');g.evaluate('closeSpPassport()')
 d.locator('[data-sp-head]').get_by_role('button',name='プロフィール',exact=True).click();g.locator('#emuAccountMenu').get_by_role('menuitem',name='設定',exact=True).click();g.locator('#spSettingsPanel').wait_for(state='visible');g.evaluate("closeSpPanel('spSettingsPanel')")
 d.locator('[data-sp-head]').get_by_role('button',name='冷蔵庫くんに聞く・使い方案内').click();g.locator('#rk-tour .rk-panel:not([hidden])').wait_for();g.locator('#rk-tour .rk-close').click()
 g.evaluate('showEmuRequests();openEmuKnowledgeLab()');f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for()
 f.locator('#rk-tour .rk-panel:not([hidden])').wait_for();assert 'まずは、経験を探してみよう' in f.locator('#rk-tour-title').inner_text()
 f.locator('#rk-tour .rk-skip').click() if f.locator('#rk-tour .rk-skip').count() else f.locator('#rk-tour').get_by_role('button',name='今回はスキップ',exact=True).click()
 assert not f.locator('#searchClassifications').evaluate('e=>e.open')
 assert f.locator('#adminTab').is_hidden()
 f.locator('#searchClassifications > summary').click();f.locator('#searchFacets-field input[value="field-education"]').check();f.locator('#searchFacets-field input[value="field-life"]').check()
 assert f.locator('#searchFacets-field input:checked').count()==2
 f.locator('#library [data-compose]').click();f.locator('#editorDialog').wait_for(state='visible');assert not f.locator('#postClassifications').evaluate('e=>e.open');f.locator('#postTitle').fill('LOCAL UIの下書き確認');f.locator('#postBody').fill('これはエミュレーター専用の下書きです。実際の投稿や本番データではありません。')
 with g.expect_response(lambda r:r.request.method=='PUT' and urllib.parse.urlparse(r.url).path=='/api/knowledge-lab/posts') as saved:f.locator('#postForm button[type=submit]').click()
 assert saved.value.status==200;f.locator('#editorDialog').wait_for(state='hidden')
 f.locator('[data-view="requests"]').click();assert '同じデータ' in f.locator('#requests').inner_text();f.locator('#searchExistingKnowledge').click();assert f.locator('#library').is_visible()
 f.locator('[data-view="research"]').click();f.locator('#guide').click();f.locator('#rk-tour .rk-panel:not([hidden])').wait_for();assert '組み合わせたい分野' in f.locator('#rk-tour-title').inner_text();f.locator('#rk-tour .rk-close').click();assert f.locator('#research').is_visible()
 f.locator('[data-view="library"]').click()
 with c.expect_page() as guide:f.locator('a[href="/knowledge-lab-guide.html"]').click()
 page=guide.value;page.wait_for_load_state('domcontentloaded');assert page.get_by_role('link',name='← Knowledge Labに戻る').get_attribute('href')=='/?lab=library';assert page.get_by_role('link',name='← Emuに戻る').get_attribute('href')=='/'
 for w in [375,390,412,768,1024,1366]:
  g.set_viewport_size({'width':w,'height':950});page.set_viewport_size({'width':w,'height':950});assert f.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1');assert page.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1');g.screenshot(path=str(OUT/f'LOCAL-Lab-navigation-{w}.png'));page.screenshot(path=str(OUT/f'LOCAL-guide-navigation-{w}.png'))
 assert all(x['emuHeaderHeight']==x['schoolParkHeaderHeight']==(68 if x['width']<=700 else 88) for x in dimensions),dimensions
 page.close();f.locator('#backToEmu').click();g.locator('#spRoomPage').wait_for(state='hidden');assert g.locator('#emuRequestsPage').is_visible()
 assert not errors,errors
 result={'result':'PASS','environment':'LOCAL native app + real emulator Auth/Firestore','productionWrites':False,'commonHeaderControls44px':True,'profileFridgeSettingsActualActions':True,'fourTabNavigationPreserved':True,'labNewTutorialAutoAndResearchReplay':True,'optionalClassificationDisclosure':True,'multiSelect':True,'minimalDraftSaved':True,'requestMeaningAndLibraryReturn':True,'guideNewTabAndExplicitReturnLinks':True,'labReturnPreservesShellLogin':True,'ownerTabHiddenForNonOwner':True,'dimensions':dimensions,'pageErrors':errors}
 (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
