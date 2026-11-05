from playwright.sync_api import sync_playwright
import pathlib,json,urllib.parse,os,threading,time,re
BASE='http://127.0.0.1:4246';OUT=pathlib.Path('/workspace/outputs/passport-rc-20261105');OUT.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--enable-precise-memory-info']);c=b.new_context(viewport={'width':390,'height':844});c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-passport','emu-feed'].map(k=>[k,'done']))));")
 def isolate(r):
  u=urllib.parse.urlparse(r.request.url)
  if u.hostname not in ['localhost','127.0.0.1']:r.abort();return
  if u.path.startswith('/passport-v2/'):
   x=r.fetch();r.fulfill(response=x,headers={**x.headers,'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'})
  else:r.continue_()
 c.route('**/*',isolate);g=c.new_page();errors=[];failures=[];g.on('pageerror',lambda e:errors.append(str(e)));g.on('response',lambda r:failures.append([urllib.parse.urlparse(r.url).path,r.status]) if '/api/passport-v2/' in r.url and r.status>=400 else None)
 g.goto(BASE+'/test/native.html');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.evaluate('__localEmulatorLogin("bob")');g.wait_for_function('window._chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.evaluate('openSpPassport()');g.locator('#sppCertificatesEntry button').click();f=g.frame_locator('#passportV2Dialog iframe');f.locator('#controls').wait_for(state='visible');f.locator('#issueSelective').click();f.locator('#message').get_by_text('この端末用の証明書を発行しました。',exact=True).wait_for(timeout=30000)
 card=f.locator('#credentials article').last;card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();f.locator('#hidden').get_by_text('assurance',exact=False).wait_for();f.locator('#deny').click();f.locator('#message').get_by_text('提示しませんでした。',exact=True).wait_for();card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();f.locator('#approve').click();f.locator('#message').get_by_text('承認した内容で、この開発環境への提示・検証が完了しました。',exact=True).wait_for(timeout=30000);print('PASS selective UI',flush=True)

 assert f.locator('#zkpSection').is_hidden()
 card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click()
 assert f.locator('#consent').get_attribute('aria-labelledby')=='consentHeading'
 assert f.locator('#consentHeading').inner_text()
 f.locator('#deny').focus();g.keyboard.press('Tab');assert f.locator('#approve').evaluate('e=>e===document.activeElement')
 g.keyboard.press('Escape');f.locator('#consent').wait_for(state='hidden')
 widths=[]
 for w in [375,390,412,768,1280,1440,1920]:
  g.set_viewport_size({'width':w,'height':950 if w>=768 else 844});f.locator('html').evaluate('()=>scrollTo(0,0)');assert f.locator('html').evaluate('e=>e.scrollWidth<=e.clientWidth+1');widths.append(w);g.screenshot(path=str(OUT/f'rc-wallet-{w}.png'))
 for i in range(10):
  if i==3: time.sleep(61)
  print('CYCLE',i,flush=True)
  f.locator('#back').click();g.locator('#passportV2Dialog').wait_for(state='hidden');assert g.evaluate('!!auth.currentUser');g.evaluate('openPassportCertificates()');f=g.frame_locator('#passportV2Dialog iframe');
  try:f.locator('#controls').wait_for(state='visible')
  except Exception:
   (OUT/'browser-failure.json').write_text(json.dumps({'phase':'reopen','cycle':i,'api_errors':failures,'page_errors':errors,'status':f.locator('#message').inner_text()}));raise
 g.reload();g.wait_for_function('!!window.auth?.currentUser',timeout=30000);g.wait_for_function('window._chesEntered===true',timeout=30000);g.evaluate('openSpPassport()');g.locator('#sppCertificatesEntry button').click();f=g.frame_locator('#passportV2Dialog iframe');f.locator('#controls').wait_for(state='visible');assert f.locator('#credentials article').count()>0
 assert not errors,errors
 assert not failures,failures
 (OUT/'rc-browser.json').write_text(json.dumps({'selective_UI':'PASS','keyboard_tab_escape':'PASS','dialog_label':'PASS','zkp_hidden':True,'widths':widths,'open_return_cycles':10,'reload_login_retained':True,'page_errors':errors,'api_errors':failures,'physical_phone':False,'screenreader_product':False},indent=2));b.close()
