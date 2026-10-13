"""Actual SchoolPark template with withheld LOCAL DUMMY results; never production data."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser();parser.add_argument('--output',default='/tmp/reizo-tour-timing-evidence');args=parser.parse_args()
origin='http://127.0.0.1:4180';results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    def context(width,height):
        ctx=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
        ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else r.abort())
        return ctx
    def fixture(ctx,query):
        page=ctx.new_page();page.set_default_timeout(10000)
        page.goto(origin+'/__tour-fixture.html?brand=schoolpark&'+query)
        page.wait_for_function("document.getElementById('spDaoFrame').contentWindow.app?.tourRenderedScreen === 'home'")
        return page
    def state(page,id):return page.evaluate('(id)=>ReizoTour.progress(id)',id)
    def no_guide(page,id,wait=2900):
        page.wait_for_timeout(wait)
        assert not page.locator('.rk-panel').is_visible(),id
        assert not page.locator('.rk-spotlight').is_visible(),id
        assert state(page,id)['state']=='not_started',(id,state(page,id))
    def expand(page):
        if 'rk-collapsed' in (page.locator('.rk-panel').get_attribute('class') or ''):page.locator('.rk-fold').click()
    def finish(page,id):
        for _ in range(state(page,id)['total']):
            if state(page,id)['state']=='done':break
            expand(page);page.locator('.rk-panel .rk-primary').click()
        assert state(page,id)['state']=='done'
    for width,height in [(375,667),(1280,900)]:
        ctx=context(width,height)
        page=fixture(ctx,'cover=1&hold=guilds,quests,wisdom,tasks&holdGuildDetail=1')
        no_guide(page,'sp-home')
        # Individual results can arrive in any order. All must have been drawn before home starts.
        page.evaluate("fixtureDeliverData('quests');fixtureDeliverData('wisdom');fixtureDeliverData('tasks')")
        no_guide(page,'sp-home',200)
        page.evaluate("document.getElementById('spLoadingOverlay').style.opacity='0'")
        no_guide(page,'sp-home',250) # fading cover is still a cover
        page.evaluate("document.documentElement.classList.add('ches-resuming');document.getElementById('spLoadingOverlay').style.display='none'")
        no_guide(page,'sp-home',150)
        page.evaluate("document.documentElement.classList.remove('ches-resuming')")
        expect(page.locator('#rk-tour-title')).to_have_text('THIS WEEK');assert state(page,'sp-home')['index']==0
        page.locator('.rk-primary').click();expect(page.locator('#rk-tour-title')).to_have_text('メニュー')
        # Temporary loading while a guide is open hides it without pausing/skipping the step.
        page.evaluate("document.getElementById('spLoadingOverlay').style.display='flex'")
        page.wait_for_timeout(2900);expect(page.locator('.rk-panel')).to_be_hidden()
        assert state(page,'sp-home')['index']==1 and state(page,'sp-home')['state']=='in_progress'
        page.evaluate("document.getElementById('spLoadingOverlay').style.display='none'")
        expect(page.locator('#rk-tour-title')).to_have_text('メニュー')
        finish(page,'sp-home')
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('logs')()")
        no_guide(page,'sp-guilds')
        page.evaluate("fixtureDeliverData('guilds')")
        expect(page.locator('#rk-tour-title')).to_have_text('ギルドを選ぶ');finish(page,'sp-guilds')
        page.evaluate("ReizoTour.restart('sp-guild')")
        no_guide(page,'sp-guild')
        page.evaluate('fixtureFinishGuild()')
        expect(page.locator('#rk-tour-title')).to_have_text('ギルドの詳細');finish(page,'sp-guild')
        page.close();ctx.close();ctx=context(width,height)
        # A heading/filter exists before Quest data: still do not start or consume the missing timer.
        page=fixture(ctx,'hold=quests')
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('experiments')()")
        no_guide(page,'sp-quests')
        assert state(page,'sp-home')['state']=='not_started','unshown home must stay unseen when leaving'
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.setState({quests:[],questsDenied:true})")
        no_guide(page,'sp-quests',200)
        page.evaluate("fixtureDeliverData('quests');document.getElementById('spDaoFrame').contentWindow.app.setState({questsDenied:false})")
        expect(page.locator('#rk-tour-title')).to_have_text('クエストの説明');finish(page,'sp-quests')
        page.close();ctx.close()
        # Late arrival on an old screen must not launch its guide after navigating away.
        ctx=context(width,height);page=fixture(ctx,'hold=quests,guilds')
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('logs')()")
        page.wait_for_timeout(100)
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('experiments')();fixtureDeliverData('guilds')")
        no_guide(page,'sp-quests',200)
        assert state(page,'sp-guilds')['state']=='not_started'
        page.evaluate("fixtureDeliverData('quests')")
        expect(page.locator('#rk-tour-title')).to_have_text('クエストの説明');finish(page,'sp-quests');ctx.close()
        # A genuine empty response is ready. Only absent content steps use the normal 2.5s skip.
        ctx=context(width,height);page=fixture(ctx,'hold=quests')
        page.evaluate("const a=document.getElementById('spDaoFrame').contentWindow.app;a.go('experiments')();a.setState({quests:[],noQuests:true})")
        expect(page.locator('#rk-tour-title')).to_have_text('クエストの説明')
        page.locator('.rk-primary').click();page.locator('.rk-primary').click();page.wait_for_timeout(2900)
        assert state(page,'sp-quests')['state']=='done';expect(page.locator('.rk-toast')).to_contain_text('対象が見つからない')
        ctx.close();results.append({'width':width,'status':'PASS','cases':['overlay/fade','partial data','initial unseen','active suspend/resume','guild list','guild detail','quest pending/denied/empty','late old route']})
        print(f'{width}px delayed SchoolPark timing: PASS',flush=True)
    browser.close()
output=pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
(output/'timing-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
