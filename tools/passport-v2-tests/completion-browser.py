from playwright.sync_api import sync_playwright
import pathlib,json,urllib.parse,os,threading,time,re
BASE='http://127.0.0.1:4246';OUT=pathlib.Path('/workspace/outputs/passport-completion-20261105');OUT.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--enable-precise-memory-info']);c=b.new_context(viewport={'width':390,'height':844});c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-passport','emu-feed'].map(k=>[k,'done']))));")
 def isolate(r):
  u=urllib.parse.urlparse(r.request.url)
  if u.hostname not in ['localhost','127.0.0.1']:r.abort();return
  if u.path.startswith('/passport-v2/'):
   x=r.fetch();r.fulfill(response=x,headers={**x.headers,'Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'})
  else:r.continue_()
 c.route('**/*',isolate);g=c.new_page();errors=[];failures=[];g.on('pageerror',lambda e:errors.append(str(e)));g.on('response',lambda r:failures.append([urllib.parse.urlparse(r.url).path,r.status]) if '/api/passport-v2/' in r.url and r.status>=400 else None)
 g.goto(BASE+'/test/native.html');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.evaluate('__localEmulatorLogin("bob")');g.wait_for_function('_chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.evaluate('openSpPassport()');g.locator('#sppCertificatesEntry button').click();f=g.frame_locator('#passportV2Dialog iframe');f.locator('#controls').wait_for(state='visible');f.locator('#issueSelective').click();f.locator('#message').get_by_text('この端末用の証明書を発行しました。',exact=True).wait_for(timeout=30000)
 card=f.locator('#credentials article').last;card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();f.locator('#hidden').get_by_text('assurance',exact=False).wait_for();f.locator('#deny').click();f.locator('#message').get_by_text('提示しませんでした。',exact=True).wait_for();card.get_by_role('button',name='この開発環境の検証画面へ提示内容を確認').click();f.locator('#approve').click();f.locator('#message').get_by_text('承認した内容で、この開発環境への提示・検証が完了しました。',exact=True).wait_for(timeout=30000);print('PASS selective UI',flush=True)
 cd=g.context.new_cdp_session(g);metrics=[]
 info=b.new_browser_cdp_session().send('SystemInfo.getProcessInfo')['processInfo'];renderer_ids=[int(x['id']) for x in info if x['type']=='renderer']
 def renderer_rss():
  total=0
  for pid in renderer_ids:
   try:
    m=re.search(r'^VmRSS:\s+(\d+)',pathlib.Path('/proc/'+str(pid)+'/status').read_text(),re.M)
    if m:total+=int(m.group(1))*1024
   except OSError:pass
  return total
 for case in ['age18','identity','city']:
  cd.send('Emulation.setCPUThrottlingRate',{'rate':6});rss_before=renderer_rss();peak=[rss_before];stop=threading.Event()
  def sample_rss():
   while not stop.wait(.05):peak[0]=max(peak[0],renderer_rss())
  sampler=threading.Thread(target=sample_rss,daemon=True);sampler.start();f.locator('#zkpCase').select_option(case);f.locator('#tryZkp').click();f.locator('#zkpConsent').wait_for(state='visible');f.locator('#approveZkp').click();f.locator('#zkpConsent').wait_for(state='hidden',timeout=180000);f.locator('#message').get_by_text('テスト資格のZKP生成・検証が成功しました。',exact=False).wait_for(timeout=180000);stop.set();sampler.join();metrics.append({'renderer_rss_before':rss_before,'renderer_rss_peak':peak[0],'case':case,'cpu_throttle':6,'viewport':390,**f.locator('body').evaluate('()=>window.__passportZkpMetrics')});print('PASS ZKP',case,metrics[-1]['ms'],flush=True)
 cd.send('Emulation.setCPUThrottlingRate',{'rate':1});widths=[]
 for width in [375,390,412,768,1280,1440,1920]:
  g.set_viewport_size({'width':width,'height':950 if width>=768 else 844});m=f.locator('html').evaluate('e=>({w:e.clientWidth,s:e.scrollWidth})');assert m['s']<=m['w']+1,m;widths.append(width);f.locator('header').scroll_into_view_if_needed();g.screenshot(path=str(OUT/f'wallet-{width}.png'))
 assert not errors,errors;assert not failures,failures
 (OUT/'completion-browser.json').write_text(json.dumps({'selective_UI':'PASS','ZKP':metrics,'widths':widths,'page_errors':errors,'passport_API_errors':failures,'hardware':'Chromium desktop, mobile viewport + CPU throttle; not a physical phone','memory':'JS heap delta plus sampled total renderer RSS; RSS includes app/JS/WASM, not WASM-only memory'},indent=2));b.close()
