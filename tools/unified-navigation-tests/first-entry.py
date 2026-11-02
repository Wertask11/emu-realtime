"""First direct City entry must not start the Quest guide. Local native fixture only."""
from playwright.sync_api import sync_playwright
import pathlib,urllib.parse,json,os
BASE=os.environ.get('UNIFIED_BASE','http://127.0.0.1:4220')
assert urllib.parse.urlparse(BASE).hostname in ['127.0.0.1','localhost']
OUT=pathlib.Path(os.environ.get('UNIFIED_OUTPUT','/workspace/outputs/unified-emu-20261102'));OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context(viewport={'width':1280,'height':950})
 c.add_init_script("localStorage.setItem('emu.analytics.consent.v1','no');localStorage.setItem('rk-tour-v1',JSON.stringify(Object.fromEntries(['sp-city','emu-feed'].map(x=>[x,'done']))))")
 c.route('**/*',lambda r:r.continue_() if urllib.parse.urlparse(r.request.url).hostname in ['127.0.0.1','localhost'] else r.abort())
 g=c.new_page();g.goto(BASE+'/test/native.html');g.wait_for_function('typeof __localEmulatorLogin==="function"');g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult');g.wait_for_function('_chesEntered===true');g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000);g.locator('#localEmulatorLogin').evaluate('e=>e.remove()');g.locator('#emuHeaderProfile').wait_for(state='visible');g.locator('#esnCity').click()
 section=g.frame_locator('#spDaoFrame').locator('[aria-labelledby="city-play-title"]');section.wait_for();g.wait_for_timeout(1000);assert g.evaluate('ReizoTour.progress("sp-quests").state')=='not_started';section.evaluate('e=>e.scrollIntoView({block:"center"})');g.screenshot(path=str(OUT/'AFTER-City-play-entries.png'));(OUT/'first-entry-results.json').write_text(json.dumps({'firstScreen':'city','questGuide':'not_started','productionWrites':False}));b.close()
