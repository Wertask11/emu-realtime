"""Real SchoolPark template; blocked homework must not hide a ready home guide."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser();parser.add_argument('--output',default='/tmp/reizo-tour-home-ready-evidence');args=parser.parse_args()
origin='http://127.0.0.1:4180';results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    def context(width,height,stored=None):
        ctx=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
        ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else r.abort())
        if stored:ctx.add_init_script("localStorage.setItem('rk-tour-v1',"+json.dumps(json.dumps({'version':1,'tours':{'sp-home':stored}}))+')')
        return ctx
    def home(ctx,query='hold=tasks'):
        page=ctx.new_page();page.set_default_timeout(8000)
        page.goto(origin+'/__tour-fixture.html?brand=schoolpark&'+query)
        page.wait_for_function("document.getElementById('spDaoFrame').contentWindow.app?.tourRenderedDataReady?.wisdom")
        return page
    def progress(page):return page.evaluate("ReizoTour.progress('sp-home')")
    def expand(page):
        if 'rk-collapsed' in (page.locator('.rk-panel').get_attribute('class') or ''):page.locator('.rk-fold').click()
    def finish(page):
        for _ in range(9):
            if progress(page)['state']=='done':break
            expand(page);page.locator('.rk-panel .rk-primary').click()
        assert progress(page)['state']=='done'
    def replay_from_fridge(page,status_text):
        page.frame_locator('#spDaoFrame').locator('[data-tour="fridge"]').click()
        expect(page.locator('.rk-count')).to_contain_text(status_text)
        page.get_by_role('button',name='この画面のガイドを見る',exact=True).click()
        expect(page.locator('.rk-panel')).to_be_visible()
    for width,height in [(1848,960),(375,667)]:
        # Homework never arrives; the main content is already drawn and can be explained.
        ctx=context(width,height);page=home(ctx)
        expect(page.locator('.rk-panel')).to_be_visible();expect(page.locator('#rk-tour-title')).to_have_text('THIS WEEK')
        assert not page.evaluate("Boolean(document.getElementById('spDaoFrame').contentWindow.app.tourRenderedDataReady.tasks)")
        assert progress(page)['index']==0
        finish(page);page.reload();page.wait_for_timeout(350);expect(page.locator('.rk-panel')).to_be_hidden()
        replay_from_fridge(page,'完了しています');expect(page.locator('#rk-tour-title')).to_have_text('THIS WEEK');finish(page);ctx.close()
        # Old in-progress records deliberately do not auto-interrupt, but real replay must work.
        ctx=context(width,height,{'state':'in_progress','index':1});page=home(ctx)
        page.wait_for_timeout(350);assert not page.locator('.rk-panel').is_visible()
        replay_from_fridge(page,'途中です（2/9）');expect(page.locator('#rk-tour-title')).to_have_text('メニュー')
        assert progress(page)['index']==1;finish(page);ctx.close()
        ctx=context(width,height,{'state':'skipped','index':0});page=home(ctx)
        page.wait_for_timeout(350);assert not page.locator('.rk-panel').is_visible()
        replay_from_fridge(page,'スキップしました');finish(page);ctx.close()
        # Removing the homework dependency must not revive the early-overlay/data bug.
        ctx=context(width,height);page=home(ctx,'hold=tasks,quests&cover=1')
        page.wait_for_timeout(2800);expect(page.locator('.rk-panel')).to_be_hidden();assert progress(page)['state']=='not_started'
        page.evaluate("document.getElementById('spLoadingOverlay').style.display='none'")
        page.wait_for_timeout(350);expect(page.locator('.rk-panel')).to_be_hidden();assert progress(page)['state']=='not_started'
        page.evaluate("fixtureDeliverData('quests')")
        expect(page.locator('.rk-panel')).to_be_visible();expect(page.locator('#rk-tour-title')).to_have_text('THIS WEEK')
        assert progress(page)['index']==0;finish(page);ctx.close()
        results.append({'viewport':[width,height],'result':'PASS','cases':['home with unavailable homework','finish all steps','done replay','old in-progress replay','skipped replay','loading cover','main data still pending']})
        print(f'{width}px home unavailable-homework / progress / replay: PASS',flush=True)
    browser.close()
out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
(out/'home-ready-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
