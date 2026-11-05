"""Actual app + existing Firebase auth middleware + isolated Auth/Firestore emulators.
All non-local requests are blocked. Never logs tokens, UID/SPID, credentials or keys.
"""
from playwright.sync_api import sync_playwright
import json,pathlib,urllib.parse,os,time
BASE='http://127.0.0.1:4240';OUT=pathlib.Path('/workspace/outputs/passport-v2-20261105');OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for index,width in enumerate(json.loads(os.environ.get('PASSPORT_WIDTHS','[375,390,412,768,1280,1440,1920]'))):
  if index and index%3==0:time.sleep(60)
  c=browser.new_context(viewport={'width':width,'height':950 if width>=768 else 844})
  c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-guilds','sp-quests','sp-wisdom','sp-city','sp-passport','emu-feed','emu-requests','emu-practice','sp-guild','sp-quest-detail','sp-tasks','sp-year-goals'].map(k=>[k,'done']))));")
  def isolated(r):
   u=urllib.parse.urlparse(r.request.url)
   if u.hostname not in ['localhost','127.0.0.1']:r.abort();return
   if u.path.startswith('/passport-v2/'):
    response=r.fetch();r.fulfill(response=response,headers={**response.headers,'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer','Cache-Control':'no-store'})
   else:r.continue_()
  c.route('**/*',isolated)
  g=c.new_page();errors=[];private_errors=[]
  g.on('pageerror',lambda e:errors.append(str(e)))
  g.on('response',lambda r:private_errors.append(r.status) if '/api/passport-v2/' in r.url and r.status>=400 else None)
  try:
   g.goto(BASE+'/test/native.html',wait_until='domcontentloaded');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult');g.wait_for_function('_chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
   g.locator('#localEmulatorLogin').evaluate('e=>e.remove()');g.evaluate('openSpPassport()');g.locator('#sppCertificatesEntry').wait_for(state='visible');g.locator('#sppCertificatesEntry button').click()
   frame=g.frame_locator('#passportV2Dialog iframe');frame.locator('#controls').wait_for(state='visible');frame.locator('#issue').click();frame.locator('#message').get_by_text('この端末用の証明書を発行しました。',exact=True).wait_for(timeout=20000)
   card=frame.locator('#credentials article').last
   card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();frame.locator('#consent').wait_for(state='visible');frame.locator('#deny').click();frame.locator('#message').get_by_text('提示しませんでした。',exact=True).wait_for()
   card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();frame.locator('#disclosure').evaluate('e=>e.parentElement.open=true');frame.locator('#approve').click();frame.locator('#message').get_by_text('承認した内容で、この開発環境への提示・検証が完了しました。',exact=True).wait_for(timeout=20000)
   measures=frame.locator('html').evaluate('e=>({width:e.clientWidth,scroll:e.scrollWidth})');assert measures['scroll']<=measures['width']+1
   assert g.evaluate('auth.currentUser!==null')
   g.screenshot(path=str(OUT/f'certificates-{width}.png'))
   card.get_by_role('button',name='失効する',exact=True).click();frame.locator('#message').get_by_text('失効しました。',exact=True).wait_for()
   card.get_by_role('button',name='証明書を削除する',exact=True).click();frame.locator('#message').get_by_text('失効して証明書を削除しました。失効確認に必要な最小記録は保持します。',exact=True).wait_for();frame.locator('#back').click();g.locator('#passportV2Dialog').wait_for(state='detached');assert g.evaluate('auth.currentUser!==null')
   assert not private_errors,private_errors
   assert not errors,errors
   results.append({'width':width,'issue':'PASS','deny':'PASS','approve_and_verify':'PASS','revoke':'PASS','back_and_login_preserved':'PASS','overflow':False,'page_errors':0,'passport_api_errors':0});(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print('PASS',width,flush=True)
  except Exception:
   g.screenshot(path=str(OUT/f'FAIL-{width}.png'));print('FAIL',width,'page_errors',errors,'passport_statuses',private_errors,flush=True);raise
  finally:c.close()
 browser.close()
(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
