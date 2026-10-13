"""Run the v2 native app scenarios, then controller regressions. Local data only."""
import argparse,json,pathlib,re,subprocess,sys,urllib.parse
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--output',default='/tmp/reizo-v2-evidence');args=parser.parse_args()
out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('v2-browser.py')),str(out)],check=True)
origin='http://127.0.0.1:4180'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    def context():
        ctx=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
        ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else r.abort());return ctx
    def panel(page):return page.locator('.rk-panel')
    def progress(page,id):return page.evaluate('(id)=>ReizoTour.progress(id)',id)
    def geometry(page):
        page.wait_for_timeout(100);rect=panel(page).bounding_box();vp=page.viewport_size
        assert rect and rect['x']>=0 and rect['y']>=0 and rect['x']+rect['width']<=vp['width']+1 and rect['y']+rect['height']<=vp['height']+1,rect
    # Controller-only edge cases isolate timing/focus from application navigation.
    ctx=context();page=ctx.new_page();page.goto(origin+'/__tour-core.html')
    page.locator('#launch').click();expect(page.locator('#rk-tour-title')).to_have_text('First');assert page.evaluate('window.nativeCalls')==0
    panel(page).get_by_role('button',name='次へ',exact=True).click();assert page.evaluate('window.nativeCalls')==0
    panel(page).get_by_role('button',name='戻る',exact=True).click();page.locator('#native').click();expect(page.locator('#rk-tour-title')).to_have_text('Second');assert page.evaluate('window.nativeCalls')==1
    page.keyboard.press('Escape');expect(panel(page)).to_be_hidden();expect(page.locator('#launch')).to_be_focused()
    page.evaluate("ReizoTour.register('sp-missing',[{target:'[data-tour=absent]',label:'Missing',text:'LOCAL DUMMY'}]);ReizoTour.enter('sp-missing')")
    expect(page.locator('.rk-status')).to_contain_text('読み込み');page.wait_for_timeout(2900);assert progress(page,'sp-missing')['state']=='done';expect(page.locator('.rk-toast')).to_contain_text('対象が見つからない')
    page.evaluate("ReizoTour.register('sp-delayed',[{target:'[data-tour=late]',label:'Delayed',text:'LOCAL DUMMY'}]);ReizoTour.enter('sp-delayed');setTimeout(()=>{const x=document.createElement('div');x.dataset.tour='late';x.textContent='Local delayed target';x.style.cssText='padding:30px;background:#eee;margin:10px';document.body.append(x)},600)")
    page.wait_for_timeout(900);assert progress(page,'sp-delayed')['state']=='in_progress';expect(page.locator('.rk-spotlight')).to_be_visible()
    page.evaluate("document.querySelector('[data-tour=late]').outerHTML='<div data-tour=late style=\"padding:35px;margin:20px;background:#eee\">Redrawn target</div>'");geometry(page)
    page.set_viewport_size({'width':768,'height':1024});geometry(page);page.set_viewport_size({'width':375,'height':667});geometry(page)
    page.evaluate('ReizoTour.next()');assert progress(page,'sp-delayed')['state']=='done'
    page.evaluate("document.querySelector('[data-tour=late]').remove();const a=document.createElement('div');a.dataset.tour='scroll-target';a.style.cssText='margin-top:1500px;padding:30px';a.textContent='LOCAL DUMMY';document.body.append(a);ReizoTour.register('sp-scroll',[{target:'[data-tour=scroll-target]',label:'Scroll',text:'LOCAL DUMMY'}]);ReizoTour.enter('sp-scroll')")
    expect(page.locator('.rk-spotlight')).to_be_visible();page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(2900);assert progress(page,'sp-scroll')['state']=='in_progress';assert progress(page,'sp-scroll')['index']==0
    ctx.close()
    ctx=context();ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})");page=ctx.new_page();page.goto(origin+'/__tour-core.html');page.locator('#launch').click();expect(page.locator('.rk-status')).to_contain_text('進捗を保存できません');page.evaluate('ReizoTour.skip()');ctx.close()
    browser.close()
    print('Core timing/redraw/resize/focus/storage: PASS',flush=True)
