"""Real local app + Auth/Firestore. No Stripe checkout or external AI calls."""
import json,pathlib,urllib.parse
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:4207'; OUT=pathlib.Path('/workspace/outputs/membership-capabilities'); OUT.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']); c=b.new_context(viewport={'width':1366,'height':950})
 c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-home','emu-feed','emu-requests','emu-share','emu-discussion','emu-lab-welcome','emu-lab-mine','emu-lab-research'].map(x=>[x,'skipped']))))")
 def isolate(r):
  u=urllib.parse.urlparse(r.request.url)
  if u.hostname in ['127.0.0.1','localhost'] or r.request.resource_type in ['script','stylesheet','font','image'] and u.hostname in ['cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com']:r.continue_()
  else:r.abort()
 c.route('**/*',isolate); g=c.new_page(); errors=[]; g.on('pageerror',lambda e:errors.append(str(e)))
 g.goto(BASE+'/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof window.__localEmulatorLogin==="function"')
 with g.expect_response(lambda r:'/api/auth/account' in r.url and r.status==200):g.locator('#localEmulatorLogin').click()
 g.evaluate('window.__localLoginResult');g.wait_for_function('window._chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
 g.evaluate("openEmuKnowledgeLab('research')");f=g.frame_locator('#spRoomFrame');f.locator('html[data-lab-ready="true"]').wait_for(timeout=30000)
 if f.locator('#rk-tour .rk-close').is_visible():f.locator('#rk-tour .rk-close').click()
 f.locator('#noteTitle').fill('LOCAL ONLY: プラン画面から戻っても入力保持');g.evaluate('chesLandAfterLogin()');assert f.locator('#noteTitle').input_value()=='LOCAL ONLY: プラン画面から戻っても入力保持'
 f.locator('[data-view="mine"]').click();f.locator('#storageUsage').get_by_text('現在のプラン：plus').wait_for();assert '1000件' in f.locator('#storageUsage').inner_text()
 f.locator('#membershipPlan').click();g.locator('#chesLegalModal').wait_for(state='visible');m=g.frame_locator('#chesLegalFrame');m.locator('#main').wait_for(state='visible',timeout=30000);m.locator('[data-membership-features][data-loaded=true]').wait_for()
 assert 'plus' in m.locator('#entitlementNotice').inner_text();assert m.locator('#sec-features').is_visible()
 g.evaluate('closeLegal()');f.locator('[data-view="research"]').click();assert f.locator('#noteTitle').input_value()=='LOCAL ONLY: プラン画面から戻っても入力保持'
 results=[];v=c.new_page();v.on('pageerror',lambda e:errors.append(str(e)))
 for w in [375,390,412,768,1024,1366]:
  v.set_viewport_size({'width':w,'height':950});v.goto(BASE+'/membership-plans.html',wait_until='domcontentloaded');v.locator('[data-membership-features][data-loaded=true]').wait_for();assert v.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1')
  assert v.locator('[data-plan-card]').count()==4;v.locator('[data-membership-features] summary').click();assert v.locator('table th').count()>4;assert '11月1日から10件' in v.locator('table').inner_text();v.locator('[data-membership-features] summary').click();assert v.locator('a[href*="plan=light"]').count()==1
  v.screenshot(path=str(OUT/f'LOCAL-plans-{w}.png'),full_page=True)
  v.goto(BASE+'/membership.html?plan=light#plan',wait_until='domcontentloaded');v.locator('#main').wait_for(state='visible');v.locator('[data-membership-features][data-loaded=true]').wait_for();assert v.locator('html').evaluate('e=>e.scrollWidth<=innerWidth+1');v.screenshot(path=str(OUT/f'LOCAL-membership-{w}.png'),full_page=True)
  results.append({'width':w,'comparison':True,'authenticatedMembership':True,'overflow':False})
 assert not errors,errors
 (OUT/'browser-results.json').write_text(json.dumps({'environment':'LOCAL actual app/Auth/Firestore; no Stripe/AI calls','labInputPreservedAcrossMembershipOverlay':True,'errors':errors,'results':results},ensure_ascii=False,indent=2));print(json.dumps(results));b.close()
