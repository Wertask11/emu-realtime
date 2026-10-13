"""LOCAL DUMMY Chromium regression. All non-local HTTP requests are blocked.
Run the local server first: python tools/tour-tests/serve.py
Then: python tools/tour-tests/browser.py --output /tmp/reizo-tour-evidence
"""
import argparse,json,pathlib,re,urllib.parse
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser();parser.add_argument('--output',default='/tmp/reizo-tour-evidence');args=parser.parse_args()
out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
origin='http://127.0.0.1:4180';results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    def context(width=390,height=844):
        ctx=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
        def network(route):
            parsed=urllib.parse.urlparse(route.request.url)
            if parsed.scheme=='http' and parsed.netloc=='127.0.0.1:4180':route.continue_()
            elif route.request.url=='https://emu-realtime.onrender.com/api/contact':
                # Browser-local response, never delivered to production.
                route.fulfill(status=200,content_type='application/json',body='{"ok":true}')
            else:route.abort()
        ctx.route('**/*',network);return ctx
    def progress(page,id):return page.evaluate('(id)=>ReizoTour.progress(id)',id)
    def panel(page):return page.locator('.rk-panel')
    def geometry(page):
        page.wait_for_timeout(80)
        rect=panel(page).bounding_box();assert rect and rect['x']>=-1 and rect['y']>=-1,rect
        viewport=page.viewport_size
        assert rect['x']+rect['width']<=viewport['width']+1,rect
        assert rect['y']+rect['height']<=viewport['height']+1,rect
        for button in panel(page).locator('button:visible').all():assert button.bounding_box()['height']>=44
        spot=page.locator('.rk-spotlight')
        if spot.is_visible():
            s=spot.bounding_box();overlap=min(rect['x']+rect['width'],s['x']+s['width']-6)>max(rect['x'],s['x']+6)+1 and min(rect['y']+rect['height'],s['y']+s['height']-6)>max(rect['y'],s['y']+6)+1
            assert not overlap,{'panel':rect,'spot':s,'title':page.locator('#rk-tour-title').inner_text()}
            assert spot.evaluate('(el)=>getComputedStyle(el).pointerEvents')=='none'
    def finish(page,id):
        count=progress(page,id)['total'];seen=[]
        for _ in range(count+1):
            if progress(page,id)['state']=='done':break
            expect(panel(page)).to_be_visible();geometry(page);seen.append(page.locator('#rk-tour-title').inner_text())
            panel(page).get_by_role('button',name=re.compile('^(次へ|完了)$')).click()
        assert progress(page,id)['state']=='done',(id,progress(page,id))
        expect(panel(page)).to_be_hidden();return seen
    for width,height in [(1280,900),(768,1024),(412,915),(390,844),(375,667)]:
        ctx=context(width,height);page=ctx.new_page();page.set_default_timeout(12000);errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(origin+'/__tour-fixture.html?brand=schoolpark')
        expect(page.locator('#rk-tour-title')).to_have_text('ホームの概要');geometry(page)
        page.screenshot(path=str(out/f'local-dummy-{width}-schoolpark.png'),full_page=True)
        assert progress(page,'sp-home')['index']==0
        panel(page).get_by_role('button',name='次へ',exact=True).click();expect(page.locator('#rk-tour-title')).to_have_text('メニューの見方')
        panel(page).get_by_role('button',name='戻る',exact=True).click();assert progress(page,'sp-home')['index']==0
        panel(page).get_by_role('button',name='あとで閉じる',exact=True).click();assert progress(page,'sp-home')['state']=='in_progress'
        page.reload();page.locator('#spDaoFrame').wait_for();page.wait_for_timeout(200)
        assert not panel(page).is_visible(),'in_progress must not interrupt on return'
        page.evaluate("ReizoTour.resume('sp-home')");finish(page,'sp-home')
        page.reload();page.wait_for_timeout(300);assert not panel(page).is_visible(),'done must not reopen'
        # Native template redraw and a new screen auto-guide.
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('library')()")
        expect(page.locator('#rk-tour-title')).to_have_text('知恵とは')
        panel(page).get_by_role('button',name='次へ',exact=True).click();assert progress(page,'sp-wisdom')['index']==1
        page.evaluate("(()=>{const a=document.getElementById('spDaoFrame').contentWindow.app,o=a.setState;a.fixtureTagCalls=0;a.setState=function(p){if(p&&'wtag'in p)this.fixtureTagCalls++;return o.call(this,p)};})()")
        frame=page.frame_locator('#spDaoFrame');frame.locator('[data-tour="wisdom-tags"] > div').nth(1).click()
        expect(page.locator('#rk-tour-title')).to_have_text('カードを読む');assert page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.fixtureTagCalls")==1
        geometry(page);panel(page).get_by_role('button',name='完了',exact=True).click()
        # Skip persists and is distinct from pause/done.
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('logs')()")
        expect(page.locator('#rk-tour-title')).to_have_text('ギルドとは');panel(page).get_by_role('button',name='スキップ',exact=True).click()
        assert progress(page,'sp-guilds')['state']=='skipped'
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.setState({})");page.wait_for_timeout(100);assert not panel(page).is_visible()
        # Every regular template can be completed by Next alone.
        ids=['sp-guilds','sp-guild','sp-quests','sp-quest-detail','sp-park','sp-contribution','sp-treasury','sp-city','sp-tasks','sp-year-goals']
        for id in ids:
            ok=page.evaluate('(id)=>ReizoTour.restart(id)',id);assert ok,id
            seen=finish(page,id);assert seen,id
        # Guild/plaza detailed templates use shared state, not record IDs.
        page.evaluate("ReizoTour.restart('sp-plaza')");finish(page,'sp-plaza')
        # Existing fridge button → choice → real original chat handlers.
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.go('home')()")
        frame.locator('[data-tour="fridge"]').focus();frame.locator('[data-tour="fridge"]').press('Enter')
        expect(panel(page).get_by_role('button',name='冷蔵庫くんに聞く',exact=True)).to_be_visible()
        panel(page).get_by_role('button',name='冷蔵庫くんに聞く',exact=True).click();expect(page.locator('#spReizoPanel')).to_have_class(re.compile('open'))
        page.locator('#spReizoInput').fill('Room1はどこ？');page.locator('#spReizoInput').press('Enter')
        expect(page.locator('#spReizoMessages')).to_contain_text('知識を探す')
        assert page.evaluate('window.fixtureChatOpens')==1
        page.evaluate('spReizoClose()');frame.locator('[data-tour="fridge"]').click();panel(page).get_by_role('button',name='この画面のガイドを見る',exact=True).click()
        expect(page.locator('#rk-tour-title')).to_have_text('ホームの概要');page.keyboard.press('Escape');expect(panel(page)).to_be_hidden()
        expect(frame.locator('[data-tour="fridge"]')).to_be_focused()
        page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.setState({guilds:[]})")
        assert not page.evaluate("ReizoTour.restart('sp-guild')")
        expect(page.locator('.rk-toast')).to_contain_text('表示できるギルドがありません')
        assert page.evaluate("document.getElementById('spDaoFrame').contentWindow.app.state.screen")=='home'
        # Same-origin iframe read guide and unchanged native Room1 navigation.
        page.evaluate("ReizoTour.restart('emu-feed')");page.frame_locator('#emuKnowledgeFrame').locator('[data-tour="knowledge-card"]').wait_for();geometry(page)
        page.screenshot(path=str(out/f'local-dummy-{width}-emu-read.png'),full_page=True)
        assert page.frame_locator('#emuKnowledgeFrame').locator('[data-command="room1"]').count()==0
        page.frame_locator('#emuKnowledgeFrame').locator('#topFilters [data-filter]:not(.active)').first.click()
        expect(page.locator('#rk-tour-title')).to_have_text('カードを読む')
        finish(page,'emu-feed')
        for id in ['emu-requests','emu-share','emu-discussion']:
            assert page.evaluate('(id)=>ReizoTour.restart(id)',id);finish(page,id)
        page.evaluate("showEmuRequests()");expect(page.locator('.emu-room1-entry')).to_be_visible();assert page.locator('.emu-room1-entry:visible').count()==1
        page.locator('.emu-room1-entry').click();assert page.evaluate("document.body.classList.contains('sp-room-open')")
        assert page.locator('#spRoomFrame').get_attribute('src')=='/admin/room1/index.html'
        expect(panel(page)).to_be_hidden();page.evaluate('closeSpRoom()')
        # Catalog replay opens the actual destination and preserves the contact form.
        page.evaluate("toggleContactPanel();switchContactTab('tutorial')")
        expect(page.locator('#rk-guide-catalog')).to_contain_text('SchoolPark');expect(page.locator('#rk-guide-catalog')).to_contain_text('Emu')
        page.locator('[data-rk-source="catalog-videos"]').click();assert page.locator('.rk-video-row').count()==4
        assert page.locator('#rk-guide-catalog').get_by_text('動画準備中',exact=True).count()==4
        assert page.locator('#rk-guide-catalog video').count()==0
        page.screenshot(path=str(out/f'local-dummy-{width}-video-catalog.png'),full_page=True)
        page.locator('[data-rk-source="catalog-guides"]').click();page.locator('[data-rk-source="all-emu-requests-restart"]').click()
        expect(page.locator('#rk-tour-title')).to_have_text('知識を探す');panel(page).get_by_role('button',name='あとで閉じる',exact=True).click()
        expect(page.locator('#emu-contact-panel')).to_have_class('open')
        expect(page.locator('[data-rk-source="all-emu-requests-restart"]')).to_be_focused()
        page.evaluate("switchContactTab('contact')")
        page.locator('.w-cat-btn[data-type="general"]').click();page.locator('#w-next').click();page.locator('#wf-name').fill('ローカルのダミー');page.locator('#wf-email').fill('invalid');page.locator('#wf-message').fill('架空の問い合わせ')
        page.locator('#w-next').click();assert page.locator('#ws-2').get_attribute('class')=='w-step active'
        page.locator('#wf-email').fill('dummy@example.invalid');page.evaluate("switchContactTab('tutorial');switchContactTab('contact')");expect(page.locator('#wf-message')).to_have_value('架空の問い合わせ')
        page.locator('#w-next').click();expect(page.locator('#ws-3')).to_have_class('w-step active')
        page.locator('#w-next').click();expect(page.locator('#w-success')).to_have_class('show')
        page.evaluate("toggleContactPanel();ReizoTour.restart('emu-requests')")
        expect(panel(page)).to_be_visible()
        page.evaluate("(()=>{const modal=document.createElement('div');modal.id='fixture-native-modal';modal.className='modal';modal.style.display='flex';modal.textContent='LOCAL DUMMY native form';document.body.append(modal)})()")
        expect(panel(page)).to_be_hidden();assert progress(page,'emu-requests')['state']=='in_progress'
        page.evaluate("document.getElementById('fixture-native-modal').remove()")
        page.wait_for_timeout(100);expect(panel(page)).to_be_hidden()
        # Only guide metadata is persisted. No dummy names/content IDs/inputs.
        raw=page.evaluate("localStorage.getItem('rk-tour-v1')");assert not any(v in raw for v in ['synthetic','ダミー','example','架空'])
        saved=json.loads(raw);assert set(saved)=={'version','tours'}
        assert all(set(value)=={'state','index'} for value in saved['tours'].values())
        assert errors==[],errors
        results.append({'viewport':[width,height],'result':'PASS','guide_count':len(page.evaluate('ReizoTour.list()')),'page_errors':errors})
        print(f'{width}px: PASS (templates, geometry, native actions, persistence, Room1, chat, support)',flush=True)
        ctx.close()
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
    page.evaluate('ReizoTour.next()');assert progress(page,'sp-delayed')['state']=='done';ctx.close()
    ctx=context();ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})");page=ctx.new_page();page.goto(origin+'/__tour-core.html');page.locator('#launch').click();expect(page.locator('.rk-status')).to_contain_text('進捗を保存できません');page.evaluate('ReizoTour.skip()');ctx.close()
    browser.close()
    (out/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print('Core timing/redraw/resize/focus/storage: PASS. All evidence is LOCAL DUMMY; no production writes.',flush=True)
