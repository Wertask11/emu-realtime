"""Actual UI/Auth/Rules in the dedicated ux19 emulator; never Production writes."""
import json,pathlib,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright

BASE='http://127.0.0.1:4210'
OUT=pathlib.Path('/workspace/outputs/participation-ux');OUT.mkdir(parents=True,exist_ok=True)
if (OUT/'local-results.json').exists():(OUT/'local-results.json').rename(OUT/'previous-local-results.json')
TOURS=['sp-home','sp-guilds','sp-quests','sp-passport','sp-guild','sp-quest-detail','emu-feed','emu-requests','emu-share','emu-discussion']
def state():
    with urllib.request.urlopen(BASE+'/test/ux-state',timeout=5) as r:return json.load(r)
def await_state(g,field,count):
    for _ in range(90):
        data=state()
        if len(data[field])==count:return data
        g.wait_for_timeout(100)
    raise AssertionError((field,count,data))

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    c=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    c.add_init_script("localStorage.setItem('rk-tour-v1',JSON.stringify({version:1,tours:Object.fromEntries("+json.dumps(TOURS)+".map(x=>[x,{state:'done',index:99}]))}))")
    asset_cache={};transport_errors=[]
    def isolate(route):
        q=route.request;host=urllib.parse.urlparse(q.url).hostname
        if host in ['localhost','127.0.0.1']:route.continue_();return
        if q.method=='GET' and q.resource_type in ['script','stylesheet','font','image'] and host in ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com']:
            try:
                if q.url not in asset_cache:
                    try:r=urllib.request.urlopen(urllib.request.Request(q.url,headers={'Accept-Encoding':'identity'}),timeout=12)
                    except urllib.error.HTTPError as e:r=e
                    asset_cache[q.url]=(r.status,{k:v for k,v in r.headers.items() if k.lower() not in ['content-encoding','transfer-encoding','connection']},r.read())
                status,headers,body=asset_cache[q.url];route.fulfill(status=status,headers=headers,body=body)
            except Exception as e:transport_errors.append({'host':host,'error':str(e)});route.abort()
            return
        route.abort()
    c.route('**/*',isolate)
    g=c.new_page();g.set_default_timeout(25000);errors=[];console_errors=[];dialogs=[];failed_responses=[]
    g.on('pageerror',lambda e:errors.append(str(e)))
    g.on('response',lambda r:failed_responses.append({'status':r.status,'path':urllib.parse.urlparse(r.url).path}) if r.status>=400 else None)
    g.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
    def dialog(d):dialogs.append({'type':d.type,'message':d.message});d.accept()
    g.on('dialog',dialog)
    g.goto(BASE+'/test/native.html',wait_until='domcontentloaded')
    g.wait_for_function('typeof __localEmulatorLogin==="function"')
    g.locator('#localEmulatorLogin').click();g.evaluate('window.__localLoginResult')
    g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
    # This button belongs only to the local fixture and must not obscure screenshots.
    g.locator('#localEmulatorLogin').evaluate('el=>el.hidden=true')
    identity=g.evaluate('async()=>({uid:auth.currentUser.uid,spid:(await spPassportLoad()).spid})')
    baseline=state();assert not baseline['entryCommits'] and not baseline['guildJoins']
    d=g.frame_locator('#spDaoFrame')
    def schoolpark():
        g.evaluate('openSpDao()');d.locator('[data-sp-head] .service-switch').wait_for()
    def overflow():
        assert g.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert d.locator('html').evaluate('el=>el.scrollWidth<=innerWidth+1')
    results=[]
    for width in [375,390,412,768,1280,1440,1920]:
        g.set_viewport_size({'width':width,'height':950});g.wait_for_timeout(200);schoolpark()
        # Real parent bridge and existing entry checks, using the new header switch.
        switch=d.locator('[data-sp-head] .service-switch')
        assert switch.bounding_box()['height']>=44
        switch.click();menu=g.locator('#spMobileMenu')
        menu.wait_for(state='visible')
        assert menu.locator('[data-brand="schoolpark"]').get_attribute('aria-current')=='page'
        g.keyboard.press('Escape');menu.wait_for(state='hidden');assert switch.evaluate('async el=>{for(let i=0;i<30;i++){if(el.ownerDocument.querySelector("[data-sp-head] .service-switch")===el.ownerDocument.activeElement)return true;await new Promise(requestAnimationFrame)}return false}')
        d.locator('html').evaluate('()=>app.setState({})');assert switch.evaluate('async el=>{await new Promise(requestAnimationFrame);return document.querySelector("[data-sp-head] .service-switch")===document.activeElement}')
        switch.click();menu.locator('[data-brand="emu"]').click()
        g.locator('#mainApp .service-switch').wait_for(state='visible')
        assert g.evaluate('auth.currentUser.uid')==identity['uid']
        g.screenshot(path=str(OUT/f'LOCAL-Emu-switch-{width}.png'))
        g.locator('#mainApp .service-switch').click();menu.locator('[data-brand="schoolpark"]').click()
        g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
        d.locator('[data-sp-head] .service-switch').wait_for()
        # Browsing home, guild list and guild details cannot enroll the user.
        d.locator('html').evaluate("()=>{app.setState({screen:'home'});app.toTop()}")
        d.get_by_role('button',name='ギルドの活動を見る',exact=True).click()
        d.locator('[data-tour="guild-list"]').wait_for()
        guild=d.locator('[data-tour="guild-card"]').filter(has_text='LEARN').first
        guild.focus();g.keyboard.press('Enter')
        d.locator('[data-tour="guild-before-join"]').wait_for()
        join=d.get_by_role('button',name='このギルドに参加したい',exact=False)
        join.wait_for();assert len(state()['guildJoins'])==0
        overflow();g.screenshot(path=str(OUT/f'LOCAL-guild-before-{width}.png'))
        join.click();joined=await_state(g,'guildJoins',1)
        assert set(joined['guildJoins'][0]['fields'])=={'name','at'}
        d.get_by_role('button',name='✓ 参加したい',exact=False).wait_for()
        g.screenshot(path=str(OUT/f'LOCAL-guild-after-{width}.png'))
        # Wait for the existing busy flag before requesting the next actual action.
        g.wait_for_function('!_spGuildBusy')
        d.get_by_role('button',name='✓ 参加したい',exact=False).click();await_state(g,'guildJoins',0)
        g.wait_for_function('!_spGuildBusy')
        d.get_by_role('button',name='このギルドを応援する',exact=False).click();await_state(g,'guildSupports',1)
        g.wait_for_function('!_spGuildBusy')
        d.get_by_role('button',name='✓ 応援している',exact=False).click();await_state(g,'guildSupports',0)
        d.get_by_text('← ギルド',exact=True).click();d.locator('[data-tour="guild-list"]').wait_for()
        # Existing stages only; an unclassified quest must never become an entry quest.
        d.locator('html').evaluate("()=>{app.setState({screen:'experiments',filter:'すべて',series:'general',entryOnly:false});app.toTop()}")
        d.get_by_role('button',name='「入門」のクエストに絞る',exact=True).click()
        d.locator('[data-tour="quest-card"]').first.wait_for()
        assert d.locator('[data-tour="quest-card"]').count()==1
        assert 'ux-entry' in d.locator('html').evaluate('()=>JSON.stringify(app.state.quests.filter(q=>q.stage==="入門").map(q=>q.id))')
        assert len(state()['entryCommits'])==0
        g.screenshot(path=str(OUT/f'LOCAL-quests-{width}.png'))
        d.get_by_role('button',name='内容を見る（参加しません） →',exact=True).click()
        d.locator('[data-tour="quest-before-join"]').wait_for()
        assert len(state()['entryCommits'])==0
        assert '報酬は確定しません' in d.locator('[data-tour="quest-before-join"]').inner_text()
        assert '要確認' in d.locator('[data-tour="quest-before-join"]').inner_text()
        overflow();g.screenshot(path=str(OUT/f'LOCAL-quest-before-{width}.png'))
        d.get_by_role('button',name='このクエストを受ける',exact=True).click()
        taken=await_state(g,'entryCommits',1)
        assert set(taken['entryCommits'][0]['fields'])=={'name','tookAt'}
        d.get_by_role('button',name='✓ 受けている',exact=True).wait_for()
        g.screenshot(path=str(OUT/f'LOCAL-quest-after-{width}.png'))
        g.wait_for_function('!_spQuestBusy')
        d.get_by_role('button',name='✓ 受けている',exact=True).click();await_state(g,'entryCommits',0)
        g.wait_for_function('!_spQuestBusy')
        d.get_by_text('← クエスト一覧',exact=True).click();d.locator('[data-tour="quest-card"]').first.wait_for()
        after=state();assert after['counts']==baseline['counts'];assert after['approvedCommits']==baseline['approvedCommits']
        assert g.evaluate('auth.currentUser.uid')==identity['uid']
        assert g.evaluate('async()=>(await spPassportLoad()).spid')==identity['spid']
        results.append({'width':width,'switchAndKeyboard':True,'browseDoesNotJoin':True,'guildJoinSupportAndUndo':True,'questJoinAndLeave':True,'existingStageFilter':True,'backAndSession':True,'noNewRewardOrNotification':True})
        print('PASS width',width,flush=True)
    # Emu remains four tabs; reading never forces participation.
    g.evaluate('showEmuRequests()');g.locator('.emu-practice-entry').wait_for()
    assert '見るだけでは参加になりません' in g.locator('.emu-practice-entry').inner_text()
    g.locator('.emu-practice-entry button').click();g.locator('#spLoadingOverlay').wait_for(state='hidden',timeout=30000)
    d.locator('[data-sp-head]').wait_for();g.evaluate('showEmuFeed()')
    k=g.frame_locator('#emuKnowledgeFrame');k.get_by_role('button',name='新着',exact=True).first.click()
    g.locator('#emuHeaderReizo').click();g.locator('#rk-tour .rk-panel:not([hidden])').wait_for()
    assert g.locator('#rk-tour .rk-panel:not([hidden])').count()==1
    g.locator('#rk-tour .rk-close').click()
    progress=g.evaluate('JSON.parse(localStorage.getItem("rk-tour-v1"))')
    assert all(progress['tours'][key]['state']=='done' for key in TOURS)
    assert not errors,errors
    assert not transport_errors,transport_errors
    report={'environment':'LOCAL, actual isolated Firebase Auth and Security Rules; synthetic records only','baselineCommit':'f52dc21cbe20c7e09ea21bf7496a0f4e5487cd8a','results':results,'pageErrors':errors,'consoleErrors':console_errors,'failedResponses':failed_responses,'assetTransportErrors':transport_errors,'dialogs':dialogs,'tutorialCompletedStatesPreserved':True,'singleFridgePanel':True,'emuReadingAndPracticeLink':True,'beforeState':baseline,'afterState':state(),'productionWrites':False,'actualRewardClaims':0}
    (OUT/'local-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'result':'PASS','widths':len(results),'pageErrors':errors,'consoleErrors':len(console_errors)}))
    c.unroute_all(behavior='ignoreErrors');browser.close()
